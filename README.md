# kaiyuncode-tools

KaiyunCode Agent Skills 插件：配置 Codex / Claude Code，并按生产教程调用异步图片与视频接口。

## 包含 Skills

| Skill | 用途 |
| --- | --- |
| `kaiyuncode-configure-agents` | 配置 Codex 与 Claude Code 使用 KaiyunCode |
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

安装与首次使用时会先询问是否已有 KaiyunCode API Key；没有密钥时引导注册、充值、创建密钥。

## 安全说明

- API Key 不要写进命令行参数或提交到仓库。
- 付费图片 / 视频请求必须先 dry-run，再取得用户明确授权后提交。
- 仓库不含真实密钥；`references/production-capabilities.json` 是公开生产教程与模型目录的已验证快照。

## 许可证

Private. All rights reserved.
