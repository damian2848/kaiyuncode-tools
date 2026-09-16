import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  mergeClaudeSettings,
  mergeCodexConfig,
} from "../shared/toml-edit.mjs";

test("Codex merge changes only documented root keys and one provider", () => {
  const input = [
    "# keep this comment",
    'model = "old" # replaced target',
    'model_provider = "openai"',
    'approval_policy = "on-request"',
    "",
    "[model_providers.kaiyuncode]",
    '# provider comment stays',
    'base_url = "https://old.example/v1"',
    'custom_header = "keep"',
    "",
    "[mcp_servers.docs]",
    'url = "https://example.test"',
    "",
    "[plugins.sample]",
    "enabled = true",
    "",
  ].join("\n");

  const output = mergeCodexConfig(input, { model: "gpt-5.6-sol" });

  assert.match(output, /^model_provider = "kaiyuncode"$/m);
  assert.match(output, /^model = "gpt-5\.6-sol" # replaced target$/m);
  assert.match(output, /^model_reasoning_effort = "xhigh"$/m);
  assert.match(output, /^disable_response_storage = true$/m);
  assert.match(output, /^model_verbosity = "high"$/m);
  assert.match(output, /^network_access = true$/m);
  assert.match(output, /^web_search = "live"$/m);
  assert.match(output, /\[model_providers\.kaiyuncode\][\s\S]*base_url = "https:\/\/kaiyuncode\.com\/v1"/);
  assert.match(output, /# provider comment stays/);
  assert.match(output, /custom_header = "keep"/);
  assert.match(output, /\[mcp_servers\.docs\]\nurl = "https:\/\/example\.test"/);
  assert.match(output, /\[plugins\.sample\]\nenabled = true/);
  assert.equal((output.match(/\[model_providers\.kaiyuncode\]/g) ?? []).length, 1);
  assert.doesNotMatch(output, /old\.example/);
});

test("Codex merge preserves unrelated CRLF text byte-for-byte", () => {
  const unrelated = '# exact comment\r\napproval_policy = "never"\r\n\r\n[mcp_servers.docs]\r\nurl = "https://docs.test"\r\n';
  const output = mergeCodexConfig(unrelated, { model: "gpt-5.6-sol" });
  assert.ok(output.includes(unrelated));
  assert.ok(!/(^|[^\r])\n/.test(output));
});

test("catalog settings remove global overrides, preserve comments and remain idempotent", () => {
  const source = 'model = "old"\r\nmodel_reasoning_effort = "xhigh" # old effort\r\nmodel_context_window = 1000000\r\nmodel_auto_compact_token_limit = 900000\r\nmodel_verbosity = "high"\r\nmodel_supports_reasoning_summaries = true\r\nmodel_reasoning_summary = "auto"\r\n[mcp_servers.keep]\r\nurl = "https://keep.test"\r\n';
  const options = { model: "gpt-5.6-sol", catalogPath: '/tmp/路径 with "quote"/catalog.json' };
  const output = mergeCodexConfig(source, options);
  assert.doesNotMatch(output, /^(model_reasoning_effort|model_context_window|model_auto_compact_token_limit|model_verbosity|model_supports_reasoning_summaries|model_reasoning_summary)\s*=/mu);
  assert.ok(output.includes('# old effort\r\n'));
  assert.ok(output.includes('[mcp_servers.keep]\r\nurl = "https://keep.test"'));
  assert.ok(output.includes(`model_catalog_json = ${JSON.stringify(options.catalogPath)}\r\n`));
  assert.equal(mergeCodexConfig(output, options), output);
  assert.equal(spawnSync("python3", ["-c", "import sys,tomllib;tomllib.loads(sys.stdin.read())"], { input: output }).status, 0);
});

test("Codex merge fails closed on duplicate or semantically ambiguous targets", () => {
  const rejected = [
    '[model_providers.kaiyuncode]\nname = "one"\n["model_providers"."kaiyuncode"]\nname = "two"\n',
    'model = "one"\nmodel = "two"\n',
    'model_providers.kaiyuncode.base_url = "https://example.test"\n',
    'model_providers = { kaiyuncode = { base_url = "https://example.test" } }\n',
    '[model_providers]\nkaiyuncode = { base_url = "https://example.test" }\n',
    '[model_providers]\nkaiyuncode.base_url = "https://example.test"\n',
    'model = "old"\n[model_providers.kaiyuncode]\nname = "one"\nname = "two"\n',
    '[[model_providers.kaiyuncode]]\nname = "one"\n',
    'model.variant = "conflicts with scalar target"\n',
    '["model"]\nvariant = "conflicts with scalar target"\n',
  ];

  for (const source of rejected) {
    assert.throws(
      () => mergeCodexConfig(source, { model: "gpt-5.6-sol" }),
      /ambiguous|duplicate/i,
      source,
    );
  }
});

test("Codex merge preserves unrelated dotted providers and is idempotent", () => {
  const input = '# model = "documentation only"\nmodel_providers.openai.base_url = "https://api.openai.com/v1"\n';
  const once = mergeCodexConfig(input, { model: "gpt-5.6-sol" });
  assert.match(once, /# model = "documentation only"/);
  assert.match(once, /model_providers\.openai\.base_url = "https:\/\/api\.openai\.com\/v1"/);
  assert.equal(mergeCodexConfig(once, { model: "gpt-5.6-sol" }), once);
});

test("Codex merge preserves multiline TOML and ignores target-like content inside it", () => {
  const source = 'instructions = """\nmodel = not-a-key\n[model_providers.kaiyuncode]\n"""\n';
  const output = mergeCodexConfig(source, { model: "gpt-5.6-sol" });
  assert.ok(output.includes(source));
  assert.equal((output.match(/\[model_providers\.kaiyuncode\]/gu) ?? []).length, 2);
});

test("Codex merge preserves escaped triple quotes and target-like multiline string content", () => {
  const source = [
    'text = """',
    'literal triple quote: \\""" stays inside',
    'model = "inside-string"',
    '"""',
    'after = "preserved"',
    '',
  ].join("\n");
  const output = mergeCodexConfig(source, { model: "gpt-5.6-sol" });
  assert.ok(output.includes(source));
  assert.match(output, /^model = "gpt-5\.6-sol"$/m);
  assert.equal((output.match(/^model = /gmu) ?? []).length, 2);
});

test("Codex merge preserves valid escaped quotes overlapping multiline terminators", () => {
  const sources = [
    `text = \"\"\"abc\\${'"'.repeat(4)}\nmodel = \"old\"\n`,
    `text = \"\"\"abc\\${'"'.repeat(5)}\nmodel = \"old\"\n`,
  ];

  for (const source of sources) {
    const textLine = source.slice(0, source.indexOf("\n") + 1);
    const output = mergeCodexConfig(source, { model: "gpt-5.6-sol" });
    assert.ok(output.includes(textLine), source);
    const parsed = spawnSync(
      "python3",
      ["-c", "import sys, tomllib; tomllib.loads(sys.stdin.read())"],
      { input: output, encoding: "utf8" },
    );
    assert.equal(parsed.status, 0, parsed.stderr || source);
  }
});

test("Codex merge preserves multiline arrays, inline tables, and unrelated quoted or dotted keys", () => {
  const source = [
    'hooks = [',
    '  { command = "notify", args = ["--message", "model = untouched"] },',
    '  { command = "audit", nested = { enabled = true } },',
    ']',
    '"quoted.key" = "preserved"',
    'service."dotted part".enabled = true',
    '"escaped\\u002Ekey" = "preserved"',
    'service."escaped\\u0020part".enabled = true',
    '',
  ].join("\n");
  const output = mergeCodexConfig(source, { model: "gpt-5.6-sol" });
  assert.ok(output.includes(source));
  assert.match(output, /^model = "gpt-5\.6-sol"$/m);
});

test("Codex merge rejects unsafe or empty model identifiers", () => {
  for (const model of ["", "  ", "bad\nmodel", "bad\u0000model"]) {
    assert.throws(() => mergeCodexConfig("", { model }), /model/i);
  }
});

test("Claude merge preserves all fields outside the explicit allowlist", () => {
  const source = {
    permissions: { allow: ["Read"] },
    enabledPlugins: { sample: true },
    sandbox: { enabled: true },
    model: "old-model",
    env: {
      KEEP_ME: "unchanged",
      ANTHROPIC_AUTH_TOKEN: "old-token",
      ANTHROPIC_BASE_URL: "https://old.test",
      ANTHROPIC_MODEL: "old-model",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "old-haiku",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "old-sonnet",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "old-opus",
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "preserve-name-field",
    },
  };

  const output = mergeClaudeSettings(source, {
    apiKey: "new-secret",
    model: "claude-opus-4-8",
    haikuModel: "claude-haiku-custom",
    sonnetModel: "claude-sonnet-5",
    opusModel: "claude-opus-4-8",
  });

  assert.deepEqual(output, {
    permissions: { allow: ["Read"] },
    enabledPlugins: { sample: true },
    sandbox: { enabled: true },
    model: "claude-opus-4-8",
    env: {
      KEEP_ME: "unchanged",
      ANTHROPIC_AUTH_TOKEN: "new-secret",
      ANTHROPIC_BASE_URL: "https://kaiyuncode.com",
      ANTHROPIC_MODEL: "claude-opus-4-8",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-custom",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "preserve-name-field",
    },
  });
  assert.equal(source.env.ANTHROPIC_AUTH_TOKEN, "old-token");
  assert.equal(source.model, "old-model");
});

test("Claude merge parses JSON and fails closed on invalid structures", () => {
  assert.deepEqual(
    mergeClaudeSettings('{"permissions":{},"env":{"KEEP":"yes"}}', {
      apiKey: "secret",
      model: "claude-opus-4-8",
    }),
    {
      permissions: {},
      model: "claude-opus-4-8",
      env: {
        KEEP: "yes",
        ANTHROPIC_AUTH_TOKEN: "secret",
        ANTHROPIC_BASE_URL: "https://kaiyuncode.com",
        ANTHROPIC_MODEL: "claude-opus-4-8",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-opus-4-8",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-4-8",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
      },
    },
  );
  assert.throws(() => mergeClaudeSettings("not-json", {}), /Claude settings JSON/);
  assert.throws(() => mergeClaudeSettings("[]", {}), /JSON object/);
  assert.throws(
    () => mergeClaudeSettings({ env: [] }, { apiKey: "secret", model: "model" }),
    /env.*object/i,
  );
});
