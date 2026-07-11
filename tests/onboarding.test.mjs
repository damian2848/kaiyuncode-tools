import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboarding } from "../shared/onboarding.mjs";

test("default onboarding asks the user to paste a key in chat", () => {
  const result = buildOnboarding({ hasCredential: false });

  assert.equal(result.mode, "paste-key");
  assert.match(result.question, /粘贴.*API Key|API Key.*粘贴/);
  assert.deepEqual(result.steps, []);
});

test("pasted key skips questions and enters quick configure", () => {
  assert.deepEqual(buildOnboarding({ hasPastedKey: true }), {
    mode: "quick-configure",
    question: null,
    message: "已收到 API Key，立即进入配置或生成流程。",
    steps: [],
  });
});

test("existing credential offers direct continue", () => {
  const result = buildOnboarding({ hasCredential: true });
  assert.equal(result.mode, "verify");
  assert.match(result.question, /已检测到 KaiyunCode API Key/);
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
