# Doomelets 👹

Doom-themed desktop pets for GNOME Shell. Imps run across your windows, Cacodemons float above them, and the Doom Slayer hunts them all down.

## About the project

Doomelets is a fork of [**Gnomelets**](https://github.com/ihpled/gnomelets) by [ihpled](https://github.com/ihpled), an extension that lets small animated 2D characters walk, jump and balance on top of your open windows. The fork starts from upstream commit [`d710927`](https://github.com/ihpled/gnomelets/commit/d710927) (2026-05-01).

The desktop pet engine (physics, window and dock interaction, multi-monitor support, drag and drop, preferences and state persistence) comes from Gnomelets. Credit for that foundation belongs to the original project and its contributors.

### What Doomelets adds

* **Three Doom characters:** the Doom Slayer, the Imp and the Cacodemon, each with its own class and AI.
* **Combat:** hit points, projectiles, hurt and death states, and glory kills.
* **Interaction with the original characters:** the Doom Slayer stops to pet them.
* **Smoother animation:** an optional `animations.json` manifest allows any number of frames per animation.
* **New animations:** a "held" pose while a Doom character is dragged, and idle variations for the Doom Slayer.
* **Sprite pipeline:** three.js rigs and a script that renders them to PNG frames.
* **Its own extension identity:** UUID `doomelets@carlosbrito92.github.com` and settings schema `org.gnome.shell.extensions.doomelets`.

The original characters (Kitten, Mouse, Puppy, Santa, Squirrel and Tux) are still included.

## Doom characters

| Character | Hit points | Behaviour |
|---|---|---|
| **Doom Slayer** | 12 | Chases the nearest demon and fires a three-pellet shotgun. Executes a stunned demon within reach with a glory kill. |
| **Imp** | 3 | Runs on the floor and on windows, approaches the Slayer and throws fireballs (1 damage). |
| **Cacodemon** | 5 | Floats in the upper part of the primary monitor and spits fireballs (2 damage) when the Slayer is close. |

* When `DoomSlayer` is selected, there is **always exactly one** on screen. It counts toward the character count, and the remaining slots are filled with the other selected types.
* If the Slayer dies, it respawns after about one second and is briefly invulnerable.
* Dead Imps and Cacodemons come back from the screen edge after 5 to 10 seconds, as long as their type is still selected.
* When no demon is in range, the Slayer pets original characters that pass nearby. Demons ignore them, and the original characters cannot be damaged.
* While standing still, the Slayer sometimes reloads the shotgun or looks around.

## Features inherited from Gnomelets

* **Physics-based movement:** characters obey gravity and land on solid surfaces.
* **Window interaction:** they detect open windows and walk along their title bars and top edges.
* **Smart jumping:** they detect edges, leap, and climb to reachable windows.
* **Multi-monitor support:** characters can travel and spawn across all connected screens.
* **Drag and drop with momentum:** pick a character up and toss it. Enable **Allow Interaction** first.
* **Top bar menu:** respawn all characters or toggle their visibility.
* **State persistence:** characters are restored after the extension is disabled and enabled again, or the shell restarts.
* **Dash to Dock (Ubuntu Dock) and Dash to Panel support:** characters can land on and explore the dock or panel.

## Installation

### With the install script

```bash
git clone https://github.com/carlosbrito92/doomelets.git
cd doomelets
./scripts/install.sh
```

The script compiles the settings schema and copies the extension to your user extensions folder. If that folder is already a symlink to this repository's `src/`, it only compiles the schema. `./scripts/pack.sh` (or `./scripts/install.sh --zip`) creates `temp/doomelets@carlosbrito92.github.com.zip`, which can be installed with `gnome-extensions install`. It needs `zip`.

After installing, restart GNOME Shell and enable the extension as described below.

### Manually, with a symlink

```bash
git clone https://github.com/carlosbrito92/doomelets.git
cd doomelets
glib-compile-schemas src/schemas
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$PWD/src" ~/.local/share/gnome-shell/extensions/doomelets@carlosbrito92.github.com
```

Use `cp -r src <destination>` instead of `ln -s` if you prefer an independent copy. Check first that the destination does not already exist.

Restart GNOME Shell so it finds the extension (log out and back in on Wayland; press `Alt+F2`, type `r` and press Enter on X11). Then enable it:

```bash
gnome-extensions enable doomelets@carlosbrito92.github.com
```

Open the extension preferences and select `DoomSlayer`, `Imp` and `Cacodemon`. The default selection is `Santa`.

The metadata declares support for GNOME Shell 45 to 50.

### Updating

After pulling new code (and copying it again, if you did not use a symlink), **restart GNOME Shell** as described above. Disabling and enabling the extension is not enough, because the running shell keeps the previously loaded JavaScript modules in memory.

### Settings from earlier Doomelets versions

Earlier versions stored settings under the Gnomelets path, and the saved state in `~/.cache/gnomelets-state.json`. To copy your settings to the new location (this overwrites the Doomelets settings already there):

```bash
dconf dump /org/gnome/shell/extensions/gnomelets/ | dconf load /org/gnome/shell/extensions/doomelets/
```

If you also use Gnomelets, those old settings may be its own, so check them before copying. The saved state only holds character positions and does not need to be migrated.

## KDE Plasma version (KWin script)

Doomelets also runs on **KDE Plasma 6 (Wayland)** as a KWin script, in `kwin/`. A GNOME Shell extension cannot simply be reused there: it draws with Shell internals (Clutter/St), reads window positions through `Meta.Window`, and uses GSettings, none of which exist under KWin, so the logic was ported to a KWin script (see *Why a port was needed* in [KDE_PLASMA.md](KDE_PLASMA.md)). It uses the same characters, AI and sprites, and adds a settings window with game speed, demon respawn time and health per Doom character.

```bash
./scripts/kwin.sh install     # then open "Doomelets Settings" from the app menu (or Meta+Ctrl+S)
```

See [KDE_PLASMA.md](KDE_PLASMA.md) for installation, settings, shortcuts, differences from the GNOME version and development notes.

## Configuration

* **Character selection:** choose one or more characters. The list includes every folder in the `images` directory.
* **Number of characters:** how many are on screen at once.
* **Size:** the character height in pixels.
* **In Front of Maximized:** **Allow** keeps characters in front. **Partial** hides them behind a maximized or full-screen window when it is focused. **Disallow** keeps them behind any visible maximized or full-screen window.
* **Dock Support:** Dash to Dock (Ubuntu Dock), Dash to Panel, or None.
* **In Front of Dock:** draw characters in front of or behind the dock or panel.
* **Allow Interaction:** enable dragging characters with the mouse. Off by default.
* **Jump Power:** the vertical strength of jumps.
* **Spawn Offset from Top:** the vertical position where characters spawn.
* **Show Menu Indicator:** show or hide the top bar menu.
* **Reset State:** respawn all characters.

## Adding custom characters

1. Open the extension's `images` folder (`~/.local/share/gnome-shell/extensions/doomelets@carlosbrito92.github.com/images`).
2. Create a folder with your character's name (for example, `Robot`).
3. Add the PNG animation frames:
    * **0.png to 3.png:** walking.
    * **4.png:** idle.
    * **5.png:** jumping and falling.
    * **6.png and 7.png** (optional): dragging. If missing, `1.png` and `3.png` are used.
    * **8.png** (optional): death. If missing, `7.png` is used.
    * **9.png** (optional): hurt or stunned. If missing, `6.png` is used.
4. Restart GNOME Shell. The new character appears in the preferences.

### Optional `animations.json`

Instead of the fixed numbering above, a character folder may describe its animations with any number of frames. Each entry lists PNG numbers, the `ticks` (units of 50 ms) per frame, and whether the animation loops:

```json
{ "walk": { "frames": [0, 1, 2, 3, 4, 5, 6, 7], "ticks": 2, "loop": true } }
```

Names: `walk`, `run`, `float`, `idle`, `jump`, `fall`, `attack`, `glory`, `hurt`, `death`, `held` (dragged by the user), `pet`, plus the idle variations `reload` and `look` (Doom Slayer) and `taunt` (Imp, optional). If you provide a manifest, include every state the character can reach.

## Development

| Path | Contents |
|---|---|
| `src/` | The extension. `manager.js` handles spawning, `gnomelet.js` the base character and `projectile.js` the projectiles. |
| `src/characters/` | The Doom Slayer, Imp and Cacodemon classes. |
| `src/images/` | One folder of frames per character (shared with the KWin version). |
| `kwin/` | The KDE Plasma port (see [KDE_PLASMA.md](KDE_PLASMA.md)). |
| `scripts/kwin.sh` | Builds, installs and hot-loads the KWin version. |
| `demo/` | three.js rigs for the Doom characters. |
| `scripts/render_doom_sprites.py` | Renders the rigs to PNG frames and writes `animations.json`. |

Behaviour logic that does not need GNOME (idle variant picking, pointer curiosity, steering) lives in `src/behavior.js` and is unit tested. The real character classes are also exercised against a stubbed Shell:

```bash
node --test tests/behavior.test.mjs
node --import ./tests/support/register.mjs --test tests/gnomelet.test.mjs
```

Window events and scenes:

* **Portals:** opening a window sometimes (50%, at most every ~20 s, up to 3 portal demons alive at once, whatever the character count) opens a fire portal on its top edge and drops an Imp or Cacodemon, but only types selected in the preferences. These demons leave through another portal after about 2 minutes and do not respawn.
* **Attention:** a window opening, closing or minimizing makes nearby walking or idle characters stop and look toward it for ~1.5 s (the `look` / `taunt` reaction plays if the manifest has it).
* **Cowardly Imp:** at 1 hit point the Imp runs away from the Doom Slayer instead of fighting, unless cornered at a screen edge.
* **Guarding the cursor:** if the mouse has not moved for ~30 s and there are no enemies, the Doom Slayer walks over and stands guard next to it.

Pointer interaction: a character left idle near the cursor turns to face it; after about 3 s it plays its `stare` reaction (`look` for the Doom Slayer, `taunt` for the Imp once that animation exists in its manifest). The Cacodemon drifts toward the cursor but keeps its distance. Movement between logic ticks (20 Hz) is interpolated, so motion on screen is continuous.

To regenerate the Doom sprites (needs the Python packages `playwright` and `pillow`, plus a Playwright browser):

```bash
python3 scripts/render_doom_sprites.py
```

> **Testing in a nested or headless shell:** run it under `dbus-run-session`, with separate `XDG_CACHE_HOME`, `XDG_CONFIG_HOME` and `XDG_DATA_HOME` directories and `GSETTINGS_BACKEND=keyfile`. Otherwise the test can change your real desktop session, settings or saved state.

### Known limitations

* Some labels in the preferences and the top bar menu still say "Gnomelets".

## License

Doomelets is distributed under the GNU General Public License v3.0, as found in [LICENSE](LICENSE).

## Disclaimer

Doomelets is an unofficial, non-commercial fan project. It is not affiliated with or endorsed by id Software, Bethesda Softworks or ZeniMax Media. DOOM and its characters are the property of their respective owners.
