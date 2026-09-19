import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";

export const PRODUCTION_TUTORIAL_URL =
  "https://kaiyuncode.com/api/api-tutorial-page";
export const PUBLIC_MODEL_OPTIONS_URL =
  "https://kaiyuncode.com/api/chat/public-model-options";

const DEFAULT_BUNDLED_PATH = fileURLToPath(
  new URL("../../references/production-capabilities.json", import.meta.url),
);
const DEFAULT_CACHE_PATH = join(
  homedir(),
  ".cache",
  "kaiyuntool",
  "production-capabilities.json",
);
const RETIRED_MODELS = new Set(["gpt-image-2-max"]);
const ALLOWED_ENDPOINTS = new Set([
  "/v1/images/async/generations",
  "/v1/images/async/edits",
  "/v1/videos",
]);

function clone(value) {
  return structuredClone(value);
}

function unsupportedRequest(capabilityKey, model) {
  return new Error(
    `Unsupported production tutorial request structure for ${capabilityKey}/${model}`,
  );
}

function parseShellWords(command) {
  const words = [];
  let current = "";
  let started = false;
  let quote = null;

  const finishWord = () => {
    if (!started) return;
    words.push(current);
    current = "";
    started = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote === "'") {
      if (character === "'") quote = null;
      else current += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === "\\") {
        const next = command[index + 1];
        if (next === undefined) throw new Error("Trailing shell escape");
        index += 1;
        if (next === "\n") continue;
        if (['"', "\\", "$", "`"].includes(next)) current += next;
        else current += `\\${next}`;
      } else {
        current += character;
      }
      continue;
    }

    if (/\s/.test(character)) {
      finishWord();
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (character === "\\") {
      const next = command[index + 1];
      if (next === undefined) throw new Error("Trailing shell escape");
      index += 1;
      if (next !== "\n") {
        current += next;
        started = true;
      }
    } else {
      current += character;
      started = true;
    }
  }
  if (quote !== null) throw new Error("Unterminated shell quote");
  finishWord();
  return words;
}

function parseDocumentedUrl(value) {
  if (value.startsWith("{{baseUrl}}")) {
    const path = value.slice("{{baseUrl}}".length);
    return path.startsWith("/") && !path.includes("?") && !path.includes("#")
      ? path
      : null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "kaiyuncode.com" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.pathname;
  } catch {
    return null;
  }
}

function optionValue(words, index, longName, shortName) {
  const word = words[index];
  if (word === longName || word === shortName) {
    return { value: words[index + 1], consumed: 2 };
  }
  if (word.startsWith(`${longName}=`)) {
    return { value: word.slice(longName.length + 1), consumed: 1 };
  }
  if (word.startsWith(shortName) && word.length > shortName.length) {
    return { value: word.slice(shortName.length), consumed: 1 };
  }
  return null;
}

function parseCurlCommand(code) {
  let words;
  try {
    words = parseShellWords(code);
  } catch {
    return null;
  }
  if (words[0] !== "curl") return null;

  const urlCandidates = words
    .slice(1)
    .map((value, index) => ({
      value,
      index: index + 1,
      path: parseDocumentedUrl(value),
    }))
    .filter((item) => item.path !== null);
  if (urlCandidates.length !== 1) return null;
  const [documentedUrl] = urlCandidates;
  const explicitMethods = [];
  const dataBodies = [];
  const formFields = [];

  for (let index = 1; index < words.length; ) {
    if (index === documentedUrl.index) {
      index += 1;
      continue;
    }
    const method = optionValue(words, index, "--request", "-X");
    const header = optionValue(words, index, "--header", "-H");
    const data =
      optionValue(words, index, "--data-raw", "-d") ??
      optionValue(words, index, "--data", "-d");
    const form = optionValue(words, index, "--form", "-F");
    const parsedOption = method ?? header ?? data ?? form;
    if (!parsedOption || parsedOption.value === undefined) return null;
    if (method) explicitMethods.push(method.value.toUpperCase());
    else if (data) dataBodies.push(data.value);
    else if (form) formFields.push(form.value);
    index += parsedOption.consumed;
  }

  if (
    explicitMethods.length > 1 ||
    (dataBodies.length > 0 && formFields.length > 0)
  ) {
    return null;
  }
  const method =
    explicitMethods[0] ??
    (dataBodies.length > 0 || formFields.length > 0 ? "POST" : "GET");
  return { method, path: documentedUrl.path, dataBodies, formFields };
}

