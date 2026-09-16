#!/usr/bin/env node
import { isMainModule } from "../shared/entrypoint.mjs";

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  getDefaultCredentialFilePath,
  saveApiKeyFile,
} from "../shared/credentials.mjs";
import { buildCodexModelCatalog, modelIsExplicitlyNonText } from "../shared/codex-model-catalog.mjs";
import { redactSensitive } from "../shared/redaction.mjs";
import { mergeClaudeSettings, mergeCodexConfig } from "../shared/toml-edit.mjs";

const MODE_PRIVATE = 0o600;
const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";
const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";
const MODELS_URL = "https://kaiyuncode.com/v1/models";
const CREDENTIAL_ENV_NAMES = new Set([
  "KAIYUN_API_KEY",
  "KAIYUNCODE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
]);
const FLAG_NAMES = new Map([
  ["--codex-model", "codexModel"],
  ["--model-capabilities", "modelCapabilitiesFile"],
  ["--claude-model", "claudeModel"],
  ["--claude-opus-model", "claudeOpusModel"],
  ["--claude-sonnet-model", "claudeSonnetModel"],
  ["--claude-haiku-model", "claudeHaikuModel"],
]);

function safeErrorMessage(value, apiKey) {
  const raw = value instanceof Error ? value.message : String(value ?? "unknown error");
  const withoutKey = apiKey ? raw.split(apiKey).join("[REDACTED]") : raw;
  return String(redactSensitive(withoutKey));
}

function assertSecret(apiKey) {
  if (typeof apiKey !== "string" || apiKey.trim() !== apiKey || apiKey.length === 0 || /[\r\n\u0000]/u.test(apiKey)) {
    throw new Error("A valid KaiyunCode API Key is required");
  }
}

async function validateCredential(apiKey, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`KaiyunCode API Key validation failed: ${safeErrorMessage(error, apiKey)}`);
  }
  if (response.ok) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("KaiyunCode model response is malformed JSON");
    }
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) {
      throw new Error("KaiyunCode model response is malformed: data must be an array");
    }
    const models = new Map();
    for (const item of payload.data) {
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || item.id.length === 0) {
        throw new Error("KaiyunCode model response is malformed: every model needs an id");
      }
      models.set(item.id, item);
    }
    return models;
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("KaiyunCode authentication failed; check or recreate the API Key");
  }
  if (response.status === 402) {
    throw new Error("KaiyunCode balance is insufficient; recharge at https://kaiyuncode.com/pricing");
  }
  throw new Error(`KaiyunCode API Key validation returned HTTP ${response.status}`);
}

function validateSelectedModels(models, selections) {
  for (const [label, modelId] of selections) {
    const metadata = models.get(modelId);
    if (!metadata) throw new Error(`${label} model ${modelId} is unavailable for this KaiyunCode account`);
    if (modelIsExplicitlyNonText(metadata)) {
      throw new Error(`${label} model ${modelId} is not available as a text model`);
    }
  }
}

function pathInside(base, target) {
  const pathFromBase = relative(resolve(base), resolve(target));
  return pathFromBase === "" || (!pathFromBase.startsWith("..") && !isAbsolute(pathFromBase));
}

