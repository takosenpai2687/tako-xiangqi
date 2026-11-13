"""Shared helpers for the texture tools. Every shipped texture is a WebP file."""

from pathlib import Path

import numpy as np
from PIL import Image

OUTPUT = Path(__file__).resolve().parents[1] / "public" / "textures"


def blur(values, sigma_x, sigma_y=None):
    """Gaussian blur that wraps around the tile edges."""
    sigma_y = sigma_x if sigma_y is None else sigma_y
    fy = np.fft.fftfreq(values.shape[0])[:, None]
    fx = np.fft.fftfreq(values.shape[1])[None, :]
    kernel = np.exp(-2 * np.pi**2 * ((sigma_x * fx) ** 2 + (sigma_y * fy) ** 2))
    return np.fft.ifft2(np.fft.fft2(values) * kernel).real.astype(np.float32)


def noise(size, seed, sigma_x, sigma_y=None):
    """Seamless unit-variance noise with the given correlation lengths in pixels."""
    values = np.random.default_rng(seed).normal(size=(size, size))
    values = blur(values, sigma_x, sigma_y)
    values -= values.mean()
    return values / max(float(values.std()), 1e-6)


def save_webp(name, image, quality=90):
    """Write public/textures/<name>.webp from a PIL image or a 0-255 array."""
    if not isinstance(image, Image.Image):
        pixels = np.clip(np.rint(image), 0, 255).astype(np.uint8)
        image = Image.fromarray(pixels, "RGB" if pixels.ndim == 3 else "L")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / f"{name}.webp"
    image.save(path, "WEBP", quality=quality, method=6)
    return path
