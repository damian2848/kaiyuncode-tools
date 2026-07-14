import assert from "node:assert/strict";
import test from "node:test";

import {
  formatConfirmCard,
  withConfirmCard,
} from "../shared/confirm-card.mjs";

test("formatConfirmCard summarizes model, params, media, and prompt", () => {
  const card = formatConfirmCard({
    kind: "video",
    jobs: [
      {
        capabilityKey: "video_capability_video_image_to_video",
        model: "omni_flash_i2v",
        priceLabel: "$0.2200/次(720P)，$0.3000/次(1080P)，$0.5000/次(4K)",
        output: "/tmp/shot1.mp4",
        request: {
          method: "POST",
          path: "/v1/videos",
          body: {
            model: "omni_flash_i2v",
            prompt: "A clean product shot of blue denim trousers.",
            image_url: "data:image/png;base64,AAAA",
            video_url: "https://assets.example.test/source.mp4",
            aspect_ratio: "9:16",
            resolution: "720p",
            duration: 10,
          },
        },
      },
    ],
  });

  assert.match(card, /【KaiyunCode 视频任务确认】/);
  assert.match(card, /任务概览/);
  assert.match(card, /omni_flash_i2v/);
  assert.match(card, /模型校验：已通过实时 GET \/v1\/models/);
  assert.match(card, /duration=10/);
  assert.match(card, /resolution=720p/);
  assert.match(card, /aspect_ratio=9:16/);
  assert.match(card, /image_url=data-url/);
  assert.match(card, /video_url=https:\/\/assets\.example\.test\/\.\.\.\/source\.mp4/);
  assert.match(card, /输出：\/tmp\/shot1\.mp4/);
  assert.match(card, /A clean product shot/);
  assert.match(card, /预算/);
  assert.match(card, /单价来源：https:\/\/kaiyuncode\.com\/api\/pricing/);
  assert.match(card, /预计费用：\$0\.2200/);
  assert.match(card, /预算上限：\$0\.2200/);
  assert.match(card, /确认提交/);
  assert.doesNotMatch(card, /AAAA/);
});

test("formatConfirmCard handles FormData file summaries", () => {
  const card = formatConfirmCard({
    kind: "image",
    concurrent: true,
    jobs: [
      {
        capabilityKey: "image_edit",
        model: "gpt-image-2",
        priceLabel: "$0.0150/次",
        request: {
          method: "POST",
          path: "/v1/images/async/edits",
          body: {
            type: "FormData",
            fields: [
              { name: "model", value: "gpt-image-2" },
              { name: "prompt", value: "edit the cup" },
              {
                name: "image",
                value: { type: "File", name: "cup.png", size: 1200 },
              },
            ],
          },
        },
      },
    ],
  });
  assert.match(card, /KaiyunCode 图片/);
  assert.match(card, /cup\.png/);
  assert.match(card, /edit the cup/);
  assert.match(card, /预计费用：\$0\.0150/);
});

test("withConfirmCard attaches cards to single and concurrent dry-runs", () => {
  const single = withConfirmCard(
    {
      dryRun: true,
      capabilityKey: "image_text_generation",
      model: "gpt-image-2",
      priceLabel: "$0.0150/次",
      request: {
        method: "POST",
        path: "/v1/images/async/generations",
        body: { model: "gpt-image-2", prompt: "hello" },
      },
    },
    { kind: "image" },
  );
  assert.match(single.confirmCard, /确认提交/);
  assert.equal(single.dryRun, true);

  const concurrent = withConfirmCard(
    {
      concurrent: true,
      count: 2,
      results: [
        {
          index: 0,
          ok: true,
          result: {
            dryRun: true,
            capabilityKey: "video_capability_video_text_generation",
            model: "omni_flash",
            priceLabel: "$0.1000/次",
            request: {
              method: "POST",
              path: "/v1/videos",
              body: { model: "omni_flash", prompt: "a" },
            },
          },
        },
        {
          index: 1,
          ok: true,
          result: {
            dryRun: true,
            capabilityKey: "video_capability_video_text_generation",
            model: "omni_flash",
            priceLabel: "$0.1000/次",
            request: {
              method: "POST",
              path: "/v1/videos",
              body: { model: "omni_flash", prompt: "b" },
            },
          },
        },
      ],
    },
    { kind: "video" },
  );
  assert.equal(concurrent.dryRun, true);
  assert.match(concurrent.confirmCard, /任务数：2/);
  assert.match(concurrent.confirmCard, /预计合计：\$0\.2000/);
  assert.match(concurrent.results[0].result.confirmCard, /提示词：a/);
});

test("formatConfirmCard keeps submission blocked when public pricing is unavailable", () => {
  const card = formatConfirmCard({
    kind: "video",
    jobs: [
      {
        capabilityKey: "video_capability_video_text_generation",
        model: "omni_flash-fast",
        request: {
          method: "POST",
          path: "/v1/videos",
          body: { prompt: "fast preview" },
        },
      },
    ],
  });

  assert.match(card, /预计费用：待确认/);
  assert.match(card, /预算上限：待确认/);
  assert.match(card, /预算上限明确后.*确认提交/);
});

test("formatConfirmCard gives resumed tasks a zero budget without POST wording", () => {
  const card = formatConfirmCard({
    kind: "video",
    jobs: [{ taskId: "vid_paid_123", resume: true, output: "./result.mp4" }],
  });

  assert.match(card, /付费 POST：0 次/);
  assert.match(card, /预计费用：\$0\.0000/);
  assert.match(card, /参考单价：不适用/);
  assert.match(card, /确认继续.*不发起付费 POST/);
  assert.doesNotMatch(card, /确认提交/);
});
