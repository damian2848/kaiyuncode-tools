import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  configureAgents,
  parseCliArgs,
  readApiKeyFromStdin,
  readHiddenApiKey,
  resolveApiKeyInput,
} from "../skills/kaiyuncode-configure-agents/scripts/configure-agents.mjs";

const API_KEY = "test-key-that-must-not-leak";
const FIXED_DATE = new Date("2026-07-11T12:34:56.789Z");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function createConfigFixture(t) {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), "kaiyun-config-"));
  const codexHome = join(root, ".codex");
  const claudeHome = join(root, ".claude");
  await fs.mkdir(codexHome);
  await fs.mkdir(claudeHome);
  const codexConfig = join(codexHome, "config.toml");
  const codexAuth = join(codexHome, "auth.json");
  const claudeSettings = join(claudeHome, "settings.json");
  const claudeJson = join(root, ".claude.json");
  const originalCodex = '# user config\nmodel = "old"\n[mcp_servers.keep]\nurl = "https://keep.test"\n';
  const originalAuth = '{"auth_mode":"chatgpt"}\n';
  const originalClaude = '{"permissions":{"allow":["Read"]},"env":{"KEEP":"yes"}}\n';
  const originalClaudeJson = '{"hasCompletedOnboarding":false}\n';
  await fs.writeFile(codexConfig, originalCodex, { mode: 0o640 });
  await fs.writeFile(codexAuth, originalAuth, { mode: 0o600 });
  await fs.writeFile(claudeSettings, originalClaude, { mode: 0o644 });
  await fs.writeFile(claudeJson, originalClaudeJson, { mode: 0o644 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, apiKey: API_KEY, mediaCredentialPath: join(root, "credentials.env"), codexHome, claudeHome, codexConfig, codexAuth, claudeSettings, claudeJson, originalCodex, originalAuth, originalClaude, originalClaudeJson };
}

