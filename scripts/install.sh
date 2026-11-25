#!/bin/bash
# Installs Doomelets for the current user.
# With --zip, only builds the package (see pack.sh).
set -euo pipefail

UUID="doomelets@carlosbrito92.github.com"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_ROOT/src"

FILES_TO_INSTALL=(extension.js prefs.js metadata.json manager.js gnomelet.js
    indicator.js utils.js projectile.js characters schemas images)

if [[ "${1:-}" == "--zip" ]]; then
    exec "$SCRIPT_DIR/pack.sh"
elif [[ $# -gt 0 ]]; then
    echo "Usage: $0 [--zip]" >&2
    exit 1
fi

echo "🚧 Installing Doomelets..."

echo "⚙️ Compiling schemas..."
glib-compile-schemas --strict "$SRC_DIR/schemas/"

if [[ -L "$INSTALL_DIR" ]]; then
    # A development symlink must not be copied over: it may point back to the sources.
    if [[ "$(readlink -f "$INSTALL_DIR")" != "$(readlink -f "$SRC_DIR")" ]]; then
        echo "❌ $INSTALL_DIR is a symlink to another folder. Remove it and run again." >&2
        exit 1
    fi
    echo "🔗 $INSTALL_DIR already links to the sources; nothing to copy."
else
    echo "📦 Copying files to $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    # Existing files are overwritten; extra files (such as custom characters) are kept.
    for file in "${FILES_TO_INSTALL[@]}"; do
        cp -r "$SRC_DIR/$file" "$INSTALL_DIR/"
    done
fi

echo "✅ Installation complete!"
echo "🔄 Restart GNOME Shell (log out and in on Wayland; Alt+F2, then 'r' on X11),"
echo "   then run: gnome-extensions enable $UUID"
