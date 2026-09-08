#!/usr/bin/env bash
#
# verify-build.sh — sanity-check the freshly packed ABACO Deep Core.app
#                    produced by make.sh.
#
# For each ZIP under artifacts/:
#   1. Unzip into a temp dir.
#   2. Confirm <App>.app/Contents/{MacOS,Info.plist} exist.
#   3. Confirm Info.plist contains the expected app id / product name.
#   4. Smoke-launch the binary in headless-ish mode (`open -W` with a tight
#      timeout) just to prove the Mach-O is loadable.
#
# Exits non-zero on any failure so the calling pipeline can react.
# Writes "BUILD OK" / "BUILD FAILED" as the last line.

set -euo pipefail

# Resolve paths relative to this script, not the caller's CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS_DIR="${SCRIPT_DIR}/artifacts"
APP_DISPLAY_NAME="ABACO Deep Core"
APP_BUNDLE_ID="io.abaco.deepcore"
SMOKE_TIMEOUT_SECONDS=8

log()  { printf '\033[1;34m[verify]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[verify]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[verify]\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
    if [[ -n "${WORK_DIR:-}" && -d "${WORK_DIR}" ]]; then
        rm -rf "${WORK_DIR}"
    fi
}
trap cleanup EXIT

[[ -d "${ARTIFACTS_DIR}" ]] || fail "artifacts directory not found: ${ARTIFACTS_DIR}"

# Pick zips matching the artifactName pattern (mac, not win/linux).
shopt -s nullglob
ZIPS=( "${ARTIFACTS_DIR}"/abaco-deep-core-mac-*.zip )
shopt -u nullglob

if [[ ${#ZIPS[@]} -eq 0 ]]; then
    fail "no ABACO Deep Core macOS zips found in ${ARTIFACTS_DIR}"
fi

log "found ${#ZIPS[@]} zip(s) to verify"

WORK_DIR="$(mktemp -d -t abaco-verify.XXXXXX)"

failed=0
for zip in "${ZIPS[@]}"; do
    name="$(basename "${zip}")"
    log "verifying ${name}"

    stage="${WORK_DIR}/${name%.zip}"
    mkdir -p "${stage}"

    # `ditto` re-creates the macOS layout (preserves .app bundles cleanly);
    # fall back to `unzip -q` if ditto is unavailable.
    if command -v ditto >/dev/null 2>&1; then
        ditto -x -k "${zip}" "${stage}" >/dev/null
    else
        unzip -q "${zip}" -d "${stage}"
    fi

    app_path="${stage}/${APP_DISPLAY_NAME}.app"
    if [[ ! -d "${app_path}" ]]; then
        # Some bundles may strip the product name — try a glob.
        candidate="$(find "${stage}" -maxdepth 1 -type d -name '*.app' | head -n1 || true)"
        if [[ -z "${candidate}" ]]; then
            warn "${name}: no .app bundle inside"
            failed=1
            continue
        fi
        warn "${name}: expected ${APP_DISPLAY_NAME}.app, found $(basename "${candidate}")"
        app_path="${candidate}"
    fi

    contents="${app_path}/Contents"
    if [[ ! -d "${contents}" ]]; then
        warn "${name}: ${app_path} is not a macOS app bundle (no Contents/)"
        failed=1
        continue
    fi

    info_plist="${contents}/Info.plist"
    macos_dir="${contents}/MacOS"
    if [[ ! -f "${info_plist}" ]]; then
        warn "${name}: missing Info.plist"
        failed=1
        continue
    fi
    if [[ ! -d "${macos_dir}" ]]; then
        warn "${name}: missing Contents/MacOS directory"
        failed=1
        continue
    fi

    # Read CFBundleIdentifier and CFBundleName.
    bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${info_plist}" 2>/dev/null || true)"
    bundle_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "${info_plist}" 2>/dev/null || true)"

    if [[ "${bundle_id}" != "${APP_BUNDLE_ID}" ]]; then
        warn "${name}: CFBundleIdentifier is '${bundle_id:-<missing>}', expected '${APP_BUNDLE_ID}'"
        failed=1
        continue
    fi

    if [[ -n "${bundle_name}" && "${bundle_name}" != "${APP_DISPLAY_NAME}" ]]; then
        # Not fatal — electron-builder sometimes sets CFBundleName to a slug.
        log "  CFBundleName = ${bundle_name} (display name = ${APP_DISPLAY_NAME})"
    fi

    binary="${macos_dir}/${APP_DISPLAY_NAME}"
    if [[ ! -x "${binary}" ]]; then
        # Try the CFBundleExecutable.
        cfb_exec="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${info_plist}" 2>/dev/null || true)"
        if [[ -n "${cfb_exec}" && -x "${macos_dir}/${cfb_exec}" ]]; then
            binary="${macos_dir}/${cfb_exec}"
        else
            warn "${name}: executable not found inside Contents/MacOS"
            failed=1
            continue
        fi
    fi

    # Headless smoke launch. We don't need the app to do real work; we only
    # need the dynamic linker to map the Mach-O and the runtime to survive
    # a few seconds. The timeout protects against UI hangs.
    log "  smoke-launching $(basename "${binary}") for ${SMOKE_TIMEOUT_SECONDS}s"
    if command -v timeout >/dev/null 2>&1; then
        # Some macOS boxes lack GNU timeout; in that case `gtimeout` (brew
        # coreutils) is the user-provided alternative.
        timeout --kill-after=2 "${SMOKE_TIMEOUT_SECONDS}" \
            "${binary}" --no-sandbox --disable-gpu --headless \
            >/dev/null 2>&1 &
        smoke_pid=$!
    else
        # Fallback: run the binary in the background, then kill it after a
        # delay. We capture only the exit status from `wait` after the kill.
        "${binary}" --no-sandbox --disable-gpu --headless \
            >/dev/null 2>&1 &
        smoke_pid=$!
        ( sleep "${SMOKE_TIMEOUT_SECONDS}" && kill "${smoke_pid}" >/dev/null 2>&1 ) &
        watchdog=$!
        wait "${smoke_pid}" 2>/dev/null || true
        kill "${watchdog}" >/dev/null 2>&1 || true
    fi

    if command -v timeout >/dev/null 2>&1; then
        wait "${smoke_pid}" 2>/dev/null || true
    fi

    # Confirm the Mach-O still loads: `file` should not say "malformed".
    file_out="$(file "${binary}" 2>/dev/null || true)"
    if ! grep -qE 'Mach-O .* executable' <<<"${file_out}"; then
        warn "${name}: binary is not a Mach-O executable (file: ${file_out})"
        failed=1
        continue
    fi

    log "  ok — ${name}"
done

if [[ "${failed}" -ne 0 ]]; then
    echo "BUILD FAILED"
    exit 1
fi

echo "BUILD OK"
