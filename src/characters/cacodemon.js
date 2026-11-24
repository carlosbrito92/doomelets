import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Gnomelet } from '../gnomelet.js';
import {
    State,
    FLOAT_AMPLITUDE,
    FLOAT_FREQUENCY,
} from '../utils.js';

/**
 * Cacodemon — Inimigo flutuante do Doom.
 * Ignora gravidade, oscila senoidalmente no terço superior da tela,
 * e deriva horizontalmente com bounce nas bordas.
 */
export const Cacodemon = GObject.registerClass(
    class Cacodemon extends Gnomelet {
        _init(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider, spawnProjectileCb) {
            super._init(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider);
            this._spawnProjectileCb = spawnProjectileCb ?? null;

            this._lockType = true;   // respawn mantém o tipo

            // --- Doom: Stats ---
            this._hp            = 5;
            this._maxHp         = 5;
            this._stunDuration  = 6;
            this._deathDuration = 30;

            // --- Doom: Física de flutuação ---
            this._floatTimer    = Math.random() * 100; // fase aleatória para não sincronizar
            this._floatSpeedX   = (Math.random() > 0.5 ? 1 : -1) * 1.5; // px/tick

            // --- Doom: IA ---
            this._detectRange      = 350;
            this._shootCooldown    = 0;
            this._shootCooldownMax = 100; // ticks (~5s)
            this._shootDuration    = 0;
            this._shootDurationMax = 12;  // ticks que fica no estado SHOOTING
        }

        /**
         * Cacodemon é radialmente simétrico — sem flip horizontal.
         */
        get facingRight() {
            return true;
        }

        /**
         * Override total de update() — substitui física por movimento senoidal.
         */
        update(windows, forceBackground, dockContainer, allEntities = [], projectiles = []) {
            if (!this.actor) return;

            // Guards herdados de estado de combate
            if (this._isDead) {
                this._deathTimer--;
                if (this._deathTimer <= 0) this._onDeathComplete();
                this._updateAnimation();
                return;
            }

            if (this._state === State.STUNNED) {
                this._stunTimer--;
                if (this._stunTimer <= 0) {
                    if (this._hp <= 0) {
                        this._state = State.DYING;
                        this._deathTimer = this._deathDuration;
                        this._isDead = true;
                    } else {
                        this._state = State.FLOATING;
                    }
                }
                this._updateAnimation();
                return;
            }

            if (this._state === State.SPAWNING) {
                this._spawnTimer--;
                if (this._spawnTimer <= 0) this._state = State.FLOATING;
                this._updateAnimation();
                return;
            }

            // Gerenciar SHOOTING
            if (this._state === State.SHOOTING) {
                this._shootDuration--;
                if (this._shootDuration <= 0) this._state = State.FLOATING;
                this._updateAnimation();
                return;
            }

            // Estado padrão é FLOATING
            if (this._state !== State.FLOATING && this._state !== State.IDLE) {
                this._state = State.FLOATING;
            }

            this._floatTimer++;
            if (this._shootCooldown > 0) this._shootCooldown--;

            // Movimento horizontal com bounce nas bordas
            this._x += this._floatSpeedX;
            const maxX = global.stage.width - this._displayW;
            if (this._x < 0)    { this._x = 0;    this._floatSpeedX *= -1; }
            if (this._x > maxX) { this._x = maxX; this._floatSpeedX *= -1; }

            // Movimento vertical senoidal — ancorado no terço superior do monitor
            const monitor = Main.layoutManager.primaryMonitor;
            const anchorY  = monitor.y + monitor.height * 0.25;
            this._y = anchorY + Math.sin(this._floatTimer * FLOAT_FREQUENCY) * FLOAT_AMPLITUDE;

            // IA: detectar Slayer e disparar
            const slayer = allEntities.find(e => e._typeName === 'DoomSlayer');
            if (slayer && slayer.actor) {
                const dx = slayer._x - this._x;
                const dy = slayer._y - this._y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < this._detectRange && this._shootCooldown === 0) {
                    this._state = State.SHOOTING;
                    this._shootDuration = this._shootDurationMax;
                    this._shootCooldown = this._shootCooldownMax;
                    if (this._spawnProjectileCb) {
                        const sx = this._x + this._displayW / 2, sy = this._y + this._displayH * 0.65;
                        const tx = slayer._x + slayer._displayW / 2, ty = slayer._y + slayer._displayH / 2;
                        const len = Math.hypot(tx - sx, ty - sy) || 1;
                        this._spawnProjectileCb(sx, sy, (tx - sx) / len * 7, (ty - sy) / len * 7, 2);
                    } else {
                        slayer.takeDamage(2);
                    }
                }
            }

            // Z-order: sempre em uiGroup (flutua acima de tudo)
            const parent = this.actor.get_parent();
            if (parent !== Main.layoutManager.uiGroup) {
                if (parent) parent.remove_child(this.actor);
                Main.layoutManager.addChrome(this.actor);
            }

            this._updateAnimation();
            this.actor.set_position(Math.floor(this._x), Math.floor(this._y));
        }

        /**
         * Ao morrer, marcar para remoção (não respawna).
         */
        _onDeathComplete() {
            this._markedForRemoval = true;
        }

        /**
         * Serialização estendida com floatTimer.
         */
        serialize() {
            return {
                ...super.serialize(),
                floatTimer: this._floatTimer,
            };
        }

        deserialize(data) {
            super.deserialize(data);
            if (data.floatTimer !== undefined) this._floatTimer = data.floatTimer;
        }
    }
);
