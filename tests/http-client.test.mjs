import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  downloadResult,
  pollTask,
  submitTask,
} from "../shared/http-client.mjs";

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deadlineProbe(promise, milliseconds = 50) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("test deadline probe expired")), milliseconds);
    }),
  ]);
}

test("credential-bearing submissions reject every non-allowlisted production path", async () => {
  const rejectedPaths = [
    "https://attacker.test/collect",
    "//attacker.test/collect",
    "/v1/videos?redirect=https://attacker.test",
    "/v1/videos#fragment",
    "/v1/%2e%2e/videos",
    "/v1/videos/../videos",
    "/%2fv1/videos",
  ];

  for (const path of rejectedPaths) {
    await assert.rejects(
      submitTask({
        request: { method: "POST", path, body: "{}" },
        apiKey: "must-not-leak",
        fetchImpl: async () => assert.fail(`fetch must not run for ${path}`),
      }),
      /allowed asynchronous submission path/,
    );
  }

  await assert.rejects(
    submitTask({
      request: { method: "POST", path: "/v1/videos", body: "{}" },
      apiKey: "must-not-leak",
      baseUrl: "https://kaiyuncode.com:444",
      fetchImpl: async () => assert.fail("fetch must not run for a non-production port"),
    }),
    /production HTTPS base URL/,
  );
});

test("POST timeout is never retried and the error does not expose authorization", async () => {
  let fetchCalls = 0;
  const apiKey = "submit-secret";

  await assert.rejects(
    submitTask({
      request: { method: "POST", path: "/v1/videos", headers: {}, body: "{}" },
      apiKey,
      fetchImpl: async (_url, options) => {
        fetchCalls += 1;
        assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
        throw new DOMException("timeout", "TimeoutError");
      },
    }),
    (error) => {
      assert.match(error.message, /submission status is unknown/);
      assert.ok(!error.message.includes(apiKey));
      return true;
    },
  );
  assert.equal(fetchCalls, 1);
});

test("POST deadline covers response body parsing and task ID extraction", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    deadlineProbe(
      submitTask({
        request: { method: "POST", path: "/v1/videos", body: "{}" },
        apiKey: "body-timeout-secret",
        requestTimeoutMs: 5,
        fetchImpl: async () => {
          fetchCalls += 1;
          return { ok: true, status: 200, json: async () => new Promise(() => {}) };
        },
      }),
    ),
    (error) => {
      assert.match(error.message, /submission status is unknown/);
      assert.doesNotMatch(error.message, /body-timeout-secret/);
      assert.doesNotMatch(error.message, /deadline probe/);
      return true;
    },
  );
  assert.equal(fetchCalls, 1);
});

test("submission extracts a task id without retrying a paid POST", async () => {
  let fetchCalls = 0;
  const taskId = await submitTask({
    request: { method: "POST", path: "/v1/videos", headers: {}, body: "{}" },
    apiKey: "secret",
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ data: { task_id: "video_123" } });
    },
  });

  assert.equal(taskId, "video_123");
  assert.equal(fetchCalls, 1);
});

test("submission uses explicit task ID paths instead of unrelated nested IDs", async () => {
  const taskId = await submitTask({
    request: { method: "POST", path: "/v1/videos", body: "{}" },
    apiKey: "secret",
    fetchImpl: async () =>
      jsonResponse({
        data: {
          model: { id: "decoy-model-id" },
          data: { task_id: "actual-task-id" },
        },
      }),
  });

  assert.equal(taskId, "actual-task-id");
});

test("submission prefers semantic task IDs over generic root IDs", async () => {
  const taskId = await submitTask({
    request: { method: "POST", path: "/v1/videos", body: "{}" },
    apiKey: "secret",
    fetchImpl: async () =>
      jsonResponse({ id: "decoy-request-id", data: { task_id: "actual-task-id" } }),
  });
  assert.equal(taskId, "actual-task-id");
});

test("paid POST fails closed on redirects", async () => {
  await submitTask({
    request: { method: "POST", path: "/v1/videos", body: "{}" },
    apiKey: "secret",
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      return jsonResponse({ task_id: "redirect-safe-task" });
    },
  });
});

for (const status of [429, 500, 503]) {
  test(`paid POST HTTP ${status} is not retried`, async () => {
    let calls = 0;
    await assert.rejects(
      submitTask({
        request: { method: "POST", path: "/v1/videos", headers: {}, body: "{}" },
        apiKey: "secret",
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ error: "temporary" }, { status });
        },
      }),
      /submission status is unknown/,
    );
    assert.equal(calls, 1);
  });
}