function parseJsonVariant(command, model) {
  if (command.dataBodies.length !== 1 || command.formFields.length !== 0) {
    return null;
  }
  try {
    const template = JSON.parse(command.dataBodies[0]);
    if (
      !template ||
      typeof template !== "object" ||
      Array.isArray(template) ||
      template.model !== model
    ) {
      return null;
    }
    return {
      method: command.method,
      path: command.path,
      kind: "json",
      template,
    };
  } catch {
    return null;
  }
}

function parseMultipartVariant(command, model) {
  const rawFields = command.formFields;
  if (rawFields.length === 0 || command.dataBodies.length !== 0) return null;
  const fields = rawFields.map((field) => {
    const separator = field.indexOf("=");
    if (separator <= 0) return null;
    return {
      name: field.slice(0, separator),
      value: field.slice(separator + 1),
    };
  });
  if (fields.some((field) => field === null)) return null;
  const requestModels = fields.filter((field) => field.name === "model");
  if (requestModels.length !== 1 || requestModels[0].value !== model) {
    return null;
  }
  return {
    method: command.method,
    path: command.path,
    kind: "multipart",
    fields,
  };
}

function parseRequestVariant(code, allowedPaths, model) {
  const command = parseCurlCommand(code);
  if (
    !command ||
    command.method !== "POST" ||
    !allowedPaths.has(command.path)
  ) {
    return null;
  }
  return (
    parseJsonVariant(command, model) ??
    parseMultipartVariant(command, model)
  );
}

function pollPathFor(category) {
  return category === "image"
    ? "/v1/images/async/{task_id}"
    : "/v1/videos/{task_id}";
}

function normalizeAdapter(item, step, publicModelKeys) {
  const hasParameters =
    step !== null &&
    typeof step === "object" &&
    Object.hasOwn(step, "parameters");
  const claimsCurl =
    Array.isArray(step?.codeBlocks) &&
    step.codeBlocks.some(
      (block) =>
        typeof block?.label === "string" &&
        block.label.toLowerCase().startsWith("curl"),
    );
  // Tutorial flow and polling steps can have parameter metadata but no submit request.
  if (!claimsCurl) return null;

  const parameters = step?.parameters;
  if (
    !claimsCurl &&
    Array.isArray(parameters) &&
    parameters.length > 0 &&
    parameters.every((parameter) => parameter?.location === "response")
  ) {
    return null;
  }
  if (
    !Array.isArray(parameters) ||
    parameters.length === 0 ||
    parameters.some(
      (parameter) =>
        !parameter ||
        typeof parameter !== "object" ||
        typeof parameter.name !== "string" ||
        parameter.name.length === 0,
    )
  ) {
    throw new Error(
      `Invalid production tutorial adapter for ${item.key}: parameters`,
    );
  }
  const modelParameters = parameters.filter(
    (parameter) => parameter.name === "model",
  );
  const model = modelParameters[0]?.defaultValue;
  if (
    modelParameters.length !== 1 ||
    typeof model !== "string" ||
    model.length === 0
  ) {
    throw new Error(
      `Invalid production tutorial adapter for ${item.key}: model`,
    );
  }
  if (!publicModelKeys.has(model) || RETIRED_MODELS.has(model)) return null;

  const categoryEndpoints =
    item.category === "image"
      ? new Set([
          "/v1/images/async/generations",
          "/v1/images/async/edits",
        ])
      : new Set(["/v1/videos"]);
  if (
    !ALLOWED_ENDPOINTS.has(item.endpointPath) ||
    !categoryEndpoints.has(item.endpointPath)
  ) {
    throw unsupportedRequest(item.key, model);
  }

  const curlBlocks = Array.isArray(step.codeBlocks)
    ? step.codeBlocks.filter(
        (block) =>
          typeof block?.label === "string" &&
          block.label.toLowerCase().startsWith("curl"),
      )
    : [];
  const requestVariants = curlBlocks
    .map((block) =>
      typeof block.code === "string"
        ? parseRequestVariant(block.code, categoryEndpoints, model)
        : null,
    );
  if (
    requestVariants.length === 0 ||
    requestVariants.some((variant) => variant === null)
  ) {
    throw unsupportedRequest(item.key, model);
  }

  return {
    capabilityKey: item.key,
    model,
    title: step.title ?? model,
    parameters: clone(parameters),
    requestVariants,
    pollPath: pollPathFor(item.category),
  };
}

