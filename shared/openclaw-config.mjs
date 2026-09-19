import { modelIsExplicitlyNonText } from "./codex-model-catalog.mjs";
import { TEXT_PROVIDER_ID } from "./text-provider.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function field(sources, keys) {
  for (const source of sources.filter(object)) {
    for (const key of keys) if (Object.hasOwn(source, key)) return source[key];
  }
}

const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const asThinking = (effort) => effort === "none" ? "off" : effort;

function reasoningConfig(model, api, warnings) {
  const sources = [model, model.metadata];
  const profile = field(sources, ["reasoningProfile"]);
  if (profile != null && !object(profile)) throw new Error(`Invalid reasoningProfile for ${model.id}`);
  // Native Claude effort/budget is not Responses reasoning.effort. The public
  // top-level fields describe the OpenAI-compatible wire API, including [].
  const native = api === "anthropic-messages" && profile?.kind?.startsWith("claude-");
  const explicitLevels = field(sources, ["supported_reasoning_levels", "supported_reasoning_efforts", "reasoning_efforts"]);
  const raw = native ? profile.levels : explicitLevels !== undefined ? explicitLevels
    : (["standard", "gemini-thinking"].includes(profile?.kind) ? profile.levels : undefined);
  if (raw != null && (!Array.isArray(raw) || raw.some((level) => typeof level !== "string" || !level.trim()))) throw new Error(`Invalid reasoning levels for ${model.id}`);
  const declared = [...new Set(raw ?? [])];
  let supported = declared.filter((effort) => thinkingLevels.includes(asThinking(effort)));
  const unknown = declared.filter((effort) => !supported.includes(effort));
  if (unknown.length) warnings.push(`${model.id}: OpenClaw cannot represent reasoning levels: ${unknown.join(", ")}`);
  if (raw == null) warnings.push(`${model.id}: reasoning levels are not declared; no effort override configured`);
  const explicitDefault = native ? profile.defaultEffort : field(sources, ["default_reasoning_level", "default_reasoning_effort"]);
  const defaultEffort = explicitDefault === undefined && ["standard", "gemini-thinking"].includes(profile?.kind) ? profile.defaultEffort : explicitDefault;
  if (defaultEffort != null && !declared.includes(defaultEffort)) throw new Error(`Default reasoning effort is not supported for ${model.id}`);
  const chatMax = api === "openai-completions" && supported.includes("max");
  // OpenClaw's Chat simple adapter collapses max to xhigh before dispatch.
  // Restore max if unambiguous; never corrupt a separately supported xhigh.
  const restoreChatMax = chatMax && !supported.includes("xhigh");
  if (chatMax && !restoreChatMax) {
    supported = supported.filter((effort) => effort !== "max");
    warnings.push(`${model.id}: this OpenClaw Chat adapter cannot distinguish max from xhigh; max control is omitted`);
  }
  const compat = { supportsReasoningEffort: supported.length > 0, supportedReasoningEfforts: supported,
    ...(restoreChatMax ? { reasoningEffortMap: { xhigh: "max" } } : {}),
  };
  const thinkingLevelMap = Object.fromEntries(thinkingLevels.map((level) => [level, supported.find((effort) => asThinking(effort) === level) ?? null]));
  // Gemini's Chat wire dialect uses thinking_level, which OpenClaw's generic
  // Chat adapter cannot vary. Preserve the public default without fabricating
  // a working effort slider; Responses exposes dynamic effort when available.
  if (api === "openai-completions" && profile?.kind === "gemini-thinking") {
    warnings.push(`${model.id}: Chat uses thinking_level; only the public default can be configured by this OpenClaw adapter`);
    return { reasoning: false, thinkingLevelMap: Object.fromEntries(thinkingLevels.map((level) => [level, null])), compat: { supportsReasoningEffort: false, supportedReasoningEfforts: [] },
      ...(defaultEffort ? { params: { extraBody: { thinking_level: defaultEffort } } } : {}) };
  }
  return {
    reasoning: supported.some((effort) => !["none", "off"].includes(effort)),
    thinkingLevelMap, compat,
    ...(supported.includes(defaultEffort) ? { params: { thinking: asThinking(defaultEffort) } } : {}),
  };
}

