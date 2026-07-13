import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboarding } from "../shared/onboarding.mjs";

test("default onboarding asks the user to paste a key in chat", () => {
  const result = buildOnboarding({ hasCredential: false });

  assert.equal(result.mode, "paste-key");
  assert.match(result.question, /粘贴.*API Key|API Key.*粘贴/);
  assert.ok(result.steps.length >= 1);
  assert.match(result.message, /kaiyun-tools\.env|权威/);
});

test("pasted key enters save-key mode for media by default", () => {
  const result = buildOnboarding({ hasPastedKey: true });
  assert.equal(result.mode, "save-key");
  assert.match(result.message, /权威|kaiyun-tools\.env|图片/);
});

test("pasted key with agent config request enters configure mode", () => {
  const result = buildOnboarding({
    hasPastedKey: true,
    wantsAgentConfig: true,
  });
  assert.equal(result.mode, "quick-configure");
  assert.match(result.message, /配置客户端|Codex|Claude/);
});

test("existing credential offers media-ready guidance", () => {
  const result = buildOnboarding({ hasCredential: true, forMedia: true });
  assert.equal(result.mode, "media-ready");
  assert.match(result.message, /confirmCard|dry-run|确认提交/);
  assert.ok(result.steps.some((step) => /dry-run/i.test(step.label)));
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
