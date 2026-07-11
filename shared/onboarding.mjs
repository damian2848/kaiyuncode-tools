export function buildOnboarding({ hasCredential }) {
  return hasCredential
    ? {
        question: "已检测到 KaiyunCode API Key，是否验证并继续？",
        steps: [],
      }
    : {
        question: "你是否已经有 KaiyunCode API Key？",
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
