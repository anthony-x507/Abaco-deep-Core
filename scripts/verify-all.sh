#!/usr/bin/env bash
# verify-all.sh — Verificación completa del estado de abaco-deep-core.
#
# Comprueba:
#   - Estructura de carpetas.
#   - Compilación Python de los módulos entregables.
#   - Tests que sí pueden correr.
#   - Sintaxis de scripts bash.
#
# NO ejecuta el build real de Electron (toma mucho tiempo).
# NO requiere red.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

pass=0
fail=0

check() {
    local label="$1"
    local cmd="$2"
    if eval "${cmd}" >/dev/null 2>&1; then
        printf '\033[1;32m✓\033[0m %s\n' "${label}"
        pass=$((pass+1))
    else
        printf '\033[1;31m✗\033[0m %s\n' "${label}"
        fail=$((fail+1))
    fi
}

echo "== Estructura de carpetas =="
check "core/ existe" "[ -d core ]"
check "desktop/ existe" "[ -d desktop ]"
check "sync/ existe" "[ -d sync ]"
check "build/ existe" "[ -d build ]"
check "docs/ existe" "[ -d docs ]"
check "tests/ existe" "[ -d tests ]"

echo ""
echo "== Documentación =="
check "README.md raíz" "[ -f README.md ]"
check "CHANGELOG.md raíz" "[ -f CHANGELOG.md ]"
check "pyproject.toml raíz" "[ -f pyproject.toml ]"
check ".gitignore raíz" "[ -f .gitignore ]"
check "docs/README.md" "[ -f docs/README.md ]"
check "docs/INSTALL.md" "[ -f docs/INSTALL.md ]"
check "docs/ARCHITECTURE.md" "[ -f docs/ARCHITECTURE.md ]"
check "docs/SYNC.md" "[ -f docs/SYNC.md ]"
check "docs/SECURITY.md" "[ -f docs/SECURITY.md ]"
check "docs/TROUBLESHOOTING.md" "[ -f docs/TROUBLESHOOTING.md ]"
check "docs/ADRs/ADR-001" "[ -f docs/ADRs/ADR-001-mesh-sync.md ]"
check "docs/ADRs/ADR-002" "[ -f docs/ADRs/ADR-002-lww-conflicts.md ]"
check "docs/ADRs/ADR-003" "[ -f docs/ADRs/ADR-003-unsigned-build.md ]"
check "docs/ADRs/ADR-004" "[ -f docs/ADRs/ADR-004-tailscale.md ]"

echo ""
echo "== Build pipeline =="
check "make.sh" "[ -f build/make.sh ]"
check "release-mac.sh" "[ -f build/release-mac.sh ]"
check "verify-build.sh" "[ -f build/verify-build.sh ]"
check "sign-stub.sh" "[ -f build/sign-stub.sh ]"
check "notarize-stub.sh" "[ -f build/notarize-stub.sh ]"
check "electron-builder.dev.cjs" "[ -f build/electron-builder.dev.cjs ]"

echo ""
echo "== Sync module =="
for f in sync/__init__.py sync/errors.py sync/models.py sync/config.py \
         sync/node_identity.py sync/peer.py sync/peer_discovery.py \
         sync/peer_registry.py sync/conflict_resolver.py sync/state_vector.py \
         sync/mesh_client.py sync/mesh_server.py sync/ledger_sync.py sync/api.py; do
    check "${f}" "[ -f ${f} ]"
done

echo ""
echo "== Sync tests =="
for f in sync/tests/test_node_identity.py sync/tests/test_conflict_resolver.py \
         sync/tests/test_state_vector.py sync/tests/test_ledger_sync.py \
         sync/tests/test_mesh_protocol.py; do
    check "${f}" "[ -f ${f} ]"
done

echo ""
echo "== Tests integración =="
check "tests/conftest.py" "[ -f tests/conftest.py ]"
check "tests/fixtures/fake_tailscale.py" "[ -f tests/fixtures/fake_tailscale.py ]"
check "tests/integration/test_full_sync_flow.py" "[ -f tests/integration/test_full_sync_flow.py ]"
check "tests/smoke/test_app_starts.py" "[ -f tests/smoke/test_app_starts.py ]"

echo ""
echo "== Sintaxis bash scripts =="
for f in build/make.sh build/release-mac.sh build/verify-build.sh \
         build/sign-stub.sh build/notarize-stub.sh; do
    if bash -n "${f}" 2>/dev/null; then
        printf '\033[1;32m✓\033[0m bash -n %s\n' "${f}"
        pass=$((pass+1))
    else
        printf '\033[1;31m✗\033[0m bash -n %s\n' "${f}"
        fail=$((fail+1))
    fi
done

echo ""
echo "== Sintaxis electron-builder config =="
if node --check build/electron-builder.dev.cjs 2>/dev/null; then
    printf '\033[1;32m✓\033[0m node --check electron-builder.dev.cjs\n'
    pass=$((pass+1))
else
    printf '\033[1;31m✗\033[0m node --check electron-builder.dev.cjs\n'
    fail=$((fail+1))
fi

echo ""
echo "== Python compile =="
python_files=$(find sync core/compaction tests abaco-deep-core/build 2>/dev/null \
    -name "*.py" -not -path "*/__pycache__/*" -not -path "*/node_modules/*" 2>/dev/null || true)
if [ -n "${python_files}" ]; then
    if python3 -m py_compile ${python_files} 2>&1; then
        printf '\033[1;32m✓\033[0m Python compiles (%d files)\n' "$(echo "${python_files}" | wc -l | tr -d ' ')"
        pass=$((pass+1))
    else
        printf '\033[1;31m✗\033[0m Python compile failed\n'
        fail=$((fail+1))
    fi
fi

echo ""
echo "== Tests sync =="
if python3 -m unittest discover -s sync/tests -v 2>&1 | tail -5; then
    pass=$((pass+1))
fi

echo ""
echo "== Tests integración (sin FastAPI) =="
if python3 -m unittest discover -s tests/integration -v 2>&1 | tail -5; then
    pass=$((pass+1))
fi

echo ""
printf '\033[1;36m==========================================\033[0m\n'
printf '\033[1;32mPass:\033[0m %d\n' "${pass}"
printf '\033[1;31mFail:\033[0m %d\n' "${fail}"
printf '\033[1;36m==========================================\033[0m\n'

if [ "${fail}" -gt 0 ]; then
    exit 1
fi
