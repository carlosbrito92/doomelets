// Port KWin de src/projectile.js. O desenho (bola com brilho) fica no main.qml, que lê `look`.

import { platform } from './utils.mjs';

// Aparência por dono: tamanho (px), cor do núcleo e do brilho
export const LOOKS = {
    imp:    { size: 18, color: '#ff5a10', glow: '#d9ff6e14', glowSize: 14 },
    caco:   { size: 24, color: '#e02a10', glow: '#d9ff4614', glowSize: 17 },
    slayer: { size: 6,  color: '#ffe070', glow: '#e6ffdc78', glowSize: 7 },
};

const MAX_LIFETIME_TICKS = 200;   // ~10s a 20 ticks/s

/**
 * Projétil simples: anda em linha reta e causa dano ao primeiro alvo que tocar.
 * `owner` define a aparência e quem pode ser atingido (o Manager escolhe os alvos).
 */
export class Projectile {
    constructor(x, y, vx, vy, owner = 'imp', damage = 1) {
        this.look = LOOKS[owner] ?? LOOKS.imp;
        this.owner = owner;
        this.damage = damage;
        this.vx = vx;
        this.vy = vy;
        this.alive = true;
        this._size = this.look.size;
        this._ticks = 0;
        this._x = x - this._size / 2;
        this._y = y - this._size / 2;
        this.actor = null;   // item QML, atribuído pelo main.qml
    }

    /** Avança um tick; `targets` são as entidades que este projétil pode ferir. */
    update(targets = []) {
        if (!this.alive) return;

        this._x += this.vx;
        this._y += this.vy;

        if (++this._ticks > MAX_LIFETIME_TICKS ||
            this._x < -50 || this._x > platform.stageWidth() + 50 ||
            this._y < -50 || this._y > platform.stageHeight() + 50) {
            this.alive = false;
            return;
        }

        const cx = this._x + this._size / 2;
        const cy = this._y + this._size / 2;
        for (const t of targets) {
            if (!t.actor || t._isDead || !(t._maxHp > 0) || t._hp <= 0) continue;
            // Caixa de colisão: 60% central do sprite
            const w = (t._displayW ?? 0) * 0.6, h = (t._displayH ?? 0) * 0.8;
            const left = t._x + ((t._displayW ?? 0) - w) / 2;
            const top = t._y + ((t._displayH ?? 0) - h) / 2;
            if (cx >= left && cx <= left + w && cy >= top && cy <= top + h) {
                t.takeDamage(this.damage);
                this.alive = false;
                return;
            }
        }
    }

    destroy() {
        this.alive = false;
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}
