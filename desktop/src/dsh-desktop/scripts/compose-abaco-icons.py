#!/usr/bin/env python3
"""Compose ABACO HARNESS dock/favicon icons from the official logo.

Source: build/abaco-brand/abaco-logo-new.png (1536×1024 RGBA, full mark +
wordmark, transparent edges).

Dock / .icns / .ico face:
  - full photo/logo (A + harness loop + ABACO HARNESS), never a tight crop
  - 1024×1024 square, black background (macOS applies the squircle mask)
  - 12% safe margin on the limiting axis (Apple-style 10–15%)
  - LANCZOS fit of the alpha-trimmed mark into that content box

Watermark / in-app mark stays the original transparent PNG.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / "build" / "abaco-brand" / "abaco-logo-new.png"
BUILD = PROJECT_ROOT / "build"
# Repo-level brand pack (desktop/brand), sibling of src/dsh-desktop.
BRAND = PROJECT_ROOT.parents[1] / "brand"

# Apple-style comfortable padding: 12% each side → 76% content box.
SAFE_MARGIN = 0.12
CANVAS = 1024
BACKGROUND = (0, 0, 0, 255)


def alpha_bbox(image: Image.Image, threshold: int = 8) -> tuple[int, int, int, int]:
    """Tight box around pixels with alpha above threshold."""
    alpha = image.split()[-1]
    bbox = alpha.point(lambda p: 255 if p > threshold else 0).getbbox()
    if bbox is None:
        return (0, 0, image.width, image.height)
    return bbox


def compose_dock_face(source: Image.Image, size: int = CANVAS) -> Image.Image:
    mark = source.convert("RGBA")
    left, top, right, bottom = alpha_bbox(mark)
    trimmed = mark.crop((left, top, right, bottom))

    content = int(round(size * (1.0 - 2.0 * SAFE_MARGIN)))
    scale = min(content / trimmed.width, content / trimmed.height)
    fitted = trimmed.resize(
        (max(1, int(round(trimmed.width * scale))), max(1, int(round(trimmed.height * scale)))),
        Image.Resampling.LANCZOS,
    )

    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    x = (size - fitted.width) // 2
    y = (size - fitted.height) // 2
    canvas.alpha_composite(fitted, (x, y))
    return canvas


def write_ico(path: Path, face: Image.Image, sizes: list[int]) -> None:
    images: list[bytes] = []
    for size in sizes:
        frame = face.resize((size, size), Image.Resampling.LANCZOS)
        buf = _png_bytes(frame)
        images.append(buf)

    header = bytearray(6 + 16 * len(images))
    struct.pack_into("<HHH", header, 0, 0, 1, len(images))
    offset = len(header)
    for index, size in enumerate(sizes):
        entry = 6 + index * 16
        header[entry] = 0 if size == 256 else size
        header[entry + 1] = 0 if size == 256 else size
        header[entry + 2] = 0
        header[entry + 3] = 0
        struct.pack_into("<HHII", header, entry + 4, 1, 32, len(images[index]), offset)
        offset += len(images[index])
    path.write_bytes(bytes(header) + b"".join(images))


def write_icns(path: Path, face: Image.Image) -> None:
    # PNG-in-ICNS types used by modern iconutil output.
    types = (
        ("icp4", 16),
        ("icp5", 32),
        ("icp6", 64),
        ("ic07", 128),
        ("ic08", 256),
        ("ic09", 512),
        ("ic10", 1024),
        ("ic11", 32),
        ("ic12", 64),
        ("ic13", 256),
        ("ic14", 512),
    )
    chunks = bytearray()
    for ostype, size in types:
        png = _png_bytes(face.resize((size, size), Image.Resampling.LANCZOS))
        chunks.extend(ostype.encode("ascii"))
        chunks.extend(struct.pack(">I", 8 + len(png)))
        chunks.extend(png)
    path.write_bytes(b"icns" + struct.pack(">I", 8 + len(chunks)) + chunks)


def _png_bytes(image: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def write_iconset(directory: Path, face: Image.Image) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    # iconutil naming: 16, 32, 128, 256, 512 + @2x
    mapping = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for name, size in mapping.items():
        face.resize((size, size), Image.Resampling.LANCZOS).save(directory / name, format="PNG")


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG")


def main() -> int:
    if not SOURCE.exists():
        print(f"missing official logo: {SOURCE}", file=sys.stderr)
        return 1

    source = Image.open(SOURCE).convert("RGBA")
    face_1024 = compose_dock_face(source, CANVAS)
    face_512 = face_1024.resize((512, 512), Image.Resampling.LANCZOS)

    bbox = alpha_bbox(source)
    trimmed = source.crop(bbox)
    watermark_512 = trimmed.copy()
    watermark_512.thumbnail((512, 512), Image.Resampling.LANCZOS)

    save_png(face_1024, BUILD / "app-icon.png")
    save_png(face_1024, BUILD / "icon.png")
    save_png(face_512, BUILD / "icon-512.png")
    save_png(watermark_512, BUILD / "logo-light.png")
    save_png(watermark_512, BUILD / "logo-dark.png")

    write_iconset(BUILD / "app-icon.iconset", face_1024)
    write_icns(BUILD / "icon.icns", face_1024)
    write_ico(BUILD / "icon.ico", face_1024, [16, 24, 32, 48, 64, 128, 256])

    if BRAND.exists():
        save_png(face_1024, BRAND / "app-icon.png")
        save_png(face_1024, BRAND / "icon-1024.png")
        save_png(watermark_512, BRAND / "logo-light.png")
        save_png(watermark_512, BRAND / "logo-dark.png")
        save_png(source, BRAND / "abaco-harness-official.png")
        write_iconset(BRAND / "icon.iconset", face_1024)
        write_icns(BRAND / "icon.icns", face_1024)

    content = int(round(CANVAS * (1.0 - 2.0 * SAFE_MARGIN)))
    print(
        f"Composed dock face {CANVAS}×{CANVAS} from {SOURCE.name} "
        f"({source.width}×{source.height}), content box {content}×{content}, "
        f"safe margin {SAFE_MARGIN:.0%}."
    )
    print(f"Wrote {BUILD / 'app-icon.png'}, {BUILD / 'icon.icns'}, {BUILD / 'icon.ico'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
