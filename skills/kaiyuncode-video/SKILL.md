---
name: kaiyuncode-video
description: Use when generating, extending, or recreating video through a KaiyunCode asynchronous video model documented by the production tutorial, including dry-run request validation and concurrent multi-job generation.
---

# KaiyunCode Video

KaiyunCode video generation is asynchronous only. Use the bundled runner for
adapter selection, validation, submission, polling, and atomic result storage.
Never assemble a request from a model name.

## Credentials（快速）

1. 优先使用已配置的 `KAIYUN_API_KEY` / Codex / Claude 凭证。
2. 若缺失：请用户**直接把 API Key 粘贴到聊天框**，然后用环境变量运行本次命令（不要用 `--api-key` argv，不要回显完整 Key）。
3. 用户需要持久写入客户端配置时，再转 `kaiyuncode-configure-agents`。
4. 若用户没有密钥，再给注册 / 充值 / 创建密钥链接。

## Workflow

1. Identify one of the eight capabilities in [the production adapter reference](references/api.md). Keys use the form `video_capability_video_*`.
2. Select an exact model for that capability. Do not invent protocol from the model name.
3. Collect only missing required fields (`--prompt`, `--param`, `--image` / `--audio` / `--video`).
4. Prefer `--dry-run` first; obtain fresh explicit authorization before a paid POST.
5. Run the bundled CLI. Report task IDs, statuses, redacted URLs, and absolute paths.

### 单任务

```bash
KAIYUN_API_KEY='...' node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --capability video_capability_video_text_generation \
  --model omni_flash \
  --prompt "A calm coastal drone shot at golden hour" \
  --output ./result.mp4 \
  --dry-run
```

### 多任务必须全并发

用户一次要生成多个**独立**视频任务时：

- **N 个任务 → N 路并发**，不要串行等待。
- 使用 `--jobs-file` 一次提交，或并行启动多个 CLI 进程。
- 单个失败不得取消其它任务；汇总每个任务结果。

```bash
KAIYUN_API_KEY='...' node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --jobs-file ./jobs.json
```

Resume:

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --task-id vid_paid_123 \
  --output ./result.mp4
```

## Stop Conditions

- Stop if validation fails or the selected adapter is unavailable.
- Never automatically retry a paid POST timeout / 429 / 5xx.
- Do not run real paid requests just to test; use dry-run or mocks.

Never place an API key in command-line arguments, logs, or chat output.
