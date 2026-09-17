import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexModelCatalog } from "../shared/codex-model-catalog.mjs";

const build = (models, options) => buildCodexModelCatalog(new Map(models.map((model) => [model.id, model])), options);

test("missing modality metadata preserves native Codex vision for verified exact model IDs", () => {
  const ids = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.2"];
  const { catalog } = build(ids.map((id) => ({ id, type: "text", reasoningProfile: { kind: "unknown", levels: [] } })));
  for (const model of catalog.models) assert.deepEqual(model.input_modalities, ["text", "image"], model.slug);
  for (const model of build([{ id: "future-model", display_name: "gpt-6-astra" }, { id: "gpt-99" }, { id: "deepseek-v4-pro" }]).catalog.models) {
    assert.deepEqual(model.input_modalities, ["text"], model.slug);
  }
});

test("explicit input modalities override vision snapshots and support metadata camelCase", () => {
  const id = "gpt-6-astra";
  assert.deepEqual(build([{ id, input_modalities: ["text"] }]).catalog.models[0].input_modalities, ["text"]);
  assert.deepEqual(build([{ id, metadata: { inputModalities: ["text"] } }]).catalog.models[0].input_modalities, ["text"]);
  assert.deepEqual(build([{ id, input_modalities: ["text", "image"] }], {
    capabilities: { [id]: { inputModalities: ["text"] } },
  }).catalog.models[0].input_modalities, ["text"]);
  assert.deepEqual(build([{ id: "custom-vision", metadata: { inputModalities: ["text", "image", "image", "audio"] } }]).catalog.models[0].input_modalities, ["text", "image"]);
  assert.throws(() => build([{ id, inputModalities: ["image"] }]), /Invalid input modalities/);
});

test("verified non-GPT vision models retain images without extrapolating other versions", () => {
  const ids = [
    "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5",
    "claude-sonnet-4-6", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5", "claude-fable-5-1",
    "gemini-3.1-flash-lite", "gemini-3.6-flash-tiered", "gemini-3.7-flash-tiered", "gemini-3.8-flash-tiered",
    "grok-4.5", "grok-4.6", "kimi-k3", "glm-5.3-flash", "MiniMax-M3",
    "deepseek-v4-flash", "deepseek-v4.1-flash",
  ];
  for (const id of ids) {
    const { catalog, warnings } = build([{ id, type: "text", supportedWireApis: ["responses"] }]);
    assert.deepEqual(catalog.models[0].input_modalities, ["text", "image"], id);
    assert.ok(!warnings.some((warning) => warning.includes("image input capability")), id);
    assert.deepEqual(build([{ id, metadata: { input_modalities: ["text"] } }]).catalog.models[0].input_modalities, ["text"], id);
  }
  const { catalog, warnings } = build([{ id: "glm-5.3" }, { id: "deepseek-v4-pro" }, { id: "claude-opus-99" }, { id: "unknown", display_name: "kimi-k3" }]);
  assert.ok(catalog.models.every((model) => JSON.stringify(model.input_modalities) === '["text"]'));
  assert.ok(warnings.some((warning) => warning.startsWith("unknown: image input capability")));
  assert.ok(!warnings.some((warning) => warning.startsWith("glm-5.3: image input capability")));
  const filtered = build([{ id: "grok-4.6" }, { id: "gemini-3.8-flash-tiered", supportedWireApis: ["chat_completions"] }]);
  assert.deepEqual(filtered.catalog.models.map((model) => model.slug), ["grok-4.6"]);
});

test("all account text models are listed, including multimodal input and unknown providers", () => {
  const { catalog, warnings } = build([
    { id: "gpt-5.6-sol" },
    { id: "future-text", category: "text", input_modalities: ["text", "image"] },
    { id: "gpt-image-2" },
    { id: "movie", modelCategories: ["video"], supportedWireApis: ["videos"] },
    { id: "embed", type: "embedding" },
    { id: "voice", output_modalities: ["audio"] },
    { id: "audio-output", type: "chat", metadata: { output_modalities: ["audio"] } },
    { id: "vision", output_modalities: ["text"], modalities: ["image"] },
  ], { preferredModel: "gpt-5.6-sol" });
  assert.deepEqual(catalog.models.map((model) => model.slug), ["gpt-5.6-sol", "future-text", "vision"]);
  assert.ok(catalog.models.every((model) => model.visibility === "list" && model.supported_in_api));
  assert.deepEqual(catalog.models[1].input_modalities, ["text", "image"]);
  assert.equal(catalog.models[1].context_window, null);
  assert.deepEqual(catalog.models[1].supported_reasoning_levels, []);
  assert.equal(catalog.models[1].default_reasoning_level, null);
  assert.ok(warnings.some((warning) => warning.includes("future-text: context")));
});

