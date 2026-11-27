// Port KWin de src/manager.js. Mesma orquestração (contagem, Slayer único, fila de demônios,
// projéteis); o que é do compositor vem do `host` passado pelo main.qml:
//   host.sprites                      — manifesto gerado (sprites.mjs)
//   host.imageUrl(type, index)        — URL do PNG de um quadro
//   host.createView(entity)           — cria o item QML do personagem
//   host.createProjectileView(p)      — cria o item QML do projétil
//   host.collectWindows(floorMode, walkOnPanels) — { windows, forceBackground }
// Sem persistência em disco: scripts do KWin não podem escrever arquivos.

import { Gnomelet } from './gnomelet.mjs';
import { Imp }        from './characters/imp.mjs';
import { Cacodemon }  from './characters/cacodemon.mjs';
import { DoomSlayer } from './characters/doom-slayer.mjs';
import { Projectile } from './projectile.mjs';

const SLAYER = 'DoomSlayer';   // sempre exatamente um em cena quando selecionado
const DEMONS = ['Imp', 'Cacodemon'];
const DEMON_RESPAWN_MIN = 100;   // ticks (~5s)
const DEMON_RESPAWN_MAX = 200;   // ticks (~10s)

export class GnomeletManager {
    constructor(settings, host) {
        this._settings = settings;
        this._host = host;
        this._gnomelets = [];
        this._demonQueue = [];
        this._projectiles = [];
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
        if (!types || types.length === 0) types = ['Santa'];
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
    }

    _hardReset() {
        this._destroyGnomelets();
        this._spawnGnomelets(null);
    }

    /** O Doom Slayer está selecionado e com sprites carregados? */
    _wantsSlayer() {
        return Boolean(this._resources[SLAYER]) &&
            this._settings.get_strv('gnomelet-type').includes(SLAYER);
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
        if (!selectedTypes || selectedTypes.length === 0) selectedTypes = ['Santa'];
        let valid = selectedTypes.filter(t => t !== SLAYER && this._resources[t] &&
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

        if (count > 0 && this._wantsSlayer() && !this._gnomelets.some(g => g._typeName === SLAYER)) {
            this._addCharacter(this._pickResource(SLAYER));
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
                while (idx > 0 && this._gnomelets[idx]._typeName === SLAYER) idx--;
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
            this._addCharacter(this._pickResource(SLAYER), stateToUse.find(d => d?.type === SLAYER));
        }

        let others = stateToUse.filter(d => d && d.type !== SLAYER);
        for (let i = 0; this._gnomelets.length < count; i++) {
            let saved = others[i];
            let instanceRes = this._pickResource(saved?.type) || this._pickResource();
            if (!instanceRes) break;
            this._addCharacter(instanceRes, saved);
        }
    }

    _queueDemon(type) {
        const ticks = DEMON_RESPAWN_MIN +
            Math.floor(Math.random() * (DEMON_RESPAWN_MAX - DEMON_RESPAWN_MIN + 1));
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
            for (let p of this._gnomelets) {
                p.update(windows, forceBackground, null, this._gnomelets, this._projectiles);
            }
            this._updateProjectiles();

            if (this._gnomelets.some(g => g._markedForRemoval)) {
                this._gnomelets = this._gnomelets.filter(g => {
                    if (g._markedForRemoval) {
                        if (DEMONS.includes(g._typeName)) this._queueDemon(g._typeName);
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
        switch (type) {
            case 'Imp':        return new Imp(...args, cbFor('imp'));
            case 'Cacodemon':  return new Cacodemon(...args, cbFor('caco'));
            case 'DoomSlayer': return new DoomSlayer(...args, cbFor('slayer'));
            default:           return new Gnomelet(...args);
        }
    }

    _spawnProjectile(x, y, vx, vy, owner, damage) {
        const p = new Projectile(x, y, vx, vy, owner, damage);
        p.actor = this._host.createProjectileView(p);
        this._projectiles.push(p);
    }

    _updateProjectiles() {
        if (this._projectiles.length === 0) return;
        const slayers = this._gnomelets.filter(g => g._typeName === SLAYER);
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
