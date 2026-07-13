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
        output: "/tmp/shot1.mp4",
        request: {
          method: "POST",
          path: "/v1/videos",
          body: {
            model: "omni_flash_i2v",
            prompt: "A clean product shot of blue denim trousers.",
            image_url: "data:image/png;base64,AAAA",
            aspect_ratio: "9:16",
            resolution: "720p",
            duration: 10,
          },
        },
      },
    ],
  });

  assert.match(card, /【KaiyunCode 视频 · 待确认】/);
  assert.match(card, /omni_flash_i2v/);
  assert.match(card, /duration=10/);
  assert.match(card, /resolution=720p/);
  assert.match(card, /aspect_ratio=9:16/);
  assert.match(card, /image_url=data-url/);
  assert.match(card, /output: \/tmp\/shot1\.mp4/);
  assert.match(card, /A clean product shot/);
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
});

test("withConfirmCard attaches cards to single and concurrent dry-runs", () => {
  const single = withConfirmCard(
    {
      dryRun: true,
      capabilityKey: "image_text_generation",
      model: "gpt-image-2",
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
  assert.match(concurrent.confirmCard, /任务数: 2/);
  assert.match(concurrent.results[0].result.confirmCard, /prompt: a/);
});
