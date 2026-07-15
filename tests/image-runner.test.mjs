import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import { withConfirmCard } from "../shared/confirm-card.mjs";

import {
  executeCli,
  formatCliResult,
  listImageModels,
  parseCliArguments,
  persistImageResult,
  prepareCliInput,
  prepareJobSpec,
  runConcurrentImageTasks,
  runImageTask,
} from "../skills/kaiyuncode-image/scripts/kaiyuncode-image.mjs";

const productionCapabilities = JSON.parse(
  readFileSync(
    new URL("../references/production-capabilities.json", import.meta.url),
    "utf8",
  ),
);

function createImageDeps() {
  const calls = { credential: 0, catalog: 0, submit: 0, poll: 0, persist: 0 };
  return {
    calls,
    loadCapabilities: async () => ({
      imageCapabilities: [
        {
          key: "image_text_generation",
          adapters: [
            {
              model: "gpt-image-2",
              parameters: [
                { name: "model", type: "string", required: true, defaultValue: "gpt-image-2", range: "gpt-image-2" },
                { name: "prompt", type: "string", required: true, defaultValue: "-", range: "非空文本" },
              ],
              requestVariants: [
                {
                  method: "POST",
                  path: "/v1/images/async/generations",
                  kind: "json",
                  template: { model: "gpt-image-2" },
                },
              ],
            },
          ],
        },
      ],
    }),
    resolveCredential: async () => {
      calls.credential += 1;
      return { apiKey: "test-key", source: "test" };
    },
    loadRuntimeCatalog: async () => {
      calls.catalog += 1;
      const models = new Set(
        productionCapabilities.imageCapabilities.flatMap((capability) =>
          capability.adapters.map(({ model }) => model),
        ),
      );
      models.add("gpt-image-2");
      models.add("name-looks-like-edit");
      models.add("constraint-model");
      return {
        availableModels: models,
        priceLabels: new Map(
          [...models].map((model) => [
            model,
            model === "gpt-image-2" ? "$0.0150/次" : "$0.1000/次",
          ]),
        ),
      };
    },
    submitTask: async () => {
      calls.submit += 1;
      return "img_new";
    },
    pollTask: async ({ taskId }) => {
      calls.poll += 1;
      return { taskId, status: "completed", url: "https://example.test/result.png" };
    },
    persistImageResult: async ({ taskId }) => {
      calls.persist += 1;
      return { taskId, status: "completed", path: "/absolute/result.png" };
    },
  };
}

const baseInput = {
  capabilityKey: "image_text_generation",
  model: "gpt-image-2",
  values: { prompt: "test" },
  files: [],
};

test("retired Max model is rejected before submission", async () => {
  const deps = createImageDeps();
  await assert.rejects(
    runImageTask({ ...baseInput, model: "gpt-image-2-max", dependencies: deps }),
    /not available in the production model catalog/,
  );
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.catalog, 0);
  assert.equal(deps.calls.submit, 0);
});

test("dry-run builds the request after read-only runtime catalog checks", async () => {
  const deps = createImageDeps();
  const result = await runImageTask({ ...baseInput, dryRun: true, dependencies: deps });
  assert.deepEqual(result, {
    dryRun: true,
    capabilityKey: "image_text_generation",
    model: "gpt-image-2",
    priceLabel: "$0.0150/次",
    request: {
      method: "POST",
      path: "/v1/images/async/generations",
      headers: { "Content-Type": "application/json" },
      body: { model: "gpt-image-2", prompt: "test" },
    },
  });
  assert.deepEqual(deps.calls, {
    credential: 1,
    catalog: 1,
    submit: 0,
    poll: 0,
    persist: 0,
  });
});

test("task-id resumes without a second submission", async () => {
  const deps = createImageDeps();
  const result = await runImageTask({
    ...baseInput,
    taskId: "img_123",
    dependencies: deps,
  });
  assert.equal(deps.calls.submit, 0);
  assert.equal(deps.calls.poll, 1);
  assert.equal(deps.calls.persist, 1);
  assert.equal(result.taskId, "img_123");
});

