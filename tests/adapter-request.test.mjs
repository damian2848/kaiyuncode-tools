import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildAdapterRequest } from "../shared/adapter-request.mjs";

const productionCapabilities = JSON.parse(
  readFileSync(
    new URL("../references/production-capabilities.json", import.meta.url),
    "utf8",
  ),
);

function productionAdapter(capabilityKey, model) {
  const capability = [
    ...productionCapabilities.imageCapabilities,
    ...productionCapabilities.videoCapabilities,
  ].find(({ key }) => key === capabilityKey);
  return capability.adapters.find((adapter) => adapter.model === model);
}

const jsonAdapter = {
  model: "wan-test",
  parameters: [
    { name: "model", type: "string", defaultValue: "wan-test" },
    { name: "input.prompt", type: "string", required: true, defaultValue: "-" },
    { name: "input.media[]", type: "object[]", required: true, defaultValue: "-" },
    { name: "parameters.duration", type: "number", defaultValue: "5" },
    { name: "reference_image_urls[]", type: "string[]", defaultValue: "-" },
  ],
  requestVariants: [
    {
      method: "POST",
      path: "/v1/videos",
      kind: "json",
      template: { model: "wan-test", input: {}, parameters: {} },
    },
  ],
};

test("JSON requests apply dotted and array parameter paths with typed defaults", () => {
  const request = buildAdapterRequest(
    jsonAdapter,
    {
      "input.prompt": "hello",
      "input.media[]": [{ type: "reference_image", url: "https://example.test/a.png" }],
      "reference_image_urls[]": ["https://example.test/b.png"],
    },
    [],
  );

  assert.equal(request.method, "POST");
  assert.equal(request.path, "/v1/videos");
  assert.deepEqual(request.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(request.body), {
    model: "wan-test",
    input: {
      prompt: "hello",
      media: [{ type: "reference_image", url: "https://example.test/a.png" }],
    },
    parameters: { duration: 5 },
    reference_image_urls: ["https://example.test/b.png"],
  });
});

test("request building rejects values that are not listed by the adapter", () => {
  assert.throws(
    () => buildAdapterRequest(jsonAdapter, { prompt: "wrong path" }, []),
    /Unknown adapter parameter: prompt/,
  );
});

test("JSON variants reject local media paths before serialization", () => {
  assert.throws(
    () =>
      buildAdapterRequest(
        jsonAdapter,
        {
          "input.prompt": "hello",
          "input.media[]": [{ type: "reference_image", url: "/tmp/private.png" }],
        },
        [],
      ),
    /Local media paths require a multipart request/,
  );
});

test("JSON variants also reject relative media filenames", () => {
  assert.throws(
    () =>
      buildAdapterRequest(
        jsonAdapter,
        {
          "input.prompt": "hello",
          "input.media[]": [{ type: "reference_image", url: "private.png" }],
        },
        [],
      ),
    /Local media paths require a multipart request/,
  );
});

test("multipart variants append scalar values and injected binary files", () => {
  const adapter = {
    model: "upload-model",
    parameters: [
      { name: "model", type: "string", defaultValue: "upload-model" },
      { name: "prompt", type: "string", required: true, defaultValue: "-" },
      { name: "image", type: "string", required: true, defaultValue: "-" },
      { name: "n", type: "number", defaultValue: "1" },
    ],
    requestVariants: [
      {
        method: "POST",
        path: "/v1/images/async/edits",
        kind: "multipart",
        fields: [
          { name: "model", value: "upload-model" },
          { name: "prompt", value: "example" },
          { name: "image", value: "@input.png" },
          { name: "n", value: "1" },
        ],
      },
    ],
  };
  const request = buildAdapterRequest(
    adapter,
    { prompt: "edit me", image: "/tmp/input.png" },
    [{ field: "image", data: new Blob(["pixels"]), filename: "input.png" }],
  );

  assert.ok(request.body instanceof FormData);
  assert.equal(request.headers["Content-Type"], undefined);
  assert.equal(request.body.get("model"), "upload-model");
  assert.equal(request.body.get("prompt"), "edit me");
  assert.equal(request.body.get("n"), "1");
  assert.equal(request.body.get("image").name, "input.png");
  assert.equal(request.summary.body.fields.find((item) => item.name === "image").value.name, "input.png");
  assert.ok(!JSON.stringify(request.summary).includes("/tmp/input.png"));
});

test("multipart summaries and filenames do not expose local directories", () => {
  const adapter = {
    model: "upload-model",
    parameters: [{ name: "model", type: "string", defaultValue: "upload-model" }],
    requestVariants: [
      {
        method: "POST",
        path: "/v1/videos",
        kind: "multipart",
        fields: [
          { name: "model", value: "upload-model" },
          { name: "video", value: "@private/source.mp4" },
        ],
      },
    ],
  };
  const request = buildAdapterRequest(adapter, {}, [
    {
      field: "video",
      data: new Blob(["clip"]),
      filename: "/Users/private/source.mp4",
    },
  ]);

  assert.equal(request.body.get("video").name, "source.mp4");
  assert.ok(!JSON.stringify(request.summary).includes("/Users/private"));
});

