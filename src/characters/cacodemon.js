import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Gnomelet } from '../gnomelet.js';
import {
    State,
    FLOAT_AMPLITUDE,
    FLOAT_FREQUENCY,
    CACO_FOLLOW_RANGE,
    CACO_FOLLOW_STOP,
    CACO_FOLLOW_SPEED,
    CACO_FOLLOW_ACCEL,
} from '../utils.js';
import { steerToward } from '../behavior.js';

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
                // A bola de fogo sai no meio da animação, quando a boca está aberta
                if (this._shootDuration === Math.floor(this._shootDurationMax / 2)) this._fire(allEntities);
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

            // Movimento horizontal: deriva com bounce nas bordas, ou acompanha o cursor (tímido:
            // mantém CACO_FOLLOW_STOP de distância) com viragem suave
            this._velX ??= this._floatSpeedX;
            let wantVx = this._floatSpeedX;
            const ptr = this._pointer;
            if (ptr && ptr.dist < CACO_FOLLOW_RANGE && this._state === State.FLOATING) {
                const dx = ptr.x - (this._x + this._displayW / 2);
                wantVx = Math.abs(dx) < CACO_FOLLOW_STOP ? 0 : Math.sign(dx) * CACO_FOLLOW_SPEED;
            }
            this._velX = steerToward(this._velX, wantVx, CACO_FOLLOW_ACCEL);
            this._x += this._velX;
            const maxX = global.stage.width - this._displayW;
            if (this._x < 0)    { this._x = 0;    this._floatSpeedX = Math.abs(this._floatSpeedX);  this._velX = Math.abs(this._velX); }
            if (this._x > maxX) { this._x = maxX; this._floatSpeedX = -Math.abs(this._floatSpeedX); this._velX = -Math.abs(this._velX); }

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
                }
            }

            // Z-order: sempre em uiGroup (flutua acima de tudo)
            const parent = this.actor.get_parent();
            if (parent !== Main.layoutManager.uiGroup) {
                if (parent) parent.remove_child(this.actor);
                Main.layoutManager.addChrome(this.actor);
            }

            this._updateAnimation();
            this._placeActor();
        }

        _fire(allEntities) {
            const slayer = allEntities.find(e => e._typeName === 'DoomSlayer');
            if (!slayer || !slayer.actor) return;
            if (!this._spawnProjectileCb) {
                slayer.takeDamage(2);
                return;
            }
            const sx = this._x + this._displayW / 2, sy = this._y + this._displayH * 0.65;
            const tx = slayer._x + slayer._displayW / 2, ty = slayer._y + slayer._displayH / 2;
            const len = Math.hypot(tx - sx, ty - sy) || 1;
            this._spawnProjectileCb(sx, sy, (tx - sx) / len * 7, (ty - sy) / len * 7, 2);
        }

        /** Saída de portal: surge flutuando na altura habitual, acima da janela nova. */
        arriveAt(rect) {
            const monitor = Main.layoutManager.primaryMonitor;
            this._x = rect.x + rect.width / 2 - this._displayW / 2;
            this._y = monitor.y + monitor.height * 0.25;
            this._floatSpeedX = (Math.random() > 0.5 ? 1 : -1) * 1.5;
            this._velX = this._floatSpeedX;
            this._state = State.SPAWNING;
            this._spawnTimer = 8;
            this._fadeIn();
            this._placeActor(true);
            return { x: this._x + this._displayW / 2, y: this._y + this._displayH / 2 };
        }

        /** Entra flutuando por uma das bordas (a altura é definida pelo update). */
        enterFromEdge(fromLeft) {
            this._x = fromLeft ? 0 : global.stage.width - this._displayW;
            this._floatSpeedX = (fromLeft ? 1 : -1) * 1.5;
            this._state = State.FLOATING;
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
