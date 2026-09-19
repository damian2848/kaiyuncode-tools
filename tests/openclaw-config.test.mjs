import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureAgents, parseCliArgs } from "../skills/kaiyuncode-configure-agents/scripts/configure-agents.mjs";
import { buildOpenClawModels, mergeOpenClawConfig } from "../shared/openclaw-config.mjs";

const apiKey = "test-openclaw-private-key";
const data = [
  { id: "gpt-5.6-terra", type: "text", supportedWireApis: ["responses", "chat_completions"], inputModalities: ["text", "image"], context_window: 272000, supported_reasoning_levels: ["low", "high"], default_reasoning_level: "high" },
  { id: "gemini-chat", type: "text", supportedWireApis: ["chat_completions"], inputModalities: ["text", "image", "audio"] },
  { id: "claude-native", type: "text", supportedWireApis: ["anthropic_messages"] },
  { id: "image-generation", type: "image", supportedWireApis: ["images_generations"] },
  { id: "embedding-model", type: "embedding" },
];
const current = {
  gateway: { port: 18789, auth: { token: "keep-local-token" } },
  channels: { example: { enabled: true } },
  models: { mode: "merge", providers: { old: { baseUrl: "https://old.test", models: [{ id: "gpt-5.6-terra" }] } } },
  agents: {
    defaults: { model: { primary: "old/gpt-5.6-terra", fallbacks: ["old/fallback"] }, models: { "old/other": {} }, modelPolicy: { allow: ["old/*"] }, workspace: "/workspace" },
    entries: { main: { model: "old/gpt-5.6-terra", models: { "old/gpt-5.6-terra": {} }, modelPolicy: { allow: ["old/*"] }, tools: { profile: "full" } } },
  },
};
const fetchImpl = async () => new Response(JSON.stringify({ data }), { status: 200 });

test("OpenClaw includes both Responses and Chat models, excluding media and embeddings", () => {
  const { models } = buildOpenClawModels(new Map(data.map((row) => [row.id, row])));
  assert.equal(models.length, 3);
  assert.equal(models.find(({ id }) => id === "gpt-5.6-terra").api, "openai-responses");
  assert.equal(models.find(({ id }) => id === "gpt-5.6-terra").contextWindow, 272000);
  assert.deepEqual(models.find(({ id }) => id === "gemini-chat").input, ["text", "image"]);
  assert.equal(models.find(({ id }) => id === "gemini-chat").api, "openai-completions");
  assert.equal(models.find(({ id }) => id === "claude-native").baseUrl, "https://kaiyuncode.com");
  assert.equal(Object.hasOwn(models.find(({ id }) => id === "gemini-chat"), "contextWindow"), false);
});

test("exclusive mode removes old providers and per-agent overrides without losing tools or channels", () => {
  const { models } = buildOpenClawModels(new Map(data.map((row) => [row.id, row])));
  const { config, primary } = mergeOpenClawConfig(current, { models, apiKey, replaceProviders: true });
  assert.equal(primary, "kaiyuncode/gpt-5.6-terra");
  assert.deepEqual(Object.keys(config.models.providers), ["kaiyuncode"]);
  assert.equal(config.models.mode, "replace");
  for (const scope of [config.agents.defaults, config.agents.entries.main]) {
    assert.equal(scope.model.primary, primary);
    assert.equal(Object.keys(scope.models).length, 3);
    assert.ok(Object.keys(scope.models).every((ref) => ref.startsWith("kaiyuncode/")));
    assert.equal(scope.modelPolicy.allow.length, 3);
  }
  assert.deepEqual(config.agents.defaults.model.fallbacks, []);
  assert.deepEqual(config.agents.entries.main.tools, current.agents.entries.main.tools);
  assert.deepEqual(config.channels, current.channels);
  assert.deepEqual(config.gateway, current.gateway);
  assert.equal(current.models.mode, "merge");
});

test("ordinary setup retains other providers, while refreshing KaiyunCode membership", () => {
  const { models } = buildOpenClawModels(new Map(data.map((row) => [row.id, row])));
  const source = structuredClone(current);
  source.agents.defaults.models["kaiyuncode/retired"] = {};
  source.agents.defaults.models["kaiyuncode/gemini-chat"] = { alias: "Gemini" };
  const { config } = mergeOpenClawConfig(source, { models, apiKey });
  assert.ok(config.models.providers.old);
  assert.ok(config.agents.defaults.models["old/other"]);
  assert.equal(config.agents.defaults.models["kaiyuncode/retired"], undefined);
  assert.equal(config.agents.defaults.models["kaiyuncode/gemini-chat"].alias, "Gemini");
  assert.ok(config.agents.defaults.modelPolicy.allow.includes("old/*"));
  assert.equal(config.agents.entries.main.model, "old/gpt-5.6-terra");
});

