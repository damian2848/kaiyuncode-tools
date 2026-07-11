import assert from "node:assert/strict";
import test from "node:test";

import { runConcurrentTasks } from "../shared/concurrent-tasks.mjs";

test("runConcurrentTasks starts every job without waiting for earlier completion", async () => {
  const started = [];
  const gates = [];
  const pending = runConcurrentTasks([1, 2, 3], async (job) => {
    started.push(job);
    await new Promise((resolve) => {
      gates.push(resolve);
    });
    return job * 10;
  });
  for (let i = 0; i < 20 && started.length < 3; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
  assert.deepEqual(started.sort(), [1, 2, 3]);
  assert.equal(gates.length, 3);
  for (const release of gates) release();
  const results = await pending;
  assert.deepEqual(
    results.map(({ index, ok, result }) => ({ index, ok, result })),
    [
      { index: 0, ok: true, result: 10 },
      { index: 1, ok: true, result: 20 },
      { index: 2, ok: true, result: 30 },
    ],
  );
});

test("runConcurrentTasks isolates rejections", async () => {
  const results = await runConcurrentTasks(["a", "b", "c"], async (job) => {
    if (job === "b") throw new Error("boom");
    return job;
  });
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /boom/);
  assert.equal(results[2].ok, true);
});
