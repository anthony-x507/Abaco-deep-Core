# COMPACTION — Compactación automática de contexto

## Qué se compacta

| Recurso | Cuándo se compacta | Qué pasa con lo viejo |
|---|---|---|
| Event ledger | Cuando supera N bytes o N líneas | Se mueve a `archive/events-YYYYMMDD.jsonl` |
| Ticket ledger | Tickets cerrados con más de N días | Se mueven a `archive/tickets-YYYYMMDD.jsonl` |
| Sesiones de chat | Cuando la sesión supera N turnos | Se resume lo viejo, se mantienen los recientes |

## Política

```python
@dataclass(frozen=True)
class CompactionPolicy:
    name: str
    max_bytes: int | None = None       # límite por bytes
    max_lines: int | None = None      # límite por líneas
    max_age_days: int | None = None   # límite por edad
    max_count: int | None = None      # límite por cantidad
    keep_recent: int = 100            # cuántos registros quedan activos
    archive_path_pattern: str = "archive/{ledger}-{date}.jsonl"
```

Hay tres fábricas:

```python
size_based_policy("events-by-size", max_bytes=10_000_000, keep_recent=500)
time_based_policy("events-by-age", max_age_days=30, keep_recent=200)
count_based_policy("events-by-count", max_count=10_000, keep_recent=100)
```

Se pueden combinar: una sola política puede fijar `max_bytes` Y `max_age_days`. La compactación se dispara si **cualquiera** se cumple.

## Reversibilidad

La compactación **nunca borra**. Siempre mueve registros a un archivo de archivo:

```
runtime/events/events.jsonl       (registros recientes)
runtime/events/archive/events-20260908-103045.jsonl  (lo viejo)
```

Para restaurar:

```bash
cat runtime/events/archive/events-20260908-103045.jsonl >> runtime/events/events.jsonl
```

Y reiniciar la app.

## Scheduler

Tres modos:

| Modo | Cuándo corre |
|---|---|
| `manual` | Solo cuando la API lo invoca |
| `on_write` | Después de N escrituras en el ledger |
| `interval` | Cada X segundos en background |

Por defecto está en `manual`. Para activar `interval`:

```python
from core.compaction import CompactionScheduler
scheduler = CompactionScheduler(mode="interval", interval_seconds=3600)
scheduler.add_policy(size_based_policy("events", max_bytes=5_000_000))
scheduler.start()
```

## Eventos

Cada compactación emite:

```python
system.compaction.started
system.compaction.completed  (con records_archived, bytes_before, bytes_after)
system.compaction.failed     (con error_code)
```

Estos eventos van al ledger de eventos y son visibles en `/api/events`.

## Resúmenes de sesión

Cuando una sesión de chat crece mucho, `SessionCompactor` genera un resumen determinista sin llamar a un LLM:

- Conteo de turnos del usuario vs del asistente.
- Tipos de tools más usadas.
- Errores más frecuentes.
- Lista de IDs de archivos tocados.
- Timestamps clave (inicio, último turno, próximo a compactar).

El resumen se agrega al ledger como un evento `session.compacted` con el campo `summary` en el payload.

## Configuración recomendada

Para empezar:

```python
size_based_policy("events-default", max_bytes=10_000_000, keep_recent=1000)
time_based_policy("events-old", max_age_days=90, keep_recent=500)
```

Y programarla en modo `on_write` con threshold=500 escrituras.

## Limitaciones

- Los resúmenes son heurísticos, no semánticos. No entienden el contenido.
- Si el archivo de archivo se borra, la información se pierde.
- No hay deduplicación: si el mismo registro se archiva dos veces, aparece dos veces.

## Próximos pasos

- [ ] Compresión gzip de los archivos de archivo.
- [ ] Deduplicación por `event_id`.
- [ ] Resúmenes semánticos opcionales (configurable por el usuario).