test("reasoning levels and defaults track changed public metadata, without family fallbacks", () => {
  const build = (row) => buildOpenClawModels(new Map([[row.id, row]])).models[0];
  const first = build(data[0]);
  assert.deepEqual(first.compat.supportedReasoningEfforts, ["low", "high"]);
  assert.equal(first.params.thinking, "high");
  assert.deepEqual(first.thinkingLevelMap, { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: null });
  const updated = build({ ...data[0], supportedWireApis: ["chat_completions"], supported_reasoning_levels: ["none", "minimal", "max"], default_reasoning_level: "max" });
  assert.equal(updated.api, "openai-completions");
  assert.equal(updated.thinkingLevelMap.off, "none");
  assert.equal(updated.thinkingLevelMap.high, null);
  assert.equal(updated.params.thinking, "max");
  const unknown = build({ id: "gpt-6-astra", type: "text", supportedWireApis: ["responses"] });
  assert.equal(unknown.params, undefined);
  assert.equal(unknown.contextWindow, undefined);
  assert.deepEqual(unknown.input, ["text"]);
  assert.equal(unknown.reasoning, false);
  assert.deepEqual(unknown.compat.supportedReasoningEfforts, []);
  assert.throws(() => build({ ...data[0], default_reasoning_level: "max" }), /not supported/);
});

test("wire-specific empty efforts override native Claude profile and explicit null blocks profile fallback", () => {
  const nativeProfile = { kind: "claude-adaptive", levels: ["low", "high", "max"], defaultEffort: "high" };
  const row = { id: "claude-custom", type: "text", supportedWireApis: ["responses", "anthropic_messages"], supported_reasoning_levels: [], default_reasoning_level: null, reasoningProfile: nativeProfile };
  const build = (value) => buildOpenClawModels(new Map([[value.id, value]])).models[0];
  assert.equal(build(row).reasoning, false);
  assert.equal(build(row).params, undefined);
  const messages = build({ ...row, supportedWireApis: ["anthropic_messages"] });
  assert.equal(messages.params.thinking, "high");
  assert.deepEqual(messages.compat.supportedReasoningEfforts, nativeProfile.levels);
  const explicitNull = build({ ...row, supported_reasoning_levels: null, reasoningProfile: { kind: "standard", levels: ["high"], defaultEffort: "high" } });
  assert.equal(explicitNull.reasoning, false);
  assert.equal(explicitNull.params, undefined);
});

test("absent protocols are skipped, and metadata aliases remain usable", () => {
  const rows = [data[0], { id: "legacy" }, { id: "empty", type: "text", supportedWireApis: [] }, { id: "nested", metadata: { supported_wire_apis: ["chat_completions"], supported_reasoning_levels: ["high"], default_reasoning_level: "high" } }];
  const { models, warnings } = buildOpenClawModels(new Map(rows.map((row) => [row.id, row])));
  assert.deepEqual(models.map(({ id }) => id), ["gpt-5.6-terra", "nested"]);
  assert.equal(warnings.length, 2);
  assert.equal(models[1].params.thinking, "high");
});

test("refresh replaces stale defaults and exclusive mode clears agent thinking overrides", () => {
  const { models } = buildOpenClawModels(new Map(data.map((row) => [row.id, row])));
  const source = structuredClone(current);
  source.agents.defaults.thinkingDefault = "max";
  source.agents.entries.main.thinkingDefault = "low";
  source.agents.defaults.models["kaiyuncode/gpt-5.6-terra"] = { alias: "Terra", params: { thinking: "max", temperature: 0.5 } };
  source.agents.defaults.models["kaiyuncode/gemini-chat"] = { params: { thinking: "high" } };
  const { config } = mergeOpenClawConfig(source, { models, apiKey, replaceProviders: true });
  assert.equal(config.agents.defaults.thinkingDefault, undefined);
  assert.equal(config.agents.entries.main.thinkingDefault, undefined);
  assert.deepEqual(config.agents.defaults.models["kaiyuncode/gpt-5.6-terra"], { alias: "Terra", params: { thinking: "high", temperature: 0.5 } });
  assert.equal(config.agents.defaults.models["kaiyuncode/gemini-chat"].params.thinking, undefined);
});

test("Chat-only Gemini preserves its public default without exposing an incompatible effort control", () => {
  const row = { id: "chat-gemini", type: "text", supportedWireApis: ["chat_completions"], reasoningProfile: { kind: "gemini-thinking", levels: ["low", "high"], defaultEffort: "high" } };
  const { models: [model], warnings } = buildOpenClawModels(new Map([[row.id, row]]));
  assert.equal(model.params.extraBody.thinking_level, "high");
  assert.equal(model.compat.supportsReasoningEffort, false);
  assert.equal(model.params.thinking, undefined);
  assert.ok(warnings.some((warning) => warning.includes("thinking_level")));
});

