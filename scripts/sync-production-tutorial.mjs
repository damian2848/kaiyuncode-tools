#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { loadProductionCapabilities } from "../shared/production-tutorial.mjs";

const bundledPath = fileURLToPath(
  new URL("../references/production-capabilities.json", import.meta.url),
);

const snapshot = await loadProductionCapabilities({
  bundledPath,
  cachePath: bundledPath,
  allowStale: false,
  requireCacheWrite: true,
});

console.log(`image capabilities: ${snapshot.imageCapabilities.length}`);
console.log(`video capabilities: ${snapshot.videoCapabilities.length}`);
console.log(`source updated at: ${snapshot.sourceUpdatedAt}`);