test("polling retries only GET network, 429, and 5xx failures", async () => {
  const methods = [];
  const sleeps = [];
  const responses = [
    new TypeError("network down"),
    jsonResponse({ error: "limited" }, { status: 429 }),
    jsonResponse({ error: "upstream" }, { status: 503 }),
    jsonResponse({ status: "processing" }),
    jsonResponse({ status: "completed", video_url: "https://cdn.example.test/out.mp4" }),
  ];
  const result = await pollTask({
    taskId: "video_123",
    kind: "video",
    apiKey: "secret",
    intervalMs: 17,
    timeoutMs: 10_000,
    maxGetRetries: 3,
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
    fetchImpl: async (_url, options) => {
      methods.push(options.method);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  });

  assert.deepEqual(methods, ["GET", "GET", "GET", "GET", "GET"]);
  assert.deepEqual(sleeps, [17, 17, 17, 17]);
  assert.deepEqual(result, {
    taskId: "video_123",
    status: "completed",
    url: "https://cdn.example.test/out.mp4",
    response: { status: "completed", video_url: "https://cdn.example.test/out.mp4" },
  });
});

test("polling does not retry a terminal authentication error", async () => {
  let calls = 0;
  await assert.rejects(
    pollTask({
      taskId: "image_123",
      kind: "image",
      apiKey: "secret",
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: "unauthorized" }, { status: 401 });
      },
      sleepImpl: async () => assert.fail("must not sleep"),
    }),
    /authentication failed/,
  );
  assert.equal(calls, 1);
});

test("poll timeout preserves the task id", async () => {
  await assert.rejects(
    pollTask({
      taskId: "image_keep_me",
      kind: "image",
      apiKey: "secret",
      timeoutMs: 0,
      fetchImpl: async () => assert.fail("must time out before fetch"),
      sleepImpl: async () => {},
    }),
    (error) => {
      assert.equal(error.name, "PollTimeoutError");
      assert.equal(error.taskId, "image_keep_me");
      assert.match(error.message, /image_keep_me/);
      return true;
    },
  );
});

for (const [name, fetchImpl] of [
  ["GET headers", async () => new Promise(() => {})],
  [
    "GET response body",
    async () => ({ ok: true, status: 200, json: async () => new Promise(() => {}) }),
  ],
]) {
  test(`poll deadline bounds ${name} and preserves the task ID`, async () => {
    await assert.rejects(
      deadlineProbe(
        pollTask({
          taskId: "deadline-task-id",
          kind: "video",
          apiKey: "poll-timeout-secret",
          timeoutMs: 5,
          intervalMs: 0,
          fetchImpl,
          sleepImpl: async () => {},
        }),
      ),
      (error) => {
        assert.equal(error.name, "PollTimeoutError");
        assert.equal(error.taskId, "deadline-task-id");
        assert.doesNotMatch(error.message, /poll-timeout-secret|deadline probe/);
        return true;
      },
    );
  });
}

for (const [name, payload, expectedUrl] of [
  [
    "data.data.data[0].url",
    {
      status: "completed",
      input: { url: "https://example.test/decoy-input.png" },
      data: { data: { data: [{ url: "https://cdn.example.test/deep.png" }] } },
    },
    "https://cdn.example.test/deep.png",
  ],
  [
    "metadata.url",
    {
      status: "completed",
      input: { url: "https://example.test/decoy-input.mp4" },
      metadata: { url: "https://cdn.example.test/metadata.mp4" },
    },
    "https://cdn.example.test/metadata.mp4",
  ],
  [
    "results[0].url",
    {
      status: "completed",
      input: { url: "https://example.test/decoy-input.mp4" },
      results: [{ url: "https://cdn.example.test/results.mp4" }],
    },
    "https://cdn.example.test/results.mp4",
  ],
]) {
  test(`polling resolves the explicit production result path ${name}`, async () => {
    const result = await pollTask({
      taskId: "result-path-task",
      kind: "video",
      apiKey: "secret",
      fetchImpl: async () => jsonResponse(payload),
      sleepImpl: async () => assert.fail("must not sleep"),
    });
    assert.equal(result.url, expectedUrl);
  });
}

