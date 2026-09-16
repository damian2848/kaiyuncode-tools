// Exact public request IDs only. Sources and limitations: docs/codex-model-catalog.md.
// null means unverified, [] means no discrete Responses effort control.
// Reasoning snapshot: KaiyunCode 2026-09-16, Sub2API 4b88ee3121ba6ea3f876ed237f2d337170509b35.
const three = ["low", "medium", "high"];
const four = [...three, "xhigh"];
const profiles = {};
function add(ids, contextWindow, reasoningLevels, defaultReasoningLevel = null) {
  for (const id of ids) profiles[id] = { context_window: contextWindow, supported_reasoning_levels: reasoningLevels, default_reasoning_level: defaultReasoningLevel };
}

add(["gpt-5.5"], 272000, four, "medium");
add(["gpt-5.6-sol"], 272000, [...four, "max"], "low");
add(["gpt-5.6-terra", "gpt-5.6-luna"], 272000, [...four, "max"], "medium");
add(["gpt-6-astra"], 272000, [...four, "max"], "medium");
// Native Claude effort is not Responses reasoning.effort.
add(["claude-opus-4-6", "claude-sonnet-4-6"], 1000000, []);
add(["claude-opus-4-7", "claude-opus-4-8", "claude-opus-5"], 1000000, []);
add(["claude-sonnet-5", "claude-fable-5", "claude-fable-5-1"], null, []);
add(["claude-haiku-4-5"], 200000, []);
add(["gemini-3.1-flash-lite", "gemini-3.6-flash-tiered"], 1048576, ["minimal", ...three]);
add(["gemini-3.7-flash-tiered", "gemini-3.8-flash-tiered"], null, three);
// This public ID fixes the upstream thinking tier; do not advertise other tiers.
add(["gemini-3.1-pro-high"], 1048576, []);
add(["grok-4.5"], null, three, "high");
add(["grok-4.6"], null, four, "high");
add(["deepseek-v4-flash", "deepseek-v4-pro"], 1048576, ["low", "high", "max"], "high");
add(["deepseek-v4.1-flash"], null, ["low", "high", "max"], "high");

export const CODEX_MODEL_PROFILES = profiles;