test("task-id-only resume skips capability loading and every POST concern", async () => {
  const deps = createImageDeps();
  deps.loadCapabilities = async () => assert.fail("resume must not load capabilities");
  deps.submitTask = async () => assert.fail("resume must not submit");
  const result = await runImageTask({
    taskId: "img_paid_123",
    output: "/absolute/resumed.png",
    dependencies: deps,
  });
  assert.equal(deps.calls.credential, 1);
  assert.equal(deps.calls.poll, 1);
  assert.equal(deps.calls.persist, 1);
  assert.equal(result.taskId, "img_paid_123");
});

function requiredValue(parameter) {
  if (parameter.defaultValue !== "-") return parameter.defaultValue;
  if (parameter.name === "prompt") return "test image prompt";
  if (parameter.name === "image") return "https://assets.example.test/input.png";
  if (parameter.name === "image_urls[]" || parameter.name === "image[]") {
    return [
      "https://assets.example.test/reference-1.png",
      "https://assets.example.test/reference-2.png",
    ];
  }
  if (parameter.type === "string") return "test";
  if (parameter.type === "string[]") return ["https://assets.example.test/input.png"];
  if (parameter.type === "boolean") return true;
  if (parameter.type === "number" || parameter.type === "integer") return 1;
  throw new Error(`No fixture value for ${parameter.name}`);
}

function adapterValues(adapter) {
  return Object.fromEntries(
    adapter.parameters
      .filter(({ required, name }) => required && name !== "model")
      .map((parameter) => [parameter.name, requiredValue(parameter)]),
  );
}

function createProductionDeps() {
  const deps = createImageDeps();
  deps.loadCapabilities = async () => productionCapabilities;
  return deps;
}

test("every bundled public image adapter in all four capabilities has an async dry-run", async () => {
  assert.equal(productionCapabilities.imageCapabilities.length, 4);
  let dryRuns = 0;
  for (const capability of productionCapabilities.imageCapabilities) {
    for (const adapter of capability.adapters) {
      const deps = createProductionDeps();
      const result = await runImageTask({
        capabilityKey: capability.key,
        model: adapter.model,
        values: adapterValues(adapter),
        files: [],
        dryRun: true,
        dependencies: deps,
      });

      assert.equal(result.dryRun, true);
      assert.equal(result.capabilityKey, capability.key);
      assert.equal(result.model, adapter.model);
      assert.ok(
        new Set([
          "/v1/images/async/generations",
          "/v1/images/async/edits",
        ]).has(result.request.path),
      );
      assert.deepEqual(deps.calls, {
        credential: 1,
        catalog: 1,
        submit: 0,
        poll: 0,
        persist: 0,
      });
      dryRuns += 1;
    }
  }
  assert.equal(dryRuns, 18);
});

test("adapter selection requires an exact capability key and model pair", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runImageTask({
      ...baseInput,
      capabilityKey: "image_missing",
      dependencies: deps,
      dryRun: true,
    }),
    /image capability.*not available/i,
  );
  await assert.rejects(
    runImageTask({
      ...baseInput,
      model: "gpt-image-2-unknown",
      dependencies: deps,
      dryRun: true,
    }),
    /image model.*not available/i,
  );
});

test("request protocol comes from the normalized adapter and not model naming", async () => {
  const deps = createImageDeps();
  deps.loadCapabilities = async () => ({
    imageCapabilities: [
      {
        key: "image_text_generation",
        adapters: [
          {
            model: "name-looks-like-edit",
            parameters: [
              { name: "model", type: "string", required: true, defaultValue: "name-looks-like-edit" },
              { name: "prompt", type: "string", required: true, defaultValue: "-", range: "非空文本" },
            ],
            requestVariants: [
              {
                method: "POST",
                path: "/v1/images/async/generations",
                kind: "json",
                template: { model: "name-looks-like-edit" },
              },
            ],
          },
        ],
      },
    ],
  });
  const result = await runImageTask({
    capabilityKey: "image_text_generation",
    model: "name-looks-like-edit",
    values: { prompt: "test" },
    dryRun: true,
    dependencies: deps,
  });
  assert.equal(result.request.path, "/v1/images/async/generations");
});

