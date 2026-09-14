#!/usr/bin/env bash
set -euo pipefail

# Local checkout: install its exact checked-out bundles. curl | bash: use a disposable clone.
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${script_dir}/install.mjs" ]]; then
    exec node "${script_dir}/install.mjs" "$@"
  fi
fi

for command_name in git node; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    printf '安装失败：请先安装 %s（Node.js 需 20+）。\n' "${command_name}" >&2
    exit 1
  }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("Node.js 20+ is required."); process.exit(1); }'
install_tmp="$(mktemp -d "${TMPDIR:-/tmp}/kaiyuncode-skills.XXXXXXXX")"
trap 'rm -rf -- "${install_tmp}"' EXIT

git clone --depth 1 --branch main https://github.com/damian2848/kaiyuncode-tools.git "${install_tmp}/repo"
node "${install_tmp}/repo/scripts/install.mjs" "$@"
