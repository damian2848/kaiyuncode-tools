#!/usr/bin/env node
import { isMainModule } from "../shared/entrypoint.mjs";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BUNDLES, ROOT, buildSkills } from "./build-skills.mjs";

const OWNER = "damian2848/kaiyuncode-tools";
const RECEIPT = ".kaiyuncode-install.json";
export const AGENTS = ["codex", "claude", "grok", "openclaw", "hermes"];
const HELP = `KaiyunCode universal skills installer (Node.js 20+)
Usage: node scripts/install.mjs [options]
  --agent NAME       codex, claude, grok, openclaw, hermes (alias: hermess),
                     universal (default), or all; repeat to select multiple
  --skills-dir PATH  Install into a custom skill root instead of agent defaults
  --skill NAME       Install one skill; repeat to select several (default: all four)
  --dry-run          Validate and print destinations without writing files
  --help             Show this help

Re-run the same command to update. Locally modified or unowned skills are never overwritten.
Only skill files are installed; provider settings and credentials are not changed.
`;

export function parseArgs(argv) {
  const options = { agents: [], skills: [], dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (["--agent", "--skill", "--skills-dir"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--agent") options.agents.push(value);
      if (arg === "--skill") options.skills.push(value);
      if (arg === "--skills-dir") {
        if (options.skillsDir) throw new Error("Use --skills-dir once.");
        options.skillsDir = value;
      }
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.skillsDir && options.agents.length) throw new Error("Use --agent or --skills-dir, not both.");
  return options;
}

export function destinations(options, { home = homedir(), env = process.env } = {}) {
  if (options.skillsDir) return [resolve(options.skillsDir)];
  const paths = {
    universal: join(home, ".agents", "skills"),
    codex: join(home, ".agents", "skills"),
    claude: join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "skills"),
    grok: join(home, ".grok", "skills"),
    openclaw: join(env.OPENCLAW_STATE_DIR ?? join(home, ".openclaw"), "skills"),
    hermes: join(env.HERMES_HOME ?? join(home, ".hermes"), "skills"),
  };
  const agents = options.agents?.length ? options.agents : ["universal"];
  return [...new Set(agents.flatMap((name) => name === "all" ? AGENTS : [name])
    .map((name) => {
      const path = paths[name === "hermess" ? "hermes" : name];
      if (!path) throw new Error(`Unknown agent: ${name}. Use ${Object.keys(paths).join(", ")}, or all.`);
      return resolve(path);
    }))];
}

async function statOptional(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function hashes(directory, prefix = "") {
  const result = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!prefix && entry.name === RECEIPT) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink: ${join(directory, entry.name)}`);
    if (entry.isDirectory()) Object.assign(result, await hashes(join(directory, entry.name), relative));
    else if (entry.isFile()) result[relative] = createHash("sha256").update(await readFile(join(directory, entry.name))).digest("hex");
    else throw new Error(`Unsupported file: ${relative}`);
  }
  return result;
}

function sameHashes(a, b) {
  return b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([path, hash]) => b[path] === hash);
}

async function checkTarget(target, name) {
  const stat = await statOptional(target);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing existing non-directory or symlink: ${target}`);
  const receiptPath = join(target, RECEIPT);
  const receiptStat = await statOptional(receiptPath);
  if (!receiptStat?.isFile() || receiptStat.isSymbolicLink()) throw new Error(`Unmanaged skill already exists: ${target}`);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (receipt.owner !== OWNER || receipt.skill !== name || receipt.schema !== 1) throw new Error(`Unmanaged skill already exists: ${target}`);
  if (!sameHashes(await hashes(target), receipt.files)) throw new Error(`Local changes detected; no overwrite: ${target}`);
  return true;
}

export async function install(options = {}, context = {}) {
  const root = context.root ?? ROOT;
  const move = context.rename ?? rename;
  await buildSkills({ check: true, root });
  const roots = destinations(options, context);
  const skills = [...new Set(options.skills?.length ? options.skills : Object.keys(BUNDLES))];
  for (const name of skills) if (!BUNDLES[name]) throw new Error(`Unknown skill: ${name}`);
  const plan = [];
  for (const destination of roots) {
    const stat = await statOptional(destination);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`Refusing invalid skill root: ${destination}`);
    for (const name of skills) {
      const source = join(root, "skills", name);
      const target = join(destination, name);
      const exists = await checkTarget(target, name);
      const files = await hashes(source);
      if (!files["SKILL.md"]) throw new Error(`Missing SKILL.md: ${source}`);
      plan.push({ name, source, target, files, action: exists ? "update" : "install" });
    }
  }
  if (options.dryRun) return plan;

  const locks = [];
  const staging = [];
  const changed = [];
  let committed = false;
  let rolledBack = false;
  try {
    for (const destination of [...roots].sort()) {
      await mkdir(destination, { recursive: true });
      const lockPath = join(destination, ".kaiyuncode-install.lock");
      const handle = await open(lockPath, "wx");
      locks.push(lockPath);
      await handle.close();
    }
    // Recheck after acquiring locks, before any skill is replaced.
    for (const item of plan) await checkTarget(item.target, item.name);
    for (const item of plan) {
      const stage = await mkdtemp(join(dirname(item.target), ".kaiyuncode-stage-"));
      staging.push(stage);
      const next = join(stage, "next");
      await cp(item.source, next, { recursive: true });
      if (!sameHashes(await hashes(next), item.files)) throw new Error(`Source changed during install: ${item.name}`);
      await writeFile(join(next, RECEIPT), `${JSON.stringify({ schema: 1, owner: OWNER, skill: item.name, files: item.files }, null, 2)}\n`);
      item.next = next;
      item.backup = join(stage, "previous");
    }
    for (const item of plan) {
      const exists = await checkTarget(item.target, item.name);
      if (exists) await move(item.target, item.backup);
      const change = { ...item, hadPrevious: exists, installed: false };
      changed.push(change);
      await move(item.next, item.target);
      change.installed = true;
    }
    committed = true;
  } catch (error) {
    for (const item of [...changed].reverse()) {
      if (item.installed) await rm(item.target, { recursive: true });
      if (item.hadPrevious) await move(item.backup, item.target);
    }
    rolledBack = true;
    throw error;
  } finally {
    // If rollback itself failed, preserve backups for manual recovery.
    if (committed || rolledBack || changed.length === 0) {
      for (const stage of staging) await rm(stage, { recursive: true, force: true });
    }
    for (const lockPath of locks) await rm(lockPath, { force: true });
  }
  return plan;
}

if (isMainModule(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else {
      if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Node.js 20+ is required.");
      const plan = await install(options);
      for (const item of plan) console.log(`${options.dryRun ? "[dry-run] " : ""}${item.action}: ${item.target}`);
      console.log(options.dryRun ? "No files changed." : "Skills installed. Start a new agent session to reload skills.");
    }
  } catch (error) {
    console.error(`Install failed: ${error.message}`);
    process.exitCode = 1;
  }
}
