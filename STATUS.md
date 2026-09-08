# Estado del proyecto abaco-deep-core

> Documento vivo que refleja el estado de cada componente.

Última actualización: 2026-09-08.

## Componentes principales

| Componente | Estado | Archivos | Tests | Notas |
|---|---|---|---|---|
| Sync Tailscale mesh | ✅ COMPLETO | 14 + 5 tests | 5/5 PASS | `sync/` |
| Compactación | 🟡 EN PROGRESO | 14 | pendiente | `core/compaction/` |
| Build pipeline | ✅ COMPLETO | 10 | N/A | `build/` |
| Tests integración | ✅ COMPLETO | 13 | 8 PASS / 15 SKIP | `tests/` |
| Documentación ES | ✅ COMPLETO | 12 | N/A | `docs/` |
| Core improvements | 🟡 EN PROGRESO | pendiente | pendiente | `abaco_core/` |
| Scripts de soporte | ✅ COMPLETO | 3 | N/A | `scripts/` |

## Qué está listo

### Sync mesh P2P (`sync/`)

- ✅ `NodeIdentity` persistente con UUID v4.
- ✅ `PeerDiscovery` con Tailscale JSON + fallback offline.
- ✅ `PeerRegistry` persistente.
- ✅ `MeshServer` HTTP con HMAC-SHA256.
- ✅ `MeshClient` HTTP saliente.
- ✅ `LedgerSync` para JSONL offline-first.
- ✅ `ConflictResolver` Last-Writer-Wins.
- ✅ `StateVector` con cursores por peer.
- ✅ `SyncConfig` con rutas y secretos.
- ✅ `SyncAPI` con endpoints dict-style.
- ✅ Tests: 5/5 PASS.

### Build pipeline (`build/`)

- ✅ `make.sh` para arm64 + x64.
- ✅ `release-mac.sh` con upload a GitHub.
- ✅ `verify-build.sh` con smoke launch.
- ✅ `electron-builder.dev.cjs` para unsigned.
- ✅ `sign-stub.sh` y `notarize-stub.sh` para Apple Dev futuro.
- ✅ `README.md` con troubleshooting.

### Tests integración (`tests/`)

- ✅ `FakeTailscale` simulado en proceso.
- ✅ Test de sync 2-nodos con LWW.
- ✅ Test de compactación con archivo.
- ✅ Test de 5-nodos convergiendo.
- ✅ Smoke tests de `abaco_core` (skip cuando falta módulo).
- ✅ 8 PASS, 15 SKIP, 0 FAIL.

### Documentación (`docs/`)

- ✅ Índice principal.
- ✅ INSTALL.md con `xattr -dr` y click-derecho.
- ✅ QUICKSTART.md de 5 pasos.
- ✅ ARCHITECTURE.md con diagrama ASCII.
- ✅ SYNC.md con protocolo.
- ✅ COMPACTION.md con políticas.
- ✅ SECURITY.md con modelo actual.
- ✅ TROUBLESHOOTING.md con casos comunes.
- ✅ 4 ADRs documentados.

### Scripts (`scripts/`)

- ✅ `verify-all.sh` corre todas las verificaciones.
- ✅ `bootstrap.sh` prepara una Mac nueva.

## Lo que falta

### Compactación (`core/compaction/`)

- 🟡 En progreso por subagente.
- Falta: tests que sí pasen ejecutándose localmente.

### Core improvements (`abaco_core/`)

- 🟡 En progreso por subagente.
- Falta: sistema de plugins completamente integrado.

## Limitaciones connues

1. App sin firma hasta que llegue Apple Developer.
2. Sync mesh solo entre nodos Tailscale activos simultáneamente.
3. LWW puede descartar ediciones concurrentes silenciosamente.
4. El feed de auto-updater es genérico (sin CDN propio).
5. Algunos tests de integración están SKIPPED esperando módulos que el subagente de core aún está terminando.

## Cómo verificar el estado actual

```bash
./scripts/verify-all.sh
```

Esto ejecuta todas las verificaciones estáticas y los tests que sí pueden correr.
