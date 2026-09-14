import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CredentialConflictError,
  CredentialNotFoundError,
  getDefaultCredentialFilePath,
  readApiKeyFile,
  resolveCredential,
  saveApiKeyFile,
} from "../shared/credentials.mjs";

async function createFixture(t, { codexConfig, codexKey, claudeSettings } = {}) {
  const root = await mkdtemp(join(tmpdir(), "kaiyun-credentials-"));
  const codexHome = join(root, ".codex");
  const claudeHome = join(root, ".claude");
  await mkdir(codexHome);
  await mkdir(claudeHome);
  if (codexConfig !== undefined) {
    await writeFile(join(codexHome, "config.toml"), codexConfig);
  }
  if (codexKey !== undefined) {
    await writeFile(
      join(codexHome, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: codexKey }),
    );
  }
  if (claudeSettings !== undefined) {
    await writeFile(
      join(claudeHome, "settings.json"),
      JSON.stringify(claudeSettings),
    );
  }
  t.after(() => rm(root, { recursive: true, force: true }));
  return { home: root, codexHome, claudeHome };
}

const kaiyunCodexConfig = `
model_provider = "kaiyuncode"

[model_providers.kaiyuncode]
base_url = "https://kaiyuncode.com/v1"
`;

test("env wins over file and ignores conflicting client keys", async (t) => {
  const homes = await createFixture(t, {
    codexConfig: kaiyunCodexConfig,
    codexKey: "codex-secret",
    claudeSettings: {
      env: {
        ANTHROPIC_BASE_URL: "https://kaiyuncode.com",
        ANTHROPIC_AUTH_TOKEN: "claude-secret",
      },
    },
  });
  const path = join(homes.codexHome, "kaiyun-tools.env");
  await saveApiKeyFile("file-secret", { path });

  assert.deepEqual(
    await resolveCredential({
      ...homes,
      env: { KAIYUN_API_KEY: "env-secret" },
      credentialFile: path,
    }),
    { apiKey: "env-secret", source: "env" },
  );
});

test("file is canonical when env is absent even if clients differ", async (t) => {
  const homes = await createFixture(t, {
    codexConfig: kaiyunCodexConfig,
    codexKey: "codex-secret",
    claudeSettings: {
      env: {
        ANTHROPIC_BASE_URL: "https://kaiyuncode.com",
        ANTHROPIC_AUTH_TOKEN: "claude-secret",
      },
    },
  });
  const path = join(homes.codexHome, "kaiyun-tools.env");
  await saveApiKeyFile("file-secret", { path });

  assert.deepEqual(
    await resolveCredential({
      ...homes,
      env: {},
      credentialFile: path,
    }),
    { apiKey: "file-secret", source: "file", path },
  );
});

test("client fallback uses codex then claude when media sources are empty", async (t) => {
  const codexAndClaude = await createFixture(t, {
    codexConfig: kaiyunCodexConfig,
    codexKey: "shared-fallback-key",
    claudeSettings: {
      env: {
        ANTHROPIC_BASE_URL: "https://kaiyuncode.com",
        ANTHROPIC_AUTH_TOKEN: "shared-fallback-key",
      },
    },
  });
  assert.deepEqual(
    await resolveCredential({ ...codexAndClaude, env: {} }),
    { apiKey: "shared-fallback-key", source: "codex" },
  );

  const claudeOnly = await createFixture(t, {
    claudeSettings: {
      env: {
        ANTHROPIC_BASE_URL: "https://kaiyuncode.com",
        ANTHROPIC_AUTH_TOKEN: "claude-only-key",
      },
    },
  });
  assert.deepEqual(await resolveCredential({ ...claudeOnly, env: {} }), {
    apiKey: "claude-only-key",
    source: "claude",
  });
});

