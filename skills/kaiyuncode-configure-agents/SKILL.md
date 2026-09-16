---
name: kaiyuncode-configure-agents
description: "仅在用户要求把 Codex 或 Claude Code 接入 KaiyunCode、刷新模型列表或检查客户端配置时使用。安装工具或只提供 API Key 不自动触发客户端配置。"
---

# KaiyunCode 接入设置

把用户要求的接入或模型刷新直接做完，用简短中文报告结果。配置请求即授权所需写入，不额外要求确认；不要制作完整模型报表。

需要 Node.js 20+、Codex CLI、文件读写和联网命令执行能力。`<skill-dir>` 是本 SKILL.md 的绝对目录，正确引用含空格路径；容器或远程环境也需具备这些条件。

## 配置

1. 使用已有凭据或用户已提供的 API Key，缺少时才询问；不要重复索要。通过 `KAIYUN_API_KEY` 或 stdin 提供给脚本，不放进 argv、日志或回复。没有 Key 时给出[创建入口](https://kaiyuncode.com/account/api-key)。
2. 仅配置或刷新 Codex 时运行：

```bash
node <skill-dir>/scripts/configure-agents.mjs --codex-only
```

脚本读取上述密钥输入，验证模型、备份、写入目录并登录。用户要求同时配置 Codex 和 Claude Code 时省略 `--codex-only`。当前脚本没有 Claude-only 模式：只要求 Claude 时不要顺带修改 Codex。

3. 用户点名模型才使用 `--codex-model` / `--claude-model` 或 Claude 分档选项。渠道能力覆盖用 `--model-capabilities`；模型未知警告不阻止已授权配置。
4. 成功后简述修改内容和备份路径，提示重启 Codex、新建会话，在 `/model` 切换模型。图片能力修复需要重新生成目录；仅更新 Skill 文件不生效。

“先预览”可先加 `--dry-run` 展示，再在同轮完成写入；只有明确“仅预览、不写入”才停止。校验、登录失败时说明错误与回滚情况。

## 只保存密钥

用户仅提供 Key 或安装工具时，使用 `scripts/save-api-key.mjs` 保存供图片/视频使用，不运行配置脚本。当前对话已要求客户端配置时，拿到 Key 后继续完成配置，不要求重复授权。

自带脚本负责配置合并、备份和恢复，不手改配置文件。详细字段、凭据来源和恢复机制见[配置说明](references/config-formats.md)。只有新的生图、生视频任务需要预算确认卡；本 Skill 的配置、刷新和校验不需要。