for (const [name, values, pattern] of [
  ["missing required prompt", {}, /required.*prompt|prompt.*required/i],
  ["empty prompt", { prompt: "  " }, /required.*prompt|prompt.*non-empty/i],
  ["unknown parameter", { prompt: "test", surprise: true }, /Unknown adapter parameter/],
  ["wrong type", { prompt: "test", n: "many" }, /must be a number/i],
  ["invalid option", { prompt: "test", output_format: "bmp" }, /outside.*range|not allowed/i],
  ["numeric overflow", { prompt: "test", output_compression: 101 }, /outside.*range|0.*100/i],
]) {
  test(`validation rejects ${name} before credentials or submission`, async () => {
    const deps = createProductionDeps();
    await assert.rejects(
      runImageTask({ ...baseInput, values, dependencies: deps }),
      pattern,
    );
    assert.equal(deps.calls.credential, 0);
    assert.equal(deps.calls.submit, 0);
  });
}

test("Wan sequential output count and reference image count fail closed", async () => {
  for (const values of [
    { prompt: "test", n: 13 },
    {
      prompt: "test",
      "image_urls[]": Array.from(
        { length: 10 },
        (_, index) => `https://assets.example.test/${index}.png`,
      ),
    },
  ]) {
    const deps = createProductionDeps();
    await assert.rejects(
      runImageTask({
        capabilityKey: "image_sequential_generation",
        model: "wan2.7-image-pro",
        values,
        dependencies: deps,
      }),
      /maximum|at most|outside.*range/i,
    );
    assert.equal(deps.calls.credential, 0);
    assert.equal(deps.calls.submit, 0);
  }
});

for (const [name, capabilityKey, model, values] of [
  ["complex GPT size", "image_text_generation", "gpt-image-2", { prompt: "test", size: "banana" }],
  ["aspect ratio list with prose suffix", "image_text_generation", "gemini-3.1-flash-image", { prompt: "test", aspect_ratio: "banana" }],
  ["fixed sequential boolean", "image_sequential_generation", "wan2.7-image-pro", { prompt: "test", enable_sequential: false }],
]) {
  test(`production constraints reject invalid ${name}`, async () => {
    const deps = createProductionDeps();
    await assert.rejects(
      runImageTask({ capabilityKey, model, values, dependencies: deps }),
      /outside the documented range|fixed production value|not allowed/i,
    );
    assert.equal(deps.calls.credential, 0);
    assert.equal(deps.calls.submit, 0);
  });
}

function allLegalAdapterValues(adapter) {
  const references = [
    "https://assets.example.test/one.png",
    "https://assets.example.test/two.png",
  ];
  const explicit = {
    prompt: "legal production prompt",
    image: "https://assets.example.test/input.png",
    "image_urls[]": references,
    "image[]": references,
    mask: "https://assets.example.test/mask.png",
    output_format: "png",
    output_compression: 50,
    background: "opaque",
    moderation: "auto",
    response_format: "url",
    seed: 7,
  };
  return Object.fromEntries(
    adapter.parameters
      .filter(({ name }) => name !== "model")
      .map((parameter) => [
        parameter.name,
        Object.hasOwn(explicit, parameter.name)
          ? explicit[parameter.name]
          : parameter.defaultValue,
      ])
      .filter(([, value]) => value !== "-"),
  );
}

test("deterministic constraints accept legal values for all 18 production image adapters", async () => {
  let count = 0;
  for (const capability of productionCapabilities.imageCapabilities) {
    for (const adapter of capability.adapters) {
      const deps = createProductionDeps();
      const result = await runImageTask({
        capabilityKey: capability.key,
        model: adapter.model,
        values: allLegalAdapterValues(adapter),
        dryRun: true,
        dependencies: deps,
      });
      assert.equal(result.dryRun, true);
      assert.equal(deps.calls.credential, 1);
      assert.equal(deps.calls.catalog, 1);
      count += 1;
    }
  }
  assert.equal(count, 18);
});

function customConstraintDeps(range, defaultValue = "-") {
  const deps = createImageDeps();
  deps.loadCapabilities = async () => ({
    imageCapabilities: [{
      key: "image_text_generation",
      adapters: [{
        model: "constraint-model",
        parameters: [
          { name: "model", type: "string", required: true, defaultValue: "constraint-model", range: "constraint-model" },
          { name: "prompt", type: "string", required: true, defaultValue: "-", range: "non-empty text" },
          { name: "style", type: "string", defaultValue, range },
        ],
        requestVariants: [{
          method: "POST",
          path: "/v1/images/async/generations",
          kind: "json",
          template: { model: "constraint-model" },
        }],
      }],
    }],
  });
  return deps;
}

