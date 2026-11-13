#!/usr/bin/env python3
"""Convert the lossless masters in tools/texture-sources to shipped WebP textures.

Usage: python tools/compress-textures.py
Every image in tools/texture-sources becomes public/textures/<name>.webp.
"""

from pathlib import Path

from PIL import Image

from texture_io import save_webp

SOURCES = Path(__file__).resolve().parent / "texture-sources"


def main():
    for source in sorted(SOURCES.iterdir()):
        if source.suffix.lower() not in (".png", ".jpg", ".jpeg", ".tif", ".tiff"):
            continue
        image = Image.open(source)
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        if image.mode == "RGBA" and image.getextrema()[3][0] == 255:
            image = image.convert("RGB")
        target = save_webp(source.stem, image)
        saved = 100 * (1 - target.stat().st_size / source.stat().st_size)
        print(f"{source.name} -> {target.name}  {target.stat().st_size / 1024:.0f} kB ({saved:.0f}% smaller)")


if __name__ == "__main__":
    main()
