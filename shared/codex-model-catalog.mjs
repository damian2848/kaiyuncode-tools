import { CODEX_MODEL_PROFILES } from "./codex-model-profiles.mjs";

const textType = /(^|[^a-z])(text|chat|language|completion|response)s?([^a-z]|$)/u;
const otherType = /(^|[^a-z])(image|video|audio|embedding|rerank|speech)s?([^a-z]|$)/u;
const descriptions = { none: "关闭思考", minimal: "极低思考强度", low: "低思考强度", medium: "中等思考强度", high: "高思考强度", xhigh: "超高思考强度", max: "最高思考强度", ultra: "Ultra 思考强度" };

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

export function modelIsExplicitlyNonText(model) {
  const sources = [model, model.metadata].filter(object);
  // Output modalities take precedence over input image/audio support.
  for (const source of sources) {
    const outputs = [source.output_modalities ?? source.output_modality].flat().filter((value) => typeof value === "string").map((value) => value.toLowerCase());
    if (outputs.some((value) => textType.test(value))) return false;
    if (outputs.some((value) => otherType.test(value))) return true;
  }
  for (const source of sources) {
    for (const key of ["output_modalities", "output_modality", "modelCategories", "categories", "category", "type", "model_type", "task", "mode", "modality", "modalities", "capabilities", "capability"]) {
      const values = [source[key]].flat().filter((value) => typeof value === "string").map((value) => value.toLowerCase());
      if (!values.length) continue;
      if (values.some((value) => /(?:to[-_ ]|generation|synthesis).*(?:image|video|audio|speech)|(?:image|video|audio|speech)[-_ ](?:generation|synthesis)/u.test(value))) return true;
      if (values.some((value) => textType.test(value))) return false;
      if (values.some((value) => otherType.test(value))) return true;
    }
    const apis = source.supportedWireApis ?? source.supported_wire_apis;
    if (Array.isArray(apis) && apis.length) return !apis.some((api) => ["responses", "chat_completions", "anthropic_messages"].includes(api));
  }
  // Legacy id-only responses: exclude recognisable media/tool families.
  return /(?:image|embedding|rerank|whisper|tts|dall-e|flux|seedream|seedance|sora|veo|kling|happyhorse|^omni(?:$|[_-])|[-_](?:t2v|i2v|video)(?:$|[-_]))/iu.test(model.id);
}

function readField(sources, keys) {
  for (const source of sources) for (const key of keys) if (Object.hasOwn(source, key)) return source[key];
  return undefined;
}

const contextKeys = ["context_window", "contextWindow", "context_length", "max_input_tokens"];
const levelKeys = ["supported_reasoning_levels", "supported_reasoning_efforts", "reasoning_efforts"];
const defaultKeys = ["default_reasoning_level", "default_reasoning_effort"];

function capabilitySource(source) {
  if (!object(source)) return null;
  const normalized = { ...source };
  const profile = source.reasoningConfig ?? source.reasoningProfile;
  if (profile !== undefined) {
    if (!object(profile) || !["standard", "claude-adaptive", "claude-effort-budget", "claude-budget", "unknown"].includes(profile.kind)) throw new Error("Invalid reasoning capability profile");
    // Only standard levels are compatible with Responses reasoning.effort.
    // Native Claude effort/budgets and client workflows are separate protocols.
    if (!levelKeys.some((key) => Object.hasOwn(source, key))) {
      normalized.supported_reasoning_levels = profile.kind === "unknown" ? null : profile.kind === "standard" ? profile.levels : [];
    }
    if (!defaultKeys.some((key) => Object.hasOwn(source, key))) {
      normalized.default_reasoning_level = profile.kind === "standard" ? profile.defaultEffort ?? null : null;
    }
    // The new public contract omits unconfirmed context. Do not resurrect an
    // old bundled limit after the server explicitly publishes its capabilities.
    if (Object.hasOwn(source, "reasoningProfile") && !contextKeys.some((key) => Object.hasOwn(source, key))) normalized.context_window = null;
  }
  return normalized;
}

