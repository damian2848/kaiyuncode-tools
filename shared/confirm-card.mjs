import { basename } from "node:path";

import {
  estimateJobBudget,
  formatUsd,
  summarizeBudget,
} from "./budget.mjs";
import { redactSensitive } from "./redaction.mjs";

const PRICING_SOURCE_URL = "https://kaiyuncode.com/api/pricing";

const PROMPT_KEYS = new Set([
  "prompt",
  "input.prompt",
  "text",
  "description",
]);

const PARAM_KEYS = [
  "duration",
  "seconds",
  "metadata.duration",
  "parameters.duration",
  "resolution",
  "metadata.resolution",
  "aspect_ratio",
  "ratio",
  "size",
  "image_size",
  "n",
  "output_format",
  "response_format",
  "background",
  "moderation",
  "enable_sequential",
  "seed",
];

function present(value) {
  return value !== undefined && value !== null && value !== "";
}

function flattenBody(body, prefix = "", out = Object.create(null)) {
  if (!present(body)) return out;
  if (Array.isArray(body)) {
    out[prefix || "[]"] = body;
    return out;
  }
  if (typeof body !== "object") {
    if (prefix) out[prefix] = body;
    return out;
  }

  // FormData summary shape from adapter-request / redaction
  if (body.type === "FormData" && Array.isArray(body.fields)) {
    for (const field of body.fields) {
      if (!field || typeof field !== "object") continue;
      const name = field.name;
      if (typeof name !== "string") continue;
      const key = prefix ? `${prefix}.${name}` : name;
      if (Object.hasOwn(out, key)) {
        const existing = out[key];
        out[key] = Array.isArray(existing)
          ? [...existing, field.value]
          : [existing, field.value];
      } else {
        out[key] = field.value;
      }
    }
    return out;
  }

  for (const [key, value] of Object.entries(body)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.type === "File" || value.type === "Blob") {
        out[path] = value;
        continue;
      }
      // Prefer nested metadata.* keys expanded
      flattenBody(value, path, out);
      continue;
    }
    out[path] = value;
  }
  return out;
}

