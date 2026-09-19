import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { buildOpenClawModels } from "../shared/openclaw-config.mjs";

// Opt-in: points at an installed @openclaw/ai package. All requests stay on
// loopback with a fake key; no user configuration or paid endpoint is used.
test("real OpenClaw adapters send the declared endpoint and selected public effort", {
  skip: !process.env.KAIYUN_TEST_OPENCLAW_AI_DIR, timeout: 30000,
}, async (t) => {
  const root = process.env.KAIYUN_TEST_OPENCLAW_AI_DIR;
  const { createLlmRuntime } = await import(pathToFileURL(join(root, "dist/index.mjs")));
  const { registerBuiltInApiProviders } = await import(pathToFileURL(join(root, "dist/providers.mjs")));
  const runtime = createLlmRuntime();
  registerBuiltInApiProviders(runtime.registry);
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (req.url === "/v1/responses") {
      res.end('event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_test","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0,"total_tokens":1}}}\n\n');
    } else {
      res.end('data: {"id":"chat_test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"id":"chat_test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  for (const [wire, effort] of [["responses", "low"], ["responses", "xhigh"], ["responses", "max"], ["chat_completions", "high"], ["chat_completions", "max"], ["responses", null]]) {
    const source = { id: "public-model", type: "text", supportedWireApis: [wire], supported_reasoning_levels: effort ? [effort] : [], default_reasoning_level: effort };
    const { models: [row] } = buildOpenClawModels(new Map([[source.id, source]]));
    const model = { ...row, provider: "kaiyuncode", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, contextWindow: 32000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const result = await runtime.completeSimple(model, { messages: [{ role: "user", content: "local test", timestamp: Date.now() }] }, { apiKey: "fake-local-only-key", reasoning: row.params?.thinking, maxTokens: 32, transport: "sse" });
    assert.notEqual(result.stopReason, "error", result.errorMessage);
    const request = requests.at(-1);
    assert.equal(request.path, wire === "responses" ? "/v1/responses" : "/v1/chat/completions");
    assert.equal(wire === "responses" ? request.body.reasoning?.effort : request.body.reasoning_effort, effort ?? undefined, `${wire}: ${effort}`);
    assert.equal(request.body.model, "public-model");
  }
  assert.equal(requests.length, 6);
});
