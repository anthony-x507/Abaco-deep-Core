# INSTALL — Instalar abaco-deep-core en una Mac nueva

Esta guía asume que descargaste el archivo `abaco-deep-core-mac-<arch>-<version>.zip` desde GitHub Releases.

## Requisitos

| Componente | Versión mínima |
|---|---|
| macOS | 12 Monterey |
| Tailscale | cualquier versión reciente (obligatorio para sync entre Macs) |
| Espacio en disco | 500 MB libres |

## Paso 1 — Descomprimir

1. Abre Finder y ve a Descargas.
2. Haz doble clic sobre `abaco-deep-core-mac-arm64-0.1.0.zip`.
3. Obtendrás `ABACO Deep Core.app`.

## Paso 2 — Mover a Aplicaciones

Arrastra `ABACO Deep Core.app` a la carpeta `/Applications`.

## Paso 3 — Quitar la cuarentena de macOS

Como la app **no está firmada** (Apple Developer pendiente), macOS la bloquea por seguridad. Hay dos formas de desbloquearla.

### Opción A — Click derecho

1. Abre Finder.
2. Ve a `/Applications`.
3. Click derecho sobre `ABACO Deep Core.app`.
4. Selecciona **Abrir**.
5. Confirma con **Abrir** en el diálogo.
6. Solo necesitas hacerlo la primera vez.

### Opción B — Terminal

```bash
xattr -dr com.apple.quarantine "/Applications/ABACO Deep Core.app"
```

Esto limpia el atributo de cuarentena recursivamente.

## Paso 4 — Primer lanzamiento

1. Abre `ABACO Deep Core` desde Aplicaciones o Spotlight.
2. La primera vez se generará una identidad de nodo única en `~/.abaco-deep-core/node.json`.
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

**Limitación actual**: como la app no está firmada, Gatekeeper bloqueará la actualización descargada. Aplica `xattr -dr com.apple.quarantine` sobre el nuevo bundle, o desinstala y vuelve a instalar manualmente.

## Verificación

Para confirmar que la instalación fue correcta:

```bash
ls -la "/Applications/ABACO Deep Core.app"
xattr "/Applications/ABACO Deep Core.app"
```

El segundo comando no debe mostrar `com.apple.quarantine`.

## Desinstalación

```bash
rm -rf "/Applications/ABACO Deep Core.app"
rm -rf ~/.abaco-deep-core
```

Esto borra la app y los datos locales de identidad y eventos.
