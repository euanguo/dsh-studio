#!/usr/bin/env python3
"""Render official and DEV Desktop icons from the whale logo + brand blue."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'dsh-whale.png'
OFFICIAL_DIR = ROOT / 'assets' / 'icons'
DEV_DIR = ROOT / 'assets' / 'icons-dev'
PREVIEW = ROOT / 'assets' / 'icon.png'
MASTER_SIZE = 1024
SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
# Same plate as assets/icon.svg.
PLATE_INSET = 64
PLATE_RADIUS = 224
GRADIENT = (
    (0.0, (0x69, 0xA8, 0xFF)),
    (0.52, (0x34, 0x78, 0xF0)),
    (1.0, (0x1E, 0x4A, 0xC7)),
)
FONT_PATH = Path('/System/Library/Fonts/HelveticaNeue.ttc')
FONT_INDEX = 9


def lerp(start: float, end: float, amount: float) -> float:
    return start + (end - start) * amount


def mix(left: tuple[int, int, int], right: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return (
        int(lerp(left[0], right[0], amount)),
        int(lerp(left[1], right[1], amount)),
        int(lerp(left[2], right[2], amount)),
    )


def sample_gradient(amount: float) -> tuple[int, int, int]:
    clamped = max(0.0, min(1.0, amount))
    for index in range(len(GRADIENT) - 1):
        start_stop, start_color = GRADIENT[index]
        end_stop, end_color = GRADIENT[index + 1]
        if clamped <= end_stop:
            span = end_stop - start_stop
            local = 0.0 if span == 0 else (clamped - start_stop) / span
            return mix(start_color, end_color, local)
    return GRADIENT[-1][1]


def brand_plate(size: int) -> Image.Image:
    sample = 256
    raw = Image.new('RGB', (sample, sample))
    pixels = raw.load()
    x0, y0 = 160 * sample / 1024, 80 * sample / 1024
    x1, y1 = 864 * sample / 1024, 944 * sample / 1024
    dx, dy = x1 - x0, y1 - y0
    length2 = dx * dx + dy * dy
    for y in range(sample):
        for x in range(sample):
            amount = ((x - x0) * dx + (y - y0) * dy) / length2
            pixels[x, y] = sample_gradient(amount)
    fill = raw.resize((size, size), Image.Resampling.LANCZOS).convert('RGBA')
    scale = size / MASTER_SIZE
    inset = int(PLATE_INSET * scale)
    radius = max(8, int(PLATE_RADIUS * scale))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, size - inset - 1, size - inset - 1),
        radius=radius,
        fill=255,
    )
    plate = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    plate.paste(fill, mask=mask)
    return plate


def white_whale(size: int) -> Image.Image:
    whale = Image.open(SOURCE).convert('RGBA')
    box = whale.getbbox()
    if box is not None:
        whale = whale.crop(box)
    _red, _green, _blue, alpha = whale.split()
    white = Image.merge('RGBA', (
        Image.new('L', whale.size, 255),
        Image.new('L', whale.size, 255),
        Image.new('L', whale.size, 255),
        alpha,
    ))
    inner = int(size * 0.70)
    white.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    layer.paste(white, ((size - white.width) // 2, (size - white.height) // 2 + int(size * 0.02)))
    return layer


def official_icon(size: int = MASTER_SIZE) -> Image.Image:
    canvas = brand_plate(size)
    canvas.alpha_composite(white_whale(size))
    return canvas


def rounded_rectangle(
    size: tuple[int, int],
    radius: int,
    fill: tuple[int, int, int, int],
) -> Image.Image:
    image = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle(
        (0, 0, size[0] - 1, size[1] - 1),
        radius=radius,
        fill=fill,
    )
    return image


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(str(FONT_PATH), size=size, index=FONT_INDEX)
    except OSError:
        return ImageFont.load_default()


def stamp_dev(source: Image.Image) -> Image.Image:
    canvas = source.copy()
    badge_width = 390
    badge_height = 148
    margin = 78
    left = MASTER_SIZE - badge_width - margin
    top = MASTER_SIZE - badge_height - margin
    shadow = rounded_rectangle((badge_width, badge_height), 36, (0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    canvas.alpha_composite(shadow, (left + 4, top + 8))
    badge = rounded_rectangle((badge_width, badge_height), 36, (232, 88, 16, 255))
    ImageDraw.Draw(badge).rounded_rectangle(
        (3, 3, badge_width - 4, badge_height - 4),
        radius=32,
        outline=(255, 236, 210, 230),
        width=4,
    )
    canvas.alpha_composite(badge, (left, top))
    text = 'DEV'
    font = load_font(92)
    draw = ImageDraw.Draw(canvas)
    box = draw.textbbox((0, 0), text, font=font)
    text_x = left + (badge_width - (box[2] - box[0])) / 2 - box[0]
    text_y = top + (badge_height - (box[3] - box[1])) / 2 - box[1] - 2
    draw.text((text_x, text_y + 2), text, font=font, fill=(90, 24, 0, 180))
    draw.text((text_x, text_y), text, font=font, fill=(255, 255, 255, 255))
    return canvas


def write_set(master: Image.Image, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        target = directory / f'{size}x{size}.png'
        resized = master if size == MASTER_SIZE else master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(target, format='PNG')


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f'Icon source is missing: {SOURCE}')
    official = official_icon()
    write_set(official, OFFICIAL_DIR)
    official.resize((512, 512), Image.Resampling.LANCZOS).save(PREVIEW, format='PNG')
    write_set(stamp_dev(official), DEV_DIR)
    print(f'Generated {OFFICIAL_DIR}/*.png, {PREVIEW}, and {DEV_DIR}/*.png from {SOURCE}')


if __name__ == '__main__':
    main()
