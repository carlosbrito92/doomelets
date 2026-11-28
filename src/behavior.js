/**
 * Lógica de comportamento pura (sem GNOME): sorteio de idle, curiosidade com o ponteiro,
 * direção e suavização de movimento. Fica separada de `gnomelet.js` para ser testada
 * com `node --test tests/` e reaproveitada pela versão KWin.
 */

/** Distância (px) acima da qual o movimento entre dois ticks é um "teleporte" e não deve ser suavizado. */
export function needsSnap(dx, dy, threshold) {
    return Math.hypot(dx, dy) > threshold;
}

/** Direção para olhar de `fromX` a `toX`: true = direita; `fallback` se estiverem alinhados. */
export function facingToward(fromX, toX, fallback = true) {
    if (toX > fromX) return true;
    if (toX < fromX) return false;
    return fallback;
}

/** Aproxima `current` de `target` mudando no máximo `accel` por tick (aceleração suave). */
export function steerToward(current, target, accel) {
    const d = target - current;
    if (Math.abs(d) <= accel) return target;
    return current + Math.sign(d) * accel;
}

/**
 * Sorteia a variação de idle de um personagem.
 * `variants`: [{ name, weight = 1, cooldown = 0 }]; `name: null` significa "só respirar".
 * Só entram no sorteio variações cujo quadro existe (`available(name)`) e fora do cooldown
 * (em ticks do `tick()`).
 */
export class IdleScheduler {
    constructor(variants = [], rng = Math.random) {
        this.variants = variants;
        this.rng = rng;
        this.clock = 0;
        this._last = new Map();
    }

    tick() { this.clock++; }

    pick(available = () => true) {
        const pool = this.variants.filter(v => {
            if (v.name === null) return true;
            if (!available(v.name)) return false;
            const last = this._last.get(v.name);
            return !v.cooldown || last === undefined || this.clock - last >= v.cooldown;
        });
        const total = pool.reduce((s, v) => s + (v.weight ?? 1), 0);
        if (total <= 0) return null;
        let r = this.rng() * total;
        for (const v of pool) {
            r -= v.weight ?? 1;
            if (r < 0) {
                if (v.name !== null) this._last.set(v.name, this.clock);
                return v.name;
            }
        }
        return null;
    }
}

/**
 * Curiosidade com o ponteiro: quanto mais tempo ele fica perto, maior o nível.
 * 0 = ignora, 1 = notou (vira para o cursor), 2 = encara (reação especial do personagem).
 * Ao se afastar o nível decai devagar, para não oscilar quando o mouse treme na borda.
 */
export class Curiosity {
    constructor({ range = 220, noticeTicks = 6, stareTicks = 60, decay = 2 } = {}) {
        Object.assign(this, { range, noticeTicks, stareTicks, decay });
        this.dwell = 0;
    }

    /** Atualiza com a distância atual ao ponteiro e devolve o nível (0, 1 ou 2). */
    update(dist) {
        if (dist < this.range) this.dwell++;
        else this.dwell = Math.max(0, this.dwell - this.decay);
        return this.level;
    }

    get level() {
        if (this.dwell >= this.stareTicks) return 2;
        if (this.dwell >= this.noticeTicks) return 1;
        return 0;
    }
}

/** Quantos ticks seguidos o ponteiro está (quase) parado. */
export class PointerTracker {
    constructor(tolerance = 2) {
        this.tolerance = tolerance;
        this.still = 0;
        this._x = null;
        this._y = null;
    }

    update(x, y) {
        const moved = this._x === null || Math.abs(x - this._x) + Math.abs(y - this._y) > this.tolerance;
        this._x = x; this._y = y;
        this.still = moved ? 0 : this.still + 1;
        return this.still;
    }
}

/**
 * Decide se uma janela nova abre um portal e que demônio sai dele.
 * Respeita intervalo mínimo (em ticks), chance e teto de demônios *de portal* vivos
 * (`maxActive`; os demônios normais da contagem do usuário não entram na conta).
 * `lastReason` diz por que a última consulta não abriu portal (para o log).
 */
export class PortalGate {
    constructor({ cooldown = 400, chance = 0.5, maxActive = 3, weights = { Imp: 3, Cacodemon: 1 } } = {}, rng = Math.random) {
        Object.assign(this, { cooldown, chance, maxActive, weights, rng });
        this._cool = 0;
        this.lastReason = '';
    }

    tick() { if (this._cool > 0) this._cool--; }

    /** Devolve o nome do demônio a soltar, ou null. `available(nome)` filtra o que está carregado/selecionado. */
    consider(active, available = () => true) {
        if (this._cool > 0) { this.lastReason = 'intervalo'; return null; }
        if (active >= this.maxActive) { this.lastReason = 'teto de demônios de portal'; return null; }
        if (this.rng() >= this.chance) { this.lastReason = 'sem sorte'; return null; }
        const pool = Object.entries(this.weights).filter(([n]) => available(n));
        const total = pool.reduce((s, [, w]) => s + w, 0);
        if (total <= 0) { this.lastReason = 'nenhum tipo disponível'; return null; }
        let r = this.rng() * total;
        for (const [name, w] of pool) {
            r -= w;
            if (r < 0) { this._cool = this.cooldown; this.lastReason = ''; return name; }
        }
        return null;
    }
}

/**
 * Covardia do Imp: com pouca vida ele foge do ameaçador em vez de lutar.
 * Devolve a direção de fuga (+1 direita, -1 esquerda) ou 0 (lutar). Histerese evita ficar
 * alternando na borda do raio; encurralado na borda da tela, ele enfrenta.
 */
export function fleeDirection({ hp, maxHp, selfX, threatX, dist, fleeing = false,
                                screenW, margin = 80, range = 350, hysteresis = 1.3 }) {
    const scared = hp > 0 && hp <= Math.max(1, Math.floor(maxHp / 3));
    if (!scared || dist >= (fleeing ? range * hysteresis : range)) return 0;
    const dir = selfX >= threatX ? 1 : -1;
    if ((dir > 0 && selfX > screenW - margin) || (dir < 0 && selfX < margin)) return 0;
    return dir;
}

/**
 * O Slayer "guarda" o cursor quando ele fica parado por muito tempo (usuário lendo/ausente):
 * vai até ele e fica por perto. dir: -1/0/1; guarding=false devolve ao comportamento normal.
 */
export function guardMove({ still, afterTicks = 600, selfX, pointerX, stop = 140 }) {
    if (still < afterTicks) return { guarding: false, dir: 0 };
    const d = pointerX - selfX;
    if (Math.abs(d) <= stop) return { guarding: true, dir: 0 };
    return { guarding: true, dir: Math.sign(d) };
}
