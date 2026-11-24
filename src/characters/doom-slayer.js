import GObject from 'gi://GObject';
import { Gnomelet } from '../gnomelet.js';
import {
    State,
    WALK_SPEED,
    SLAYER_CHASE_SPEED,
} from '../utils.js';

const ENEMY_TYPES = ['Imp', 'Cacodemon'];

/**
 * Doom Slayer — caça Imps e Cacodemons.
 * Persegue o inimigo mais próximo, atira com a espingarda à distância
 * e executa um glory kill em inimigos atordoados ao alcance do braço.
 */
export const DoomSlayer = GObject.registerClass(
    class DoomSlayer extends Gnomelet {
        _init(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider, spawnProjectileCb) {
            super._init(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider);

            // --- Doom: Stats ---
            this._hp            = 12;
            this._maxHp         = 12;
            this._stunDuration  = 6;
            this._deathDuration = 30;

            // --- Doom: IA ---
            this._detectRange       = 700;  // px — distância para notar um inimigo
            this._shootRange        = 450;  // px — distância para atirar
            this._gloryRange        = 80;   // px — distância para glory kill
            this._shootCooldown     = 0;
            this._shootCooldownMax  = 30;   // ticks (~1.5s)
            this._shootDuration     = 0;
            this._shootDurationMax  = 12;
            this._gloryDuration     = 0;
            this._gloryDurationMax  = 24;
            this._currentTarget     = null;

            this._spawnProjectileCb = spawnProjectileCb ?? null;
        }

        /** Inimigo vivo mais próximo (centro a centro), ou null. */
        _findTarget() {
            const entities = this._allEntities ?? [];
            const cx = this._x + this._displayW / 2, cy = this._y + this._displayH / 2;
            let best = null, bestDist = Infinity;
            for (const e of entities) {
                if (!ENEMY_TYPES.includes(e._typeName) || !e.actor || e._isDead || e._hp <= 0) continue;
                const d = Math.hypot(e._x + e._displayW / 2 - cx, e._y + e._displayH / 2 - cy);
                if (d < bestDist) { best = e; bestDist = d; }
            }
            return best && bestDist < this._detectRange ? { enemy: best, dist: bestDist } : null;
        }

        _faceTarget(enemy) {
            this._savedFacing = (enemy._x + enemy._displayW / 2) > (this._x + this._displayW / 2);
        }

        _pickNewAction() {
            const found = this._findTarget();
            if (found) {
                this._currentTarget = found.enemy;
                const dx = (found.enemy._x + found.enemy._displayW / 2) - (this._x + this._displayW / 2);
                this._state = State.CHASING;
                this._vx = (dx > 0 ? 1 : -1) * SLAYER_CHASE_SPEED;
                return;
            }

            this._currentTarget = null;
            if (Math.random() < 0.6) {
                this._state = State.WALKING;
                this._vx = (Math.random() > 0.5 ? 1 : -1) * WALK_SPEED;
            } else {
                this._state = State.IDLE;
                this._idleTimer = Math.random() * 60 + 20;
            }
        }

        update(windows, forceBackground, dockContainer, allEntities = [], projectiles = []) {
            this._allEntities = allEntities;
            if (this._shootCooldown > 0) this._shootCooldown--;

            // Glory kill em andamento: parado, sem física
            if (this._state === State.GLORY_KILL) {
                if (--this._gloryDuration <= 0) this._pickNewAction();
                this._updateAnimation();
                this.actor?.set_position(Math.floor(this._x), Math.floor(this._y));
                return;
            }

            // Tiro em andamento
            if (this._state === State.SHOOTING) {
                if (--this._shootDuration <= 0) this._pickNewAction();
                this._updateAnimation();
                this.actor?.set_position(Math.floor(this._x), Math.floor(this._y));
                return;
            }

            // Só decide atacar quando está no chão agindo normalmente
            if (this._state === State.WALKING || this._state === State.CHASING || this._state === State.IDLE) {
                const found = this._findTarget();
                if (found) {
                    const e = found.enemy;
                    if (e._state === State.STUNNED && e._hp > 0 && found.dist < this._gloryRange) {
                        this._faceTarget(e);
                        this._state = State.GLORY_KILL;
                        this._gloryDuration = this._gloryDurationMax;
                        this._vx = 0;
                        e.takeDamage(e._hp);            // execução
                        this._updateAnimation();
                        return;
                    }
                    if (found.dist < this._shootRange && this._shootCooldown === 0) {
                        this._currentTarget = e;
                        this._faceTarget(e);
                        this._state = State.SHOOTING;
                        this._shootDuration = this._shootDurationMax;
                        this._shootCooldown = this._shootCooldownMax;
                        this._vx = 0;
                        this._fireShotgun(e);
                        this._updateAnimation();
                        return;
                    }
                }
            }

            super.update(windows, forceBackground, dockContainer, allEntities, projectiles);
        }

        /** Três balins em leque na direção do inimigo. */
        _fireShotgun(enemy) {
            if (!this._spawnProjectileCb) return;
            const sx = this._x + this._displayW / 2 + (this._savedFacing ? 1 : -1) * this._displayW * 0.3;
            const sy = this._y + this._displayH * 0.4;
            const tx = enemy._x + enemy._displayW / 2;
            const ty = enemy._y + enemy._displayH / 2;
            const base = Math.atan2(ty - sy, tx - sx);
            const speed = 14;
            for (const spread of [-0.12, 0, 0.12]) {
                const a = base + spread;
                this._spawnProjectileCb(sx, sy, Math.cos(a) * speed, Math.sin(a) * speed, 1);
            }
        }
    }
);
