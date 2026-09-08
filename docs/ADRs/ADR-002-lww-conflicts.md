# ADR-002: Last-Writer-Wins para resolución de conflictos

## Estado
Aceptado.

## Contexto
Cuando dos Macs modifican el mismo registro sin estar sincronizadas, hay que decidir qué versión gana. Las opciones son:

1. **Last-Writer-Wins (LWW)**: gana el timestamp más reciente.
2. **First-Writer-Wins**: gana el primero que escribió.
3. **Vector clocks**: se detecta concurrencia y se pide intervención humana.
4. **CRDTs**: tipos de datos que fusionan automáticamente.
5. **Leader election**: solo un peer escribe a la vez.

## Decisión
Adoptamos **Last-Writer-Wins por timestamp** con empates deterministas.

## Consecuencias

### Positivas
- Simple de implementar: comparación de strings ISO-8601.
- Determinístico: el mismo input produce el mismo output.
- Sin overhead: cero mensajes adicionales.
- Aceptable para eventos append-only que dominan el dominio.

### Negativas
- Si dos Macs editan el mismo registro offline sin sincronizar, una edición se pierde silenciosamente.
- No hay detección de concurrencia: el usuario no se entera de que hubo conflicto.
- Empates: se conserva el local (regla arbitraria pero determinista).

## Alternativas consideradas

### Vector clocks
Rechazado por ahora. Requiere metadata adicional en cada registro y mensajes de sincronización más grandes. Se puede reconsiderar si el dominio crece.

### CRDTs
Rechazado por complejidad. El dominio (eventos JSONL) no requiere semánticas especiales de merge.

### Leader election
Rechazado porque bloquea la escritura cuando el líder está apagado. Contradice offline-first.

## Implementación

```python
def last_writer_wins(local: dict, remote: dict) -> dict:
    local_ts = local.get("occurred_at") or local.get("updated_at") or ""
    remote_ts = remote.get("occurred_at") or remote.get("updated_at") or ""
    if remote_ts > local_ts:
        return remote
    return local
```

## Roadmap

- v0.2.0: añadir contador de conflictos en audit log.
- v0.3.0: considerar vector clocks o CRDTs si la pérdida silenciosa se vuelve problema.

Fecha: 2026-09-08.
