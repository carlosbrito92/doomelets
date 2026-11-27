import Clutter from 'gi://Clutter';
import { needsSnap } from './behavior.js';
import { UPDATE_INTERVAL_MS, SMOOTH_SNAP_PX } from './utils.js';

/**
 * Move o ator para (x, y) deslizando durante um tick da lógica (50 ms, 20 Hz), de modo que
 * o movimento na tela fique contínuo mesmo com a lógica rodando a 20 Hz.
 * `snap` (ou um salto maior que SMOOTH_SNAP_PX: respawn, arremesso, troca de monitor)
 * posiciona direto, sem deslizar.
 */
export function placeActor(actor, x, y, snap = false) {
    if (!actor) return;
    const last = actor._motionTarget;
    actor._motionTarget = { x, y };

    if (snap || !last || needsSnap(x - last.x, y - last.y, SMOOTH_SNAP_PX)) {
        actor.remove_all_transitions();
        actor.set_position(x, y);
        return;
    }

    actor.save_easing_state();
    actor.set_easing_duration(UPDATE_INTERVAL_MS);
    actor.set_easing_mode(Clutter.AnimationMode.LINEAR);
    actor.set_position(x, y);
    actor.restore_easing_state();
}

/** Esquece o alvo anterior: a próxima chamada a placeActor posiciona direto. */
export function resetMotion(actor) {
    if (!actor) return;
    actor._motionTarget = null;
    actor.remove_all_transitions();
}
