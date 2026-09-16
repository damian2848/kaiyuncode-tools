import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboarding } from "../shared/onboarding.mjs";

test("default onboarding starts with the creative brief instead of credentials", () => {
  const result = buildOnboarding({ justInstalled: true, forMedia: true });

  assert.equal(result.mode, "creative-brief");
  assert.equal(result.currentStage, "brief");
  assert.match(result.question, /图片还是视频|创作/);
  assert.match(result.message, /不需要先懂模型或参数/);
  assert.deepEqual(
    result.journey.map(({ id }) => id),
    [
      "brief",
      "credential",
      "discovery",
      "plan",
      "confirmation",
      "generation",
      "delivery",
    ],
  );
});

test("a prepared brief advances to credential setup", () => {
  const result = buildOnboarding({
    hasCreativeBrief: true,
    forMedia: true,
  });

  assert.equal(result.mode, "paste-key");
  assert.equal(result.currentStage, "credential");
  assert.match(result.question, /API Key.*粘贴|粘贴.*API Key/);
  assert.match(result.message, /不修改文本客户端/);
});

test("pasted key is saved before real-time model discovery", () => {
  const result = buildOnboarding({
    hasCreativeBrief: true,
    hasPastedKey: true,
    forMedia: true,
  });

  assert.equal(result.mode, "save-key");
  assert.equal(result.currentStage, "credential");
  assert.match(result.message, /kaiyun-tools\.env|实时选型/);
  assert.ok(result.steps.some(({ detail }) => /--list-models/.test(detail)));
});

test("pasted key with explicit agent config request enters configure mode", () => {
  const result = buildOnboarding({
    hasPastedKey: true,
    wantsAgentConfig: true,
  });
  assert.equal(result.mode, "quick-configure");
  assert.equal(result.question, null);
  assert.match(result.message, /配置|Codex|Claude/);
});

test("existing credentials and a configuration request proceed without entering media confirmation", () => {
  const result = buildOnboarding({ hasCredential: true, wantsAgentConfig: true });
  assert.equal(result.mode, "quick-configure");
  assert.equal(result.question, null);
});

test("only users who say they lack a key receive registration links", () => {
  const result = buildOnboarding({
    hasCreativeBrief: true,
    userLacksKey: true,
    forMedia: true,
  });
  assert.equal(result.mode, "create-key");
  assert.deepEqual(result.steps, [
    { label: "注册或登录", url: "https://kaiyuncode.com/?login=1" },
    { label: "充值余额", url: "https://kaiyuncode.com/pricing" },
    { label: "创建 API Key", url: "https://kaiyuncode.com/account/api-key" },
  ]);
});

test("brief and credentials advance to live model discovery", () => {
  const result = buildOnboarding({
    hasCreativeBrief: true,
    hasCredential: true,
    forMedia: true,
  });

  assert.equal(result.mode, "model-discovery");
  assert.equal(result.currentStage, "discovery");
  assert.match(result.message, /--list-models|实时单价/);
});

test("selected model advances through plan, confirmation, generation, and iteration", () => {
  const plan = buildOnboarding({
    hasCreativeBrief: true,
    hasCredential: true,
    hasModelSelection: true,
    forMedia: true,
  });
  assert.equal(plan.mode, "prepare-dry-run");
  assert.equal(plan.currentStage, "plan");

  const confirmation = buildOnboarding({
    hasCreativeBrief: true,
    hasCredential: true,
    hasModelSelection: true,
    hasPlan: true,
    hasDryRun: true,
    forMedia: true,
  });
  assert.equal(confirmation.mode, "await-confirmation");
  assert.equal(confirmation.currentStage, "confirmation");
  assert.match(confirmation.question, /确认提交/);

  const generation = buildOnboarding({
    hasCreativeBrief: true,
    hasCredential: true,
    hasModelSelection: true,
    hasPlan: true,
    hasDryRun: true,
    hasConfirmed: true,
    forMedia: true,
  });
  assert.equal(generation.mode, "generate");
  assert.equal(generation.currentStage, "generation");
  assert.match(generation.message, /不自动重试/);

  const iteration = buildOnboarding({
    hasCreativeBrief: true,
    hasCredential: true,
    hasModelSelection: true,
    hasPlan: true,
    hasDryRun: true,
    hasConfirmed: true,
    hasResult: true,
    forMedia: true,
  });
  assert.equal(iteration.mode, "iterate");
  assert.equal(iteration.currentStage, "delivery");
  assert.match(iteration.message, /重新 dry-run/);
});

test("existing non-media credential keeps the optional client configuration path", () => {
  const result = buildOnboarding({ hasCredential: true });
  assert.equal(result.mode, "verify");
  assert.equal(result.question, null);
  assert.match(result.message, /明确要求.*配置/);
});
