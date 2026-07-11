import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CredentialConflictError,
  CredentialNotFoundError,
  resolveCredential,
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
  return { codexHome, claudeHome };
}

const kaiyunCodexConfig = `
model_provider = "kaiyuncode"

[model_providers.kaiyuncode]
base_url = "https://kaiyuncode.com/v1"
`;

test("credential resolution applies env, Codex, then Claude priority when keys agree", async (t) => {
  const homes = await createFixture(t, {
    codexConfig: kaiyunCodexConfig,
    codexKey: "shared-key",
    claudeSettings: {
      env: {
        ANTHROPIC_BASE_URL: "https://kaiyuncode.com",
        ANTHROPIC_AUTH_TOKEN: "shared-key",
      },
    },
  });

  assert.deepEqual(
    await resolveCredential({
      ...homes,
      env: { KAIYUN_API_KEY: "shared-key" },
    }),
    { apiKey: "shared-key", source: "env" },
  );
});

test("credential resolution falls back from env to owned Codex then Claude", async (t) => {
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

test("environment conflicts with an owned active Codex credential", async (t) => {
  const homes = await createFixture(t, {
    codexConfig: kaiyunCodexConfig,
    codexKey: "codex-secret",
  });
  await assert.rejects(
    resolveCredential({ ...homes, env: { KAIYUN_API_KEY: "env-secret" } }),
    (error) => {
      assert.ok(error instanceof CredentialConflictError);
      assert.deepEqual(error.sources, ["env", "codex"]);
      assert.doesNotMatch(error.message, /codex-secret|env-secret/);
      return true;
    },
  );
});

test("different configured keys fail closed without exposing either value", async (t) => {
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
      return true;
    },
  );
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
