#!/usr/bin/env bash
#
# release-mac.sh — Build and ship ABACO Deep Core to GitHub Releases.
#
# Usage:
#   ./build/release-mac.sh v0.1.0
#   ./build/release-mac.sh v0.1.0 --draft
#
# Steps:
#   1. Call make.sh (or skip with SKIP_MAKE=1).
#   2. Compute sha512 + size for every mac ZIP, write latest-mac.yml.
#   3. `gh release create <tag> --target <branch|commit>` (or upload into an
#      existing release). Skip with SKIP_CREATE=1.
#   4. Upload ZIPs and the feed as release assets.
#   5. If the release was created as a draft, leave it as a draft unless
#      `--publish` is passed; default is to publish.
#
# Requirements:
#   - gh CLI authenticated (gh auth status)
#   - REPO env var (owner/repo) — defaults to anthony-x507/Abaco-deep-Core
#
# Exit codes:
#   0  success
#   1  anything else

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS_DIR="${SCRIPT_DIR}/artifacts"
DEFAULT_REPO="anthony-x507/Abaco-deep-Core"
REPO="${REPO:-${DEFAULT_REPO}}"

log()  { printf '\033[1;35m[release]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[release]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[release]\033[0m %s\n' "$*" >&2; exit 1; }

require_tool() {
    local tool="$1"
    if ! command -v "${tool}" >/dev/null 2>&1; then
        fail "missing required tool: ${tool}"
    fi
}

# --------------------------------------------------------------------- args
usage() {
    cat <<EOF
Usage: $0 <tag> [options]

Arguments:
  <tag>                 Git tag (e.g. v0.1.0). Must start with 'v'.

Options:
  --draft               Create the release as a draft (default: published).
  --prerelease          Mark the release as a prerelease.
  --target <ref>        Target branch/commit for gh release create.
                        Defaults to the tag's own commit.
  --repo <owner/repo>   Override the GitHub repo (defaults to ${DEFAULT_REPO}).

Env:
  REPO                  Same as --repo.
  SKIP_MAKE=1           Skip the make.sh build step (use existing artifacts).
  SKIP_CREATE=1         Skip gh release create; only upload assets.
  DRY_RUN=1             Print every command without executing it.

Examples:
  $0 v0.1.0
  $0 v0.1.0 --draft
  $0 v0.1.0 --prerelease --target main
EOF
}

TAG="${1:-}"
shift || true
[[ -z "${TAG}" ]] && { usage; exit 2; }
[[ "${TAG}" =~ ^v[0-9] ]] || fail "tag must start with 'v' (got '${TAG}')"

DRAFT="false"
PRERELEASE="false"
TARGET=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --draft)        DRAFT="true"; shift ;;
        --prerelease)   PRERELEASE="true"; shift ;;
        --target)       TARGET="${2:-}"; shift 2 ;;
        --target=*)     TARGET="${1#*=}"; shift ;;
        --repo)         REPO="${2:-}"; shift 2 ;;
        --repo=*)       REPO="${1#*=}"; shift ;;
        -h|--help)      usage; exit 0 ;;
        *)              fail "unknown argument: $1" ;;
    esac
done

# ----------------------------------------------------------------- tooling
require_tool gh
require_tool shasum
require_tool jq    "jq (brew install jq)"
require_tool awk

gh auth status >/dev/null 2>&1 || fail "gh CLI is not authenticated. Run: gh auth login"

# --------------------------------------------------------------------- build
if [[ "${SKIP_MAKE:-0}" = "1" ]]; then
    log "SKIP_MAKE=1 — reusing existing artifacts"
else
    log "running make.sh"
    "${SCRIPT_DIR}/make.sh"
fi

[[ -d "${ARTIFACTS_DIR}" ]] || fail "artifacts directory missing: ${ARTIFACTS_DIR}"

