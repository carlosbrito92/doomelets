#!/bin/bash
# Builds temp/<uuid>.zip, installable with `gnome-extensions install`.
set -euo pipefail

UUID="doomelets@carlosbrito92.github.com"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_ROOT/src"
ZIP_FILE="$PROJECT_ROOT/temp/$UUID.zip"

mkdir -p "$PROJECT_ROOT/temp"
rm -f "$ZIP_FILE"

echo "⚙️ Compiling schemas..."
glib-compile-schemas --strict "$SRC_DIR/schemas/"

echo "📦 Packaging from $SRC_DIR..."
cd "$SRC_DIR"
zip -qr "$ZIP_FILE" extension.js prefs.js metadata.json manager.js gnomelet.js \
    indicator.js utils.js projectile.js behavior.js motion.js portal.js characters schemas images

cd "$PROJECT_ROOT"
zip -q "$ZIP_FILE" README.md LICENSE

echo "✅ Created $ZIP_FILE"
