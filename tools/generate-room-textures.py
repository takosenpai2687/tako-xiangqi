#!/usr/bin/env python3
"""Generate the seamless PBR texture sets used by the chess room.

Requires NumPy and Pillow. Every map tiles exactly: noise is filtered in the
frequency domain and drawn motifs are repeated across the tile borders.
"""

import numpy as np
from PIL import Image, ImageDraw

from texture_io import OUTPUT, blur, noise, save_webp

# World-space footprints baked into the tabletop contact AO. Keep in sync with
# the board plinth, capture boxes and tea saucers in src/.
TABLE_SIZE = (17.8, 12.4)
BOARD_HALF = (4.775, 5.275)
BOX_CENTERS = (-6.35, 6.35)
BOX_HALF = (1.45, 2.65)
SAUCER_CENTERS = ((-7.55, 3.6), (7.55, -3.6))
SAUCER_RADIUS = 0.7


def smoothstep(low, high, values):
    t = np.clip((values - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def normal_from_height(height, strength):
    """Tangent-space normal map with +Y up, matching Three.js."""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack(
        (128 + 127 * nx / length, 128 + 127 * ny / length, 128 + 127 * nz / length),
        axis=-1,
    )


def create_tatami():
    """Woven rush: strands run along U, stitched over warp threads along V."""
    size = 2048
    rows, columns = 128, 32
    rng = np.random.default_rng(11)
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    strand_position = y * rows / size
    row = np.floor(strand_position).astype(int)
    across = strand_position - row - 0.5
    strand = np.sqrt(np.clip(1 - (2.1 * across) ** 2, 0, 1))
    along = x * columns / size + 0.5 * (row % 2)
    stitch = np.exp(-(((along - np.floor(along)) - 0.5) / 0.15) ** 2)
    height = strand * (1 - 0.5 * stitch)

    tint = rng.normal(size=rows)[row]
    fresh = rng.normal(size=rows)[row]
    streak = noise(size, 12, 46, 1.3)
    macro = noise(size, 13, 240)
    shade = 0.6 + 0.4 * height**0.6
    color = np.empty((size, size, 3), dtype=np.float32)
    variation = 3.5 * tint + 4.5 * streak + 2 * macro
    color[..., 0] = 176 * shade + variation - 2 * fresh
    color[..., 1] = 161 * shade + variation + 1.5 * fresh
    color[..., 2] = 120 * shade + 0.7 * variation

    save_webp("tatami-albedo", color)
    save_webp("tatami-normal", normal_from_height(height + 0.05 * streak, 3.0))
    save_webp("tatami-roughness", 238 - 14 * height + 3 * streak)
    save_webp("tatami-ao", 255 * (0.5 + 0.5 * blur(height, 1.5)))


def strands(size, seed, count, lengths, width):
    """Randomly oriented straight fibres drawn across the tile edges; values in -1..1."""
    rng = np.random.default_rng(seed)
    canvas = Image.new("F", (size, size), 0.0)
    draw = ImageDraw.Draw(canvas)
    for _ in range(count):
        cx, cy = rng.uniform(0, size, 2)
        angle = rng.uniform(0, np.pi)
        half = rng.uniform(*lengths) / 2
        value = float(rng.uniform(0.35, 1.0) * rng.choice((1, 1, 1, -1)))
        dx, dy = half * np.cos(angle), half * np.sin(angle)
        for ox in (-size, 0, size):
            for oy in (-size, 0, size):
                draw.line(
                    (cx - dx + ox, cy - dy + oy, cx + dx + ox, cy + dy + oy),
                    fill=value,
                    width=width,
                )
    return np.asarray(canvas, dtype=np.float32)


def create_paper():
    """Warm washi: pulp clumps, fine fibres and a few long bold strands.

    The detail is sized to stay visible from across the room, where a single
    real fibre would be far below one screen pixel.
    """
    size = 1024
    fine = blur(strands(size, 21, 2600, (30, 150), 2), 0.6)
    bold = blur(strands(size, 24, 240, (140, 460), 4), 0.9)
    pulp = noise(size, 25, 4)
    mottle = noise(size, 22, 26)
    variation = 11 * fine + 15 * bold + 4 * pulp + 2 * mottle
    color = np.empty((size, size, 3), dtype=np.float32)
    color[..., 0] = 214 + variation
    color[..., 1] = 197 + variation
    color[..., 2] = 160 + 0.8 * variation

    height = 0.5 * fine + 0.9 * bold + 0.35 * pulp
    save_webp("shoji-paper-albedo", color, quality=95)
    save_webp("shoji-paper-normal", normal_from_height(height, 1.6))
    save_webp("shoji-paper-roughness", 240 + 2 * pulp - 3 * fine)
    save_webp("shoji-paper-ao", 249 - 7 * np.clip(-fine, 0, 1) + 2 * mottle)


def create_plaster():
    """Warm grey matte earthen wall: sand grain, straw flecks, faint trowel variation."""
    size = 1024
    mottle = noise(size, 31, 34)
    trowel = noise(size, 32, 48, 16)
    sand = noise(size, 33, 2.4)
    straw = blur(np.abs(strands(size, 34, 520, (16, 64), 3)), 0.7)
    variation = 2 * mottle + 1.5 * trowel + 4.5 * sand
    color = np.empty((size, size, 3), dtype=np.float32)
    color[..., 0] = 158 + variation + 17 * straw
    color[..., 1] = 145 + variation + 14 * straw
    color[..., 2] = 126 + 0.9 * variation + 6 * straw

    height = 0.3 * mottle + 0.3 * trowel + 0.6 * sand + 0.5 * straw
    save_webp("wall-plaster-albedo", color, quality=95)
    save_webp("wall-plaster-normal", normal_from_height(height, 1.3))
    save_webp("wall-plaster-roughness", 244 + 3 * sand)
    save_webp("wall-plaster-ao", 250 + 2 * mottle - 3 * np.clip(-sand, 0, 2))


def lotus_petals(size, count):
    """Carved lotus petals rising from the foot; returns (groove, petal) masks."""
    s = size * 2
    groove = Image.new("L", (s, s), 0)
    petal = Image.new("L", (s, s), 0)
    groove_draw = ImageDraw.Draw(groove)
    petal_draw = ImageDraw.Draw(petal)
    pitch = s / count

    def outline(center, base, tip):
        points = []
        for step in range(-32, 33):
            along = 1 - abs(step) / 32
            half = 0.5 * pitch * 0.98 * (1 - along**2.4) ** 0.55
            x = center + np.sign(step) * half
            points.append((x, s * (1 - (base + (tip - base) * along))))
        return points

    def carve(center, base, tip, level):
        for offset in (-s, 0, s):
            points = outline(center + offset, base, tip)
            petal_draw.polygon(points, fill=level)
            groove_draw.polygon(points, fill=0)
            groove_draw.line(points, fill=255, width=6, joint="curve")
            rib = base + (tip - base) * 0.82
            groove_draw.line(
                (center + offset, s * (1 - base - 0.02), center + offset, s * (1 - rib)),
                fill=150,
                width=4,
            )

    for index in range(count):
        carve((index + 0.5) * pitch, 0.1, 0.72, 150)
    for index in range(count):
        carve(index * pitch, 0.1, 0.63, 255)
    masks = []
    for mask in (groove, petal):
        mask = mask.resize((size, size), Image.LANCZOS)
        masks.append(np.asarray(mask, dtype=np.float32) / 255)
    return masks


def create_celadon():
    """Pale celadon glaze. U wraps around the cup; V runs from the foot to the rim.

    The glaze thins toward the rim (moon white) and is thick on the belly (lake
    green). The lotus petals are incised: they exist only as normal and AO relief.
    """
    size = 1024
    groove, petal = lotus_petals(size, 5)
    pooled = blur(groove, 5)
    raised = blur(petal, 7)
    cloud = noise(size, 43, 60)
    v = 1 - (np.arange(size, dtype=np.float32)[:, None] + 0.5) / size

    # Colour follows glaze thickness alone; the petals live only in the relief maps.
    thickness = (
        0.8
        - 0.66 * smoothstep(0.56, 1.0, v)
        + 0.1 * np.exp(-(((v - 0.09) / 0.03) ** 2))
        + 0.03 * cloud
    )
    thickness = np.clip(thickness, 0, 1)
    moon_white = np.array((216, 233, 225), dtype=np.float32)
    lake_green = np.array((104, 182, 170), dtype=np.float32)
    color = moon_white + thickness[..., None] * (lake_green - moon_white)

    height = -blur(groove, 2.2) + 0.35 * raised + 0.03 * noise(size, 44, 14)
    save_webp("tea-cup-celadon-albedo", color)
    save_webp("tea-cup-celadon-normal", normal_from_height(height, 2.2), quality=95)
    save_webp("tea-cup-celadon-roughness", 46 + 1.5 * cloud)
    save_webp("tea-cup-celadon-ao", 255 - 26 * pooled)


def create_tea_normal():
    size = 1024
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    ripples = (
        0.018 * np.sin(2 * np.pi * (3 * x + 2 * y) / size)
        + 0.012 * np.sin(2 * np.pi * (5 * x - 3 * y) / size + 1.2)
        + 0.008 * np.sin(2 * np.pi * (7 * x + 6 * y) / size + 2.1)
    )
    save_webp("tea-normal", normal_from_height(ripples + 0.003 * noise(size, 51, 24), 0.75))


def create_table_contact_ao():
    """Contact occlusion where the board, boxes and saucers rest on the table."""
    size = 1024
    rows, columns = np.mgrid[0:size, 0:size].astype(np.float32)
    x = (columns + 0.5) / size * TABLE_SIZE[0] - TABLE_SIZE[0] / 2
    z = (0.5 - (rows + 0.5) / size) * TABLE_SIZE[1]

    def rounded_box(cx, cz, half_width, half_depth, radius):
        qx = np.abs(x - cx) - (half_width - radius)
        qz = np.abs(z - cz) - (half_depth - radius)
        outside = np.hypot(np.maximum(qx, 0), np.maximum(qz, 0))
        return outside + np.minimum(np.maximum(qx, qz), 0) - radius

    def occlusion(distance, near, far):
        distance = np.maximum(distance, 0)
        return near[0] * np.exp(-distance / near[1]) + far[0] * np.exp(-distance / far[1])

    light = 1 - occlusion(rounded_box(0, 0, *BOARD_HALF, 0.02), (0.34, 0.1), (0.26, 0.5))
    for cx in BOX_CENTERS:
        light *= 1 - occlusion(rounded_box(cx, 0, *BOX_HALF, 0.18), (0.32, 0.09), (0.22, 0.4))
    for cx, cz in SAUCER_CENTERS:
        distance = np.hypot(x - cx, z - cz) - SAUCER_RADIUS
        light *= 1 - occlusion(distance, (0.24, 0.05), (0.1, 0.2))
    save_webp("table-contact-ao", 255 * light)


def main():
    create_tatami()
    create_paper()
    create_plaster()
    create_celadon()
    create_tea_normal()
    create_table_contact_ao()
    print(f"Generated room textures in {OUTPUT}")


if __name__ == "__main__":
    main()
