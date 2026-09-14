---
name: kaiyuncode-configure-agents
description: Use only when the user explicitly asks to configure Codex or Claude Code to use KaiyunCode text models, change KaiyunCode provider settings, or validate an existing KaiyunCode client configuration. Do not run after install or key paste by default.
---

# KaiyunCode Client Configuration

## 运行环境

本 Skill 可独立安装到支持 Agent Skills 的 agent；不依赖 Codex 专属工具。需要 Node.js 20+、文件读写和联网执行命令的能力。`<skill-dir>` 指当前 `SKILL.md` 所在目录，执行时替换为实际绝对路径并正确引用空格路径；输出写到用户工作目录，不写入 Skill 安装目录。若运行在容器或远程 agent，Node、素材和凭据必须位于实际执行环境中。宿主没有命令执行能力时，说明缺少的能力，不声称已生成成品。

## 重要边界

- **默认不要**把安装 Skills或粘贴 API Key 当成“配置 Codex / Claude Code”。
- 安装后与日常首用：保存权威媒体密钥即可，走 `save-api-key.mjs`。
- **只有**用户明确说要配置 Codex / Claude Code / 文本模型 / provider 时，才运行 `configure-agents.mjs`。

## 权威密钥模型

用户粘贴的 Key 是通用密钥来源：

1. **媒体权威**：`~/.config/kaiyuncode/credentials.env`（`save-api-key.mjs`）
2. **文本客户端**（可选）：`configure-agents.mjs` 把同一 Key 写入 Codex / Claude

图片 / 视频 runner **优先 env > file**，不会因为 Claude 里有另一份旧 Key 而拒绝提交。

## 安装后 / 收到 Key 的默认动作

1. 请用户把 API Key **直接粘贴到聊天框**。
2. 收到后**只保存媒体权威凭证**：

```bash
KAIYUN_API_KEY='用户粘贴的密钥' node <skill-dir>/scripts/save-api-key.mjs
```

或：

```bash
printf '%s' '用户粘贴的密钥' | node <skill-dir>/scripts/save-api-key.mjs
```

3. 告诉用户：密钥已保存，可用于图片 / 视频；**Codex / Claude Code 未改动**。
4. 若用户接着说「配置 Codex」「配置 Claude」「把文本模型切到 KaiyunCode」，再进入客户端配置。

## 客户端配置（仅用户明确要求时）

```bash
KAIYUN_API_KEY='用户粘贴的密钥' node <skill-dir>/scripts/configure-agents.mjs --dry-run
```

展示脱敏预览；用户确认写入后去掉 `--dry-run`。报告备份路径，并提示重启客户端。

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

凭据目录可用 `KAIYUN_HOME` 覆盖，文件名固定为 `credentials.env`。新文件不存在时依次读取 `~/.codex/kaiyun-tools.env`、`~/.codex/kaiyun-video.env`（尊重 `CODEX_HOME`），再按原有规则尝试 Codex / Claude 的 KaiyunCode 凭据。安装或保存媒体 Key 不会配置任何 agent 的文本模型。
