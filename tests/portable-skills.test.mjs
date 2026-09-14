import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { BUNDLES, ROOT, buildSkills } from "../scripts/build-skills.mjs";

const run = promisify(execFile);

test("committed bundles are synchronized with their source", async () => {
  await buildSkills({ check: true });
});

for (const [name, entries] of Object.entries(BUNDLES)) {
  test(`${name} works after copying only its own directory to an unrelated path`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "kaiyun portable 空格-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const skill = join(directory, name);
    await cp(join(ROOT, "skills", name), skill, { recursive: true });
    const alias = join(directory, "linked skill");
    await symlink(skill, alias, "dir");
    const instructions = await readFile(join(skill, "SKILL.md"), "utf8");
    assert.match(instructions, new RegExp(`^---\nname: ${name}\n`));
    // Supporting document links must survive independent copying as well.
    for (const [, path] of instructions.matchAll(/\]\((references\/[^)]+)\)/g)) await readFile(join(skill, path));
    assert.doesNotMatch(instructions, /\.\.\/kaiyuncode-/);
    const scriptFiles = await readdir(join(skill, "scripts"));
    for (const entry of entries) {
      assert.ok(scriptFiles.includes(entry));
      const modulePath = join(skill, "scripts", entry);
      await import(pathToFileURL(modulePath));
      const source = await readFile(modulePath, "utf8");
      for (const [, path] of source.matchAll(/from ["'](\.[^"']+)["']/g)) {
        assert.ok(!relative(skill, resolve(skill, "scripts", path)).startsWith(".."));
      }
      if (entry.startsWith("kaiyuncode-")) {
        const { stdout } = await run(process.execPath, [join(alias, "scripts", entry), "--help"], { cwd: directory });
        assert.match(stdout, /--dry-run/);
      }
    }
    const keyDirectory = join(directory, "credentials");
    const { stdout, stderr } = await run(process.execPath, [join(alias, "scripts/save-api-key.mjs")], {
      cwd: directory,
      env: { ...process.env, KAIYUN_HOME: keyDirectory, KAIYUN_API_KEY: "test-portable-key" },
    });
    assert.doesNotMatch(stdout + stderr, /test-portable-key/);
    const { resolveCredential } = await import(pathToFileURL(join(skill, "scripts/lib/credentials.mjs")));
    const credential = await resolveCredential({ home: directory, env: { KAIYUN_HOME: keyDirectory } });
    assert.equal(credential.apiKey, "test-portable-key");
    assert.equal(credential.path, join(keyDirectory, "credentials.env"));
    assert.ok(!(await readdir(directory)).includes(".codex"));
    if (name !== "kaiyuncode-configure-agents") {
      const { loadProductionCapabilities } = await import(pathToFileURL(join(skill, "scripts/lib/production-tutorial.mjs")));
      const snapshot = await loadProductionCapabilities({ fetchImpl: async () => { throw new Error("offline test"); }, cachePath: null });
      assert.equal(snapshot.stale, true);
      assert.ok(snapshot.imageCapabilities.length > 0);
      assert.ok(snapshot.videoCapabilities.length > 0);
    }
  });
}
