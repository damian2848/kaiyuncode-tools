# Codex 模型目录

配置统一使用 `model_provider = "custom"` 和 `[model_providers.custom]`，与 CC Switch 保持稳定的客户端供应商标识；服务地址仍为 KaiyunCode。已有 custom 表原位更新，旧 KaiyunCode 表保留供历史引用；不会改写历史会话归属。凭据发现根据当前 provider 的服务地址判断，不依赖 provider 名称。

配置脚本校验 `GET /v1/models` 后，为该 API Key 可用且兼容 Responses 的文本模型生成 `$CODEX_HOME/kaiyuncode-model-catalog.json`，并将绝对路径写入 `config.toml` 的 `model_catalog_json`。默认 `CODEX_HOME` 为 `~/.codex`。图片、视频、音频、embedding 和 rerank 模型不进入目录；支持图片输入的文本模型可以进入。

模型根字段或 `metadata` 中的 `supportedWireApis` / `supported_wire_apis` 声明开放协议，根字段优先。非空列表必须包含 `responses` 才进入 Codex 目录；仅支持 `chat_completions` 或 `anthropic_messages` 的文本模型会被跳过，并在 `warnings` 中解释原因。若通过 `--codex-model` 选中此类模型，脚本在备份、写入和登录前报错。Claude Code 的模型选择不受这项 Codex 协议筛选影响。旧接口缺失、`null` 或空数组表示未声明协议，沿用兼容行为。

只配置 Codex，不要求账户拥有 Claude 模型，也不修改 Claude 设置：

```bash
node src/configure-agents.mjs --codex-only

# 仅预览时才加 --dry-run
node src/configure-agents.mjs --codex-only --dry-run
```

用户提出配置请求后直接执行，不增加写入确认。“先预览”表示展示后继续；“仅预览、不写入”才停止。生图、生视频的提交确认与客户端配置无关。

脚本从 `KAIYUN_API_KEY`、stdin 或隐藏输入读取密钥。独立安装的 Skill 使用 `scripts/configure-agents.mjs`。不加 `--codex-only` 时，原有 Codex + Claude 配置流程也会生成目录。`--codex-model` 选择初始模型，默认仍为 `gpt-5.6-sol`；目录不限于这个初始选择。

重启 Codex 后，新会话的 `/model` 显示目录中的模型及各自的思考档位。再次执行会刷新列表并备份旧目录。此配置用于支持该设置的 Codex CLI / 客户端，不会修改 ChatGPT 网页或手机应用的模型选择器。真实客户端测试使用 Codex CLI 0.154.0；旧版本可能不支持目录或 `max` 等档位，应先更新客户端。

## 能力来源与覆盖

按字段采用以下优先级：

1. `--model-capabilities <JSON 文件>` 中的明确覆盖，例如渠道实际限制。
2. `/v1/models` 中的模型字段及 `metadata`。
3. 随工具分发的精确模型 ID 快照，位于 `shared/codex-model-profiles.mjs`。

支持 `context_window` / `contextWindow` / `context_length` / `max_input_tokens`（正整数 Token），`supported_reasoning_levels` / `supported_reasoning_efforts` / `reasoning_efforts`（字符串数组或 `{ "effort": "high" }` 数组），以及 `default_reasoning_level` / `default_reasoning_effort`。也接受平台同格式的 `reasoningConfig` 或 `reasoningProfile`（`kind`、`levels`、`defaultEffort`）。当 profile 明确同时提供 `workflows: ["ultra"]`、`multiAgentVersion`（`v1` 或 `v2`）和已包含在普通档位中的 `multiAgentReasoningEffort` 时，目录会额外公开 `ultra`。空数组表示不提供可调档位，`null` 表示未知或不指定默认值，不会重新套用快照档位或默认值。不按展示别名、任意未来版本或价格猜测能力，不主动调用付费模型探测。

平台源码的新版 `/v1/models` 契约包含 `display_name`、`reasoningProfile`、`supported_reasoning_levels` 和 `default_reasoning_level`；管理员确认上下文后返回 `context_window`。2026-09-16 本次线上只读核验的响应包含展示名称、分类和协议，但尚未包含思考能力与上下文字段；生成器兼容两种响应，不把源码契约视作已上线能力。

