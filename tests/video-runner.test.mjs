import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import {
  executeCli,
  formatCliResult,
  parseCliArguments,
  persistVideoResult,
  prepareCliInput,
  prepareJobSpec,
  runConcurrentVideoTasks,
  runVideoTask,
} from "../skills/kaiyuncode-video/scripts/kaiyuncode-video.mjs";

const productionCapabilities = JSON.parse(
  readFileSync(
    new URL("../references/production-capabilities.json", import.meta.url),
    "utf8",
  ),
);

function createVideoDeps() {
  const calls = { credential: 0, catalog: 0, submit: 0, poll: 0, persist: 0 };
  return {
    calls,
    loadCapabilities: async () => ({
      videoCapabilities: [
        {
          key: "video_capability_video_text_generation",
          adapters: [
            {
              model: "grok-imagine-video",
              parameters: [
                {
                  name: "model",
                  type: "string",
                  required: true,
                  defaultValue: "grok-imagine-video",
                  range: "grok-imagine-video",
                },
                {
                  name: "prompt",
                  type: "string",
                  required: true,
                  defaultValue: "-",
                  range: "非空文本",
                },
              ],
              requestVariants: [
                {
                  method: "POST",
                  path: "/v1/videos",
                  kind: "json",
                  template: { model: "grok-imagine-video" },
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
        productionCapabilities.videoCapabilities.flatMap((capability) =>
          capability.adapters.map(({ model }) => model),
        ),
      );
      models.add("grok-imagine-video");
      models.add("name-looks-like-edit");
      return {
        availableModels: models,
        priceLabels: new Map(
          [...models].map((model) => [
            model,
            model === "omni_flash"
              ? "$0.2200/次(720P)，$0.3000/次(1080P)，$0.5000/次(4K)"
              : model === "grok-imagine-video"
                ? "$0.0500/6秒，$0.0700/10秒"
                : "$0.1000/次",
          ]),
        ),
      };
    },
    submitTask: async () => {
      calls.submit += 1;
      return "vid_new";
    },
    pollTask: async ({ taskId, kind }) => {
      calls.poll += 1;
      assert.equal(kind, "video");
      return {
        taskId,
        status: "completed",
        url: "https://example.test/result.mp4",
      };
    },
    persistVideoResult: async ({ taskId }) => {
      calls.persist += 1;
      return { taskId, status: "completed", path: "/absolute/result.mp4" };
    },
  };
}

const baseInput = {
  capabilityKey: "video_capability_video_text_generation",
  model: "grok-imagine-video",
  values: { prompt: "test" },
  files: [],
};

test("dry-run builds the video request after read-only runtime catalog checks", async () => {
  const deps = createVideoDeps();
  const result = await runVideoTask({
    ...baseInput,
    dryRun: true,
    dependencies: deps,
  });
  assert.deepEqual(result, {
    dryRun: true,
    capabilityKey: "video_capability_video_text_generation",
    model: "grok-imagine-video",
    priceLabel: "$0.0500/6秒，$0.0700/10秒",
    request: {
      method: "POST",
      path: "/v1/videos",
      headers: { "Content-Type": "application/json" },
      body: { model: "grok-imagine-video", prompt: "test" },
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

test("video submission timeout is not retried", async () => {
  const deps = createVideoDeps();
  deps.submitTask = async () => {
    deps.calls.submit += 1;
    throw new Error("submission status is unknown");
  };
  await assert.rejects(
    runVideoTask({ ...baseInput, dependencies: deps }),
    /submission status is unknown/,
  );
  assert.equal(deps.calls.submit, 1);
  assert.equal(deps.calls.poll, 0);
});

test("task-id resumes without a second submission", async () => {
  const deps = createVideoDeps();
  const result = await runVideoTask({
    ...baseInput,
    taskId: "vid_123",
    dependencies: deps,
  });
  assert.equal(deps.calls.submit, 0);
  assert.equal(deps.calls.poll, 1);
  assert.equal(deps.calls.persist, 1);
  assert.equal(result.taskId, "vid_123");
});

test("task-id-only resume skips capability loading and every POST concern", async () => {
  const deps = createVideoDeps();
  deps.loadCapabilities = async () => assert.fail("resume must not load capabilities");
  deps.submitTask = async () => assert.fail("resume must not submit");
  const result = await runVideoTask({
    taskId: "vid_paid_123",
    output: "/absolute/resumed.mp4",
    dependencies: deps,
  });
  assert.equal(deps.calls.credential, 1);
  assert.equal(deps.calls.poll, 1);
  assert.equal(deps.calls.persist, 1);
  assert.equal(result.taskId, "vid_paid_123");
});

function mediaFromTemplate(adapter) {
  const template = adapter.requestVariants?.find((variant) => variant.kind === "json")
    ?.template;
  return template?.input?.media ?? null;
}

function requiredValue(parameter, adapter) {
  if (parameter.defaultValue !== undefined && parameter.defaultValue !== null && parameter.defaultValue !== "-") {
    if (parameter.type === "number" || parameter.type === "integer") {
      return Number(parameter.defaultValue);
    }
    if (parameter.type === "boolean") {
      return parameter.defaultValue === true || parameter.defaultValue === "true";
    }
    return parameter.defaultValue;
  }
  if (parameter.name === "prompt" || parameter.name === "input.prompt") {
    return "test video prompt";
  }
  if (
    parameter.name === "image" ||
    parameter.name === "image_url" ||
    parameter.name === "input_video" ||
    parameter.name === "video_url" ||
    parameter.name === "metadata.video"
  ) {
    return parameter.name.includes("video")
      ? "https://assets.example.test/source.mp4"
      : "https://assets.example.test/input.png";
  }
  if (
    parameter.name === "images[]" ||
    parameter.name === "reference_image_urls[]" ||
    parameter.name === "extra_images[]" ||
    parameter.name === "image_urls[]"
  ) {
    return [
      "https://assets.example.test/ref-1.png",
      "https://assets.example.test/ref-2.png",
    ];
  }
  if (parameter.name === "extra_audios[]" || parameter.name === "audio_urls[]") {
    return ["https://assets.example.test/a.mp3"];
  }
  if (parameter.name === "extra_videos[]") {
    return ["https://assets.example.test/clip.mp4"];
  }
  if (parameter.name === "input.media[]") {
    const media = mediaFromTemplate(adapter);
    if (Array.isArray(media) && media.length > 0) {
      return media.map((item) => ({
        ...item,
        url: typeof item.url === "string"
          ? item.url.replace("example.com", "assets.example.test")
          : "https://assets.example.test/media.bin",
        ...(typeof item.reference_voice === "string"
          ? {
              reference_voice: item.reference_voice.replace(
                "example.com",
                "assets.example.test",
              ),
            }
          : {}),
      }));
    }
    return [
      {
        type: "first_frame",
        url: "https://assets.example.test/frame.png",
      },
    ];
  }
  if (parameter.name === "messages[]") {
    return [{ role: "user", content: "Recreate this clip with warmer lighting." }];
  }
  if (parameter.type === "string") return "test";
  if (parameter.type === "string[]") {
    return ["https://assets.example.test/item.png"];
  }
  if (parameter.type === "boolean") return true;
  if (parameter.type === "number" || parameter.type === "integer") return 1;
  if (parameter.type === "object[]" || /^Array<\{/u.test(parameter.type)) {
    return [{ type: "reference_image", url: "https://assets.example.test/ref.png" }];
  }
  throw new Error(`No fixture value for ${parameter.name}`);
}

function adapterValues(adapter) {
  return Object.fromEntries(
    adapter.parameters
      .filter(({ required, name }) => required && name !== "model")
      .map((parameter) => [parameter.name, requiredValue(parameter, adapter)]),
  );
}

function createProductionDeps() {
  const deps = createVideoDeps();
  deps.loadCapabilities = async () => productionCapabilities;
  return deps;
}

test("every bundled public video adapter in all eight capabilities has an async dry-run", async () => {
  assert.equal(productionCapabilities.videoCapabilities.length, 8);
  let dryRuns = 0;
  for (const capability of productionCapabilities.videoCapabilities) {
    for (const adapter of capability.adapters) {
      const deps = createProductionDeps();
      const result = await runVideoTask({
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
      assert.equal(result.request.path, "/v1/videos");
      assert.equal(result.request.method, "POST");
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
  assert.equal(dryRuns, 34);
});

test("adapter selection requires an exact capability key and model pair", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runVideoTask({
      ...baseInput,
      capabilityKey: "video_missing",
      dependencies: deps,
      dryRun: true,
    }),
    /video capability.*not available/i,
  );
  await assert.rejects(
    runVideoTask({
      ...baseInput,
      model: "unknown-video-model",
      dependencies: deps,
      dryRun: true,
    }),
    /video model.*not available/i,
  );
});

test("runtime /v1/models rejects both retired fast models before submission", async () => {
  const retired = [
    {
      capabilityKey: "video_capability_video_text_generation",
      model: "omni_flash-fast",
      values: { prompt: "test" },
    },
    {
      capabilityKey: "video_capability_video_recreate",
      model: "omni_flash_edit-fast",
      values: {
        input_video: "https://assets.example.test/source.mp4",
        "messages[]": [{ role: "user", content: "recreate" }],
      },
    },
  ];

  for (const input of retired) {
    const deps = createProductionDeps();
    deps.loadRuntimeCatalog = async () => {
      deps.calls.catalog += 1;
      return {
        availableModels: new Set(["grok-imagine-video"]),
        priceLabels: new Map(),
      };
    };
    await assert.rejects(
      runVideoTask({ ...input, dryRun: true, dependencies: deps }),
      /not currently available from GET \/v1\/models/,
    );
    assert.equal(deps.calls.credential, 1);
    assert.equal(deps.calls.catalog, 1);
    assert.equal(deps.calls.submit, 0);
  }
});

test("missing runtime pricing is visible in dry-run and blocks a paid POST", async () => {
  const missingPriceCatalog = async () => ({
    availableModels: new Set(["grok-imagine-video"]),
    priceLabels: new Map(),
  });
  const dryDeps = createVideoDeps();
  dryDeps.loadRuntimeCatalog = missingPriceCatalog;
  const dryRun = await runVideoTask({
    ...baseInput,
    dryRun: true,
    dependencies: dryDeps,
  });
  assert.equal(dryRun.priceLabel, undefined);
  assert.equal(dryDeps.calls.submit, 0);

  const submitDeps = createVideoDeps();
  submitDeps.loadRuntimeCatalog = missingPriceCatalog;
  await assert.rejects(
    runVideoTask({ ...baseInput, dependencies: submitDeps }),
    /\/api\/pricing has no parseable price.*refusing paid POST/i,
  );
  assert.equal(submitDeps.calls.submit, 0);
  assert.equal(submitDeps.calls.poll, 0);
});

test("request protocol comes from the normalized adapter and not model naming", async () => {
  const deps = createVideoDeps();
  deps.loadCapabilities = async () => ({
    videoCapabilities: [
      {
        key: "video_capability_video_text_generation",
        adapters: [
          {
            model: "name-looks-like-edit",
            parameters: [
              {
                name: "model",
                type: "string",
                required: true,
                defaultValue: "name-looks-like-edit",
              },
              {
                name: "prompt",
                type: "string",
                required: true,
                defaultValue: "-",
                range: "非空文本",
              },
            ],
            requestVariants: [
              {
                method: "POST",
                path: "/v1/videos",
                kind: "json",
                template: { model: "name-looks-like-edit" },
              },
            ],
          },
        ],
      },
    ],
  });
  const result = await runVideoTask({
    capabilityKey: "video_capability_video_text_generation",
    model: "name-looks-like-edit",
    values: { prompt: "test" },
    dryRun: true,
    dependencies: deps,
  });
  assert.equal(result.request.path, "/v1/videos");
});

test("nested metadata and input.media validation fail closed before credentials", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runVideoTask({
      capabilityKey: "video_capability_video_text_generation",
      model: "happyhorse-1.0-t2v",
      values: {
        prompt: "test",
        "metadata.resolution": "4K",
      },
      dependencies: deps,
    }),
    /outside the documented range/i,
  );
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.submit, 0);

  await assert.rejects(
    runVideoTask({
      capabilityKey: "video_capability_video_image_to_video",
      model: "wan2.7-i2v",
      values: {
        "input.prompt": "test",
        "input.media[]": [],
      },
      dependencies: deps,
    }),
    /required.*input\.media|input\.media.*required/i,
  );
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.catalog, 0);
});

test("JSON media fields reject local paths and non-HTTPS remote URLs", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runVideoTask({
      capabilityKey: "video_capability_video_image_to_video",
      model: "video-pro-720p",
      values: {
        prompt: "test",
        image_url: "/tmp/private.png",
      },
      dependencies: deps,
    }),
    /local media paths|public HTTPS|data URL/i,
  );
  await assert.rejects(
    runVideoTask({
      capabilityKey: "video_capability_video_image_to_video",
      model: "video-pro-720p",
      values: {
        prompt: "test",
        image_url: "http://assets.example.test/input.png",
      },
      dependencies: deps,
    }),
    /public HTTPS URL|requires.*HTTPS/i,
  );
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.submit, 0);
});

test("audio and video array count limits fail closed", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runVideoTask({
      capabilityKey: "video_capability_video_image_audio_to_video",
      model: "video-pro-720p",
      values: {
        prompt: "test",
        image_url: "https://assets.example.test/main.png",
        "extra_images[]": ["https://assets.example.test/a.png"],
        "extra_audios[]": [
          "https://assets.example.test/1.mp3",
          "https://assets.example.test/2.mp3",
          "https://assets.example.test/3.mp3",
          "https://assets.example.test/4.mp3",
        ],
      },
      dependencies: deps,
    }),
    /at most 3|maximum|outside.*range/i,
  );
  assert.equal(deps.calls.credential, 0);
});

test("multipart local media paths require matching Blob file fields", async () => {
  const deps = createProductionDeps();
  await assert.rejects(
    runVideoTask({
      capabilityKey: "video_capability_video_image_to_video",
      model: "happyhorse-1.0-i2v",
      values: {
        image: "/tmp/private.png",
        prompt: "animate",
      },
      files: [],
      dependencies: deps,
    }),
    /multipart request|requires.*file/i,
  );
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.submit, 0);
});

test("nested input.media dry-run preserves documented media types", async () => {
  const deps = createProductionDeps();
  const result = await runVideoTask({
    capabilityKey: "video_capability_video_first_last_frame",
    model: "wan2.7-i2v",
    values: {
      "input.prompt": "transition between frames",
      "input.media[]": [
        { type: "first_frame", url: "https://assets.example.test/first.png" },
        { type: "last_frame", url: "https://assets.example.test/last.png" },
      ],
    },
    dryRun: true,
    dependencies: deps,
  });
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.request.body.input.media, [
    { type: "first_frame", url: "https://assets.example.test/first.png" },
    { type: "last_frame", url: "https://assets.example.test/last.png" },
  ]);
  assert.equal(deps.calls.credential, 1);
  assert.equal(deps.calls.catalog, 1);
});

test("messages and input_video recreate profile dry-runs", async () => {
  const deps = createProductionDeps();
  const result = await runVideoTask({
    capabilityKey: "video_capability_video_recreate",
    model: "omni_flash_edit",
    values: {
      input_video: "https://assets.example.test/source.mp4",
      "messages[]": [
        { role: "user", content: "Recreate this as a cinematic travel clip." },
      ],
    },
    dryRun: true,
    dependencies: deps,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.request.body.input_video, "https://assets.example.test/source.mp4");
  assert.equal(result.request.body.messages[0].content.includes("cinematic"), true);
});

test("new tasks submit once, then GET-poll and persist the returned task ID", async () => {
  const deps = createVideoDeps();
  const result = await runVideoTask({ ...baseInput, dependencies: deps });
  assert.equal(deps.calls.submit, 1);
  assert.equal(deps.calls.poll, 1);
  assert.equal(deps.calls.persist, 1);
  assert.equal(result.taskId, "vid_new");
});

test("URL video results use atomic downloader and return redacted URL and absolute path", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "kaiyun-video-url-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = join(root, "url.mp4");
  const calls = [];
  const result = await persistVideoResult({
    taskId: "url_task",
    completed: {
      status: "completed",
      url: "https://cdn.example.test/result.mp4?token=private",
    },
    output,
    downloadResult: async (input) => {
      calls.push(input);
      await fs.writeFile(input.output, "video");
      return {
        path: input.output,
        url: "https://cdn.example.test/result.mp4?token=%5BREDACTED%5D",
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.taskId, "url_task");
  assert.equal(result.status, "completed");
  assert.equal(isAbsolute(result.path), true);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("CLI parses repeated media, params, resume, output, and dry-run", () => {
  const parsed = parseCliArguments([
    "--capability",
    "video_capability_video_image_audio_to_video",
    "--model",
    "video-pro-720p",
    "--prompt",
    "compose",
    "--param",
    "duration=6",
    "--param",
    "aspect_ratio=16:9",
    "--image",
    "https://assets.example.test/a.png",
    "--image",
    "https://assets.example.test/b.png",
    "--audio",
    "https://assets.example.test/voice.mp3",
    "--video",
    "https://assets.example.test/clip.mp4",
    "--task-id",
    "resume_1",
    "--output",
    "result.mp4",
    "--dry-run",
  ]);

  assert.deepEqual(parsed.params, [
    ["duration", "6"],
    ["aspect_ratio", "16:9"],
  ]);
  assert.deepEqual(parsed.images, [
    "https://assets.example.test/a.png",
    "https://assets.example.test/b.png",
  ]);
  assert.deepEqual(parsed.audios, ["https://assets.example.test/voice.mp3"]);
  assert.deepEqual(parsed.videos, ["https://assets.example.test/clip.mp4"]);
  assert.equal(parsed.taskId, "resume_1");
  assert.equal(parsed.output, "result.mp4");
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

test("CLI prepares local image/audio/video files with basename-only metadata", async () => {
  const reads = [];
  const input = await prepareCliInput(
    parseCliArguments([
      "--capability",
      "video_capability_video_image_to_video",
      "--model",
      "happyhorse-1.0-i2v",
      "--prompt",
      "animate",
      "--image",
      "/private/first.png",
      "--audio",
      "/private/voice.mp3",
      "--video",
      "/private/clip.mp4",
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
    "/private/voice.mp3",
    "/private/clip.mp4",
  ]);
  assert.deepEqual(
    input.files.map(({ field, filename }) => ({ field, filename })),
    [
      { field: "image", filename: "first.png" },
      { field: "audio", filename: "voice.mp3" },
      { field: "video", filename: "clip.mp4" },
    ],
  );
  assert.ok(
    !JSON.stringify(input.files.map(({ filename }) => filename)).includes(
      "/private",
    ),
  );
});

test("CLI task-id-only resume needs no capability, model, prompt, or file reads", async () => {
  const input = await prepareCliInput(
    parseCliArguments(["--task-id", "vid_paid_123", "--output", "resumed.mp4"]),
    { readFile: async () => assert.fail("resume must not read files") },
  );
  assert.deepEqual(input, {
    taskId: "vid_paid_123",
    output: "resumed.mp4",
  });
});

test("CLI maps remote image lists onto adapter array fields", async () => {
  const input = await prepareCliInput(
    parseCliArguments([
      "--capability",
      "video_capability_video_reference_generation",
      "--model",
      "omni_flash-fast",
      "--prompt",
      "refs",
      "--image",
      "https://assets.example.test/a.png",
      "--image",
      "https://assets.example.test/b.png",
      "--dry-run",
    ]),
  );
  assert.deepEqual(input.values["reference_image_urls[]"], [
    "https://assets.example.test/a.png",
    "https://assets.example.test/b.png",
  ]);
  assert.equal(input.values.prompt, "refs");
});

test("CLI maps one remote video onto a documented video_url field", async () => {
  const input = await prepareCliInput(
    parseCliArguments([
      "--capability",
      "video_capability_video_recreate",
      "--model",
      "veo-omni-flash-dewatermark",
      "--video",
      "https://assets.example.test/source.mp4",
      "--dry-run",
    ]),
  );

  assert.equal(input.values.video_url, "https://assets.example.test/source.mp4");
});

test("CLI dry-run uses injected read-only runtime catalog data", async () => {
  const result = await executeCli(
    [
      "--capability",
      "video_capability_video_text_generation",
      "--model",
      "omni_flash",
      "--prompt",
      "CLI dry run",
      "--dry-run",
      "--json",
    ],
    createProductionDeps(),
  );
  const output = JSON.parse(formatCliResult(result));
  assert.equal(output.dryRun, true);
  assert.equal(output.request.path, "/v1/videos");
  assert.match(output.confirmCard, /KaiyunCode 视频任务确认/);
  assert.match(output.confirmCard, /omni_flash/);
  assert.match(output.confirmCard, /预算上限：\$0\.2200/);
});

test("CLI dry-run default stdout is a human confirmation card", async () => {
  const result = await executeCli(
    [
      "--capability",
      "video_capability_video_text_generation",
      "--model",
      "omni_flash",
      "--prompt",
      "CLI dry run card",
      "--dry-run",
    ],
    createProductionDeps(),
  );
  const output = formatCliResult(result);
  assert.match(output, /【KaiyunCode 视频任务确认】/);
  assert.match(output, /预算上限：\$0\.2200/);
  assert.match(output, /确认提交/);
  assert.throws(() => JSON.parse(output));
});


test("concurrent video jobs submit all before polls complete", async () => {
  let submitCount = 0;
  const pollGates = [];
  const deps = createVideoDeps();
  deps.submitTask = async () => {
    submitCount += 1;
    return `vid_${submitCount}`;
  };
  deps.pollTask = async ({ taskId, kind }) => {
    assert.equal(kind, "video");
    await new Promise((resolve) => {
      pollGates.push(resolve);
    });
    return { taskId, status: "completed", url: "https://example.test/result.mp4" };
  };
  deps.persistVideoResult = async ({ taskId }) => ({
    taskId,
    status: "completed",
    path: `/absolute/${taskId}.mp4`,
  });

  const pending = runConcurrentVideoTasks(
    [baseInput, baseInput, baseInput],
    deps,
  );
  for (let i = 0; i < 20 && pollGates.length < 3; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(submitCount, 3);
  assert.equal(deps.calls.catalog, 1);
  assert.equal(pollGates.length, 3);
  for (const release of pollGates) release();
  const results = await pending;
  assert.equal(results.length, 3);
  assert.ok(results.every((item) => item.ok));
});

test("prepareJobSpec maps video capability and values", async () => {
  const job = await prepareJobSpec({
    capability: "video_capability_video_text_generation",
    model: "omni_flash",
    values: { prompt: "batch video" },
    dryRun: true,
  });
  assert.equal(job.capabilityKey, "video_capability_video_text_generation");
  assert.equal(job.values.prompt, "batch video");
});