test("differing client keys conflict only when media sources are empty", async (t) => {
  const homes = await createFixture(t, {
    codexConfig: kaiyunCodexConfig,
    codexKey: "key-a-secret",
    claudeSettings: {
      env: {
        ANTHROPIC_BASE_URL: "https://kaiyuncode.com/",
        ANTHROPIC_AUTH_TOKEN: "key-b-secret",
      },
    },
  });

  await assert.rejects(
    resolveCredential({ ...homes, env: {} }),
    (error) => {
      assert.ok(error instanceof CredentialConflictError);
      assert.deepEqual(error.sources, ["codex", "claude"]);
      assert.ok(!error.message.includes("key-a-secret"));
      assert.ok(!error.message.includes("key-b-secret"));
      assert.match(error.message, /save-api-key|canonical/i);
      return true;
    },
  );
});

test("preferSource selects an explicit source", async (t) => {
  const homes = await createFixture(t, {
    codexConfig: kaiyunCodexConfig,
    codexKey: "codex-secret",
    claudeSettings: {
      env: {
        ANTHROPIC_BASE_URL: "https://kaiyuncode.com",
        ANTHROPIC_AUTH_TOKEN: "claude-secret",
      },
    },
  });
  const path = join(homes.codexHome, "kaiyun-tools.env");
  await saveApiKeyFile("file-secret", { path });

  assert.deepEqual(
    await resolveCredential({
      ...homes,
      env: { KAIYUN_API_KEY: "env-secret" },
      credentialFile: path,
      preferSource: "file",
    }),
    { apiKey: "file-secret", source: "file", path },
  );

  assert.deepEqual(
    await resolveCredential({
      ...homes,
      env: { KAIYUN_API_KEY: "env-secret" },
      credentialFile: path,
      preferSource: "claude",
    }),
    { apiKey: "claude-secret", source: "claude" },
  );
});

test("preferSource missing source fails closed", async (t) => {
  const homes = await createFixture(t, {});
  await assert.rejects(
    resolveCredential({ ...homes, env: {}, preferSource: "file" }),
    { name: "CredentialNotFoundError" },
  );
});

test("Codex auth is unowned when config is absent", async (t) => {
  const homes = await createFixture(t, { codexKey: "unowned-codex-key" });
  await assert.rejects(resolveCredential({ ...homes, env: {} }), {
    name: "CredentialNotFoundError",
  });
});

test("Codex auth is unowned when the KaiyunCode provider is inactive", async (t) => {
  const homes = await createFixture(t, {
    codexConfig: `
model_provider = "openai"
[model_providers.openai]
base_url = "https://api.openai.com/v1"
[model_providers.kaiyuncode]
base_url = "https://kaiyuncode.com/v1"
`,
    codexKey: "inactive-kaiyun-key",
  });
  await assert.rejects(resolveCredential({ ...homes, env: {} }), {
    name: "CredentialNotFoundError",
  });
});

test("Codex auth requires the exact active KaiyunCode v1 base URL", async (t) => {
  const homes = await createFixture(t, {
    codexConfig: `model_provider = "kaiyuncode"\n[model_providers.kaiyuncode]\nbase_url = "https://kaiyuncode.com"\n`,
    codexKey: "wrong-base-path-key",
  });
  await assert.rejects(resolveCredential({ ...homes, env: {} }), {
    name: "CredentialNotFoundError",
  });
});

test("Codex and Claude generic credentials are ignored without KaiyunCode base URLs", async (t) => {
  const homes = await createFixture(t, {
    codexConfig: `model_provider = "openai"\n[model_providers.openai]\nbase_url = "https://api.openai.com/v1"\n`,
    codexKey: "openai-secret",
    claudeSettings: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        ANTHROPIC_AUTH_TOKEN: "anthropic-secret",
      },
    },
  });

  await assert.rejects(
    resolveCredential({ ...homes, env: {} }),
    (error) => {
      assert.ok(error instanceof CredentialNotFoundError);
      assert.ok(!error.message.includes("openai-secret"));
      assert.ok(!error.message.includes("anthropic-secret"));
      return true;
    },
  );
});

