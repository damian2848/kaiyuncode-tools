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

图片 / 视频 `--dry-run` **默认打印人类可读确认卡**（模型、参数、媒体、输出、prompt 摘要）。  
Agent 必须把确认卡贴进聊天，等用户「确认提交」后再去掉 `--dry-run`。  
需要机器可读完整 JSON 时加 `--json`。

## 多任务并发

图片 / 视频支持 `--jobs-file`：JSON 数组里有多少个独立任务，就启动多少路并发提交与轮询，不会串行等待。

## 说明

- 聊天框粘贴 API Key 是默认且推荐的录入方式。
- API Key 不要写进命令行参数或提交到仓库；回复中不要回显完整 Key。
- 付费图片 / 视频请求必须先 dry-run 确认卡，再取得用户明确授权后提交。
- 仓库不含真实密钥；`references/production-capabilities.json` 是公开生产教程与模型目录的已验证快照。

## 许可证

Private. All rights reserved.
