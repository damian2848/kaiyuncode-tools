---
name: kaiyuncode-image
description: "使用 KaiyunCode 异步图片模型生成、编辑、多图参考创作或生成组图，并完成实时模型与价格发现、提示词和素材准备、预算确认、异步提交、结果保存及迭代。用户已经明确要创作图片时使用；跨图片/视频或需要从模糊想法开始全流程引导时优先使用 kaiyuncode-create。"
---

# KaiyunCode Image

KaiyunCode image generation is asynchronous only. Use the bundled runner for
adapter selection, validation, submission, polling, and atomic result storage.
Never assemble a request from a model name.

跨图片 / 视频、第一次使用或尚未明确交付物时，先转 `kaiyuncode-create` 完成创意简报。本 Skill 负责已确定图片方向后的具体执行。

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

1. 从用户目标判断生成、编辑、多图参考或组图；先确认用途、画幅、数量和已有素材，不要求用户提供 capability 名称。
2. 映射到 [production adapter reference](references/api.md) 中的 capability，然后运行 `--list-models --capability KEY` 获取当前模型与实时价格。
3. 只从返回结果中给出最多 3 个候选，优先推荐 1 个；说明单价、适用理由和所需素材。Never use `gpt-image-2-max`。
4. 整理最终提示词、素材、关键参数和输出路径，只收集选定适配器缺少的必填字段。
   所有参考图和蒙版都可直接使用本机文件；不要要求用户先上传对象存储或准备公网 URL。Runner 会读取并封装本机文件，由 KaiyunCode 转存。
5. **先 `--dry-run`**；它会再次校验 `/v1/models` 与 `/api/pricing`，默认输出模型、参数、参考资源数量与安全文件名、实时单价、预计费用和预算上限的 **confirmCard**，不会发付费 POST；没有参考资源时明确显示「无」。
6. **把 confirmCard 全文贴进聊天**，确认预计费用和预算上限均已明确，再索取「确认提交」。确认卡展示后必须停止当前轮。
7. 用户明确授权后去掉 `--dry-run`，使用完全相同的参数提交；报告 task IDs、状态、脱敏 URL、绝对路径并展示图片。
8. 根据原目标给出不超过 3 个具体迭代方向。任何修改都属于新任务，必须重新 dry-run 和确认。

### 实时模型与价格

```bash
node <skill-dir>/scripts/kaiyuncode-image.mjs \
  --list-models --capability image_text_generation
```

用户只问模型或费用时，到这里即可。不要强迫进入生成流程。

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