async function assertExistingLexicalChainHasNoSymlinks(fsImpl, path) {
  const absolute = resolve(path);
  const filesystemRoot = parse(absolute).root;
  let lexical = filesystemRoot;
  const components = relative(filesystemRoot, absolute).split(/[\\/]/u).filter(Boolean);
  for (const component of components) {
    lexical = join(lexical, component);
    try {
      const metadata = await fsImpl.lstat(lexical);
      if (metadata.isSymbolicLink()) throw new Error(`Unsafe path: symbolic link ${lexical}`);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

async function existingDirectoryAnchor(fsImpl, path) {
  let candidate = resolve(path);
  for (;;) {
    try {
      const metadata = await fsImpl.lstat(candidate);
      if (metadata.isSymbolicLink()) throw new Error(`Unsafe path: symbolic link ${candidate}`);
      if (!metadata.isDirectory()) throw new Error(`Unsafe path: non-directory ancestor ${candidate}`);
      return { path: candidate, realPath: await fsImpl.realpath(candidate) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw new Error(`Unsafe path: no directory ancestor for ${path}`);
      candidate = parent;
    }
  }
}

async function preflightTarget(fsImpl, homePath, targetPath) {
  const home = resolve(homePath);
  const target = resolve(targetPath);
  if (!pathInside(home, target) || home === target) {
    throw new Error(`Unsafe path: configuration target must be inside ${home}`);
  }
  await assertExistingLexicalChainHasNoSymlinks(fsImpl, home);
  await assertExistingLexicalChainHasNoSymlinks(fsImpl, target);
  const anchor = await existingDirectoryAnchor(fsImpl, home);
  const homeFromAnchor = relative(anchor.path, home);
  if (homeFromAnchor.startsWith("..") || isAbsolute(homeFromAnchor)) {
    throw new Error(`Unsafe path: invalid home directory ${home}`);
  }
  const components = [...homeFromAnchor.split(/[\\/]/u).filter(Boolean), ...relative(home, target).split(/[\\/]/u).filter(Boolean)];
  let lexical = anchor.path;
  let canonical = anchor.realPath;
  let missing = false;
  for (let index = 0; index < components.length; index += 1) {
    lexical = join(lexical, components[index]);
    canonical = join(canonical, components[index]);
    const targetEntry = index === components.length - 1;
    try {
      const metadata = await fsImpl.lstat(lexical);
      if (missing) throw new Error(`Unsafe path: existing entry below a missing ancestor ${lexical}`);
      if (metadata.isSymbolicLink()) throw new Error(`Unsafe path: symbolic link ${lexical}`);
      if (targetEntry ? !metadata.isFile() : !metadata.isDirectory()) {
        throw new Error(`Unsafe path: ${targetEntry ? "configuration target is not a regular file" : "non-directory ancestor"} ${lexical}`);
      }
      const actual = await fsImpl.realpath(lexical);
      if (resolve(actual) !== resolve(canonical)) throw new Error(`Unsafe path: resolved path mismatch at ${lexical}`);
    } catch (error) {
      if (error?.code === "ENOENT") missing = true;
      else throw error;
    }
  }
}

async function preflightConfigurationPaths(fsImpl, paths) {
  await preflightTarget(fsImpl, paths.codexHome, paths.codexConfig);
  await preflightTarget(fsImpl, paths.codexHome, paths.codexAuth);
  await preflightTarget(fsImpl, paths.codexHome, paths.codexCatalog);
  if (!paths.codexOnly) await preflightTarget(fsImpl, paths.claudeHome, paths.claudeSettings);
}

function sanitizedProcessEnvironment(environment, apiKey, codexHome) {
  const safe = {};
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (CREDENTIAL_ENV_NAMES.has(name) || value === apiKey) continue;
    safe[name] = value;
  }
  safe.CODEX_HOME = codexHome;
  return safe;
}

async function snapshotFile(fsImpl, path) {
  try {
    const [content, metadata] = await Promise.all([
      fsImpl.readFile(path),
      fsImpl.stat(path),
    ]);
    return { path, exists: true, content, mode: metadata.mode & 0o777 };
  } catch (error) {
    if (error?.code === "ENOENT") return { path, exists: false, content: null, mode: null };
    throw error;
  }
}

async function atomicWrite(fsImpl, path, content, mode = MODE_PRIVATE) {
  const temporary = join(dirname(path), `.${basename(path)}.kaiyuncode-${process.pid}-${randomUUID()}.tmp`);
  try {
    await fsImpl.writeFile(temporary, content, { flag: "wx", mode });
    await fsImpl.chmod(temporary, mode);
    await fsImpl.rename(temporary, path);
  } catch (error) {
    await fsImpl.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function restoreSnapshots(fsImpl, snapshots) {
  const failures = [];
  for (const snapshot of snapshots) {
    try {
      if (snapshot.exists) {
        await atomicWrite(fsImpl, snapshot.path, snapshot.content, snapshot.mode);
        await fsImpl.chmod(snapshot.path, snapshot.mode);
      } else {
        await fsImpl.rm(snapshot.path, { force: true });
      }
    } catch (error) {
      failures.push(`${snapshot.path}: ${error.message}`);
    }
  }
  if (failures.length > 0) throw new Error(`rollback failed for ${failures.join(", ")}`);
}

function backupTimestamp(now) {
  return now.toISOString().replace(/[-:.]/gu, "");
}

async function createBackups(fsImpl, snapshots, now) {
  const backups = [];
  const timestamp = backupTimestamp(now);
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const backupPath = `${snapshot.path}.bak.${timestamp}`;
    await atomicWrite(fsImpl, backupPath, snapshot.content, MODE_PRIVATE);
    backups.push({ path: snapshot.path, backupPath });
  }
  return backups;
}

export async function runProcess(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.stdin.on("error", () => {});
    child.once("error", rejectRun);
    child.once("close", (code, signal) => resolveRun({
      status: code ?? 1,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
    child.stdin.end(options.input);
  });
}

export async function configureAgents(options = {}) {
  const {
    apiKey,
    dryRun = false,
    codexOnly = false,
    codexModel = DEFAULT_CODEX_MODEL,
    claudeModel = DEFAULT_CLAUDE_MODEL,
    claudeOpusModel = claudeModel,
    claudeSonnetModel = claudeModel,
    claudeHaikuModel = claudeModel,
    fsImpl = fs,
    fetchImpl = globalThis.fetch,
    spawnImpl = runProcess,
    now = () => new Date(),
  } = options;
  const home = options.home ?? homedir();
  const codexHome = resolve(options.codexHome ?? (options.environment ?? process.env).CODEX_HOME ?? join(home, ".codex"));
  const codexCatalog = join(codexHome, "kaiyuncode-model-catalog.json");
  const claudeHome = options.claudeHome ?? join(home, ".claude");
  const codexConfig = options.codexConfig ?? join(codexHome, "config.toml");
  const codexAuth = options.codexAuth ?? join(codexHome, "auth.json");
  const claudeSettings = options.claudeSettings ?? join(claudeHome, "settings.json");

  assertSecret(apiKey);
  const availableModels = await validateCredential(apiKey, fetchImpl);
  validateSelectedModels(availableModels, [
    ["Codex", codexModel],
    ...(!codexOnly ? [
      ["Claude main", claudeModel],
      ["Claude Opus", claudeOpusModel],
      ["Claude Sonnet", claudeSonnetModel],
      ["Claude Haiku", claudeHaikuModel],
    ] : []),
  ]);
  const capabilities = options.modelCapabilitiesFile
    ? JSON.parse(await fsImpl.readFile(options.modelCapabilitiesFile, "utf8"))
    : options.modelCapabilities ?? {};
  const { catalog, warnings } = buildCodexModelCatalog(availableModels, { capabilities, preferredModel: codexModel });
  await preflightConfigurationPaths(fsImpl, { codexHome, claudeHome, codexConfig, codexAuth, claudeSettings, codexCatalog, codexOnly });

  const snapshots = await Promise.all([
    snapshotFile(fsImpl, codexConfig),
    snapshotFile(fsImpl, codexAuth),
    ...(codexOnly ? [] : [snapshotFile(fsImpl, claudeSettings)]),
    snapshotFile(fsImpl, codexCatalog),
  ]);
  const codexSource = snapshots[0].exists ? snapshots[0].content.toString("utf8") : "";
  const claudeSource = !codexOnly && snapshots[2].exists ? snapshots[2].content.toString("utf8") : "{}";
  const nextCodex = mergeCodexConfig(codexSource, { model: codexModel, catalogPath: codexCatalog });
  const nextClaude = codexOnly ? null : mergeClaudeSettings(claudeSource, {
    apiKey,
    model: claudeModel,
    opusModel: claudeOpusModel,
    sonnetModel: claudeSonnetModel,
    haikuModel: claudeHaikuModel,
  });

  const mediaCredentialPath =
    options.mediaCredentialPath ?? getDefaultCredentialFilePath((options.environment ?? process.env).KAIYUN_HOME ?? join(home, ".config", "kaiyuncode"));
  const preview = {
    mediaCredential: {
      path: mediaCredentialPath,
      note: "Canonical image/video key file (same API Key)",
    },
    codex: { provider: "kaiyuncode", model: codexModel, baseUrl: "https://kaiyuncode.com/v1", catalogPath: codexCatalog, modelCount: catalog.models.length, catalog, warnings },
    claude: codexOnly ? null : {
      model: claudeModel,
      opusModel: claudeOpusModel,
      sonnetModel: claudeSonnetModel,
      haikuModel: claudeHaikuModel,
      baseUrl: "https://kaiyuncode.com",
      authToken: "[REDACTED]",
    },
  };
  if (dryRun) return { backups: [], codexModel, claudeModel: codexOnly ? null : claudeModel, preview };

  let backups = [];
  try {
    await fsImpl.mkdir(codexHome, { recursive: true, mode: 0o700 });
    if (!codexOnly) await fsImpl.mkdir(claudeHome, { recursive: true, mode: 0o700 });
    backups = await createBackups(fsImpl, snapshots, now());
    await atomicWrite(fsImpl, codexCatalog, `${JSON.stringify(catalog, null, 2)}\n`, MODE_PRIVATE);
    await atomicWrite(fsImpl, codexConfig, nextCodex, MODE_PRIVATE);
    if (!codexOnly) await atomicWrite(fsImpl, claudeSettings, `${JSON.stringify(nextClaude, null, 2)}\n`, MODE_PRIVATE);
    await saveApiKeyFile(apiKey, { path: mediaCredentialPath });

    const processEnv = sanitizedProcessEnvironment(options.environment ?? process.env, apiKey, codexHome);
    const login = await spawnImpl("codex", ["login", "--with-api-key"], {
      input: `${apiKey}\n`,
      env: processEnv,
    });
    if (login.status !== 0) throw new Error(login.stderr || "codex login failed");

    await fsImpl.chmod(codexAuth, MODE_PRIVATE);
    const strict = await spawnImpl("codex", ["--strict-config", "--version"], { env: processEnv });
    if (strict.status !== 0) throw new Error(strict.stderr || "Codex strict configuration validation failed");

    if (!codexOnly) {
      const reparsedClaude = JSON.parse(await fsImpl.readFile(claudeSettings, "utf8"));
      if (!reparsedClaude || typeof reparsedClaude !== "object" || Array.isArray(reparsedClaude)) {
        throw new Error("Claude settings validation failed");
      }
    }
    await Promise.all([
      fsImpl.chmod(codexConfig, MODE_PRIVATE),
      fsImpl.chmod(codexAuth, MODE_PRIVATE),
      ...(codexOnly ? [] : [fsImpl.chmod(claudeSettings, MODE_PRIVATE)]),
      fsImpl.chmod(codexCatalog, MODE_PRIVATE),
    ]);
    return { backups, codexModel, claudeModel: codexOnly ? null : claudeModel, preview };
  } catch (error) {
    let rollbackError;
    try {
      await restoreSnapshots(fsImpl, snapshots);
    } catch (failure) {
      rollbackError = failure;
    }
    const message = safeErrorMessage(error, apiKey);
    const rollbackMessage = rollbackError ? `; ${safeErrorMessage(rollbackError, apiKey)}` : "";
    throw new Error(`${message}${rollbackMessage}`);
  }
}

export function parseCliArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run" || argument === "--codex-only") {
      result[argument === "--dry-run" ? "dryRun" : "codexOnly"] = true;
      continue;
    }
    if (argument === "--api-key" || argument.startsWith("--api-key=")) {
      throw new Error("API Key must not be supplied as a command-line argument");
    }
    const equals = argument.indexOf("=");
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    const property = FLAG_NAMES.get(flag);
    if (!property) throw new Error(`Unknown option: ${flag}`);
    const value = equals === -1 ? args[++index] : argument.slice(equals + 1);
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    result[property] = value;
  }
  return result;
}

export async function readHiddenApiKey({ input = process.stdin, output = process.stderr } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("KAIYUN_API_KEY is not set and hidden input requires an interactive TTY");
  }
  output.write("KaiyunCode API Key: ");
  input.setEncoding("utf8");
  input.setRawMode(true);
  input.resume();
  return new Promise((resolveInput, rejectInput) => {
    let secret = "";
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      input.off("data", onData);
      input.off("error", onError);
      input.off("end", onEnd);
      try { input.setRawMode(false); } catch {}
      input.pause();
      output.write("\n");
      if (error) rejectInput(error);
      else resolveInput(secret);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("Input cancelled"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") secret = secret.slice(0, -1);
        else secret += character;
      }
    };
    const onError = (error) => finish(error);
    const onEnd = () => finish(new Error("Input ended before an API Key was submitted"));
    input.on("data", onData);
    input.once("error", onError);
    input.once("end", onEnd);
  });
}

