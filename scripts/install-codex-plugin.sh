#!/usr/bin/env bash

set -euo pipefail

readonly REPOSITORY_URL="https://github.com/damian2848/kaiyuncode-tools.git"
readonly PLUGIN_NAME="kaiyuncode-tools"
readonly INSTALL_DIR="${HOME}/plugins/${PLUGIN_NAME}"
readonly MARKETPLACE_PATH="${HOME}/.agents/plugins/marketplace.json"

fail() {
  printf '安装失败：%s\n' "$*" >&2
  exit 1
}

for command_name in git python3 codex; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "未找到 ${command_name}，请先安装后重试。"
done

if [[ -L "${INSTALL_DIR}" ]]; then
  fail "目标目录是符号链接：${INSTALL_DIR}"
fi

if [[ -e "${INSTALL_DIR}" ]]; then
  [[ -d "${INSTALL_DIR}/.git" ]] || fail "目标目录已存在但不是 Git 仓库：${INSTALL_DIR}"

  origin_url="$(git -C "${INSTALL_DIR}" remote get-url origin 2>/dev/null || true)"
  case "${origin_url}" in
    "${REPOSITORY_URL}"|"https://github.com/damian2848/kaiyuncode-tools"|"git@github.com:damian2848/kaiyuncode-tools.git"|"ssh://git@github.com/damian2848/kaiyuncode-tools.git") ;;
    *) fail "目标目录不是 KaiyunCode Tools 仓库，未执行覆盖：${INSTALL_DIR}" ;;
  esac

  [[ -z "$(git -C "${INSTALL_DIR}" status --porcelain)" ]] || fail "仓库存在本地修改，请先处理后重试：${INSTALL_DIR}"
  current_branch="$(git -C "${INSTALL_DIR}" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  [[ "${current_branch}" == "main" ]] || fail "仓库当前不在 main 分支，未自动切换。"

  printf '正在更新 %s...\n' "${INSTALL_DIR}"
  git -C "${INSTALL_DIR}" pull --ff-only origin main
else
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  printf '正在安装到 %s...\n' "${INSTALL_DIR}"
  git clone --depth 1 --branch main "${REPOSITORY_URL}" "${INSTALL_DIR}"
fi

[[ -f "${INSTALL_DIR}/.codex-plugin/plugin.json" ]] || fail "仓库缺少 .codex-plugin/plugin.json。"

mkdir -p "$(dirname "${MARKETPLACE_PATH}")"
[[ ! -L "${MARKETPLACE_PATH}" ]] || fail "marketplace.json 是符号链接，未执行写入：${MARKETPLACE_PATH}"

marketplace_name="$(python3 - "${MARKETPLACE_PATH}" <<'PY'
import json
import os
import stat
import sys
import tempfile
from pathlib import Path

marketplace_path = Path(sys.argv[1])
plugin_name = "kaiyuncode-tools"
expected_source = {"source": "local", "path": "./plugins/kaiyuncode-tools"}

if marketplace_path.exists():
    payload = json.loads(marketplace_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"{marketplace_path} 必须包含 JSON 对象。")
    original_mode = stat.S_IMODE(marketplace_path.stat().st_mode)
else:
    payload = {
        "name": "personal",
        "interface": {"displayName": "Personal"},
        "plugins": [],
    }
    original_mode = 0o600

marketplace_name = payload.get("name")
if not isinstance(marketplace_name, str) or not marketplace_name.strip():
    raise SystemExit(f"{marketplace_path} 缺少有效的 marketplace name。")

plugins = payload.get("plugins")
if not isinstance(plugins, list):
    raise SystemExit(f"{marketplace_path} 的 plugins 必须是数组。")

matches = [entry for entry in plugins if isinstance(entry, dict) and entry.get("name") == plugin_name]
if len(matches) > 1:
    raise SystemExit(f"{marketplace_path} 中存在重复的 {plugin_name} 条目。")

changed = not marketplace_path.exists()
if matches:
    entry = matches[0]
    if entry.get("source") != expected_source:
        raise SystemExit(f"{plugin_name} 已指向其他来源，未自动覆盖。")
    if "policy" not in entry:
        entry["policy"] = {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}
        changed = True
    if "category" not in entry:
        entry["category"] = "Developer Tools"
        changed = True
else:
    plugins.append({
        "name": plugin_name,
        "source": expected_source,
        "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        "category": "Developer Tools",
    })
    changed = True

if changed:
    fd, temporary_path = tempfile.mkstemp(prefix="marketplace.", suffix=".json", dir=marketplace_path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_path, original_mode)
        os.replace(temporary_path, marketplace_path)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)

print(marketplace_name.strip())
PY
)"

printf '正在注册插件到 marketplace %s...\n' "${marketplace_name}"
codex plugin add "${PLUGIN_NAME}@${marketplace_name}" --json

codex plugin list | grep -F "${PLUGIN_NAME}@${marketplace_name}" >/dev/null || fail "Codex 未返回已注册的插件。"

plugin_version="$(python3 - "${INSTALL_DIR}/.codex-plugin/plugin.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
print(payload.get("version", "unknown"))
PY
)"

printf '\n安装完成：%s %s\n请新建 Codex 对话后开始使用。\n' "${PLUGIN_NAME}" "${plugin_version}"
