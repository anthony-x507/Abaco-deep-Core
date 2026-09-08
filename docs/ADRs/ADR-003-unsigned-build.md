# ADR-003: Build sin firma de Apple Developer

## Estado
Aceptado (temporal, hasta recibir Apple Developer).

## Contexto
El usuario no tiene Apple Developer ID todavía. Sin firma, macOS Gatekeeper bloquea cualquier `.app` distribuido fuera de la Mac App Store. Opciones:

1. **Esperar al Apple Developer**: no se puede distribuir nada.
2. **Build sin firma + instrucciones manuales**: el usuario aplica `xattr -dr com.apple.quarantine` después de descargar.
3. **Build firmado con identidad auto-generada**: sigue requiriendo Gatekeeper bypass.
4. **Distribución vía Mac App Store**: requiere Apple Developer y review.

## Decisión
Adoptamos **build sin firma** con instrucciones claras de instalación.

## Consecuencias

### Positivas
- El usuario puede distribuir ZIPs inmediatamente.
- No hay costo de Apple Developer.
- El pipeline de release funciona end-to-end desde el día uno.
- Cuando llegue Apple Developer, solo se cambian flags en `electron-builder.dev.cjs`.

### Negativas
- macOS Gatekeeper bloquea el primer launch.
- Cada update descargado vuelve a ser bloqueado.
- No hay protección contra tampering: cualquiera puede redistribuir el ZIP modificado.
- La experiencia de instalación es peor que con firma.

## Implementación

```js
mac: {
  hardenedRuntime: false,
  gatekeeperAssess: false,
  identity: null,
  notarize: false
}
```

## Activación de firma cuando llegue Apple Developer

Pasos documentados en `docs/SECURITY.md`:

```bash
export APPLE_ID="anthony@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
```

Y en el `.cjs`:

```js
mac: {
  hardenedRuntime: true,
  gatekeeperAssess: true,
  identity: "Developer ID Application: Anthony Sanchez (...)",
  notarize: true
}
```

## Stubs preparados

- `build/sign-stub.sh`: muestra las env vars necesarias.
- `build/notarize-stub.sh`: muestra cómo usar `xcrun notarytool`.

## Roadmap

- Inmediato: build sin firma + instrucciones.
- Cuando llegue Apple Dev: firma + notarización.
- Post-firma: distribuir vía Mac App Store si el volumen lo justifica.

Fecha: 2026-09-08.
