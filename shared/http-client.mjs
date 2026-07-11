import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { redactSensitive } from "./redaction.mjs";

const BASE_URL = "https://kaiyuncode.com";
const ALLOWED_SUBMIT_PATHS = new Set([
  "/v1/images/async/generations",
  "/v1/images/async/edits",
  "/v1/videos",
]);
const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const FAILURE_STATUSES = new Set([
  "failed",
  "failure",
  "error",
  "cancelled",
  "canceled",
]);

export class PollTimeoutError extends Error {
  constructor(taskId) {
    super(`Polling timed out; task ${taskId} can be resumed later`);
    this.name = "PollTimeoutError";
    this.taskId = taskId;
  }
}

export class TaskFailedError extends Error {
  constructor(taskId, status, reason) {
    const safeReason = redactSensitive(reason ?? "unknown reason");
    super(`Task ${taskId} ended with status ${status}: ${String(safeReason)}`);
    this.name = "TaskFailedError";
    this.taskId = taskId;
    this.status = status;
    this.failReason = safeReason;
  }
}

function productionBaseUrl(baseUrl) {
  const base = new URL(baseUrl);
  if (
    base.protocol !== "https:" ||
    base.hostname !== "kaiyuncode.com" ||
    base.port !== "" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("KaiyunCode requests require the production HTTPS base URL");
  }
  return base;
}

function requestUrl(baseUrl, path) {
  const base = productionBaseUrl(baseUrl);
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("KaiyunCode requests require a relative production path");
  }
  const resolved = new URL(path, base);
  if (resolved.origin !== base.origin) {
    throw new Error("KaiyunCode requests must remain on the production origin");
  }
  return resolved.toString();
}

function submissionUrl(baseUrl, path) {
  productionBaseUrl(baseUrl);
  if (!ALLOWED_SUBMIT_PATHS.has(path)) {
    throw new Error("Task submission requires an allowed asynchronous submission path");
  }
  return requestUrl(baseUrl, path);
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function firstStringAt(payload, paths) {
  for (const path of paths) {
    let cursor = payload;
    for (const segment of path) {
      if (
        !cursor ||
        typeof cursor !== "object" ||
        !Object.hasOwn(cursor, segment)
      ) {
        cursor = undefined;
        break;
      }
      cursor = cursor[segment];
    }
    if (typeof cursor === "string" && cursor.length > 0) return cursor;
  }
  return null;
}

function taskIdFrom(payload) {
  return firstStringAt(payload, [
    ["task_id"],
    ["taskId"],
    ["data", "task_id"],
    ["data", "taskId"],
    ["data", "data", "task_id"],
    ["data", "data", "taskId"],
    ["id"],
    ["data", "id"],
    ["data", "data", "id"],
  ]);
}

function statusFrom(payload) {
  return firstStringAt(payload, [
    ["status"],
    ["data", "status"],
    ["data", "data", "status"],
    ["state"],
    ["data", "state"],
    ["data", "data", "state"],
  ]);
}

function resultUrlFrom(payload) {
  return firstStringAt(payload, [
    ["video_url"],
    ["media_url"],
    ["result_url"],
    ["data", "video_url"],
    ["data", "media_url"],
    ["data", "result_url"],
    ["data", "data", "video_url"],
    ["metadata", "url"],
    ["results", 0, "url"],
    ["data", "metadata", "url"],
    ["data", "results", 0, "url"],
    ["data", "data", "metadata", "url"],
    ["data", "data", "results", 0, "url"],
    ["data", "data", "data", 0, "url"],
    ["url"],
    ["data", "url"],
    ["data", "data", "url"],
  ]);
}

function b64From(payload) {
  return firstStringAt(payload, [
    ["b64_json"],
    ["base64"],
    ["data", "b64_json"],
    ["data", "base64"],
    ["data", 0, "b64_json"],
    ["data", "data", "b64_json"],
    ["data", "data", "base64"],
    ["data", "data", "data", 0, "b64_json"],
  ]);
}

function failReasonFrom(payload) {
  return firstStringAt(payload, [
    ["fail_reason"],
    ["failure_reason"],
    ["error_message"],
    ["data", "fail_reason"],
    ["data", "failure_reason"],
    ["data", "error_message"],
    ["data", "data", "fail_reason"],
    ["data", "data", "failure_reason"],
    ["data", "data", "error_message"],
    ["message"],
    ["data", "message"],
    ["data", "data", "message"],
  ]);
}

function withDeadline(promise, milliseconds, timeoutError, controller) {
  if (milliseconds <= 0) return Promise.reject(timeoutError());
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(timeoutError());
    }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function authenticationError(status) {
  return status === 401 || status === 403;
}

function retriableGetStatus(status) {
  return status === 429 || status >= 500;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

export async function submitTask({
  request,
  apiKey,
  fetchImpl = globalThis.fetch,
  baseUrl = BASE_URL,
  requestTimeoutMs = 60_000,
}) {
  if (request?.method !== "POST") {
    throw new Error("Task submission requires POST");
  }
  const url = submissionUrl(baseUrl, request.path);
  const controller = new AbortController();
  let result;
  try {
    result = await withDeadline(
      (async () => {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            ...(request.headers ?? {}),
            Authorization: `Bearer ${apiKey}`,
          },
          body: request.body,
          signal: controller.signal,
          redirect: "error",
        });
        const payload = await responseJson(response);
        return { response, payload, taskId: response.ok ? taskIdFrom(payload) : null };
      })(),
      requestTimeoutMs,
      () => new Error("submission deadline expired"),
      controller,
    );
  } catch {
    throw new Error(
      "Task submission failed; submission status is unknown. Do not retry automatically.",
    );
  }
  const { response, taskId } = result;
  if (!response.ok) {
    if (authenticationError(response.status)) {
      throw new Error("KaiyunCode authentication failed; check or recreate the API Key");
    }
    if (response.status === 402) {
      throw new Error(
        "KaiyunCode balance is insufficient; recharge at https://kaiyuncode.com/pricing",
      );
    }
    if (retriableGetStatus(response.status)) {
      throw new Error(
        `Task submission returned HTTP ${response.status}; submission status is unknown. Do not retry automatically.`,
      );
    }
    throw new Error(`Task submission rejected: HTTP ${response.status}`);
  }
  if (!taskId) {
    throw new Error(
      "Task submission response had no task ID; submission status is unknown. Do not retry automatically.",
    );
  }
  return taskId;
}