兼容字段优先；同一来源同时包含 `reasoningProfile` 和 `reasoningConfig` 时，使用按实际开放协议解析后的 `reasoningProfile`，避免管理员配置覆盖平台返回的“未知”状态。`standard`、`gemini-thinking`、`minimax-thinking`、Claude 原生类型和 `unknown` 都可以安全读取；只有平台明确给出的 `supported_reasoning_levels` 才会进入 Codex 的 Responses 档位。新版 `reasoningProfile` 存在但根字段和 `metadata` 均未声明上下文时，不再回填旧快照窗口；`metadata` 中已确认的窗口以及显式覆盖仍有效，显式 `null` 仍表示未知。展示别名也支持从 `metadata` 读取，实际请求始终使用原始 ID。旧版接口没有能力声明时才使用内置兼容快照。

未核实的上下文写为 `null`，预览和成功输出包含 `warnings`，模型描述注明“上下文长度待确认”。此时 Codex 使用自身回退窗口，不能视作渠道承诺。未核实的思考能力不注入 effort。只有 `standard` 档位可映射至 Responses 的 `reasoning.effort`；Claude 原生 adaptive / effort-budget / budget 能力不映射为此字段，因此 Claude 保持无可选档位，除非平台明确配置为兼容的 standard 模式。平台同时提供 Ultra 工作流和 Codex 多智能体运行时元数据时，`ultra` 会显示为可选档位，并由 Codex 采用声明的底层推理强度执行。固定档位模型 `gemini-3.1-pro-high` 同样不展示可变档位。

覆盖文件按实际请求 ID 索引，例如：

```json
{
  "my-text-model": {
    "context_window": 131072,
    "supported_reasoning_levels": ["low", "high"],
    "default_reasoning_level": "low",
    "input_modalities": ["text", "image"]
  }
}
```

```bash
node src/configure-agents.mjs --codex-only --model-capabilities ./model-capabilities.json
```

覆盖只补充账户可用模型的能力，不添加无权限模型。图片输入按字段优先级读取 `input_modalities` / `inputModalities`（包括 `metadata`），显式 `["text"]` 会关闭图片输入。平台省略该字段时，使用以下精确型号的 `["text", "image"]` 快照，避免生成自定义目录后把图片入口关闭：

- GPT：`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.2`。
- Claude：`claude-opus-4-6`、`claude-opus-4-7`、`claude-opus-4-8`、`claude-opus-5`、`claude-sonnet-4-6`、`claude-sonnet-5`、`claude-haiku-4-5`、`claude-fable-5`、`claude-fable-5-1`。
- Gemini：`gemini-3.1-flash-lite`、`gemini-3.6-flash-tiered`、`gemini-3.7-flash-tiered`、`gemini-3.8-flash-tiered`。
- 其他：`grok-4.5`、`grok-4.6`、`kimi-k3`、`glm-5.3-flash`、`MiniMax-M3`、`deepseek-v4-flash`、`deepseek-v4.1-flash`。

`glm-5.3` 和 `deepseek-v4-pro` 按官方声明仅支持文本。其他未核实模型仍仅声明文本输入，并输出 `image input capability is unverified` 警告，可用上述覆盖文件声明已确认的图片能力；不按展示别名或未来版本猜测。视觉能力与 Responses 协议分别判断，例如当前只开放 Chat Completions 的 `gemini-3.8-flash-tiered` 仍不会进入 Codex 目录。目录使用普通工具模式，关闭优先 WebSocket，不复制官方专属工具或套餐字段。

旧目录已经写入 `["text"]` 的用户，需要用更新后的工具重新生成目录，并重启 Codex、新建会话；只更新脚本不会修改已有目录。

为使切换模型时能力随之生效，配置流程删除根级 `model_reasoning_effort`、`model_context_window`、`model_auto_compact_token_limit`、`model_verbosity`、`model_supports_reasoning_summaries` 和 `model_reasoning_summary`。同时会在 `[desktop]` 中写入 `show-ultra-in-model-picker-slider = true`，让已声明 Ultra 工作流的模型在选择器滑块中默认显示 Ultra。项目配置、配置档案或命令行的显式覆盖仍可能优先于目录。

## 快照依据