function tokenCount(value, id) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid context window for ${id}: expected positive integer tokens`);
  return value;
}

function levels(value, id) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new Error(`Invalid reasoning levels for ${id}: expected array`);
  const result = [];
  for (const item of value) {
    const effort = typeof item === "string" ? item : item?.effort;
    if (typeof effort !== "string" || !/^[a-z][a-z0-9_+-]{0,31}$/u.test(effort)) throw new Error(`Invalid reasoning effort for ${id}`);
    if (!result.some((entry) => entry.effort === effort)) result.push({ effort, description: descriptions[effort] ?? effort });
  }
  return result;
}

export function buildCodexModelCatalog(availableModels, { capabilities = {}, preferredModel } = {}) {
  if (!(availableModels instanceof Map) || !object(capabilities)) throw new Error("Invalid model catalog inputs");
  const models = [];
  const warnings = [];
  const entries = [...availableModels.values()].filter((model) => !modelIsExplicitlyNonText(model));
  entries.sort((a, b) => a.id === b.id ? 0 : a.id === preferredModel ? -1 : b.id === preferredModel ? 1 : a.id < b.id ? -1 : 1);
  for (const model of entries) {
    const id = model.id;
    if (typeof id !== "string" || !id.trim() || id.trim() !== id || /[\u0000-\u001f\u007f]/u.test(id)) throw new Error("Invalid model identifier in catalog");
    if (Object.hasOwn(capabilities, id) && !object(capabilities[id])) throw new Error(`Invalid capabilities for ${id}`);
    const sources = [capabilities[id], model, model.metadata, CODEX_MODEL_PROFILES[id]].map(capabilitySource).filter(object);
    const context = tokenCount(readField(sources, contextKeys), id);
    const reasoning = levels(readField(sources, levelKeys), id);
    let defaultEffort = readField(sources, defaultKeys);
    const defaultUnset = defaultEffort === null;
    // A runtime effort list can narrow the bundled profile. Never keep its stale default.
    if (!reasoning?.some((level) => level.effort === defaultEffort)) defaultEffort = null;
    if (reasoning === null) warnings.push(`${id}: reasoning levels are unverified; leaving effort unset`);
    if (context === null) warnings.push(`${id}: context window is unverified; Codex will use its fallback until metadata is supplied`);
    const input = readField(sources, ["input_modalities"]);
    if (input !== undefined && (!Array.isArray(input) || !input.includes("text"))) throw new Error(`Invalid input modalities for ${id}`);
    const summaries = readField(sources, ["supports_reasoning_summaries"]);
    const verbosity = readField(sources, ["support_verbosity"]);
    if ([summaries, verbosity].some((value) => value !== undefined && typeof value !== "boolean")) throw new Error(`Invalid capability boolean for ${id}`);
    const displayName = [model.display_name, model.title, model.name, id].find((value) => typeof value === "string" && value.trim())?.trim();
    models.push({
      slug: id,
      display_name: displayName,
      description: `KaiyunCode · ${displayName}${context === null ? " · 上下文长度待确认" : ""}`,
      default_reasoning_level: defaultUnset ? null : defaultEffort ?? reasoning?.find((level) => level.effort === "medium")?.effort ?? reasoning?.[0]?.effort ?? null,
      supported_reasoning_levels: reasoning ?? [],
      context_window: context,
      visibility: "list",
      supported_in_api: true,
      priority: models.length,
      shell_type: "unified_exec",
      base_instructions: "You are a coding assistant. Work with the user to complete tasks in the shared workspace. Follow the user's instructions and the project's AGENTS.md guidance.",
      // Codex also gates sending reasoning.effort on this legacy capability flag.
      supports_reasoning_summaries: summaries ?? Boolean(reasoning?.length),
      supports_reasoning_summary_parameter: summaries ?? false,
      support_verbosity: verbosity ?? false,
      default_reasoning_summary: "none",
      prefer_websockets: false,
      input_modalities: input?.filter((value) => ["text", "image"].includes(value)) ?? ["text"],
      experimental_supported_tools: [],
      truncation_policy: { mode: "tokens", limit: 10000 },
    });
  }
  if (!models.length) throw new Error("No account-available text models for the Codex catalog");
  return { catalog: { models }, warnings };
}
