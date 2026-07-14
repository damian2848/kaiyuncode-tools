import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreativeCatalog,
  formatCreativeCatalog,
} from "../shared/creative-catalog.mjs";

const capabilities = [
  {
    key: "image_text_generation",
    name: "文生图",
    description: "从提示词生成图片",
    adapters: [
      {
        model: "available-model",
        parameters: [
          { name: "model", required: true },
          { name: "prompt", required: true },
        ],
      },
      {
        model: "available-model",
        parameters: [
          { name: "model", required: true },
          { name: "prompt", required: true },
          { name: "image_urls[]", required: true },
        ],
      },
      {
        model: "retired-model",
        parameters: [
          { name: "model", required: true },
          { name: "prompt", required: true },
        ],
      },
    ],
  },
];

test("creative catalog intersects adapters with runtime models and prices", () => {
  const catalog = buildCreativeCatalog({
    kind: "image",
    capabilities,
    runtimeCatalog: {
      availableModels: new Set(["available-model", "runtime-only-model"]),
      priceLabels: new Map([["available-model", "$0.0500/次"]]),
      checkedAt: "2026-07-14T01:02:03.000Z",
    },
  });

  assert.equal(catalog.availableModelCount, 1);
  assert.equal(catalog.excludedModelCount, 1);
  assert.equal(catalog.capabilities[0].models[0].model, "available-model");
  assert.equal(catalog.capabilities[0].models[0].priceLabel, "$0.0500/次");
  assert.deepEqual(catalog.capabilities[0].models[0].profiles, [
    { requiredInputs: ["prompt"] },
    { requiredInputs: ["prompt", "image_urls[]"] },
  ]);
});

test("creative catalog formats a concise Chinese discovery view", () => {
  const catalog = buildCreativeCatalog({
    kind: "image",
    capabilities,
    capabilityKey: "image_text_generation",
    runtimeCatalog: {
      availableModels: new Set(["available-model"]),
      priceLabels: new Map(),
    },
  });
  const output = formatCreativeCatalog(catalog);

  assert.match(output, /KaiyunCode 实时图片模型/);
  assert.match(output, /文生图（image_text_generation）/);
  assert.match(output, /available-model｜价格待确认/);
  assert.match(output, /prompt \+ image_urls\[\]/);
  assert.doesNotMatch(output, /retired-model/);
});

test("creative catalog rejects an unknown capability filter", () => {
  assert.throws(
    () =>
      buildCreativeCatalog({
        kind: "image",
        capabilities,
        capabilityKey: "missing",
        runtimeCatalog: {
          availableModels: new Set(),
          priceLabels: new Map(),
        },
      }),
    /capability missing is not available/,
  );
});
