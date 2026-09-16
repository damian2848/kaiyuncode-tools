---
name: kaiyuncode-video
description: "用户明确要用 KaiyunCode 生成或编辑视频、查询视频模型价格或恢复已有任务时使用。跨图片与视频的创作需求使用 kaiyuncode-create。"
---

# KaiyunCode 视频

用中文理解需求并直接准备方案，不让用户选择技术参数名；只询问必要的缺项。

需要 Node.js 20+、文件读写和联网命令执行能力；容器或远程环境中也需具备。`<skill-dir>` 是本 SKILL.md 的绝对目录，路径含空格时正确引用；成品写到用户工作目录。使用自带 Runner，按适配器构造请求，不按模型名拼 API。

先查询已有凭据；缺少时才请用户提供 API Key，通过 `KAIYUN_API_KEY` 或 stdin 交给 `scripts/save-api-key.mjs`。不回显密钥、不放进 argv。凭据优先 env > file，旧 Codex/Claude 凭据仅作回退；安装或保存密钥不自动切换文本客户端。用户没有 Key 时提供[创建入口](https://kaiyuncode.com/account/api-key)。

## 工作流程

1. 根据用途、风格、规格和素材，读取[适配器参数](references/api.md)选择 capability，然后查询实时可用模型和价格：

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs --list-models --capability video_capability_video_text_generation
```

2. 从返回结果中推荐一个合适模型，必要时给最多三个候选；只问价格时完成查询即可。不编造质量或速度差异，不使用退役的 `gpt-image-2-max`。
3. 整理提示词、参数和输出路径。参考素材可直接使用本机文件，由 Runner 封装、KaiyunCode 转存；远程素材使用 HTTPS。保留用户指定的品牌、人物、产品和文字，参数以适配器为准。
4. 新任务先 `--dry-run`，将确认卡全文贴到聊天中，包含参考素材的分类数量和安全文件名（没有则为“无”）、预计费用和预算上限。展示后停止本轮；用户明确授权当前确认卡后，使用完全相同参数去掉 `--dry-run` 提交。任何任务变更须重新预览和确认。
5. 交付 task ID、状态和成品绝对路径，展示文件，结果 URL 脱敏，费用以实际结算为准。后续修改若需再次生成，重新确认预算。

批量任务用 `--jobs-file` 并发，确认卡覆盖全部任务，一个失败不取消其余任务。已有任务直接恢复，不再次提交：

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs --task-id TASK_ID --output ./result.mp4
```

## 执行边界

- 只有新生图、生视频需要费用确认；查询、保存密钥、用户要求的配置、已有任务轮询和下载直接完成，不增加审批步骤。
- 价格只取实时 `/api/pricing`。缺价、预算上限未知、模型不在实时列表、适配器不可用或校验失败时不提交。
- 不自动重试付费 POST（包括超时、429、5xx），不为测试发起真实生成；保留任务信息用于恢复。
- 客户端配置仅在用户要求时使用可用的 `kaiyuncode-configure-agents`；未安装则说明缺少该组件。

命令选项见 `node <skill-dir>/scripts/kaiyuncode-video.mjs --help`。`--dry-run --json` 可取完整结果；凭据目录可用 `KAIYUN_HOME` 覆盖。
