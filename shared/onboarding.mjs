const JOURNEY = [
  ["brief", "创意简报"],
  ["credential", "凭据就绪"],
  ["discovery", "实时选型"],
  ["plan", "创作方案"],
  ["confirmation", "预算确认"],
  ["generation", "生成"],
  ["delivery", "交付与迭代"],
];

function creationJourney(completed) {
  let foundCurrent = false;
  return JOURNEY.map(([id, label]) => {
    if (completed.has(id)) return { id, label, status: "completed" };
    if (!foundCurrent) {
      foundCurrent = true;
      return { id, label, status: "current" };
    }
    return { id, label, status: "pending" };
  });
}

function withJourney(result, completed) {
  const journey = creationJourney(completed);
  const current = journey.find(({ status }) => status === "current") ?? null;
  return {
    ...result,
    currentStage: current?.id ?? "complete",
    journey,
  };
}

export function buildOnboarding({
  hasCredential = false,
  hasPastedKey = false,
  userLacksKey = false,
  justInstalled = false,
  wantsAgentConfig = false,
  forMedia = false,
  hasCreativeBrief = false,
  hasModelSelection = false,
  hasPlan = false,
  hasDryRun = false,
  hasConfirmed = false,
  hasResult = false,
  hasDelivered = false,
} = {}) {
  const completed = new Set();
  if (hasCreativeBrief) completed.add("brief");
  if (hasCredential) completed.add("credential");
  if (hasModelSelection) completed.add("discovery");
  if (hasPlan) completed.add("plan");
  if (hasConfirmed) completed.add("confirmation");
  if (hasResult) completed.add("generation");
  if (hasDelivered) completed.add("delivery");

  if (hasPastedKey) {
    if (wantsAgentConfig) {
      return withJourney({
        mode: "quick-configure",
        question: null,
        message:
          "已收到 API Key。先保存媒体权威密钥；用户明确要求了客户端配置，再预览 Codex / Claude Code 变更。",
        steps: [
          {
            label: "保存权威媒体密钥",
            detail: "save-api-key.mjs → ~/.codex/kaiyun-tools.env",
          },
          {
            label: "预览客户端配置",
            detail: "configure-agents.mjs --dry-run → 确认后写入",
          },
        ],
      }, completed);
    }
    return withJourney({
      mode: "save-key",
      question: null,
      message:
        "已收到 API Key。保存到 ~/.codex/kaiyun-tools.env 后继续实时选型，不修改 Codex / Claude Code。",
      steps: [
        {
          label: "保存密钥",
          detail: "KAIYUN_API_KEY=… node …/save-api-key.mjs",
        },
        {
          label: "继续创作",
          detail: "运行 --list-models 获取当前模型和价格",
        },
      ],
    }, completed);
  }

  if (!forMedia && hasCredential) {
    return withJourney({
      mode: "verify",
      question: "已检测到 KaiyunCode API Key，是否直接继续？",
      message:
        "已有密钥时可跳过粘贴。只有用户明确要求时，才配置 Codex / Claude Code。",
      steps: [],
    }, completed);
  }

  if (!hasCreativeBrief) {
    return withJourney({
      mode: "creative-brief",
      question: justInstalled
        ? "插件已就绪。你想创作图片还是视频，准备发布到哪里，有没有参考素材？"
        : "这次想创作什么图片或视频，主要用途是什么，有没有参考素材？",
      message:
        "先把想法整理成创作简报，再检查密钥、实时模型和价格；现在不需要先懂模型或参数。",
      steps: [
        { label: "说出想法", detail: "类型、用途、风格、平台、素材" },
        { label: "实时选型", detail: "自动检查凭据、可用模型和价格" },
        { label: "预算确认", detail: "dry-run 确认卡后等待明确授权" },
        { label: "生成交付", detail: "轮询完成、展示文件、继续迭代" },
      ],
    }, completed);
  }

  if (!hasCredential) {
    if (userLacksKey) {
      return withJourney({
        mode: "create-key",
        question: null,
        message:
          "创作简报已准备好。按顺序完成注册、充值和创建密钥，再把 Key 直接粘贴到聊天框。",
        steps: [
          { label: "注册或登录", url: "https://kaiyuncode.com/?login=1" },
          { label: "充值余额", url: "https://kaiyuncode.com/pricing" },
          {
            label: "创建 API Key",
            url: "https://kaiyuncode.com/account/api-key",
          },
        ],
      }, completed);
    }
    return withJourney({
      mode: "paste-key",
      question: "创作方向已明确。请把 KaiyunCode API Key 直接粘贴到聊天框。",
      message:
        "收到后只保存为媒体权威密钥，不修改文本客户端；若还没有密钥，回复“没有密钥”。",
      steps: [
        {
          label: "粘贴并保存密钥",
          detail: "权威来源：env 覆盖 > kaiyun-tools.env",
        },
        {
          label: "实时选型",
          detail: "--list-models → 当前可用模型和 /api/pricing 单价",
        },
      ],
    }, completed);
  }

  if (!hasModelSelection) {
    return withJourney({
      mode: "model-discovery",
      question: null,
      message:
        "创意和凭据已就绪。运行 --list-models，只从当前可用适配器中推荐不超过 3 个模型，并展示实时单价。",
      steps: [
        { label: "读取实时目录", detail: "GET /v1/models + GET /api/pricing" },
        { label: "给出推荐", detail: "模型、价格、适用理由、所需素材" },
      ],
    }, completed);
  }

  if (!hasPlan || !hasDryRun) {
    return withJourney({
      mode: "prepare-dry-run",
      question: null,
      message:
        "整理最终提示词、素材、参数和输出路径，然后 dry-run；把预算确认卡全文展示给用户。",
      steps: [
        { label: "完成创作方案", detail: "只补齐选定适配器的必填输入" },
        { label: "执行 dry-run", detail: "只读联网，不发付费 POST" },
      ],
    }, completed);
  }

  if (!hasConfirmed) {
    return withJourney({
      mode: "await-confirmation",
      question: "请核对当前确认卡；确认无误后回复“确认提交”。",
      message:
        "任何模型、参数、素材、数量或预算变化都必须重新 dry-run，不能复用旧授权。",
      steps: [],
    }, completed);
  }

  if (!hasResult) {
    return withJourney({
      mode: "generate",
      question: null,
      message:
        "按确认卡的原始参数提交一次，异步轮询并保存结果；付费 POST 失败时不自动重试。",
      steps: [
        { label: "提交与轮询", detail: "报告 task ID 并保留恢复能力" },
        { label: "保存结果", detail: "返回绝对路径和脱敏 URL" },
      ],
    }, completed);
  }

  return withJourney({
    mode: "iterate",
    question: "成品已交付。下一轮想调整构图、风格、画幅还是节奏？",
    message:
      "迭代属于新的付费任务；先整理改动，再重新 dry-run 和确认预算。",
    steps: [],
  }, completed);
}