test("Chat max restores the exact public value without corrupting an independent xhigh", () => {
  const row = { id: "chat-max", type: "text", supportedWireApis: ["chat_completions"], supported_reasoning_levels: ["low", "high", "max"], default_reasoning_level: "max" };
  const result = buildOpenClawModels(new Map([[row.id, row]]));
  assert.deepEqual(result.models[0].compat.reasoningEffortMap, { xhigh: "max" });
  assert.equal(result.models[0].params.thinking, "max");
  const both = buildOpenClawModels(new Map([[row.id, { ...row, supported_reasoning_levels: ["xhigh", "max"] }]]));
  assert.equal(both.models[0].compat.reasoningEffortMap, undefined);
  assert.deepEqual(both.models[0].compat.supportedReasoningEfforts, ["xhigh"]);
  assert.equal(both.models[0].params, undefined);
  assert.ok(both.warnings.some((warning) => warning.includes("cannot distinguish")));
});

async function fixture(t) {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), "kaiyun-openclaw-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const openclawHome = join(root, ".openclaw");
  const agentDir = join(openclawHome, "agents", "main", "agent");
  await fs.mkdir(agentDir, { recursive: true });
  const configPath = join(openclawHome, "openclaw.json");
  const cachePath = join(agentDir, "models.json");
  await fs.writeFile(configPath, JSON.stringify(current), { mode: 0o640 });
  await fs.writeFile(cachePath, JSON.stringify({ providers: current.models.providers }), { mode: 0o600 });
  const spawnImpl = async (command, args, { env }) => {
    assert.equal(command, "openclaw");
    assert.deepEqual(args, ["config", "validate", "--json"]);
    assert.notEqual(env.OPENCLAW_CONFIG_PATH, configPath);
    assert.deepEqual(JSON.parse(await fs.readFile(configPath, "utf8")), current);
    assert.equal(JSON.parse(await fs.readFile(env.OPENCLAW_CONFIG_PATH, "utf8")).models.mode, "replace");
    return { status: 0 };
  };
  return { root, configPath, cachePath, openclawHome, home: root, apiKey, fetchImpl, spawnImpl, openclawOnly: true, replaceProviders: true };
}

test("configuration backs up and updates both files, is repeatable, and does not configure other clients", async (t) => {
  const f = await fixture(t);
  const result = await configureAgents(f);
  assert.equal(result.backups.length, 2);
  assert.equal(result.preview.openclaw.modelCount, 3);
  assert.ok(!JSON.stringify(result).includes(apiKey));
  const saved = await fs.readFile(f.configPath, "utf8");
  assert.equal(JSON.parse(saved).models.providers.kaiyuncode.apiKey, apiKey);
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(f.cachePath, "utf8")).providers), ["kaiyuncode"]);
  assert.equal((await fs.stat(f.configPath)).mode & 0o777, 0o600);
  for (const path of [".codex", ".claude", ".config"]) await assert.rejects(fs.stat(join(f.root, path)), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await fs.readFile(result.backups[0].backupPath, "utf8")), current);
  await configureAgents({ ...f, spawnImpl: async () => ({ status: 0 }) });
  assert.equal(await fs.readFile(f.configPath, "utf8"), saved);
});

test("dry run writes nothing and does not invoke OpenClaw", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.configPath, "utf8");
  const result = await configureAgents({ ...f, dryRun: true, spawnImpl: () => assert.fail("spawn in dry run") });
  assert.deepEqual(result.backups, []);
  assert.equal(await fs.readFile(f.configPath, "utf8"), before);
  assert.deepEqual((await fs.readdir(f.openclawHome)).sort(), ["agents", "openclaw.json"]);
});

test("validation failure preserves original contents and file modes and redacts the key", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.configPath, "utf8");
  await assert.rejects(configureAgents({ ...f, spawnImpl: async () => ({ status: 1, stderr: `Invalid: ${apiKey}` }) }), (error) => {
    assert.ok(error.message.includes("[REDACTED]"));
    assert.ok(!error.message.includes(apiKey));
    return true;
  });
  assert.equal(await fs.readFile(f.configPath, "utf8"), before);
  assert.equal((await fs.stat(f.configPath)).mode & 0o777, 0o640);
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(f.cachePath, "utf8")).providers), ["old"]);
});

test("unavailable selection, bad metadata, conflicting flags and symlink caches fail before mutation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(configureAgents({ ...f, openclawModel: "image-generation" }), /unavailable/);
  await assert.rejects(configureAgents({ ...f, codexOnly: true }), /mutually exclusive/);
  await assert.rejects(configureAgents({ replaceProviders: true }), /requires --openclaw-only/);
  assert.throws(() => buildOpenClawModels(new Map([["bad", { id: "bad", type: "text", supportedWireApis: "responses" }]])), /Invalid supported/);
  const target = join(f.root, "outside.json");
  await fs.writeFile(target, "{}");
  await fs.rm(f.cachePath);
  await fs.symlink(target, f.cachePath);
  await assert.rejects(configureAgents(f), /symbolic link/);
  assert.equal(await fs.readFile(target, "utf8"), "{}");
  assert.deepEqual(parseCliArgs(["--openclaw-only", "--replace-providers", "--openclaw-model=gpt-5.6-terra"]), { openclawOnly: true, replaceProviders: true, openclawModel: "gpt-5.6-terra" });
});