test("polling uses explicit status and failure paths instead of input decoys", async () => {
  const completed = await pollTask({
    taskId: "status-path-task",
    kind: "video",
    apiKey: "secret",
    fetchImpl: async () =>
      jsonResponse({
        input: { status: "failed", fail_reason: "decoy failure" },
        data: {
          status: "completed",
          metadata: { url: "https://cdn.example.test/actual.mp4" },
        },
      }),
    sleepImpl: async () => assert.fail("must not sleep"),
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.url, "https://cdn.example.test/actual.mp4");

  await assert.rejects(
    pollTask({
      taskId: "failure-path-task",
      kind: "video",
      apiKey: "secret",
      fetchImpl: async () =>
        jsonResponse({
          input: { fail_reason: "decoy failure" },
          data: { status: "failed", fail_reason: "actual failure" },
        }),
      sleepImpl: async () => assert.fail("must not sleep"),
    }),
    (error) => {
      assert.equal(error.failReason, "actual failure");
      return true;
    },
  );
});

test("polling prefers structured result and failure fields over generic root fields", async () => {
  const completed = await pollTask({
    taskId: "structured-result-task",
    kind: "video",
    apiKey: "secret",
    fetchImpl: async () =>
      jsonResponse({
        status: "completed",
        url: "https://kaiyuncode.com/v1/videos/structured-result-task",
        metadata: { url: "https://cdn.example.test/generated.mp4" },
      }),
    sleepImpl: async () => assert.fail("must not sleep"),
  });
  assert.equal(completed.url, "https://cdn.example.test/generated.mp4");

  await assert.rejects(
    pollTask({
      taskId: "structured-failure-task",
      kind: "video",
      apiKey: "secret",
      fetchImpl: async () =>
        jsonResponse({
          status: "failed",
          message: "generic wrapper message",
          data: { fail_reason: "specific production failure" },
        }),
      sleepImpl: async () => assert.fail("must not sleep"),
    }),
    (error) => {
      assert.equal(error.failReason, "specific production failure");
      return true;
    },
  );
});

for (const status of ["success", "succeeded", "completed"]) {
  test(`polling accepts ${status} as a success status`, async () => {
    const result = await pollTask({
      taskId: "done_123",
      kind: "video",
      apiKey: "secret",
      fetchImpl: async () => jsonResponse({ status }),
      sleepImpl: async () => assert.fail("must not sleep"),
    });
    assert.equal(result.status, status);
  });
}

for (const status of ["failed", "failure", "error", "cancelled", "canceled"]) {
  test(`polling rejects ${status} with a redacted failure reason`, async () => {
    await assert.rejects(
      pollTask({
        taskId: "failed_123",
        kind: "image",
        apiKey: "secret",
        fetchImpl: async () =>
          jsonResponse({ status, fail_reason: "Bearer failure-secret" }),
        sleepImpl: async () => assert.fail("must not sleep"),
      }),
      (error) => {
        assert.equal(error.name, "TaskFailedError");
        assert.equal(error.taskId, "failed_123");
        assert.ok(!error.message.includes("failure-secret"));
        assert.ok(!JSON.stringify(error.failReason).includes("failure-secret"));
        return true;
      },
    );
  });
}

test("download writes through a temporary sibling and renames only on success", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kaiyun-download-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "result.bin");
  await writeFile(output, "old");
  let observedDuringFetch;

  const result = await downloadResult({
    url: "https://cdn.example.test/result.bin?token=download-secret",
    output,
    fetchImpl: async () => {
      observedDuringFetch = await readFile(output, "utf8");
      return new Response("new-content", { status: 200 });
    },
  });

  assert.equal(observedDuringFetch, "old");
  assert.equal(await readFile(output, "utf8"), "new-content");
  assert.equal(result.path, output);
  assert.ok(!JSON.stringify(result).includes("download-secret"));
  assert.deepEqual(await readdir(root), ["result.bin"]);
});

test("failed downloads leave the existing destination intact and clean temporary files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kaiyun-download-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "result.bin");
  await writeFile(output, "old");

  await assert.rejects(
    downloadResult({
      url: "https://cdn.example.test/result.bin",
      output,
      fetchImpl: async () => new Response("bad", { status: 503 }),
    }),
    /Download failed: HTTP 503/,
  );

  assert.equal(await readFile(output, "utf8"), "old");
  assert.deepEqual(await readdir(root), ["result.bin"]);
});

test("download network errors redact signed URLs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kaiyun-download-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const signedUrl = "https://cdn.example.test/result.bin?token=network-secret";

  await assert.rejects(
    downloadResult({
      url: signedUrl,
      output: join(root, "result.bin"),
      fetchImpl: async () => {
        throw new Error(`network failed for ${signedUrl}`);
      },
    }),
    (error) => {
      assert.match(error.message, /Download failed due to a network error/);
      assert.ok(!error.message.includes("network-secret"));
      return true;
    },
  );
});
