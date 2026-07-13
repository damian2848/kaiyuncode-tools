/**
 * Build the first-use guidance for KaiyunCode skills.
 *
 * Default: paste API Key in chat → save as canonical media key
 * (~/.codex/kaiyun-tools.env). Do not reconfigure Codex / Claude Code unless
 * the user explicitly asks. Paid image/video work always goes through dry-run
 * confirmation cards before POST.
 */
export function buildOnboarding({
  hasCredential = false,
  hasPastedKey = false,
  userLacksKey = false,
  justInstalled = false,
  wantsAgentConfig = false,
  forMedia = false,
} = {}) {
  if (hasPastedKey) {
    if (wantsAgentConfig) {
      return {
        mode: "quick-configure",
        question: null,
        message:
          "已收到 API Key。用户明确要求配置客户端，进入 Codex / Claude Code 配置流程。",
        steps: [
          {
            label: "保存权威媒体密钥（推荐同时做）",
            detail: "save-api-key.mjs → ~/.codex/kaiyun-tools.env",
          },
          {
            label: "配置文本客户端",
            detail: "configure-agents.mjs --dry-run → 确认后写入",
          },
        ],
      };
    }
    return {
      mode: "save-key",
      question: null,
      message:
        "已收到 API Key。保存为图片 / 视频权威密钥（~/.codex/kaiyun-tools.env），不修改 Codex / Claude Code。",
      steps: [
        {
          label: "保存密钥",
          detail: "KAIYUN_API_KEY=… node …/save-api-key.mjs",
        },
      ],
    };
  }

  if (hasCredential) {
    return {
      mode: forMedia ? "media-ready" : "verify",
      question: forMedia
        ? "已检测到 KaiyunCode 媒体密钥。是否继续选择模型并 dry-run？"
        : "已检测到 KaiyunCode API Key，是否直接继续？",
      message: forMedia
        ? "媒体任务使用 env > file 权威密钥。先 dry-run 出确认卡，用户回复「确认提交」后再付费 POST。"
        : "已有密钥时可跳过粘贴。只有用户明确要求时，才配置 Codex / Claude Code。",
      steps: forMedia
        ? [
            { label: "选 capability + model", detail: "对照 production snapshot" },
            { label: "dry-run", detail: "展示 confirmCard 全文给用户" },
            { label: "确认提交", detail: "用户明确授权后再去掉 --dry-run" },
          ]
        : [],
    };
  }

  if (userLacksKey) {
    return {
      mode: "create-key",
      question: null,
      message:
        "还没有密钥时，按顺序完成注册、充值、创建密钥，然后把 Key 直接粘贴到聊天框。",
      steps: [
        { label: "注册或登录", url: "https://kaiyuncode.com/?login=1" },
        { label: "充值余额", url: "https://kaiyuncode.com/pricing" },
        {
          label: "创建 API Key",
          url: "https://kaiyuncode.com/account/api-key",
        },
      ],
    };
  }

  return {
    mode: "paste-key",
    question: justInstalled
      ? "插件已安装。请直接把 KaiyunCode API Key 粘贴到聊天框。"
      : "请直接把 KaiyunCode API Key 粘贴到聊天框。",
    message: justInstalled
      ? "安装后先保存权威媒体密钥。默认不改 Codex / Claude Code；图片 / 视频提交前必须 dry-run 确认卡。"
      : "收到后保存到 ~/.codex/kaiyun-tools.env 供图片 / 视频使用。默认不改文本客户端；若还没有密钥，回复「没有密钥」。",
    steps: [
      {
        label: "粘贴并保存密钥",
        detail: "权威来源：env 覆盖 > kaiyun-tools.env",
      },
      {
        label: "生成前确认",
        detail: "dry-run → 粘贴 confirmCard → 用户确认后再 POST",
      },
    ],
  };
}
