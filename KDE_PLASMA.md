# Doomelets on KDE Plasma

Doomelets started as a GNOME Shell extension. This document covers the port to **KDE Plasma 6 on Wayland**, which lives in `kwin/`. The GNOME extension in `src/` keeps working as before; both share the sprites in `src/images/` and the behaviour logic in `src/behavior.js`.

## Why a port was needed

A GNOME Shell extension runs inside the `gnome-shell` process and uses its internals directly: Clutter/St actors for drawing, `Meta.Window` for window positions, the shell's drag-and-drop module, its top bar menu, and GSettings. None of these exist under KWin, Plasma's compositor. Wayland also prevents ordinary applications from seeing other windows' positions, so a separate overlay app could not do the job on its own.

The one place in Plasma with both window information and the ability to draw on screen is a **KWin script**. KWin scripts are JavaScript and QML, so the character logic could be ported almost line for line.

| GNOME Shell | KWin port |
|---|---|
| Clutter/St actors in `uiGroup` / `window_group` | One transparent QML overlay window over all screens (`outputOnly`, so it never takes clicks) |
| `global.window_group`, `Meta.Window.get_frame_rect()` | `Workspace.stackingOrder`, `Window.frameGeometry` |
| `Main.layoutManager.monitors` | `Workspace.screens` |
| `dnd.js` drag and drop | A small invisible "handle" window per character that receives the mouse |
| Dash to Dock / Dash to Panel | Plasma panels (`Window.dock`) |
| GSettings + Adw preferences | KConfig (`kwinrc`) + a settings window |
| Top bar menu | Global shortcuts |
| `GLib.timeout_add` | QML `Timer` |

## Installing

Requirements: KDE Plasma 6 on Wayland (tested on Plasma 6.8 / Fedora 44), plus `kpackagetool6`, `kwriteconfig6` and `python3`. These are present on a normal Plasma install.

```bash
git clone https://github.com/carlosbrito92/doomelets.git
cd doomelets
./scripts/kwin.sh install
```

The install:

* builds the package (the KWin code from `kwin/` plus the sprites from `src/images`),
* installs it with `kpackagetool6` and enables it in `kwinrc`,
* adds **Doomelets Settings** to the application menu, with the `Meta+Ctrl+S` shortcut,
* loads the script into the running KWin, so there is no need to log out.

To remove everything: `./scripts/kwin.sh uninstall`.

To update after pulling new code, run `./scripts/kwin.sh install` again.

## Behaviour added after the first port

These work the same as in the GNOME extension (see the README):

* **Smooth motion:** the simulation runs at 20 Hz, but each character and projectile glides to its next position during a tick (a QML `Behavior`), so movement on screen is continuous. Jumps over 48 px (respawn, throwing, changing screen) and dragging are not smoothed.
* **Cursor curiosity:** an idle character turns to face the mouse; after about 3 s it plays its `look` / `taunt` reaction. The Cacodemon drifts toward the cursor but keeps its distance.
* **Window events:** a new window sometimes opens a fire portal on its top edge and drops an Imp or Cacodemon (only types selected in the settings; about 2 minutes, then it leaves through another portal). Windows opening, closing or minimizing make nearby characters stop and look.
* **Scenes:** a wounded Imp (1 HP) runs from the Doom Slayer; if the mouse has not moved for ~30 s the Doom Slayer comes and stands guard next to it.

The behaviour logic is shared with GNOME: `src/behavior.js` is copied into the package as `code/behavior.mjs` by `scripts/kwin.sh`, so there is one source for both. Tests for the KWin classes run in Node, without Plasma:

```bash
node --import ./tests/support/kwin-register.mjs --test tests/kwin.test.mjs
node --test tests/kwin-syntax.test.mjs
```

The second command checks that the package avoids JavaScript syntax the KWin QML engine rejects (for example `??=`), which would stop the whole script from loading.

The QML side (window signals, portal item, gliding) is only checked for syntax here; try it on a real session with `./scripts/kwin.sh dev`.

## Settings

Open **Doomelets Settings** from the application menu, press `Meta+Ctrl+S`, or use System Settings → Window Management → KWin Scripts → Doomelets → Configure. Changes apply within about two seconds after **OK** or **Apply**.

| Group | Setting | Default | Notes |
|---|---|---|---|
| General | Characters on screen | 5 | The Doom Slayer counts as one of them |
| | Character height | 64 px | |
| | Game speed | 100 % | 100 % is the original 20 updates per second. Changes movement, animation and combat speed together |
| | Jump power | 20 | |
| | Spawn offset from top | 0 px | Where characters appear when they (re)spawn |
| Behaviour | In front of maximized windows | Always in front | Same three modes as on GNOME (see below) |
| | Walk on Plasma panels | On | Characters land on top of panels |
| | Allow dragging and throwing | On | Off by default on GNOME |
| Doom combat | Demons come back after | 5 to 10 s | Random wait before a dead Imp or Cacodemon returns |
| | Doom Slayer / Imp / Cacodemon health | 12 / 3 / 5 HP | |
| Characters | Character selection | Doom Slayer, Imp, Cacodemon | Any mix of the Doom and original characters |