test("runtime capabilities override profiles without retaining an unsupported default effort", () => {
  const { catalog, warnings } = build([{ id: "gpt-5.6-sol", context_window: 64000,
    supported_reasoning_levels: [{ effort: "high" }, { effort: "high" }],
  }]);
  const model = catalog.models[0];
  assert.equal(model.context_window, 64000);
  assert.equal(model.default_reasoning_level, "high");
  assert.deepEqual(model.supported_reasoning_levels.map((level) => level.effort), ["high"]);
  assert.equal(model.supports_reasoning_summaries, true);
  assert.equal(model.supports_reasoning_summary_parameter, false);
  assert.deepEqual(warnings, []);
});

test("operator overrides and explicit empty levels take precedence, including metadata aliases", () => {
  const { catalog } = build([{ id: "gpt-5.6-sol", metadata: { contextWindow: 80000 } }], {
    capabilities: { "gpt-5.6-sol": { context_window: 32000, supported_reasoning_levels: [] } },
  });
  assert.equal(catalog.models[0].context_window, 32000);
  assert.deepEqual(catalog.models[0].supported_reasoning_levels, []);
  assert.equal(catalog.models[0].default_reasoning_level, null);
  assert.equal(catalog.models[0].supports_reasoning_summaries, false);
});

test("profiles distinguish actual effort tiers and never extrapolate unknown future versions", () => {
  const { catalog } = build(["gpt-5.5", "gpt-5.6-sol", "gpt-6-astra", "claude-opus-4-6", "claude-opus-4-8", "claude-haiku-4-5", "gemini-3.1-pro-high", "gpt-99", "deepseek-v4.1-flash"].map((id) => ({ id })));
  const models = new Map(catalog.models.map((model) => [model.slug, model]));
  const efforts = (id) => models.get(id).supported_reasoning_levels.map((level) => level.effort);
  assert.ok(!efforts("gpt-5.5").includes("max"));
  assert.ok(efforts("gpt-5.6-sol").includes("max"));
  assert.ok(!efforts("gpt-5.6-sol").includes("none"));
  assert.equal(models.get("gpt-6-astra").default_reasoning_level, "medium");
  assert.ok(!efforts("gpt-6-astra").includes("ultra"));
  assert.ok(!efforts("claude-opus-4-6").includes("xhigh"));
  assert.deepEqual(efforts("claude-opus-4-8"), []);
  assert.deepEqual(efforts("deepseek-v4.1-flash"), ["low", "high", "max"]);
  assert.deepEqual(efforts("claude-haiku-4-5"), []);
  assert.deepEqual(efforts("gemini-3.1-pro-high"), []);
  assert.deepEqual(efforts("gpt-99"), []);
  assert.equal(models.get("gpt-99").context_window, null);
});

test("new platform metadata remains authoritative for unknown context, empty/native effort and null defaults", () => {
  const { catalog, warnings } = build([
    { id: "gpt-5.6-sol", display_name: "编码模型", reasoningProfile: { kind: "standard", levels: ["high"], workflows: ["ultra"] }, supported_reasoning_levels: ["high"], default_reasoning_level: null },
    { id: "claude-opus-4-8", context_window: 128000, reasoningProfile: { kind: "claude-adaptive", levels: ["high", "max"] }, supported_reasoning_levels: [], default_reasoning_level: null },
    { id: "gpt-5.5", reasoningProfile: { kind: "unknown", levels: [] }, supported_reasoning_levels: null, default_reasoning_level: null },
  ]);
  const models = new Map(catalog.models.map((model) => [model.slug, model]));
  const sol = models.get("gpt-5.6-sol");
  assert.equal(sol.context_window, null);
  assert.equal(sol.default_reasoning_level, null);
  assert.deepEqual(sol.supported_reasoning_levels.map((level) => level.effort), ["high"]);
  assert.equal(sol.display_name, "编码模型");
  assert.doesNotMatch(sol.description, /gpt-5.6-sol/);
  assert.ok(!JSON.stringify(sol).includes("ultra"));
  assert.equal(models.get("claude-opus-4-8").context_window, 128000);
  assert.equal(models.get("claude-opus-4-8").supports_reasoning_summaries, false);
  assert.deepEqual(models.get("gpt-5.5").supported_reasoning_levels, []);
  assert.ok(warnings.some((warning) => warning.startsWith("gpt-5.5: reasoning")));
});

