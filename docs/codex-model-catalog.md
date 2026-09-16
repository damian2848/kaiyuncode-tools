# Codex 模型目录

配置脚本校验 `GET /v1/models` 后，为该 API Key 可用的全部文本模型生成 `$CODEX_HOME/kaiyuncode-model-catalog.json`，并将绝对路径写入 `config.toml` 的 `model_catalog_json`。默认 `CODEX_HOME` 为 `~/.codex`。图片、视频、音频、embedding 和 rerank 模型不进入目录；支持图片输入的文本模型可以进入。

只配置 Codex，不要求账户拥有 Claude 模型，也不修改 Claude 设置：

```bash
node src/configure-agents.mjs --codex-only --dry-run
node src/configure-agents.mjs --codex-only
```

脚本从 `KAIYUN_API_KEY`、stdin 或隐藏输入读取密钥。独立安装的 Skill 使用 `scripts/configure-agents.mjs`。不加 `--codex-only` 时，原有 Codex + Claude 配置流程也会生成目录。`--codex-model` 选择初始模型，默认仍为 `gpt-5.6-sol`；目录不限于这个初始选择。

重启 Codex 后，新会话的 `/model` 显示目录中的模型及各自的思考档位。再次执行会刷新列表并备份旧目录。此配置用于支持该设置的 Codex CLI / 客户端，不会修改 ChatGPT 网页或手机应用的模型选择器。真实客户端测试使用 Codex CLI 0.154.0；旧版本可能不支持目录或 `max` 等档位，应先更新客户端。

## 能力来源与覆盖

按字段采用以下优先级：

1. `--model-capabilities <JSON 文件>` 中的明确覆盖，例如渠道实际限制。
2. `/v1/models` 中的模型字段及 `metadata`。
3. 随工具分发的精确模型 ID 快照，位于 `shared/codex-model-profiles.mjs`。

支持 `context_window` / `contextWindow` / `context_length` / `max_input_tokens`（正整数 Token），`supported_reasoning_levels` / `supported_reasoning_efforts` / `reasoning_efforts`（字符串数组或 `{ "effort": "high" }` 数组），以及 `default_reasoning_level` / `default_reasoning_effort`。也接受平台同格式的 `reasoningConfig` 或 `reasoningProfile`（`kind`、`levels`、`defaultEffort`）。空数组表示不提供可调档位，`null` 表示未知或不指定默认值，不会重新套用快照档位或默认值。不按展示别名、任意未来版本或价格猜测能力，不主动调用付费模型探测。

平台 2026-09-16 更新后的 `/v1/models` 返回 `display_name`、`reasoningProfile`、`supported_reasoning_levels` 和 `default_reasoning_level`；管理员确认上下文后返回 `context_window`。生成器优先使用这些声明。新版 `reasoningProfile` 存在但上下文字段缺省时，表示尚未确认，不再回填旧快照窗口。旧版接口没有能力声明时才使用内置兼容快照。

未核实的上下文写为 `null`，预览和成功输出包含 `warnings`，模型描述注明“上下文长度待确认”。此时 Codex 使用自身回退窗口，不能视作渠道承诺。未核实的思考能力不注入 effort。只有 `standard` 档位可映射至 Responses 的 `reasoning.effort`；Claude 原生 adaptive / effort-budget / budget 能力不映射为此字段，因此 Claude 保持无可选档位，除非平台明确配置为兼容的 standard 模式。固定档位模型 `gemini-3.1-pro-high` 同样不展示可变档位。

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

覆盖只补充账户可用模型的能力，不添加无权限模型。默认仅声明文本输入；元数据明确声明图片输入时才启用图片。目录使用普通工具模式，关闭优先 WebSocket，不复制官方专属工具或套餐字段。

为使切换模型时能力随之生效，配置流程删除根级 `model_reasoning_effort`、`model_context_window`、`model_auto_compact_token_limit`、`model_verbosity`、`model_supports_reasoning_summaries` 和 `model_reasoning_summary`。项目配置、配置档案或命令行的显式覆盖仍可能优先于目录。

## 快照依据

- 目录配置：[OpenAI Codex 配置参考](https://developers.openai.com/codex/config-reference/#model_catalog_json)。字段兼容性另通过 Codex CLI 0.154.0 内置目录和真实 `model/list` 验证。
- GPT 上下文采用 Codex CLI 0.154.0 内置的默认会话窗口 272,000 Token，不自动启用实验性长上下文。思考快照同步平台 2026-09-16 的 Sub2API 目录策略（revision `4b88ee3121ba6ea3f876ed237f2d337170509b35`）：GPT-5.5 使用 low / medium / high / xhigh，GPT-5.6 与 Astra 增加 max；不再包含旧快照中的 none。Sol 默认 low，其余默认 medium；DeepSeek 使用 low / high / max，默认 high；Grok 默认 high。这是平台目录策略，不是重新核验的官方上限。不将 Codex 内置的 `ultra` 协作模式当作中转 API 已确认的独立档位。
- Gemini 保留已有精确型号快照。协议语义参考平台 `docs/model-test-reasoning.md` 及其来源：[Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)、[Gemini OpenAI 兼容](https://ai.google.dev/gemini-api/docs/openai)、[Grok reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)。Claude 原生能力不声明为 Responses 档位，原生参数不由本工具注入；`reasoningProfile.workflows` 中的 Ultra 也不进入普通 API effort 列表。
- 已确认的非 GPT 上下文取自平台所用 Sub2API `backend/resources/model-pricing/model_prices_and_context_window.json` 的精确型号 `max_input_tokens` 快照（读取日期 2026-09-16，来源为 LiteLLM 模型能力表）。没有精确记录的型号保持未知，不直接套用相似型号的窗口。

## 验证与恢复

目录文件与 Codex / Claude 配置一起备份、原子写入；登录或后续验证失败时恢复旧内容、权限和原本的存在状态。`--dry-run` 输出完整目录及警告，不写文件或启动登录进程。

```bash
npm run validate
KAIYUN_TEST_CODEX=1 node --test tests/codex-catalog-cli.test.mjs
```

第二项使用临时 HOME 和本机模拟 Responses 服务，验证模型列表、思考档位和实际请求参数，不使用真实凭据或付费上游。