function normalizeCapability(item, publicModelKeys) {
  if (!Array.isArray(item.steps)) {
    throw new Error(
      `Invalid production tutorial: ${item.key}.steps must be an array`,
    );
  }
  return {
    key: item.key,
    name: item.name ?? item.key,
    description: item.description ?? "",
    endpointPath: item.endpointPath,
    adapters: item.steps
      .map((step) =>
        normalizeAdapter(item, step, publicModelKeys),
      )
      .filter(Boolean),
  };
}

export function normalizeProductionTutorial(
  tutorialPage,
  publicOptions,
) {
  const items = tutorialPage?.config?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      "Invalid production tutorial: config.items must be an array",
    );
  }
  if (!Array.isArray(publicOptions?.models)) {
    throw new Error("Invalid public model options: models must be an array");
  }
  const sourceUpdatedAt = Number(tutorialPage.updatedAt);
  const tutorialVersion = Number(tutorialPage.config.version);
  if (!Number.isFinite(sourceUpdatedAt) || !Number.isFinite(tutorialVersion)) {
    throw new Error(
      "Invalid production tutorial: updatedAt and config.version must be numbers",
    );
  }

  const publicModelKeys = new Set(
    publicOptions.models
      .filter((item) => item && typeof item.key === "string" && item.key.length > 0)
      .map((item) => item.key),
  );
  const normalizeItems = (category) =>
    items
      .filter((item) => item.category === category && item.mode === "api")
      .map((item) =>
        normalizeCapability(item, publicModelKeys),
      );

  return {
    schemaVersion: 1,
    sourceUpdatedAt,
    tutorialVersion,
    publicModelKeys: [...publicModelKeys].sort(),
    imageCapabilities: normalizeItems("image"),
    videoCapabilities: normalizeItems("video"),
  };
}

function pathValue(pathOrUrl) {
  return pathOrUrl instanceof URL ? fileURLToPath(pathOrUrl) : pathOrUrl;
}

async function writeJsonAtomically(pathOrUrl, value) {
  const target = pathValue(pathOrUrl);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
    });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { method: "GET" });
  if (!response?.ok) {
    throw new Error(
      `Failed to fetch production source ${url}: HTTP ${response?.status ?? "unknown"}`,
    );
  }
  return response.json();
}

export async function loadProductionCapabilities({
  fetchImpl = globalThis.fetch,
  bundledPath = DEFAULT_BUNDLED_PATH,
  cachePath = DEFAULT_CACHE_PATH,
  allowStale = true,
  requireCacheWrite = false,
} = {}) {
  let snapshot;
  try {
    const [tutorialPage, publicOptions] = await Promise.all([
      fetchJson(fetchImpl, PRODUCTION_TUTORIAL_URL),
      fetchJson(fetchImpl, PUBLIC_MODEL_OPTIONS_URL),
    ]);
    snapshot = normalizeProductionTutorial(tutorialPage, publicOptions);
  } catch (error) {
    if (!allowStale) throw error;
    const bundled = JSON.parse(
      await readFile(pathValue(bundledPath), "utf8"),
    );
    return { ...bundled, stale: true };
  }
  if (cachePath) {
    try {
      await writeJsonAtomically(cachePath, snapshot);
    } catch (error) {
      if (requireCacheWrite) throw error;
    }
  }
  return snapshot;
}
