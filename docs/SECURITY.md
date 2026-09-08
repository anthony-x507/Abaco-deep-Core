# SECURITY — Modelo de seguridad actual

> **Estado del documento**: v0.1.0-unsigned-dev (sin firma, sin notarización).

## Resumen ejecutivo

La app **no está firmada** (Apple Developer pendiente). Esto significa:

- macOS Gatekeeper la bloquea por defecto.
- El usuario debe aplicar `xattr -dr com.apple.quarantine` o abrirla con click derecho.
- No hay protección si alguien la redistribuye modificada.
- **No se debe distribuir públicamente** sin firmar.

## Lo que SÍ está protegido

| Capa | Mecanismo |
|---|---|
| Red entre Macs | Tailscale (WireGuard) |
| API entre Macs | HMAC-SHA256 con secreto compartido |
| Identidad de nodo | UUID v4 persistente en `~/.abaco-deep-core/node.json` |
| Permisos de archivos | 0600 en secretos, 0700 en directorios privados |
| Secretos en logs | Redacción automática de tokens, passwords, etc. |
| Render del frontend | `contextIsolation: true`, `nodeIntegration: false` |

## Lo que NO está protegido todavía

| Vector | Riesgo | Mitigación futura |
|---|---|---|
| App sin firma | Redistribución maliciosa trivial | Firmar con Developer ID |
| Sin notarización | Gatekeeper la bloquea siempre | Notarizar cuando llegue Apple Dev |
| Sin TLS en sync | Confía en Tailscale | OK si Tailscale es la red |
| Cola sync sin cifrado | Si alguien captura el disco, lee | Cifrar `runtime/` con FileVault |
| Sin sandbox de plugins | Un plugin puede hacer daño | Activar sandbox en Electron |

## Cómo se manejan los secretos

### Secretos de la app

- **Sync HMAC**: `~/.abaco-deep-core/sync.secret` (0600).
- **Identidad**: `~/.abaco-deep-core/node.json` (0600).
- **Peers conocidos**: `~/.abaco-deep-core/peers.json` (0600).

### Secretos que el usuario mete

- API keys de modelos (DeepSeek, OpenAI, Anthropic, etc.) → almacenados en el sistema de credenciales del SO (Keychain en macOS).
- Tokens de Tailscale → manejados por Tailscale, no por la app.

### Lo que NUNCA debe estar en disco plano

- JWT de clientes.
- Tokens de pasarelas de pago (YAPI, Stripe, etc.).
- HMAC secrets de servicios externos.
- Cookies de sesión.
- Resultados de OCR o transcripciones que contengan datos personales sensibles.

La app redacta automáticamente en logs y respuestas `/api/status` cualquier campo cuyo nombre contenga:

```python
SECRET_KEY_MARKERS = (
    "token", "secret", "api_key", "apikey",
    "password", "credential"
)
```

Esto se valida con el test `test_secret_not_in_public_status`.

## Permisos por capability

```python
class PluginManifest:
    permissions: tuple[str, ...] = (
        "events.publish",
        "events.subscribe",
        "contracts.read",
        "contracts.write",
        "tickets.read",
        "tickets.write",
        "storage.read",
        "storage.write",
        "fs.read",       # limitado al workspace del plugin
        "fs.write",
        "network.outbound",
    )
```

Cada endpoint valida explícitamente el permiso requerido. Si no está declarado en el manifest, el plugin no puede usarlo.

## Sandboxing

- **Renderer**: `contextIsolation: true`, `sandbox: true` (cuando se active).
- **Plugins Python**: se ejecutan en el mismo proceso pero solo ven lo que el `PluginContext` les pasa.
- **Sync daemon**: corre como thread dentro del main process, no como proceso separado.

## Cuando llegue Apple Developer

Pasos para endurecer:

1. Obtener `Developer ID Application: Anthony Sanchez (...)`.
2. Exportar como `.p12` y guardar en Keychain.
3. Configurar variables de entorno:

```bash
export APPLE_ID="anthony@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
```

4. Habilitar en `build/electron-builder.dev.cjs`:

```js
mac: {
  hardenedRuntime: true,
  gatekeeperAssess: true,
  identity: "Developer ID Application: Anthony Sanchez (...)",
  notarize: true
}
```

5. Reconstruir con `./build/make.sh`.

6. Validar con `spctl --assess --verbose "/Applications/ABACO Deep Core.app"`.

## Reportar vulnerabilidades

Si encuentras un problema de seguridad:

- **No abras un issue público** hasta que se corrija.
- Contacto: Anthony Sanchez.
- Coordina por canal privado.

## Roadmap de seguridad

- [ ] Activar sandbox del renderer en Electron.
- [ ] Mover sync daemon a proceso separado con permisos reducidos.
- [ ] Implementar rate limiting en endpoints públicos.
- [ ] Añadir Content Security Policy estricta.
- [ ] Cifrar `runtime/` en reposo.
- [ ] Implementar revocación de identidad de nodo.
