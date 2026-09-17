# Índice de documentación

Bienvenido a la documentación de **abaco-deep-core**, la shell de escritorio que sincroniza tu trabajo entre Macs.

## Inicio rápido

| Documento | Para qué sirve |
|---|---|
| [INSTALL.md](INSTALL.md) | Instalar el `.zip` descargado en una Mac nueva |
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
| [CONTRACT-F1-ADMISSION-IMMUTABLE.md](contracts/CONTRACT-F1-ADMISSION-IMMUTABLE.md) | F1 control-3: session admission graph sealed; skills/docs/memory/tool-results cannot enter, activate preload, or add patch.yml rows |
| [CONTRACT-F2.1-C-STT-MAC.md](contracts/CONTRACT-F2.1-C-STT-MAC.md) | Pack C: STT Mac-only, Whisper local, cero fallback cloud silencioso. Linux §15/16 = hint fail-closed |

## Decisiones arquitectónicas

| ADR | Tema |
|---|---|
| [ADR-001](ADRs/ADR-001-mesh-sync.md) | Por qué sincronización mesh |
| [ADR-002](ADRs/ADR-002-lww-conflicts.md) | Por qué Last-Writer-Wins |
| [ADR-003](ADRs/ADR-003-unsigned-build.md) | Por qué build sin firma |
| [ADR-004](ADRs/ADR-004-tailscale.md) | Por qué Tailscale |

## Changelog

[CHANGELOG.md](../CHANGELOG.md) — Historial de versiones.
