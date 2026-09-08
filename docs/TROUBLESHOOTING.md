# TROUBLESHOOTING — Problemas comunes y soluciones

## "App dañada, muévela a la papelera"

**Causa**: macOS Gatekeeper bloquea la app porque no está firmada.

**Solución**:

```bash
xattr -dr com.apple.quarantine "/Applications/ABACO Deep Core.app"
```

O click derecho sobre el `.app` → Abrir → confirmar Abrir.

## La app abre pero no sincroniza

**Checklist**:

1. ¿Tailscale está corriendo?

```bash
tailscale status
```

Debe mostrar tu Mac como `online`.

2. ¿Las otras Macs están en la misma red Tailscale?

```bash
tailscale status
```

Las demás Macs deben aparecer como peers.

3. ¿El puerto 8765 está disponible?

```bash
lsof -i :8765
```

Si está ocupado, ciérralo o cambia el puerto en `SyncConfig`.

4. ¿El secreto HMAC coincide en ambas Macs?

```bash
shasum ~/.abaco-deep-core/sync.secret
```

Debe ser idéntico en todas las Macs que quieras sincronizar.

## Conflictos raros aparecen en logs

**Síntoma**: ves muchos eventos `sync.conflict_resolved` con `kept_remote=true`.

**Causa probable**: dos Macs escribieron el mismo registro con timestamps diferentes.

**Solución**: este es el comportamiento esperado de LWW. Si necesitas más precisión, espera a v0.2.0 (vector clocks).

## La app no actualiza

**Síntomas**: el badge de "update available" no aparece o la descarga falla.

**Checklist**:

1. ¿Hay internet para llegar a GitHub?

```bash
curl -I https://github.com/anthony-x507/Abaco-deep-Core/releases/latest
```

2. ¿El feed está accesible?

```bash
curl -I https://github.com/anthony-x507/Abaco-deep-Core/releases/latest/download/latest-mac.yml
```

3. ¿Gatekeeper bloqueó la actualización?

Revisa la consola de la app: si ves "code signature invalid", aplica:

```bash
xattr -dr com.apple.quarantine "/Applications/ABACO Deep Core.app"
```

Si persiste, desinstala manualmente y vuelve a instalar.

## "Cannot find module @deepseek-ai/dsh-..."

**Causa**: faltan dependencias npm.

**Solución**:

```bash
cd desktop/src/dsh-desktop
npm install
```

## Puerto 8765 ocupado

**Síntoma**: la app arranca pero sync falla con "address already in use".

**Solución temporal**:

```bash
lsof -i :8765
kill <PID>
```

**Solución permanente**: cambia el puerto en `~/.abaco-deep-core/config.json` o configura `SyncConfig(port=...)`.

## La identidad del nodo se corrompió

**Síntoma**: la app no arranca y los logs muestran "Invalid identity file".

**Solución**:

```bash
rm ~/.abaco-deep-core/node.json
```

La próxima vez que arranques la app se generará una nueva identidad. **Advertencia**: esto hace que las demás Macs la vean como un nodo nuevo y reinicien la sincronización.

## Reset completo

Para volver a un estado limpio:

```bash
# Cerrar la app primero
rm -rf ~/.abaco-deep-core
rm -rf "/Applications/ABACO Deep Core.app"
```

Reinstalar desde cero.

## Reportar un bug

Si nada de esto funciona, abre un issue en GitHub con:

1. Versión de macOS (`sw_vers`).
2. Versión de la app (menú About).
3. Versión de Tailscale (`tailscale version`).
4. Logs de la app (`~/Library/Logs/abaco-deep-core/`).
5. Pasos para reproducir.