/** Read a single-line API Key from a non-TTY stdin pipe (chat-paste → agent → pipe). */
export async function readApiKeyFromStdin({ input = process.stdin } = {}) {
  const chunks = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const apiKey = text.split(/\r?\n/u)[0]?.trim() ?? "";
  if (!apiKey) {
    throw new Error("No API Key received on stdin");
  }
  if (/[\u0000]/u.test(apiKey)) {
    throw new Error("A valid KaiyunCode API Key is required");
  }
  return apiKey;
}

/**
 * Resolve API Key without requiring a multi-step interactive ceremony.
 * Priority: KAIYUN_API_KEY env → non-TTY stdin pipe → hidden TTY prompt.
 * Never accept --api-key argv (shell history).
 */
export async function resolveApiKeyInput({
  env = process.env,
  input = process.stdin,
  output = process.stderr,
} = {}) {
  const fromEnv = typeof env?.KAIYUN_API_KEY === "string" ? env.KAIYUN_API_KEY.trim() : "";
  if (fromEnv) return fromEnv;
  if (input?.isTTY) return readHiddenApiKey({ input, output });
  return readApiKeyFromStdin({ input });
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const apiKey = await resolveApiKeyInput();
  const result = await configureAgents({ ...cli, apiKey });
  const summary = cli.dryRun
    ? { dryRun: true, changes: result.preview }
    : { configured: true, codexModel: result.codexModel, claudeModel: result.claudeModel, backups: result.backups, catalogPath: result.preview.codex.catalogPath, modelCount: result.preview.codex.modelCount, warnings: result.preview.codex.warnings };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
