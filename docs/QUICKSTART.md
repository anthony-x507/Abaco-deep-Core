# QUICKSTART — Arrancar en 5 minutos

## 1. Descargar

Ve a [Releases](https://github.com/anthony-x507/Abaco-deep-Core/releases) y descarga el instalador 0.4.x que coincida con tu Mac:

- `abaco-deep-harnes-mac-arm64.dmg` — Apple Silicon (M1/M2/M3/M4)
- `abaco-deep-harnes-mac-x64.dmg` — Intel

La app dentro es `ABACO DEEP HARNES.app`. Bundle ID: `io.abaco.deepcore`.

## 2. Instalar Tailscale

Si no lo tienes:

1. Ve a https://tailscale.com/download/mac.
2. Instala el `.dmg`.
3. Inicia sesión con tu cuenta (Google, GitHub, Microsoft, etc.).
4. Verifica con:

```bash
tailscale status
```

Debes ver tu Mac listada.

## 3. Instalar la app

Ver [INSTALL.md](INSTALL.md) en detalle. Resumen:

Abre `abaco-deep-harnes-mac-arm64.dmg` desde Finder y arrastra `ABACO DEEP HARNES.app` a `/Applications`. Si Gatekeeper bloquea:

```bash
xattr -dr com.apple.quarantine "/Applications/ABACO DEEP HARNES.app"
```

Si descargaste el ZIP en lugar del DMG:

```bash
cd ~/Downloads
unzip abaco-deep-harnes-mac-arm64.zip
mv "ABACO DEEP HARNES.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/ABACO DEEP HARNES.app"
```

## 4. Lanzar

Abre `ABACO DEEP HARNES` desde Spotlight o Aplicaciones.

## 5. Verificar sync

En la barra de estado inferior de la app:

- **offline** — sin Tailscale activo.
- **solo** — Tailscale activo, sin otros peers.
- **mesh** — sincronizando con al menos un peer.

Para probar sync entre dos Macs:

1. Repite los pasos en otra Mac.
2. Ambas Macs deben estar en la misma red Tailscale.
3. Crea un evento en una Mac (escribe algo en el chat).
4. En menos de 5 segundos debe aparecer en la otra Mac.

## Siguientes pasos

- Lee [ARCHITECTURE.md](ARCHITECTURE.md) para entender los componentes.
- Lee [SYNC.md](SYNC.md) para entender el modelo de sincronización.
- Lee [SECURITY.md](SECURITY.md) para saber qué está protegido y qué no.
