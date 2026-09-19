# OpenClaw 接入与模型同步

安装 KaiyunTool 后，可以直接要求助手「把 OpenClaw 接入 KaiyunCode」，或「只保留 KaiyunCode，并刷新全部文本模型」。

## 命令入口

在已安装的 `kaiyuncode-configure-agents` 技能目录运行：

```bash
node scripts/configure-agents.mjs --openclaw-only

# 只保留 KaiyunCode
node scripts/configure-agents.mjs --openclaw-only --replace-providers

# 指定默认模型；模型 ID 必须存在于实时目录
node scripts/configure-agents.mjs --openclaw-only --openclaw-model gpt-5.6-terra

# 只预览，不写入
node scripts/configure-agents.mjs --openclaw-only --replace-providers --dry-run
```

凭据通过 `KAIYUN_API_KEY` 或 stdin 传入，不接受明文 `--api-key` 参数。助手可读取已有凭据，不需要用户重复提供。OpenClaw 专用模式不配置 Codex/Claude，不写媒体凭据。

## 公开接口决定模型能力

唯一模型数据来源是经过鉴权的 `GET https://kaiyuncode.com/v1/models`。支持根字段及 `metadata` 中的能力；根字段优先。只同步文本输出模型。

`supportedWireApis` / `supported_wire_apis` 决定可用端口：

- `responses` → `openai-responses`，请求 `/v1/responses`。
- `chat_completions` → `openai-completions`，请求 `/v1/chat/completions`。
- `anthropic_messages` → `anthropic-messages`，请求 `/v1/messages`，该模型使用站点根地址。

按上面顺序选择公开声明中可用的协议。缺失、空或不支持的协议列表不会猜测为 Responses；模型会被跳过并给出警告。列表格式错误会在写入前失败。

推理配置读取 `supported_reasoning_levels` 与 `default_reasoning_level`。缺少这些字段时，仅对 `standard` / `gemini-thinking` 使用公开 `reasoningProfile` 的档位及默认值；显式空列表或 null 不用旧快照补齐。仅当选择 Anthropic Messages 时，才使用 Claude 原生 profile。

对应关系为：公开档位写入 `compat.supportedReasoningEfforts`，可表示档位写入 `thinkingLevelMap`，未声明档位设为 null；公开默认值写入每模型 `params.thinking` 和代理模型设置。`none` 对应 OpenClaw 的 `off`。默认值不在公开支持列表中时拒绝写入。再次同步会清理旧的推理默认值。

输入模态、上下文窗口及输出上限也读取公开字段；不存在的数值交由宿主处理，不使用硬编码型号快照。当前集成只声明通用适配器能发送的 text/image 输入。

## 宿主能力边界

- Claude 的 native effort / token budget 不是 Responses `reasoning.effort`。选用 Responses 时，公开空 effort 列表表示不配置离散强度，不表示模型绝不思考。
- Chat-only Gemini 使用 `thinking_level`，当前 OpenClaw 通用 Chat 适配器不能动态映射该字段；配置公开默认值并报告此限制。若接口同时声明 Responses，会使用 Responses 的动态 effort。
- OpenClaw 2026.9.4 的 Chat 适配器会把 `max` 转成 `xhigh`。若公开列表没有独立 `xhigh`，工具会映射回真实 `max`；若两者同时存在且只能走 Chat，就省略无法区分的 `max` 控制并警告，避免将一个档位冒充另一个。Responses 不受此限制。
- MiniMax 原生 thinking mode、Claude token budget 等并非通用离散档位，不编造成 low/medium/high。
- OpenClaw 可能按运行时展示自己的 Ultra 工作流，或为原生 Claude 展示宿主内置选项；它们不代表 KaiyunCode 新增了上游 effort。KaiyunTool 不修改 OpenClaw 本身。
- 高优先级的会话覆盖仍由用户选择控制。独占 KaiyunCode 模式会清理全局/代理 `thinkingDefault`，让每模型公开默认值生效。

## 配置、备份与验证

普通接入保留其他 provider；`--replace-providers` 将 `models.mode` 设为 `replace`，并同步主配置、各代理模型列表、白名单和已有 `models.json`。现有会话固定值、计划任务的模型覆盖不会被批量改写。

支持 `OPENCLAW_STATE_DIR` 和 `OPENCLAW_CONFIG_PATH`。配置及模型缓存必须在状态目录内，路径不可经过符号链接；当前脚本读取标准 JSON，含注释的 JSON5 或 `$include` 配置需先转换或按源文件处理。

写入前创建 `0600` 的时间戳备份，使用临时配置运行 `openclaw config validate --json`，校验通过后原子替换文件。写入失败会恢复快照。调用方随后检查 `openclaw models list --json`、Gateway `models.list` 和目标会话；必要时重启 Gateway。

开发验证采用本地回环模拟服务，不发送真实付费请求。已在 OpenClaw 2026.9.4 验证；旧版本若不支持相关能力字段，校验会失败并保留原配置。

可选真实适配器测试：将 `KAIYUN_TEST_OPENCLAW_AI_DIR` 指向本机 OpenClaw 自带的 `node_modules/@openclaw/ai` 目录，然后运行 `node --test tests/openclaw-runtime.test.mjs`。该测试覆盖 Responses 和 Chat 的路径及 low/high/xhigh/max 请求参数，全程只连接回环地址。
