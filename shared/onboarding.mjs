/**
 * Build the first-use guidance for KaiyunCode skills.
 *
 * Default after install / first use: paste API Key in the Codex chat box and
 * save it for image/video only. Do NOT reconfigure Codex / Claude Code unless
 * the user explicitly asks.
 */
export function buildOnboarding({
  hasCredential = false,
  hasPastedKey = false,
  userLacksKey = false,
  justInstalled = false,
  wantsAgentConfig = false,
} = {}) {
  if (hasPastedKey) {
    if (wantsAgentConfig) {
      return {
        mode: "quick-configure",
        question: null,
        message:
          "已收到 API Key。用户明确要求配置客户端，进入 Codex / Claude Code 配置流程。",
        steps: [],
      };
    }
    return {
      mode: "save-key",
      question: null,
      message:
        "已收到 API Key。仅保存供图片 / 视频调用使用，不修改 Codex / Claude Code 默认模型配置。",
      steps: [],
    };
  }

  if (hasCredential) {
    return {
      mode: "verify",
      question: "已检测到 KaiyunCode API Key，是否直接继续图片 / 视频任务？",
      message:
        "已有媒体密钥时可跳过粘贴。只有用户明确要求时，才配置 Codex / Claude Code。",
      steps: [],
    };
  }

  if (userLacksKey) {
    return {
      mode: "create-key",
      question: null,
      message:
        "还没有密钥时，按顺序完成注册、充值、创建密钥，然后把 Key 直接粘贴到 Codex 聊天框。",
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
      ? "插件已安装。请直接把 KaiyunCode API Key 粘贴到 Codex 聊天框。"
      : "请直接把 KaiyunCode API Key 粘贴到 Codex 聊天框。",
    message: justInstalled
      ? "安装后先保存密钥，供图片 / 视频使用。默认不会改 Codex / Claude Code；只有你明确要求时才配置客户端。"
      : "收到后先保存供图片 / 视频调用。默认不改 Codex / Claude Code；若还没有密钥，回复「没有密钥」。",
    steps: [],
  };
}
