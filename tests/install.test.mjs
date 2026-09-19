import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BUNDLES, ROOT, buildSkills } from "../scripts/build-skills.mjs";
import { destinations, install, parseArgs } from "../scripts/install.mjs";

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "kaiyun install 空格-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, env: {} };
}

test("agent presets, aliases and profile directories resolve without needing agent CLIs", () => {
  const home = join(tmpdir(), "example");
  assert.deepEqual(destinations(parseArgs(["--agent", "all"]), { home, env: {} }), [
    join(home, ".agents/skills"), join(home, ".claude/skills"), join(home, ".grok/skills"),
    join(home, ".openclaw/skills"), join(home, ".hermes/skills"),
  ]);
  assert.deepEqual(destinations(parseArgs(["--agent", "hermess", "--agent", "hermes"]), { home, env: { HERMES_HOME: join(home, "profile") } }), [join(home, "profile/skills")]);
  assert.deepEqual(destinations(parseArgs([]), { home, env: {} }), [join(home, ".agents/skills")]);
  assert.throws(() => parseArgs(["--skills-dir", "x", "--agent", "codex"]), /not both/);
  assert.throws(() => parseArgs(["--agent"]), /Missing value/);
  assert.throws(() => destinations(parseArgs(["--agent", "typo"])), /Unknown agent/);
});

test("dry-run writes nothing; all-agent install and repeated update preserve unrelated files", async (t) => {
  const context = await fixture(t);
  const options = parseArgs(["--agent", "all"]);
  const plan = await install({ ...options, dryRun: true }, context);
  assert.equal(plan.length, 20);
  assert.deepEqual(await readdir(context.home), []);
  await install(options, context);
  for (const item of plan) assert.match(await readFile(join(item.target, "SKILL.md"), "utf8"), new RegExp(`name: ${item.name}`));
  const unrelated = join(context.home, ".agents/skills/unrelated.txt");
  await writeFile(unrelated, "keep");
  const updated = await install(options, context);
  assert.ok(updated.every((item) => item.action === "update"));
  assert.equal(await readFile(unrelated, "utf8"), "keep");
  for (const root of destinations(options, context)) {
    assert.ok((await readdir(root)).every((name) => !name.startsWith(".kaiyuncode-")));
  }
});

test("unmanaged and locally modified skills stop the entire install before other targets change", async (t) => {
  const context = await fixture(t);
  const options = parseArgs(["--agent", "all"]);
  const target = join(context.home, ".hermes/skills/kaiyuncode-video");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "my skill");
  await assert.rejects(install(options, context), /Unmanaged skill/);
  await assert.rejects(readFile(join(context.home, ".agents/skills/kaiyuncode-create/SKILL.md")), { code: "ENOENT" });
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "my skill");
  await rm(target, { recursive: true });
  await install(options, context);
  await writeFile(join(target, "notes.txt"), "local addition");
  await assert.rejects(install(options, context), /Local changes/);
  assert.equal(await readFile(join(target, "notes.txt"), "utf8"), "local addition");
});

test("selected standalone skill updates from new source without needing sibling skills", async (t) => {
  const context = await fixture(t);
  const source = join(context.home, "source");
  for (const directory of ["src", "shared", "references", "skills"]) {
    await cp(join(ROOT, directory), join(source, directory), { recursive: true });
  }
  const options = { skillsDir: join(context.home, "custom"), skills: ["kaiyuncode-image"] };
  await install(options, { ...context, root: source });
  assert.deepEqual(await readdir(options.skillsDir), ["kaiyuncode-image"]);
  const entry = join(source, "src/save-api-key.mjs");
  await writeFile(entry, `${await readFile(entry, "utf8")}\n// Updated release\n`);
  await assert.rejects(install(options, { ...context, root: source }), /Stale bundle/);
  await buildSkills({ root: source });
  await install(options, { ...context, root: source });
  assert.match(await readFile(join(options.skillsDir, "kaiyuncode-image/scripts/save-api-key.mjs"), "utf8"), /Updated release/);
});

test("installer rejects symlink collisions and concurrent installation without touching their targets", async (t) => {
  const context = await fixture(t);
  const options = { skillsDir: join(context.home, "skills"), skills: [Object.keys(BUNDLES)[0]] };
  await mkdir(options.skillsDir);
  const external = join(context.home, "external");
  await mkdir(external);
  const target = join(options.skillsDir, options.skills[0]);
  await symlink(external, target, "dir");
  await assert.rejects(install(options, context), /symlink/);
  assert.deepEqual(await readdir(external), []);
  await rm(target);
  const lock = join(options.skillsDir, ".kaiyuncode-install.lock");
  await writeFile(lock, "other installer");
  await assert.rejects(install(options, context), { code: "EEXIST" });
  assert.equal(await readFile(lock, "utf8"), "other installer");
});

test("a failed replacement restores all previously installed skills and removes staging", async (t) => {
  const context = await fixture(t);
  const options = { skillsDir: join(context.home, "skills"), skills: ["kaiyuncode-image", "kaiyuncode-video"] };
  const plan = await install(options, context);
  const original = await Promise.all(plan.map((item) => readFile(join(item.target, ".kaiyuncode-install.json"), "utf8")));
  await assert.rejects(install(options, {
    ...context,
    rename: async (source, target) => {
      if (source.endsWith("/next") && target.endsWith("kaiyuncode-video")) throw new Error("Simulated replacement failure");
      return rename(source, target);
    },
  }), /Simulated replacement failure/);
  for (const [index, item] of plan.entries()) {
    assert.equal(await readFile(join(item.target, ".kaiyuncode-install.json"), "utf8"), original[index]);
    await readFile(join(item.target, "SKILL.md"));
  }
  assert.deepEqual((await readdir(options.skillsDir)).sort(), ["kaiyuncode-image", "kaiyuncode-video"]);
  await install(options, context);
});

test("KaiyunTool upgrades legacy receipts and still refuses local edits", async (t) => {
  const context = await fixture(t);
  const options = { skillsDir: join(context.home, "skills"), skills: ["kaiyuncode-configure-agents"] };
  const [item] = await install(options, context);
  const receiptPath = join(item.target, ".kaiyuncode-install.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.owner = "damian2848/kaiyuncode-tools";
  await writeFile(receiptPath, JSON.stringify(receipt));
  await install(options, context);
  assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).owner, "damian2848/kaiyuntool");
  await writeFile(receiptPath, JSON.stringify(receipt));
  await writeFile(join(item.target, "local.txt"), "keep local edits");
  await assert.rejects(install(options, context), /Local changes/);
  assert.equal(await readFile(join(item.target, "local.txt"), "utf8"), "keep local edits");
});

test("CLI installation introduces only installed capabilities and does not configure a client", async (t) => {
  const context = await fixture(t);
  const skillsDir = join(context.home, "skills");
  const args = [join(ROOT, "scripts/install.mjs"), "--skills-dir", skillsDir, "--skill", "kaiyuncode-configure-agents"];
  const { stdout } = await promisify(execFile)(process.execPath, args, { env: { ...process.env, HOME: context.home } });
  assert.match(stdout, /KaiyunTool 安装完成/);
  assert.match(stdout, /OpenClaw/);
  assert.match(stdout, /同步全部文本模型和推理强度/);
  assert.doesNotMatch(stdout, /海报|5 秒/);
  assert.deepEqual(await readdir(context.home), ["skills"]);
  assert.deepEqual(await readdir(skillsDir), ["kaiyuncode-configure-agents"]);
  const preview = await promisify(execFile)(process.execPath, [...args, "--dry-run"]);
  assert.doesNotMatch(preview.stdout, /安装完成/);
});
