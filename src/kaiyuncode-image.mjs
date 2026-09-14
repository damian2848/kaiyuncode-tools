#!/usr/bin/env node
import { isMainModule } from "../shared/entrypoint.mjs";

import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAdapterRequest } from "../shared/adapter-request.mjs";
import { loadProductionCapabilities } from "../shared/production-tutorial.mjs";
import { withConfirmCard } from "../shared/confirm-card.mjs";
import { runConcurrentTasks } from "../shared/concurrent-tasks.mjs";
import {
  buildCreativeCatalog,
  formatCreativeCatalog,
} from "../shared/creative-catalog.mjs";
import { resolveCredential } from "../shared/credentials.mjs";
import {
  downloadResult,
  pollTask,
  submitTask,
} from "../shared/http-client.mjs";
import { redactSensitive } from "../shared/redaction.mjs";
import {
  loadRuntimeCatalog,
  memoizeRuntimeCatalogLoader,
  runtimePriceForModel,
} from "../shared/runtime-catalog.mjs";

const RETIRED_MODELS = new Set(["gpt-image-2-max"]);
const IMAGE_CAPABILITY_ALIASES = new Map([
  ["image_text_generation", "image_async_text_generation"],
  ["image_multi_reference", "image_async_multi_reference"],
]);
const CAPABILITIES_PATH = fileURLToPath(
  new URL("../references/production-capabilities.json", import.meta.url),
);

async function loadCapabilities(options = {}) {
  return loadProductionCapabilities({
    bundledPath: CAPABILITIES_PATH,
    allowStale: true,
    ...options,
  });
}

function normalizedCapabilityKey(capabilityKey) {
  return IMAGE_CAPABILITY_ALIASES.get(capabilityKey) ?? capabilityKey;
}

function documentedImageInputName(adapter) {
  const names = new Set(
    (Array.isArray(adapter?.parameters) ? adapter.parameters : []).map(
      ({ name }) => name,
    ),
  );
  if (names.has("image[]")) return "image[]";
  if (names.has("image_urls[]")) return "image_urls[]";
  if (names.has("image")) return "image";
  return null;
}

function selectImageAdapterForInputs(
  imageCapabilities,
  capabilityKey,
  model,
  images,
  files,
) {
  const normalizedKey = normalizedCapabilityKey(capabilityKey);
  const capability = imageCapabilities.find(({ key }) => key === normalizedKey);
  if (!capability) {
    throw new Error(`Image capability ${capabilityKey} is not available`);
  }
  const matches = capability.adapters.filter(
    (candidate) => candidate.model === model && !RETIRED_MODELS.has(candidate.model),
  );
  if (matches.length === 0) {
    throw new Error(`Image model ${model} is not available for ${capabilityKey}`);
  }
  if (matches.length === 1) return matches[0];
  for (const field of ["image_urls[]", "image[]", "image"]) {
    const trialValue =
      field === "image" && images.length === 1 ? images[0] : images;
    const trial = Object.create(null);
    trial[field] = trialValue;
    const accepted = matches.filter((adapter) =>
      candidateAccepts(adapter, trial, files),
    );
    if (accepted.length === 1) return accepted[0];
  }
  return matches[0];
}

function assignImageInputs(values, images, fieldName) {
  if (!fieldName) {
    throw new Error("Selected adapter does not document an image input field");
  }
  if (fieldName === "image") {
    if (images.length === 1) {
      addParam(values, "image", images[0]);
      return;
    }
    if (Object.hasOwn(values, "image")) {
      throw new Error("CLI parameter image conflicts with repeated --image values");
    }
    values.image = images;
    return;
  }
  if (Object.hasOwn(values, fieldName)) {
    throw new Error(`CLI parameter ${fieldName} conflicts with repeated --image values`);
  }
  values[fieldName] = images;
}

function present(value) {
  return value !== undefined && value !== null && value !== "-";
}

function requiredPresent(value) {
  return (
    present(value) &&
    (!Array.isArray(value) || value.length > 0) &&
    (typeof value !== "string" || value.trim().length > 0)
  );
}

function fileSatisfies(parameter, files) {
  const leaf = parameter.name.replace(/\[\]$/u, "").split(".").at(-1);
  return files.some(({ field }) => field === leaf);
}

