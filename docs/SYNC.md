# SYNC — Sincronización entre Macs

## Modelo conceptual

```
Mac A (offline)         Mac B (online)
   │                        │
   │ escribe evento local   │  escribe evento local
   │                        │
   │ X (no sabe de B)      │ detecta peer A vía Tailscale
   │                        │
   │ cuando A vuelve:       │
   │ ◄── sync request ──────┤
   │ ── delta (A→B) ──────► │
   │ ◄── delta (B→A) ───────┤
   │                        │
   │ ambos convergieron     │
```

## Topología

**Mesh peer-to-peer**. Cada Mac habla directamente con cada otra Mac que esté en la misma red Tailscale. No hay servidor central.

### Ventajas

- Cero infraestructura adicional.
- Funciona con 2 Macs o con 20.
- Si una Mac se apaga, las demás siguen sincronizándose entre sí.

### Limitaciones

- Si una Mac está apagada por mucho tiempo, su delta crece.
- No hay detección de "partición de red" (las dos Macs creen que la otra no existe).

## Discovery de peers

1. Cada Mac corre `tailscale status --json` periódicamente.
2. El JSON contiene la lista de nodos en la red, sus IPs Tailscale (100.x.x.x) y hostnames.
3. `PeerDiscovery` filtra los nodos que están online.
4. `PeerRegistry` mantiene la lista persistente en `~/.abaco-deep-core/peers.json`.

Si Tailscale no está instalado o no está corriendo, el módulo degrada a modo offline y loguea un warning. La app sigue funcionando localmente.

## Protocolo de transporte

HTTP plano sobre la red Tailscale (que ya está cifrada con WireGuard). Puerto por defecto: `8765`.

Cada request lleva:

- Header `X-Abaco-Node-Id`: identificador del emisor.
- Header `X-Abaco-Signature`: HMAC-SHA256 del body usando el secreto compartido.
- Header `X-Abaco-Timestamp`: ISO-8601 del momento del envío.

Si la firma no coincide → 401 + audit log `sync.invalid_signature`.

## Envelope

```python
@dataclass(frozen=True)
class SyncEnvelope:
    sender_node_id: str
    receiver_node_id: str | None   # None = broadcast
    ledger_name: str                # "events", "tickets", "faces"
    operation: str                  # "push", "pull", "delta"
    since_timestamp: str | None     # cursor para pull/delta
    records: tuple[dict, ...]
    signature: str                  # HMAC-SHA256 hex
    sent_at: str                    # ISO-8601
```

## Operaciones

### `pull`

Un peer le pide a otro todos los registros posteriores a `since_timestamp`. Se usa cuando un nodo estuvo offline y quiere saber qué se perdió.

### `push`

Un peer envía nuevos registros que tiene localmente. El receptor aplica LWW antes de escribir.

### `delta`

Una combinación: emisor envía lo que tiene y pide lo que le falta. Es la operación más eficiente para sincronización completa.

### `broadcast`

`receiver_node_id = None`. Se envía a todos los peers conocidos. Útil para anuncios cortos como "nueva versión disponible".

## Resolución de conflictos: Last-Writer-Wins

```
local:  {id: "abc", ts: "2026-09-08T10:00:00Z", value: "X"}
remote: {id: "abc", ts: "2026-09-08T10:05:00Z", value: "Y"}

winner: remote (ts mayor)
```

Si los timestamps son idénticos, se conserva el registro local (regla determinística).

### Por qué LWW

- **Simple**. No requiere coordinación.
- **Predecible**. El resultado es siempre el mismo.
- **Suficiente para append-only**. Los eventos no se editan, solo se agregan.
- **Costo bajo**. Sin vector clocks ni CRDTs.

### Limitación

Si dos Macs editan el mismo registro offline sin sincronizar, una edición se pierde silenciosamente. Para v0.1.0 es aceptable. Para v0.2.0 podría agregarse vector clocks o CRDT por entidad.

## Estado y cursores

`StateVector` guarda, por peer, el timestamp del último registro conocido:

```python
{
    "node_b": "2026-09-08T10:05:00Z",
    "node_c": "2026-09-08T09:50:00Z"
}
```

Antes de pedir un delta, se usa `state_vector[peer]` como `since_timestamp`.

## Seguridad

- HMAC-SHA256 con secreto compartido entre Macs.
- El secreto se guarda en `~/.abaco-deep-core/sync.secret` con permisos 0600.
- El secreto debe provisionarse una vez (manual o mediante un canal seguro).
- Sin TLS porque Tailscale ya cifra a nivel de red.

## Limitaciones actuales

- Sin cola offline persistente: si un peer está apagado, los broadcasts no se reintentan.
- Sin backoff exponencial: si un peer está sobrecargado, se le sigue pegando.
- Sin rate limiting: un peer comprometido podría enviar millones de envelopes.

Estos puntos están en el roadmap para v0.2.0.