shopt -s nullglob
ZIPS=( "${ARTIFACTS_DIR}"/abaco-deep-core-mac-*.zip )
shopt -u nullglob
[[ ${#ZIPS[@]} -gt 0 ]] || fail "no ABACO Deep Core macOS zips in ${ARTIFACTS_DIR}"

# ----------------------------------------------- generate latest-mac.yml
# electron-updater consumes YAML. We build it from scratch in shell so we
# don't depend on python or node, and so the result matches what the project
# itself already produces for the dsh-desktop branch
# (scripts/merge-mac-update-metadata.mjs).
VERSION="${TAG#v}"
RELEASE_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FEED_FILE="${ARTIFACTS_DIR}/latest-mac.yml"

log "computing sha512 + size for ${#ZIPS[@]} zip(s)"
declare -a files_yaml=()
primary_url=""
primary_sha=""

for zip in "${ZIPS[@]}"; do
    url="$(basename "${zip}")"
    size="$(wc -c < "${zip}" | tr -d ' ')"
    sha="$(shasum -a 512 "${zip}" | awk '{print $1}' | xxd -r -p | base64 | tr -d '\n')"
    log "  ${url}  size=${size}  sha512=${sha:0:12}…"
    files_yaml+=( "  - url: ${url}" )
    files_yaml+=( "    sha512: ${sha}" )
    files_yaml+=( "    size: ${size}" )
    if [[ "${url}" == *arm64* && -z "${primary_url}" ]]; then
        primary_url="${url}"
        primary_sha="${sha}"
    fi
done

# Fall back to the first zip if no arm64 was built (shouldn't happen).
if [[ -z "${primary_url}" ]]; then
    first="${ZIPS[0]}"
    primary_url="$(basename "${first}")"
    primary_sha="$(shasum -a 512 "${first}" | awk '{print $1}' | xxd -r -p | base64 | tr -d '\n')"
fi

{
    printf 'version: %s\n' "${VERSION}"
    printf 'files:\n'
    printf '%s\n' "${files_yaml[@]}"
    printf 'path: %s\n' "${primary_url}"
    printf 'sha512: %s\n' "${primary_sha}"
    printf 'releaseDate: %s\n' "${RELEASE_DATE}"
} > "${FEED_FILE}"

log "wrote ${FEED_FILE}"

# ----------------------------------------------------- upload to GitHub
ASSETS=( "${ZIPS[@]}" "${FEED_FILE}" )
ASSET_ARGS=()
for a in "${ASSETS[@]}"; do
    ASSET_ARGS+=( "${a}" )
done

if [[ "${DRY_RUN:-0}" = "1" ]]; then
    log "DRY_RUN=1 — would run:"
    if [[ "${SKIP_CREATE:-0}" = "1" ]]; then
        printf '  gh release upload %s %s\n' "${TAG}" "${ASSET_ARGS[*]}"
    else
        local_draft="--draft"; [[ "${DRAFT}" = "true" ]] || local_draft=""
        local_prerelease="--prerelease"; [[ "${PRERELEASE}" = "true" ]] || local_prerelease=""
        local_target=""; [[ -n "${TARGET}" ]] && local_target="--target ${TARGET}"
        printf '  gh release create %s %s %s %s %s\n' \
            "${TAG}" "${local_target}" "${local_draft}" "${local_prerelease}" "${ASSET_ARGS[*]}"
        printf '  gh release edit %s --draft=false\n' "${TAG}"
    fi
    log "DRY_RUN done."
    exit 0
fi

if [[ "${SKIP_CREATE:-0}" = "1" ]]; then
    log "uploading assets to existing release ${TAG}"
    gh release upload "${TAG}" "${ASSET_ARGS[@]}" --repo "${REPO}"
else
    create_args=( "create" "${TAG}" "${ASSET_ARGS[@]}" "--repo" "${REPO}" )
    if [[ "${DRAFT}" = "true" ]]; then create_args+=( "--draft" ); fi
    if [[ "${PRERELEASE}" = "true" ]]; then create_args+=( "--prerelease" ); fi
    if [[ -n "${TARGET}" ]]; then create_args+=( "--target" "${TARGET}" ); fi
    # Use the tag's own commit if no --target was given.
    if [[ -z "${TARGET}" ]]; then create_args+=( "--target" "${TAG}" ); fi

    log "creating release ${TAG} on ${REPO}"
    if ! gh release "${create_args[@]}"; then
        # The release may already exist; if so, just upload the new assets.
        warn "gh release create failed — assuming the release exists and uploading assets"
        gh release upload "${TAG}" "${ASSET_ARGS[@]}" --repo "${REPO}"
    fi

    # Publish unless the caller explicitly asked for a draft.
    if [[ "${DRAFT}" = "true" ]]; then
        log "release kept as DRAFT — re-run with --publish when ready"
    else
        gh release edit "${TAG}" --draft=false --repo "${REPO}"
    fi
fi

log "release ${TAG} shipped to https://github.com/${REPO}/releases/tag/${TAG}"
