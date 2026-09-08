#!/usr/bin/env bash
# bootstrap.sh — Prepara el entorno de desarrollo en una Mac nueva.
#
# Pasos:
#   1. Verifica Python 3.11+ y Node 20+.
#   2. Instala Tailscale si no está.
#   3. Crea directorios de runtime.
#   4. Genera identidad de nodo.
#   5. Provisiona secreto HMAC (si se pasa --with-secret <path>).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${HOME}/.abaco-deep-core"

log()  { printf '\033[1;32m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[bootstrap]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ tooling
command -v python3 >/dev/null 2>&1 || fail "python3 required"
command -v node    >/dev/null 2>&1 || fail "node required"

py_major="$(python3 -c 'import sys;print(sys.version_info[0])')"
py_minor="$(python3 -c 'import sys;print(sys.version_info[1])')"
if [[ "${py_major}" -lt 3 || ( "${py_major}" -eq 3 && "${py_minor}" -lt 11 ) ]]; then
    fail "python3 >= 3.11 required (got ${py_major}.${py_minor})"
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "${node_major}" -lt 20 ]]; then
    warn "node >= 20 recommended (got ${node_major})"
fi

# ----------------------------------------------------------------- tailscale
if ! command -v tailscale >/dev/null 2>&1; then
    warn "Tailscale not installed. Download from https://tailscale.com/download/mac"
else
    log "Tailscale ready: $(tailscale version | head -1)"
fi

# ---------------------------------------------------------- runtime dir
log "creating runtime directory at ${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}"
chmod 0700 "${RUNTIME_DIR}"

# ----------------------------------------------------------- node identity
log "generating node identity"
python3 -c "
import sys
sys.path.insert(0, '${REPO_ROOT}/sync')
from node_identity import load_or_create_node_identity
from pathlib import Path
identity = load_or_create_node_identity(Path('${RUNTIME_DIR}/node.json'))
print(f'  node_id: {identity.node_id}')
print(f'  hostname: {identity.hostname}')
print(f'  tailscale_ip: {identity.tailscale_ip}')
"

# ----------------------------------------------------------- hmac secret
while [[ $# -gt 0 ]]; do
    case "$1" in
        --with-secret)
            src="${2:-}"
            [[ -z "${src}" ]] && fail "--with-secret requires a path"
            if [[ -f "${src}" ]]; then
                cp "${src}" "${RUNTIME_DIR}/sync.secret"
                chmod 0600 "${RUNTIME_DIR}/sync.secret"
                log "HMAC secret provisioned from ${src}"
            else
                fail "secret file not found: ${src}"
            fi
            shift 2
            ;;
        *)
            warn "unknown argument: $1"
            shift
            ;;
    esac
done

if [[ ! -f "${RUNTIME_DIR}/sync.secret" ]]; then
    log "generating new HMAC secret"
    python3 -c "
import secrets
from pathlib import Path
p = Path('${RUNTIME_DIR}/sync.secret')
p.write_bytes(secrets.token_hex(32).encode())
p.chmod(0o600)
print(f'  wrote {p}')
print(f'  sha256: $(python3 -c \"import hashlib;print(hashlib.sha256(p.read_bytes()).hexdigest()[:12])\")')
" 2>/dev/null || {
        # Fallback without f-string interpolation issues.
        python3 - <<PYEOF
import secrets
from pathlib import Path
p = Path('${RUNTIME_DIR}/sync.secret')
p.write_bytes(secrets.token_hex(32).encode())
p.chmod(0o600)
import hashlib
print(f'  wrote {p}')
print(f'  sha256: {hashlib.sha256(p.read_bytes()).hexdigest()[:12]}')
PYEOF
    }
    log "share this secret with other Macs to enable sync"
fi

log "ready."
log "next steps:"
log "  1. Run the app: open /Applications/ABACO\\ Deep\\ Core.app"
log "  2. Verify sync: tailscale status"