test("user-provided values fail closed when a production range is not interpretable", async () => {
  await assert.rejects(
    runImageTask({
      capabilityKey: "image_text_generation",
      model: "constraint-model",
      values: { prompt: "test", style: "cinematic" },
      dryRun: true,
      dependencies: customConstraintDeps("unstructured production prose"),
    }),
    /cannot interpret.*range|unsupported production range/i,
  );
});

test("English-separated enums are parsed deterministically", async () => {
  const legal = await runImageTask({
    capabilityKey: "image_text_generation",
    model: "constraint-model",
    values: { prompt: "test", style: "cool" },
    dryRun: true,
    dependencies: customConstraintDeps("warm, cool", "warm"),
  });
  assert.equal(legal.request.body.style, "cool");
  await assert.rejects(
    runImageTask({
      capabilityKey: "image_text_generation",
      model: "constraint-model",
      values: { prompt: "test", style: "banana" },
      dryRun: true,
      dependencies: customConstraintDeps("warm, cool", "warm"),
    }),
    /outside the documented range/i,
  );
});

test("JSON image URL fields reject local paths instead of server-inaccessible paths", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runImageTask({
      capabilityKey: "image_multi_reference",
      model: "gpt-image-2",
      values: { prompt: "test", "image_urls[]": ["/tmp/private.png"] },
      dependencies: deps,
    }),
    /local media paths|public HTTPS|data URL/i,
  );
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.submit, 0);
});

test("required reference arrays reject empty input before credentials", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runImageTask({
      capabilityKey: "image_multi_reference",
      model: "gpt-image-2",
      values: { prompt: "test", "image_urls[]": [] },
      dependencies: deps,
    }),
    /required.*image_urls|image_urls.*required/i,
  );
  assert.equal(deps.calls.credential, 0);
});

test("image URL fields reject non-HTTPS remote URLs", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runImageTask({
      capabilityKey: "image_multi_reference",
      model: "gpt-image-2",
      values: { prompt: "test", "image_urls[]": ["http://assets.example.test/input.png"] },
      dependencies: deps,
    }),
    /public HTTPS URL|requires.*HTTPS/i,
  );
  assert.equal(deps.calls.credential, 0);
});

test("multipart local image paths require matching Blob file fields", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runImageTask({
      capabilityKey: "image_edit",
      model: "gpt-image-2",
      values: { prompt: "test", image: "/tmp/private.png" },
      files: [],
      dependencies: deps,
    }),
    /multipart request|requires.*file/i,
  );
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.submit, 0);
});

test("multipart fields and file counts must match the selected production variant", async () => {
  for (const [image, files] of [
    [
      "https://assets.example.test/input.png",
      [{ field: "mask", data: new Blob(["mask"]), filename: "mask.png" }],
    ],
    [
      "/tmp/private.png",
      [
        { field: "image", data: new Blob(["one"]), filename: "one.png" },
        { field: "image", data: new Blob(["two"]), filename: "two.png" },
      ],
    ],
  ]) {
    const deps = createProductionDeps();
    await assert.rejects(
      runImageTask({
        capabilityKey: "image_edit",
        model: "gpt-image-2",
        values: { prompt: "test", image },
        files,
        dependencies: deps,
      }),
      /not a documented upload field|at most 1 files/i,
    );
    assert.equal(deps.calls.credential, 0);
  }
});

test("new tasks submit once, then GET-poll and persist the returned task ID", async () => {
  const deps = createImageDeps();
  const result = await runImageTask({ ...baseInput, dependencies: deps });
  assert.equal(deps.calls.submit, 1);
  assert.equal(deps.calls.poll, 1);
  assert.equal(deps.calls.persist, 1);
  assert.equal(result.taskId, "img_new");
});

