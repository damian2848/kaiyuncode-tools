/**
 * Build the first-use guidance for KaiyunCode skills.
 *
 * Fast path (default): ask the user to paste an API Key in chat.
 * Only show registration links when the user says they do not have a key.
 */
export function buildOnboarding({
  hasCredential = false,
  hasPastedKey = false,
  userLacksKey = false,
} = {}) {
  if (hasPastedKey) {
    return {
      mode: "quick-configure",
      question: null,
      message: "已收到 API Key，立即进入配置或生成流程。",
      steps: [],
    };
  }

  if (hasCredential) {
    return {
      mode: "verify",
      question: "已检测到 KaiyunCode API Key，是否直接继续？",
      message: "已有可用密钥时可跳过粘贴，直接配置或生成。",
      steps: [],
    };
  }

  if (userLacksKey) {
    return {
      mode: "create-key",
      question: null,
      message: "还没有密钥时，按顺序完成注册、充值、创建密钥，然后把 Key 粘贴到聊天框。",
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
    question: "请直接把 KaiyunCode API Key 粘贴到聊天框。",
    message:
      "收到后立即配置或生成，无需终端隐藏输入。若还没有密钥，回复「没有密钥」获取注册/充值/创建链接。",
    steps: [],
  };
}
