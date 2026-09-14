import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MODE_PRIVATE = 0o600;
const MEDIA_SOURCES = new Set(["env", "file"]);
const CLIENT_SOURCES = new Set(["codex", "claude"]);
const ALL_SOURCES = new Set(["env", "file", "codex", "claude"]);

export class CredentialConflictError extends Error {
  constructor(sources, { hint } = {}) {
    const list = sources.join(", ");
    const guidance =
      hint ??
      "Media tasks use env > file only. Save one canonical key with save-api-key.mjs, or pass KAIYUN_API_KEY for this run. Codex/Claude credentials are ignored when env or file is present.";
    super(`Conflicting KaiyunCode credentials were found in: ${list}. ${guidance}`);
    this.name = "CredentialConflictError";
    this.sources = sources;
  }
}

export class CredentialNotFoundError extends Error {
  constructor(source) {
    super(
      source
        ? `No KaiyunCode API Key was found in source: ${source}`
        : "No KaiyunCode API Key was found. Paste a key in chat and save with save-api-key.mjs, or set KAIYUN_API_KEY.",
    );
    this.name = "CredentialNotFoundError";
    this.source = source ?? null;
  }
}

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
  kaiyunHome = process.env.KAIYUN_HOME ?? join(homedir(), ".config", "kaiyuncode"),
) {
  return join(kaiyunHome, "credentials.env");
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
 * Persist the canonical KaiyunCode API Key for image/video workflows.
 * Does not modify Codex or Claude Code client configuration.
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
  if (
    typeof baseUrl !== "string" ||
    !/^https:\/\/kaiyuncode\.com\/v1\/?$/u.test(baseUrl.trim())
  ) {
    throw new Error("baseUrl must be https://kaiyuncode.com/v1");
  }
  const normalizedBase = baseUrl.trim().replace(/\/$/u, "");
  await mkdir(dirname(path), { recursive: true });
  const body = [
    "# KaiyunCode canonical media credentials (image / video).",
    "# This file is the default authority for media tasks.",
    "# Codex / Claude Code are separate; sync them only via configure-agents when asked.",
    `KAIYUN_API_KEY=${key}`,
    `KAIYUN_BASE_URL=${normalizedBase}`,
    "",
  ].join("\n");
  await writeFile(path, body, { mode: MODE_PRIVATE });
  await chmod(path, MODE_PRIVATE);
  return { path, source: "file" };
}

async function discoverClientSources({ codexHome, claudeHome, preferSource }) {
  const discovered = [];
  if (!preferSource || preferSource === "codex") {
    const codexConfig = await readOptional(join(codexHome, "config.toml"));
    if (isKaiyunBaseUrl(activeCodexBaseUrl(codexConfig), { codex: true })) {
      const codexAuth = await readJsonOptional(join(codexHome, "auth.json"));
      const codexKey = nonemptyString(codexAuth?.OPENAI_API_KEY);
      if (codexKey) discovered.push({ source: "codex", apiKey: codexKey });
    }
  }
  if (!preferSource || preferSource === "claude") {
    const claudeSettings = await readJsonOptional(
      join(claudeHome, "settings.json"),
    );
    if (isKaiyunBaseUrl(claudeSettings?.env?.ANTHROPIC_BASE_URL)) {
      const claudeKey = nonemptyString(
        claudeSettings?.env?.ANTHROPIC_AUTH_TOKEN,
      );
      if (claudeKey) discovered.push({ source: "claude", apiKey: claudeKey });
    }
  }
  return discovered;
}

/**
 * Resolve the API Key for media (image/video) tasks.
 *
 * Default authority model:
 * 1. Explicit preferSource / --credential-source when provided
 * 2. env (session override via KAIYUN_API_KEY)
 * 3. file (~/.config/kaiyuncode/credentials.env, then legacy Codex media files)
 * 4. Optional client fallback (codex then claude) only when env and file are absent
 *
 * Codex/Claude keys are never mixed with env/file. Different client keys only
 * conflict when both are used as the sole fallback path.
 */
export async function resolveCredential({
  env = process.env,
  home = homedir(),
  codexHome = env.CODEX_HOME ?? join(home, ".codex"),
  claudeHome = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
  credentialFile = getDefaultCredentialFilePath(env.KAIYUN_HOME ?? join(home, ".config", "kaiyuncode")),
  oldCredentialFile = join(codexHome, "kaiyun-tools.env"),
  legacyCredentialFile = getLegacyCredentialFilePath(codexHome),
  preferSource,
  allowClientFallback = true,
} = {}) {
  if (preferSource !== undefined && !ALL_SOURCES.has(preferSource)) {
    throw new Error(
      `Invalid credential source: ${preferSource}. Use env, file, codex, or claude.`,
    );
  }

  // Resolve lazily: a valid media key must not depend on another agent's config.
  if (!preferSource || preferSource === "env") {
    const apiKey = nonemptyString(env?.KAIYUN_API_KEY);
    if (apiKey) return { apiKey, source: "env" };
    if (preferSource) throw new CredentialNotFoundError(preferSource);
  }
  if (!preferSource || preferSource === "file") {
    for (const path of new Set([credentialFile, oldCredentialFile, legacyCredentialFile])) {
      const apiKey = await readApiKeyFile(path);
      if (apiKey) return { apiKey, source: "file", path };
    }
    if (preferSource) throw new CredentialNotFoundError(preferSource);
  }
  if (CLIENT_SOURCES.has(preferSource)) {
    const [chosen] = await discoverClientSources({ codexHome, claudeHome, preferSource });
    if (!chosen) throw new CredentialNotFoundError(preferSource);
    return chosen;
  }

  if (!allowClientFallback) {
    throw new CredentialNotFoundError();
  }

  const clients = await discoverClientSources({ codexHome, claudeHome });
  if (clients.length === 0) throw new CredentialNotFoundError();

  const uniqueKeys = new Set(clients.map(({ apiKey }) => apiKey));
  if (uniqueKeys.size > 1) {
    throw new CredentialConflictError(clients.map(({ source }) => source), {
      hint: "No media env/file key was found, and Codex vs Claude KaiyunCode keys differ. Save one canonical key with save-api-key.mjs (recommended), or pass --credential-source codex|claude.",
    });
  }
  return { apiKey: clients[0].apiKey, source: clients[0].source };
}

export function describeCredentialSource(credential) {
  if (!credential?.source) return "unknown";
  if (credential.source === "file" && credential.path) {
    return `file ${credential.path}`;
  }
  if (credential.source === "env") return "env KAIYUN_API_KEY";
  return credential.source;
}

export { MEDIA_SOURCES, CLIENT_SOURCES, ALL_SOURCES };
