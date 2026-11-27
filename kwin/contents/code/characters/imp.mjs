// Port KWin de src/characters/imp.js — a IA é a mesma; mudou só a parte de GObject/Shell.
import { Gnomelet } from '../gnomelet.mjs';
import {
    State,
    WALK_SPEED,
    IMP_WALK_SPEED,
    IMP_CHASE_SPEED,
} from '../utils.mjs';

/**
 * Imp — Inimigo terrestre do Doom.
 * Corre pelo chão e janelas, persegue o Doom Slayer,
 * e lança bolas de fogo quando em range.
 */
export class Imp extends Gnomelet {
    constructor(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider, spawnProjectileCb) {
        super(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider);

        this._lockType = true;   // respawn mantém o tipo

        // --- Doom: Stats ---
        this._hp             = 3;
        this._maxHp          = 3;
        this._stunDuration   = 8;
        this._deathDuration  = 25;

        // --- Doom: IA ---
        this._detectRange       = 400;  // px — distância para notar o Slayer
        this._throwRange        = 300;  // px — distância para lançar
        this._throwCooldown     = 0;
        this._throwCooldownMax  = 70;   // ticks (~3.5s)
        this._throwDuration     = 0;
        this._throwDurationMax  = 20;   // ticks que fica no estado THROWING
        this._currentTarget     = null;

        // Callback para criar projétil no manager
        this._spawnProjectileCb = spawnProjectileCb ?? null;
    }

    /**
     * Substitui _pickNewAction() para adicionar lógica de perseguição e throw.
     */
    _pickNewAction() {
        // Procurar Slayer entre as entidades (injetadas via update())
        const slayer = this._allEntities
            ? this._allEntities.find(e => e._typeName === 'DoomSlayer')
            : null;

        if (slayer && slayer.actor) {
            const dx = slayer._x - this._x;
            const dy = slayer._y - this._y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Detectou o Slayer
            if (dist < this._detectRange) {
                this._currentTarget = slayer;

                // Em range de throw e cooldown zerado → lançar
                if (dist < this._throwRange && this._throwCooldown === 0) {
                    this._state = State.THROWING;
                    this._throwDuration = this._throwDurationMax;
                    this._throwCooldown = this._throwCooldownMax;
                    this._vx = 0;
                    return;
                }

                // Perto demais e sem munição: segura a posição um instante
                if (Math.abs(dx) < 150) {
                    this._state = State.IDLE;
                    this._vx = 0;
                    this._idleTimer = 6;
                    this._savedFacing = dx > 0;
                    return;
                }

                // Perseguir
                this._state = State.CHASING;
                this._vx = (dx > 0 ? 1 : -1) * IMP_CHASE_SPEED;
                return;
            }
        }

        // Sem alvo — comportamento padrão
        this._currentTarget = null;
        let r = Math.random();
        if (r < 0.6) {
            this._state = State.WALKING;
            let dir = (Math.random() > 0.5) ? 1 : -1;
            this._vx = dir * IMP_WALK_SPEED;
        } else {
            this._state = State.IDLE;
            this._idleTimer = Math.random() * 60 + 20;
        }
    }

    /**
     * Override de update() para capturar allEntities e gerenciar THROWING.
     */
    update(windows, forceBackground, dockContainer, allEntities = [], projectiles = []) {
        // Salva referência para uso em _pickNewAction()
        this._allEntities = allEntities;
        if (this._throwCooldown > 0) this._throwCooldown--;

        // CHASING não tem lógica no Gnomelet base: reavalia o alvo a cada tick
        if (this._state === State.CHASING) this._pickNewAction();

        // Gerenciar estado THROWING antes de delegar ao super
        if (this._state === State.THROWING) {
            this._throwDuration--;

            // No meio do throw, spawnar projétil
            if (this._throwDuration === Math.floor(this._throwDurationMax / 2)) {
                this._launchProjectile();
            }

            if (this._throwDuration <= 0) {
                // Voltar a perseguir ou andar
                this._pickNewAction();
            }

            this._updateAnimation();
            return;
        }

        super.update(windows, forceBackground, dockContainer, allEntities, projectiles);
    }

    /**
     * Lança projétil em direção ao alvo atual.
     */
    _launchProjectile() {
        if (!this._spawnProjectileCb || !this._currentTarget) return;

        const tx = this._currentTarget._x + (this._currentTarget._displayW ?? 0) / 2;
        const ty = this._currentTarget._y + (this._currentTarget._displayH ?? 0) / 2;
        const sx = this._x + this._displayW / 2;
        const sy = this._y + this._displayH / 2;

        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return;

        const speed = 8; // px/tick
        const vx = (dx / len) * speed;
        const vy = (dy / len) * speed;

        this._spawnProjectileCb(sx, sy, vx, vy, 1);
    }

    /**
     * Ao morrer, marcar para remoção (não respawna).
     */
    _onDeathComplete() {
        this._markedForRemoval = true;
    }

    /**
     * Serialização estendida com campos do Imp.
     */
    serialize() {
        // QV4 (motor JS do KWin) não aceita spread de objeto
        return Object.assign(super.serialize(), { throwCooldown: this._throwCooldown });
    }

    deserialize(data) {
        super.deserialize(data);
        if (data.throwCooldown !== undefined) this._throwCooldown = data.throwCooldown;
    }
}
