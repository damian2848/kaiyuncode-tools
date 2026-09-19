const features = {
  "kaiyuncode-create": [
    "创作助手：从想法整理提示词、选择模型，确认预算后生成图片或视频。",
    "示例：用 KaiyunCode 做一张咖啡店海报，先给我方案和费用。",
  ],
  "kaiyuncode-image": [
    "图片：文字生图、参考图编辑、多图参考；查询实时模型和价格，下载成品。",
    "示例：把这张产品图换成暖色背景，先告诉我多少钱。",
  ],
  "kaiyuncode-video": [
    "视频：文字或参考素材生成视频，查询任务进度、恢复下载。",
    "示例：把产品图做成 5 秒展示视频，先给我方案和费用。",
  ],
  "kaiyuncode-configure-agents": [
    "模型接入：为 Codex、Claude Code、OpenClaw 配置 KaiyunCode；刷新可用模型。",
    "示例：将 OpenClaw 的模型只保留 KaiyunCode，同步全部文本模型和推理强度。",
  ],
};

export function installationGuide(skills = Object.keys(features)) {
  const selected = [...new Set(skills)].filter((name) => features[name]);
  return [
    "KaiyunTool 安装完成。新建一个助手会话后，直接用中文说需求。",
    "你现在可以：",
    ...selected.flatMap((name) => [`- ${features[name][0]}`, `  ${features[name][1]}`]),
    "首次使用会先检查已有 KaiyunCode API Key；没有时再创建：https://kaiyuncode.com/account/api-key",
    "安装本身不会切换模型或发起付费生成。需要接入哪个客户端，直接告诉助手；图片/视频会先展示预算，确认后生成。",
  ].join("\n");
}
