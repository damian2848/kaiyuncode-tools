import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node resolves module symlinks, while argv[1] can retain /var -> /private/var
// or an agent's symlinked skill path. Compare real files rather than URL text.
export function isMainModule(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}
