#!/usr/bin/env bash
# Packages the extension into dist/detour-<version>.zip (works for Chrome and Firefox).
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
mkdir -p dist
out="dist/detour-${version}.zip"
rm -f "$out"
zip -q -r "$out" manifest.json background.js match.js content.js content.css page.js options.html options.js icons LICENSE README.md
echo "$out"
