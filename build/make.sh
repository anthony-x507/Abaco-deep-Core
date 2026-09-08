#!/usr/bin/env bash
#
# make.sh — Build ABACO Deep Core unsigned .app bundles for macOS
#           (arm64 + x64) and emit ZIPs into build/artifacts/.
#
# Steps:
#   1. Verify required tooling (node, npm, python3).
#   2. Locate the Electron package directory under desktop/.
#   3. `npm ci` (falls back to `npm install` if no lockfile).
#   4. `npm run build` (compiles the Electron app).
#   5. electron-builder --mac --arm64
#   6. electron-builder --mac --x64
#   7. Verify the resulting ZIPs (verify-build.sh).
#   8. Print artifact paths and sizes.
#
# Output: build/artifacts/*.zip + latest-mac.yml
#
# Exit codes:
#   0  success
#   1  tool missing / dependency install / build failure
#   2  unexpected environment layout

set -euo pipefail

# Resolve paths relative to this script, not the caller's CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_DIR="${REPO_ROOT}/desktop"
ARTIFACTS_DIR="${SCRIPT_DIR}/artifacts"
CONFIG_FILE="${SCRIPT_DIR}/electron-builder.dev.cjs"

# Defaults — override via env: SKIP_DEPS=1, SKIP_BUILD=1, ARCHS="arm64 x64",
#            ELECTRON_BUILDER_CLI_ARGS="--x64 --publish never".
SKIP_DEPS="${SKIP_DEPS:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
ARCHS="${ARCHS:-arm64 x64}"

log()  { printf '\033[1;32m[make]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[make]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[make]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- tooling check
require_tool() {
    local tool="$1"
    local pretty="${2:-$1}"
    if ! command -v "${tool}" >/dev/null 2>&1; then
        fail "missing required tool: ${pretty}. Install it and retry."
    fi
}

log "checking tooling"
require_tool node   "node (>= 20)"
require_tool npm    "npm"
require_tool python3 "python3 (>= 3.11)"
require_tool shasum "shasum (ships with macOS)"
require_tool ditto  "ditto (ships with macOS)"

# Soft-check versions and warn loudly — they don't block the build.
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "${node_major}" -lt 20 ]]; then
    warn "node ${node_major} detected; this project is tested on node >= 20."
fi
py_major="$(python3 -c 'import sys;print(sys.version_info[0])' 2>/dev/null || echo 0)"
py_minor="$(python3 -c 'import sys;print(sys.version_info[1])' 2>/dev/null || echo 0)"
if [[ "${py_major}" -lt 3 || ( "${py_major}" -eq 3 && "${py_minor}" -lt 11 ) ]]; then
    warn "python3 ${py_major}.${py_minor} detected; this project expects >= 3.11."
fi

# -------------------------------------------------------- locate electron pkg
log "locating Electron package under ${DESKTOP_DIR}"
[[ -d "${DESKTOP_DIR}" ]] || fail "desktop/ directory missing at ${DESKTOP_DIR}"

# Pick the first package.json we find directly under desktop/ or one level
# deeper (the project layout currently has desktop/src/dsh-desktop/package.json).
ELECTRON_PKG_DIR=""
while IFS= read -r -d '' candidate; do
    ELECTRON_PKG_DIR="$(dirname "${candidate}")"
    break
done < <(find "${DESKTOP_DIR}" -maxdepth 3 -type f -name package.json -print0 2>/dev/null)

if [[ -z "${ELECTRON_PKG_DIR}" ]]; then
    fail "no package.json found under ${DESKTOP_DIR}. Expected one at desktop/ or desktop/src/<name>/."
fi

# Only accept a directory that looks like an Electron app (has devDependency
# on electron or has a 'build' script).
if ! grep -q '"electron-builder"\|"electron-vite"\|"electron":' "${ELECTRON_PKG_DIR}/package.json"; then
    fail "found package.json at ${ELECTRON_PKG_DIR} but it does not look like an Electron app."
fi

log "using Electron package at ${ELECTRON_PKG_DIR}"

# ---------------------------------------------------------- dependency install
if [[ "${SKIP_DEPS}" = "1" ]]; then
    log "SKIP_DEPS=1 — skipping npm ci"
else
    log "installing dependencies"
    (
        cd "${ELECTRON_PKG_DIR}"
        if [[ -f package-lock.json ]]; then
            npm ci --no-audit --no-fund
        else
            warn "no package-lock.json found at ${ELECTRON_PKG_DIR}; falling back to npm install"
            npm install --no-audit --no-fund
        fi
    )
fi

# ---------------------------------------------------------------- build sources
if [[ "${SKIP_BUILD}" = "1" ]]; then
    log "SKIP_BUILD=1 — skipping source build"
else
    log "compiling Electron sources (npm run build)"
    (
        cd "${ELECTRON_PKG_DIR}"
        npm run build
    )
fi

# --------------------------------------------------------------- packaging
mkdir -p "${ARTIFACTS_DIR}"
[[ -f "${CONFIG_FILE}" ]] || fail "missing builder config: ${CONFIG_FILE}"

# electron-builder walks up from CWD to find the nearest package.json, so we
# always run it from `${ELECTRON_PKG_DIR}` and pass `--config` explicitly.
build_one_arch() {
    local arch="$1"
    log "packaging macOS ${arch}"
    (
        cd "${ELECTRON_PKG_DIR}"
        # shellcheck disable=SC2086
        npx --no-install electron-builder --mac --"${arch}" \
            --config "${CONFIG_FILE}" \
            --publish never \
            ${ELECTRON_BUILDER_CLI_ARGS:-}
    )
}

for arch in ${ARCHS}; do
    build_one_arch "${arch}"
done

# -------------------------------------------------------------- verification
log "verifying artifacts"
"${SCRIPT_DIR}/verify-build.sh"

# ----------------------------------------------------------- summary
log "artifacts ready in ${ARTIFACTS_DIR}"
shopt -s nullglob
for artifact in "${ARTIFACTS_DIR}"/*.zip "${ARTIFACTS_DIR}"/latest*.yml; do
    size_h="$(du -h "${artifact}" | awk '{print $1}')"
    log "  $(basename "${artifact}")  (${size_h})  ${artifact}"
done
shopt -u nullglob

log "done."