test("dry-run summaries redact embedded sensitive values", () => {
  const adapter = {
    model: "test",
    parameters: [
      { name: "model", type: "string", defaultValue: "test" },
      { name: "prompt", type: "string", defaultValue: "-" },
    ],
    requestVariants: [
      { method: "POST", path: "/v1/videos", kind: "json", template: {} },
    ],
  };
  const request = buildAdapterRequest(
    adapter,
    { prompt: "Bearer should-not-leak" },
    [],
  );

  assert.ok(!JSON.stringify(request.summary).includes("should-not-leak"));
});

test("real Kling JSON adapters preserve template aliases while overlaying user values", () => {
  const adapter = productionAdapter(
    "video_capability_video_text_generation",
    "kling/kling-v3-video-generation",
  );
  const request = buildAdapterRequest(adapter, { "input.prompt": "custom prompt" });
  const body = JSON.parse(request.body);

  assert.equal(body.prompt, "custom prompt");
  assert.equal(body.input.prompt, "custom prompt");
  assert.equal(body.parameters.mode, "std");
});

test("real Omni multipart adapters derive prompt from messages and preserve literals", () => {
  const adapter = productionAdapter(
    "video_capability_video_recreate",
    "omni_flash_edit",
  );
  const request = buildAdapterRequest(
    adapter,
    {
      "messages[]": [{ role: "user", content: "custom recreation prompt" }],
      input_video: "/tmp/source.mp4",
    },
    [{ field: "video", data: new Blob(["clip"]), filename: "source.mp4" }],
  );

  assert.equal(request.body.get("prompt"), "custom recreation prompt");
  assert.equal(request.body.get("resolution"), "720p");
  assert.equal(request.body.get("video").name, "source.mp4");
});

for (const maliciousName of [
  "__proto__.polluted",
  "constructor.prototype.polluted",
  "messages[].__proto__.polluted",
]) {
  test(`adapter paths reject prototype-pollution segment in ${maliciousName}`, (t) => {
    delete Object.prototype.polluted;
    t.after(() => delete Object.prototype.polluted);
    const values = Object.create(null);
    values[maliciousName] = "yes";
    if (maliciousName.startsWith("messages[]")) {
      values["messages[]"] = [{ role: "user", content: "hello" }];
    }
    const adapter = {
      model: "pollution-test",
      parameters: [
        { name: "model", type: "string", defaultValue: "pollution-test" },
        ...(maliciousName.startsWith("messages[]")
          ? [{ name: "messages[]", type: "object[]", defaultValue: "-" }]
          : []),
        { name: maliciousName, type: "string", defaultValue: "-" },
      ],
      requestVariants: [
        { method: "POST", path: "/v1/videos", kind: "json", template: {} },
      ],
    };

    assert.throws(
      () => buildAdapterRequest(adapter, values),
      /unsafe adapter parameter path/,
    );
    assert.equal({}.polluted, undefined);
  });
}

for (const [type, value] of [
  ["number", "not-a-number"],
  ["number", true],
  ["integer", "1.5"],
  ["boolean", "yes"],
  ["string", { unexpected: true }],
  ["string[]", "not-an-array"],
  ["string[]", ["valid", 2]],
  ["object[]", [{ valid: true }, "invalid"]],
  ["Array<{ type: string; text?: string }>", { invalid: true }],
]) {
  test(`adapter parameter type ${type} rejects ${JSON.stringify(value)}`, () => {
    const adapter = {
      model: "type-test",
      parameters: [
        { name: "model", type: "string", defaultValue: "type-test" },
        { name: "value", type, defaultValue: "-" },
      ],
      requestVariants: [
        { method: "POST", path: "/v1/videos", kind: "json", template: {} },
      ],
    };
    assert.throws(
      () => buildAdapterRequest(adapter, { value }),
      /must be|invalid/i,
    );
  });
}

test("adapter parameter types accept and normalize valid scalar and array values", () => {
  const adapter = {
    model: "valid-types",
    parameters: [
      { name: "model", type: "string", defaultValue: "valid-types" },
      { name: "number", type: "number", defaultValue: "-" },
      { name: "integer", type: "integer", defaultValue: "-" },
      { name: "boolean", type: "boolean", defaultValue: "-" },
      { name: "strings[]", type: "string[]", defaultValue: "-" },
      { name: "objects[]", type: "object[]", defaultValue: "-" },
      {
        name: "custom[]",
        type: "Array<{ type: string; text?: string }>",
        defaultValue: "-",
      },
    ],
    requestVariants: [
      { method: "POST", path: "/v1/videos", kind: "json", template: {} },
    ],
  };
  const body = JSON.parse(
    buildAdapterRequest(adapter, {
      number: "1.5",
      integer: "2",
      boolean: "false",
      "strings[]": ["one", "two"],
      "objects[]": [{ value: 1 }],
      "custom[]": [{ type: "text", text: "hello" }],
    }).body,
  );

  assert.equal(body.number, 1.5);
  assert.equal(body.integer, 2);
  assert.equal(body.boolean, false);
  assert.deepEqual(body.strings, ["one", "two"]);
  assert.deepEqual(body.objects, [{ value: 1 }]);
  assert.deepEqual(body.custom, [{ type: "text", text: "hello" }]);
});

