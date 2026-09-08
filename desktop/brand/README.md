# ABACO DEEP HARNES — Brand assets

Branding oficial del clon personalizado de DSH Desktop.

## Archivos

- `logo.svg` — icono cuadrado 480×480 (app icon, favicon, dock). A estilizada con "ABACO" dentro, "DEEP HARNES" como subtítulo y tagline "AGENTIC DESKTOP".
- `logo-wordmark.svg` — lockup horizontal compacto (800×200): A pequeña + "ABACO DEEP HARNES" en una sola línea, para splash, about, web header.
- `icon.icns` — icono macOS pregenerado (no regenerado aquí).
- `icon.iconset/icon_512x512.png` — icono PNG fuente (no regenerado aquí).

## Paleta

- Fondo: `#0B1020` → `#16204A` (gradient navy)
- Acento primario: `#22D3EE` (cyan ABACO)
- Acento secundario: `#7C3AED` (violet ABACO)
- Texto principal: `#F8FAFC` (claro)
- Texto secundario / tagline: `#94A3B8`

## Tipografía

- SF Pro Display (default macOS), fallback a Inter / system-ui
- Black 900 para "ABACO" (mark + wordmark)
- Bold 700 para "DEEP HARNES" subtítulo en `logo.svg`
- Light 300 con tracking +6 para "DEEP HARNES" en `logo-wordmark.svg`
- Medium 500 con tracking +4 para tagline "AGENTIC DESKTOP"

## Tagline

`AGENTIC DESKTOP`

## Próximos pasos (no incluidos aquí)

- Regenerar `icon.icns` y los PNG del `icon.iconset/` a partir del nuevo `logo.svg` cuando se quiera refrescar el icono de la app.
- Generar versiones `@1x`, `@2x`, `@3x` PNG para menubar / tray si se necesitan assets derivados.