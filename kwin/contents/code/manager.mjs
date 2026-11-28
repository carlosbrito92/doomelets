// Port KWin de src/manager.js. Mesma orquestração (contagem, Slayer único, fila de demônios,
// projéteis); o que é do compositor vem do `host` passado pelo main.qml:
//   host.sprites                      — manifesto gerado (sprites.mjs)
//   host.imageUrl(type, index)        — URL do PNG de um quadro
//   host.createView(entity)           — cria o item QML do personagem
//   host.createProjectileView(p)      — cria o item QML do projétil
//   host.collectWindows(floorMode, walkOnPanels) — { windows, forceBackground }
//   host.pointer()                    — { x, y } do cursor
//   host.createPortalView(portal)     — cria o item QML do portal
//   host.windowRect(win)              — retângulo da janela nova, se ainda viva e visível (senão null)
// Sem persistência em disco: scripts do KWin não podem escrever arquivos.

import { Gnomelet } from './gnomelet.mjs';
import { Imp }        from './characters/imp.mjs';
import { Cacodemon }  from './characters/cacodemon.mjs';
import { DoomSlayer } from './characters/doom-slayer.mjs';
import { Projectile } from './projectile.mjs';
import { Portal } from './portal.mjs';
import { PointerTracker, PortalGate } from './behavior.mjs';
import { NOTICE_RANGE, PORTAL_DEMON_TTL, DEFAULT_TYPES, SLAYER_TYPES } from './utils.mjs';

const isSlayer = t => SLAYER_TYPES.includes(t);   // sempre exatamente um Slayer (clássico ou Eternal) em cena quando selecionado
const DEMONS = ['Imp', 'Imp2', 'Cacodemon'];   // Imp2: variação visual do Imp (mesma classe e IA)

export class GnomeletManager {
    constructor(settings, host) {
        this._settings = settings;
        this._host = host;
        this._gnomelets = [];
        this._demonQueue = [];
        this._projectiles = [];
        this._portals = [];                       // anéis de fogo de entrada/saída
        this._portalGate = new PortalGate();      // janela nova → às vezes sai um demônio
        this._pointerTracker = new PointerTracker();
        this._pendingWindows = [];                // janelas novas esperando o primeiro frame
        this._resources = {};
        this._isPaused = !this._settings.get_boolean('is-enabled');
        this.forceBackground = false;
    }

    get gnomelets() { return this._gnomelets; }
    get projectiles() { return this._projectiles; }
    get isVisualizationEnabled() { return !this._isPaused; }

    /** Monta { frames, w, h } para um tipo a partir do manifesto; null se não existir. */
    _loadType(typeName) {
        if (this._resources[typeName]) return;
        const spr = this._host.sprites[typeName];
        if (!spr || !(spr.w > 0 && spr.h > 0)) return;

        const present = new Set(spr.present);
        const total = spr.animations
            ? 1 + Object.values(spr.animations).reduce((m, a) => Math.max(m, ...a.frames), 0)
            : Math.max(10, spr.count);
        const frames = [];
        for (let i = 0; i < total; i++) frames.push(present.has(i) ? this._host.imageUrl(typeName, i) : null);
        frames.animations = spr.animations;   // acompanha os quadros em qualquer troca de tipo
        this._resources[typeName] = { frames, w: spr.w, h: spr.h };
    }

    _loadResourcesAndSpawn(hardReset = false) {
        let types = this._settings.get_strv('gnomelet-type');
        if (!types || types.length === 0) types = DEFAULT_TYPES;
        types.forEach(t => this._loadType(t));

        if (hardReset) this._hardReset();
        else this._spawnGnomelets(null);
    }

    toggleVisualization() {
        this._settings.set_boolean('is-enabled', !this._settings.get_boolean('is-enabled'));
    }

    enable() {
        this._loadResourcesAndSpawn(false);
    }

    disable() {
        this._destroyGnomelets();
        this._resources = {};
    }

    onSettingsChanged(key) {
        if (key === 'gnomelet-count') this._updateCount();
        else if (key === 'gnomelet-scale') this._gnomelets.forEach(p => p.updateScale());
        else if (key === 'gnomelet-type') this._loadResourcesAndSpawn(true);
        else if (key === 'is-enabled') this._updateEnabledState();
        else if (key === 'jump-power') this._gnomelets.forEach(p => p.updateJumpPower());
        else if (key.startsWith('health-')) this._gnomelets.forEach(p => this._applyHealth(p));
    }