export async function pollTask({
  taskId,
  kind,
  apiKey,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  baseUrl = BASE_URL,
  intervalMs = 5_000,
  timeoutMs = 30 * 60_000,
  maxGetRetries = 3,
}) {
  if (kind !== "image" && kind !== "video") {
    throw new Error("Polling kind must be image or video");
  }
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("Polling requires a task ID");
  }
  const deadline = Date.now() + timeoutMs;
  const path =
    kind === "image"
      ? `/v1/images/async/${encodeURIComponent(taskId)}`
      : `/v1/videos/${encodeURIComponent(taskId)}`;
  let consecutiveRetries = 0;

  const remaining = () => deadline - Date.now();
  const wait = () =>
    withDeadline(
      Promise.resolve().then(() => sleepImpl(Math.min(intervalMs, Math.max(0, remaining())))),
      remaining(),
      () => new PollTimeoutError(taskId),
    );

  while (true) {
    if (remaining() <= 0) throw new PollTimeoutError(taskId);
    let response;
    let payload;
    const controller = new AbortController();
    try {
      ({ response, payload } = await withDeadline(
        (async () => {
          const response = await fetchImpl(requestUrl(baseUrl, path), {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
          });
          const payload = await responseJson(response);
          return { response, payload };
        })(),
        remaining(),
        () => new PollTimeoutError(taskId),
        controller,
      ));
    } catch (error) {
      if (error instanceof PollTimeoutError) throw error;
      consecutiveRetries += 1;
      if (consecutiveRetries > maxGetRetries) {
        throw new Error(`Polling failed for task ${taskId} after GET retries`);
      }
      await wait();
      continue;
    }

    if (!response.ok) {
      if (authenticationError(response.status)) {
        throw new Error("KaiyunCode authentication failed while polling");
      }
      if (retriableGetStatus(response.status)) {
        consecutiveRetries += 1;
        if (consecutiveRetries > maxGetRetries) {
          throw new Error(`Polling failed for task ${taskId} after GET retries`);
        }
        await wait();
        continue;
      }
      throw new Error(`Polling failed for task ${taskId}: HTTP ${response.status}`);
    }

    consecutiveRetries = 0;
    const rawStatus = statusFrom(payload);
    const status = rawStatus?.toLowerCase();
    if (SUCCESS_STATUSES.has(status)) {
      const url = resultUrlFrom(payload);
      const b64Json = b64From(payload);
      return {
        taskId,
        status,
        ...(url ? { url } : {}),
        ...(b64Json ? { b64Json } : {}),
        response: payload,
      };
    }
    if (FAILURE_STATUSES.has(status)) {
      throw new TaskFailedError(
        taskId,
        status,
        failReasonFrom(payload),
      );
    }
    await wait();
  }
}

function validatedDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Download URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Download URL must use HTTPS without embedded credentials");
  }
  return url;
}

export async function downloadResult({
  url,
  output,
  fetchImpl = globalThis.fetch,
}) {
  const remoteUrl = validatedDownloadUrl(url);
  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    let response;
    try {
      response = await fetchImpl(remoteUrl.toString(), { method: "GET" });
    } catch {
      throw new Error("Download failed due to a network error");
    }
    if (!response?.ok) {
      throw new Error(`Download failed: HTTP ${response?.status ?? "unknown"}`);
    }
    try {
      if (response.body) {
        await pipeline(
          Readable.fromWeb(response.body),
          createWriteStream(temporary, { flags: "wx" }),
        );
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(temporary, bytes, { flag: "wx" });
      }
    } catch {
      throw new Error("Download failed while reading the response body");
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return {
    path: destination,
    url: redactSensitive(remoteUrl.toString()),
  };
}
