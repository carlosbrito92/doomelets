import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Gnomelet } from './gnomelet.js';
import { Imp }        from './characters/imp.js';
import { Cacodemon }  from './characters/cacodemon.js';
import { LostSoul }   from './characters/lost-soul.js';
import { DoomSlayer } from './characters/doom-slayer.js';
import { Projectile } from './projectile.js';
import { Portal } from './portal.js';
import { PointerTracker, PortalGate } from './behavior.js';
import { NOTICE_RANGE, PORTAL_DEMON_TTL, DEFAULT_TYPES, SLAYER_TYPES } from './utils.js';
import { isWindowMaximized, UPDATE_INTERVAL_MS } from './utils.js';

const isSlayer = t => SLAYER_TYPES.includes(t);   // sempre exatamente um Slayer (clássico ou Eternal) em cena quando selecionado
const DEMONS = ['Imp', 'Imp2', 'Cacodemon'];   // Imp2: variação visual do Imp (mesma classe e IA)
const DEMON_RESPAWN_MIN = 100;   // ticks (~5s)
const DEMON_RESPAWN_MAX = 200;   // ticks (~10s)

/**
 * GnomeletManager Class
 * Orchestrates the lifecycle of all characters and global resources.
 */
export const GnomeletManager = GObject.registerClass(
    class GnomeletManager extends GObject.Object {
        _init(settings) {
            super._init();
            this._gnomelets = [];
            this._demonQueue = [];   // demônios mortos esperando para voltar
            this._projectiles = [];
            this._portals = [];                       // anéis de fogo de entrada/saída
            this._portalGate = new PortalGate();      // janela nova → às vezes sai um demônio
            this._pointerTracker = new PointerTracker();
            this._pendingTimeouts = new Set();
            this._settings = settings;
            this._windows = [];
            this._timerId = 0;
            this._cancellable = null;

            // Resource cache: { [type: string]: { frames: GIcon[], w: int, h: int } }
            this._resources = {};
            this._cacheFile = GLib.get_user_cache_dir() + '/doomelets-state.json';
            this._pendingState = null;
            this._isPaused = !this._settings.get_boolean('is-enabled');
        }

        /**
         * Helper to resolve the correct folder for a given type name asynchronously.
         */
        _resolveImageFolderAsync(typeName, callback) {
            if (!typeName) {
                callback(null);
                return;
            }

            let file = Gio.File.new_for_uri(import.meta.url);
            let imagesDir = file.get_parent().get_child('images');
            let typeDir = imagesDir.get_child(typeName);

            typeDir.query_info_async(
                Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (obj, res) => {
                    try {
                        let info = obj.query_info_finish(res);
                        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                            callback(typeDir);
                        } else {
                            callback(null);
                        }
                    } catch (e) {
                        callback(null);
                    }
                }
            );
        }

        /**
         * Loads resources and spawns gnomelets.
         */
        async _loadResourcesAndSpawn(hardReset = false) {
            let types = this._settings.get_strv('gnomelet-type');
            if (!types || types.length === 0) types = DEFAULT_TYPES;

            let loadedSomething = false;

            const loadType = async (typeName) => {
                if (this._resources[typeName]) return; // Already loaded

                return new Promise((resolve) => {
                    this._resolveImageFolderAsync(typeName, async (typeDir) => {
                        if (!typeDir) { resolve(); return; }

                        let frames = [];
                        let frameW = 0;
                        let frameH = 0;
                        let anySuccess = false;

                        const loadFrame = (index) => {
                            return new Promise((r) => {
                                let imgFile = typeDir.get_child(`${index}.png`);
                                imgFile.read_async(GLib.PRIORITY_DEFAULT, this._cancellable, (file, res) => {
                                    try {
                                        let stream = file.read_finish(res);
                                        GdkPixbuf.Pixbuf.new_from_stream_async(stream, this._cancellable, (source, res2) => {
                                            try {
                                                let pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(res2);
                                                stream.close(null);
                                                r({
                                                    valid: true,
                                                    w: pixbuf.get_width(),
                                                    h: pixbuf.get_height(),
                                                    icon: new Gio.FileIcon({ file: imgFile })
                                                });
                                            } catch (e) {
                                                try { stream.close(null); } catch (err) { }
                                                r({ valid: false });
                                            }
                                        });
                                    } catch (e) {
                                        r({ valid: false });
                                    }
                                });
                            });
                        };

                        // animations.json (opcional) descreve animações com quantos quadros quiser
                        const animations = await this._loadAnimations(typeDir);
                        const total = animations
                            ? 1 + Math.max(...Object.values(animations).flatMap(a => a.frames))
                            : 10;

                        let promises = [];
                        for (let i = 0; i < total; i++) promises.push(loadFrame(i));   // 8 e 9 (morte, dano) são opcionais

                        let results = await Promise.all(promises);
                        for (let res of results) {
                            if (res && res.valid) {
                                frames.push(res.icon);
                                if (frameW === 0) {
                                    frameW = res.w;
                                    frameH = res.h;
                                }
                                anySuccess = true;
                            } else {
                                frames.push(null);
                            }
                        }

                        frames.animations = animations;   // acompanha os quadros em qualquer troca de tipo

                        if (anySuccess && frameW > 0 && frameH > 0) {
                            this._resources[typeName] = { frames, w: frameW, h: frameH };
                            loadedSomething = true;
                        }
                        resolve();
                    });
                });
            };

            // Load all selected types
            await Promise.all(types.map(t => loadType(t)));

            // Seleção salva com personagens que não existem mais (ex.: os originais removidos):
            // troca pelo padrão uma vez; o 'changed' do GSettings recarrega tudo.
            if (!types.some(t => this._resources[t])) {
                if (!this._typesMigrated) {
                    this._typesMigrated = true;
                    this._settings.set_strv('gnomelet-type', DEFAULT_TYPES);
                } else {
                    console.warn('Doomelets: nenhum personagem selecionado foi encontrado em images/');
                }
                return;
            }

            if (hardReset) this._hardReset();
            else this._spawnGnomelets(null);
        }

        /** Lê o manifesto de animações da pasta do personagem; null se não existir. */
        _loadAnimations(typeDir) {
            return new Promise((resolve) => {
                typeDir.get_child('animations.json').load_contents_async(this._cancellable, (file, res) => {
                    try {
                        const [, contents] = file.load_contents_finish(res);
                        resolve(JSON.parse(new TextDecoder('utf-8').decode(contents)));
                    } catch (e) {
                        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) console.warn(`animations.json: ${e}`);
                        resolve(null);
                    }
                });
            });
        }

        get isVisualizationEnabled() {
            return !this._isPaused;
        }

        /**
         * Toggles the visualization state.
         */
        toggleVisualization() {
            let current = this._settings.get_boolean('is-enabled');
            this._settings.set_boolean('is-enabled', !current);
        }

        /**
         * Starts the update timer if not already running.
         * Prevents duplicate timers and ensures single source of truth.
         */
        _startTimer() {
            if (this._timerId) return;

            this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPDATE_INTERVAL_MS, () => {
                this._tick();
                return GLib.SOURCE_CONTINUE;
            });
        }

        /**
         * Stops the update timer if running.
         */
        _stopTimer() {
            if (this._timerId) {
                GLib.source_remove(this._timerId);
                this._timerId = 0;
            }
        }

        /**
         * Enables manager, listeners, and the main timer.
         */
        enable() {
            this._cancellable = new Gio.Cancellable();
            this._settings.connectObject('changed', this._onSettingsChanged.bind(this), this);

            // Monitor system scale changes
            let themeContext = St.ThemeContext.get_for_stage(global.stage);
            if (themeContext) {
                themeContext.connectObject('notify::scale-factor',
                    () => this._updateScale(), this);
            }

            // Eventos de janela: abrir solta um demônio por um portal; abrir/fechar/minimizar
            // faz quem está perto parar e olhar
            global.display.connectObject('window-created', (_d, win) => this._onWindowCreated(win), this);
            global.window_manager.connectObject(
                'minimize', (_wm, actor) => this._onWindowGone(actor),
                'destroy', (_wm, actor) => this._onWindowGone(actor), this);

            // Async load: Start loading state asynchronously.
            // The gnomelets will spawn in the callback.
            this._loadStateAsync();

            if (!this._isPaused) {
                this._startTimer();
            }
        }

        _onSettingsChanged(settings, key) {
            if (key === 'gnomelet-count') this._updateCount();
            else if (key === 'gnomelet-scale') this._updateScale();
            else if (key === 'gnomelet-type') {
                // Trigger async load and reset
                this._loadResourcesAndSpawn(true);
            } else if (key === 'reset-trigger') {
                this._hardReset();
            } else if (key === 'is-enabled') {
                this._updateEnabledState();
            } else if (key === 'allow-interaction') {
                this._updateInteractions();
            } else if (key === 'jump-power') {
                this._updateJumpPower();
            }
        }

        /**
         * Disables everything and saves current state.
         */
        disable() {
            // Cancel any pending async load
            if (this._cancellable) {
                this._cancellable.cancel();
                this._cancellable = null;
            }

            let themeContext = St.ThemeContext.get_for_stage(global.stage);
            if (themeContext) {
                themeContext.disconnectObject(this);
            }

            global.display.disconnectObject(this);
            global.window_manager.disconnectObject(this);
            for (const id of this._pendingTimeouts) GLib.source_remove(id);
            this._pendingTimeouts.clear();
            this._destroyPortals();

            this._saveState();
            this._stopTimer();

            this._settings.disconnectObject(this);
            this._destroyGnomelets();
            this._resources = {};
        }

        /**
         * Loads saved state from JSON cache file asynchronously.
         * When done, it triggers resource loading, then spawning.
         */
        _loadStateAsync() {
            let file = Gio.File.new_for_path(this._cacheFile);

            file.load_contents_async(this._cancellable, (obj, res) => {
                let savedState = null;
                try {
                    let [success, contents, etag] = obj.load_contents_finish(res);
                    if (success) {
                        let decoder = new TextDecoder('utf-8');
                        savedState = JSON.parse(decoder.decode(contents));
                    }
                } catch (e) {
                    // Ignore cancellation errors or missing files
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                }

                this._pendingState = savedState;
                this._loadResourcesAndSpawn(false);
            });
        }

        /**
         * Saves the state of all characters to file.
         */
        _saveState() {
            try {
                let data = this._gnomelets.map(p => p.serialize());
                // NOTE: Using synchronous write on disable is generally accepted 
                // because we need to ensure state is saved before the extension object dies.
                GLib.file_set_contents(this._cacheFile, JSON.stringify(data));
            } catch (e) { }
        }

        _updateScale() {
            for (let p of this._gnomelets) {
                p.updateScale();
            }
        }

        _updateJumpPower() {
            for (let p of this._gnomelets) {
                p.updateJumpPower();
            }
        }

        _hardReset() {
            this._destroyGnomelets();
            try {
                let f = Gio.File.new_for_path(this._cacheFile);
                // This delete is synchronous but very fast and rare (user triggered).
                if (f.query_exists(null)) f.delete(null);
            } catch (e) { }
            this._spawnGnomelets(null);
        }

        /** O Doom Slayer está selecionado e com sprites carregados? */
        _wantsSlayer() {
            return this._slayerType() !== null;
        }

        /** Qual Slayer entra em cena: o clássico tem prioridade se as duas versões estiverem marcadas. */
        _slayerType() {
            const sel = this._settings.get_strv('gnomelet-type');
            return SLAYER_TYPES.find(t => this._resources[t] && sel.includes(t)) ?? null;
        }

        /**
         * Resolves a resource by name, or picks a random one among the selected types.
         * The random pick never returns the Doom Slayer: there is exactly one, spawned explicitly.
         * `originalsOnly` also excludes the demons (an original must not turn into a Doom type
         * on respawn, since it would keep the base class).
         */
        _pickResource(typeName = null, originalsOnly = false) {
            if (typeName && this._resources[typeName]) {
                let res = this._resources[typeName];
                return { type: typeName, frames: res.frames, w: res.w, h: res.h };
            }

            // Random from selected
            let selectedTypes = this._settings.get_strv('gnomelet-type');
            if (!selectedTypes || selectedTypes.length === 0) selectedTypes = DEFAULT_TYPES;
            // Filter those that are actually loaded
            let valid = selectedTypes.filter(t => !isSlayer(t) && this._resources[t] &&
                !(originalsOnly && DEMONS.includes(t)));

            // If none of selected are loaded just return null.
            if (valid.length === 0) return null;

            let t = valid[Math.floor(Math.random() * valid.length)];
            let res = this._resources[t];
            return { type: t, frames: res.frames, w: res.w, h: res.h };
        }

        /**
         * Adds or removes characters based on settings count.
         */
        _updateCount() {
            if (this._isPaused) return;
            let count = this._settings.get_int('gnomelet-count');
            // Demônios aguardando para voltar também ocupam vaga
            let current = this._gnomelets.length + this._demonQueue.length;

            // Garante o Slayer único (ele ocupa uma das vagas da contagem)
            if (count > 0 && this._wantsSlayer() && !this._gnomelets.some(g => isSlayer(g._typeName))) {
                this._addCharacter(this._pickResource(this._slayerType()));
                current++;
            }

            if (count > current) {
                for (let i = 0; i < (count - current); i++) {
                    let res = this._pickResource();
                    if (!res) break;
                    this._addCharacter(res);
                }
            } else if (count < current) {
                for (let i = 0; i < (current - count); i++) {
                    if (this._demonQueue.pop()) continue;
                    // O Slayer é o último a sair (só quando a contagem chega a 0)
                    let idx = this._gnomelets.findLastIndex(g => !isSlayer(g._typeName));
                    if (idx < 0) idx = this._gnomelets.length - 1;
                    let [p] = this._gnomelets.splice(idx, 1);
                    p.destroy();
                }
            }
        }

        _spawnGnomelets(savedState) {
            if (this._isPaused) return;
            if (!this._cancellable || this._cancellable.is_cancelled()) return;

            let count = this._settings.get_int('gnomelet-count');

            // Ensure we have at least one resource loaded
            if (!this._pickResource() && !this._wantsSlayer()) {
                this._loadResourcesAndSpawn(false);
                return;
            }

            if (this._gnomelets.length > 0) this._destroyGnomelets();

            let stateToUse = savedState || this._pendingState || [];
            this._pendingState = null;

            if (count > 0 && this._wantsSlayer()) {
                const slayerType = this._slayerType();
                this._addCharacter(this._pickResource(slayerType), stateToUse.find(d => d?.type === slayerType));
            }

            // Estados salvos dos demais (Slayers extras de versões antigas são descartados)
            let others = stateToUse.filter(d => d && !isSlayer(d.type));

            for (let i = 0; this._gnomelets.length < count; i++) {
                // Priority: Saved Type -> Random
                let saved = others[i];
                let instanceRes = this._pickResource(saved?.type);

                if (!instanceRes) instanceRes = this._pickResource(); // Fallback if somehow both failed (e.g. valid types empty)
                if (!instanceRes) break;

                this._addCharacter(instanceRes, saved);
            }
        }

        /** Demônio morto volta depois de um intervalo aleatório. */
        _queueDemon(type) {
            const ticks = DEMON_RESPAWN_MIN +
                Math.floor(Math.random() * (DEMON_RESPAWN_MAX - DEMON_RESPAWN_MIN + 1));
            this._demonQueue.push({ type, ticks });
        }

        /** Faz entrar pela borda da tela os demônios cujo tempo de espera acabou. */
        _updateDemonQueue() {
            this._demonQueue = this._demonQueue.filter(entry => {
                if (--entry.ticks > 0) return true;
                const res = this._pickResource(entry.type);
                if (res) this._addCharacter(res).enterFromEdge(Math.random() < 0.5);
                return false;
            });
        }

        _addCharacter(res, saved = null) {
            // Shared provider reference
            let provider = (t, originalsOnly) => this._pickResource(t, originalsOnly);
            let p = this._createCharacter(res.type, res.frames, res.w, res.h, provider);
            // Só restaura estado se o tipo salvo ainda existe (evita herdar hp/estado de outra classe)
            // (quem foi salvo morrendo recomeça do zero, em vez de voltar como "zumbi" com hp 0)
            if (saved && saved.type === res.type && !(p._maxHp > 0 && saved.hp <= 0)) p.deserialize(saved);
            this._gnomelets.push(p);
            return p;
        }

        _destroyGnomelets() {
            this._demonQueue = [];
            for (let p of this._gnomelets) p.destroy();
            this._gnomelets = [];
            this._destroyProjectiles();
            this._destroyPortals();
            this._gnomelets = [];
        }

        /**
         * Scans for dock/panel identifiers to determine collision and z-ordering.
         * Supports Dash to Dock and Dash to Panel.
         */
        _scanForDocks(allowDock, dockSupportMode) {
            if (dockSupportMode === 'none') return { dockContainer: null, dockWindows: [] };

            let dockContainer = null;
            let dockWindows = [];

            let uiChildren = Main.layoutManager.uiGroup.get_children();

            for (let child of uiChildren) {
                if (!child.visible && !child.mapped) continue;

                // --- 1. Dash to Dock Support ---
                if (dockSupportMode === 'dash-to-dock' && child.constructor?.name === 'DashToDock') {
                    dockContainer = child;
                    if (allowDock) {
                        // DashSlideContainer is the main non-transparent container for the dock
                        if (child.last_child?.constructor?.name === 'DashSlideContainer') {
                            let [x, y] = child.last_child.get_transformed_position();
                            let [w, h] = child.last_child.get_transformed_size();
                            if (w > 0 && h > 0) {
                                let rect = {
                                    x: Math.floor(x),
                                    y: Math.floor(y),
                                    width: Math.floor(w),
                                    height: Math.floor(h)
                                };
                                dockWindows.push({ rect, actor: child.last_child, isDock: true });
                            }
                        }
                    }
                    // Prefer Dash to Dock if found
                    break;
                }

                // --- 2. Dash to Panel Support ---
                if (dockSupportMode === 'dash-to-panel') {
                    let isDashToPanel = child.first_child?.first_child?.style_class?.startsWith('dashtopanelPanel');

                    if (isDashToPanel) {
                        dockContainer = child; // The container in uiGroup is the reference for Z-Order
                        let panelActor = child.first_child?.first_child;
                        if (allowDock && panelActor) {
                            let [x, y] = panelActor.get_transformed_position();
                            let [w, h] = panelActor.get_transformed_size();
                            if (w > 0 && h > 0) {
                                let rect = {
                                    x: Math.floor(x),
                                    y: Math.floor(y),
                                    width: Math.floor(w),
                                    height: Math.floor(h)
                                };
                                dockWindows.push({ rect, actor: panelActor, isDock: true });
                            }
                        }
                        break;
                    }
                }
            }

            return { dockContainer, dockWindows };
        }

        /**
         * Tick function executed every loop to gather windows and update character states.
         */
        _tick() {
            try {
                this._windows = [];
                let actors = global.window_group.get_children();
                let focusWindow = global.display.focus_window;
                let floorMode = this._settings.get_string('floor-z-order');

                // Helper to check maximization
                const isMax = (w) => {
                    if (!w || w.minimized || w.get_window_type() !== Meta.WindowType.NORMAL) {
                        return false;
                    }

                    // Exclude Desktop Icons NG (DING) invisible window
                    if (w.gtk_application_object_path === '/com/rastersoft/ding') {
                        return false;
                    }

                    return isWindowMaximized(w);
                };

                // 1. Gather Key Indices
                let focusedIndex = -1;
                let maximizedIndices = [];

                for (let i = 0; i < actors.length; i++) {
                    let actor = actors[i];
                    if (!actor.visible || !actor.meta_window) continue;

                    if (actor.meta_window === focusWindow) {
                        focusedIndex = i;
                    }
                    if (isMax(actor.meta_window)) {
                        maximizedIndices.push(i);
                    }
                }

                // 2. Determine Filter Bounds & Background Mode
                // We want to accept windows with index I where: minIndex < I < maxIndex
                let minIndex = -1;
                let maxIndex = actors.length;
                let forceBackground = false;

                let focusedIsMaximized = (focusedIndex !== -1) && isMax(actors[focusedIndex].meta_window);

                if (floorMode === 'partial') {
                    if (focusedIsMaximized) {
                        // PARTIAL (Maximized Focus):
                        // Range: (Previous Max) < I < (Focused Max)
                        // If no previous max, minIndex = -1.
                        forceBackground = true;
                        maxIndex = focusedIndex;

                        // Find closest max index smaller than focusedIndex
                        let prevMax = -1;
                        for (let idx of maximizedIndices) {
                            if (idx < focusedIndex) prevMax = idx;
                            else break; // maximizingIndices is sorted ascending because we pushed in loop I=0..N
                        }
                        minIndex = prevMax;

                    } else {
                        // PARTIAL (Unmaximized Focus) -> Acts like ALLOW
                        forceBackground = false;
                        if (maximizedIndices.length > 0) {
                            // Occlusion: Ignore windows below the TOPMOST maximized window
                            minIndex = maximizedIndices[maximizedIndices.length - 1];
                        }
                    }
                } else if (floorMode === 'disallow') {
                    // DISALLOW:
                    // Range: I < (Bottommost Max)
                    if (maximizedIndices.length > 0) {
                        forceBackground = true;
                        maxIndex = maximizedIndices[0]; // First one found is bottommost
                    } else {
                        forceBackground = false; // No maximized windows, behave normally
                    }

                } else {
                    // ALLOW:
                    // Range: I > (Topmost Max) (Occlusion logic)
                    forceBackground = false;
                    if (maximizedIndices.length > 0) {
                        minIndex = maximizedIndices[maximizedIndices.length - 1];
                    }
                }

                // 3. Collect Valid Windows
                for (let i = 0; i < actors.length; i++) {
                    // Strict bounds check
                    if (i <= minIndex || i >= maxIndex) continue;

                    let actor = actors[i];
                    if (!actor.visible || !actor.meta_window) continue;

                    // Exclude DING from collision surfaces
                    if (actor.meta_window.gtk_application_object_path === '/com/rastersoft/ding') continue;

                    if (actor.meta_window.minimized || isMax(actor.meta_window)) continue;

                    let rect = actor.meta_window.get_frame_rect();
                    this._windows.push({ rect, actor });
                }

                // 4. Find Docks (Dash to Dock / Dash to Panel)
                let allowDock = true;
                let hasMaximized = maximizedIndices.length > 0;

                if (hasMaximized) {
                    if (floorMode === 'disallow') {
                        allowDock = false;
                    } else if (floorMode === 'partial') {
                        // Only allow if focused window exists and is NOT maximized
                        let focusedUnique = (focusedIndex !== -1);
                        if (!focusedUnique || focusedIsMaximized) {
                            allowDock = false;
                        }
                    }
                }

                let dockSupportMode = this._settings.get_string('dock-support');
                // Use the new modular scanner
                let { dockContainer, dockWindows } = this._scanForDocks(allowDock, dockSupportMode);
                if (dockWindows.length > 0) {
                    this._windows.push(...dockWindows);
                }

                this._updateDemonQueue();
                this._portalGate.tick();
                this._updateEphemeral();
                this._updatePortals();
                const [pointerX, pointerY] = global.get_pointer();
                const pointerStill = this._pointerTracker.update(pointerX, pointerY);
                for (let p of this._gnomelets) {
                p.observePointer(pointerX, pointerY, pointerStill);
                p.update(this._windows, forceBackground, dockContainer, this._gnomelets, this._projectiles);
            }
            this._updateProjectiles();
            // Doom: remover entidades marcadas para destruição
            if (this._gnomelets.some(g => g._markedForRemoval)) {
                this._gnomelets = this._gnomelets.filter(g => {
                    if (g._markedForRemoval) {
                        if (DEMONS.includes(g._typeName) && !g._ephemeral) this._queueDemon(g._typeName);
                        g.destroy();
                        return false;
                    }
                    return true;
                });
            }
            } catch (e) {
                console.error(e);
            }
        }

        // ---------- Eventos de janela e portais ----------

        _onWindowCreated(win) {
            if (this._isPaused || !win) return;
            let type;
            try { type = win.get_window_type(); } catch (e) { return; }
            if (type !== Meta.WindowType.NORMAL) return;
            // O retângulo da janela só é válido depois do primeiro frame
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                this._pendingTimeouts.delete(id);
                try { this._onWindowReady(win); } catch (e) { console.error(e); }
                return GLib.SOURCE_REMOVE;
            });
            this._pendingTimeouts.add(id);
        }

        /** Janela nova pronta: todos reparam; às vezes um demônio sai de um portal no topo dela. */
        _onWindowReady(win) {
            if (this._isPaused || !win.get_compositor_private()) return;
            const rect = win.get_frame_rect();
            if (rect.width < 160 || rect.height < 120) return;
            this._noticeAround(rect.x + rect.width / 2, rect.y);
            this._portalDemon(rect);
        }

        /** Solta um demônio (efêmero) no topo de `rect`, se o portão permitir. Devolve-o ou null. */
        _portalDemon(rect) {
            // O teto vale só para demônios de portal: a contagem normal do usuário não bloqueia portais
            const active = this._gnomelets.filter(g => g._ephemeral).length;
            const selected = this._settings.get_strv('gnomelet-type');
            const type = this._portalGate.consider(active, n => Boolean(this._resources[n]) && selected.includes(n));
            if (!type) {
                console.log(`Doomelets: janela nova sem portal (${this._portalGate.lastReason})`);
                return null;
            }
            const res = this._pickResource(type);
            if (!res) return null;
            const p = this._addCharacter(res);
            p._ephemeral = true;                 // não renasce ao morrer nem ao sumir
            p._portalTtl = PORTAL_DEMON_TTL;
            const at = p.arriveAt(rect);
            this._portals.push(new Portal(at.x, at.y));
            return p;
        }

        /** Janela fechou ou minimizou: quem está perto para e olha para lá. */
        _onWindowGone(actor) {
            if (this._isPaused || !actor) return;
            try {
                const [x, y] = actor.get_position();
                const [w, h] = actor.get_size();
                this._noticeAround(x + w / 2, y + h / 2);
            } catch (e) { /* ator já destruído */ }
        }

        _noticeAround(cx, cy) {
            for (const g of this._gnomelets) {
                if (!g.actor) continue;
                const d = Math.hypot(g._x + g._displayW / 2 - cx, g._y + g._displayH / 2 - cy);
                if (d < NOTICE_RANGE) g.notice(cx, cy);
            }
        }

        /** Demônios de portal somem depois de um tempo (com um portal de saída). */
        _updateEphemeral() {
            for (const g of this._gnomelets) {
                if (!(g._portalTtl > 0) || g._markedForRemoval) continue;
                if (--g._portalTtl === 0) {
                    this._portals.push(new Portal(g._x + g._displayW / 2, g._y + g._displayH / 2));
                    g._markedForRemoval = true;
                }
            }
        }

        _updatePortals() {
            if (this._portals.length === 0) return;
            this._portals = this._portals.filter(p => {
                p.update();
                if (!p.alive) { p.destroy(); return false; }
                return true;
            });
        }

        _destroyPortals() {
            for (const p of this._portals) p.destroy();
            this._portals = [];
        }

        _updateInteractions() {
            for (let p of this._gnomelets) {
                p._updateInteraction();
            }
        }

        /**
         * Updates the enabled state of the extension.
         */
        _updateEnabledState() {
            let enabled = this._settings.get_boolean('is-enabled');
            this._isPaused = !enabled;

            if (this._isPaused) {
                this._stopTimer();
                this._destroyGnomelets();
            } else {
                this._startTimer();
                // If we have pending state (e.g. from initial load), it will be used.
                // Otherwise, normal spawn.
                this._spawnGnomelets(null);
            }
        }
        /**
         * Doom: Factory — instancia a subclasse correta pelo nome do tipo.
         */
        _createCharacter(type, frames, w, h, provider) {
            const args = [type, frames, w, h, this._settings, provider];
            const cbFor = (owner) => (x, y, vx, vy, dmg) => this._spawnProjectile(x, y, vx, vy, owner, dmg);
            switch (type) {
                case 'Imp':
                case 'Imp2':       return new Imp(...args, cbFor('imp'));
                case 'Cacodemon':  return new Cacodemon(...args, cbFor('caco'));
                case 'LostSoul':   return new LostSoul(...args, cbFor('caco'));
                case 'DoomSlayer':
                case 'DoomEternal': return new DoomSlayer(...args, cbFor('slayer'));
                default:           return new Gnomelet(...args);
            }
        }

        /**
         * Doom: Cria um projétil e adiciona à lista gerenciada.
         */
        _spawnProjectile(x, y, vx, vy, owner, damage) {
            this._projectiles.push(new Projectile(x, y, vx, vy, owner, damage));
        }

        /**
         * Doom: Atualiza todos os projéteis ativos.
         */
        _updateProjectiles() {
            if (this._projectiles.length === 0) return;
            const slayers = this._gnomelets.filter(g => isSlayer(g._typeName));
            const enemies = this._gnomelets.filter(g => DEMONS.includes(g._typeName));
            this._projectiles = this._projectiles.filter(p => {
                p.update(p.owner === 'slayer' ? enemies : slayers);
                if (!p.alive) { p.destroy(); return false; }
                return true;
            });
        }

        /**
         * Doom: Destrói todos os projéteis ativos.
         */
        _destroyProjectiles() {
            for (let p of this._projectiles) p.destroy();
            this._projectiles = [];
        }

});