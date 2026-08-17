#!/bin/sh
# Render the Linux hicolor set and the 512 preview from the blue-backed plate.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
python3 "$root/scripts/generate-icon-assets.py"
echo "Generated $root/assets/icons/*.png and $root/assets/icon.png"
