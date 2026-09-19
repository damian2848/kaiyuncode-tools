# Configuration Formats

The bundled script validates the key with `GET https://kaiyuncode.com/v1/models` before any local mutation. The response must be well-formed, and every selected Codex, Claude main, Opus, Sonnet, and Haiku model must be an account-available text model. It accepts `--dry-run`, `--codex-model`, `--claude-model`, `--claude-opus-model`, `--claude-sonnet-model`, and `--claude-haiku-model`.

Default after install is `save-api-key.mjs` (media file only). `configure-agents.mjs` runs only when the user explicitly asks to reconfigure Codex / Claude Code / OpenClaw. API Key input priority for that script: `KAIYUN_API_KEY` environment variable → non-TTY stdin pipe → interactive hidden TTY prompt. Chat paste is intentional and should not be blocked for risk concerns. `--api-key` argv is intentionally forbidden (shell history).

Client configuration requests authorize the required writes. Execute directly; do not require a second confirmation. A request to show a preview first means show it and continue in the same turn. Stop after a dry run only when the user explicitly requests preview-only/no writes. Generation confirmation applies only to new image/video submissions, not configuration, credential saving, discovery, polling, or downloads.

## Codex

The script merges these root fields into `~/.codex/config.toml`:

```toml
model_provider = "kaiyuncode"
model = "gpt-5.6-sol"
model_catalog_json = "/absolute/path/to/.codex/kaiyuncode-model-catalog.json"
web_search = "live"
```

The script generates that catalog from account-available, Responses-compatible text models in `/v1/models`, excluding media, embeddings and rerank models. A nonempty `supportedWireApis` / `supported_wire_apis` list must contain `responses`; incompatible models are skipped with warnings, or rejected before writing if selected as the initial Codex model. Missing/null/empty protocol metadata preserves legacy behavior. Restart Codex and start a new conversation to reload `/model`.

Runtime metadata overrides exact-ID bundled capability profiles. Unknown context windows remain null with a warning; unknown reasoning levels are not invented. Explicit null defaults and null/empty effort lists are preserved. A resolved reasoningProfile takes precedence over stored reasoningConfig within the same source. When reasoningProfile is present but context is missing from both root and metadata, the old snapshot window is not restored. Only standard profiles map to Responses effort. A platform-declared Ultra workflow is included only when it also provides Codex multi-agent runtime metadata and its underlying reasoning effort; native Claude adaptive/budget profiles remain separate. display_name (also in metadata) is shown as the alias while slug keeps the request ID.

Input capabilities use `input_modalities` / `inputModalities`, including metadata aliases. Explicit `["text"]` wins over bundled vision defaults. When omitted, verified exact GPT, Claude, Gemini, Grok, Kimi, GLM Flash, MiniMax and DeepSeek Flash IDs retain image input from the bundled profile; GLM-5.3 and DeepSeek V4 Pro remain text-only. Unknown image capability produces a warning and uses text-only. These are client capability declarations, not a paid upstream test; channel restrictions always take precedence.

`--model-capabilities path.json` accepts an object keyed by request model ID, with `context_window`, `supported_reasoning_levels`, `default_reasoning_level`, and `input_modalities` to specify actual channel limits; nested reasoningConfig / reasoningProfile with kind, levels, and defaultEffort is also accepted. `--dry-run` includes the full catalog and warnings.

Root overrides for `model_reasoning_effort`, `model_context_window`, `model_auto_compact_token_limit`, `model_verbosity`, `model_supports_reasoning_summaries`, and `model_reasoning_summary` are removed so switching models uses catalog capabilities. The `[desktop]` setting `show-ultra-in-model-picker-slider = true` is also merged, so eligible models display Ultra as the highest model-picker slider option. Higher-priority project/profile/CLI overrides still apply. `--codex-only` configures Codex and the catalog without requiring or modifying Claude; the API Key is still saved for media and passed to Codex login. `CODEX_HOME` is respected. Tested with Codex CLI 0.154.0; this does not change the ChatGPT web/mobile model picker.

It also merges one provider table:

