---
name: kaiyuncode-configure-agents
description: Use when configuring Codex or Claude Code to use KaiyunCode text models, changing their KaiyunCode provider settings, or validating an existing KaiyunCode client configuration.
---

# KaiyunCode Client Configuration

## Workflow

1. Before onboarding or inspecting credentials, ask: "你是否已经有 KaiyunCode API Key？"
2. If the user does not have a key, guide them in order to [register or sign in](https://kaiyuncode.com/?login=1), [recharge](https://kaiyuncode.com/pricing), and [create a key](https://kaiyuncode.com/account/api-key). Wait for them to finish.
3. Resolve this Skill's directory from this `SKILL.md`, then run `node <skill-dir>/scripts/configure-agents.mjs --dry-run`. Let the user enter the key in the hidden terminal prompt.
4. Show the redacted preview and explain that the real run replaces the active Codex login and stores the key in plaintext configuration files. Ask before continuing unless the user already confirmed this exact write.
5. Run the script again without `--dry-run`. Report backup paths and tell the user to restart Codex and Claude Code.

Use model override flags only when the user requests them; never add an API Key argument. Read [references/config-formats.md](references/config-formats.md) only when inspecting, troubleshooting, or explaining the exact merge.

Never read or rewrite the target files yourself. Never place an API key in command-line arguments, logs, or chat output.
