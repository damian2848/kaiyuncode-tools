import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("manifest exposes exactly three KaiyunCode skills", async () => {
  const manifest = JSON.parse(
    await readFile(new URL(".codex-plugin/plugin.json", root), "utf8"),
  );
  assert.equal(manifest.name, "kaiyuncode-tools");
  assert.equal(manifest.version, "0.1.1");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.author.name, "KaiyunCode");
  assert.equal(manifest.homepage, "https://kaiyuncode.com/docs");
  assert.equal(manifest.interface.category, "Developer Tools");
  assert.deepEqual(manifest.interface.capabilities, ["Interactive", "Read", "Write"]);

  const skills = {
    "kaiyuncode-configure-agents": "scripts/configure-agents.mjs",
    "kaiyuncode-image": "scripts/kaiyuncode-image.mjs",
    "kaiyuncode-video": "scripts/kaiyuncode-video.mjs",
  };
  for (const [name, script] of Object.entries(skills)) {
    const skill = await readFile(
      new URL(`skills/${name}/SKILL.md`, root),
      "utf8",
    );
    assert.match(skill, new RegExp(`name: ${name}`));
    assert.match(skill, /粘贴.*API Key|API Key.*粘贴|KAIYUN_API_KEY/);
    assert.match(skill, new RegExp(script.replaceAll(".", "\\.")));
  }
});

test("package exposes the plugin maintenance commands", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );
  assert.deepEqual(packageJson.scripts, {
    test: "node --test tests/*.test.mjs",
    "sync:tutorial": "node scripts/sync-production-tutorial.mjs",
    validate: "npm test",
  });
});