function missingRequired(adapter, values, files) {
  return adapter.parameters.filter((parameter) => {
    if (!parameter.required || parameter.name === "model") return false;
    // Required values must not silently inherit tutorial examples.
    const value = Object.hasOwn(values, parameter.name)
      ? values[parameter.name]
      : undefined;
    return !requiredPresent(value) && !fileSatisfies(parameter, files);
  });
}

function candidateAccepts(adapter, values, files) {
  const names = new Set(adapter.parameters.map(({ name }) => name));
  return (
    Object.keys(values).every((name) => names.has(name)) &&
    missingRequired(adapter, values, files).length === 0
  );
}

function findAdapter(imageCapabilities, capabilityKey, model, values, files) {
  if (RETIRED_MODELS.has(model)) {
    throw new Error(`${model} is not available in the production model catalog`);
  }
  const normalizedKey = normalizedCapabilityKey(capabilityKey);
  const capability = imageCapabilities.find(({ key }) => key === normalizedKey);
  if (!capability) {
    throw new Error(`Image capability ${capabilityKey} is not available`);
  }
  const matches = capability.adapters.filter(
    (candidate) => candidate.model === model && !RETIRED_MODELS.has(candidate.model),
  );
  if (matches.length === 0) {
    throw new Error(`Image model ${model} is not available for ${capabilityKey}`);
  }
  if (matches.length === 1) return matches[0];

  const compatible = matches.filter((adapter) =>
    candidateAccepts(adapter, values, files),
  );
  if (compatible.length === 1) return compatible[0];
  if (compatible.length === 0) {
    const allNames = new Set(matches.flatMap((adapter) => adapter.parameters.map(({ name }) => name)));
    const unknown = Object.keys(values).find((name) => !allNames.has(name));
    if (unknown) throw new Error(`Unknown adapter parameter: ${unknown}`);
    const missing = matches.flatMap((adapter) => missingRequired(adapter, values, files));
    if (missing.length > 0) {
      throw new Error(`Required adapter parameter is missing: ${missing[0].name}`);
    }
    throw new Error(`No documented adapter profile matches ${capabilityKey} and ${model}`);
  }
  throw new Error(`Adapter profile is ambiguous for ${capabilityKey} and ${model}`);
}

function asValues(value) {
  return Array.isArray(value) ? value : [value];
}

function validateRemoteMedia(parameter, value, files) {
  const mediaParameter = /(?:image|mask|media|file|url)/iu.test(parameter.name);
  const documentsUrl = /URL/iu.test(`${parameter.range ?? ""} ${parameter.description ?? ""}`);
  if (!mediaParameter || !documentsUrl) return;
  for (const item of asValues(value)) {
    if (typeof item !== "string") continue;
    if (/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/iu.test(item)) {
      continue;
    }
    let url;
    try {
      url = new URL(item);
    } catch {
      if (fileSatisfies(parameter, files)) continue;
      throw new Error(`${parameter.name} requires a public HTTPS URL, data URL, or matching multipart file`);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password
    ) {
      throw new Error(`${parameter.name} requires a public HTTPS URL or data URL`);
    }
  }
}

function uniqueMatches(value, expression) {
  return [...new Set([...value.matchAll(expression)].map((match) => match[0]))];
}

function simpleList(range) {
  const parts = range.split(/[,、，]/u).map((item) => item.trim());
  return parts.length > 1 &&
    parts.every((item) => /^[A-Za-z0-9_.:/-]+$/u.test(item))
    ? parts
    : null;
}

