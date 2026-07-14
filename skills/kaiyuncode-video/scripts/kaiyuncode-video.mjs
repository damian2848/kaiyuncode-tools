#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildAdapterRequest } from "../../../shared/adapter-request.mjs";
import { withConfirmCard } from "../../../shared/confirm-card.mjs";
import { runConcurrentTasks } from "../../../shared/concurrent-tasks.mjs";
import { resolveCredential } from "../../../shared/credentials.mjs";
import {
  downloadResult,
  pollTask,
  submitTask,
} from "../../../shared/http-client.mjs";
import { redactSensitive } from "../../../shared/redaction.mjs";
import {
  loadRuntimeCatalog,
  memoizeRuntimeCatalogLoader,
  runtimePriceForModel,
} from "../../../shared/runtime-catalog.mjs";

const RETIRED_MODELS = new Set(["gpt-image-2-max"]);
const CAPABILITIES_URL = new URL(
  "../../../references/production-capabilities.json",
  import.meta.url,
);

async function loadCapabilities() {
  return JSON.parse(await readFile(CAPABILITIES_URL, "utf8"));
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
    const value = Object.hasOwn(values, parameter.name)
      ? values[parameter.name]
      : parameter.defaultValue;
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

function findAdapter(videoCapabilities, capabilityKey, model, values, files) {
  if (RETIRED_MODELS.has(model)) {
    throw new Error(`${model} is not available in the production model catalog`);
  }
  const capability = videoCapabilities.find(({ key }) => key === capabilityKey);
  if (!capability) {
    throw new Error(`Video capability ${capabilityKey} is not available`);
  }
  const matches = capability.adapters.filter(
    (candidate) => candidate.model === model && !RETIRED_MODELS.has(candidate.model),
  );
  if (matches.length === 0) {
    throw new Error(`Video model ${model} is not available for ${capabilityKey}`);
  }
  if (matches.length === 1) return matches[0];

  const compatible = matches.filter((adapter) =>
    candidateAccepts(adapter, values, files),
  );
  if (compatible.length === 1) return compatible[0];
  if (compatible.length === 0) {
    const allNames = new Set(
      matches.flatMap((adapter) => adapter.parameters.map(({ name }) => name)),
    );
    const unknown = Object.keys(values).find((name) => !allNames.has(name));
    if (unknown) throw new Error(`Unknown adapter parameter: ${unknown}`);
    const missing = matches.flatMap((adapter) =>
      missingRequired(adapter, values, files),
    );
    if (missing.length > 0) {
      throw new Error(`Required adapter parameter is missing: ${missing[0].name}`);
    }
    throw new Error(
      `No documented adapter profile matches ${capabilityKey} and ${model}`,
    );
  }
  throw new Error(`Adapter profile is ambiguous for ${capabilityKey} and ${model}`);
}

function asValues(value) {
  return Array.isArray(value) ? value : [value];
}

function isPublicHttpsOrDataUrl(item) {
  if (typeof item !== "string") return false;
  if (/^data:(?:image|video|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/iu.test(item)) {
    return true;
  }
  try {
    const url = new URL(item);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateRemoteMedia(parameter, value, files) {
  if (
    parameter.type === "boolean" ||
    parameter.type === "number" ||
    parameter.type === "integer"
  ) {
    return;
  }
  const text = `${parameter.range ?? ""} ${parameter.description ?? ""} ${parameter.type ?? ""}`;
  const documentsUrl = /URL|公网/iu.test(text);
  const objectMedia =
    parameter.type === "object[]" ||
    /^Array<\{/u.test(parameter.type ?? "") ||
    /media\[\]$/u.test(parameter.name);
  const scalarMediaName =
    /(?:^|[.])(?:image|image_url|images\[\]|input_video|video_url|mask|reference_image_urls\[\]|extra_images\[\]|extra_videos\[\]|extra_audios\[\]|audio_urls\[\]|image_urls\[\])$/iu.test(
      parameter.name,
    );
  if (!documentsUrl && !objectMedia && !scalarMediaName) return;

  if (parameter.type === "object[]" || /^Array<\{/u.test(parameter.type ?? "")) {
    for (const item of asValues(value)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      for (const [key, child] of Object.entries(item)) {
        if (typeof child !== "string") continue;
        if (!/(?:url|image|video|audio|voice|file)/iu.test(key)) continue;
        if (isPublicHttpsOrDataUrl(child)) continue;
        if (fileSatisfies(parameter, files)) continue;
        throw new Error(
          `${parameter.name}.${key} requires a public HTTPS URL, data URL, or matching multipart file`,
        );
      }
    }
    return;
  }

  for (const item of asValues(value)) {
    if (typeof item !== "string") continue;
    if (isPublicHttpsOrDataUrl(item)) continue;
    if (fileSatisfies(parameter, files)) continue;
    let url;
    try {
      url = new URL(item);
    } catch {
      throw new Error(
        `${parameter.name} requires a public HTTPS URL, data URL, or matching multipart file`,
      );
    }
    if (url.protocol !== "https:" || url.username || url.password) {
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
  if (
    parameter.type === "object[]" ||
    /^Array<\{/u.test(parameter.type ?? "") ||
    /^Array<\{/u.test(range) ||
    range.startsWith("{ role:") ||
    /first_frame|last_frame|refer|reference_/iu.test(range)
  ) {
    return { kind: "object-array" };
  }
  if (/URL|公网/iu.test(range)) return { kind: "media" };
  if (parameter.type === "integer" && range === "整数") {
    return { kind: "integer" };
  }
  if (range === "单位秒" || range === "随机种子") {
    return { kind: "number" };
  }
  if (parameter.type === "boolean") {
    const booleans = uniqueMatches(range, /(?:true|false)/giu).map(
      (value) => value.toLowerCase() === "true",
    );
    if (booleans.length > 0) return { kind: "boolean", values: booleans };
  }
  if (parameter.name === "aspect_ratio" || /ratio$/iu.test(parameter.name)) {
    const ratios = uniqueMatches(range, /(?:\d+:\d+|auto)/gu);
    if (ratios.length > 0) return { kind: "enum", values: ratios };
  }
  if (parameter.name === "size") {
    const resolutions = uniqueMatches(range, /\d+x\d+/giu);
    if (resolutions.length > 0) return { kind: "enum", values: resolutions };
  }
  if (parameter.type === "number" || parameter.type === "integer") {
    const bounded = range.match(
      /(\d+(?:\.\d+)?)\s*(?:-|~|～)\s*(\d+(?:\.\d+)?)/u,
    );
    if (bounded) {
      return {
        kind: "number",
        min: Number(bounded[1]),
        max: Number(bounded[2]),
      };
    }
    const maximum = range.match(/最多\s*(\d+(?:\.\d+)?)/u);
    if (maximum) {
      return {
        kind: "number",
        min: undefined,
        max: Number(maximum[1]),
      };
    }
    const listed = simpleList(range);
    if (listed && listed.every((item) => /^-?\d+(?:\.\d+)?$/u.test(item))) {
      return { kind: "enum", values: listed.map(Number) };
    }
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
  if (typeof expected === "number" || typeof actual === "number") {
    return Number(actual) === Number(expected);
  }
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
    throw new Error(
      `Cannot interpret production range for ${parameter.name}: ${range}`,
    );
  }
  if (constraint.kind === "nonempty") {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(
        `${parameter.name} is outside the documented range: ${range}`,
      );
    }
  } else if (constraint.kind === "media") {
    // Remote URL shape is enforced by validateRemoteMedia.
  } else if (constraint.kind === "object-array") {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((item) => !item || typeof item !== "object" || Array.isArray(item))
    ) {
      throw new Error(
        `${parameter.name} must be a non-empty array of objects`,
      );
    }
  } else if (
    constraint.kind === "fixed" ||
    constraint.kind === "enum" ||
    constraint.kind === "boolean"
  ) {
    if (!constraint.values.some((expected) => sameConstraintValue(value, expected))) {
      throw new Error(
        `${parameter.name} is outside the documented range: ${range}`,
      );
    }
  } else if (constraint.kind === "integer") {
    if (!Number.isInteger(Number(value))) {
      throw new Error(
        `${parameter.name} is outside the documented range: ${range}`,
      );
    }
  } else if (constraint.kind === "number" || constraint.kind === "count") {
    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      (constraint.kind === "count" && !Number.isInteger(number)) ||
      (constraint.min !== undefined && number < constraint.min) ||
      (constraint.max !== undefined && number > constraint.max)
    ) {
      throw new Error(
        `${parameter.name} is outside the documented range: ${range}`,
      );
    }
  }
  if (Array.isArray(value)) {
    const maximum = `${range} ${description}`.match(/最多\s*(\d+)\s*(?:张|个)?/u);
    if (maximum && value.length > Number(maximum[1])) {
      throw new Error(
        `${parameter.name} accepts at most ${maximum[1]} items`,
      );
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
    const count = (provided.get(file?.field) ?? 0) + 1;
    provided.set(file?.field, count);
    const limit = uploadLimits.get(file?.field) ?? 0;
    if (limit === 0) {
      throw new Error(
        `Multipart field ${file?.field} is not a documented upload field`,
      );
    }
    if (count > limit) {
      throw new Error(
        `Multipart field ${file.field} accepts at most ${limit} files`,
      );
    }
  }
}

function isPromptParameter(name) {
  return name === "prompt" || name === "input.prompt";
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
    if (
      isPromptParameter(parameter.name) &&
      (typeof value !== "string" || value.trim() === "")
    ) {
      throw new Error("prompt must be non-empty");
    }
    if (Object.hasOwn(values, parameter.name)) validateRange(parameter, value);
    validateRemoteMedia(parameter, value, files);
  }
  validateFiles(adapter, files);
}

function remappedValues(adapter, values) {
  const next = { ...values };
  const names = new Set(adapter.parameters.map(({ name }) => name));
  if (
    Object.hasOwn(next, "prompt") &&
    !names.has("prompt") &&
    names.has("input.prompt")
  ) {
    next["input.prompt"] = next.prompt;
    delete next.prompt;
  }
  return next;
}

export async function persistVideoResult({
  taskId,
  completed,
  output,
  downloadResult: download = downloadResult,
}) {
  const destination = resolve(output ?? `kaiyuncode-${taskId}.mp4`);
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
    const encoded = completed.b64Json;
    if (typeof encoded !== "string" || encoded.length === 0) {
      throw new Error("Invalid base64 video result");
    }
    const bytes = Buffer.from(encoded, "base64");
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
  throw new Error(`Completed video task ${taskId} had no URL or base64 result`);
}

const DEFAULT_DEPENDENCIES = {
  loadCapabilities,
  loadRuntimeCatalog,
  resolveCredential,
  submitTask,
  pollTask,
  downloadResult,
};

export async function runVideoTask({
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
      kind: "video",
      apiKey: credential.apiKey,
    });
    const persist = deps.persistVideoResult ?? persistVideoResult;
    return persist({
      taskId,
      completed,
      output,
      downloadResult: deps.downloadResult,
    });
  }
  const capabilities = await deps.loadCapabilities();
  const provisional = values;
  const adapter = findAdapter(
    capabilities.videoCapabilities,
    capabilityKey,
    model,
    provisional,
    files,
  );
  const resolvedValues = remappedValues(adapter, provisional);
  validateValues(adapter, resolvedValues, files);
  const request = buildAdapterRequest(adapter, resolvedValues, files);
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
  const resolvedTaskId = await deps.submitTask({
    request,
    apiKey: credential.apiKey,
  });
  const completed = await deps.pollTask({
    taskId: resolvedTaskId,
    kind: "video",
    apiKey: credential.apiKey,
  });
  const persist = deps.persistVideoResult ?? persistVideoResult;
  return persist({
    taskId: resolvedTaskId,
    completed,
    output,
    downloadResult: deps.downloadResult,
  });
}

/**
 * Run independent video jobs fully concurrently (N jobs → N concurrent tasks).
 * Failures are isolated per job and do not cancel siblings.
 */
export async function runConcurrentVideoTasks(jobs, dependencies = {}) {
  const memoizedLoaders = new Map();
  return runConcurrentTasks(jobs, (job) => {
    const jobDependencies = job.dependencies ?? dependencies;
    const loader = jobDependencies.loadRuntimeCatalog ?? loadRuntimeCatalog;
    if (!memoizedLoaders.has(loader)) {
      memoizedLoaders.set(loader, memoizeRuntimeCatalogLoader(loader));
    }
    return runVideoTask({
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
    audios: [],
    videos: [],
    taskId: undefined,
    output: undefined,
    jobsFile: undefined,
    credentialSource: undefined,
    dryRun: false,
    json: false,
    help: false,
  };
  const scalarOptions = new Map([
    ["--capability", "capabilityKey"],
    ["--model", "model"],
    ["--prompt", "prompt"],
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
    if (option === "--audio") {
      parsed.audios.push(takeCliValue(argv, index, option));
      index += 1;
      continue;
    }
    if (option === "--video") {
      parsed.videos.push(takeCliValue(argv, index, option));
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
  return /^(?:[a-z][a-z0-9+.-]*:|data:)/iu.test(value) && !value.startsWith("file:");
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
  return {
    field,
    data: new Blob([bytes]),
    filename: basename(path),
  };
}

function parameterNames(adapter) {
  return new Set(adapter.parameters.map(({ name }) => name));
}

function chooseArrayField(names, candidates) {
  return candidates.find((name) => names.has(name));
}

function applyRemoteImages(capabilityKey, names, values, images) {
  if (images.length === 0) return;
  if (names.has("image_url") && images.length === 1 && !names.has("images[]")) {
    addParam(values, "image_url", images[0]);
    return;
  }
  if (names.has("image") && images.length === 1 && !names.has("images[]")) {
    addParam(values, "image", images[0]);
    return;
  }
  const arrayField = chooseArrayField(names, [
    "reference_image_urls[]",
    "images[]",
    "extra_images[]",
    "image_urls[]",
  ]);
  if (arrayField) {
    addParam(values, arrayField, images);
    return;
  }
  if (names.has("input.media[]")) {
    const type =
      capabilityKey === "video_capability_video_reference_generation" ||
      capabilityKey === "video_capability_video_multimodal_to_video"
        ? "reference_image"
        : "first_frame";
    addParam(
      values,
      "input.media[]",
      images.map((url) => ({ type, url })),
    );
    return;
  }
  if (names.has("image_url") && images.length > 1 && names.has("extra_images[]")) {
    addParam(values, "image_url", images[0]);
    addParam(values, "extra_images[]", images.slice(1));
    return;
  }
  throw new Error(`${capabilityKey} does not document --image input`);
}

function applyRemoteAudios(names, values, audios) {
  if (audios.length === 0) return;
  const field = chooseArrayField(names, ["extra_audios[]", "audio_urls[]"]);
  if (!field) throw new Error("Selected adapter does not document --audio input");
  addParam(values, field, audios);
}

function applyRemoteVideos(capabilityKey, names, values, videos) {
  if (videos.length === 0) return;
  if (names.has("video_url") && videos.length === 1) {
    addParam(values, "video_url", videos[0]);
    return;
  }
  if (names.has("input_video") && videos.length === 1) {
    addParam(values, "input_video", videos[0]);
    return;
  }
  if (names.has("metadata.video") && videos.length === 1) {
    addParam(values, "metadata.video", videos[0]);
    return;
  }
  if (names.has("extra_videos[]")) {
    addParam(values, "extra_videos[]", videos);
    return;
  }
  if (names.has("input.media[]")) {
    const existing = Array.isArray(values["input.media[]"])
      ? values["input.media[]"]
      : [];
    const type =
      capabilityKey === "video_capability_video_continuation"
        ? "first_clip"
        : capabilityKey === "video_capability_video_recreate"
          ? "video"
          : "reference_video";
    values["input.media[]"] = [
      ...existing,
      ...videos.map((url) => ({ type, url })),
    ];
    return;
  }
  throw new Error("Selected adapter does not document --video input");
}

async function loadAdapterForCli(capabilityKey, model) {
  const capabilities = await loadCapabilities();
  const capability = capabilities.videoCapabilities.find(
    ({ key }) => key === capabilityKey,
  );
  if (!capability) {
    throw new Error(`Video capability ${capabilityKey} is not available`);
  }
  const adapter = capability.adapters.find((item) => item.model === model);
  if (!adapter) {
    throw new Error(`Video model ${model} is not available for ${capabilityKey}`);
  }
  return adapter;
}

export async function prepareCliInput(
  parsed,
  { readFile: readFileImpl = readFile } = {},
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
  const remoteImages = [];
  const remoteAudios = [];
  const remoteVideos = [];

  for (const image of parsed.images ?? []) {
    if (mediaIsRemote(image)) remoteImages.push(image);
    else files.push(await localFile(image, "image", readFileImpl));
  }
  for (const audio of parsed.audios ?? []) {
    if (mediaIsRemote(audio)) remoteAudios.push(audio);
    else files.push(await localFile(audio, "audio", readFileImpl));
  }
  for (const video of parsed.videos ?? []) {
    if (mediaIsRemote(video)) remoteVideos.push(video);
    else files.push(await localFile(video, "video", readFileImpl));
  }

  if (
    remoteImages.length > 0 ||
    remoteAudios.length > 0 ||
    remoteVideos.length > 0 ||
    files.some(({ field }) => field === "image")
  ) {
    const adapter = await loadAdapterForCli(parsed.capabilityKey, parsed.model);
    const names = parameterNames(adapter);
    applyRemoteImages(parsed.capabilityKey, names, values, remoteImages);
    applyRemoteAudios(names, values, remoteAudios);
    applyRemoteVideos(parsed.capabilityKey, names, values, remoteVideos);
    if (files.some(({ field }) => field === "image") && names.has("image")) {
      if (!Object.hasOwn(values, "image")) {
        values.image = parsed.images.find((item) => !mediaIsRemote(item));
      }
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

const CLI_USAGE = `Usage: kaiyuncode-video --capability KEY --model MODEL [options]
   or: kaiyuncode-video --jobs-file jobs.json [--dry-run]

Options:
  --prompt TEXT          Video prompt (maps to prompt or input.prompt)
  --param KEY=VALUE      Adapter parameter (repeatable; supports dotted keys)
  --image URL_OR_PATH    Image input (repeatable)
  --audio URL_OR_PATH    Audio input (repeatable)
  --video URL_OR_PATH    Video input (repeatable)
  --task-id ID           Resume an asynchronous task without POST
  --output PATH          Result path
  --jobs-file PATH       JSON array of independent jobs; all run concurrently
  --credential-source S  Prefer env|file|codex|claude for this run
  --dry-run              Validate and print a human confirmation card (no POST)
  --json                 Print full JSON (always includes confirmCard on dry-run)
  --help                 Show this help

Credentials: env KAIYUN_API_KEY > ~/.codex/kaiyun-tools.env (canonical).
Codex/Claude keys are fallback only when env and file are absent.
Never pass API keys via argv.
`;

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
      audios: spec.audios ?? [],
      videos: spec.videos ?? [],
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
  if (parsed.jobsFile) {
    const specs = await loadJobsFile(parsed.jobsFile, dependencies);
    const jobs = await Promise.all(
      specs.map((spec) =>
        prepareJobSpec(spec, { ...dependencies, forceDryRun: parsed.dryRun }),
      ),
    );
    const results = await runConcurrentVideoTasks(jobs, dependencies);
    const payload = withConfirmCard(
      { concurrent: true, count: results.length, results },
      { kind: "video" },
    );
    return { ...payload, json: parsed.json };
  }
  const input = await prepareCliInput(parsed, dependencies);
  const result = await runVideoTask({ ...input, dependencies });
  const payload = withConfirmCard(result, { kind: "video" });
  return { ...payload, json: parsed.json };
}

function isMainModule() {
  return (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

export function formatCliResult(result) {
  if (result.help) {
    return result.help;
  }
  const { json, ...payload } = result;
  if (payload.dryRun && payload.confirmCard && !json) {
    return `${payload.confirmCard}\n`;
  }
  return `${JSON.stringify(redactSensitive(payload), null, 2)}\n`;
}

function writeCliResult(result) {
  process.stdout.write(formatCliResult(result));
}

if (isMainModule()) {
  try {
    const result = await executeCli(process.argv.slice(2));
    writeCliResult(result);
  } catch (error) {
    process.stderr.write(`${String(redactSensitive(error?.message ?? error))}\n`);
    process.exitCode = 1;
  }
}
