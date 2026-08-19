#!/bin/sh
# Render the official macOS .icns from the blue-backed whale plate.
# PNG sets (official + DEV) come from:
#   python3 scripts/generate-icon-assets.py
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
python3 "$root/scripts/generate-icon-assets.py"
source_png="$root/assets/icons/1024x1024.png"
target="$root/assets/DSH Studio.icns"
work=$(mktemp -d /tmp/dsh-desktop-icon.XXXXXX)
trap 'rm -rf "$work"' EXIT HUP INT TERM

if [ ! -f "$source_png" ]; then
  echo "Icon source is missing: $source_png" >&2
  exit 1
fi

iconset="$work/DSH Studio.iconset"
mkdir -p "$iconset"
for spec in \
  '16 icon_16x16.png' \
  '32 icon_16x16@2x.png' \
  '32 icon_32x32.png' \
  '64 icon_32x32@2x.png' \
  '128 icon_128x128.png' \
  '256 icon_128x128@2x.png' \
  '256 icon_256x256.png' \
  '512 icon_256x256@2x.png' \
  '512 icon_512x512.png' \
  '1024 icon_512x512@2x.png'
do
  size=${spec%% *}
  name=${spec#* }
  /usr/bin/sips -z "$size" "$size" "$source_png" --out "$iconset/$name" >/dev/null
done

/usr/bin/iconutil -c icns "$iconset" -o "$target"
