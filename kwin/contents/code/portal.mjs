// Anel de fogo que abre e some no ponto onde um demônio entra (ou sai) de cena.
// Só o estado: o main.qml desenha o item (portalComponent) em `x`, `y` e anima sozinho.

export const PORTAL_LIFE_TICKS = 16;   // ~0,8 s

export class Portal {
    constructor(cx, cy) {
        this.x = cx;
        this.y = cy;
        this.alive = true;
        this.actor = null;     // item QML, atribuído pelo manager
        this._ticks = 0;
    }

    update() {
        if (++this._ticks >= PORTAL_LIFE_TICKS) this.alive = false;
    }

    destroy() {
        this.alive = false;
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
    }
}
