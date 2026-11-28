import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { placeActor } from './motion.js';

// Aparência por dono: tamanho (px) e estilo CSS
const LOOKS = {
    imp:    { size: 18, style: 'background-color: #ff5a10; border-radius: 9px; box-shadow: 0 0 10px 4px rgba(255, 110, 20, 0.85);' },
    caco:   { size: 24, style: 'background-color: #e02a10; border-radius: 12px; box-shadow: 0 0 12px 5px rgba(255, 70, 20, 0.85);' },
    slayer: { size: 6,  style: 'background-color: #ffe070; border-radius: 3px; box-shadow: 0 0 5px 2px rgba(255, 220, 120, 0.9);' },
};

const MAX_LIFETIME_TICKS = 200;   // ~10s a 20 ticks/s

/**
 * Projétil simples: um widget que anda em linha reta e causa dano ao primeiro alvo que tocar.
 * `owner` define a aparência e quem pode ser atingido (o Manager escolhe os alvos).
 */
export class Projectile {
    constructor(x, y, vx, vy, owner = 'imp', damage = 1) {
        const look = LOOKS[owner] ?? LOOKS.imp;
        this.owner = owner;
        this.damage = damage;
        this.vx = vx;
        this.vy = vy;
        this.alive = true;
        this._size = look.size;
        this._ticks = 0;
        this._x = x - this._size / 2;
        this._y = y - this._size / 2;

        this.actor = new St.Widget({
            style: look.style,
            width: this._size,
            height: this._size,
            reactive: false,
        });
        this.actor.set_position(Math.floor(this._x), Math.floor(this._y));
        Main.layoutManager.uiGroup.add_child(this.actor);
    }

    /** Avança um tick; `targets` são as entidades que este projétil pode ferir. */
    update(targets = []) {
        if (!this.alive || !this.actor) return;

        this._x += this.vx;
        this._y += this.vy;
        placeActor(this.actor, Math.floor(this._x), Math.floor(this._y));

        if (++this._ticks > MAX_LIFETIME_TICKS ||
            this._x < -50 || this._x > global.stage.width + 50 ||
            this._y < -50 || this._y > global.stage.height + 50) {
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
            const parent = this.actor.get_parent();
            if (parent) parent.remove_child(this.actor);
            this.actor.destroy();
            this.actor = null;
        }
    }
}
