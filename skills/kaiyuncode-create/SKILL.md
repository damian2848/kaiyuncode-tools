---
name: kaiyuncode-create
description: "使用 KaiyunCode 从一个想法完成图片或视频创作，或查询可用模型和价格。适合首次使用、尚未选模型或跨图片与视频的需求。"
---

# KaiyunCode 创作助手

用自然语言把需求推进到成品。不要要求用户学习模型 ID、capability 或命令行；不必逐轮报告阶段，只问当前缺少的必要信息。

需要 Node.js 20+、文件读写和联网命令执行能力；容器或远程环境中也需具备。`<skill-dir>` 是本 SKILL.md 的绝对目录，路径含空格时正确引用；成品写到用户工作目录。使用自带 Runner，按适配器构造请求，不按模型名拼 API。

先查询已有凭据；缺少时才请用户提供 API Key，通过 `KAIYUN_API_KEY` 或 stdin 交给 `scripts/save-api-key.mjs`。不回显密钥、不放进 argv。凭据优先 env > file，旧 Codex/Claude 凭据仅作回退；安装或保存密钥不自动切换文本客户端。用户没有 Key 时提供[创建入口](https://kaiyuncode.com/account/api-key)。

## 创作流程

1. **创意简报**：从对话提取用途、风格、数量、画幅、视频时长和素材；合理默认值直接说明，避免问卷式追问。
2. **实时选型**：按需读[图片参数](references/image-api.md)或[视频参数](references/video-api.md)，选择 capability；用自带 `scripts/kaiyuncode-image.mjs` 或 `scripts/kaiyuncode-video.mjs` 的 `--list-models --capability KEY` 查询。只从实时结果中推荐，最多三个候选，优先一个，不编造质量或速度差异。只问模型或价格时到此即可。
3. **准备方案**：整理提示词、素材、规格和输出路径，不擅改用户指定的品牌、人物、产品或文字。本机文件直接交给 Runner，由 KaiyunCode 转存；远程素材使用 HTTPS。只补问适配器必填项，批量任务用 `--jobs-file` 并发执行。
4. **预算确认**：执行 `--dry-run`，把确认卡全文贴给用户，保留参考资源的分类数量、安全文件名（没有则为“无”）、预计费用与预算上限。展示后停止本轮；收到针对该卡的明确提交授权才去掉 `--dry-run`，使用完全相同参数提交。改变任务内容须重新预览和确认。
5. **生成与交付**：报告 task ID、状态和成品绝对路径，展示成品；URL 需脱敏，费用以实际结算为准。
6. **迭代**：围绕用户目标提出简短建议；再次生成需新的预算确认。已有 task ID 直接 `--task-id ID --output PATH` 恢复查询，不重复提交。

## 执行边界

- 查询、保存密钥、用户要求的配置、已有任务轮询和下载直接执行，不加二次确认；明确“仅预览”才停在预览。
- 只有新生图、生视频需要上述确认卡和提交授权；价格只取实时 `/api/pricing`，缺价或预算上限不明时不提交。
- 模型不在实时列表、适配器不可用或校验失败时停止并说明原因；不要使用已退役的 `gpt-image-2-max`。
- 付费 POST 超时、429 或 5xx 不自动重试；保留任务信息，能恢复查询时恢复，避免重复扣费。不要为测试调用付费生成。
- 客户端配置仅在用户要求时使用可用的 `kaiyuncode-configure-agents`；未安装则说明缺少该组件。

命令细节用对应 Runner 的 `--help`；凭据目录默认 `~/.config/kaiyuncode/`，可用 `KAIYUN_HOME` 覆盖。
