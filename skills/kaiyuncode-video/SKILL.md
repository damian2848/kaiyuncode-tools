---
name: kaiyuncode-video
description: "使用 KaiyunCode 异步视频模型完成文生视频、图生视频、多图参考、首尾帧、分镜、参考素材或视频复刻，并完成实时模型与价格发现、提示词和素材准备、预算确认、异步提交、结果保存及迭代。用户已经明确要创作视频时使用；跨图片/视频或需要从模糊想法开始全流程引导时优先使用 kaiyuncode-create。"
---

# KaiyunCode Video

## 确认规则

只有提交新的生图、生视频任务需要展示预算确认卡并等待用户确认。用户已提出的安装、更新、密钥保存、配置、模型目录刷新、查询、校验、已有任务轮询和结果保存，直接执行，不再询问是否继续。缺少必要参数时可以询问信息，但不要把普通操作改成审批步骤。

## 运行环境

本 Skill 可独立安装到支持 Agent Skills 的 agent；不依赖 Codex 专属工具。需要 Node.js 20+、文件读写和联网执行命令的能力。`<skill-dir>` 指当前 `SKILL.md` 所在目录，执行时替换为实际绝对路径并正确引用空格路径；输出写到用户工作目录，不写入 Skill 安装目录。若运行在容器或远程 agent，Node、素材和凭据必须位于实际执行环境中。宿主没有命令执行能力时，说明缺少的能力，不声称已生成成品。

KaiyunCode video generation is asynchronous only. Use the bundled runner for
adapter selection, validation, submission, polling, and atomic result storage.
Never assemble a request from a model name.

先从用途、风格、规格和素材整理视频创意简报；若同时安装了 `kaiyuncode-create`，跨图片 / 视频需求可交给它引导。本 Skill 的命令和凭据保存均可独立使用。

## First-use guidance（必须）

先用 `--list-models` 检查已有凭据；仅缺少凭据时执行以下步骤，不因新会话重复索取 Key：

1. 请用户把 API Key **粘贴到聊天框**。
2. 保存为权威媒体密钥（不改 Codex / Claude 文本客户端）：

```bash
KAIYUN_API_KEY='...' node <skill-dir>/scripts/save-api-key.mjs
```

3. 只有用户明确要求配置文本客户端时，再使用已安装的 `kaiyuncode-configure-agents`；未安装时说明需要该可选 Skill。
4. 用户没有密钥时再提供：[注册或登录](https://kaiyuncode.com/?login=1) → [充值](https://kaiyuncode.com/pricing) → [创建 API Key](https://kaiyuncode.com/account/api-key)。

## Credentials

媒体任务凭据优先级（**固定**）：

1. 本次 `KAIYUN_API_KEY` 环境变量
2. `~/.config/kaiyuncode/credentials.env`（权威文件；兼容旧版 Codex 媒体凭据）
3. 仅当 1/2 都没有时，才 fallback 到 Codex / Claude 的 KaiyunCode 配置

**不要**因为 Claude 与 file 密钥不同就卡住。有 file/env 时直接用，忽略客户端差异。
需要指定来源时：

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs ... --credential-source file
```

禁止 `--api-key` argv；禁止回显完整 Key。

## Workflow

1. 从用户目标判断文生、图生、多图参考、首尾帧、分镜、参考素材或复刻；先确认用途、画幅、时长和已有素材，不要求用户提供 capability 名称。
2. 映射到 [production adapter reference](references/api.md) 中的 capability，然后运行 `--list-models --capability KEY` 获取当前模型与实时价格。
3. 只从返回结果中给出最多 3 个候选，优先推荐 1 个；说明单价、适用理由和所需素材。没有依据时不要编造质量或速度差异。
4. 整理最终提示词、素材、关键参数和输出路径，只收集选定适配器缺少的必填字段。
   所有参考图片、视频和音频都可直接使用本机文件；不要要求用户先上传对象存储或准备公网 URL。Runner 会读取并封装本机文件，由 KaiyunCode 转存。
5. **先 `--dry-run`**。它会再次校验 `/v1/models` 与 `/api/pricing`，CLI 默认打印人类可读 **confirmCard**，不会发付费 POST。
6. **把 confirmCard 全文贴进聊天**，包含任务、模型、时长/分辨率/画幅、参考素材的分类数量与安全文件名、输出、提示词摘要、预计费用和预算上限；没有参考素材时明确显示「无」。确认卡展示后必须停止当前轮。
7. 预算明确且用户回复「确认提交」后，使用完全相同的参数去掉 `--dry-run` 再 POST。
8. 报告 task IDs、状态、脱敏 URL、绝对路径并展示视频；根据原目标给出不超过 3 个具体迭代方向。需要再次生视频的修改必须重新 dry-run 和确认；仅查询、下载或整理已有结果直接执行。

### 实时模型与价格

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --list-models --capability video_capability_video_text_generation
```

用户只问模型或费用时，到这里即可。不要强迫进入生成流程。

### 单任务

```bash
# 默认输出确认卡（给用户看）
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --capability video_capability_video_text_generation \
  --model omni-flash \
  --prompt "A calm coastal drone shot at golden hour" \
  --output ./result.mp4 \
  --dry-run

# 需要完整 JSON 时再加 --json
node <skill-dir>/scripts/kaiyuncode-video.mjs ... --dry-run --json
```

### 多任务必须全并发

- N 个独立任务 → N 路并发（`--jobs-file`）。
- 单个失败不得取消其它任务。
- dry-run 的总确认卡必须展示全部任务。
- 同一批任务只读取一轮 `/v1/models` 与 `/api/pricing`。

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs --jobs-file ./jobs.json --dry-run
```

Resume:

```bash
node <skill-dir>/scripts/kaiyuncode-video.mjs \
  --task-id vid_paid_123 \
  --output ./result.mp4
```

## Stop Conditions

- Stop if validation fails, the selected adapter is unavailable, or the model is absent from runtime `GET /v1/models`.
- Treat `/api/pricing` as the only price source. Never fall back to a snapshot price; a paid POST must stop when pricing is missing.
- Never automatically retry a paid POST timeout / 429 / 5xx.
- Do not run real paid requests just to test; use dry-run or mocks.
- Do not submit while the budget ceiling is unknown.
- Do not submit after dry-run without pasting the confirmCard and getting explicit user authorization.

Never place an API key in command-line arguments, logs, or chat output.

凭据目录可用 `KAIYUN_HOME` 覆盖，文件名固定为 `credentials.env`。新文件不存在时依次读取 `~/.codex/kaiyun-tools.env`、`~/.codex/kaiyun-video.env`（尊重 `CODEX_HOME`），再按原有规则尝试 Codex / Claude 的 KaiyunCode 凭据。安装或保存媒体 Key 不会配置任何 agent 的文本模型。
