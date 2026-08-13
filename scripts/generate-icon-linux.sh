#!/bin/sh
# Render the Linux app icon set from the dsh-whale.png master.
#
# electron-builder treats a single PNG as a one-size icon set, so desktop
# environments looking up small sizes (taskbars, menus) fall back to a
# generic icon. Render the full hicolor set into assets/icons/<size>x<size>.png
# and keep assets/icon.png (512) as the single-file preview and the source for
# the packaged window icon.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
source_png="$root/assets/dsh-whale.png"
set_dir="$root/assets/icons"
mkdir -p "$set_dir"

render() {
  size="$1"
  target="$2"
  if command -v magick >/dev/null 2>&1; then
    magick "$source_png" -resize "${size}x${size}" "$target"
  elif command -v convert >/dev/null 2>&1; then
    convert "$source_png" -resize "${size}x${size}" "$target"
  else
    echo "ImageMagick (magick or convert) is required to render the Linux icon" >&2
    exit 1
  fi
}

for size in 16 24 32 48 64 128 256 512 1024; do
  render "$size" "$set_dir/${size}x${size}.png"
done
cp "$set_dir/512x512.png" "$root/assets/icon.png"

echo "Generated $set_dir/*.png and $root/assets/icon.png from $source_png"
