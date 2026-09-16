# KaiyunCode Tools

让你的 AI 助手帮你**做图片、做视频，也能接入 KaiyunCode 的聊天模型**。用中文说需求就行。

支持 Codex、Claude Code、Grok Build、OpenClaw 和 Hermes Agent。

## 1. 安装

以 Codex 为例，把下面的命令交给 AI 助手执行，或复制到终端运行：

```bash
curl -fsSL https://raw.githubusercontent.com/damian2848/kaiyuncode-tools/main/scripts/install.sh | bash -s -- --agent codex
```

用 Claude Code？把最后的 `codex` 改成 `claude`。其他助手对应 `grok`、`openclaw`、`hermes`。

需要 Node.js 20+ 和 Git；不确定是否装好，让助手先检查。支持 macOS、Linux 和 Windows WSL。装好后**新建一个对话**。

## 2. 开始使用

先在 [KaiyunCode](https://kaiyuncode.com/?login=1) 注册或登录，再 [创建 API Key](https://kaiyuncode.com/account/api-key)（连接账户用的密钥），按助手提示完成设置。实际调用按平台价格扣费，可 [查看价格和充值](https://kaiyuncode.com/pricing)。

然后直接说：

> 用 KaiyunCode 帮我做一张咖啡店开业海报，暖色调，先告诉我多少钱。

> 用 KaiyunCode 把这张产品图做成 5 秒展示视频，先给我方案和费用。

> 帮我把 Codex 接入 KaiyunCode，让我能切换可用模型。

图片、视频和参考素材可以直接用本机文件。助手会帮你选模型、写提示词，**展示费用后，经你确认才开始生成**。

接入聊天模型后，重启 Codex、新建对话，在 `/model` 里切换；支持看图的模型会保留图片输入。安装工具本身不会切换你正在用的模型。

## 3. 更新

**重新运行安装命令，再新建对话**即可更新。

旧版配置后不能输入图片？更新后对助手说：

> 刷新我的 KaiyunCode 模型列表，修复支持看图的模型无法输入图片的问题。

完成后重启 Codex、新建对话。若提示安装冲突，把报错交给助手处理并保留本地修改。

[详细安装与常见问题](docs/installation.md) · [模型说明](docs/codex-model-catalog.md) · [版本更新](https://github.com/damian2848/kaiyuncode-tools/releases)

许可证：Private. All rights reserved.
