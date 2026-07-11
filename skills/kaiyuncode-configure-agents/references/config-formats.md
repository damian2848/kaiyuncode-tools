# Configuration Formats

The bundled script validates the key with `GET https://kaiyuncode.com/v1/models` before any local mutation. The response must be well-formed, and every selected Codex, Claude main, Opus, Sonnet, and Haiku model must be an account-available text model. It accepts `--dry-run`, `--codex-model`, `--claude-model`, `--claude-opus-model`, `--claude-sonnet-model`, and `--claude-haiku-model`.

API Key input priority: `KAIYUN_API_KEY` environment variable → non-TTY stdin pipe → interactive hidden TTY prompt. Users may paste the key in chat; the agent then supplies it via env or stdin. `--api-key` argv is intentionally forbidden (shell history).

## Codex

The script merges these root fields into `~/.codex/config.toml`:

```toml
model_provider = "kaiyuncode"
model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"
disable_response_storage = true
model_verbosity = "high"
network_access = true
web_search = "live"
```

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

If login, strict Codex validation, Claude JSON reparsing, or permission hardening fails, all three target paths return to their original contents, existence state, and modes. Error output redacts the supplied key. Backups remain available for manual recovery. `--dry-run` validates and reads only: it creates no file, backup, directory, or process.
