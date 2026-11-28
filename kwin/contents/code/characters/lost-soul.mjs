// Port KWin de src/characters/lost-soul.js
import { Cacodemon } from './cacodemon.mjs';

/**
 * Lost Soul — caveira flamejante inofensiva (companheiro).
 * Flutua como o Cacodemon (sem gravidade, deriva com bounce nas bordas, acompanha o cursor),
 * mas não tem vida, não ataca e voa numa altura própria. A arte olha para a direita, então
 * ela espelha conforme a direção em que se move.
 */
export class LostSoul extends Cacodemon {
    constructor(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider, spawnProjectileCb) {
        super(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider, spawnProjectileCb);
        this._hp = 0;                 // 0 = invulnerável e ignorado na luta
        this._maxHp = 0;
        this._aggressive = false;
        this._anchorFrac = 0.3 + Math.random() * 0.25;   // cada uma flutua numa altura diferente
    }

    get facingRight() {
        const vx = this._velX === undefined ? this._floatSpeedX : this._velX;
        return vx >= 0;
    }
}
