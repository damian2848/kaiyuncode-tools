---
name: kaiyuncode-configure-agents
description: "仅在用户要求把 Codex、Claude Code 或 OpenClaw 接入 KaiyunCode、刷新模型列表或检查客户端配置时使用。安装工具或只提供 API Key 不自动触发客户端配置。"
---

# KaiyunCode 接入设置

把用户要求的接入或模型刷新直接做完，用简短中文报告结果。配置请求即授权所需写入，不额外要求确认；不要制作完整模型报表。

需要 Node.js 20+、目标客户端 CLI、文件读写和联网命令执行能力。`<skill-dir>` 是本 SKILL.md 的绝对目录，正确引用含空格路径；容器或远程环境也需具备这些条件。

Codex、OpenClaw 的客户端 provider ID 均使用 `custom`，与 CC Switch 保持一致，减少供应商切换时的会话归属冲突。服务地址仍为 KaiyunCode。脚本迁移旧 OpenClaw 模型引用及缓存，保留 Codex 旧 provider 表；不改写历史会话记录或固定值。

## OpenClaw 配置或刷新

使用已有 KaiyunCode 密钥，通过 `KAIYUN_API_KEY` 或 stdin 传入。仅配置 OpenClaw：

```bash
node <skill-dir>/scripts/configure-agents.mjs --openclaw-only
```

用户要求「只保留 KaiyunCode」时加 `--replace-providers`，清理其他 provider 和每个代理的旧模型列表、默认值及白名单。默认保留原模型的同名 KaiyunCode 版本；点名模型时用 `--openclaw-model`。脚本实时获取全部兼容文本模型，只按公开协议声明选择 Responses / Chat Completions / Messages，并同步所选协议的推理档位与默认强度；不拿原生 Claude 预算冒充 Responses effort。备份并更新主配置与各代理模型缓存，通过 OpenClaw CLI 校验；不改 Codex/Claude。报告能力未声明、宿主不支持等警告，不手工补造档位。

完成后检查 `openclaw models list --json` 和 Gateway 的 `models.list`；若运行中的 Gateway 未更新，重启并确认健康。界面模型菜单应只有所需分组并包含实时模型。已有会话的模型固定值不会自动清除，必要时在目标会话选择新模型或 `/model default`。JSON5、include 配置和自定义配置路径限制见[配置说明](references/config-formats.md)的 OpenClaw 部分。

## Codex / Claude Code 配置

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