export function buildOpenClawModels(availableModels) {
  const models = [];
  const warnings = [];
  for (const model of availableModels.values()) {
    if (modelIsExplicitlyNonText(model)) continue;
    const { id } = model;
    if (typeof id !== "string" || !id.trim() || id.trim() !== id || /[\u0000-\u001f\u007f]/u.test(id)) throw new Error("Invalid model identifier in catalog");
    const sources = [model, model.metadata];
    const apis = field(sources, ["supportedWireApis", "supported_wire_apis"]);
    if (apis != null && (!Array.isArray(apis) || apis.some((api) => typeof api !== "string" || !api.trim()))) throw new Error(`Invalid supported wire APIs for ${id}`);
    const api = apis?.includes("responses") ? "openai-responses"
      : apis?.includes("chat_completions") ? "openai-completions"
      : apis?.includes("anthropic_messages") ? "anthropic-messages" : null;
    if (!api) {
      warnings.push(`${id}: public metadata declares no supported OpenClaw text API; skipped`);
      continue;
    }
    const input = field(sources, ["inputModalities", "input_modalities"]) ?? ["text"];
    if (!Array.isArray(input) || !input.includes("text") || input.some((v) => typeof v !== "string")) throw new Error(`Invalid input modalities for ${id}`);
    // Restrict advertised input to the modalities all selected wire adapters can send.
    const row = {
      id, name: field(sources, ["display_name", "name", "title"]) || id, api,
      input: [...new Set(input.filter((value) => ["text", "image"].includes(value)))],
      ...reasoningConfig(model, api, warnings),
    };
    const context = field(sources, ["context_window", "contextWindow", "context_length", "max_input_tokens"]);
    const maxTokens = field(sources, ["max_output_tokens", "maxTokens"]);
    for (const [key, value] of [["contextWindow", context], ["maxTokens", maxTokens]]) {
      if (value == null) continue;
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${key} for ${id}`);
      row[key] = value;
    }
    if (api === "anthropic-messages") row.baseUrl = "https://kaiyuncode.com";
    models.push(row);
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  if (!models.length) throw new Error("No account-available text models compatible with OpenClaw");
  return { models, warnings };
}

function isLegacyKaiyunProvider(provider) {
  if (!provider) return true; // Older configurations kept the provider in models.json only.
  return ["https://kaiyuncode.com/v1", "https://kaiyuncode.com/v1/"].includes(provider.baseUrl);
}

export function mergeOpenClawProviders(providers = {}, provider, replaceProviders = false) {
  const next = replaceProviders ? {} : { ...providers };
  if (isLegacyKaiyunProvider(next.kaiyuncode)) delete next.kaiyuncode;
  next[TEXT_PROVIDER_ID] = provider;
  return next;
}

export function mergeOpenClawConfig(config, { models, apiKey, model, replaceProviders = false }) {
  if (!object(config)) throw new Error("OpenClaw config must be a JSON object");
  const next = structuredClone(config);
  const migrateLegacy = isLegacyKaiyunProvider(next.models?.providers?.kaiyuncode);
  const migrateRef = (ref) => typeof ref === "string" && migrateLegacy && ref.startsWith("kaiyuncode/") ? `${TEXT_PROVIDER_ID}/${ref.slice("kaiyuncode/".length)}` : ref;
  const managedRef = (ref) => typeof ref === "string" && migrateRef(ref).startsWith(`${TEXT_PROVIDER_ID}/`);
  const refs = models.map(({ id }) => `${TEXT_PROVIDER_ID}/${id}`);
  const allowed = new Set(refs);
  next.agents ??= {};
  next.agents.defaults ??= {};
  const defaults = next.agents.defaults;
  const previous = typeof defaults.model === "string" ? defaults.model : defaults.model?.primary;
  const previousId = previous?.slice(previous.indexOf("/") + 1);
  const selected = model?.replace(/^(?:custom|kaiyuncode)\//u, "")
    ?? (models.some(({ id }) => id === previousId) ? previousId : models.find(({ id }) => id === "gpt-5.6-sol")?.id ?? models[0].id);
  const primary = `${TEXT_PROVIDER_ID}/${selected}`;
  if (!allowed.has(primary)) throw new Error(`OpenClaw model ${selected} is unavailable as a supported KaiyunCode text model`);
  const provider = { baseUrl: "https://kaiyuncode.com/v1", apiKey, models };
  next.models = { ...next.models, mode: replaceProviders ? "replace" : next.models?.mode ?? "merge",
    providers: mergeOpenClawProviders(next.models?.providers, provider, replaceProviders),
  };
  const keepRef = (ref) => !replaceProviders && !managedRef(ref) || allowed.has(migrateRef(ref));
  const migrateSelection = (value) => {
    if (value === "") return value; // Explicitly disables utility routing.
    if (typeof value === "string") return keepRef(value) ? migrateRef(value) : undefined;
    if (!object(value)) return value;
    if (value.primary && !keepRef(value.primary)) return undefined;
    return { ...value,
      ...(value.primary ? { primary: migrateRef(value.primary) } : {}),
      ...(value.fallbacks ? { fallbacks: value.fallbacks.filter(keepRef).map(migrateRef) } : {}),
    };
  };
  const updateScope = (scope, isDefault = false) => {
    if (!object(scope)) throw new Error("Invalid OpenClaw agent configuration");
    const previousModels = scope.models ?? {};
    scope.models = Object.fromEntries([
      ...Object.entries(previousModels).filter(([ref]) => !replaceProviders && !managedRef(ref)),
      ...models.map((row) => {
        const ref = `${TEXT_PROVIDER_ID}/${row.id}`;
        const prior = previousModels[ref] ?? (migrateLegacy ? previousModels[`kaiyuncode/${row.id}`] : undefined) ?? {};
        const params = { ...prior.params };
        // Replace stale per-model effort defaults; an absent public default
        // remains absent. Unrelated settings such as temperature survive.
        delete params.thinking;
        delete params.reasoningEffort;
        delete params.reasoning_effort;
        if (row.params?.thinking) params.thinking = row.params.thinking;
        return [ref, { ...prior, params }];
      }),
    ]);
    const policy = scope.modelPolicy;
    if (replaceProviders || policy?.allow?.length) {
      scope.modelPolicy = { ...policy, allow: replaceProviders ? refs : [...new Set([...policy.allow.filter((ref) => !managedRef(ref)), ...refs])] };
    }
    if (isDefault || replaceProviders && scope.model !== undefined) {
      scope.model = { ...(object(scope.model) ? scope.model : {}), primary };
      if (scope.model.fallbacks) scope.model.fallbacks = scope.model.fallbacks.filter(keepRef).map(migrateRef);
    } else if (scope.model !== undefined) {
      scope.model = migrateSelection(scope.model) ?? { primary };
    }
    for (const key of ["utilityModel", "imageModel", "pdfModel"]) {
      if (scope[key] === undefined) continue;
      const migrated = migrateSelection(scope[key]);
      if (migrated === undefined) delete scope[key];
      else scope[key] = migrated;
    }
    if (replaceProviders) {
      delete scope.thinkingDefault;
    }
  };
  updateScope(defaults, true);
  for (const entry of Object.values(next.agents.entries ?? {})) updateScope(entry);
  // Older OpenClaw versions store agents in list instead of entries.
  for (const entry of next.agents.list ?? []) updateScope(entry);
  return { config: next, primary, provider };
}
