# kaiyuncode-tools

KaiyunCode Agent Skills 插件：按生产教程调用异步图片与视频接口；可选配置 Codex / Claude Code。

## 包含 Skills

| Skill | 用途 |
| --- | --- |
| `kaiyuncode-configure-agents` | **仅在用户明确要求时**配置 Codex / Claude Code；默认只保存媒体密钥 |
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

## 保存密钥（默认）

```bash
KAIYUN_API_KEY='...' node skills/kaiyuncode-configure-agents/scripts/save-api-key.mjs
```

## 配置客户端（可选，用户明确要求时）

```bash
KAIYUN_API_KEY='...' node skills/kaiyuncode-configure-agents/scripts/configure-agents.mjs --dry-run
```

只有用户明确说「没有密钥」时，才引导注册 → 充值 → 创建密钥。

## 多任务并发

图片 / 视频支持 `--jobs-file`：JSON 数组里有多少个独立任务，就启动多少路并发提交与轮询，不会串行等待。

## 说明

- 聊天框粘贴 API Key 是默认且推荐的录入方式；Agent 不得因“有风险”而拒绝接收。
- 安装 / 粘贴密钥默认只服务图片与视频，不默认重写 Codex / Claude Code。
- API Key 不要写进命令行参数或提交到仓库；聊天粘贴后由 Agent 通过 env/stdin 使用，回复中不要回显完整 Key。
- 付费图片 / 视频请求必须先 dry-run，再取得用户明确授权后提交。
- 仓库不含真实密钥；`references/production-capabilities.json` 是公开生产教程与模型目录的已验证快照。

## 许可证

Private. All rights reserved.
