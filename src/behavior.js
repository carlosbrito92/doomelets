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
