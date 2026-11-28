import GObject from 'gi://GObject';
import { Cacodemon } from './cacodemon.js';

/**
 * Lost Soul — caveira flamejante inofensiva (companheiro).
 * Flutua como o Cacodemon (sem gravidade, deriva com bounce nas bordas, acompanha o cursor),
 * mas não tem vida, não ataca e voa numa altura própria. A arte olha para a direita, então
 * ela espelha conforme a direção em que se move.
 */
export const LostSoul = GObject.registerClass(
    class LostSoul extends Cacodemon {
        _init(...args) {
            super._init(...args);
            this._hp = 0;                 // 0 = invulnerável e ignorado na luta
            this._maxHp = 0;
            this._aggressive = false;
            this._anchorFrac = 0.3 + Math.random() * 0.25;   // cada uma flutua numa altura diferente
        }

        get facingRight() {
            return (this._velX ?? this._floatSpeedX) >= 0;
        }
    }
);
