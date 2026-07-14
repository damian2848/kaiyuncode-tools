import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateJobBudget,
  formatUsd,
  summarizeBudget,
} from "../shared/budget.mjs";

test("per-request pricing selects the matching resolution tier", () => {
  const result = estimateJobBudget({
    priceLabel: "$0.2200/次(720P)，$0.3000/次(1080P)，$0.5000/次(4K)",
    body: { resolution: "1080p", duration: 10 },
  });
  assert.equal(result.status, "exact");
  assert.equal(result.min, 0.3);
  assert.equal(result.max, 0.3);
});

test("per-second pricing multiplies rate by duration", () => {
  const result = estimateJobBudget({
    priceLabel: "$0.0600/秒(720P)，$0.0900/秒(1080P)",
    body: { metadata: { resolution: "720P", duration: 5 } },
  });
  assert.equal(result.status, "exact");
  assert.equal(result.min, 0.3);
  assert.equal(result.max, 0.3);
});

test("per-image pricing multiplies by requested image count", () => {
  const result = estimateJobBudget({
    priceLabel: "$0.0500/张",
    body: { n: 4, size: "2K" },
  });
  assert.equal(result.status, "exact");
  assert.equal(result.min, 0.2);
  assert.equal(result.max, 0.2);
});

test("fixed-duration pricing selects the matching package", () => {
  const result = estimateJobBudget({
    priceLabel: "$0.0500/6秒，$0.0700/10秒",
    body: { seconds: 10 },
  });
  assert.equal(result.status, "exact");
  assert.equal(result.min, 0.07);
  assert.equal(result.max, 0.07);
});

test("unselected price tiers produce a budget range", () => {
  const result = estimateJobBudget({
    priceLabel: "$0.2200/次(720P)，$0.5000/次(4K)",
    body: { prompt: "test" },
  });
  assert.equal(result.status, "range");
  assert.equal(result.min, 0.22);
  assert.equal(result.max, 0.5);
});

test("unknown pricing stays explicit and resume costs no new POST budget", () => {
  const unknown = estimateJobBudget({ body: { duration: 10 } });
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.min, null);

  const resume = estimateJobBudget({ taskId: "vid_paid_123" });
  assert.equal(resume.status, "exact");
  assert.equal(resume.max, 0);
});

test("budget summaries expose partial totals and stable USD formatting", () => {
  const summary = summarizeBudget([
    estimateJobBudget({ priceLabel: "$0.1000/次", body: {} }),
    estimateJobBudget({ body: {} }),
  ]);
  assert.equal(summary.status, "partial");
  assert.equal(summary.min, 0.1);
  assert.equal(summary.max, 0.1);
  assert.equal(summary.unknownCount, 1);
  assert.equal(formatUsd(summary.max), "$0.1000");
});