function firstPrompt(flat) {
  for (const key of Object.keys(flat)) {
    const leaf = key.split(".").at(-1);
    if (PROMPT_KEYS.has(key) || PROMPT_KEYS.has(leaf)) {
      const value = flat[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  // messages[0].content style
  for (const [key, value] of Object.entries(flat)) {
    if (key.includes("messages") && typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function formatMediaValue(value) {
  if (!present(value)) return null;
  if (typeof value === "string") {
    if (value.startsWith("data:")) return "data-url";
    if (/^https?:\/\//iu.test(value)) {
      try {
        const url = new URL(value);
        return `${url.origin}/.../${url.pathname.split("/").filter(Boolean).at(-1) ?? ""}`;
      } catch {
        return "[remote-url]";
      }
    }
    return basename(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatMediaValue).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    if (value.type === "File" || value.name) {
      const name = value.name ? basename(String(value.name)) : "file";
      const size =
        typeof value.size === "number" ? ` (${value.size} bytes)` : "";
      return `${name}${size}`;
    }
    if (value.url) return formatMediaValue(value.url);
  }
  return null;
}

function collectMedia(flat) {
  const labels = [];
  const mediaKeys = [
    "image",
    "image_url",
    "images",
    "images[]",
    "image_urls[]",
    "reference_image_urls[]",
    "extra_images[]",
    "mask",
    "audio",
    "audio_urls[]",
    "extra_audios[]",
    "video",
    "input_video",
    "video_url",
    "metadata.video",
    "extra_videos[]",
    "input.media[]",
  ];
  for (const key of mediaKeys) {
    if (!Object.hasOwn(flat, key)) continue;
    const formatted = formatMediaValue(flat[key]);
    if (formatted) labels.push(`${key}=${formatted}`);
  }
  // file-like values under any key
  for (const [key, value] of Object.entries(flat)) {
    if (mediaKeys.includes(key)) continue;
    if (value && typeof value === "object" && value.type === "File") {
      const formatted = formatMediaValue(value);
      if (formatted) labels.push(`${key}=${formatted}`);
    }
  }
  return labels;
}

function collectParams(flat) {
  const parts = [];
  const seen = new Set();
  for (const key of PARAM_KEYS) {
    if (!Object.hasOwn(flat, key) || seen.has(key)) continue;
    const value = flat[key];
    if (!present(value) || typeof value === "object") continue;
    parts.push(`${key.split(".").at(-1)}=${value}`);
    seen.add(key);
  }
  return parts;
}

function truncatePrompt(prompt, max = 400) {
  if (typeof prompt !== "string") return "(none)";
  const compact = prompt.replace(/\s+/gu, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}…`;
}

function jobLines(job, index, total) {
  const request = job.request ?? {};
  const flat = flattenBody(request.body);
  const prompt = firstPrompt(flat);
  const params = collectParams(flat);
  const media = collectMedia(flat);
  const header = `${index + 1}/${total}`;

  const lines = [
    `任务 ${header}`,
    `- 能力：${job.capabilityKey ?? "恢复已有任务"}`,
    `- 模型：${job.model ?? "沿用原任务"}`,
  ];
  if (!job.resume && !job.taskId) {
    lines.push("- 模型校验：已通过实时 GET /v1/models");
  }
  if (params.length > 0) lines.push(`- 参数：${params.join(" · ")}`);
  if (media.length > 0) lines.push(`- 素材：${media.join("；")}`);
  lines.push(`- 提示词：${truncatePrompt(prompt)}`);
  if (job.output) lines.push(`- 输出：${job.output}`);
  if (job.resume || job.taskId) {
    lines.push(`- 恢复任务：${job.taskId}`);
  } else {
    lines.push(
      `- 接口：${request.method ?? "POST"} ${request.path ?? "?"}`,
    );
  }
  return lines;
}

function budgetValue(estimate) {
  if (estimate.status === "unknown") return `待确认（${estimate.note}）`;
  if (estimate.min === estimate.max) return formatUsd(estimate.min);
  return `${formatUsd(estimate.min)} - ${formatUsd(estimate.max)}`;
}

function totalBudgetValue(summary) {
  if (summary.status === "unknown") return "待确认";
  const known =
    summary.min === summary.max
      ? formatUsd(summary.min)
      : `${formatUsd(summary.min)} - ${formatUsd(summary.max)}`;
  return summary.unknownCount > 0
    ? `${known} + ${summary.unknownCount} 项待确认`
    : known;
}

function budgetLines(jobs) {
  const estimates = jobs.map((job) =>
    estimateJobBudget({
      priceLabel: job.priceLabel,
      body: job.request?.body,
      resume: job.resume,
      taskId: job.taskId,
    }),
  );
  const summary = summarizeBudget(estimates);
  const lines = ["预算", `- 单价来源：${PRICING_SOURCE_URL}`];

  estimates.forEach((estimate, index) => {
    const prefix = jobs.length > 1 ? `任务 ${index + 1}` : "预计费用";
    lines.push(`- ${prefix}：${budgetValue(estimate)}`);
    if (jobs.length === 1) {
      const resume = jobs[0].resume || jobs[0].taskId;
      lines.push(`- 参考单价：${resume ? "不适用" : estimate.priceLabel ?? "平台未提供"}`);
      if (resume) lines.push(`- 费用说明：${estimate.note}`);
    }
  });

  if (jobs.length > 1) lines.push(`- 预计合计：${totalBudgetValue(summary)}`);
  lines.push(
    `- 预算上限：${summary.unknownCount > 0 ? "待确认" : formatUsd(summary.max)}`,
    "- 计费口径：按平台公开美元单价和当前参数估算，以实际结算为准。",
  );
  return lines;
}

/**
 * Build a human-readable confirmation card for dry-run results.
 * Agents must paste this card into chat before any paid POST.
 */
export function formatConfirmCard({
  kind = "media",
  jobs = [],
  credentialHint = null,
  concurrent = false,
} = {}) {
  const list = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  const paidPosts = list.filter((job) => !job.resume && !job.taskId).length;
  const title =
    kind === "image"
      ? "KaiyunCode 图片任务确认"
      : kind === "video"
        ? "KaiyunCode 视频任务确认"
        : "KaiyunCode 任务确认";

  const lines = [
    `【${title}】`,
    "状态：待确认",
    "",
    "任务概览",
    `- 任务数：${list.length}`,
    `- 执行方式：${concurrent || list.length > 1 ? "并发" : "单任务"}`,
    `- 付费 POST：${paidPosts} 次`,
    "- 失败策略：不自动重试付费 POST",
  ];

  list.forEach((job, index) => {
    lines.push("");
    lines.push(...jobLines(job, index, list.length));
  });

  lines.push("", ...budgetLines(list), "", "凭据");
  if (credentialHint) {
    lines.push(`- 来源：${credentialHint}`);
  } else {
    lines.push(
      "- 来源规则：env(KAIYUN_API_KEY) > file(~/.codex/kaiyun-tools.env)",
      "- 客户端边界：有 env/file 时不混用 Claude/Codex 凭据",
    );
  }
  lines.push("", "确认操作");
  if (paidPosts > 0) {
    lines.push(
      '- 预算上限明确后，回复「确认提交」：按以上参数发起付费 POST。',
      "- 修改参数或预算：说明变更后重新 dry-run。",
    );
  } else {
    lines.push(
      '- 回复「确认继续」：恢复轮询已有任务，不发起付费 POST。',
      "- 修改输出路径：说明变更后重新 dry-run。",
    );
  }
  return String(redactSensitive(lines.join("\n")));
}

/**
 * Attach confirmCard to a single-task or concurrent dry-run result.
 */
export function withConfirmCard(result, { kind = "media" } = {}) {
  if (!result || typeof result !== "object") return result;

  if (result.concurrent && Array.isArray(result.results)) {
    const jobs = result.results.map((entry) => {
      if (!entry?.ok) return null;
      const value = entry.result;
      if (!value?.dryRun) return null;
      return {
        capabilityKey: value.capabilityKey,
        model: value.model,
        priceLabel: value.priceLabel,
        catalogCheckedAt: value.catalogCheckedAt,
        request: value.request,
        output: value.output,
        resume: value.resume,
        taskId: value.taskId,
      };
    });
    const dryJobs = jobs.filter(Boolean);
    if (dryJobs.length === 0) return result;
    const confirmCard = formatConfirmCard({
      kind,
      jobs: dryJobs,
      concurrent: true,
    });
    return {
      ...result,
      dryRun: true,
      confirmCard,
      results: result.results.map((entry) => {
        if (!entry?.ok || !entry.result?.dryRun) return entry;
        return {
          ...entry,
          result: {
            ...entry.result,
            confirmCard: formatConfirmCard({
              kind,
              jobs: [
                {
                  capabilityKey: entry.result.capabilityKey,
                  model: entry.result.model,
                  priceLabel: entry.result.priceLabel,
                  catalogCheckedAt: entry.result.catalogCheckedAt,
                  request: entry.result.request,
                  output: entry.result.output,
                  resume: entry.result.resume,
                  taskId: entry.result.taskId,
                },
              ],
            }),
          },
        };
      }),
    };
  }

  if (result.dryRun) {
    const confirmCard = formatConfirmCard({
      kind,
      jobs: [
        {
          capabilityKey: result.capabilityKey,
          model: result.model,
          priceLabel: result.priceLabel,
          catalogCheckedAt: result.catalogCheckedAt,
          request: result.request,
          output: result.output,
          resume: result.resume,
          taskId: result.taskId,
        },
      ],
    });
    return { ...result, confirmCard };
  }

  return result;
}