test("real multipart adapters preserve repeated documented upload fields", () => {
  const adapter = productionAdapter(
    "video_capability_video_reference_generation",
    "happyhorse-1.0-r2v",
  );
  const request = buildAdapterRequest(adapter, { prompt: "reference prompt" }, [
    { field: "images", data: new Blob(["one"]), filename: "one.png" },
    { field: "images", data: new Blob(["two"]), filename: "two.png" },
  ]);

  assert.equal(request.body.get("prompt"), "reference prompt");
  assert.deepEqual(
    request.body.getAll("images").map((file) => file.name),
    ["one.png", "two.png"],
  );
});

for (const model of [
  "gpt-image-2",
  "gemini-3.1-flash-image",
  "gemini-3.0-pro-image",
  "wan2.7-image-pro",
]) {
  test(`real ${model} image edit selects its documented local-upload variant`, () => {
    const adapter = productionAdapter("image_edit", model);
    const files =
      model === "wan2.7-image-pro"
        ? [
            { field: "image", data: new Blob(["car"]), filename: "car.png" },
            { field: "image", data: new Blob(["paint"]), filename: "paint.png" },
          ]
        : [{ field: "image", data: new Blob(["input"]), filename: "input.png" }];
    const request = buildAdapterRequest(
      adapter,
      { prompt: "local edit", image: "/tmp/input.png" },
      files,
    );
    const images = request.body.getAll("image");

    assert.equal(images.length, files.length);
    assert.ok(images.every((image) => image instanceof Blob));
    assert.deepEqual(
      images.map((image) => image.name),
      files.map((file) => file.filename),
    );
  });
}

for (const model of [
  "gpt-image-2",
  "gemini-3.1-flash-image",
  "gemini-3.0-pro-image",
  "wan2.7-image-pro",
]) {
  test(`real ${model} image edit selects its URL-scalar variant without files`, () => {
    const adapter = productionAdapter("image_edit", model);
    const url = "https://assets.example.test/input.png";
    const request = buildAdapterRequest(adapter, {
      prompt: "URL edit",
      image: url,
    });
    const images = request.body.getAll("image");

    assert.equal(images.length, 1);
    assert.ok(images.every((image) => image === url));
  });
}

test("real Wan edit sends one scalar URL exactly once", () => {
  const adapter = productionAdapter("image_edit", "wan2.7-image-pro");
  const request = buildAdapterRequest(adapter, {
    prompt: "URL edit",
    image: "https://assets.example.test/input.png",
  });

  assert.deepEqual(request.body.getAll("image"), [
    "https://assets.example.test/input.png",
  ]);
});

test("real Wan edit preserves distinct repeated remote image URLs in order", () => {
  const adapter = productionAdapter("image_edit", "wan2.7-image-pro");
  const request = buildAdapterRequest(adapter, {
    prompt: "URL edit",
    image: [
      "https://assets.example.test/car.png",
      "https://assets.example.test/paint.png",
    ],
  });

  assert.deepEqual(request.body.getAll("image"), [
    "https://assets.example.test/car.png",
    "https://assets.example.test/paint.png",
  ]);
});

test("real Wan edit maps repeated upload placeholders to each file exactly once", () => {
  const adapter = productionAdapter("image_edit", "wan2.7-image-pro");
  const request = buildAdapterRequest(
    adapter,
    { prompt: "upload edit", image: "/tmp/car.png" },
    [
      { field: "image", data: new Blob(["car"]), filename: "car.png" },
      { field: "image", data: new Blob(["paint"]), filename: "paint.png" },
    ],
  );

  assert.deepEqual(
    request.body.getAll("image").map((image) => image.name),
    ["car.png", "paint.png"],
  );
});

for (const field of ["prompt", "model"]) {
  test(`multipart rejects Blob uploads for scalar field ${field}`, () => {
    const adapter = {
      model: "file-semantics-test",
      parameters: [
        { name: "model", type: "string", defaultValue: "file-semantics-test" },
        { name: "prompt", type: "string", defaultValue: "example" },
      ],
      requestVariants: [
        {
          method: "POST",
          path: "/v1/videos",
          kind: "multipart",
          fields: [
            { name: "model", value: "file-semantics-test" },
            { name: "prompt", value: "example" },
            { name: "video", value: "@source.mp4" },
          ],
        },
      ],
    };
    assert.throws(
      () =>
        buildAdapterRequest(adapter, {}, [
          { field, data: new Blob(["wrong"]), filename: "wrong.bin" },
        ]),
      /not a documented upload field/,
    );
  });
}
