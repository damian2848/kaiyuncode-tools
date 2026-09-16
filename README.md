# KaiyunCode Tools

为你的 AI Agent 接入 KaiyunCode：用自然语言创作图片和视频，也能把账户可用的文本模型加入 Codex 的 `/model` 菜单。

支持 **Codex · Claude Code · Grok Build · OpenClaw · Hermes Agent**。四个独立 [Agent Skills](https://agentskills.io/specification) 自带脚本与参考资料，安装后即可使用，无需安装 npm 运行时依赖。

[安装](#安装) · [图片与视频创作](#图片与视频创作) · [Codex 模型目录](#codex-模型目录) · [API Key](#api-key) · [更新与迁移](#更新与迁移)

## 功能

- **图片创作**：文生图、图片编辑、多图参考、组图和电商素材。
- **视频创作**：文生视频、图生视频、首尾帧、参考创作、续写和复刻，具体能力以实时可用模型为准。
- **实时选型与预算**：查询可用媒体模型和价格，整理提示词、参数及素材，预览费用后提交。
- **本地素材与批量任务**：直接使用本机图片、视频、音频和蒙版；支持并发生成、按 task ID 恢复查询及保存结果。
- **Codex 文本模型目录**：生成 `model_catalog_json`，按账户权限列出全部文本模型，读取平台声明的思考档位和上下文长度。
- **客户端配置**：可单独配置 Codex，或同时配置 Codex 与 Claude Code；写入前备份，失败时回滚。

只有提交生图、生视频任务需要确认。配置 Codex、保存密钥、刷新模型目录、查询模型与价格、恢复轮询和下载结果，按用户请求直接完成；明确要求“仅预览、不写入”时才停在预览。

## 安装

需要 **Node.js 20+、Git**，以及能执行命令、读写文件和访问 HTTPS 的 Agent 环境。一键安装适用于 macOS、Linux 和 Windows WSL。

### 一键安装

以 Codex 为例：

```bash
curl -fsSL https://raw.githubusercontent.com/damian2848/kaiyuncode-tools/main/scripts/install.sh | bash -s -- --agent codex
```

替换 `--agent` 的值即可选择宿主：

- `codex`：安装到 `~/.agents/skills/`。
- `claude`：安装到 `~/.claude/skills/`。
- `grok`：安装到 `~/.grok/skills/`，对应 xAI Grok Build。
- `openclaw`：安装到 `~/.openclaw/skills/`。
- `hermes`：安装到 `~/.hermes/skills/`。
- `all`：安装到以上五个目录。

默认安装四个 Skills。安装后**新建 Agent 会话**，即可描述需求。

一键命令跟随 GitHub `main`。只安装某个 Skill，可追加 `--skill`：

```bash
curl -fsSL https://raw.githubusercontent.com/damian2848/kaiyuncode-tools/main/scripts/install.sh | bash -s -- --agent codex --skill kaiyuncode-configure-agents
```

### 从指定版本安装

```bash
git clone --branch v0.4.1 --depth 1 https://github.com/damian2848/kaiyuncode-tools.git
cd kaiyuncode-tools
node scripts/install.mjs --agent codex
```

安装器支持多宿主、预览和自定义目录：

```bash
node scripts/install.mjs --agent claude --agent hermes
node scripts/install.mjs --agent all --dry-run
node scripts/install.mjs --skills-dir ./.agents/skills --skill kaiyuncode-create
```

不带参数时安装到 `~/.agents/skills/`。也可以完整复制 `skills/<skill-name>/` 到宿主的技能目录。Profile、环境变量、自定义目录与卸载方式见 [安装指南](docs/installation.md)。

## 图片与视频创作

向 Agent 说明用途、风格和素材即可：

> 使用 KaiyunCode 帮我做一张咖啡品牌海报，暖色调，适合小红书。先推荐模型并估算费用。

> 把这张产品图做成一段展示视频，保留产品外观。先给我方案和预算。

> 查看 KaiyunCode 当前可用的视频模型和价格，暂时不用生成。

Agent 会整理创意简报，检查凭据，查询实时模型和价格，准备提示词与素材，再展示生成确认卡。确认卡包含模型、参数、参考文件、输出位置、预计费用和预算上限；明确确认后才提交付费任务。

只查询模型或使用 `--dry-run` 不会发起付费生成。已有 task ID 时可继续查询结果，避免重复提交。生成能力与最终费用以平台实际支持和结算为准。

## Codex 模型目录

**v0.4.0 新增。** 配置工具读取 `GET /v1/models`，为当前 API Key 可用的全部文本模型生成目录，过滤图片、视频、音频、embedding 和 rerank 模型。

直接向 Agent 说明：

> 配置 Codex 使用 KaiyunCode，把可用的文本模型加入 /model 菜单，按平台声明设置思考强度和上下文。只配置 Codex。

也可以在仓库根目录运行：

```bash
# 配置 Codex：自动备份、生成目录并登录
node src/configure-agents.mjs --codex-only

# 仅查看预览、不写入时使用
node src/configure-agents.mjs --codex-only --dry-run
```

独立安装后，相同脚本位于 `kaiyuncode-configure-agents/scripts/configure-agents.mjs`。密钥输入方式见下节。

默认生成 `~/.codex/kaiyuncode-model-catalog.json`，并在 `config.toml` 中设置其绝对路径；自定义 `CODEX_HOME` 时使用该目录。**重启 Codex** 后，新会话的 `/model` 即可读取列表。再次运行可刷新模型与能力。

- 优先使用平台的展示别名、标准思考档位、默认值与已确认上下文，实际请求保留模型 ID。
- 平台声明为空或未知时保留该状态；新版接口未确认上下文时，不套用旧窗口。旧接口缺少能力字段时使用内置兼容快照。
- Claude 原生思考预算、自适应 effort 和 Ultra 协作工作流，不会被误写为普通 Responses `reasoning.effort`。
- 清理会覆盖目录的根级思考强度、上下文与相关配置，使切换模型时使用各自能力。项目、profile 或命令行显式覆盖仍可能优先。
- `--codex-only` 不修改 Claude Code；省略此参数时，脚本同时配置 Codex 与 Claude Code。

若渠道有更具体的限制，可用 `--model-capabilities path.json` 补充能力。字段格式、来源和恢复方式见 [模型目录文档](docs/codex-model-catalog.md)。

该功能已用 **Codex CLI 0.154.0** 验证；旧客户端可能需要升级。它配置的是 Codex 客户端，不会更改 ChatGPT 网页或手机应用的模型选择器。

## API Key

需要 KaiyunCode API Key。没有 Key 时，可先 [注册或登录](https://kaiyuncode.com/?login=1)，按需 [充值](https://kaiyuncode.com/pricing)，再 [创建 API Key](https://kaiyuncode.com/account/api-key)。

媒体脚本优先使用 `KAIYUN_API_KEY`，其次使用通用凭据文件 `~/.config/kaiyuncode/credentials.env`。各 Skill 自带 `scripts/save-api-key.mjs`，可从环境变量或 stdin 保存密钥；设置 `KAIYUN_HOME` 可更改凭据目录。

客户端配置脚本接受 `KAIYUN_API_KEY`、stdin 管道或交互式隐藏输入，不接受 `--api-key` 命令行参数。它也会保存同一密钥供媒体脚本使用。凭据文件权限为 `0600`；不要将密钥提交到仓库。

旧版 Codex 凭据文件和已配置的 KaiyunCode 文本客户端凭据仍可作为媒体脚本的回退来源。容器或远程 Agent 需要在实际执行环境中配置凭据、Node.js 和素材访问权限。

**安装 Skills 或保存媒体密钥，不会自动切换 Agent 的文本模型。** 客户端配置仅在明确要求时执行。

## 四个独立 Skills

- **[kaiyuncode-create](skills/kaiyuncode-create/SKILL.md)**：完整创作入口，包含图片与视频生成、预算确认、交付和迭代。
- **[kaiyuncode-image](skills/kaiyuncode-image/SKILL.md)**：专注图片生成、编辑、多图参考和组图。
- **[kaiyuncode-video](skills/kaiyuncode-video/SKILL.md)**：专注视频创作、本地参考素材与任务恢复。
- **[kaiyuncode-configure-agents](skills/kaiyuncode-configure-agents/SKILL.md)**：配置 Codex / Claude Code 使用 KaiyunCode，生成 Codex 模型目录。

其他支持 Agent Skills 且能执行 Node.js 的宿主，也可通过自定义目录安装。纯网页聊天界面不一定支持运行这些脚本；目录映射和独立运行的验证范围见 [兼容性说明](docs/installation.md#格式与来源)。

## 更新与迁移

重跑一键安装命令可更新至 `main` 最新版；本地安装用户需先更新仓库再运行安装器。安装器保护本地修改和未知来源的同名目录，普通替换失败时尝试回滚。更新后新建 Agent 会话；刷新 Codex 模型目录还需重新运行配置脚本并重启 Codex。

从旧 Codex 插件迁移时，安装通用 Skills 后，在 Codex 中禁用或卸载旧插件，避免菜单重复。仍需插件分发时，仓库保留 `.codex-plugin/plugin.json` 和 `scripts/install-codex-plugin.sh`。详见 [更新、冲突与迁移指南](docs/installation.md)。

## 开发与验证

```bash
npm run build:skills
npm run validate

# 可选：使用已安装的 Codex 验证目录加载和实际请求参数
KAIYUN_TEST_CODEX=1 node --test tests/codex-catalog-cli.test.mjs
```

`src/` 和 `shared/` 是脚本源码；`skills/*/scripts/` 是提交到仓库的独立分发文件。修改源码后运行 `build:skills`，不要直接修改生成文件。`npm run sync:tutorial` 可联网刷新媒体教程适配器快照。

CI 使用 Linux / macOS 与 Node.js 20 / 22。自动测试使用固定数据和模拟请求；可选 Codex 测试使用临时 HOME 和本机 Responses 服务，不调用真实付费模型。

## 许可证

Private. All rights reserved.