function productionConstraint(parameter) {
  const range = typeof parameter.range === "string" ? parameter.range.trim() : "";
  if (parameter.name === "model") {
    return { kind: "fixed", values: [String(parameter.defaultValue)] };
  }
  if (range === "非空文本" || range.toLowerCase() === "non-empty text") {
    return { kind: "nonempty" };
  }
  if (/URL/iu.test(range)) return { kind: "media" };
  if (parameter.type === "integer" && range === "整数") {
    return { kind: "integer" };
  }
  if (parameter.type === "boolean") {
    const booleans = uniqueMatches(range, /(?:true|false)/giu).map(
      (value) => value.toLowerCase() === "true",
    );
    if (booleans.length > 0) return { kind: "boolean", values: booleans };
  }
  if (parameter.name === "aspect_ratio") {
    const ratios = uniqueMatches(range, /\d+:\d+/gu);
    if (ratios.length > 0) return { kind: "enum", values: ratios };
  }
  if (parameter.name === "size") {
    const resolutions = uniqueMatches(range, /\d+x\d+/giu);
    const tiers = uniqueMatches(range, /(?:512|\d+K)/giu);
    if (range.includes(":") && range.includes("=") && resolutions.length > 0) {
      return { kind: "enum", values: resolutions };
    }
    if (/或/u.test(range) && /像素尺寸/u.test(range) && tiers.length > 0) {
      return { kind: "resolution", values: tiers };
    }
    const listed = simpleList(range);
    if (listed) return { kind: "enum", values: listed };
  }
  if (parameter.type === "number" || parameter.type === "integer") {
    const bounded = range.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/u);
    if (bounded) {
      return {
        kind: parameter.name === "n" ? "count" : "number",
        min: Number(bounded[1]),
        max: Number(bounded[2]),
      };
    }
    const maximum = range.match(/最多\s*(\d+(?:\.\d+)?)/u);
    if (maximum) {
      return {
        kind: parameter.name === "n" ? "count" : "number",
        min: parameter.name === "n" ? 1 : undefined,
        max: Number(maximum[1]),
      };
    }
    const fixed = range.match(/保持\s*(\d+(?:\.\d+)?)/u);
    if (fixed) return { kind: "fixed", values: [fixed[1]] };
  }
  const listed = simpleList(range);
  if (listed) return { kind: "enum", values: listed };
  if (/^[A-Za-z0-9_.:/-]+$/u.test(range) && range.length > 0) {
    return { kind: "fixed", values: [range] };
  }
  return null;
}

function sameConstraintValue(actual, expected) {
  if (typeof actual === "boolean") return actual === expected;
  return String(actual) === String(expected);
}

