---
name: kaiyuncode-image
description: Use when generating, editing, or composing images through a KaiyunCode asynchronous image model documented by the production tutorial, including dry-run request validation and concurrent multi-job generation.
---

# KaiyunCode Image

KaiyunCode image generation is asynchronous only. Use the bundled runner for
adapter selection, validation, submission, polling, and atomic result storage.
Never assemble a request from a model name.

## Credentials（快速）

1. 优先使用已配置的 `KAIYUN_API_KEY` / Codex / Claude 凭证。
2. 若缺失：请用户**直接把 API Key 粘贴到聊天框**，然后用环境变量运行本次命令（不要用 `--api-key` argv，不要回显完整 Key）。
3. 用户需要持久写入客户端配置时，再转 `kaiyuncode-configure-agents`；不要为了生成图片强制走完整配置仪式。
4. 若用户没有密钥，再给注册 / 充值 / 创建密钥链接。

## Workflow

1. Identify one of the four capabilities in [the production adapter reference](references/api.md).
2. Select an exact model listed for that capability. Never use `gpt-image-2-max`.
3. Collect only missing required fields. Prefer `--dry-run` first when the request is new or uncertain.
4. Before a paid POST, obtain fresh explicit authorization for this image work.
5. Run the bundled CLI. Report task IDs, statuses, redacted URLs, and absolute paths.

### 单任务

```bash
KAIYUN_API_KEY='...' node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --capability image_text_generation \
  --model gpt-image-2 \
  --prompt "A clean product photo" \
  --output ./result.png \
  --dry-run
```

### 多任务必须全并发

用户一次要生成多个**独立**图片任务时：

- **N 个任务 → N 路并发**，不要等第 1 个完成再提交第 2 个。
- 使用 `--jobs-file` 一次提交，或并行启动多个 CLI 进程。
- 单个失败不得取消其它任务；汇总每个任务的成功/失败结果。

```bash
# jobs.json 为数组，每一项是一个独立任务
KAIYUN_API_KEY='...' node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --jobs-file ./jobs.json
```

`jobs.json` 示例：

```json
[
  {
    "capability": "image_text_generation",
    "model": "gpt-image-2",
    "prompt": "red cup on white table",
    "output": "./cup.png"
  },
  {
    "capability": "image_text_generation",
    "model": "gpt-image-2",
    "prompt": "blue vase on marble",
    "output": "./vase.png"
  }
]
```

Resume one task without POST:

```bash
node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --task-id img_paid_123 \
  --output ./result.png
```

## Stop Conditions

- Stop if validation fails or the model/profile is absent from the production snapshot.
- Never automatically retry a paid POST timeout / 429 / 5xx.
- Do not run real paid requests just to test; use dry-run or mocks.

Never place an API key in command-line arguments, logs, or chat output.
