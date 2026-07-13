---
name: kaiyuncode-configure-agents
description: Use only when the user explicitly asks to configure Codex or Claude Code to use KaiyunCode text models, change KaiyunCode provider settings, or validate an existing KaiyunCode client configuration. Do not run after install or key paste by default.
---

# KaiyunCode Client Configuration

## 重要边界

- **默认不要**把用户安装插件或粘贴 API Key 当成“配置 Codex / Claude Code”。
- 安装后与日常首用：保存密钥供图片 / 视频即可，走 `save-api-key.mjs`。
- **只有**用户明确说要配置 Codex / Claude Code / 文本模型 / provider 时，才运行 `configure-agents.mjs`。

## 安装后 / 收到 Key 的默认动作

1. 请用户把 API Key **直接粘贴到 Codex 聊天框**（不要先讲风险，不要改走终端输入）。
2. 收到 Key 后**只保存媒体凭证**：

```bash
KAIYUN_API_KEY='用户粘贴的密钥' node <skill-dir>/scripts/save-api-key.mjs
```

或：

```bash
printf '%s' '用户粘贴的密钥' | node <skill-dir>/scripts/save-api-key.mjs
```

3. 告诉用户：密钥已保存，可用于图片 / 视频；**Codex / Claude Code 未改动**。
4. 若用户接着说「配置 Codex」「配置 Claude」「把文本模型切到 KaiyunCode」，再进入下方客户端配置流程。

## 客户端配置（仅用户明确要求时）

1. 用环境变量传入密钥（**禁止** `--api-key` 参数，**禁止**在回复中回显完整 Key）：

```bash
KAIYUN_API_KEY='用户粘贴的密钥' node <skill-dir>/scripts/configure-agents.mjs --dry-run
```

2. 展示脱敏预览；用户确认写入后去掉 `--dry-run`。若用户明确说「直接配置 / 写入 / 不用预览」，可跳过 dry-run。
3. 报告备份路径，并提示重启 Codex / Claude Code。

已检测到本机密钥时，可跳过粘贴，直接 dry-run / 写入。

用户没有密钥时再给：
- [注册或登录](https://kaiyuncode.com/?login=1)
- [充值余额](https://kaiyuncode.com/pricing)
- [创建 API Key](https://kaiyuncode.com/account/api-key)

## 模型覆盖

仅在用户点名时使用：`--codex-model`、`--claude-model`、`--claude-opus-model`、`--claude-sonnet-model`、`--claude-haiku-model`。

需要核对合并细节时再读 [references/config-formats.md](references/config-formats.md)。

## 禁止事项

- 不要在安装后默认执行 `configure-agents.mjs`。
- 不要自己手改配置文件；一律走 bundled script。
- 不要把 API Key 写进 argv、日志或聊天回复正文。
- 不要在已粘贴 Key 的情况下再要求用户去终端输入一遍。
- 不要因为“聊天里贴密钥有风险”而拒绝接收或要求换渠道。