test("verified Ultra workflows use Codex multi-agent runtime metadata", () => {
  const { catalog } = build([{
    id: "gpt-6-astra",
    reasoningProfile: {
      kind: "standard",
      levels: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
      workflows: ["ultra"],
      multiAgentVersion: "v2",
      multiAgentReasoningEffort: "xhigh",
    },
    supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max"],
    default_reasoning_level: "medium",
  }]);
  const astra = catalog.models[0];
  assert.deepEqual(astra.supported_reasoning_levels.map((level) => level.effort), ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.equal(astra.default_reasoning_level, "medium");
  assert.equal(astra.multi_agent_version, "v2");
  assert.equal(astra.multi_agent_reasoning_effort, "xhigh");
});

test("nested administrator configuration uses standard effort only and overrides runtime metadata", () => {
  const model = { id: "gpt-5.6-sol", context_window: 128000, supported_reasoning_levels: ["low", "high"], default_reasoning_level: "high" };
  for (const kind of ["claude-adaptive", "claude-effort-budget", "claude-budget", "unknown", "standard"]) {
    const { catalog } = build([model], { capabilities: { [model.id]: { contextWindow: 64000, reasoningConfig: { kind, levels: ["low"], defaultEffort: "low" } } } });
    const entry = catalog.models[0];
    assert.equal(entry.context_window, 64000);
    assert.deepEqual(entry.supported_reasoning_levels.map((level) => level.effort), kind === "standard" ? ["low"] : []);
    assert.equal(entry.default_reasoning_level, kind === "standard" ? "low" : null);
  }
});

test("new Gemini and MiniMax reasoning profiles preserve the platform's compatibility fields", () => {
  const { catalog } = build([
    {
      id: "gemini-3.6-flash-tiered",
      reasoningProfile: { kind: "gemini-thinking", levels: ["minimal", "low", "medium", "high"], defaultEffort: "medium" },
      supported_reasoning_levels: ["minimal", "low", "medium", "high"],
      default_reasoning_level: "medium",
    },
    {
      id: "MiniMax-M3",
      reasoningProfile: { kind: "minimax-thinking", levels: [], thinkingModes: ["adaptive", "disabled"] },
      supported_reasoning_levels: [],
      default_reasoning_level: null,
    },
  ]);
  const models = new Map(catalog.models.map((model) => [model.slug, model]));
  assert.deepEqual(models.get("gemini-3.6-flash-tiered").supported_reasoning_levels.map((level) => level.effort), ["minimal", "low", "medium", "high"]);
  assert.equal(models.get("gemini-3.6-flash-tiered").default_reasoning_level, "medium");
  assert.deepEqual(models.get("MiniMax-M3").supported_reasoning_levels, []);
  assert.equal(models.get("MiniMax-M3").default_reasoning_level, null);
});

test("invalid metadata fails before a misleading catalog can be installed", () => {
  for (const value of [0, -1, "128k", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => build([{ id: "test", context_window: value }]), /context window/);
  }
  assert.throws(() => build([{ id: "test", supported_reasoning_levels: "high" }]), /reasoning levels/);
  assert.throws(() => build([{ id: "test", supported_reasoning_levels: ["bad\nvalue"] }]), /reasoning effort/);
  assert.throws(() => build([{ id: "only-image", type: "image" }]), /No account-available text models/);
});

test("public wire APIs exclude text models unavailable through Responses while preserving legacy discovery", () => {
  const { catalog, warnings } = build([
    { id: "chat-only", type: "text", supportedWireApis: ["chat_completions"] },
    { id: "messages-only", type: "text", metadata: { supported_wire_apis: ["anthropic_messages"] } },
    { id: "compatible", type: "text", supportedWireApis: ["responses", "chat_completions"] },
    { id: "legacy" },
    { id: "unspecified", supportedWireApis: [] },
    { id: "root-wins", supportedWireApis: ["chat_completions"], metadata: { supportedWireApis: ["responses"] } },
  ]);
  assert.deepEqual(catalog.models.map((model) => model.slug), ["compatible", "legacy", "unspecified"]);
  for (const id of ["chat-only", "messages-only", "root-wins"]) {
    assert.ok(warnings.some((warning) => warning.startsWith(`${id}: excluded`) && warning.includes("responses")));
  }
  assert.throws(() => build([{ id: "chat-only", type: "text", supportedWireApis: ["chat_completions"] }]), /No account-available text models compatible with Responses/);
  assert.throws(() => build([{ id: "invalid", type: "text", supportedWireApis: "responses" }]), /Invalid supported wire APIs/);
});

test("resolved public profile takes precedence over stored administrator config", () => {
  const { catalog } = build([{
    id: "gpt-5.6-sol",
    reasoningConfig: { kind: "standard", levels: ["high"], defaultEffort: "high" },
    reasoningProfile: { kind: "unknown", levels: [], note: "当前接口不支持配置的思考参数" },
  }]);
  const model = catalog.models[0];
  assert.deepEqual(model.supported_reasoning_levels, []);
  assert.equal(model.default_reasoning_level, null);
  assert.equal(model.supports_reasoning_summaries, false);
  assert.equal(model.context_window, null);
});

test("public unknown context only blocks snapshots, not confirmed metadata or operator values", () => {
  const source = {
    id: "gpt-5.6-sol",
    reasoningProfile: { kind: "standard", levels: ["high"], defaultEffort: "high" },
    metadata: { contextWindow: 64000, display_name: "公开别名" },
  };
  const model = build([source]).catalog.models[0];
  assert.equal(model.context_window, 64000);
  assert.equal(model.display_name, "公开别名");
  assert.equal(model.slug, "gpt-5.6-sol");
  assert.equal(build([{ ...source, context_window: null }]).catalog.models[0].context_window, null);
  assert.equal(build([source], { capabilities: { [source.id]: { context_window: 32000 } } }).catalog.models[0].context_window, 32000);
  assert.equal(build([{ ...source, metadata: {} }]).catalog.models[0].context_window, null);
});
