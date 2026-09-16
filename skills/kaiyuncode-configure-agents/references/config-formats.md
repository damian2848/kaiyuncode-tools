# Configuration Formats

The bundled script validates the key with `GET https://kaiyuncode.com/v1/models` before any local mutation. The response must be well-formed, and every selected Codex, Claude main, Opus, Sonnet, and Haiku model must be an account-available text model. It accepts `--dry-run`, `--codex-model`, `--claude-model`, `--claude-opus-model`, `--claude-sonnet-model`, and `--claude-haiku-model`.

Default after install is `save-api-key.mjs` (media file only). `configure-agents.mjs` runs only when the user explicitly asks to reconfigure Codex / Claude Code. API Key input priority for that script: `KAIYUN_API_KEY` environment variable → non-TTY stdin pipe → interactive hidden TTY prompt. Chat paste is intentional and should not be blocked for risk concerns. `--api-key` argv is intentionally forbidden (shell history).

## Codex

The script merges these root fields into `~/.codex/config.toml`:

```toml
model_provider = "kaiyuncode"
model = "gpt-5.6-sol"
model_catalog_json = "/absolute/path/to/.codex/kaiyuncode-model-catalog.json"
disable_response_storage = true
network_access = true
web_search = "live"
```

The script generates that catalog from all account-available text models in `/v1/models`, excluding media, embeddings and rerank models. Restart Codex to reload it for `/model`. Runtime metadata overrides exact-ID bundled capability profiles. Unknown context windows remain null with a warning; unknown reasoning levels are not invented. The new platform contract preserves explicit null defaults and null/empty effort lists. When reasoningProfile is present but context is omitted, the old snapshot window is not restored. Only standard reasoning profiles map to Responses effort; native Claude adaptive/budget profiles and Ultra workflows do not. display_name is shown as the alias while slug keeps the request ID. `--model-capabilities path.json` accepts an object keyed by request model ID, with `context_window`, `supported_reasoning_levels`, and optionally `default_reasoning_level` to specify actual channel limits; nested reasoningConfig / reasoningProfile with kind, levels, and defaultEffort is also accepted. `--dry-run` includes the full catalog and warnings.

Root overrides for `model_reasoning_effort`, `model_context_window`, `model_auto_compact_token_limit`, `model_verbosity`, `model_supports_reasoning_summaries`, and `model_reasoning_summary` are removed so switching models uses catalog capabilities. Higher-priority project/profile/CLI overrides still apply. `--codex-only` configures Codex and the catalog without requiring or modifying Claude; the API Key is still saved for media and passed to Codex login. `CODEX_HOME` is respected. Tested with Codex CLI 0.154.0; this does not change the ChatGPT web/mobile model picker.

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
