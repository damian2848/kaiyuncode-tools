#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  getDefaultCredentialFilePath,
  saveApiKeyFile,
} from "../../../shared/credentials.mjs";
import { redactSensitive } from "../../../shared/redaction.mjs";

function safeErrorMessage(value, apiKey) {
  const raw = value instanceof Error ? value.message : String(value ?? "unknown error");
  const withoutKey = apiKey ? raw.split(apiKey).join("[REDACTED]") : raw;
  return String(redactSensitive(withoutKey));
}

async function readApiKeyFromStdin(input = process.stdin) {
  const chunks = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const apiKey = text.split(/\r?\n/u)[0]?.trim() ?? "";
  if (!apiKey) throw new Error("No API Key received on stdin");
  return apiKey;
}

async function resolveApiKeyInput({ env = process.env, input = process.stdin } = {}) {
  const fromEnv = typeof env?.KAIYUN_API_KEY === "string" ? env.KAIYUN_API_KEY.trim() : "";
  if (fromEnv) return fromEnv;
  if (input?.isTTY) {
    throw new Error("Pass the API Key via KAIYUN_API_KEY or stdin pipe from the chat paste");
  }
  return readApiKeyFromStdin(input);
}

async function main() {
  for (const argument of process.argv.slice(2)) {
    if (argument === "--api-key" || argument.startsWith("--api-key=")) {
      throw new Error("API Key must not be supplied as a command-line argument");
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  const apiKey = await resolveApiKeyInput();
  try {
    const result = await saveApiKeyFile(apiKey);
    process.stdout.write(
      `${JSON.stringify(
        {
          saved: true,
          source: result.source,
          path: result.path,
          defaultPath: getDefaultCredentialFilePath(),
          note: "Media credentials only. Codex / Claude Code were not modified.",
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(`${safeErrorMessage(error, apiKey)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
