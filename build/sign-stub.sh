#!/usr/bin/env bash
#
# sign-stub.sh — placeholder for the future Developer ID signing step.
#
# While ABACO Deep Core ships unsigned, this script just prints the variables
# the release pipeline will need once an Apple Developer ID is available.
# Wire it into `release-mac.sh` (or `electron-builder.dev.cjs`) when ready.
#
# Required env vars (when real signing is enabled):
#   APPLE_ID                    Apple ID email used for notarization.
#   APPLE_APP_SPECIFIC_PASSWORD App-specific password for that Apple ID.
#   APPLE_TEAM_ID               10-char Apple Developer Team ID.
#   CSC_LINK                    Path/URL/base64 of the .p12 Developer ID
#                               Application certificate.
#   CSC_KEY_PASSWORD            Password for the .p12 file.
#
# Optional (electron-builder also supports these):
#   KEYCHAIN_PATH / KEYCHAIN_PASSWORD  temporary keychain for CI.

set -euo pipefail

cat <<'EOF'
[!] No hay firma configurada. Para habilitar Developer ID firma:

    export APPLE_ID="tu@correo.com"
    export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
    export APPLE_TEAM_ID="ABCDE12345"
    export CSC_LINK="$HOME/certs/DeveloperID_Application.p12"
    export CSC_KEY_PASSWORD="********"

    # Opcional (CI con keychain temporal):
    export KEYCHAIN_PATH="$RUNNER_TEMP/signing.keychain-db"
    export KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"

    # Y en build/electron-builder.dev.cjs:
    #   mac.identity = "Developer ID Application: Tu Nombre (ABCDE12345)"
    #   mac.hardenedRuntime = true
    #   mac.gatekeeperAssess = true
    #   mac.notarize = true

EOF
