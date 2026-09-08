#!/usr/bin/env bash
#
# notarize-stub.sh — placeholder for the future Apple notarization step.
#
# Notarization requires a valid Developer ID Application signature first
# (see sign-stub.sh). electron-builder runs `notarytool` automatically when
# `mac.notarize = true` and the env vars below are set; this script is here
# so the release pipeline has a single entry point for the notarization
# stage and so the credentials stay documented in one place.
#
# Required env vars:
#   APPLE_ID                    Apple ID email used for notarization.
#   APPLE_APP_SPECIFIC_PASSWORD App-specific password for that Apple ID.
#   APPLE_TEAM_ID               10-char Apple Developer Team ID.
#
# Alternative: `xcrun notarytool store-credentials` and reference the profile
# name via `mac.notarize = { teamId, tool }` in electron-builder.

set -euo pipefail

cat <<'EOF'
[!] No hay firma configurada. Para habilitar notarización:

    export APPLE_ID="tu@correo.com"
    export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
    export APPLE_TEAM_ID="ABCDE12345"

    # electron-builder invocará xcrun notarytool automáticamente cuando:
    #   build/electron-builder.dev.cjs → mac.notarize = true
    #   mac.hardenedRuntime = true
    #   mac.identity = "Developer ID Application: ..."

EOF