test("URL image results use atomic downloader and return redacted URL and absolute path", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "kaiyun-image-url-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = join(root, "url.png");
  const calls = [];
  const result = await persistImageResult({
    taskId: "url_task",
    completed: {
      status: "completed",
      url: "https://cdn.example.test/result.png?token=private",
    },
    output,
    downloadResult: async (input) => {
      calls.push(input);
      await fs.writeFile(input.output, "image");
      return {
        path: input.output,
        url: "https://cdn.example.test/result.png?token=%5BREDACTED%5D",
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.taskId, "url_task");
  assert.equal(result.status, "completed");
  assert.equal(isAbsolute(result.path), true);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("image result reporting redacts CDN signature families but preserves ordinary query", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "kaiyun-image-signed-url-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = join(root, "signed.png");
  const result = await persistImageResult({
    taskId: "signed_task",
    completed: {
      status: "completed",
      url: "https://cdn.example.test/result.png?sig=azure-secret&Policy=cloudfront-secret&X-Amz-Signature=aws-secret&X-Goog-Signature=goog-secret&width=100",
    },
    output,
    downloadResult: async ({ output: destination }) => ({ path: destination }),
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /azure-secret|cloudfront-secret|aws-secret|goog-secret/);
  assert.match(result.url, /width=100/);
});

test("strict base64 persistence replaces output atomically", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "kaiyun-image-b64-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = join(root, "b64.png");
  await fs.writeFile(output, "old");
  const result = await persistImageResult({
    taskId: "b64_task",
    completed: {
      status: "completed",
      b64Json: Buffer.from("new-image").toString("base64"),
    },
    output,
  });

  assert.equal(await fs.readFile(output, "utf8"), "new-image");
  assert.equal(result.taskId, "b64_task");
  assert.equal(result.status, "completed");
  assert.equal(isAbsolute(result.path), true);
  assert.equal(Object.hasOwn(result, "url"), false);
});

for (const invalid of ["%%%", "YWJj=", "YW Jj", "", "data:image/png;base64,%%%"] ) {
  test(`strict base64 persistence rejects ${JSON.stringify(invalid)} without replacing output`, async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), "kaiyun-image-invalid-b64-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const output = join(root, "result.png");
    await fs.writeFile(output, "old");

    await assert.rejects(
      persistImageResult({
        taskId: "bad_b64",
        completed: { status: "completed", b64Json: invalid },
        output,
      }),
      /invalid base64/i,
    );
    assert.equal(await fs.readFile(output, "utf8"), "old");
  });
}

test("CLI parses repeated params, images, mask, resume, output, and dry-run", () => {
  const parsed = parseCliArguments([
    "--capability", "image_multi_reference",
    "--model", "wan2.7-image-pro",
    "--prompt", "compose",
    "--param", "n=2",
    "--param", "watermark=false",
    "--image", "https://assets.example.test/a.png",
    "--image", "https://assets.example.test/b.png",
    "--mask", "/private/mask.png",
    "--task-id", "resume_1",
    "--output", "result.png",
    "--dry-run",
  ]);

  assert.deepEqual(parsed.params, [
    ["n", "2"],
    ["watermark", "false"],
  ]);
  assert.deepEqual(parsed.images, [
    "https://assets.example.test/a.png",
    "https://assets.example.test/b.png",
  ]);
  assert.equal(parsed.mask, "/private/mask.png");
  assert.equal(parsed.taskId, "resume_1");
  assert.equal(parsed.output, "result.png");
  assert.equal(parsed.dryRun, true);
});

test("CLI rejects api-key argv without echoing its value", () => {
  const secret = "must-not-appear";
  assert.throws(
    () => parseCliArguments(["--api-key", secret]),
    (error) => {
      assert.match(error.message, /API keys are not accepted|unknown option/i);
      assert.ok(!error.message.includes(secret));
      return true;
    },
  );
});

test("CLI lists current compatible image models and live prices without POST", async () => {
  const deps = createProductionDeps();
  const result = await executeCli(
    ["--list-models", "--capability", "image_text_generation"],
    deps,
  );
  const output = formatCliResult(result);

  assert.equal(result.catalog, true);
  assert.equal(result.kind, "image");
  assert.equal(result.capabilities.length, 1);
  assert.match(output, /KaiyunCode 实时图片模型/);
  assert.match(output, /gpt-image-2｜\$0\.0150\/次/);
  assert.equal(deps.calls.credential, 1);
  assert.equal(deps.calls.catalog, 1);
  assert.equal(deps.calls.submit, 0);
  assert.equal(deps.calls.poll, 0);
});

test("image model discovery rejects task arguments before credentials", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    executeCli(["--list-models", "--model", "gpt-image-2"], deps),
    /only accepts --capability.*--credential-source.*--json/,
  );
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.catalog, 0);
});

