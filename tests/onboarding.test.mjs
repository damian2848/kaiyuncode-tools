import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboarding } from "../shared/onboarding.mjs";

test("onboarding asks about an existing key before links", () => {
  const result = buildOnboarding({ hasCredential: false });

  assert.match(result.question, /是否已经有 KaiyunCode API Key/);
  assert.deepEqual(result.steps, [
    { label: "注册或登录", url: "https://kaiyuncode.com/?login=1" },
    { label: "充值余额", url: "https://kaiyuncode.com/pricing" },
    { label: "创建 API Key", url: "https://kaiyuncode.com/account/api-key" },
  ]);
});

test("onboarding offers credential verification when a key is present", () => {
  assert.deepEqual(buildOnboarding({ hasCredential: true }), {
    question: "已检测到 KaiyunCode API Key，是否验证并继续？",
    steps: [],
  });
});
