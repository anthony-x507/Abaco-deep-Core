# INSTALL — Instalar ABACO DEEP HARNES en una Mac nueva

Esta guía asume que descargaste `abaco-deep-harnes-mac-arm64.dmg` (o el ZIP del mismo stem) desde GitHub Releases. La app visible es **ABACO DEEP HARNES.app**. Bundle ID: `io.abaco.deepcore`. La línea actual es **0.4.x**.

## Requisitos

| Componente | Versión mínima |
|---|---|
| macOS | 12 Monterey |
| Tailscale | cualquier versión reciente (obligatorio para sync entre Macs) |
| Espacio en disco | 500 MB libres |

## Paso 1 — Abrir el DMG

1. Abre Finder y ve a Descargas.
2. Haz doble clic sobre `abaco-deep-harnes-mac-arm64.dmg` (Apple Silicon). Intel: `abaco-deep-harnes-mac-x64.dmg`.
3. Obtendrás `ABACO DEEP HARNES.app`.

Si en su lugar tienes un ZIP (`abaco-deep-harnes-mac-arm64.zip`), descomprímelo: el bundle dentro también se llama `ABACO DEEP HARNES.app`.

## Paso 2 — Mover a Aplicaciones

Arrastra `ABACO DEEP HARNES.app` a la carpeta `/Applications`.

## Paso 3 — Quitar la cuarentena de macOS (si Gatekeeper bloquea)

Las builds 0.4.x se publican como DMG. Si macOS aún bloquea el primer lanzamiento, hay dos formas de desbloquearla.

### Opción A — Click derecho

1. Abre Finder.
2. Ve a `/Applications`.
3. Click derecho sobre `ABACO DEEP HARNES.app`.
4. Selecciona **Abrir**.
5. Confirma con **Abrir** en el diálogo.
6. Solo necesitas hacerlo la primera vez.

### Opción B — Terminal

```bash
xattr -dr com.apple.quarantine "/Applications/ABACO DEEP HARNES.app"
```

Esto limpia el atributo de cuarentena recursivamente.

## Paso 4 — Primer lanzamiento

1. Abre `ABACO DEEP HARNES` desde Aplicaciones o Spotlight.
2. Los datos de usuario viven en `~/Library/Application Support/abaco-deep-core/` (ese nombre de carpeta no es el nombre del producto).
3. Verás la ventana principal.

## Paso 5 — Activar sync

1. Asegúrate de tener Tailscale instalado y en ejecución.
2. Inicia sesión con tu cuenta Tailscale.
3. La app detecta automáticamente los demás nodos en la misma red Tailscale.
4. El indicador de sync cambia de "offline" a "mesh" en cuanto hay un peer alcanzable.

## Actualizaciones automáticas

La app incluye `electron-updater`. Cuando publiques una nueva release en GitHub:

1. La app detecta la nueva versión al iniciarse.
2. Te pregunta si quieres descargar e instalar.
3. Reinicia para aplicar.

Si Gatekeeper bloquea una actualización descargada, aplica `xattr -dr com.apple.quarantine` sobre el nuevo bundle, o desinstala y vuelve a instalar el DMG.

## Verificación

Para confirmar que la instalación fue correcta:

```bash
ls -la "/Applications/ABACO DEEP HARNES.app"
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/Applications/ABACO DEEP HARNES.app/Contents/Info.plist"
xattr "/Applications/ABACO DEEP HARNES.app"
```

El Bundle ID debe ser `io.abaco.deepcore`. El segundo comando `xattr` no debe mostrar `com.apple.quarantine`.

## Desinstalación

```bash
rm -rf "/Applications/ABACO DEEP HARNES.app"
rm -rf ~/Library/Application\ Support/abaco-deep-core
```

Esto borra la app y los datos locales. No toques `~/Library/Application Support/dsh-desktop` (perfil de otra app).