test("lookalike and insecure base URLs are not treated as KaiyunCode", async (t) => {
  const homes = await createFixture(t, {
    claudeSettings: {
      env: {
        ANTHROPIC_BASE_URL: "https://kaiyuncode.com.attacker.test",
        ANTHROPIC_AUTH_TOKEN: "stolen-secret",
      },
    },
  });

  await assert.rejects(resolveCredential({ ...homes, env: {} }), {
    name: "CredentialNotFoundError",
  });
});

test("saveApiKeyFile writes a private media credential file without agent config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kaiyun-save-key-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "kaiyun-tools.env");
  const result = await saveApiKeyFile("media-only-secret", { path });
  assert.equal(result.source, "file");
  assert.equal(result.path, path);
  assert.equal(await readApiKeyFile(path), "media-only-secret");
  const { mode } = await import("node:fs/promises").then((fs) => fs.stat(path));
  assert.equal(mode & 0o777, 0o600);
});

test("legacy kaiyun-video.env is still accepted", async (t) => {
  const homes = await createFixture(t, {});
  const legacy = join(homes.codexHome, "kaiyun-video.env");
  await writeFile(legacy, "KAIYUN_API_KEY=legacy-secret\n", { mode: 0o600 });
  assert.deepEqual(
    await resolveCredential({
      ...homes,
      env: {},
      credentialFile: join(homes.codexHome, "missing.env"),
      legacyCredentialFile: legacy,
    }),
    { apiKey: "legacy-secret", source: "file", path: legacy },
  );
});

test("default credential path uses an agent-neutral home", () => {
  assert.match(
    getDefaultCredentialFilePath("/tmp/demo-kaiyun"),
    /demo-kaiyun\/credentials\.env$/,
  );
});

test("neutral credentials take precedence over both legacy media files", async (t) => {
  const homes = await createFixture(t);
  const path = getDefaultCredentialFilePath(join(homes.home, ".config/kaiyuncode"));
  await saveApiKeyFile("neutral-key", { path });
  await writeFile(join(homes.codexHome, "kaiyun-tools.env"), "KAIYUN_API_KEY=old-key\n");
  await writeFile(join(homes.codexHome, "kaiyun-video.env"), "KAIYUN_API_KEY=older-key\n");
  assert.deepEqual(await resolveCredential({ ...homes, env: {} }), { apiKey: "neutral-key", source: "file", path });
  await rm(path);
  assert.equal((await resolveCredential({ ...homes, env: {} })).apiKey, "old-key");
  await rm(join(homes.codexHome, "kaiyun-tools.env"));
  assert.equal((await resolveCredential({ ...homes, env: {} })).apiKey, "older-key");
});

test("env and neutral file credentials do not read broken unrelated client configuration", async (t) => {
  const homes = await createFixture(t);
  await writeFile(join(homes.claudeHome, "settings.json"), "broken JSON");
  assert.equal((await resolveCredential({ ...homes, env: { KAIYUN_API_KEY: "env-key" } })).apiKey, "env-key");
  const path = getDefaultCredentialFilePath(join(homes.home, "custom"));
  await saveApiKeyFile("custom-key", { path });
  assert.deepEqual(await resolveCredential({ ...homes, env: { KAIYUN_HOME: join(homes.home, "custom") } }), { apiKey: "custom-key", source: "file", path });
});

test("CODEX_HOME legacy fallback and explicit source avoid other agent settings", async (t) => {
  const homes = await createFixture(t, { codexConfig: kaiyunCodexConfig, codexKey: "codex-key" });
  await writeFile(join(homes.claudeHome, "settings.json"), "broken JSON");
  const path = join(homes.codexHome, "kaiyun-tools.env");
  await saveApiKeyFile("legacy-key", { path });
  assert.deepEqual(await resolveCredential({ home: homes.home, env: { CODEX_HOME: homes.codexHome } }), { apiKey: "legacy-key", source: "file", path });
  assert.deepEqual(await resolveCredential({ ...homes, env: {}, preferSource: "codex" }), { apiKey: "codex-key", source: "codex" });
});