test("listImageModels rejects unknown capability before runtime lookup", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    listImageModels({ capabilityKey: "missing", dependencies: deps }),
    /Image capability missing is not available/,
  );
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.catalog, 0);
});

test("CLI prepares repeated local image and mask files with basename-only metadata", async () => {
  const reads = [];
  const input = await prepareCliInput(
    parseCliArguments([
      "--capability", "image_edit",
      "--model", "wan2.7-image-pro",
      "--prompt", "edit",
      "--image", "/private/first.png",
      "--image", "/private/second.png",
      "--mask", "/private/mask.png",
      "--dry-run",
    ]),
    {
      readFile: async (path) => {
        reads.push(path);
        return Buffer.from(path);
      },
    },
  );

  assert.deepEqual(reads, [
    "/private/first.png",
    "/private/second.png",
    "/private/mask.png",
  ]);
  assert.deepEqual(
    input.files.map(({ field, filename }) => ({ field, filename })),
    [
      { field: "image", filename: "first.png" },
      { field: "image", filename: "second.png" },
      { field: "mask", filename: "mask.png" },
    ],
  );
  assert.ok(!JSON.stringify(input.files.map(({ filename }) => filename)).includes("/private"));
});

test("CLI accepts local files for gpt-image-2 multi-reference and names them in the confirmation card", async () => {
  const input = await prepareCliInput(
    parseCliArguments([
      "--capability", "image_multi_reference",
      "--model", "gpt-image-2",
      "--prompt", "compose local references",
      "--image", "/private/DSC01013.JPG",
      "--image", "/private/DSC01014.JPG",
      "--dry-run",
    ]),
    {
      readFile: async (path) => Buffer.from(path),
      loadCapabilities: async () => productionCapabilities,
    },
  );

  assert.equal(input.values["image_urls[]"].length, 2);
  assert.ok(input.values["image_urls[]"].every((value) => value.startsWith("data:image/jpeg;base64,")));
  assert.ok(input.files.every(({ inline, kind }) => inline && kind === "image"));

  const result = await runImageTask({ ...input, dependencies: createProductionDeps() });
  assert.deepEqual(result.request.localResources.map(({ name }) => name), [
    "DSC01013.JPG",
    "DSC01014.JPG",
  ]);
  assert.ok(!JSON.stringify(result.request).includes("/private"));
  assert.ok(!JSON.stringify(result.request).includes("data:image"));
  const card = withConfirmCard(result, { kind: "image" }).confirmCard;
  assert.match(card, /参考图 2 张（DSC01013\.JPG.*DSC01014\.JPG/);
});

test("CLI maps Adobe multi-reference images onto documented image[] field", async () => {
  const input = await prepareCliInput(
    parseCliArguments([
      "--capability", "image_multi_reference",
      "--model", "gpt-image-2-mid-adobe",
      "--prompt", "compose adobe references",
      "--image", "https://assets.example.test/a.png",
      "--image", "https://assets.example.test/b.png",
      "--dry-run",
    ]),
    { loadCapabilities: async () => productionCapabilities },
  );

  assert.equal(input.values["image_urls[]"], undefined);
  assert.deepEqual(input.values["image[]"], [
    "https://assets.example.test/a.png",
    "https://assets.example.test/b.png",
  ]);

  const result = await runImageTask({ ...input, dependencies: createProductionDeps() });
  assert.equal(result.request.path, "/v1/images/async/generations");
  const body =
    typeof result.request.body === "string"
      ? JSON.parse(result.request.body)
      : result.request.body;
  assert.deepEqual(body.image, [
    "https://assets.example.test/a.png",
    "https://assets.example.test/b.png",
  ]);
});

test("CLI preserves repeated remote Wan edit images in order", async () => {
  const input = await prepareCliInput(parseCliArguments([
    "--capability", "image_edit",
    "--model", "wan2.7-image-pro",
    "--prompt", "edit",
    "--image", "https://assets.example.test/car.png",
    "--image", "https://assets.example.test/paint.png",
    "--dry-run",
  ]));
  assert.deepEqual(input.values.image, [
    "https://assets.example.test/car.png",
    "https://assets.example.test/paint.png",
  ]);
  assert.deepEqual(input.files, []);
});