- 目录配置：[OpenAI Codex 配置参考](https://developers.openai.com/codex/config-reference/#model_catalog_json)。字段兼容性另通过 Codex CLI 0.154.0 内置目录和真实 `model/list` 验证。
- 图片输入快照：2026-09-16 用 Codex CLI 0.154.0 在隔离配置下读取原生 `model/list`，以上六个精确 GPT ID 的 `inputModalities` 均为 `["text", "image"]`。[App Server 文档](https://developers.openai.com/codex/app-server/)说明模型列表返回 `inputModalities`。这是客户端能力快照；渠道显式限制优先，未调用付费上游探测视觉能力。
- 非 GPT 图片输入依据（2026-09-16 读取）：[Claude 模型概览](https://platform.claude.com/docs/en/about-claude/models/overview)及 [Fable 5](https://platform.claude.com/docs/en/models/fable-5/overview)声明图片输入；旧 Opus 4.6/4.7/4.8、Sonnet 4.6 和 Haiku 4.5 同时有平台随附 LiteLLM 精确型号 `supports_vision: true` 记录。[Gemini 3.6](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)、[3.7](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)、[3.8](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)声明 Image 输入；平台的 `-tiered` 变体按现有质量后缀映射对应这三个型号，3.1 Flash Lite 使用随附精确能力记录。Grok 4.5/4.6 使用平台 Sub2API `isGrokCodexImageInputModel` 的精确白名单，并参考 [xAI 模型文档](https://docs.x.ai/developers/models)。
- 其他图片输入依据：[Kimi K3](https://platform.moonshot.ai/docs/guide/kimi-k3-quickstart)、[GLM-5.3-Flash](https://docs.z.ai/guides/llm/glm-5.3-flash)、[MiniMax M3](https://www.minimax.io/models/text/m3)。[GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3)明确只支持文本。[DeepSeek 当前能力表](https://api-docs.deepseek.com/quick_start/pricing)和[视觉输入文档](https://api-docs.deepseek.com/guides/vision)声明 V4.1 Flash 支持图片、V4 Pro 不支持；官方现已将 `deepseek-v4-flash` 旧名称的请求交给 V4.1 Flash。此别名兼容作为快照使用，若渠道仍使用旧上游，应显式覆盖为仅文本。这些声明用于客户端能力，不能代替渠道实际验证。
- GPT 上下文采用 Codex CLI 0.154.0 内置的默认会话窗口 272,000 Token，不自动启用实验性长上下文。思考快照同步平台 2026-09-16 的 Sub2API 目录策略（revision `4b88ee3121ba6ea3f876ed237f2d337170509b35`）：GPT-5.5 使用 low / medium / high / xhigh，GPT-5.6 与 Astra 增加 max；不再包含旧快照中的 none。Sol 默认 low，其余默认 medium；DeepSeek 使用 low / high / max，默认 high；Grok 默认 high。这是平台目录策略，不是重新核验的官方上限。Ultra 只在平台通过 `reasoningProfile` 同时声明工作流、多智能体版本和底层推理强度时写入目录，不从静态快照推断。
- Gemini 保留已有精确型号快照。协议语义参考平台 `docs/model-test-reasoning.md` 及其来源：[Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)、[Gemini OpenAI 兼容](https://ai.google.dev/gemini-api/docs/openai)、[Grok reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)。Claude 原生能力不声明为 Responses 档位，原生参数不由本工具注入；`reasoningProfile.workflows` 中的 Ultra 只有在同一 profile 提供 Codex 所需的多智能体运行时元数据时才进入目录。
- 已确认的非 GPT 上下文取自平台所用 Sub2API `backend/resources/model-pricing/model_prices_and_context_window.json` 的精确型号 `max_input_tokens` 快照（读取日期 2026-09-16，来源为 LiteLLM 模型能力表）。没有精确记录的型号保持未知，不直接套用相似型号的窗口。

## 验证与恢复

目录文件与 Codex / Claude 配置一起备份、原子写入；登录或后续验证失败时恢复旧内容、权限和原本的存在状态。`--dry-run` 输出完整目录及警告，不写文件或启动登录进程。

```bash
npm run validate
KAIYUN_TEST_CODEX=1 node --test tests/codex-catalog-cli.test.mjs
```

第二项使用临时 HOME 和本机模拟 Responses 服务，验证模型列表、思考档位、图片输入能力及实际请求参数；用本地 PNG 确认 `input_image` 到达 Responses 请求，不使用真实凭据或付费上游。
