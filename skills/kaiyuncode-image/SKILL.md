---
name: kaiyuncode-image
description: Use when generating, editing, or composing images through a KaiyunCode asynchronous image model documented by the production tutorial, including dry-run request validation and concurrent multi-job generation.
---

# KaiyunCode Image

KaiyunCode image generation is asynchronous only. Use the bundled runner for
adapter selection, validation, submission, polling, and atomic result storage.
Never assemble a request from a model name.

## First-use guidance（必须）

用户第一次在本会话做图片，或本机还没有媒体密钥时：

1. 请用户把 API Key **粘贴到聊天框**。
2. 保存为权威媒体密钥：

```bash
KAIYUN_API_KEY='...' node <skill-dir>/../kaiyuncode-configure-agents/scripts/save-api-key.mjs
```

3. **不要**为了生图去改 Codex / Claude Code；只有用户明确要求时再转 `kaiyuncode-configure-agents`。
4. 用户没有密钥时再给注册 / 充值 / 创建密钥链接。

## Credentials

优先级：`KAIYUN_API_KEY` env → `~/.codex/kaiyun-tools.env` →（仅两者皆无）Codex/Claude KaiyunCode 配置。

有 env/file 时忽略 Claude/Codex 差异。可选：

```bash
--credential-source file|env|codex|claude
```

禁止 `--api-key` argv；禁止回显完整 Key。

## Workflow

1. Identify one of the four capabilities in [the production adapter reference](references/api.md).
2. Select an exact adapter model listed for that capability. Never use `gpt-image-2-max`; runtime availability is authoritative from `GET /v1/models`.
3. Collect only missing required fields.
4. **先 `--dry-run`**；它会用已保存 Key 只读请求 `/v1/models` 与 `/api/pricing`，默认输出实时单价、预计费用和预算上限的 **confirmCard**，不会发付费 POST。
5. **把 confirmCard 全文贴进聊天**，确认预计费用和预算上限均已明确，再索取「确认提交」。
6. 用户明确授权后去掉 `--dry-run` 提交；报告 task IDs、状态、脱敏 URL、绝对路径。

### 单任务

```bash
node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --capability image_text_generation \
  --model gpt-image-2 \
  --prompt "A clean product photo" \
  --output ./result.png \
  --dry-run
```

需要完整 JSON：`--dry-run --json`。

### 多任务必须全并发

```bash
node <skill-dir>/scripts/kaiyuncode-image.mjs --jobs-file ./jobs.json --dry-run
```

Resume:

```bash
node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --task-id img_paid_123 \
  --output ./result.png
```

## Stop Conditions

- Stop if validation fails, the adapter/profile is absent from the production snapshot, or the model is absent from runtime `GET /v1/models`.
- Treat `/api/pricing` as the only price source. Never fall back to a snapshot price; a paid POST must stop when pricing is missing.
- Never automatically retry a paid POST timeout / 429 / 5xx.
- Do not run real paid requests just to test; use dry-run or mocks.
- Do not submit while the budget ceiling is unknown.
- Do not submit without confirmCard + explicit user authorization.

Never place an API key in command-line arguments, logs, or chat output.
