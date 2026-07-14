import assert from "node:assert/strict";
import test from "node:test";

import {
  MODELS_URL,
  PRICING_URL,
  loadRuntimeCatalog,
  memoizeRuntimeCatalogLoader,
} from "../shared/runtime-catalog.mjs";

const modelsPayload = {
  object: "list",
  data: [
    { id: "grok-imagine-video", object: "model" },
    { id: "gpt-image-2", object: "model" },
  ],
};

const pricingPayload = {
  data: [
    {
      model_name: "grok-imagine-video",
      description: "模型：Grok Imagine Video\n平台价：$0.0500/6秒，$0.0700/10秒",
    },
    {
      model_name: "gpt-image-2",
      description: "平台价：$0.0150/次",
    },
    {
      model_name: "available-without-price",
      description: "模型已启用，尚未提供平台价",
    },
  ],
};

function response(payload, init) {
  return new Response(JSON.stringify(payload), init);
}

test("loads current models and pricing concurrently from the fixed production endpoints", async () => {
  const calls = [];
  const releases = new Map();
  const fetchImpl = (url, options) => {
    calls.push({ url, options });
    return new Promise((resolve) => releases.set(url, resolve));
  };

  const pending = loadRuntimeCatalog({
    apiKey: "secret-test-key",
    fetchImpl,
    now: () => Date.parse("2026-07-14T01:02:03.000Z"),
  });
  await Promise.resolve();
  assert.deepEqual(calls.map(({ url }) => url).sort(), [PRICING_URL, MODELS_URL]);

  releases.get(MODELS_URL)(response(modelsPayload));
  releases.get(PRICING_URL)(response(pricingPayload));
  const catalog = await pending;

  assert.deepEqual([...catalog.availableModels].sort(), [
    "gpt-image-2",
    "grok-imagine-video",
  ]);
  assert.equal(
    catalog.priceLabels.get("grok-imagine-video"),
    "$0.0500/6秒，$0.0700/10秒",
  );
  assert.equal(catalog.priceLabels.get("available-without-price"), undefined);
  assert.equal(catalog.checkedAt, "2026-07-14T01:02:03.000Z");

  const modelCall = calls.find(({ url }) => url === MODELS_URL);
  const pricingCall = calls.find(({ url }) => url === PRICING_URL);
  assert.equal(modelCall.options.method, "GET");
  assert.equal(modelCall.options.redirect, "error");
  assert.equal(modelCall.options.headers.Authorization, "Bearer secret-test-key");
  assert.deepEqual(pricingCall.options.headers, {});
  assert.equal(pricingCall.options.redirect, "error");
});

test("reports authentication failure without exposing the API Key", async () => {
  const secret = "secret-that-must-not-leak";
  const fetchImpl = async (url) =>
    url === MODELS_URL
      ? response({ message: `bad ${secret}` }, { status: 401 })
      : response(pricingPayload);

  await assert.rejects(
    loadRuntimeCatalog({ apiKey: secret, fetchImpl }),
    (error) => {
      assert.match(error.message, /authentication failed.*\/v1\/models/i);
      assert.ok(!error.message.includes(secret));
      return true;
    },
  );
});

for (const [name, models, pricing, pattern] of [
  [
    "malformed model payload",
    { object: "list", data: [{ name: "missing-id" }] },
    pricingPayload,
    /every data item must have an id/,
  ],
  [
    "malformed pricing payload",
    modelsPayload,
    { data: [{ description: "平台价：$1/次" }] },
    /every data item must have a model_name/,
  ],
  [
    "duplicate pricing model",
    modelsPayload,
    {
      data: [
        { model_name: "gpt-image-2", description: "平台价：$1/次" },
        { model_name: "gpt-image-2", description: "平台价：$2/次" },
      ],
    },
    /Duplicate pricing model/,
  ],
]) {
  test(`rejects ${name}`, async () => {
    const fetchImpl = async (url) =>
      response(url === MODELS_URL ? models : pricing);
    await assert.rejects(
      loadRuntimeCatalog({ apiKey: "test-key", fetchImpl }),
      pattern,
    );
  });
}

test("does not invent retired models or missing prices", async () => {
  const fetchImpl = async (url) =>
    response(
      url === MODELS_URL
        ? {
            object: "list",
            data: [{ id: "grok-imagine-video" }],
          }
        : {
            data: [
              {
                model_name: "grok-imagine-video",
                description: "平台价：$0.0500/6秒，$0.0700/10秒",
              },
            ],
          },
    );
  const catalog = await loadRuntimeCatalog({ apiKey: "test-key", fetchImpl });

  assert.equal(catalog.availableModels.has("omni_flash-fast"), false);
  assert.equal(catalog.availableModels.has("omni_flash_edit-fast"), false);
  assert.equal(catalog.priceLabels.has("omni_flash-fast"), false);
});

test("memoized loader shares one request per API Key", async () => {
  let calls = 0;
  const load = memoizeRuntimeCatalogLoader(async ({ apiKey }) => {
    calls += 1;
    await Promise.resolve();
    return { apiKey };
  });

  const [first, second] = await Promise.all([
    load({ apiKey: "same-key" }),
    load({ apiKey: "same-key" }),
  ]);
  assert.equal(calls, 1);
  assert.strictEqual(first, second);
  await load({ apiKey: "other-key" });
  assert.equal(calls, 2);
});
