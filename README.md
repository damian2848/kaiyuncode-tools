# kaiyuncode-tools

KaiyunCode Agent Skills 插件：按生产教程调用异步图片与视频接口；可选配置 Codex / Claude Code。

## 包含 Skills

| Skill | 用途 |
| --- | --- |
| `kaiyuncode-configure-agents` | 默认只保存媒体密钥；**仅在用户明确要求时**配置 Codex / Claude Code |
| `kaiyuncode-image` | 异步图片生成 / 编辑 |
| `kaiyuncode-video` | 异步视频生成 / 编辑 / 续写 / 重创 |

## 本地开发

```bash
npm test
npm run sync:tutorial   # 刷新生产教程快照（需网络）
npm run validate
```

## 安装（Codex 个人 marketplace）

1. 将本仓库放到 `~/plugins/kaiyuncode-tools`，或在 `~/.agents/plugins/marketplace.json` 中指向本地路径。
2. 执行：

```bash
codex plugin add kaiyuncode-tools@personal
```

3. 安装完成后，在新的 Codex 对话里把 API Key **直接粘贴到聊天框**。Agent 默认只保存到 `~/.codex/kaiyun-tools.env` 供图片 / 视频使用，**不会**改 Codex / Claude Code。

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

图片 / 视频 `--dry-run` **默认打印人类可读确认卡**（概览、模型、参数、媒体、输出、prompt 摘要、公开单价、预计费用与预算上限）。

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
- 仓库不含真实密钥；`references/production-capabilities.json` 是公开生产教程的已验证请求结构快照。

## 许可证

Private. All rights reserved.