    _hardReset() {
        this._destroyGnomelets();
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
     * Resolve um recurso pelo nome, ou sorteia entre os tipos selecionados.
     * O sorteio nunca devolve o Slayer (há exatamente um, criado explicitamente).
     * `originalsOnly` exclui também os demônios.
     */
    _pickResource(typeName = null, originalsOnly = false) {
        if (typeName && this._resources[typeName]) {
            let res = this._resources[typeName];
            return { type: typeName, frames: res.frames, w: res.w, h: res.h };
        }

        let selectedTypes = this._settings.get_strv('gnomelet-type');
        if (!selectedTypes || selectedTypes.length === 0) selectedTypes = DEFAULT_TYPES;
        let valid = selectedTypes.filter(t => !isSlayer(t) && this._resources[t] &&
            !(originalsOnly && DEMONS.includes(t)));
        if (valid.length === 0) return null;

        let t = valid[Math.floor(Math.random() * valid.length)];
        let res = this._resources[t];
        return { type: t, frames: res.frames, w: res.w, h: res.h };
    }

    _updateCount() {
        if (this._isPaused) return;
        let count = this._settings.get_int('gnomelet-count');
        let current = this._gnomelets.length + this._demonQueue.length;

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
                let idx = this._gnomelets.length - 1;
                while (idx > 0 && isSlayer(this._gnomelets[idx]._typeName)) idx--;
                let [p] = this._gnomelets.splice(idx, 1);
                p.destroy();
            }
        }
    }

    _spawnGnomelets(savedState) {
        if (this._isPaused) return;

        let count = this._settings.get_int('gnomelet-count');
        if (!this._pickResource() && !this._wantsSlayer()) return;

        if (this._gnomelets.length > 0) this._destroyGnomelets();

        let stateToUse = savedState || [];

        if (count > 0 && this._wantsSlayer()) {
            const slayerType = this._slayerType();
            this._addCharacter(this._pickResource(slayerType), stateToUse.find(d => d?.type === slayerType));
        }

        let others = stateToUse.filter(d => d && !isSlayer(d.type));
        for (let i = 0; this._gnomelets.length < count; i++) {
            let saved = others[i];
            let instanceRes = this._pickResource(saved?.type) || this._pickResource();
            if (!instanceRes) break;
            this._addCharacter(instanceRes, saved);
        }
    }

    _queueDemon(type) {
        // Espera configurável (no GNOME era fixa em 100–200 ticks, 5 a 10 s)
        const min = this._settings.get_int('demon-respawn-min');
        const max = this._settings.get_int('demon-respawn-max');
        const ticks = min + Math.floor(Math.random() * (max - min + 1));
        this._demonQueue.push({ type, ticks });
    }

    _updateDemonQueue() {
        this._demonQueue = this._demonQueue.filter(entry => {
            if (--entry.ticks > 0) return true;
            const res = this._pickResource(entry.type);
            if (res) this._addCharacter(res).enterFromEdge(Math.random() < 0.5);
            return false;
        });
    }

    _addCharacter(res, saved = null) {
        let provider = (t, originalsOnly) => this._pickResource(t, originalsOnly);
        let p = this._createCharacter(res.type, res.frames, res.w, res.h, provider);
        if (saved && saved.type === res.type && !(p._maxHp > 0 && saved.hp <= 0)) p.deserialize(saved);
        p.actor = this._host.createView(p);
        this._gnomelets.push(p);
        return p;
    }

    _destroyGnomelets() {
        this._demonQueue = [];
        this._pendingWindows = [];
        this._destroyPortals();
        for (let p of this._gnomelets) p.destroy();
        this._gnomelets = [];
        this._destroyProjectiles();
    }

    /** Um passo da simulação (chamado pelo Timer do main.qml). */
    tick() {
        if (this._isPaused) return;
        try {
            const { windows, forceBackground } = this._host.collectWindows(
                this._settings.get_string('floor-z-order'),
                this._settings.get_boolean('walk-on-panels'));
            this.forceBackground = forceBackground;

            this._updateDemonQueue();
            this._portalGate.tick();
            this._updatePendingWindows();
            this._updateEphemeral();
            this._updatePortals();
            const ptr = this._host.pointer();
            const pointerStill = this._pointerTracker.update(ptr.x, ptr.y);
            for (let p of this._gnomelets) {
                p.observePointer(ptr.x, ptr.y, pointerStill);
                p.update(windows, forceBackground, null, this._gnomelets, this._projectiles);
            }
            this._updateProjectiles();

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
            console.warn(`Doomelets tick: ${e}\n${e.stack}`);
        }
    }

    // ---------- Eventos de janela e portais (chamados pelo main.qml) ----------

    /** Janela nova: espera ~300 ms (6 ticks) pelo primeiro frame antes de olhar a geometria. */
    onWindowAdded(win) {
        if (this._isPaused || !win) return;
        console.warn('Doomelets: janela nova detectada');
        this._pendingWindows.push({ win, ticks: 6 });
    }

    /** Janela fechou ou minimizou em `rect`: quem está perto para e olha para lá. */
    onWindowGone(rect) {
        if (this._isPaused || !rect) return;
        this._noticeAround(rect.x + rect.width / 2, rect.y + rect.height / 2);
    }

    _updatePendingWindows() {
        if (this._pendingWindows.length === 0) return;
        this._pendingWindows = this._pendingWindows.filter(entry => {
            if (--entry.ticks > 0) return true;
            const rect = this._host.windowRect(entry.win);
            if (rect && rect.width >= 160 && rect.height >= 120) this._onWindowReady(rect);
            else console.warn('Doomelets: janela nova ignorada (sem geometria válida, minimizada ou pequena demais)');
            return false;
        });
    }

    /** Janela nova pronta: todos reparam; às vezes um demônio sai de um portal no topo dela. */
    _onWindowReady(rect) {
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
            console.warn(`Doomelets: janela nova sem portal (${this._portalGate.lastReason})`);
            return null;
        }
        const res = this._pickResource(type);
        if (!res) return null;
        const p = this._addCharacter(res);
        p._ephemeral = true;                 // não renasce ao morrer nem ao sumir
        p._portalTtl = PORTAL_DEMON_TTL;
        const at = p.arriveAt(rect);
        this._addPortal(at.x, at.y);
        console.warn(`Doomelets: portal aberto, saiu um ${type}`);
        return p;
    }

    _noticeAround(cx, cy) {
        for (const g of this._gnomelets) {
            if (!g.actor) continue;
            const d = Math.hypot(g._x + g._displayW / 2 - cx, g._y + g._displayH / 2 - cy);
            if (d < NOTICE_RANGE) g.notice(cx, cy);
        }
    }

    _addPortal(x, y) {
        const portal = new Portal(x, y);
        portal.actor = this._host.createPortalView(portal);
        this._portals.push(portal);
    }

    /** Demônios de portal somem depois de um tempo (com um portal de saída). */
    _updateEphemeral() {
        for (const g of this._gnomelets) {
            if (!(g._portalTtl > 0) || g._markedForRemoval) continue;
            if (--g._portalTtl === 0) {
                this._addPortal(g._x + g._displayW / 2, g._y + g._displayH / 2);
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

    _updateEnabledState() {
        this._isPaused = !this._settings.get_boolean('is-enabled');
        if (this._isPaused) {
            this._destroyGnomelets();
        } else {
            this._spawnGnomelets(null);
        }
    }

    _createCharacter(type, frames, w, h, provider) {
        const args = [type, frames, w, h, this._settings, provider];
        const cbFor = (owner) => (x, y, vx, vy, dmg) => this._spawnProjectile(x, y, vx, vy, owner, dmg);
        let p;
        switch (type) {
            case 'Imp':
            case 'Imp2':       p = new Imp(...args, cbFor('imp')); break;
            case 'Cacodemon':  p = new Cacodemon(...args, cbFor('caco')); break;
            case 'DoomSlayer':
            case 'DoomEternal': p = new DoomSlayer(...args, cbFor('slayer')); break;
            default:           return new Gnomelet(...args);
        }
        this._applyHealth(p, true);
        return p;
    }

    /** Vida máxima configurável dos personagens Doom; quem está vivo mantém a proporção. */
    _applyHealth(p, fresh = false) {
        const maxHp = this._settings.get_int(`health-${p._typeName}`);
        if (!(p._maxHp > 0) || !(maxHp > 0) || maxHp === p._maxHp) return;
        if (fresh) p._hp = maxHp;
        else if (p._hp > 0) p._hp = Math.max(1, Math.round(p._hp * maxHp / p._maxHp));
        p._maxHp = maxHp;
    }

    _spawnProjectile(x, y, vx, vy, owner, damage) {
        const p = new Projectile(x, y, vx, vy, owner, damage);
        p.actor = this._host.createProjectileView(p);
        this._projectiles.push(p);
    }

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

    _destroyProjectiles() {
        for (let p of this._projectiles) p.destroy();
        this._projectiles = [];
    }
}
