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
  if (body.type === "FormData" && Array.isArray(body.fields)) {
    for (const field of body.fields) {
      if (!field || typeof field.name !== "string") continue;
      const key = prefix ? `${prefix}.${field.name}` : field.name;
      out[key] = field.value;
    }
    return out;
  }
  for (const [key, value] of Object.entries(body)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.type !== "File" &&
      value.type !== "Blob"
    ) {
      flattenBody(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

function positiveNumber(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstPositive(flat, keys) {
  for (const key of keys) {
    const value = positiveNumber(flat[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeQualifier(value) {
  if (typeof value !== "string") return null;
  const compact = value.trim().toUpperCase().replace(/\s+/gu, "");
  if (!compact) return null;
  if (/^\d+$/.test(compact)) return `${compact}P`;
  return compact;
}

function requestQualifiers(flat) {
  const values = [
    flat.resolution,
    flat.resolution_name,
    flat["metadata.resolution"],
    flat["parameters.resolution"],
    flat.image_size,
    flat.size,
  ];
  return new Set(values.map(normalizeQualifier).filter(Boolean));
}

function parsePriceEntries(priceLabel) {
  if (typeof priceLabel !== "string" || priceLabel.trim() === "") return [];
  const entries = [];
  const pattern = /\$(\d+(?:\.\d+)?)\/(?:(次|张)|(\d+(?:\.\d+)?)秒|(秒))(?:\(([^)]+)\))?/gu;
  for (const match of priceLabel.matchAll(pattern)) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const countUnit = match[2] ?? null;
    const fixedSeconds = match[3] ? Number(match[3]) : null;
    entries.push({
      amount,
      basis:
        countUnit === "张"
          ? "image"
          : countUnit === "次"
            ? "request"
            : fixedSeconds !== null
              ? "fixed-duration"
              : "per-second",
      fixedSeconds,
      qualifier: normalizeQualifier(match[5]),
    });
  }
  return entries;
}

function selectEntries(entries, { duration, qualifiers }) {
  let selected = entries;
  const qualified = selected.filter(
    (entry) => entry.qualifier && qualifiers.has(entry.qualifier),
  );
  if (qualified.length > 0) selected = qualified;

  const timed = selected.filter(
    (entry) =>
      entry.basis === "fixed-duration" &&
      duration !== null &&
      entry.fixedSeconds === duration,
  );
  if (timed.length > 0) selected = timed;
  return selected;
}

function costFor(entry, { duration, imageCount }) {
  if (entry.basis === "image") return entry.amount * imageCount;
  if (entry.basis === "per-second") {
    return duration === null ? null : entry.amount * duration;
  }
  return entry.amount;
}

export function estimateJobBudget({
  priceLabel,
  body,
  resume = false,
  taskId,
} = {}) {
  if (resume || taskId) {
    return {
      status: "exact",
      currency: "USD",
      min: 0,
      max: 0,
      priceLabel: null,
      note: "仅恢复任务，无新付费 POST",
    };
  }

  const entries = parsePriceEntries(priceLabel);
  if (entries.length === 0) {
    return {
      status: "unknown",
      currency: "USD",
      min: null,
      max: null,
      priceLabel: typeof priceLabel === "string" ? priceLabel : null,
      note: "平台未提供可解析的公开单价",
    };
  }

  const flat = flattenBody(body);
  const context = {
    duration: firstPositive(flat, [
      "duration",
      "seconds",
      "metadata.duration",
      "parameters.duration",
    ]),
    imageCount: firstPositive(flat, ["n"]) ?? 1,
    qualifiers: requestQualifiers(flat),
  };
  const selected = selectEntries(entries, context);
  const costs = selected
    .map((entry) => costFor(entry, context))
    .filter((value) => value !== null && Number.isFinite(value));

  if (costs.length === 0) {
    return {
      status: "unknown",
      currency: "USD",
      min: null,
      max: null,
      priceLabel,
      note: entries.some((entry) => entry.basis === "per-second")
        ? "缺少可用于估算的时长"
        : "当前参数无法匹配公开单价",
    };
  }

  const min = Math.min(...costs);
  const max = Math.max(...costs);
  return {
    status: min === max ? "exact" : "range",
    currency: "USD",
    min,
    max,
    priceLabel,
    note: min === max ? "按当前参数估算" : "参数未锁定到单一价格档位",
  };
}

export function summarizeBudget(estimates) {
  const list = Array.isArray(estimates) ? estimates : [];
  const known = list.filter(
    (item) => Number.isFinite(item?.min) && Number.isFinite(item?.max),
  );
  const unknownCount = list.length - known.length;
  return {
    status:
      unknownCount > 0
        ? known.length > 0
          ? "partial"
          : "unknown"
        : known.some((item) => item.status === "range")
          ? "range"
          : "exact",
    currency: "USD",
    min: known.reduce((sum, item) => sum + item.min, 0),
    max: known.reduce((sum, item) => sum + item.max, 0),
    unknownCount,
  };
}

export function formatUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(4)}` : "待确认";
}
