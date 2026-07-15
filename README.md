# kaiyuncode-tools

KaiyunCode 全流程创作插件：从创意梳理、实时选模型和价格、预算确认，到异步生成、成品交付与迭代；可选配置 Codex / Claude Code。

## 包含 Skills

| Skill | 用途 |
| --- | --- |
| `kaiyuncode-create` | 总控创作助手：从模糊想法一路引导到图片或视频成品 |
| `kaiyuncode-configure-agents` | 默认只保存媒体密钥；**仅在用户明确要求时**配置 Codex / Claude Code |
| `kaiyuncode-image` | 异步图片生成 / 编辑 |
| `kaiyuncode-video` | 异步视频生成 / 编辑 / 续写 / 重创 |

## 本地开发

```bash
npm test
npm run sync:tutorial   # 刷新生产教程快照（需网络）
npm run validate
```

## 一键安装（推荐）

macOS / Linux 终端执行：

```bash
curl -fsSL https://raw.githubusercontent.com/damian2848/kaiyuncode-tools/main/scripts/install.sh | bash
```

该命令会把插件安装或更新到 `~/plugins/kaiyuncode-tools`，安全注册到 Codex 个人 marketplace，并验证安装结果。检测到本地修改、仓库来源不符或 marketplace 条目冲突时会停止，不会覆盖现有内容。

安装完成后，请新建 Codex 对话，让新插件生效。

## 手动安装（Codex 个人 marketplace）

1. 将本仓库放到 `~/plugins/kaiyuncode-tools`，或在 `~/.agents/plugins/marketplace.json` 中指向本地路径。
2. 执行：

```bash
codex plugin add kaiyuncode-tools@personal
```

3. 安装完成后，在新的 Codex 对话里直接描述想创作的内容。Agent 会先整理创意简报，进入实时选型时再检查 API Key；默认只保存到 `~/.codex/kaiyun-tools.env`，**不会**改 Codex / Claude Code。

## 全流程创作

```mermaid
flowchart LR
  A[创意简报] --> B[凭据就绪]
  B --> C[实时选型]
  C --> D[创作方案]
  D --> E[预算确认]
  E --> F[异步生成]
  F --> G[交付与迭代]
```

Agent 每轮只推进当前最早未完成阶段，不要求用户理解 capability、模型 ID 或命令行。确认卡展示后必须等待用户明确回复“确认提交”；模型、参数、素材、数量或预算发生变化时必须重新 dry-run。

图片、视频、音频和蒙版都可直接使用本机文件。Agent 不得要求用户先上传对象存储或自行准备公网 URL；Runner 会读取本机文件并封装为 KaiyunCode 可接收的媒体负载，由 KaiyunCode 转存为上游需要的公网资源。用户主动提供远程素材时仍只接受安全的 HTTPS URL。

只查看当前可用模型和价格，不进入生成：

```bash
node skills/kaiyuncode-image/scripts/kaiyuncode-image.mjs --list-models
node skills/kaiyuncode-video/scripts/kaiyuncode-video.mjs --list-models
```

加 `--capability KEY` 可只查看与当前创作方式兼容的候选。目录仅展示生产适配器与实时 `/v1/models` 的交集，单价只来自 `/api/pricing`。

## 凭据模型（0.1.3+）

媒体任务固定优先级：

1. 本次环境变量 `KAIYUN_API_KEY`
2. 权威文件 `~/.codex/kaiyun-tools.env`（兼容 `kaiyun-video.env`）
3. 仅当 1/2 都没有时，才 fallback 到 Codex / Claude 的 KaiyunCode 配置

有 env 或 file 时，**不会**因为 Claude/Codex 里另有不同 Key 而报冲突。  
需要强制某一来源时使用 `--credential-source env|file|codex|claude`。

```bash
KAIYUN_API_KEY='...' node skills/kaiyuncode-configure-agents/scripts/save-api-key.mjs
```

配置文本客户端（可选，用户明确要求时）：

```bash
KAIYUN_API_KEY='...' node skills/kaiyuncode-configure-agents/scripts/configure-agents.mjs --dry-run
```

## 提交前确认卡

图片 / 视频 `--dry-run` **默认打印人类可读确认卡**（概览、模型、参数、参考资源、输出、prompt 摘要、公开单价、预计费用与预算上限）。参考资源按图片、视频、音频和蒙版分类，列出数量与安全文件名；远程资源只显示文件名，不显示主机、查询参数或本地目录；没有素材时明确显示「参考资源：无」。

Agent 必须把确认卡贴进聊天，等用户「确认提交」后再去掉 `--dry-run`。

每个新任务（包括 `--dry-run`）都会使用当前 API Key 只读请求 `GET https://kaiyuncode.com/v1/models` 校验模型，并从 `GET https://kaiyuncode.com/api/pricing` 读取实时单价。dry-run 会联网，但不会发起任何付费 POST。

预算按实时平台单价和当前参数估算；无法精确匹配时显示价格区间或「待确认」，预算上限未明确时不得提交，最终以平台实际结算为准。静态生产快照只保存请求 adapter，不保存价格，也不作为运行时模型可用性的依据。

需要机器可读完整 JSON 时加 `--json`。

## 多任务并发

图片 / 视频支持 `--jobs-file`：JSON 数组里有多少个独立任务，就启动多少路并发提交与轮询，不会串行等待。
同一批任务共享一轮 `/v1/models` 与 `/api/pricing` 读取。

## 说明

- 聊天框粘贴 API Key 是默认且推荐的录入方式。
- API Key 不要写进命令行参数或提交到仓库；回复中不要回显完整 Key。
- 付费图片 / 视频请求必须先 dry-run 确认卡，再取得用户明确授权后提交。
- 仓库不含真实密钥；`references/production-capabilities.json` 是公开生产教程的已验证请求结构快照。运行时优先联网刷新教程适配器，离线时才回退该快照。

## 许可证

Private. All rights reserved.
