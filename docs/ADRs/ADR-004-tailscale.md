# ADR-004: Tailscale como red de transporte

## Estado
Aceptado.

## Contexto
Necesitamos una red privada entre las Macs del usuario que:

1. No requiera abrir puertos en el router.
2. Funcione desde redes distintas (casa, oficina, café).
3. Cifre el tráfico.
4. No requiera configuración manual de IP.
5. Sea gratis o muy barato.

Opciones:

1. **Tailscale**: red privada basada en WireGuard con MagicDNS.
2. **ZeroTier**: similar pero menos pulido.
3. **Hole punching manual**: STUN + TURN, complejo.
4. **SSH tunnels**: requiere servidor central.
5. **ngrok / Cloudflare Tunnel**: pasa por internet público, no ideal para datos sensibles.

## Decisión
Adoptamos **Tailscale** como capa de transporte para sync.

## Consecuencias

### Positivas
- WireGuard: cifrado fuerte, baja latencia.
- MagicDNS: las Macs se resuelven por nombre (`anthonys-macbook.tail1234.ts.net`).
- NAT traversal automático.
- Gratis hasta 100 dispositivos en el plan personal.
- El usuario ya conoce Tailscale.

### Negativas
- Dependencia externa: si Tailscale cae, sync cae.
- Requiere cuenta (Google, GitHub, Microsoft, etc.).
- El usuario debe instalar Tailscale en cada Mac.

## Modo offline

Si Tailscale no está instalado o no está corriendo, el módulo sync degrada a modo offline:

- La app sigue funcionando localmente.
- Se loguea un warning en cada intento de sync.
- Cuando Tailscale vuelve, la app intenta reconectar automáticamente.

## Implementación

```python
def discover_tailscale_status() -> dict:
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=5
        )
        return json.loads(result.stdout)
    except Exception:
        return {}
```

## Alternativas consideradas

### ZeroTier
Rechazado. La CLI es menos pulida y la documentación de Python es más escasa.

### ngrok / Cloudflare Tunnel
Rechazado. Expone datos al internet público, lo cual viola el principio de "red privada".

### SSH tunnels
Rechazado por requerir un servidor central siempre encendido.

## Roadmap

- v0.1.0: Tailscale obligatorio.
- v0.2.0: evaluar soporte para ZeroTier como alternativa.
- v0.3.0: detección automática de Tailscale + fallback a LAN local (mDNS) si está en la misma red.

Fecha: 2026-09-08.
