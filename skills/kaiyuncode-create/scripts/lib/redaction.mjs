const REDACTED = "[REDACTED]";
const SENSITIVE_LABEL_SUFFIXES = [
  "authorization",
  "api_key",
  "auth_token",
  "access_token",
  "password",
  "secret",
  "signature",
];
const BASE64_KEY = /(?:b64|base64)/i;
const SENSITIVE_QUERY_KEY =
  /(?:token|key|auth|signature|credential|password|secret|expires)/i;
const SIGNED_URL_QUERY_KEY =
  /^(?:sig|signature|policy|key-?pair-?id|expires|x-amz-.+|x-goog-.+)$/iu;

function normalizeSensitiveLabel(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
}

function isSensitiveLabel(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const normalized = normalizeSensitiveLabel(value);
  return SENSITIVE_LABEL_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`_${suffix}`),
  );
}

function redactUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return value;
  url.username = "";
  url.password = "";
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key) || SIGNED_URL_QUERY_KEY.test(key)) {
      url.searchParams.set(key, REDACTED);
    }
  }
  const sanitized = url.toString();
  return sanitized.length > 512
    ? `${sanitized.slice(0, 256)}...[TRUNCATED URL]`
    : sanitized;
}

function redactInlineUrls(value) {
  return value.replace(/https?:\/\/[^\s<>"']+/giu, (match) => {
    const suffix = match.match(/[),.;!?]+$/u)?.[0] ?? "";
    const url = suffix ? match.slice(0, -suffix.length) : match;
    return `${redactUrl(url)}${suffix}`;
  });
}

function redactString(value, key = "") {
  if (
    BASE64_KEY.test(key) ||
    value.startsWith("data:") ||
    (value.length >= 256 &&
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/u.test(value))
  ) {
    return "[REDACTED BASE64]";
  }
  const withoutUrls = redactInlineUrls(value);
  const withoutDoubleQuotedLabels = withoutUrls.replace(
    /(?<![?&\w.-])("?)([A-Za-z][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)"(?:\\.|[^"\\])*"/giu,
    (match, quote, label, separator) =>
      isSensitiveLabel(label)
        ? `${quote}${label}${quote}${separator}"${REDACTED}"`
        : match,
  );
  const withoutQuotedLabels = withoutDoubleQuotedLabels.replace(
    /(?<![?&\w.-])('?)([A-Za-z][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)'(?:\\.|[^'\\])*'/giu,
    (match, quote, label, separator) =>
      isSensitiveLabel(label)
        ? `${quote}${label}${quote}${separator}'${REDACTED}'`
        : match,
  );
  const withoutLabels = withoutQuotedLabels.replace(
    /(?<![?&\w.-])(["']?)([A-Za-z][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;"']+/giu,
    (match, quote, label, separator) =>
      isSensitiveLabel(label)
        ? `${quote}${label}${quote}${separator}${REDACTED}`
        : match,
  );
  return withoutLabels.replace(
    /\bBearer\s+[^\s,;"']+/gi,
    "Bearer [REDACTED]",
  );
}

function binarySummary(value) {
  const name = typeof value.name === "string" ? value.name : undefined;
  return {
    type: name ? "File" : "Blob",
    ...(name ? { name } : {}),
    size: value.size,
  };
}

function redact(value, key, seen) {
  if (isSensitiveLabel(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value, key);
  if (["number", "boolean", "bigint"].includes(typeof value)) return value;
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return binarySummary(value);
  }
  if (value instanceof URL) return redactUrl(value.toString());
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return {
      type: "FormData",
      fields: [...value.entries()].map(([name, fieldValue]) => ({
        name,
        value: redact(fieldValue, name, seen),
      })),
    };
  }
  if (value instanceof Error) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const result = {
      name: value.name,
      message: redactString(value.message),
      ...(Object.hasOwn(value, "cause")
        ? { cause: redact(value.cause, "cause", seen) }
        : {}),
    };
    seen.delete(value);
    return result;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => redact(item, key, seen));
    seen.delete(value);
    return result;
  }
  const result = Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redact(entryValue, entryKey, seen),
    ]),
  );
  seen.delete(value);
  return result;
}

export function redactSensitive(value) {
  return redact(value, "", new WeakSet());
}
