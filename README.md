# KaiyunTool

**让 AI 助手用 KaiyunCode 做图片、做视频，也能直接切换聊天模型。**

KaiyunTool（原 KaiyunCode Tools）是一套可独立安装的 Agent Skills。支持安装到 **Codex、Claude Code、OpenClaw、Grok Build、Hermes Agent**；聊天客户端自动接入目前支持 Codex、Claude Code 和 OpenClaw。

## 安装

把对应命令交给 AI 助手执行，或复制到终端。需要 **Node.js 20+ 和 Git**。

```bash
# OpenClaw
curl -fsSL https://raw.githubusercontent.com/damian2848/kaiyuntool/v1.0.1/scripts/install.sh | bash -s -- --agent openclaw

# Codex
curl -fsSL https://raw.githubusercontent.com/damian2848/kaiyuntool/v1.0.1/scripts/install.sh | bash -s -- --agent codex

# Claude Code
curl -fsSL https://raw.githubusercontent.com/damian2848/kaiyuntool/v1.0.1/scripts/install.sh | bash -s -- --agent claude
```

其他宿主将 `--agent` 改为 `grok` 或 `hermes`。支持 macOS、Linux、Windows WSL，也可指定自定义技能目录。

**安装完成会显示你能使用的功能和示例。新建一个助手会话，直接用中文说需求。** 安装本身不会切换当前模型，也不会发起付费生成。

## 可以做什么

- **图片创作与编辑**：文字生图、参考图编辑、多图参考，适合海报、商品图、插画等。
- **视频创作**：文字或参考素材生成视频，按模型支持的能力选择时长、画幅等参数。
- **查询与交付**：查询实时可用模型和价格，预览预算、查看任务进度、恢复下载。
- **接入聊天模型**：为 Codex、Claude Code、OpenClaw 配置 KaiyunCode，刷新模型目录。

直接试着说：

> 用 KaiyunCode 帮我做一张咖啡店开业海报，暖色调，先给我方案和费用。

> 把这张产品图做成 5 秒展示视频，先告诉我多少钱。

> 帮我把 OpenClaw 的模型只保留 KaiyunCode，让我在界面切换全部可用文本模型。

> 将 Codex 接入 KaiyunCode，刷新模型列表。

助手会先检查已有凭据。没有密钥时，在 [KaiyunCode 注册或登录](https://kaiyuncode.com/?login=1)，然后[创建 API Key](https://kaiyuncode.com/account/api-key)，按助手提示保存即可。实际调用按平台计费，可[查看价格和充值](https://kaiyuncode.com/pricing)。

图片和视频会先展示方案及预算，**经你确认后才生成**。参考素材可直接使用本机文件；客户端接入和模型刷新按你的请求直接执行，并备份原配置。

**Codex、OpenClaw 的 provider ID 统一使用 `custom`**，与 CC Switch 切换供应商时的标识保持一致，减少会话归属冲突；上游服务仍是 KaiyunCode。OpenClaw 模型引用为 `custom/<模型 ID>`，界面可能显示 Custom 分组。已有配置在下次接入或刷新时迁移，历史会话记录不会改写。

## OpenClaw：一个 KaiyunCode 分组，切换全部文本模型

配置时实时读取账户的 `GET /v1/models`，过滤图片/视频生成、向量和重排模型。模型数量和能力随账户及平台变化，不使用固定模型清单。

- **调用协议**：只选公开 `supportedWireApis` 声明的协议，优先 Responses，其次 Chat Completions，再其次 Anthropic Messages；每个模型单独配置。没有可用协议声明时跳过并说明原因。
- **推理强度**：按所选协议的公开档位、默认值生成 OpenClaw 的档位映射和默认强度；未声明档位不补造，也不把 Claude 原生思考预算当作 Responses 的 effort。
- **默认模型**：优先保留原默认模型在 KaiyunCode 上的同名版本，也可直接指定。
- **只保留 KaiyunCode**：同步清理其他 provider、代理模型缓存、旧模型列表及白名单，保留工作区、工具、渠道和 Gateway 设置。

配置后重新打开模型菜单即可切换；如果 Gateway 未自动重新加载，助手会重启并验证。旧会话若固定了模型，可在该会话重新选择，或使用 `/model default`。

OpenClaw 自身的 Ultra 多代理工作流与上游推理档位不同；原生预算/思考模式及部分 Chat 专用参数也有宿主限制。工具会报告无法表达的能力，不声称接口未提供的支持。详见 [OpenClaw 接入说明](docs/openclaw.md)。

## 更新与旧版迁移

升级到 1.0.1，重跑上面的安装命令即可。获取后续最新版本时，把 URL 中的 `v1.0.1` 改成 `main`。

原 `kaiyuncode-tools` 安装记录仍可识别。技能目录名称 `kaiyuncode-*`、`KAIYUN_API_KEY` 和凭据路径保留兼容；无本地修改的旧技能可直接升级。遇到本地改动，安装器会停止并提示，不覆盖你的修改。通过旧 Codex 插件安装的用户需禁用旧插件，避免技能重复。

## 开发

```bash
git clone https://github.com/damian2848/kaiyuntool.git
cd kaiyuntool
npm run build:skills
npm run validate
```

源码位于 `src/` 和 `shared/`；`skills/*/scripts/` 为随版本发布的独立副本。修改源码后先构建再验证。测试默认使用模拟接口，不调用付费上游。

[安装与迁移详情](docs/installation.md) · [OpenClaw 接入](docs/openclaw.md) · [Codex 模型说明](docs/codex-model-catalog.md) · [GitHub Releases](https://github.com/damian2848/kaiyuntool/releases)

许可证：Private. All rights reserved.
