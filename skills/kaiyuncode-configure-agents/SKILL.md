---
name: kaiyuncode-configure-agents
description: Use when configuring Codex or Claude Code to use KaiyunCode text models, changing their KaiyunCode provider settings, or validating an existing KaiyunCode client configuration.
---

# KaiyunCode Client Configuration

## Fast path（推荐）

1. **直接请用户把 API Key 粘贴到聊天框。** 不要要求终端隐藏输入，不要先跑冗长的注册问答。
2. 若用户回复「没有密钥 / 还没有」，再按顺序给出：
   - [注册或登录](https://kaiyuncode.com/?login=1)
   - [充值余额](https://kaiyuncode.com/pricing)
   - [创建 API Key](https://kaiyuncode.com/account/api-key)  
   用户拿到 Key 后继续粘贴到聊天框即可。
3. 收到 Key 后**立即**进入配置，不要再反复确认「是否已有密钥」。
4. 用环境变量传入密钥（**禁止** `--api-key` 参数，**禁止**在回复中回显完整 Key）：

```bash
KAIYUN_API_KEY='用户粘贴的密钥' node <skill-dir>/scripts/configure-agents.mjs --dry-run
```

也可管道：

```bash
printf '%s' '用户粘贴的密钥' | node <skill-dir>/scripts/configure-agents.mjs --dry-run
```

5. 展示脱敏预览；用户确认写入后去掉 `--dry-run` 真正执行。若用户明确说「直接配置 / 写入 / 不用预览」，可跳过 dry-run。
6. 报告备份路径，并提示重启 Codex / Claude Code。

已检测到本机密钥时，可跳过粘贴，直接 dry-run / 写入。

## 模型覆盖

仅在用户点名时使用：`--codex-model`、`--claude-model`、`--claude-opus-model`、`--claude-sonnet-model`、`--claude-haiku-model`。

需要核对合并细节时再读 [references/config-formats.md](references/config-formats.md)。

## 禁止事项

- 不要自己手改配置文件；一律走 bundled script。
- 不要把 API Key 写进 argv、日志或聊天回复正文。
- 不要在已粘贴 Key 的情况下再要求用户去终端输入一遍。