function validateRange(parameter, value) {
  const range = parameter.range ?? "";
  const description = parameter.description ?? "";
  if (
    (parameter.type === "number" || parameter.type === "integer") &&
    (typeof value === "boolean" ||
      (typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && value.trim() === "") ||
      !Number.isFinite(Number(value)))
  ) {
    return;
  }
  const constraint = productionConstraint(parameter);
  if (!constraint) {
    if (
      present(parameter.defaultValue) &&
      sameConstraintValue(value, parameter.defaultValue)
    ) {
      return;
    }
    throw new Error(`Cannot interpret production range for ${parameter.name}: ${range}`);
  }
  if (constraint.kind === "nonempty") {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${parameter.name} is outside the documented range: ${range}`);
    }
  } else if (constraint.kind === "fixed" || constraint.kind === "enum" || constraint.kind === "boolean") {
    if (!constraint.values.some((expected) => sameConstraintValue(value, expected))) {
      throw new Error(`${parameter.name} is outside the documented range: ${range}`);
    }
  } else if (constraint.kind === "resolution") {
    if (
      !constraint.values.includes(String(value)) &&
      !/^\d+x\d+$/u.test(String(value))
    ) {
      throw new Error(`${parameter.name} is outside the documented range: ${range}`);
    }
  } else if (constraint.kind === "integer") {
    if (!Number.isInteger(Number(value))) {
      throw new Error(`${parameter.name} is outside the documented range: ${range}`);
    }
  } else if (constraint.kind === "number" || constraint.kind === "count") {
    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      (constraint.kind === "count" && !Number.isInteger(number)) ||
      (constraint.min !== undefined && number < constraint.min) ||
      (constraint.max !== undefined && number > constraint.max)
    ) {
      throw new Error(`${parameter.name} is outside the documented range: ${range}`);
    }
  }
  if (Array.isArray(value)) {
    const maximum = `${range} ${description}`.match(/最多\s*(\d+)\s*张/u);
    if (maximum && value.length > Number(maximum[1])) {
      throw new Error(`${parameter.name} accepts at most ${maximum[1]} reference images`);
    }
  }
}

function validateFiles(adapter, files) {
  if (!Array.isArray(files)) throw new Error("files must be an array");
  const uploadLimits = new Map();
  for (const variant of adapter.requestVariants ?? []) {
    if (variant.kind !== "multipart" || !Array.isArray(variant.fields)) continue;
    const counts = new Map();
    for (const field of variant.fields) {
      if (typeof field.value !== "string" || !field.value.startsWith("@")) continue;
      counts.set(field.name, (counts.get(field.name) ?? 0) + 1);
    }
    for (const [name, count] of counts) {
      uploadLimits.set(name, Math.max(uploadLimits.get(name) ?? 0, count));
    }
  }
  const provided = new Map();
  for (const file of files) {
    if (file?.inline === true) continue;
    const count = (provided.get(file?.field) ?? 0) + 1;
    provided.set(file?.field, count);
    const limit = uploadLimits.get(file?.field) ?? 0;
    if (limit === 0) {
      throw new Error(`Multipart field ${file?.field} is not a documented upload field`);
    }
    if (count > limit) {
      throw new Error(`Multipart field ${file.field} accepts at most ${limit} files`);
    }
  }
}

function validateValues(adapter, values, files) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("values must be an object");
  }
  const missing = missingRequired(adapter, values, files);
  if (missing.length > 0) {
    throw new Error(`Required adapter parameter is missing: ${missing[0].name}`);
  }
  for (const parameter of adapter.parameters) {
    const value = Object.hasOwn(values, parameter.name)
      ? values[parameter.name]
      : parameter.defaultValue;
    if (!present(value)) continue;
    if (parameter.name === "prompt" && (typeof value !== "string" || value.trim() === "")) {
      throw new Error("prompt must be non-empty");
    }
    if (Object.hasOwn(values, parameter.name)) validateRange(parameter, value);
    validateRemoteMedia(parameter, value, files);
  }
  validateFiles(adapter, files);
}

function strictBase64Bytes(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invalid base64 image result");
  }
  const comma = value.indexOf(",");
  const encoded = value.startsWith("data:")
    ? value.slice(comma + 1)
    : value;
  if (
    (value.startsWith("data:") &&
      (comma < 0 || !/^data:image\/[a-z0-9.+-]+;base64,/iu.test(value))) ||
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  ) {
    throw new Error("Invalid base64 image result");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) {
    throw new Error("Invalid base64 image result");
  }
  return bytes;
}

export async function persistImageResult({
  taskId,
  completed,
  output,
  downloadResult: download = downloadResult,
}) {
  const destination = resolve(output ?? `kaiyuncode-${taskId}.png`);
  if (typeof completed?.url === "string" && completed.url.length > 0) {
    const downloaded = await download({ url: completed.url, output: destination });
    return {
      taskId,
      status: completed.status,
      url: redactSensitive(downloaded.url ?? completed.url),
      path: resolve(downloaded.path),
    };
  }
  if (Object.hasOwn(completed ?? {}, "b64Json")) {
    const bytes = strictBase64Bytes(completed.b64Json);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return { taskId, status: completed.status, path: destination };
  }
  throw new Error(`Completed image task ${taskId} had no URL or base64 result`);
}

const DEFAULT_DEPENDENCIES = {
  loadCapabilities,
  loadRuntimeCatalog,
  resolveCredential,
  submitTask,
  pollTask,
  downloadResult,
};

export async function listImageModels({
  capabilityKey,
  dependencies = {},
} = {}) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const snapshot = await deps.loadCapabilities();
  const capabilities = snapshot.imageCapabilities;
  const normalizedKey = normalizedCapabilityKey(capabilityKey);
  if (normalizedKey && !capabilities.some(({ key }) => key === normalizedKey)) {
    throw new Error(`Image capability ${capabilityKey} is not available`);
  }
  const credential = await deps.resolveCredential({
    preferSource: deps.preferSource,
  });
  const runtimeCatalog = await deps.loadRuntimeCatalog({
    apiKey: credential.apiKey,
  });
  return buildCreativeCatalog({
    kind: "image",
    capabilities,
    runtimeCatalog,
    capabilityKey: normalizedKey,
  });
}

export async function runImageTask({
  capabilityKey,
  model,
  values = {},
  files = [],
  taskId,
  output,
  dryRun = false,
  dependencies = {},
}) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  if (taskId !== undefined) {
    if (typeof taskId !== "string" || taskId.trim() === "") {
      throw new Error("taskId must be a non-empty string");
    }
    if (dryRun) {
      return {
        dryRun: true,
        resume: true,
        taskId,
        ...(output !== undefined ? { output } : {}),
      };
    }
    const credential = await deps.resolveCredential({
      preferSource: deps.preferSource,
    });
    const completed = await deps.pollTask({
      taskId,
      kind: "image",
      apiKey: credential.apiKey,
    });
    const persist = deps.persistImageResult ?? persistImageResult;
    return persist({
      taskId,
      completed,
      output,
      downloadResult: deps.downloadResult,
    });
  }
  const capabilities = await deps.loadCapabilities();
  const adapter = findAdapter(
    capabilities.imageCapabilities,
    capabilityKey,
    model,
    values,
    files,
  );
  validateValues(adapter, values, files);
  const request = buildAdapterRequest(adapter, values, files);
  const credential = await deps.resolveCredential({
    preferSource: deps.preferSource,
  });
  const catalog = await deps.loadRuntimeCatalog({ apiKey: credential.apiKey });
  const priceLabel = runtimePriceForModel(catalog, model, {
    requirePrice: !dryRun,
  });
  if (dryRun) {
    return {
      dryRun: true,
      capabilityKey,
      model,
      ...(priceLabel ? { priceLabel } : {}),
      ...(catalog.checkedAt ? { catalogCheckedAt: catalog.checkedAt } : {}),
      ...(output !== undefined ? { output } : {}),
      request: request.summary,
    };
  }
  const resolvedTaskId = await deps.submitTask({ request, apiKey: credential.apiKey });
  const completed = await deps.pollTask({
    taskId: resolvedTaskId,
    kind: "image",
    apiKey: credential.apiKey,
  });
  const persist = deps.persistImageResult ?? persistImageResult;
  return persist({
    taskId: resolvedTaskId,
    completed,
    output,
    downloadResult: deps.downloadResult,
  });
}

/**
 * Run independent image jobs fully concurrently (N jobs → N concurrent tasks).
 * Failures are isolated per job and do not cancel siblings.
 */
export async function runConcurrentImageTasks(jobs, dependencies = {}) {
  const memoizedLoaders = new Map();
  return runConcurrentTasks(jobs, (job) => {
    const jobDependencies = job.dependencies ?? dependencies;
    const loader = jobDependencies.loadRuntimeCatalog ?? loadRuntimeCatalog;
    if (!memoizedLoaders.has(loader)) {
      memoizedLoaders.set(loader, memoizeRuntimeCatalogLoader(loader));
    }
    return runImageTask({
      ...job,
      dependencies: {
        ...jobDependencies,
        loadRuntimeCatalog: memoizedLoaders.get(loader),
      },
    });
  });
}

function takeCliValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseCliArguments(argv) {
  const parsed = {
    capabilityKey: undefined,
    model: undefined,
    prompt: undefined,
    params: [],
    images: [],
    mask: undefined,
    taskId: undefined,
    output: undefined,
    jobsFile: undefined,
    credentialSource: undefined,
    listModels: false,
    dryRun: false,
    json: false,
    help: false,
  };
  const scalarOptions = new Map([
    ["--capability", "capabilityKey"],
    ["--model", "model"],
    ["--prompt", "prompt"],
    ["--mask", "mask"],
    ["--task-id", "taskId"],
    ["--output", "output"],
    ["--jobs-file", "jobsFile"],
    ["--credential-source", "credentialSource"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--api-key" || option.startsWith("--api-key=")) {
      throw new Error("API keys are not accepted in command-line arguments");
    }
    if (option === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (option === "--list-models") {
      parsed.listModels = true;
      continue;
    }
    if (option === "--json") {
      parsed.json = true;
      continue;
    }
    if (option === "--help" || option === "-h") {
      parsed.help = true;
      continue;
    }
    if (option === "--param") {
      const assignment = takeCliValue(argv, index, option);
      index += 1;
      const separator = assignment.indexOf("=");
      if (separator <= 0) throw new Error("--param requires key=value");
      parsed.params.push([
        assignment.slice(0, separator),
        assignment.slice(separator + 1),
      ]);
      continue;
    }
    if (option === "--image") {
      parsed.images.push(takeCliValue(argv, index, option));
      index += 1;
      continue;
    }
    const property = scalarOptions.get(option);
    if (property) {
      if (parsed[property] !== undefined) {
        throw new Error(`${option} may only be provided once`);
      }
      parsed[property] = takeCliValue(argv, index, option);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }
  return parsed;
}

function mediaIsRemote(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|data:)/iu.test(value) &&
    !value.startsWith("file:");
}

function addParam(values, name, value) {
  if (name.endsWith("[]")) {
    if (!Object.hasOwn(values, name)) values[name] = [];
    if (!Array.isArray(values[name])) {
      throw new Error(`CLI parameter ${name} conflicts with a scalar value`);
    }
    if (Array.isArray(value)) values[name].push(...value);
    else values[name].push(value);
    return;
  }
  if (Object.hasOwn(values, name)) {
    throw new Error(`CLI parameter ${name} may only be provided once`);
  }
  values[name] = value;
}

async function localFile(path, field, readFileImpl) {
  let bytes;
  try {
    bytes = await readFileImpl(path);
  } catch {
    throw new Error(`Unable to read --${field} file ${basename(path)}`);
  }
  const extension = basename(path).split(".").at(-1)?.toLowerCase();
  const mimeTypes = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
  };
  const mimeType = mimeTypes[extension];
  if (!mimeType) {
    throw new Error(`Unsupported local image type for --${field}: ${basename(path)}`);
  }
  const data = new Blob([bytes], { type: mimeType });
  return {
    field,
    data,
    filename: basename(path),
    inline: true,
    kind: field === "mask" ? "mask" : "image",
    value: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

export async function prepareCliInput(
  parsed,
  {
    readFile: readFileImpl = readFile,
    loadCapabilities: loadCapabilitiesImpl = loadCapabilities,
  } = {},
) {
  if (parsed?.taskId !== undefined) {
    return {
      taskId: parsed.taskId,
      output: parsed.output,
      ...(parsed.dryRun ? { dryRun: true } : {}),
    };
  }
  if (!parsed?.capabilityKey) throw new Error("--capability is required");
  if (!parsed?.model) throw new Error("--model is required");
  const values = Object.create(null);
  for (const [name, value] of parsed.params ?? []) addParam(values, name, value);
  if (parsed.prompt !== undefined) addParam(values, "prompt", parsed.prompt);
  const files = [];

  if (parsed.images.length > 0) {
    const images = [];
    for (const image of parsed.images) {
      if (mediaIsRemote(image)) {
        images.push(image);
      } else {
        const file = await localFile(image, "image", readFileImpl);
        files.push(file);
        images.push(file.value);
      }
    }
    if (normalizedCapabilityKey(parsed.capabilityKey) === "image_async_multi_reference") {
      const snapshot = await loadCapabilitiesImpl();
      const adapter = selectImageAdapterForInputs(
        snapshot.imageCapabilities,
        parsed.capabilityKey,
        parsed.model,
        images,
        files,
      );
      assignImageInputs(values, images, documentedImageInputName(adapter));
    } else {
      throw new Error(`${parsed.capabilityKey} does not document --image input`);
    }
  }

  if (parsed.mask !== undefined) {
    if (mediaIsRemote(parsed.mask)) {
      addParam(values, "mask", parsed.mask);
    } else {
      const file = await localFile(parsed.mask, "mask", readFileImpl);
      files.push(file);
      addParam(values, "mask", file.value);
    }
  }

  return {
    capabilityKey: parsed.capabilityKey,
    model: parsed.model,
    values,
    files,
    taskId: parsed.taskId,
    output: parsed.output,
    dryRun: parsed.dryRun,
  };
}

const CLI_USAGE = `Usage: kaiyuncode-image --capability KEY --model MODEL [options]
   or: kaiyuncode-image --jobs-file jobs.json [--dry-run]
   or: kaiyuncode-image --list-models [--capability KEY] [--json]

Options:
  --prompt TEXT          Image prompt
  --param KEY=VALUE      Adapter parameter (repeatable)
  --image URL_OR_PATH    Image input (repeatable)
  --mask URL_OR_PATH     Edit mask
  --task-id ID           Resume an asynchronous task without POST
  --output PATH          Result path
  --jobs-file PATH       JSON array of independent jobs; all run concurrently
  --credential-source S  Prefer env|file|codex|claude for this run
  --list-models          List current compatible models and live prices (GET only)
  --dry-run              Validate and print a human confirmation card (no POST)
  --json                 Print full JSON (always includes confirmCard on dry-run)
  --help                 Show this help

Credentials: env KAIYUN_API_KEY > ~/.codex/kaiyun-tools.env (canonical).
Codex/Claude keys are fallback only when env and file are absent.
Never pass API keys via argv.
`;

function validateListModelsArguments(parsed) {
  const hasTaskArguments =
    parsed.model !== undefined ||
    parsed.prompt !== undefined ||
    parsed.mask !== undefined ||
    parsed.taskId !== undefined ||
    parsed.output !== undefined ||
    parsed.jobsFile !== undefined ||
    parsed.dryRun ||
    parsed.params.length > 0 ||
    parsed.images.length > 0;
  if (hasTaskArguments) {
    throw new Error(
      "--list-models only accepts --capability, --credential-source, and --json",
    );
  }
}

export async function loadJobsFile(path, { readFile: readFileImpl = readFile } = {}) {
  let raw;
  try {
    raw = await readFileImpl(path, "utf8");
  } catch {
    throw new Error(`Unable to read jobs file ${basename(path)}`);
  }
  let jobs;
  try {
    jobs = JSON.parse(raw);
  } catch {
    throw new Error("jobs file must contain valid JSON");
  }
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("jobs file must be a non-empty JSON array");
  }
  return jobs;
}

export async function prepareJobSpec(spec, options = {}) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("each job must be an object");
  }
  const dryRun = Boolean(options.forceDryRun || spec.dryRun);
  const taskId = spec.taskId ?? spec.task_id;
  if (taskId !== undefined) {
    return { taskId, output: spec.output, dryRun };
  }
  if (spec.values && typeof spec.values === "object" && !Array.isArray(spec.values)) {
    if (!(spec.capabilityKey ?? spec.capability)) {
      throw new Error("each job requires capability or capabilityKey");
    }
    if (!spec.model) throw new Error("each job requires model");
    return {
      capabilityKey: spec.capabilityKey ?? spec.capability,
      model: spec.model,
      values: spec.values,
      files: Array.isArray(spec.files) ? spec.files : [],
      output: spec.output,
      dryRun,
    };
  }
  const params = Object.entries(spec.params ?? {}).map(([key, value]) => [
    key,
    String(value),
  ]);
  const input = await prepareCliInput(
    {
      capabilityKey: spec.capabilityKey ?? spec.capability,
      model: spec.model,
      prompt: spec.prompt,
      params,
      images: spec.images ?? [],
      mask: spec.mask,
      taskId: undefined,
      output: spec.output,
      dryRun,
    },
    options,
  );
  return { ...input, dryRun };
}

export async function executeCli(argv, dependencies = {}) {
  const parsed = parseCliArguments(argv);
  if (parsed.help) return { help: CLI_USAGE, json: parsed.json };
  const preferSource = parsed.credentialSource;
  if (preferSource !== undefined) {
    dependencies = { ...dependencies, preferSource };
  }
  if (parsed.listModels) {
    validateListModelsArguments(parsed);
    const catalog = await listImageModels({
      capabilityKey: parsed.capabilityKey,
      dependencies,
    });
    return { ...catalog, json: parsed.json };
  }
  if (parsed.jobsFile) {
    const specs = await loadJobsFile(parsed.jobsFile, dependencies);
    const jobs = await Promise.all(
      specs.map((spec) =>
        prepareJobSpec(spec, { ...dependencies, forceDryRun: parsed.dryRun }),
      ),
    );
    const results = await runConcurrentImageTasks(jobs, dependencies);
    const payload = withConfirmCard(
      { concurrent: true, count: results.length, results },
      { kind: "image" },
    );
    return { ...payload, json: parsed.json };
  }
  const input = await prepareCliInput(parsed, dependencies);
  const result = await runImageTask({ ...input, dependencies });
  const payload = withConfirmCard(result, { kind: "image" });
  return { ...payload, json: parsed.json };
}


export function formatCliResult(result) {
  if (result.help) {
    return result.help;
  }
  const { json, ...payload } = result;
  if (payload.dryRun && payload.confirmCard && !json) {
    return `${payload.confirmCard}\n`;
  }
  if (payload.catalog && !json) {
    return `${formatCreativeCatalog(payload)}\n`;
  }
  return `${JSON.stringify(redactSensitive(payload), null, 2)}\n`;
}

function writeCliResult(result) {
  process.stdout.write(formatCliResult(result));
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await executeCli(process.argv.slice(2));
    writeCliResult(result);
  } catch (error) {
    process.stderr.write(`${String(redactSensitive(error?.message ?? error))}\n`);
    process.exitCode = 1;
  }
}
