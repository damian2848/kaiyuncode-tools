#!/usr/bin/env node
import { isMainModule } from "../shared/entrypoint.mjs";
// src/ and shared/ are authoritative; committed skill bundles need no build at install time.
import { readFile, readdir, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const BUNDLES = {
  "kaiyuncode-create": ["kaiyuncode-image.mjs", "kaiyuncode-video.mjs", "save-api-key.mjs"],
  "kaiyuncode-image": ["kaiyuncode-image.mjs", "save-api-key.mjs"],
  "kaiyuncode-video": ["kaiyuncode-video.mjs", "save-api-key.mjs"],
  "kaiyuncode-configure-agents": ["configure-agents.mjs", "save-api-key.mjs"],
};

export async function bundleFiles(name, root = ROOT) {
  if (!BUNDLES[name]) throw new Error(`Unknown skill: ${name}`);
  const files = new Map();
  const modules = new Set();
  const collect = (source) => {
    for (const match of source.matchAll(/(?:from\s+|import\s*)["'](?:\.\.\/shared\/|\.\/)([^"']+\.mjs)["']/g)) {
      modules.add(match[1]);
    }
  };
  for (const entry of BUNDLES[name]) {
    const source = await readFile(resolve(root, "src", entry), "utf8");
    collect(source);
    files.set(`scripts/${entry}`, source.replaceAll("../shared/", "./lib/"));
  }
  // Set iteration includes dependencies added while visiting earlier modules.
  for (const module of modules) {
    const source = await readFile(resolve(root, "shared", module), "utf8");
    collect(source);
    files.set(`scripts/lib/${module}`, source.replaceAll("../references/", "../../references/"));
  }
  if (modules.has("production-tutorial.mjs")) {
    files.set("references/production-capabilities.json", await readFile(resolve(root, "references/production-capabilities.json"), "utf8"));
  }
  if (name === "kaiyuncode-create") {
    for (const kind of ["image", "video"]) {
      files.set(`references/${kind}-api.md`, await readFile(resolve(root, `skills/kaiyuncode-${kind}/references/api.md`), "utf8"));
    }
  }
  return files;
}

async function scriptPaths(directory, prefix = "scripts") {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await scriptPaths(resolve(directory, entry.name), path));
    else paths.push(path);
  }
  return paths;
}

export async function buildSkills({ check = false, root = ROOT } = {}) {
  for (const name of Object.keys(BUNDLES)) {
    const directory = resolve(root, "skills", name);
    const files = await bundleFiles(name, root);
    if (check) {
      for (const [path, expected] of files) {
        const actual = await readFile(resolve(directory, path), "utf8").catch(() => null);
        if (actual !== expected) throw new Error(`Stale bundle: ${name}/${path}. Run npm run build:skills.`);
      }
      for (const path of await scriptPaths(resolve(directory, "scripts"))) {
        if (!files.has(path)) throw new Error(`Unexpected bundled script: ${name}/${path}`);
      }
    } else {
      await rm(resolve(directory, "scripts"), { recursive: true, force: true });
      for (const [path, content] of files) {
        await mkdir(dirname(resolve(directory, path)), { recursive: true });
        await writeFile(resolve(directory, path), content);
      }
    }
  }
}

if (isMainModule(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Usage: node scripts/build-skills.mjs [--check]");
  await buildSkills({ check: process.argv.includes("--check") });
  console.log(process.argv.includes("--check") ? "Skill bundles are current." : "Built four standalone skills.");
}