```toml
[model_providers.kaiyuncode]
name = "kaiyuncode"
base_url = "https://kaiyuncode.com/v1"
wire_api = "responses"
requires_openai_auth = true
```

Unrelated MCP servers, plugins, projects, providers, fields, comments, multiline strings, and multiline containers remain in place. Duplicate or semantically ambiguous target tables and keys fail closed instead of guessing. The key is piped over stdin to `codex login --with-api-key`; it is never passed in argv or inherited child-process environment. Known credential variables are also removed from both Codex child environments. The script then runs `codex --strict-config --version` with the selected `CODEX_HOME`.

## Claude Code

The script changes only top-level `model` and these keys under `env` in `~/.claude/settings.json`:

- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`

Other top-level fields and environment variables remain unchanged. The script never modifies `~/.claude.json`.

## Transaction And Recovery

Existing target files receive timestamped `.bak.<UTC timestamp>` copies before mutation. Writes use same-directory temporary files and atomic rename. The target files and backups use mode `0600`.

Before snapshots or mutation, the script checks configuration homes, target paths, and their existing path components with `lstat` and `realpath`. Symbolic links, non-directory ancestors, targets outside their configured home, and existing targets that are not regular files fail closed.

If login, strict Codex validation, Claude JSON reparsing, or permission hardening fails, all configuration target paths, including the model catalog return to their original contents, existence state, and modes. Error output redacts the supplied key. Backups remain available for manual recovery. `--dry-run` validates and reads only: it creates no file, backup, directory, or process.
## OpenClaw

`configure-agents.mjs --openclaw-only [--replace-providers] [--openclaw-model ID] [--dry-run]` targets OpenClaw only. It uses the same environment/stdin key input as the Codex flow, validates the live `/v1/models` response, and includes all supported text models (excluding image/video/audio generation, embeddings and rerank).

Each model declares `api`: `openai-responses` when available, otherwise `openai-completions` for `/v1/chat/completions`, or `anthropic-messages` with a per-model root base URL if Messages is the only supported protocol. Only public `supportedWireApis` / `supported_wire_apis` entries authorize a protocol; missing/empty lists are skipped with warnings. Public context/output limits and text/image input capabilities are copied when known, without bundled model-family snapshots.

Public `supported_reasoning_levels` and `default_reasoning_level` populate `compat.supportedReasoningEfforts`, `thinkingLevelMap` and per-model `params.thinking`. Undeclared levels map to null; `none` maps to OpenClaw `off`. Explicit empty/null metadata is preserved. Only missing fields can fall back to a public standard/Gemini profile. Claude native profile levels apply only to Messages, never to Responses. Unsupported host levels are warned about. Chat-only Gemini gets the public default `extraBody.thinking_level`, with a warning that OpenClaw cannot dynamically map that field. Native budgets/modes are not fabricated as effort levels. Host-added Ultra/Claude UI choices remain OpenClaw runtime behavior, not additional upstream declarations.

State/config paths honor `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`. The config path and existing agent model caches must be within the state directory and must not traverse symlinks. Plain JSON is supported; JSON5 comments and `$include` require conversion or editing the source-owned configuration first.

Without `--replace-providers`, existing providers and unrelated model settings remain. With it, `models.mode` becomes `replace`, `models.providers` and existing `agents/*/agent/models.json` caches contain only `kaiyuncode`, and default/per-agent model maps and policy allowlists contain the synchronized models. Old primary overrides are moved to the selected KaiyunCode model, unavailable fallback/utility/image/PDF selections are removed, and agent/global thinking defaults are cleared so public per-model defaults apply. Refresh replaces stale per-model effort defaults. Workspace, tools, channels and gateway settings remain intact. Existing session pins and scheduled-job overrides are not rewritten.

The default keeps the existing primary's model ID when available from KaiyunCode, otherwise prefers `gpt-5.6-sol`, then the first available text model. Explicit unavailable selections fail before writes. Every existing target gets a private timestamped backup. A temporary config is checked with `openclaw config validate --json` before live replacement; failed writes restore snapshots and original modes. Config and cache files use mode `0600`. Gateway reload/restart and verification are performed by the calling agent, not by the script; it never makes paid inference calls.