function validatingFetch(expectedKey = API_KEY) {
  return async (url, options) => {
    assert.equal(url, "https://kaiyuncode.com/v1/models");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${expectedKey}`);
    return jsonResponse({ data: [
      { id: "gpt-5.6-sol" },
      { id: "gpt-5.5" },
      { id: "claude-opus-4-8" },
      { id: "claude-sonnet-5" },
      { id: "claude-haiku-4-5" },
    ] });
  };
}

test("Codex rejects a selected Chat-only model before writes while Claude can still use Messages", async (t) => {
  const fixture = await createConfigFixture(t);
  const models = [
    { id: "gpt-5.6-sol", type: "text", supportedWireApis: ["responses"] },
    { id: "chat-only", type: "text", supportedWireApis: ["chat_completions"] },
    { id: "claude-opus-4-8", type: "text", supportedWireApis: ["anthropic_messages"] },
  ];
  const options = {
    ...fixture,
    fetchImpl: async () => jsonResponse({ object: "list", data: models }),
    spawnImpl: async () => assert.fail("must not start client processes"),
  };
  await assert.rejects(configureAgents({ ...options, codexModel: "chat-only" }), /does not support the Responses API/);
  assert.equal(await fs.readFile(fixture.codexConfig, "utf8"), fixture.originalCodex);
  assert.equal(await fs.readFile(fixture.claudeSettings, "utf8"), fixture.originalClaude);
  assert.deepEqual((await fs.readdir(fixture.codexHome)).sort(), ["auth.json", "config.toml"]);
  const { preview } = await configureAgents({ ...options, dryRun: true });
  assert.equal(preview.claude.model, "claude-opus-4-8");
  assert.deepEqual(preview.codex.catalog.models.map((model) => model.slug), ["gpt-5.6-sol"]);
  assert.ok(preview.codex.warnings.some((warning) => warning.startsWith("chat-only: excluded")));
});

test("preflight rejects an auth symlink before backups, writes, or processes", async (t) => {
  const fixture = await createConfigFixture(t);
  const external = join(fixture.root, "external-auth.json");
  const originalExternal = '{"outside":"unchanged"}\n';
  await fs.writeFile(external, originalExternal);
  await fs.rm(fixture.codexAuth);
  await fs.symlink(external, fixture.codexAuth);
  let processCalls = 0;

  await assert.rejects(
    configureAgents({
      ...fixture,
      fetchImpl: validatingFetch(),
      spawnImpl: async () => {
        processCalls += 1;
        await fs.writeFile(fixture.codexAuth, API_KEY);
        return { status: 1, stderr: "must not run" };
      },
      now: () => FIXED_DATE,
    }),
    /symbolic link|symlink|unsafe path/i,
  );

  assert.equal(processCalls, 0);
  assert.equal(await fs.readFile(external, "utf8"), originalExternal);
  assert.equal((await fs.lstat(fixture.codexAuth)).isSymbolicLink(), true);
  assert.equal((await fs.readdir(fixture.codexHome)).some((name) => name.includes(".bak.")), false);
  assert.equal((await fs.readdir(fixture.claudeHome)).some((name) => name.includes(".bak.")), false);
});

test("preflight rejects a symlink above existing configuration homes without external mutation", async (t) => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), "kaiyun-linked-home-"));
  const externalHome = join(root, "external-home");
  const linkedHome = join(root, "linked-home");
  const codexHome = join(linkedHome, ".codex");
  const claudeHome = join(linkedHome, ".claude");
  const externalCodexHome = join(externalHome, ".codex");
  const externalClaudeHome = join(externalHome, ".claude");
  await fs.mkdir(externalCodexHome, { recursive: true });
  await fs.mkdir(externalClaudeHome);
  await fs.symlink(externalHome, linkedHome, "dir");
  const codexConfig = join(codexHome, "config.toml");
  const codexAuth = join(codexHome, "auth.json");
  const claudeSettings = join(claudeHome, "settings.json");
  const originals = new Map([
    [codexConfig, 'model = "outside-old"\n'],
    [codexAuth, '{"outside":"auth"}\n'],
    [claudeSettings, '{"outside":"settings"}\n'],
  ]);
  for (const [path, content] of originals) await fs.writeFile(path, content);
  const originalLink = await fs.readlink(linkedHome);
  let processCalls = 0;
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(
    configureAgents({
      apiKey: API_KEY,
      home: linkedHome,
      codexHome,
      claudeHome,
      codexConfig,
      codexAuth,
      claudeSettings,
      fetchImpl: validatingFetch(),
      spawnImpl: async () => {
        processCalls += 1;
        return { status: 0, stdout: "", stderr: "" };
      },
      now: () => FIXED_DATE,
    }),
    /symbolic link|symlink|unsafe path/i,
  );

  assert.equal(processCalls, 0);
  assert.equal((await fs.lstat(linkedHome)).isSymbolicLink(), true);
  assert.equal(await fs.readlink(linkedHome), originalLink);
  for (const [path, content] of originals) assert.equal(await fs.readFile(path, "utf8"), content);
  assert.equal((await fs.readdir(externalCodexHome)).some((name) => name.includes(".bak.")), false);
  assert.equal((await fs.readdir(externalClaudeHome)).some((name) => name.includes(".bak.")), false);
});

test("model validation fails closed for malformed success responses and unavailable selections", async (t) => {
  const fixture = await createConfigFixture(t);
  let processCalls = 0;
  const spawnImpl = async () => { processCalls += 1; return { status: 0 }; };

  await assert.rejects(
    configureAgents({ ...fixture, dryRun: true, fetchImpl: async () => jsonResponse({ models: [] }), spawnImpl }),
    /model.*response|malformed/i,
  );
  await assert.rejects(
    configureAgents({ ...fixture, dryRun: true, fetchImpl: async () => jsonResponse({ data: [{ id: "gpt-5.6-sol" }] }), spawnImpl }),
    /claude-opus-4-8.*unavailable|unavailable.*claude-opus-4-8/i,
  );
  await assert.rejects(
    configureAgents({
      ...fixture,
      dryRun: true,
      claudeModel: "claude-main",
      claudeOpusModel: "claude-opus",
      claudeSonnetModel: "claude-sonnet",
      claudeHaikuModel: "claude-haiku-missing",
      fetchImpl: async () => jsonResponse({ data: [
        { id: "gpt-5.6-sol", type: "chat" },
        { id: "claude-main", type: "text" },
        { id: "claude-opus", type: "chat" },
        { id: "claude-sonnet", type: "chat" },
      ] }),
      spawnImpl,
    }),
    /claude-haiku-missing.*unavailable|unavailable.*claude-haiku-missing/i,
  );
  await assert.rejects(
    configureAgents({
      ...fixture,
      dryRun: true,
      codexModel: "image-only",
      fetchImpl: async () => jsonResponse({ data: [
        { id: "image-only", metadata: { output_modalities: ["image"] } },
        { id: "claude-opus-4-8", type: "chat" },
      ] }),
      spawnImpl,
    }),
    /image-only.*text|text.*image-only/i,
  );
  assert.equal(processCalls, 0);
});

test("model validation rejects explicit non-text semantics in every selection and accepts text-compatible metadata", async (t) => {
  const fixture = await createConfigFixture(t);
  const selections = {
    codexModel: "good-codex",
    claudeModel: "good-main",
    claudeOpusModel: "good-opus",
    claudeSonnetModel: "good-sonnet",
    claudeHaikuModel: "good-haiku",
  };
  const compatibleModels = [
    { id: "good-codex", type: "chat" },
    { id: "good-main", modality: "text" },
    { id: "good-opus", capability: "completion" },
    { id: "good-sonnet", capabilities: ["chat", "response"] },
    { id: "good-haiku" },
  ];
  const rejected = [
    ["codexModel", { task: "text-to-image" }],
    ["claudeModel", { task: "text-to-video" }],
    ["claudeOpusModel", { task: "text-to-audio" }],
    ["claudeSonnetModel", { output_modality: "image" }],
    ["claudeHaikuModel", { capability: "text prompted image generation" }],
    ["codexModel", { output_modalities: ["video"] }],
    ["claudeModel", { metadata: { output_modality: "audio" } }],
  ];

  for (const [index, [selection, metadata]] of rejected.entries()) {
    const badId = `bad-${selection}-${index}`;
    await assert.rejects(
      configureAgents({
        ...fixture,
        ...selections,
        [selection]: badId,
        dryRun: true,
        fetchImpl: async () => jsonResponse({ data: [...compatibleModels, { id: badId, ...metadata }] }),
      }),
      new RegExp(`${badId}.*text|text.*${badId}`, "i"),
      `${selection}: ${JSON.stringify(metadata)}`,
    );
  }

  const result = await configureAgents({
    ...fixture,
    ...selections,
    dryRun: true,
    fetchImpl: async () => jsonResponse({ data: compatibleModels }),
  });
  assert.equal(result.codexModel, selections.codexModel);
  assert.equal(result.claudeModel, selections.claudeModel);
});

test("subprocesses receive no known credential variables or environment value equal to the API key", async (t) => {
  const fixture = await createConfigFixture(t);
  const calls = [];
  const spawnImpl = async (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(Object.values(options.env).includes(API_KEY), false);
    for (const name of ["KAIYUN_API_KEY", "KAIYUNCODE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) {
      assert.equal(Object.hasOwn(options.env, name), false, name);
    }
    assert.equal(JSON.stringify([command, args, options.env]).includes(API_KEY), false);
    if (args[0] === "login") {
      assert.equal(options.input, `${API_KEY}\n`);
      await fs.writeFile(fixture.codexAuth, "{}\n");
    } else {
      assert.equal(options.input, undefined);
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  await configureAgents({
    ...fixture,
    fetchImpl: validatingFetch(),
    spawnImpl,
    environment: {
      PATH: process.env.PATH,
      SAFE_VALUE: "keep",
      ACCIDENTAL_COPY: API_KEY,
      OPENAI_API_KEY: "different-secret",
      ANTHROPIC_AUTH_TOKEN: API_KEY,
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret",
    },
    now: () => FIXED_DATE,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.env.SAFE_VALUE, "keep");
});

test("successful configuration validates, backs up, uses stdin, and locks modes", async (t) => {
  const fixture = await createConfigFixture(t);
  const calls = [];
  const spawnImpl = async (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(command, "codex");
    assert.ok(!args.some((argument) => argument.includes(API_KEY)));
    assert.ok(!JSON.stringify({ command, args }).includes(API_KEY));
    if (args[0] === "login") {
      assert.deepEqual(args, ["login", "--with-api-key"]);
      assert.equal(options.input, `${API_KEY}\n`);
      assert.equal(options.env.CODEX_HOME, fixture.codexHome);
      await fs.writeFile(fixture.codexAuth, JSON.stringify({ OPENAI_API_KEY: API_KEY }));
    } else {
      assert.deepEqual(args, ["--strict-config", "--version"]);
      assert.equal(options.input, undefined);
    }
    return { status: 0, stdout: "ok", stderr: "" };
  };

  const result = await configureAgents({ ...fixture, fetchImpl: validatingFetch(), spawnImpl, now: () => FIXED_DATE });

  assert.equal(result.codexModel, "gpt-5.6-sol");
  assert.equal(result.claudeModel, "claude-opus-4-8");
  assert.equal(result.backups.length, 3);
  for (const backup of result.backups) {
    assert.match(backup.backupPath, /\.bak\.20260711T123456789Z$/);
    assert.equal((await fs.stat(backup.backupPath)).mode & 0o777, 0o600);
  }
  assert.equal(await fs.readFile(result.backups[0].backupPath, "utf8"), fixture.originalCodex);
  const configuredCodex = await fs.readFile(fixture.codexConfig, "utf8");
  assert.match(configuredCodex, /\[mcp_servers\.keep\]/);
  assert.match(configuredCodex, /\[desktop\][\s\S]*show-ultra-in-model-picker-slider = true/);
  assert.equal(JSON.parse(await fs.readFile(fixture.claudeSettings, "utf8")).permissions.allow[0], "Read");
  assert.equal(await fs.readFile(fixture.claudeJson, "utf8"), fixture.originalClaudeJson);
  assert.equal(calls.length, 2);
  for (const path of [fixture.codexConfig, fixture.codexAuth, fixture.claudeSettings]) {
    assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  }
});

test("strict validation failure restores all three contents and original modes", async (t) => {
  const fixture = await createConfigFixture(t);
  const spawnImpl = async (_command, args) => {
    if (args[0] === "login") {
      await fs.writeFile(fixture.codexAuth, JSON.stringify({ OPENAI_API_KEY: API_KEY }));
      await fs.chmod(fixture.codexAuth, 0o666);
      return { status: 0, stderr: "" };
    }
    return { status: 1, stderr: `validation failed for ${API_KEY}` };
  };

  await assert.rejects(
    configureAgents({ ...fixture, fetchImpl: validatingFetch(), spawnImpl, now: () => FIXED_DATE }),
    (error) => {
      assert.match(error.message, /validation failed/);
      assert.doesNotMatch(error.message, new RegExp(API_KEY));
      return true;
    },
  );
  assert.equal(await fs.readFile(fixture.codexConfig, "utf8"), fixture.originalCodex);
  assert.equal(await fs.readFile(fixture.codexAuth, "utf8"), fixture.originalAuth);
  assert.equal(await fs.readFile(fixture.claudeSettings, "utf8"), fixture.originalClaude);
  assert.equal((await fs.stat(fixture.codexConfig)).mode & 0o777, 0o640);
  assert.equal((await fs.stat(fixture.codexAuth)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(fixture.claudeSettings)).mode & 0o777, 0o644);
});

test("failed login removes an auth file that did not exist before the transaction", async (t) => {
  const fixture = await createConfigFixture(t);
  await fs.rm(fixture.codexAuth);
  const spawnImpl = async (_command, args) => {
    if (args[0] === "login") {
      await fs.writeFile(fixture.codexAuth, JSON.stringify({ OPENAI_API_KEY: API_KEY }));
      return { status: 1, stderr: `login rejected ${API_KEY}` };
    }
    assert.fail("strict validation must not run after login failure");
  };

  await assert.rejects(
    configureAgents({ ...fixture, fetchImpl: validatingFetch(), spawnImpl, now: () => FIXED_DATE }),
    (error) => {
      assert.match(error.message, /login rejected/);
      assert.doesNotMatch(error.message, new RegExp(API_KEY));
      return true;
    },
  );
  await assert.rejects(fs.stat(fixture.codexAuth), { code: "ENOENT" });
  assert.equal(await fs.readFile(fixture.codexConfig, "utf8"), fixture.originalCodex);
  assert.equal(await fs.readFile(fixture.claudeSettings, "utf8"), fixture.originalClaude);
  assert.equal((await fs.readdir(fixture.codexHome)).some((name) => name.includes(".tmp")), false);
  assert.equal((await fs.readdir(fixture.claudeHome)).some((name) => name.includes(".tmp")), false);
});

test("credential validation fails before backups, writes, or processes", async (t) => {
  const fixture = await createConfigFixture(t);
  let processCalls = 0;
  await assert.rejects(
    configureAgents({ ...fixture, fetchImpl: async () => jsonResponse({ error: "invalid" }, 401), spawnImpl: async () => { processCalls += 1; return { status: 0 }; }, now: () => FIXED_DATE }),
    /authentication failed/i,
  );
  assert.equal(processCalls, 0);
  assert.deepEqual((await fs.readdir(fixture.codexHome)).sort(), ["auth.json", "config.toml"]);
  assert.deepEqual(await fs.readdir(fixture.claudeHome), ["settings.json"]);
});

test("dry-run performs no filesystem mutation and no process calls", async (t) => {
  const fixture = await createConfigFixture(t);
  let processCalls = 0;
  const forbidden = ["appendFile", "chmod", "copyFile", "mkdir", "open", "rename", "rm", "unlink", "writeFile"];
  const fsImpl = { ...fs };
  for (const method of forbidden) fsImpl[method] = async () => assert.fail(`dry-run called fs.${method}`);

  const result = await configureAgents({ ...fixture, dryRun: true, fsImpl, fetchImpl: validatingFetch(), spawnImpl: async () => { processCalls += 1; return { status: 0 }; } });

  assert.equal(processCalls, 0);
  assert.deepEqual(result.backups, []);
  assert.equal(result.preview.codex.provider, "custom");
  assert.equal(result.preview.codex.modelCount, 5);
  assert.equal(result.preview.codex.catalog.models[0].slug, "gpt-5.6-sol");
  assert.equal(result.preview.claude.baseUrl, "https://kaiyuncode.com");
  assert.ok(!JSON.stringify(result).includes(API_KEY));
  assert.equal(await fs.readFile(fixture.codexConfig, "utf8"), fixture.originalCodex);
  assert.equal(await fs.readFile(fixture.claudeSettings, "utf8"), fixture.originalClaude);
});

test("Codex-only config installs a catalog without requiring or modifying Claude", async (t) => {
  const fixture = await createConfigFixture(t);
  const result = await configureAgents({ ...fixture, codexOnly: true,
    fetchImpl: async () => jsonResponse({ data: [
      { id: "gpt-5.6-sol", context_window: 123456, supported_reasoning_levels: ["low", "high"] },
      { id: "gpt-image-2", type: "image" },
    ] }),
    spawnImpl: async () => ({ status: 0 }),
  });
  const catalogPath = join(fixture.codexHome, "kaiyuncode-model-catalog.json");
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  assert.equal(catalog.models.length, 1);
  assert.equal(catalog.models[0].context_window, 123456);
  assert.equal((await fs.stat(catalogPath)).mode & 0o777, 0o600);
  const configuredCodex = await fs.readFile(fixture.codexConfig, "utf8");
  assert.match(configuredCodex, /model_catalog_json = /);
  assert.match(configuredCodex, /\[desktop\][\s\S]*show-ultra-in-model-picker-slider = true/);
  assert.equal(await fs.readFile(fixture.claudeSettings, "utf8"), fixture.originalClaude);
  assert.equal(result.preview.claude, null);
  assert.equal(result.claudeModel, null);
});

test("catalog participates in rollback, whether previously existing or newly created", async (t) => {
  for (const existing of [false, true]) {
    const fixture = await createConfigFixture(t);
    const path = join(fixture.codexHome, "kaiyuncode-model-catalog.json");
    if (existing) await fs.writeFile(path, '{"models":[]}\n', { mode: 0o640 });
    await assert.rejects(configureAgents({ ...fixture, fetchImpl: validatingFetch(),
      spawnImpl: async () => ({ status: 1, stderr: "login failed" }), now: () => FIXED_DATE,
    }), /login failed/);
    if (existing) {
      assert.equal(await fs.readFile(path, "utf8"), '{"models":[]}\n');
      assert.equal((await fs.stat(path)).mode & 0o777, 0o640);
      assert.equal(await fs.readFile(`${path}.bak.20260711T123456789Z`, "utf8"), '{"models":[]}\n');
    } else await assert.rejects(fs.stat(path), { code: "ENOENT" });
  }
});

test("catalog symlinks are rejected before mutation", async (t) => {
  const fixture = await createConfigFixture(t);
  await fs.symlink(fixture.claudeSettings, join(fixture.codexHome, "kaiyuncode-model-catalog.json"));
  await assert.rejects(configureAgents({ ...fixture, fetchImpl: validatingFetch(),
    spawnImpl: async () => assert.fail("must not spawn"),
  }), /symbolic link/);
  assert.equal(await fs.readFile(fixture.claudeSettings, "utf8"), fixture.originalClaude);
});

test("CLI accepts catalog controls", () => {
  assert.deepEqual(parseCliArgs(["--codex-only", "--model-capabilities=limits.json"]), { codexOnly: true, modelCapabilitiesFile: "limits.json" });
});

test("Claude model flags map only the documented settings fields", async (t) => {
  const fixture = await createConfigFixture(t);
  await configureAgents({ ...fixture, codexModel: "gpt-5.5", claudeModel: "claude-sonnet-5", claudeOpusModel: "claude-opus-4-8", claudeSonnetModel: "claude-sonnet-5", claudeHaikuModel: "claude-haiku-4-5", fetchImpl: validatingFetch(), spawnImpl: async () => ({ status: 0, stderr: "" }), now: () => FIXED_DATE });
  const settings = JSON.parse(await fs.readFile(fixture.claudeSettings, "utf8"));
  assert.equal(settings.model, "claude-sonnet-5");
  assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "claude-opus-4-8");
  assert.equal(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-sonnet-5");
  assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "claude-haiku-4-5");
  assert.equal(settings.env.KEEP, "yes");
});

test("CLI parser supports model flags and rejects plaintext key arguments", () => {
  assert.deepEqual(parseCliArgs(["--dry-run", "--codex-model", "gpt-5.5", "--claude-model=claude-sonnet-5", "--claude-opus-model", "claude-opus-4-8", "--claude-sonnet-model", "claude-sonnet-5", "--claude-haiku-model", "claude-haiku-4-5"]), {
    dryRun: true,
    codexModel: "gpt-5.5",
    claudeModel: "claude-sonnet-5",
    claudeOpusModel: "claude-opus-4-8",
    claudeSonnetModel: "claude-sonnet-5",
    claudeHaikuModel: "claude-haiku-4-5",
  });
  assert.throws(() => parseCliArgs(["--api-key", API_KEY]), /API Key.*argument/i);
  assert.throws(() => parseCliArgs(["--unknown"]), /unknown option/i);
});

test("hidden TTY input disables echo and never writes the API key", async () => {
  class FakeInput extends EventEmitter {
    isTTY = true;
    rawModes = [];
    setEncoding() {}
    setRawMode(value) { this.rawModes.push(value); }
    resume() {}
    pause() {}
  }
  const input = new FakeInput();
  let displayed = "";
  const promise = readHiddenApiKey({ input, output: { write: (value) => { displayed += value; } } });
  input.emit("data", `${API_KEY}\r`);
  assert.equal(await promise, API_KEY);
  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(displayed, "KaiyunCode API Key: \n");
  assert.doesNotMatch(displayed, new RegExp(API_KEY));
});


test("readApiKeyFromStdin reads a single line without echoing", async () => {
  async function* lines() {
    yield Buffer.from(`${API_KEY}\ntrailing-ignored\n`);
  }
  assert.equal(await readApiKeyFromStdin({ input: lines() }), API_KEY);
});

test("resolveApiKeyInput prefers env over stdin and TTY", async () => {
  const key = await resolveApiKeyInput({
    env: { KAIYUN_API_KEY: API_KEY },
    input: { isTTY: true },
  });
  assert.equal(key, API_KEY);
});

test("resolveApiKeyInput uses stdin when env is absent and input is not a TTY", async () => {
  async function* lines() {
    yield `${API_KEY}\n`;
  }
  const key = await resolveApiKeyInput({
    env: {},
    input: Object.assign(lines(), { isTTY: false }),
  });
  assert.equal(key, API_KEY);
});
