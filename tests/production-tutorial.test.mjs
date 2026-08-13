import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadProductionCapabilities,
  normalizeProductionTutorial,
} from "../shared/production-tutorial.mjs";

const fixture = async (name) =>
  JSON.parse(
    await readFile(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"),
  );

const publicFixture = { models: [{ key: "unknown-model" }] };
const unknownCurlFixture = {
  updatedAt: 1,
  config: {
    version: 1,
    items: [
      {
        key: "unknown-capability",
        category: "image",
        mode: "api",
        endpointPath: "/v1/unknown",
        steps: [
          {
            parameters: [
              { name: "model", defaultValue: "unknown-model" },
            ],
            codeBlocks: [{ label: "cURL", code: "opaque" }],
          },
        ],
      },
    ],
  },
};

function tutorialWithStep(step, overrides = {}) {
  return {
    updatedAt: 1,
    config: {
      version: 1,
      items: [
        {
          key: "test-capability",
          category: "video",
          mode: "api",
          endpointPath: "/v1/videos",
          steps: [step],
          ...overrides,
        },
      ],
    },
  };
}

const modelParameters = [
  { name: "model", defaultValue: "unknown-model" },
];

test("normalizer intersects tutorial adapters with public models", async () => {
  const snapshot = normalizeProductionTutorial(
    await fixture("tutorial-page"),
    await fixture("public-model-options"),
  );
  const models = snapshot.imageCapabilities.flatMap((item) =>
    item.adapters.map((adapter) => adapter.model),
  );
  assert.ok(models.includes("gpt-image-2"));
  assert.ok(!models.includes("gpt-image-2-max"));
  assert.equal(snapshot.imageCapabilities.length, 4);
  assert.equal(snapshot.videoCapabilities.length, 8);
  assert.deepEqual(snapshot.publicModelKeys, [
    "gpt-image-2",
    "happyhorse-1.0-i2v",
    "happyhorse-1.0-t2v",
  ]);
});

test("normalizer preserves parameters and parses JSON and multipart variants", async () => {
  const snapshot = normalizeProductionTutorial(
    await fixture("tutorial-page"),
    await fixture("public-model-options"),
  );
  const generation = snapshot.imageCapabilities[0].adapters[0];
  assert.equal(generation.capabilityKey, "image_text_generation");
  assert.equal(generation.pollPath, "/v1/images/async/{task_id}");
  assert.equal(generation.priceLabel, undefined);
  assert.deepEqual(generation.parameters[1], {
    name: "prompt",
    location: "body",
    type: "string",
    required: true,
    defaultValue: "-",
    range: "非空文本",
    description: "提示词",
  });
  assert.deepEqual(generation.requestVariants, [
    {
      method: "POST",
      path: "/v1/images/async/generations",
      kind: "json",
      template: {
        model: "gpt-image-2",
        prompt: "A product photo",
        n: 1,
      },
    },
  ]);

  const edit = snapshot.imageCapabilities[1].adapters[0];
  assert.equal(edit.requestVariants.length, 2);
  assert.deepEqual(edit.requestVariants[1], {
    method: "POST",
    path: "/v1/images/async/edits",
    kind: "multipart",
    fields: [
      { name: "model", value: "gpt-image-2" },
      { name: "prompt", value: "Edit this image" },
      { name: "image", value: "@input.png" },
    ],
  });

  const video = snapshot.videoCapabilities[0].adapters[0];
  assert.equal(video.pollPath, "/v1/videos/{task_id}");
  assert.equal(video.priceLabel, undefined);
  assert.deepEqual(video.requestVariants[0].template.metadata, { duration: 5 });
});

test("normalizer never copies prices into the request adapter snapshot", async () => {
  const publicOptions = await fixture("public-model-options");
  publicOptions.models[0].platformPriceLabel = "$9.9999/次";
  const snapshot = normalizeProductionTutorial(
    await fixture("tutorial-page"),
    publicOptions,
  );
  assert.equal(snapshot.imageCapabilities[0].adapters[0].priceLabel, undefined);
  assert.equal(snapshot.pricingSource, undefined);
});

test("normalizer rejects an unknown documented request structure", () => {
  assert.throws(
    () => normalizeProductionTutorial(unknownCurlFixture, publicFixture),
    /Unsupported production tutorial request structure/,
  );
});

test("normalizer rejects an explicit non-POST cURL method", () => {
  const tutorial = tutorialWithStep({
    parameters: modelParameters,
    codeBlocks: [
      {
        label: "cURL",
        code: `curl {{baseUrl}}/v1/videos -X DELETE -d '{"model":"unknown-model"}'`,
      },
    ],
  });
  assert.throws(
    () => normalizeProductionTutorial(tutorial, publicFixture),
    /Unsupported production tutorial request structure/,
  );
});

test("normalizer rejects a cURL path outside the asynchronous capability endpoints", () => {
  const tutorial = tutorialWithStep({
    parameters: modelParameters,
    codeBlocks: [
      {
        label: "cURL",
        code: `curl {{baseUrl}}/v1/not-videos -d '{"model":"unknown-model"}'`,
      },
    ],
  });
  assert.throws(
    () => normalizeProductionTutorial(tutorial, publicFixture),
    /Unsupported production tutorial request structure/,
  );
});

test("normalizer preserves a documented alternate asynchronous image path", () => {
  const tutorial = tutorialWithStep(
    {
      parameters: modelParameters,
      codeBlocks: [
        {
          label: "cURL",
          code: `curl {{baseUrl}}/v1/images/async/generations -d '{"model":"unknown-model"}'`,
        },
      ],
    },
    {
      category: "image",
      endpointPath: "/v1/images/async/edits",
    },
  );
  const snapshot = normalizeProductionTutorial(tutorial, publicFixture);
  assert.equal(
    snapshot.imageCapabilities[0].adapters[0].requestVariants[0].path,
    "/v1/images/async/generations",
  );
});

test("normalizer applies shell quoting rules to multipart fields", () => {
  const tutorial = tutorialWithStep({
    parameters: modelParameters,
    codeBlocks: [
      {
        label: "cURL",
        code: String.raw`curl {{baseUrl}}/v1/videos -F "model=unknown-model" -F "prompt=a \"quoted\" value"`,
      },
    ],
  });
  const snapshot = normalizeProductionTutorial(tutorial, publicFixture);
  assert.deepEqual(
    snapshot.videoCapabilities[0].adapters[0].requestVariants[0].fields,
    [
      { name: "model", value: "unknown-model" },
      { name: "prompt", value: 'a "quoted" value' },
    ],
  );
});

test("normalizer rejects a request body model inconsistent with adapter metadata", () => {
  const tutorial = tutorialWithStep({
    parameters: modelParameters,
    codeBlocks: [
      {
        label: "cURL",
        code: `curl {{baseUrl}}/v1/videos -d '{"model":"different-model"}'`,
      },
    ],
  });
  assert.throws(
    () => normalizeProductionTutorial(tutorial, publicFixture),
    /Unsupported production tutorial request structure/,
  );
});

test("normalizer rejects an adapter when any documented cURL variant is malformed", () => {
  const tutorial = tutorialWithStep({
    parameters: modelParameters,
    codeBlocks: [
      {
        label: "cURL JSON",
        code: `curl {{baseUrl}}/v1/videos -d '{"model":"unknown-model"}'`,
      },
      { label: "cURL multipart", code: "opaque" },
    ],
  });
  assert.throws(
    () => normalizeProductionTutorial(tutorial, publicFixture),
    /Unsupported production tutorial request structure/,
  );
});

test("normalizer fails closed for malformed adapter metadata", () => {
  const validCurl = {
    label: "cURL",
    code: `curl {{baseUrl}}/v1/videos -d '{"model":"unknown-model"}'`,
  };
  const malformedSteps = [
    { codeBlocks: [validCurl] },
    { parameters: {}, codeBlocks: [validCurl] },
    { parameters: [{ name: "prompt" }], codeBlocks: [validCurl] },
    {
      parameters: [{ name: "model", defaultValue: 123 }],
      codeBlocks: [validCurl],
    },
  ];
  for (const step of malformedSteps) {
    assert.throws(
      () => normalizeProductionTutorial(tutorialWithStep(step), publicFixture),
      /Invalid production tutorial adapter/,
    );
  }
});

test("normalizer filters valid non-public and retired adapters before parsing requests", () => {
  const steps = [
    {
      parameters: [{ name: "model", defaultValue: "private-model" }],
      codeBlocks: [{ label: "cURL", code: "opaque" }],
    },
    {
      parameters: [{ name: "model", defaultValue: "gpt-image-2-max" }],
      codeBlocks: [{ label: "cURL", code: "opaque" }],
    },
  ];
  const publicOptions = {
    models: [
      { key: "unknown-model" },
      { key: "gpt-image-2-max" },
    ],
  };
  const tutorial = tutorialWithStep(steps[0]);
  tutorial.config.items[0].steps = steps;
  assert.deepEqual(
    normalizeProductionTutorial(tutorial, publicOptions).videoCapabilities[0]
      .adapters,
    [],
  );
});

test("normalizer ignores response-only polling metadata steps", () => {
  const tutorial = tutorialWithStep({
    parameters: [
      {
        name: "status",
        location: "response",
        type: "string",
        required: true,
      },
    ],
    codeBlocks: [
      {
        label: "查询",
        code: "curl {{baseUrl}}/v1/videos/TASK_ID",
      },
    ],
  });
  assert.deepEqual(
    normalizeProductionTutorial(tutorial, publicFixture).videoCapabilities[0]
      .adapters,
    [],
  );
});

test("normalizer ignores informational steps with non-response parameters", () => {
  const tutorial = tutorialWithStep({
    parameters: [
      {
        name: "TASK_ID",
        location: "path",
        type: "string",
        required: true,
      },
    ],
    codeBlocks: [],
  });
  assert.deepEqual(
    normalizeProductionTutorial(tutorial, publicFixture).videoCapabilities[0]
      .adapters,
    [],
  );
});

test("loader refreshes both adapter sources and atomically caches the snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kaiyun-capabilities-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cachePath = join(root, "cache", "production-capabilities.json");
  const tutorial = await fixture("tutorial-page");
  const options = await fixture("public-model-options");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const payload =
      url === "https://kaiyuncode.com/api/api-tutorial-page"
        ? tutorial
        : options;
    return new Response(JSON.stringify(payload));
  };

  const snapshot = await loadProductionCapabilities({
    fetchImpl,
    bundledPath: join(root, "unused.json"),
    cachePath,
    allowStale: false,
  });

  assert.deepEqual(calls, [
    "https://kaiyuncode.com/api/api-tutorial-page",
    "https://kaiyuncode.com/api/chat/public-model-options",
  ]);
  assert.deepEqual(JSON.parse(await readFile(cachePath, "utf8")), snapshot);
  assert.deepEqual(await import("node:fs/promises").then(({ readdir }) => readdir(join(root, "cache"))), [
    "production-capabilities.json",
  ]);
});

