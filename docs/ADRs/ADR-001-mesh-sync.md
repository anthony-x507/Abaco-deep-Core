# ADR-001: Sincronización mesh peer-to-peer

## Estado
Aceptado.

## Contexto
El usuario quiere que cuando use la app en varias Macs, los cambios se reflejen automáticamente entre ellas. Había tres opciones:

1. **Hub central**: un servidor siempre encendido coordina.
2. **Mesh peer-to-peer**: cada Mac habla directamente con las demás.
3. **Híbrido**: hub con fallback mesh.

## Decisión
Adoptamos **mesh peer-to-peer** peer-to-peer entre nodos Tailscale, sin servidor central.

## Consecuencias

### Positivas
- Cero infraestructura adicional: solo Tailscale.
- Funciona desde 2 Macs hasta docenas.
- Si una Mac se apaga, las demás siguen sincronizándose.
- No hay punto único de fallo.
- No hay costo de servidor.

### Negativas
- Si una Mac está apagada por días, su delta crece linealmente.
- No hay orden global: cada peer decide cuándo sincronizar.
- Sin servidor central, no hay backup automático.
- Las Macs deben poder hablarse directamente (Tailscale lo permite).

## Alternativas consideradas

### Hub central
Rechazado porque requiere mantener un servidor encendido 24/7. El usuario ya tiene Macs encendidas durante su uso; no quiere añadir un servidor más.

### Híbrido
Rechazado por complejidad. Se puede reconsiderar en v0.3.0 si el mesh no escala bien.

## Notas de implementación

- Transporte: HTTP plano sobre Tailscale (WireGuard ya cifra).
- Puerto por defecto: 8765.
- Autenticación: HMAC-SHA256 con secreto compartido.
- Discovery: `tailscale status --json`.
- Modo offline-first: si no hay Tailscale, la app sigue funcionando local.

Fecha: 2026-09-08.
