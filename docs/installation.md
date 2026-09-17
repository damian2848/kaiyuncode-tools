# 安装、迁移与宿主兼容

## 指定版本与单独安装

固定安装本次发布版本：

```bash
git clone --branch v0.5.2 --depth 1 https://github.com/damian2848/kaiyuncode-tools.git
cd kaiyuncode-tools
node scripts/install.mjs --agent codex
```

默认安装创作助手、图片、视频和客户端配置四个独立 Skills，日常直接说需求即可。需要精简安装时，可以只装一个；每个 Skill 自带运行脚本，不依赖其他 Skill 才能执行本职任务：

```bash
# 只做图片和视频
node scripts/install.mjs --agent codex --skill kaiyuncode-create

# 只配置客户端、刷新 Codex 模型
node scripts/install.mjs --agent codex --skill kaiyuncode-configure-agents

# 预览安装位置，不写入
node scripts/install.mjs --agent codex --dry-run
```

## 默认目录和 profile

统一安装器支持重复 `--agent`，例如 `node scripts/install.mjs --agent claude --agent hermes`。`--agent all` 写入五个宿主目录；不带参数或 `--agent universal` 只写入 `~/.agents/skills`。

- **Codex**：按当前官方文档使用 `~/.agents/skills`。兼容旧环境或自定义 `CODEX_HOME` 时可显式传 `--skills-dir "$CODEX_HOME/skills"`；默认的通用目录不随 `CODEX_HOME` 改变。
- **Claude Code**：`~/.claude/skills`，尊重 `CLAUDE_CONFIG_DIR`。
- **Grok Build**：`~/.grok/skills`。这里指支持 Agent Skills 的 xAI Grok Build CLI，不代表所有同名第三方 Grok CLI 或 Grok 网页聊天都能加载技能。
- **OpenClaw**：`~/.openclaw/skills`，尊重 `OPENCLAW_STATE_DIR`。可通过 `--skills-dir` 指向特定 workspace 的 `skills`。
- **Hermes Agent**：`~/.hermes/skills`，尊重 `HERMES_HOME`。需要装入特定 profile 时，在该 profile 对应的环境中运行安装器，或显式指定目录。`hermess` 为拼写兼容别名。

Grok Build、OpenClaw 的部分版本也会发现 `~/.agents/skills` 或其他 agent 目录。多个宿主共用一台机器时，只安装实际需要的目录；若菜单重复，移除不需要的副本或旧插件。按名称自动合并的行为取决于宿主。

## 项目级和自定义安装

`--skills-dir` 接受的是技能**根目录**，安装器会在里面创建选定的 `kaiyuncode-*` 子目录。它不能与 `--agent` 同用。

```bash
# 在仓库根目录执行；只影响此项目
node scripts/install.mjs --skills-dir ./.claude/skills
node scripts/install.mjs --skills-dir ./.agents/skills
node scripts/install.mjs --skills-dir ./.grok/skills

# 指向一个 OpenClaw workspace，只安装总控创作 Skill
node scripts/install.mjs --skills-dir /path/to/workspace/skills --skill kaiyuncode-create

# 其他支持 SKILL.md 的 agent，使用其文档指定的目录
node scripts/install.mjs --skills-dir /path/to/agent/skills
```

Node 安装器使用完整目录复制，不依赖符号链接。可以删除用于安装的临时仓库，已安装的 Skill 仍可运行。手动复制时同样要保留整个 Skill 目录。

## 更新、冲突与卸载

更新仓库后重跑原安装命令，或重跑一键安装命令。安装器记录 `.kaiyuncode-install.json`，对目录内容计算 SHA-256；仅更新本安装器管理且未被本地修改的目录。额外添加的文件也视为本地修改。

遇到冲突时，先将需要保留的同名目录备份或移走，再重新安装。安装器不提供强制覆盖选项。手动复制或第三方安装器创建的目录没有本安装器记录，也会被视为未知来源。

安装会先检查所有目标，再暂存新版本并替换；普通替换失败会尝试回滚。`.kaiyuncode-install.lock` 防止两个安装进程同时更新同一根目录。进程被强制终止时，先确认没有安装进程运行，再检查该目录内 `.kaiyuncode-stage-*` 的 `previous` 备份并恢复，最后移走残留锁文件后重试。

卸载时删除对应宿主根目录内的 `kaiyuncode-*` Skill 目录并新建会话即可。媒体凭据独立保存在 `~/.config/kaiyuncode/credentials.env`（或 `KAIYUN_HOME`），需要删除密钥时单独处理该文件。

## 从 Codex 插件迁移

0.3.0 起 `scripts/install.sh` 改为通用 Skill 安装器，默认不再注册 Codex marketplace。

1. 按当前仓库版本运行 `node scripts/install.mjs --agent codex`。
2. 在 Codex 插件管理中禁用或卸载旧 `kaiyuncode-tools` 插件，避免同名 Skill 重复显示。
3. 新建会话。旧版 `.codex/kaiyun-tools.env` 和 `kaiyun-video.env` 会作为凭据回退，无需重新粘贴 Key。
4. 下次通过 `save-api-key.mjs` 保存 Key 时写入通用目录，旧文件保持原样。

仍希望使用原 Codex personal marketplace 工作流时，可执行保留的 `bash scripts/install-codex-plugin.sh`。这是旧安装入口，仍要求 Git、Python 3 和支持插件命令的 Codex CLI；它从远程 `main` 安装到 `~/plugins/kaiyuncode-tools`。不要与直接 Skill 安装重复启用。

## 容器、远程 agent 与权限

安装目录需要位于宿主实际扫描的文件系统。沙箱中的执行环境必须能访问 Skill 的整个目录、Node.js、用户素材和网络；仅在宿主机安装 Node 或设置 API Key，不会自动传入容器。按宿主的环境注入机制设置 `KAIYUN_API_KEY`，或将 `KAIYUN_HOME` 指向该环境可访问的私有目录。

只读取模型和价格可以使用 `--list-models`；预览任务使用 `--dry-run`。不要为检查安装是否成功发起真实付费生成。

## 格式与来源

技能入口只使用通用 YAML `name`、`description` 和 Markdown；脚本通过 Node 执行，没有预设 MCP 工具名称、Codex 环境变量或专属工具调用约定。`agents/openai.yaml` 是可选的 Codex UI 元数据，其他宿主可忽略。

以下资料用于核对格式和目录（2026-09-14）：

- [Agent Skills 规范](https://agentskills.io/specification)
- [Codex Skills](https://developers.openai.com/codex/skills/)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Grok Build Skills / Plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces)
- [OpenClaw Skills](https://docs.openclaw.ai/tools/skills)
- [Hermes 技能实现与目录](https://github.com/NousResearch/hermes-agent/blob/main/tools/skills_tool.py)

验证范围是上述目录映射和独立脚本运行；宿主版本、沙箱权限和 UI 展示仍需在目标环境中确认。当前不宣称所有同名产品或纯网页聊天客户端都具备 Skill 执行能力。

## 开发与验证

`src/` 和 `shared/` 是源码；`skills/*/scripts/` 是随仓库分发的独立副本，不要直接修改生成文件。

```bash
npm run build:skills
npm run validate
KAIYUN_TEST_CODEX=1 node --test tests/codex-catalog-cli.test.mjs
```

CI 使用 Linux / macOS 和 Node.js 20 / 22。测试使用固定数据与模拟请求；可选 Codex 验证使用临时 HOME 和本机 Responses 服务，检查模型列表及图片请求，不调用付费上游。`npm run sync:tutorial` 可联网刷新图片、视频教程适配器快照。
