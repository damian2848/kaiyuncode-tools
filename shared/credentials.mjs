import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export class CredentialConflictError extends Error {
  constructor(sources) {
    super(
      `Conflicting KaiyunCode credentials were found in: ${sources.join(", ")}`,
    );
    this.name = "CredentialConflictError";
    this.sources = sources;
  }
}

export class CredentialNotFoundError extends Error {
  constructor() {
    super("No KaiyunCode API Key was found");
    this.name = "CredentialNotFoundError";
  }
}

const MODE_PRIVATE = 0o600;

function isKaiyunBaseUrl(value, { codex = false } = {}) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "kaiyuncode.com" &&
      (url.port === "" || url.port === "443") &&
      url.username === "" &&
      url.password === "" &&
      (codex ? url.pathname === "/v1" || url.pathname === "/v1/" : url.pathname === "/") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to read credential configuration at ${path}`);
  }
}

async function readJsonOptional(path) {
  const source = await readOptional(path);
  if (source === null) return null;
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`Invalid JSON credential configuration at ${path}`);
  }
}

function stripTomlComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\") {
      index += 1;
    } else if (quote && character === quote) {
      quote = null;
    } else if (!quote && (character === '"' || character === "'")) {
      quote = character;
    } else if (!quote && character === "#") {
      return line.slice(0, index);
    }
  }
  return line;
}

function unquoteTomlString(value) {
  const match = value.trim().match(/^(["'])(.*)\1$/);
  return match?.[2] ?? null;
}

function activeCodexBaseUrl(source) {
  if (typeof source !== "string") return null;
  let section = "";
  let activeProvider = null;
  const providers = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[\s*model_providers\.([A-Za-z0-9_-]+)\s*\]$/);
    if (sectionMatch) {
      section = `model_providers.${sectionMatch[1]}`;
      continue;
    }
    if (/^\[.*\]$/.test(line)) {
      section = line;
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    const value = unquoteTomlString(rawValue);
    if (section === "" && key === "model_provider") activeProvider = value;
    if (section.startsWith("model_providers.") && key === "base_url") {
      providers.set(section.slice("model_providers.".length), value);
    }
  }
  return activeProvider ? providers.get(activeProvider) ?? null : null;
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function getDefaultCredentialFilePath(
  codexHome = join(homedir(), ".codex"),
) {
  return join(codexHome, "kaiyun-tools.env");
}

export function getLegacyCredentialFilePath(
  codexHome = join(homedir(), ".codex"),
) {
  return join(codexHome, "kaiyun-video.env");
}

function parseEnvApiKey(source) {
  if (typeof source !== "string" || source.length === 0) return null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?KAIYUN_API_KEY\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return nonemptyString(value);
  }
  return null;
}

export async function readApiKeyFile(path) {
  const source = await readOptional(path);
  if (source === null) return null;
  return parseEnvApiKey(source);
}

/**
 * Persist a KaiyunCode API Key for image/video workflows without modifying
 * Codex or Claude Code client configuration.
 */
export async function saveApiKeyFile(
  apiKey,
  {
    path = getDefaultCredentialFilePath(),
    baseUrl = "https://kaiyuncode.com/v1",
  } = {},
) {
  const key = nonemptyString(apiKey);
  if (!key || /[\u0000\r\n]/u.test(key)) {
    throw new Error("A valid KaiyunCode API Key is required");
  }
  if (typeof baseUrl !== "string" || !/^https:\/\/kaiyuncode\.com\/v1\/?$/u.test(baseUrl.trim())) {
    throw new Error("baseUrl must be https://kaiyuncode.com/v1");
  }
  const normalizedBase = baseUrl.trim().replace(/\/$/u, "");
  await mkdir(dirname(path), { recursive: true });
  const body = [
    "# KaiyunCode media credentials (image / video).",
    "# This file does NOT reconfigure Codex or Claude Code text models.",
    `KAIYUN_API_KEY=${key}`,
    `KAIYUN_BASE_URL=${normalizedBase}`,
    "",
  ].join("\n");
  await writeFile(path, body, { mode: MODE_PRIVATE });
  await chmod(path, MODE_PRIVATE);
  return { path, source: "file" };
}

export async function resolveCredential({
  env = process.env,
  codexHome = join(homedir(), ".codex"),
  claudeHome = join(homedir(), ".claude"),
  credentialFile = getDefaultCredentialFilePath(codexHome),
  legacyCredentialFile = getLegacyCredentialFilePath(codexHome),
} = {}) {
  const discovered = [];
  const envKey = nonemptyString(env?.KAIYUN_API_KEY);
  if (envKey) discovered.push({ source: "env", apiKey: envKey });

  const fileKey =
    (await readApiKeyFile(credentialFile)) ??
    (await readApiKeyFile(legacyCredentialFile));
  if (fileKey) discovered.push({ source: "file", apiKey: fileKey });

  const codexConfig = await readOptional(join(codexHome, "config.toml"));
  if (isKaiyunBaseUrl(activeCodexBaseUrl(codexConfig), { codex: true })) {
    const codexAuth = await readJsonOptional(join(codexHome, "auth.json"));
    const codexKey = nonemptyString(codexAuth?.OPENAI_API_KEY);
    if (codexKey) discovered.push({ source: "codex", apiKey: codexKey });
  }

  const claudeSettings = await readJsonOptional(
    join(claudeHome, "settings.json"),
  );
  if (isKaiyunBaseUrl(claudeSettings?.env?.ANTHROPIC_BASE_URL)) {
    const claudeKey = nonemptyString(
      claudeSettings?.env?.ANTHROPIC_AUTH_TOKEN,
    );
    if (claudeKey) discovered.push({ source: "claude", apiKey: claudeKey });
  }

  if (discovered.length === 0) throw new CredentialNotFoundError();
  if (new Set(discovered.map(({ apiKey }) => apiKey)).size > 1) {
    throw new CredentialConflictError(discovered.map(({ source }) => source));
  }
  return discovered[0];
}