**In front of maximized windows:**

* **Always in front:** characters are always visible.
* **Behind when the focused window is maximized:** characters on the floor are hidden behind a focused maximized or full-screen window.
* **Behind when any window is maximized:** characters on the floor are hidden behind any visible maximized or full-screen window.

Cacodemons always float in front, as on GNOME.

## Shortcuts

| Shortcut | Action |
|---|---|
| `Meta+Ctrl+D` | Show or hide the characters |
| `Meta+Ctrl+R` | Respawn all characters |
| `Meta+Ctrl+S` | Open Doomelets Settings |

Change them in System Settings → Keyboard → Shortcuts (the first two are listed under **KWin**, the third under **Doomelets Settings**).

## Dragging

With **Allow dragging and throwing** on, press on a character, move it and let go. The speed of the mouse when you release is passed on to the character, so you can throw it. Cacodemons are not thrown. They float away from where you drop them and drift back to their usual height.

## Differences from the GNOME version

* **Layering:** GNOME can place a character between two windows. A KWin script cannot, so characters are drawn in one overlay above all windows. When a character standing on a window is behind another window, it is hidden instead. Full-screen windows are covered by the overlay in "Always in front" mode.
* **No saved positions:** KWin scripts cannot write files, so characters start fresh after KWin restarts or the script is reloaded.
* **No top bar menu:** use the shortcuts.
* **Panels instead of docks:** Dash to Dock and Dash to Panel do not exist on Plasma.
* **New settings:** game speed, demon respawn time and health per Doom character exist only in the KWin version.

## Custom characters

Add a folder of frames under `src/images` (same format as described in the README) and run `./scripts/kwin.sh install`. QML cannot list folders or read JSON from disk, so the build generates a sprite manifest (`sprites.mjs`) from `src/images`. The new character then appears in the settings.

## How the code is organised

| Path | Contents |
|---|---|
| `kwin/metadata.json` | KWin script metadata |
| `kwin/entry.qml` | Fixed entry point, installed as `contents/ui/main.qml` (see below) |
| `kwin/contents/ui/main.qml` | The front end: overlay, sprites, projectiles, drag handles, settings, shortcuts |
| `kwin/contents/code/gnomelet.mjs` | Base character: physics, walking, jumping, animation (port of `src/gnomelet.js`) |
| `kwin/contents/code/characters/*.mjs` | Doom Slayer, Imp and Cacodemon AI (ports of `src/characters/`) |
| `kwin/contents/code/manager.mjs` | Spawning, the single Slayer, demon respawns, projectiles (port of `src/manager.js`) |
| `kwin/contents/code/projectile.mjs` | Projectiles |
| `kwin/contents/code/windows.mjs` | Reads windows from KWin and decides what characters can stand on or hide behind |
| `kwin/contents/config/main.xml`, `kwin/contents/ui/config.ui` | Settings schema and settings window |
| `kwin/doomelets-settings.desktop` | Application menu entry and `Meta+Ctrl+S` shortcut |
| `scripts/kwin.sh` | Build, install, uninstall and development commands |

The game logic in `kwin/contents/code/` mirrors `src/`. When you change behaviour in one, consider changing the other.

## Development

```bash
./scripts/kwin.sh dev        # load the current code into the running KWin, without installing
./scripts/kwin.sh stop-dev   # unload it
./scripts/kwin.sh logs       # follow the script's console output
./scripts/kwin.sh build      # only assemble the package in temp/kwin-build
```

Things worth knowing:

* **KWin caches compiled QML and JS until it restarts.** It keys the cache by file URL, and an installed package always has the same path. So the build puts the code in a folder with a new name each time (`contents/ui/build-<timestamp>/`). The fixed entry point `contents/ui/main.qml` loads the folder named by the `Build` key, which `install` writes to the `[Script-doomelets]` group of `kwinrc`. Without this, upgrades would silently keep running the old code.
* **Console output** (`console.warn`) only reaches the journal for scripts loaded from a file path, as `dev` does. The installed package's output is not shown, so debug with `dev`.
* **KWin's JavaScript engine (QV4)** does not support every modern feature. Object spread (`{...obj}`), `Array.prototype.flatMap` and `findLastIndex` are not available. ES modules (`.mjs`), classes, optional chaining and `??` work.
* **`org.kde.kwin` exports its own `Window` type**, which shadows QtQuick's. Import QtQuick's as `import QtQuick.Window as QW` and use `QW.Window`.
* **Your own windows show up in `Workspace.stackingOrder`.** Ours have captions starting with `Doomelets` and are filtered out. Closed windows can linger in the list for a while with `deleted: true`, so skip those.

## Troubleshooting

* **Characters do not appear after an upgrade from a build made before the fixed entry point existed:** KWin is still running the old cached code. Log out and back in once. Later upgrades apply immediately.
* **Cannot drag the characters:** check that **Allow dragging and throwing** is on in the settings.
* **Nothing at all:** run `./scripts/kwin.sh dev` and then `./scripts/kwin.sh logs` to see errors. Stop it with `./scripts/kwin.sh stop-dev`.
