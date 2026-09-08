# Brand assets — ABACO DEEP HARNESS

Logo vectorial recreado a partir del render 3D original.

## Composición

- **Letra "A"**: geométrica facetada estilo sci-fi.
- **Paleta**: azul metálico (`#3D6FB2` → `#1E3F73` → `#0E2147`) con reflejos cálidos rosados (`#D9A48B`) en el lado izquierdo, simulando luz cinematográfica.
- **Pedestal**: gris oscuro con el nombre "Abaco Deep Harness" en plateado (`#E1E6F0`).
- **Borde metálico**: gradiente `#7989B0` → `#C9D3E8` → `#5A6488` para los contornos.

## Archivos

| Archivo | Uso |
|---|---|
| `logo.svg` | Logo principal 480×480 para app icon y avatares. |
| `logo-wordmark.svg` | Versión horizontal 1200×360 para headers, README, firmas. |
| `icon.icns` | Bundle nativo macOS (no regenerado, usa el original). |
| `icon.iconset/` | PNGs para icns en múltiples tamaños (no regenerados). |
| `logo-light.png`, `logo-dark.png` | Versiones raster heredadas (opcional). |
| `app-icon.png`, `icon-1024.png` | Assets legacy (opcional). |

## Tipografía

- Sans-serif del sistema: SF Pro Display / Inter / system-ui.
- Letter-spacing generoso (6-8 px en títulos) para el look "tech".
- Pesos: 700 (titular) + 400 (subtítulo).

## Cómo regenerar el `.icns`

```bash
brew install librsvg
mkdir -p /tmp/icns
rsvg-convert -w 1024 desktop/brand/logo.svg -o /tmp/icns/icon_1024x1024.png

mkdir -p desktop/brand/icon.iconset
sips -z 16 16     /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_16x16.png
sips -z 32 32     /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_16x16@2x.png
sips -z 32 32     /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_32x32.png
sips -z 64 64     /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_32x32@2x.png
sips -z 128 128   /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_128x128.png
sips -z 256 256   /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_128x128@2x.png
sips -z 256 256   /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_256x256.png
sips -z 512 512   /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_256x256@2x.png
sips -z 512 512   /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_512x512.png
sips -z 1024 1024 /tmp/icns/icon_1024x1024.png --out desktop/brand/icon.iconset/icon_512x512@2x.png

iconutil -c icns desktop/brand/icon.iconset/ -o desktop/brand/icon.icns
```

## Variantes posibles

- **Monocromático**: cambiar todos los gradientes a `#22D3EE` (cyan ABACO).
- **Negativo**: invertir fondo a `#F8FAFC` y la "A" a `#16204A`.
- **Sin pedestal**: solo el monolito sin la base gris (para usar como favicon).
