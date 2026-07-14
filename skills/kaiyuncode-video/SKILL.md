---
name: kaiyuncode-video
description: Use when generating, extending, or recreating video through a KaiyunCode asynchronous video model documented by the production tutorial, including dry-run request validation and concurrent multi-job generation.
---

# KaiyunCode Video

KaiyunCode video generation is asynchronous only. Use the bundled runner for
adapter selection, validation, submission, polling, and atomic result storage.
Never assemble a request from a model name.

## First-use guidance（必须）

用户第一次在本会话做视频，或本机还没有媒体密钥时：

1. 请用户把 API Key **粘贴到聊天框**。
2. 保存为权威媒体密钥（不改 Codex / Claude 文本客户端）：

```bash
KAIYUN_API_KEY='...' node <skill-dir>/../kaiyuncode-configure-agents/scripts/save-api-key.mjs
```

3. 只有用户明确要求配置文本客户端时，再转 `kaiyuncode-configure-agents`。
4. 用户没有密钥时再给：注册 → 充值 → 创建 Key 链接。

## Credentials

媒体任务凭据优先级（**固定**）：

1. 本次 `KAIYUN_API_KEY` 环境变量
2. `~/.codex/kaiyun-tools.env`（权威文件；兼容 `kaiyun-video.env`）
3. 仅当 1/2 都没有时，才 fallback 到 Codex / Claude 的 KaiyunCode 配置

**不要**因为 Claude 与 file 密钥不同就卡住。有 file/env 时直接用，忽略客户端差异。
需要指定来源时：

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs ... --credential-source file
```

禁止 `--api-key` argv；禁止回显完整 Key。

## Workflow

1. Identify one of the eight capabilities in [the production adapter reference](references/api.md).
2. Select an exact adapter model for that capability; runtime availability is authoritative from `GET /v1/models`.
3. Collect only missing required fields.
4. **先 `--dry-run`**。它会用已保存 Key 只读请求 `/v1/models` 与 `/api/pricing`，CLI 默认打印人类可读 **confirmCard**（不是原始 JSON），不会发付费 POST。
5. **把 confirmCard 全文贴进聊天**，包含：任务数、capability、model、时长/分辨率/画幅、参考图、输出路径、prompt 摘要、`/api/pricing` 单价来源、预计费用、预算上限、凭据规则。
6. 确认预算上限已明确，且用户明确回复「确认提交」后，去掉 `--dry-run` 再 POST。
7. 报告 task IDs、状态、脱敏 URL、绝对路径。

### 单任务

```bash
# 默认输出确认卡（给用户看）
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --capability video_capability_video_text_generation \
  --model omni_flash \
  --prompt "A calm coastal drone shot at golden hour" \
  --output ./result.mp4 \
  --dry-run

# 需要完整 JSON 时再加 --json
node <skill-dir>/scripts/kaiyuncode-video.mjs ... --dry-run --json
```

### 多任务必须全并发

- N 个独立任务 → N 路并发（`--jobs-file`）。
- 单个失败不得取消其它任务。
- dry-run 的总确认卡必须展示全部任务。
- 同一批任务只读取一轮 `/v1/models` 与 `/api/pricing`。

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs --jobs-file ./jobs.json --dry-run
```

Resume:

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --task-id vid_paid_123 \
  --output ./result.mp4
```

## Stop Conditions

- Stop if validation fails, the selected adapter is unavailable, or the model is absent from runtime `GET /v1/models`.
- Treat `/api/pricing` as the only price source. Never fall back to a snapshot price; a paid POST must stop when pricing is missing.
- Never automatically retry a paid POST timeout / 429 / 5xx.
- Do not run real paid requests just to test; use dry-run or mocks.
- Do not submit while the budget ceiling is unknown.
- Do not submit after dry-run without pasting the confirmCard and getting explicit user authorization.

Never place an API key in command-line arguments, logs, or chat output.
