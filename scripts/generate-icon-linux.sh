#!/bin/sh
# Render the Linux app icon (512x512 PNG) from the SVG master.
# electron-builder reads build.linux.icon for AppImage/deb packaging.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
source_svg="$root/assets/icon.svg"
target="$root/assets/icon.png"
size="${ICON_SIZE:-512}"

if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w "$size" -h "$size" "$source_svg" -o "$target"
elif command -v magick >/dev/null 2>&1; then
  magick -background none -density 384 "$source_svg" -resize "${size}x${size}" "$target"
elif command -v convert >/dev/null 2>&1; then
  convert -background none -density 384 "$source_svg" -resize "${size}x${size}" "$target"
else
  echo "rsvg-convert or ImageMagick is required to render the Linux icon" >&2
  exit 1
fi

echo "Generated $target"