test("loader returns a marked bundled snapshot only when stale data is allowed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kaiyun-stale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundledPath = join(root, "production-capabilities.json");
  const bundled = { schemaVersion: 1, sourceUpdatedAt: 123, imageCapabilities: [], videoCapabilities: [] };
  await writeFile(bundledPath, JSON.stringify(bundled));
  const fetchImpl = async () => {
    throw new Error("offline");
  };

  assert.deepEqual(
    await loadProductionCapabilities({
      fetchImpl,
      bundledPath,
      allowStale: true,
    }),
    { ...bundled, stale: true },
  );
  await assert.rejects(
    loadProductionCapabilities({
      fetchImpl,
      bundledPath,
      allowStale: false,
    }),
    /offline/,
  );
});

test("loader returns fresh data when only atomic cache persistence fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kaiyun-cache-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundledPath = join(root, "production-capabilities.json");
  const blockedParent = join(root, "blocked-parent");
  await writeFile(blockedParent, "not a directory");
  await writeFile(
    bundledPath,
    JSON.stringify({
      schemaVersion: 1,
      sourceUpdatedAt: 0,
      imageCapabilities: [],
      videoCapabilities: [],
    }),
  );
  const tutorial = await fixture("tutorial-page");
  const options = await fixture("public-model-options");
  let calls = 0;
  const responses = [tutorial, options];
  const fetchImpl = async () =>
    new Response(JSON.stringify(responses[calls++]));

  const snapshot = await loadProductionCapabilities({
    fetchImpl,
    bundledPath,
    cachePath: join(blockedParent, "cache.json"),
    allowStale: true,
  });

  assert.equal(snapshot.sourceUpdatedAt, tutorial.updatedAt);
  assert.equal(snapshot.stale, undefined);
});
