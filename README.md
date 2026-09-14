# KaiyunCode Tools

让你的 AI Agent 用自然语言完成图片和视频创作。

从一句想法开始，KaiyunCode Tools 会协助整理创意、选择当前可用的模型、查询价格、准备素材和提示词，在确认预算后生成并交付成品。

**支持 Grok Build · Claude Code · OpenClaw · Hermes Agent · Codex**，以及其他支持 [Agent Skills](https://agentskills.io/specification) 且能执行 Node.js 脚本的 Agent。

[快速安装](#快速安装) · [开始创作](#开始创作) · [选择 Skills](#选择-skills) · [安装与迁移指南](docs/installation.md)

## 能做什么

- **图片创作**：文生图、图片编辑、多图参考、组图和电商素材。
- **视频创作**：文生视频、图生视频、首尾帧、参考创作、续写和复刻；具体能力以实时可用模型为准。
- **模型与价格查询**：根据用途和素材筛选可用模型，展示实时公开单价。
- **本地素材直接使用**：图片、视频、音频和蒙版可以使用本机文件，无需自行上传对象存储。
- **批量任务与恢复**：支持多任务并发；已有 task ID 时继续查询和保存结果。
- **预算确认与迭代**：先展示方案和费用预览，获得明确授权后提交；修改方案后重新确认。

每个 Skill 都包含所需脚本和参考资料，可以独立安装。媒体创作不需要切换 Agent 当前使用的文本模型。

## 快速安装

需要 **Node.js 20+**。一键安装另需 **Git**，适用于 macOS、Linux 和 Windows WSL；无需安装 npm 运行时依赖。

以 Claude Code 为例：

```bash
curl -fsSL https://raw.githubusercontent.com/damian2848/kaiyuncode-tools/main/scripts/install.sh | bash -s -- --agent claude
```

将命令中的 `claude` 替换为目标 Agent：

- `grok` → Grok Build，安装到 `~/.grok/skills/`。
- `claude` → Claude Code，安装到 `~/.claude/skills/`。
- `openclaw` → OpenClaw，安装到 `~/.openclaw/skills/`。
- `hermes` → Hermes Agent，安装到 `~/.hermes/skills/`；也接受 `hermess`。
- `codex` → Codex，安装到 `~/.agents/skills/`。

默认安装全部四个 Skills。只想使用完整创作助手时，可以仅安装 `kaiyuncode-create`：

```bash
curl -fsSL https://raw.githubusercontent.com/damian2848/kaiyuncode-tools/main/scripts/install.sh | bash -s -- --agent codex --skill kaiyuncode-create
```

安装完成后，**新建 Agent 会话**再开始使用。宿主需要具备命令执行、文件读写和 HTTPS 联网能力；纯网页聊天界面不一定具备这些能力。Grok 支持指的是 xAI Grok Build，其他同名 CLI 需自行确认 Skill 支持。

### 从本地仓库安装

```bash
git clone https://github.com/damian2848/kaiyuncode-tools.git
cd kaiyuncode-tools

# 选择一个 Agent
node scripts/install.mjs --agent claude

# 或同时安装到多个 Agent
node scripts/install.mjs --agent codex --agent hermes

# 或一次安装到以上五个 Agent
node scripts/install.mjs --agent all
```

安装器也支持预览、自定义目录和单独选择 Skill：

```bash
# 只预览安装位置
node scripts/install.mjs --agent all --dry-run

# 安装到项目的技能目录
node scripts/install.mjs --skills-dir ./.claude/skills --skill kaiyuncode-create
```

不带参数时只安装到通用目录 `~/.agents/skills/`。重复运行相同安装命令可更新；本地仓库用户应先更新仓库。安装器会保护本地修改和未知来源的同名目录，普通替换失败时尝试回滚。

也可以将 `skills/<skill-name>/` **整个目录**复制到宿主的技能目录，保留其中的脚本和参考资料。Profile、自定义路径、冲突处理和卸载方式见 [完整安装指南](docs/installation.md)。

## 开始创作

安装后，直接向 Agent 描述需求：

> 使用 KaiyunCode 帮我做一张咖啡品牌海报，暖色调，适合小红书。先推荐模型并估算费用。

> 把这张产品图做成一段展示视频，保留产品外观。先给我方案和预算。

> 查看 KaiyunCode 当前可用的图片模型和价格，暂时不用生成。

Agent 会按需要推进以下流程：

```mermaid
flowchart LR
  A[整理创意] --> B[检查密钥]
  B --> C[模型与价格]
  C --> D[方案与素材]
  D --> E[预算确认]
  E --> F[生成与交付]
  F --> G[继续迭代]
```

只想查询模型或价格时，流程停在查询阶段。生成前会展示确认卡，包括模型、提示词摘要、素材、参数、输出位置、预计费用和预算上限；核对后回复“确认提交”或同等明确授权。

`--dry-run` 会联网校验模型和价格，但不发起付费生成。实际费用以平台结算为准；价格或预算不明确时不会继续付费提交。任务提交状态不明时，不自动重复提交。

## API Key

图片和视频创作使用 **KaiyunCode API Key**。没有 Key 时，可先 [注册或登录](https://kaiyuncode.com/?login=1)，按需 [充值](https://kaiyuncode.com/pricing)，再 [创建 API Key](https://kaiyuncode.com/account/api-key)。

已有凭据时，Agent 会直接使用；缺少时，可通过宿主支持的密钥输入方式保存，或在脚本实际运行的环境中设置 `KAIYUN_API_KEY`。密钥不要写入命令行参数、日志、回复或仓库。

默认凭据文件为 `~/.config/kaiyuncode/credentials.env`，权限为 `0600`。设置 `KAIYUN_HOME` 后使用该目录下的 `credentials.env`。各 Skill 自带 `scripts/save-api-key.mjs`，接受环境变量或 stdin 输入。

凭据读取顺序：

1. `KAIYUN_API_KEY` 环境变量。
2. 通用凭据文件。
3. 旧版 `.codex/kaiyun-tools.env`，其次 `.codex/kaiyun-video.env`，尊重 `CODEX_HOME`。
4. 以上都没有时，尝试 Codex / Claude 的 KaiyunCode 文本配置。

旧版密钥可继续使用，不自动移动或删除。容器和远程 Agent 需要在**实际执行环境**中配置凭据和 Node.js。

## 选择 Skills

- **[kaiyuncode-create](skills/kaiyuncode-create/SKILL.md)**：推荐入口。从想法到图片或视频成品的完整流程，内置两种媒体 Runner，可单独安装。
- **[kaiyuncode-image](skills/kaiyuncode-image/SKILL.md)**：专注图片生成、编辑、多图参考和组图。
- **[kaiyuncode-video](skills/kaiyuncode-video/SKILL.md)**：专注视频生成、参考、续写和复刻。
- **[kaiyuncode-configure-agents](skills/kaiyuncode-configure-agents/SKILL.md)**：可选的文本客户端配置工具。用户明确要求时，预览并配置 Codex 和 Claude Code 使用 KaiyunCode；目前不配置其他 Agent 的文本 provider。

四个 Skill 均可独立运行。安装 Skills 或保存媒体密钥，不会自动修改任何 Agent 的文本模型配置。

## 更新与旧版迁移

从旧版 Codex 插件迁移时，运行新的安装命令，然后在 Codex 中禁用或卸载旧插件，避免同名 Skill 重复显示。新建会话后即可继续使用已有密钥。

仍需 Codex 插件分发的用户可以使用保留的 `.codex-plugin/plugin.json` 和 `scripts/install-codex-plugin.sh`。该旧入口仍依赖 Codex 插件命令，与通用 Skill 安装方式不同。

详细步骤见 [安装、更新与迁移指南](docs/installation.md)。

## 开发

```bash
npm run build:skills    # 构建可独立分发的 Skill 目录
npm run validate       # 检查生成文件一致性并运行测试
```

源码与分发目录：

- `src/`：图片、视频、凭据保存和客户端配置脚本的源码。
- `shared/`：共用的 API、预算、凭据、脱敏和运行时模块。
- `references/`：生产教程适配器快照。
- `skills/`：可直接安装的 Skill 目录，包含生成的独立脚本和依赖。
- `scripts/`：构建、安装和教程同步工具。
- `tests/`：媒体流程、独立运行、凭据兼容、安装更新和回滚测试。

修改 `src/`、`shared/` 或生产快照后，运行 `npm run build:skills` 并提交生成文件。不要直接修改 `skills/*/scripts/`。总控 Skill 的图片 / 视频 API 参考由对应媒体 Skill 的参考文档生成。

刷新生产教程快照需要网络：

```bash
npm run sync:tutorial
npm run build:skills
npm run validate
```

自动测试使用固定数据和模拟请求，不发起真实付费生成。CI 在 Linux / macOS 上使用 Node.js 20 / 22 验证；各宿主的目录与格式依据见 [兼容性说明](docs/installation.md#格式与来源)。

## 许可证

Private. All rights reserved.
