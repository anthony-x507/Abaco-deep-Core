# ARCHITECTURE — Vista técnica completa

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron Shell (TypeScript)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │  UI React   │  │  Auto-      │  │  Native     │               │
│  │  (renderer) │  │  updater    │  │  bridges    │               │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │
│         └─────────────────┴─────────────────┘                     │
│                            │ IPC                                 │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Python Core (abaco_deep_core)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  FastAPI     │  │  Plugin      │  │  Event       │           │
│  │  REST API    │  │  Manager     │  │  Ledger      │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         └─────────────────┴─────────────────┘                   │
│                            │                                    │
│  ┌─────────────────────────┴─────────────────────────┐          │
│  │  Domain: contracts, tickets, faces, tower         │          │
│  └─────────────────────────┬─────────────────────────┘          │
│                            │                                    │
│  ┌─────────────────────────┴─────────────────────────┐          │
│  │  Compaction: ledger, ticket, session             │          │
│  └─────────────────────────┬─────────────────────────┘          │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Sync Layer (peer-to-peer)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Node        │  │  Peer        │  │  Ledger      │           │
│  │  Identity    │  │  Registry    │  │  Sync        │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         └─────────────────┴─────────────────┘                   │
│                            │ HTTP + HMAC                        │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │   Tailscale mesh (private network)     │
        │   - MagicDNS for hostnames             │
        │   - WireGuard encryption               │
        │   - No public internet exposure        │
        └────────────────────────────────────────┘
```

## Componentes principales

### `desktop/` — Shell Electron

- **Renderer**: UI en React.
- **Main**: ciclo de vida del proceso principal, IPC, ventanas.
- **Preload**: puente seguro entre renderer y main.
- **Auto-updater**: `electron-updater` apuntando al feed en GitHub Releases.
- **Brand**: ícono `.icns`, logos SVG/PNG.

### `core/` — Núcleo Python

- **API FastAPI** con endpoints REST públicos y de admin.
- **Sistema de plugins** descubierto vía `entry_points` Python.
- **Eventos**: ledger append-only en JSONL con validación y resumen.
- **Tickets**: ledger de tickets.
- **Contratos**: registry y validación de schemas JSON.
- **Compactación**: archiving automático de eventos, tickets y sesiones.
- **Tower**: health signals y maintenance mode.

### `sync/` — Sincronización mesh

- **NodeIdentity**: UUID v4 persistente por Mac.
- **PeerDiscovery**: lee `tailscale status --json` con fallback offline.
- **PeerRegistry**: registro persistente de peers vistos.
- **MeshServer**: HTTP local que recibe envelopes firmados con HMAC.
- **MeshClient**: HTTP saliente hacia peers.
- **LedgerSync**: lee/escribe/mergea ledgers JSONL.
- **ConflictResolver**: Last-Writer-Wins por timestamp.
- **StateVector**: cursores para saber qué tiene cada peer.

### `build/` — Pipeline de release

- `make.sh`: build completo para arm64 y x64.
- `electron-builder.dev.cjs`: config unsigned.
- `verify-build.sh`: valida el `.app` resultante.
- `release-mac.sh`: sube el release a GitHub.
- `sign-stub.sh` y `notarize-stub.sh`: placeholders para cuando llegue Apple Developer.

## Flujo de datos

### Crear un evento local

1. Renderer envía POST a la API local.
2. FastAPI valida con `EventEnvelope`.
3. `AppendOnlyEventLedger.append()` escribe en `runtime/events/events.jsonl`.
4. Se publica un evento `system.compaction.check` para evaluar compactación.
5. El sync layer detecta el cambio en el ledger.
6. Push a peers alcanzables vía `MeshClient`.

### Sincronizar entre Macs

1. NodeA escribe un evento.
2. NodeA envía POST a NodeB con `SyncEnvelope` firmado.
3. NodeB valida HMAC.
4. NodeB aplica `LedgerSync.merge()` con LWW.
5. NodeB escribe en su ledger local.
6. NodeB devuelve ACK a NodeA.
7. NodeA actualiza `StateVector` para NodeB.

### Resolver conflicto

Dos Macs modifican el mismo registro con timestamps diferentes:

1. Ambas envían su versión al peer.
2. `ConflictResolver.last_writer_wins()` toma el de mayor timestamp.
3. Empates: se conserva el local (determinístico).
4. Resultado se persiste en ambos lados.

## Dependencias críticas

| Componente | Depende de |
|---|---|
| Renderer | Ninguna (HTML/JS/CSS) |
| Main process | `electron`, `electron-updater`, `@deepseek-ai/dsh-*` |
| Python core | `fastapi`, `uvicorn` |
| Sync | `python` stdlib solo |
| Build | `node`, `npm`, `electron-builder` |

## Limitaciones actuales (v0.1.0-unsigned-dev)

- App sin firma; Gatekeeper la bloquea hasta aplicar `xattr`.
- No hay TLS en sync; Tailscale aporta la red de confianza.
- No hay cola offline persistente para sync (los cambios se pierden si el peer está apagado en el momento).
- LWW puede descartar ediciones concurrentes sin advertencia.
- No hay backups automáticos entre peers.
