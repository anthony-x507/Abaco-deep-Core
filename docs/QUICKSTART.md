# QUICKSTART — Arrancar en 5 minutos

## 1. Descargar

Ve a [Releases](https://github.com/anthony-x507/Abaco-deep-Core/releases) y descarga el `.zip` que coincida con tu Mac:

- `abaco-deep-core-mac-arm64-0.1.0.zip` — Apple Silicon (M1/M2/M3/M4)
- `abaco-deep-core-mac-x64-0.1.0.zip` — Intel

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

```bash
cd ~/Downloads
unzip abaco-deep-core-mac-arm64-0.1.0.zip
mv "ABACO Deep Core.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/ABACO Deep Core.app"
```

## 4. Lanzar

Abre `ABACO Deep Core` desde Spotlight o Aplicaciones.

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
