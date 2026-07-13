import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboarding } from "../shared/onboarding.mjs";

test("default onboarding asks the user to paste a key in chat", () => {
  const result = buildOnboarding({ hasCredential: false });

  assert.equal(result.mode, "paste-key");
  assert.match(result.question, /粘贴.*API Key|API Key.*粘贴/);
  assert.match(result.question, /Codex 聊天框/);
  assert.match(result.message, /图片|视频/);
  assert.doesNotMatch(result.message, /立即配置 Codex|默认配置 Codex/);
  assert.doesNotMatch(result.message, /风险|安全警告|不要粘贴/);
  assert.deepEqual(result.steps, []);
});

test("post-install onboarding saves media key without agent reconfiguration", () => {
  const result = buildOnboarding({ justInstalled: true });

  assert.equal(result.mode, "paste-key");
  assert.match(result.question, /插件已安装/);
  assert.match(result.question, /粘贴.*API Key|API Key.*粘贴/);
  assert.match(result.message, /不会改 Codex|不改 Codex/);
  assert.doesNotMatch(result.message, /不要粘贴|禁止粘贴|有风险请勿/);
});

test("pasted key defaults to save-key only", () => {
  assert.deepEqual(buildOnboarding({ hasPastedKey: true }), {
    mode: "save-key",
    question: null,
    message:
      "已收到 API Key。仅保存供图片 / 视频调用使用，不修改 Codex / Claude Code 默认模型配置。",
    steps: [],
  });
});

test("pasted key with explicit agent-config intent enters configure flow", () => {
  const result = buildOnboarding({ hasPastedKey: true, wantsAgentConfig: true });
  assert.equal(result.mode, "quick-configure");
  assert.match(result.message, /明确要求配置客户端/);
});

test("existing credential offers direct continue for media work", () => {
  const result = buildOnboarding({ hasCredential: true });
  assert.equal(result.mode, "verify");
  assert.match(result.question, /已检测到 KaiyunCode API Key/);
  assert.match(result.message, /只有用户明确要求时/);
  assert.deepEqual(result.steps, []);
});

test("only users without a key receive registration links", () => {
  const result = buildOnboarding({ userLacksKey: true });
  assert.equal(result.mode, "create-key");
  assert.deepEqual(result.steps, [
    { label: "注册或登录", url: "https://kaiyuncode.com/?login=1" },
    { label: "充值余额", url: "https://kaiyuncode.com/pricing" },
    { label: "创建 API Key", url: "https://kaiyuncode.com/account/api-key" },
  ]);
});
