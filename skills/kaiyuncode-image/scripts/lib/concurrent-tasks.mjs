/**
 * Run independent generation jobs fully concurrently.
 * Concurrency always equals the job count (N tasks → N concurrent runs).
 */
export async function runConcurrentTasks(jobs, runOne) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("jobs must be a non-empty array");
  }
  if (typeof runOne !== "function") {
    throw new Error("runOne must be a function");
  }

  const settled = await Promise.allSettled(
    jobs.map((job, index) => Promise.resolve().then(() => runOne(job, index))),
  );

  return settled.map((entry, index) => {
    if (entry.status === "fulfilled") {
      return { index, ok: true, result: entry.value };
    }
    const reason = entry.reason;
    return {
      index,
      ok: false,
      error: String(reason?.message ?? reason ?? "unknown error"),
    };
  });
}
