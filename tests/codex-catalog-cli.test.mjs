import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { buildCodexModelCatalog } from "../shared/codex-model-catalog.mjs";

// Opt-in: requires Codex >= 0.154.0. All inference traffic stays on loopback.
test("real Codex loads modalities and sends image input and default effort to Responses", {
  skip: process.env.KAIYUN_TEST_CODEX !== "1", timeout: 90000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "kaiyun-codex-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const otherVisionModels = ["claude-opus-4-8", "gemini-3.7-flash-tiered", "grok-4.6", "kimi-k3", "glm-5.3-flash", "MiniMax-M3", "deepseek-v4.1-flash"];
  const imageModels = new Set(["gpt-6-astra", ...otherVisionModels]);
  const source = [
    { id: "catalog-reasoner", type: "text", context_window: 64000, supported_reasoning_levels: ["low", "high"], default_reasoning_level: "high" },
    { id: "catalog-plain", type: "text", context_window: 16000, supported_reasoning_levels: [], input_modalities: ["text"] },
    { id: "catalog-no-default", type: "text", context_window: 32000, supported_reasoning_levels: ["low", "high"], default_reasoning_level: null },
    { id: "gpt-6-astra", type: "text", supportedWireApis: ["responses"] },
    ...otherVisionModels.map((id) => ({ id, type: "text", supportedWireApis: ["responses"], supported_reasoning_levels: [], default_reasoning_level: null })),
  ];
  const { catalog } = buildCodexModelCatalog(new Map(source.map((model) => [model.id, model])));
  const catalogPath = join(directory, "models.json");
  await writeFile(catalogPath, JSON.stringify(catalog));
  const imagePath = join(directory, "pixel.png");
  await writeFile(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_test","status":"completed","output":[],"usage":{"input_tokens":10,"output_tokens":0,"total_tokens":10}}}\n\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await writeFile(join(directory, "config.toml"), [
    'model_provider = "custom"', 'model = "catalog-reasoner"',
    `model_catalog_json = ${JSON.stringify(catalogPath)}`, 'web_search = "disabled"',
    '[model_providers.custom]', 'name = "custom"', 'wire_api = "responses"',
    `base_url = "http://127.0.0.1:${server.address().port}/v1"`,
    'request_max_retries = 0', 'stream_max_retries = 0',
  ].join("\n"));
  // Do not inherit credentials, a real HOME config, or a project.
  const env = { PATH: process.env.PATH, HOME: directory, CODEX_HOME: directory, TMPDIR: tmpdir(), RUST_LOG: "error" };
  const app = spawn("codex", ["app-server"], { cwd: directory, env, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => app.kill());
  let errors = "";
  app.stderr.on("data", (chunk) => { errors += chunk; });
  const send = (value) => app.stdin.write(`${JSON.stringify(value)}\n`);
  const listed = new Promise((resolve, reject) => {
    app.on("error", reject);
    app.on("exit", () => reject(new Error(`app-server exited: ${errors}`)));
    createInterface({ input: app.stdout }).on("line", (line) => {
      const message = JSON.parse(line);
      if (message.method === "configWarning") reject(new Error(JSON.stringify(message.params)));
      if (message.id === 1) { send({ method: "initialized" }); send({ id: 2, method: "model/list", params: {} }); }
      if (message.id === 2) resolve(message.result);
    });
  });
  send({ id: 1, method: "initialize", params: { clientInfo: { name: "catalog-test", version: "1.0" } } });
  const result = await listed;
  assert.deepEqual(result.data.map((model) => model.model).sort(), source.map((model) => model.id).sort());
  assert.equal(result.data.find((model) => model.model === "catalog-reasoner").defaultReasoningEffort, "high");
  assert.deepEqual(result.data.find((model) => model.model === "catalog-plain").supportedReasoningEfforts, []);
  assert.deepEqual(result.data.find((model) => model.model === "catalog-plain").inputModalities, ["text"]);
  for (const model of imageModels) assert.deepEqual(result.data.find((entry) => entry.model === model).inputModalities, ["text", "image"], model);
  app.kill();
  for (const model of source.map((entry) => entry.id)) {
    const imageArgs = imageModels.has(model) ? ["--image", imagePath] : [];
    const child = spawn("codex", ["exec", "--ephemeral", "--skip-git-repo-check", "--json", "-m", model, ...imageArgs, "--", "Reply OK without tools."], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
    t.after(() => child.kill());
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Codex request timed out for ${model}: ${output}`));
      }, 15000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    const request = requests.find((entry) => entry.body.model === model);
    assert.ok(request, `No Responses request for ${model}: ${output}`);
    assert.equal(request.url, "/v1/responses");
    assert.equal(request.body.reasoning?.effort, model === "catalog-reasoner" ? "high" : model === "gpt-6-astra" ? "medium" : undefined);
    assert.equal(request.body.reasoning?.summary, undefined);
    if (imageModels.has(model)) {
      const images = request.body.input.flatMap((item) => item.content ?? []).filter((item) => item.type === "input_image");
      assert.equal(images.length, 1);
      assert.match(images[0].image_url, /^data:image\/png;base64,/);
    }
  }
});
