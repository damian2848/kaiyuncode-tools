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

export function modelSupportsResponses(model) {
  const apis = readField([model, model.metadata].filter(object), ["supportedWireApis", "supported_wire_apis"]);
  // Missing/empty protocol metadata is unspecified in the legacy platform API.
  if (apis == null) return true;
  if (!Array.isArray(apis) || apis.some((api) => typeof api !== "string" || !api.trim())) {
    throw new Error(`Invalid supported wire APIs for ${model.id}`);
  }
  return apis.length === 0 || apis.includes("responses");
}

const contextKeys = ["context_window", "contextWindow", "context_length", "max_input_tokens"];
const levelKeys = ["supported_reasoning_levels", "supported_reasoning_efforts", "reasoning_efforts"];
const defaultKeys = ["default_reasoning_level", "default_reasoning_effort"];
const multiAgentVersionKeys = ["multi_agent_version", "multiAgentVersion"];
const multiAgentReasoningEffortKeys = ["multi_agent_reasoning_effort", "multiAgentReasoningEffort"];
const reasoningProfileKinds = new Set(["standard", "claude-adaptive", "claude-effort-budget", "claude-budget", "gemini-thinking", "minimax-thinking", "unknown"]);
const multiAgentVersions = new Set(["v1", "v2"]);

function capabilitySource(source) {
  if (!object(source)) return null;
  const normalized = { ...source };
  // The public profile is resolved for the exposed protocols; the stored
  // administrator config can describe capabilities unavailable on those APIs.
  const profile = Object.hasOwn(source, "reasoningProfile") ? source.reasoningProfile : source.reasoningConfig;
  if (profile !== undefined) {
    if (!object(profile) || !reasoningProfileKinds.has(profile.kind)) throw new Error("Invalid reasoning capability profile");
    // Only standard levels are compatible with Responses reasoning.effort.
    // Native Claude effort/budgets and client workflows are separate protocols.
    if (!levelKeys.some((key) => Object.hasOwn(source, key))) {
      normalized.supported_reasoning_levels = profile.kind === "unknown" ? null : profile.kind === "standard" ? profile.levels : [];
    }
    if (!defaultKeys.some((key) => Object.hasOwn(source, key))) {
      normalized.default_reasoning_level = profile.kind === "standard" ? profile.defaultEffort ?? null : null;
    }
    if (Array.isArray(profile.workflows) && profile.workflows.includes("ultra")) {
      normalized.ultra_workflow = true;
      const multiAgentVersion = readField([profile, source], multiAgentVersionKeys);
      const multiAgentReasoningEffort = readField([profile, source], multiAgentReasoningEffortKeys);
      if (multiAgentVersion !== undefined) normalized.multi_agent_version = multiAgentVersion;
      if (multiAgentReasoningEffort !== undefined) normalized.multi_agent_reasoning_effort = multiAgentReasoningEffort;
    }
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
  const entries = [...availableModels.values()].filter((model) => {
    if (modelIsExplicitlyNonText(model)) return false;
    if (modelSupportsResponses(model)) return true;
    warnings.push(`${model.id}: excluded from Codex catalog; supported wire APIs do not include responses`);
    return false;
  });
  entries.sort((a, b) => a.id === b.id ? 0 : a.id === preferredModel ? -1 : b.id === preferredModel ? 1 : a.id < b.id ? -1 : 1);
  for (const model of entries) {
    const id = model.id;
    if (typeof id !== "string" || !id.trim() || id.trim() !== id || /[\u0000-\u001f\u007f]/u.test(id)) throw new Error("Invalid model identifier in catalog");
    if (Object.hasOwn(capabilities, id) && !object(capabilities[id])) throw new Error(`Invalid capabilities for ${id}`);
    const runtimeSources = [model, model.metadata].filter(object);
    // Unknown public context blocks only the bundled snapshot, not a confirmed
    // value elsewhere in the same response or an explicit operator override.
    const publicContext = runtimeSources.some((source) => Object.hasOwn(source, "reasoningProfile"))
      ? { context_window: null } : null;
    const sources = [capabilities[id], ...runtimeSources, publicContext, CODEX_MODEL_PROFILES[id]].map(capabilitySource).filter(object);
    const context = tokenCount(readField(sources, contextKeys), id);
    let reasoning = levels(readField(sources, levelKeys), id);
    const ultraWorkflow = sources.some((source) => source.ultra_workflow === true);
    const multiAgentVersion = readField(sources, multiAgentVersionKeys);
    const multiAgentReasoningEffort = readField(sources, multiAgentReasoningEffortKeys);
    let ultra = null;
    if (ultraWorkflow) {
      // Match Sub2API's Codex manifest: Ultra is advertised as a selectable
      // client workflow even when the model does not publish an explicit
      // multi-agent runtime version or its underlying reasoning effort.
      if (!reasoning?.some((level) => level.effort === "ultra")) {
        reasoning = [...(reasoning ?? []), { effort: "ultra", description: descriptions.ultra }];
      }
      const effortIsSupported = reasoning.some((level) => level.effort === multiAgentReasoningEffort);
      if (multiAgentVersions.has(multiAgentVersion) && effortIsSupported) {
        ultra = { version: multiAgentVersion, reasoningEffort: multiAgentReasoningEffort };
      }
    }
    let defaultEffort = readField(sources, defaultKeys);
    const defaultUnset = defaultEffort === null;
    // A runtime effort list can narrow the bundled profile. Never keep its stale default.
    if (!reasoning?.some((level) => level.effort === defaultEffort)) defaultEffort = null;
    if (reasoning === null) warnings.push(`${id}: reasoning levels are unverified; leaving effort unset`);
    if (context === null) warnings.push(`${id}: context window is unverified; Codex will use its fallback until metadata is supplied`);
    const input = readField(sources, ["input_modalities", "inputModalities"]);
    if (input !== undefined && (!Array.isArray(input) || !input.includes("text") || input.some((value) => typeof value !== "string"))) throw new Error(`Invalid input modalities for ${id}`);
    if (input === undefined) warnings.push(`${id}: image input capability is unverified; using text only until input_modalities is supplied`);
    const summaries = readField(sources, ["supports_reasoning_summaries"]);
    const verbosity = readField(sources, ["support_verbosity"]);
    if ([summaries, verbosity].some((value) => value !== undefined && typeof value !== "boolean")) throw new Error(`Invalid capability boolean for ${id}`);
    const displayName = [...runtimeSources.flatMap((source) => [source.display_name, source.title, source.name]), id].find((value) => typeof value === "string" && value.trim())?.trim();
    models.push({
      slug: id,
      display_name: displayName,
      description: `KaiyunCode · ${displayName}${context === null ? " · 上下文长度待确认" : ""}`,
      default_reasoning_level: defaultUnset ? null : defaultEffort ?? reasoning?.find((level) => level.effort === "medium")?.effort ?? reasoning?.[0]?.effort ?? null,
      supported_reasoning_levels: reasoning ?? [],
      ...(ultra ? { multi_agent_version: ultra.version, multi_agent_reasoning_effort: ultra.reasoningEffort } : {}),
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
      input_modalities: input ? [...new Set(input.filter((value) => ["text", "image"].includes(value)))] : ["text"],
      experimental_supported_tools: [],
      truncation_policy: { mode: "tokens", limit: 10000 },
    });
  }
  if (!models.length) throw new Error("No account-available text models compatible with Responses for the Codex catalog");
  return { catalog: { models }, warnings };
}