test("CLI task-id-only resume needs no capability, model, prompt, or file reads", async () => {
  const input = await prepareCliInput(
    parseCliArguments([
      "--task-id", "img_paid_123",
      "--output", "resumed.png",
    ]),
    { readFile: async () => assert.fail("resume must not read files") },
  );
  assert.deepEqual(input, {
    taskId: "img_paid_123",
    output: "resumed.png",
  });
});

test("CLI dry-run uses injected read-only runtime catalog data", async () => {
  const result = await executeCli(
    [
      "--capability", "image_text_generation",
      "--model", "gpt-image-2",
      "--prompt", "CLI dry run",
      "--dry-run",
      "--json",
    ],
    createProductionDeps(),
  );
  const output = JSON.parse(formatCliResult(result));
  assert.equal(output.dryRun, true);
  assert.equal(output.request.path, "/v1/images/async/generations");
  assert.match(output.confirmCard, /KaiyunCode 图片任务确认/);
  assert.match(output.confirmCard, /gpt-image-2/);
  assert.match(output.confirmCard, /预计费用：\$0\.0150/);
});

test("CLI dry-run default stdout is a human confirmation card", async () => {
  const result = await executeCli(
    [
      "--capability", "image_text_generation",
      "--model", "gpt-image-2",
      "--prompt", "CLI dry run card",
      "--dry-run",
    ],
    createProductionDeps(),
  );
  const output = formatCliResult(result);
  assert.match(output, /【KaiyunCode 图片任务确认】/);
  assert.match(output, /预算上限：\$0\.0150/);
  assert.match(output, /确认提交/);
  assert.throws(() => JSON.parse(output));
});


test("concurrent image jobs submit all before polls complete", async () => {
  const order = [];
  let submitCount = 0;
  const pollGates = [];
  const deps = createImageDeps();
  deps.submitTask = async () => {
    submitCount += 1;
    const id = `img_${submitCount}`;
    order.push(`submit:${id}`);
    return id;
  };
  deps.pollTask = async ({ taskId }) => {
    order.push(`poll-start:${taskId}`);
    await new Promise((resolve) => {
      pollGates.push(resolve);
    });
    order.push(`poll-end:${taskId}`);
    return { taskId, status: "completed", url: "https://example.test/result.png" };
  };
  deps.persistImageResult = async ({ taskId }) => {
    order.push(`persist:${taskId}`);
    return { taskId, status: "completed", path: `/absolute/${taskId}.png` };
  };

  const pending = runConcurrentImageTasks(
    [
      { ...baseInput, output: "/tmp/a.png" },
      { ...baseInput, output: "/tmp/b.png" },
      { ...baseInput, output: "/tmp/c.png" },
    ],
    deps,
  );

  // Allow concurrent submits/polls to schedule
  for (let i = 0; i < 20 && pollGates.length < 3; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(submitCount, 3);
  assert.equal(deps.calls.catalog, 1);
  assert.equal(pollGates.length, 3);
  assert.ok(order.filter((item) => item.startsWith("submit:")).length === 3);
  // All three submits happened before any poll finished
  const firstPollEnd = order.findIndex((item) => item.startsWith("poll-end:"));
  assert.equal(firstPollEnd, -1);

  for (const release of pollGates) release();
  const results = await pending;
  assert.equal(results.length, 3);
  assert.ok(results.every((item) => item.ok));
  assert.equal(results.filter((item) => item.ok).length, 3);
});

test("concurrent image jobs isolate failures", async () => {
  const deps = createImageDeps();
  let submitCount = 0;
  deps.submitTask = async () => {
    submitCount += 1;
    if (submitCount === 2) throw new Error("submission status is unknown");
    return `img_${submitCount}`;
  };
  const results = await runConcurrentImageTasks(
    [baseInput, baseInput, baseInput],
    deps,
  );
  assert.equal(results.length, 3);
  assert.equal(results.filter((item) => item.ok).length, 2);
  assert.equal(results.filter((item) => !item.ok).length, 1);
  assert.match(results.find((item) => !item.ok).error, /submission status is unknown/);
});

test("prepareJobSpec accepts capability alias and values object", async () => {
  const job = await prepareJobSpec({
    capability: "image_text_generation",
    model: "gpt-image-2",
    values: { prompt: "batch job" },
    output: "./out.png",
    dryRun: true,
  });
  assert.equal(job.capabilityKey, "image_text_generation");
  assert.equal(job.values.prompt, "batch job");
  assert.equal(job.dryRun, true);
});
