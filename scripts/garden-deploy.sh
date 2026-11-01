#!/usr/bin/env bash
# Build the garden fork and install it into a vault: scripts/garden-deploy.sh <vault dir> [--no-build]
set -euo pipefail
vault="${1:?usage: garden-deploy.sh <vault dir> [--no-build]}"
cd "$(dirname "$0")/.."
[[ "${2:-}" == "--no-build" ]] || npm run build
dest="$vault/.obsidian/plugins/obsidian-excalidraw-plugin"
mkdir -p "$dest"
cp dist/main.js dist/manifest.json dist/styles.css "$dest/"
echo "installed into $dest — reload Obsidian (Cmd+R) to pick it up"
