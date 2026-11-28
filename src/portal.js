import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SIZE = 64;
const LIFE_TICKS = 16;   // ~0,8 s

/** Anel de fogo que abre e some no ponto onde um demônio entra (ou sai) de cena. */
export class Portal {
    constructor(cx, cy) {
        this.alive = true;
        this._ticks = 0;
        this.actor = new St.Widget({
            style: 'border: 3px solid #ff7a1a; border-radius: 32px; background-color: rgba(255, 90, 20, 0.25);' +
                   'box-shadow: 0 0 18px 6px rgba(255, 110, 20, 0.8);',
            width: SIZE, height: SIZE, reactive: false,
        });
        this.actor.set_position(Math.floor(cx - SIZE / 2), Math.floor(cy - SIZE / 2));
        this.actor.set_pivot_point(0.5, 0.5);
        this.actor.set_scale(0.2, 0.2);
        Main.layoutManager.uiGroup.add_child(this.actor);

        this.actor.save_easing_state();
        this.actor.set_easing_duration(LIFE_TICKS * 50 - 100);
        this.actor.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
        this.actor.set_scale(1.3, 1.3);
        this.actor.opacity = 0;
        this.actor.restore_easing_state();
    }

    update() {
        if (++this._ticks >= LIFE_TICKS) this.alive = false;
    }

    destroy() {
        this.alive = false;
        if (this.actor) {
            this.actor.remove_all_transitions();
            const parent = this.actor.get_parent();
            if (parent) parent.remove_child(this.actor);
            this.actor.destroy();
            this.actor = null;
        }
    }
}
