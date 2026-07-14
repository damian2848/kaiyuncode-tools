export const MODELS_URL = "https://kaiyuncode.com/v1/models";
export const PRICING_URL = "https://kaiyuncode.com/api/pricing";

const DEFAULT_TIMEOUT_MS = 15_000;

function validApiKey(apiKey) {
  return (
    typeof apiKey === "string" &&
    apiKey.trim().length > 0 &&
    !/[\r\n]/u.test(apiKey)
  );
}

function endpointName(url) {
  return new URL(url).pathname;
}

async function fetchJson({
  url,
  apiKey,
  fetchImpl,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error(`Runtime catalog request timed out: GET ${endpointName(url)}`);
    }
    throw new Error(`Runtime catalog request failed: GET ${endpointName(url)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response?.ok) {
    if (url === MODELS_URL && (response?.status === 401 || response?.status === 403)) {
      throw new Error(
        "KaiyunCode authentication failed while loading GET /v1/models; check or recreate the API Key",
      );
    }
    throw new Error(
      `Runtime catalog request returned HTTP ${response?.status ?? "unknown"}: GET ${endpointName(url)}`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`Runtime catalog returned invalid JSON: GET ${endpointName(url)}`);
  }
}

function parseAvailableModels(payload) {
  if (payload?.object !== "list" || !Array.isArray(payload?.data)) {
    throw new Error("Invalid GET /v1/models response: expected object=list and data[]");
  }
  const availableModels = new Set();
  for (const item of payload.data) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      item.id.trim().length === 0
    ) {
      throw new Error("Invalid GET /v1/models response: every data item must have an id");
    }
    availableModels.add(item.id);
  }
  return availableModels;
}

function priceLabel(description) {
  const value =
    typeof description === "string"
      ? description.match(/(?:^|\r?\n)平台价：([^\r\n]+)/u)?.[1]
      : null;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 240 ||
    /[\u0000\r\n]/u.test(value)
  ) {
    return null;
  }
  return value.trim();
}

function parsePriceLabels(payload) {
  if (!Array.isArray(payload?.data)) {
    throw new Error("Invalid GET /api/pricing response: expected data[]");
  }
  const priceLabels = new Map();
  const seenModels = new Set();
  for (const item of payload.data) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.model_name !== "string" ||
      item.model_name.trim().length === 0
    ) {
      throw new Error(
        "Invalid GET /api/pricing response: every data item must have a model_name",
      );
    }
    if (seenModels.has(item.model_name)) {
      throw new Error(`Duplicate pricing model in GET /api/pricing: ${item.model_name}`);
    }
    seenModels.add(item.model_name);
    const label = priceLabel(item.description);
    if (label) priceLabels.set(item.model_name, label);
  }
  return priceLabels;
}

export async function loadRuntimeCatalog({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  if (!validApiKey(apiKey)) {
    throw new Error("Loading the runtime model catalog requires a valid API Key");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Loading the runtime model catalog requires fetch");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Runtime catalog timeout must be a positive number");
  }

  const [models, pricing] = await Promise.all([
    fetchJson({
      url: MODELS_URL,
      apiKey,
      fetchImpl,
      timeoutMs,
    }),
    fetchJson({
      url: PRICING_URL,
      fetchImpl,
      timeoutMs,
    }),
  ]);

  return {
    availableModels: parseAvailableModels(models),
    priceLabels: parsePriceLabels(pricing),
    checkedAt: new Date(now()).toISOString(),
  };
}

export function runtimePriceForModel(
  catalog,
  model,
  { requirePrice = false } = {},
) {
  if (!(catalog?.availableModels instanceof Set)) {
    throw new Error("Invalid runtime catalog: availableModels must be a Set");
  }
  if (!(catalog?.priceLabels instanceof Map)) {
    throw new Error("Invalid runtime catalog: priceLabels must be a Map");
  }
  if (!catalog.availableModels.has(model)) {
    throw new Error(
      `${model} is not currently available from GET /v1/models`,
    );
  }
  const priceLabel = catalog.priceLabels.get(model);
  if (requirePrice && !priceLabel) {
    throw new Error(
      `GET /api/pricing has no parseable price for ${model}; refusing paid POST`,
    );
  }
  return priceLabel;
}

export function memoizeRuntimeCatalogLoader(
  loadImpl = loadRuntimeCatalog,
) {
  if (typeof loadImpl !== "function") {
    throw new Error("Runtime catalog loader must be a function");
  }
  const requests = new Map();
  return (options = {}) => {
    const key = options.apiKey;
    if (!requests.has(key)) {
      requests.set(key, Promise.resolve().then(() => loadImpl(options)));
    }
    return requests.get(key);
  };
}
