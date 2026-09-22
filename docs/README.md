# Índice de documentación

Bienvenido a la documentación de **ABACO DEEP HARNES** (`appId` `io.abaco.deepcore`), la shell de escritorio 0.4.x.

## Inicio rápido

| Documento | Para qué sirve |
|---|---|
| [INSTALL.md](INSTALL.md) | Instalar `abaco-deep-harnes-mac-arm64.dmg` → `ABACO DEEP HARNES.app` |
| [QUICKSTART.md](QUICKSTART.md) | Arrancar la app en 5 minutos |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Soluciones a problemas comunes |

## Arquitectura y diseño

| Documento | Para qué sirve |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Vista completa de los componentes |
| [SYNC.md](SYNC.md) | Cómo se sincronizan los datos entre Macs |
| [COMPACTION.md](COMPACTION.md) | Compactación automática del contexto |
| [SECURITY.md](SECURITY.md) | Modelo de seguridad actual |

## Contratos F1 / F2.1

| Documento | Para qué sirve |
|---|---|
| [CONTRACT-F1-MEDIACION-DEEP.md](contracts/CONTRACT-F1-MEDIACION-DEEP.md) | F1 day-14: mediación demostrable (broker grants + fail-closed suite) |
| [CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md](contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md) | F1 slice: authorize(), A_efectiva, M1–M10 |
| [STATUS-F1-MEDIACION.md](STATUS-F1-MEDIACION.md) | How to prove mediación (deny / audit / 0 side-effect) |
| [CONTRACT-F1-ADMISSION-IMMUTABLE.md](contracts/CONTRACT-F1-ADMISSION-IMMUTABLE.md) | F1 control-3: session admission graph sealed; skills/docs/memory/tool-results cannot enter, activate preload, or add patch.yml rows |
| [CONTRACT-F1.5-MCP-SCHEMA-PIN.md](contracts/CONTRACT-F1.5-MCP-SCHEMA-PIN.md) | F1.5: fail-closed pin/witness for `mcp__*` tool schemas |
| [CONTRACT-F1.5-MEMORY-PACKAGER.md](contracts/CONTRACT-F1.5-MEMORY-PACKAGER.md) | F1.5: procedencia fail-closed del packager de memoria 3 fases (profile/log/note); Pack A quarantine intacta |
| [CONTRACT-F2.1-C-STT-MAC.md](contracts/CONTRACT-F2.1-C-STT-MAC.md) | Pack C: STT Mac-only, Whisper local, cero fallback cloud silencioso. Linux §15/16 = hint fail-closed |
| [MATRIX-F1-DAY14-ACCEPTANCE.md](contracts/MATRIX-F1-DAY14-ACCEPTANCE.md) | F1 day-14 acceptance matrix (PASS/PARTIAL/N-A + evidence + Mac LIVE smoke) |

## Decisiones arquitectónicas

| ADR | Tema |
|---|---|
| [ADR-001](ADRs/ADR-001-mesh-sync.md) | Por qué sincronización mesh |
| [ADR-002](ADRs/ADR-002-lww-conflicts.md) | Por qué Last-Writer-Wins |
| [ADR-003](ADRs/ADR-003-unsigned-build.md) | Por qué build sin firma |
| [ADR-004](ADRs/ADR-004-tailscale.md) | Por qué Tailscale |

## Changelog

[CHANGELOG.md](../CHANGELOG.md) — Historial de versiones.
