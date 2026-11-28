// Port KWin de src/gnomelet.js. A lógica (física, IA, animação) é a mesma; o que mudou:
//  * classe JS comum em vez de GObject;
//  * nada de St/Clutter: o main.qml lê _x, _y, _frame e facingRight a cada tick e desenha;
//  * o "layer" do GNOME (window_group/uiGroup/background) virou _surface: a janela onde
//    o personagem está pisando, usada pelo main.qml para escondê-lo atrás de janelas por cima;
//  * arrastar é feito por beginDrag/dragTo/endDrag, chamados pelo main.qml.

import {
    State,
    GRAVITY,
    WALK_SPEED,
    UPDATE_INTERVAL_MS,
    CURIOSITY_RANGE,
    CURIOSITY_NOTICE_TICKS,
    CURIOSITY_STARE_TICKS,
    IDLE_VARIANT_MIN_TICKS,
    NOTICE_PAUSE_TICKS,
    platform,
} from './utils.mjs';
// behavior.mjs é gerado por scripts/kwin.sh a partir de src/behavior.js (fonte única, sem GNOME)
import { IdleScheduler, Curiosity, facingToward } from './behavior.mjs';

export class Gnomelet {
    constructor(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider) {
        this._typeName = typeName;
        this._settings = settings;
        this._resourceProvider = resourceProvider;

        // --- State Initialization ---
        this._state = State.FALLING;
        this._vx = 0;
        this._vy = 0;

        // --- Animation State ---
        this._frame = 0;
        this._animationTimer = 0;
        this._savedFacing = Math.random() > 0.5;
        this._idleTimer = 0;

        // --- Idle com variações e curiosidade com o ponteiro (ver behavior.js) ---
        this._idleVariants = [];        // subclasses: [{ name, weight, cooldown }]; name null = só respirar
        this._idleSched = null;
        this._idleSchedFor = null;
        this._wasIdle = false;
        this._idleVariant = null;
        this._idleVariantTicks = 0;
        this._stareReaction = null;     // animação tocada ao ser encarado pelo cursor ('look', 'taunt'...)
        this._pointer = null;           // { x, y, dist, level, still }
        this._curiosity = new Curiosity({
            range: CURIOSITY_RANGE,
            noticeTicks: CURIOSITY_NOTICE_TICKS,
            stareTicks: CURIOSITY_STARE_TICKS,
        });

        this._frameWidth = frameWidth;
        this._frameHeight = frameHeight;
        this._frameImages = frameImages;

        this._updateDimensions();
        this._randomizeStartPos();

        // Visão (item QML) atribuída pelo main.qml; null depois de destroy()
        this.actor = null;
        this._surface = null;   // janela onde está pisando (null = chão, painel ou no ar)

        // --- Doom: Combat State ---
        this._hp              = 0;   // 0 = invulnerável (personagens originais)
        this._maxHp           = 0;
        this._isDead          = false;
        this._stunTimer       = 0;
        this._stunDuration    = 8;
        this._deathTimer      = 0;
        this._deathDuration   = 25;
        this._spawnTimer      = 0;
        this._markedForRemoval = false;

        this.updateJumpPower();
        this._updateAnimation();
    }

    get facingRight() {
        let sign = Math.sign(this._vx);
        if (sign !== 0 && !isNaN(sign)) {
            this._savedFacing = (sign > 0);
        }
        return this._savedFacing;
    }

    /** URL do quadro atual (ou null se o quadro não existe). */
    get frameUrl() {
        return this._frameImages?.[this._frame] ?? null;
    }

    _updateDimensions() {
        // No KWin as coordenadas já são lógicas: a escala da interface não entra na conta
        this._displayH = Math.max(1, this._settings.get_int('gnomelet-scale'));
        this._displayW = Math.floor(this._displayH * (this._frameWidth / this._frameHeight));
    }

    updateScale() {
        let oldH = this._displayH;
        this._updateDimensions();
        this._y = this._y + oldH - this._displayH;
    }

    updateJumpPower() {
        let power = this._settings.get_int('jump-power');
        this._jumpVelocity = -Math.abs(power);
        this._jumpReachX = (WALK_SPEED * 2) * Math.abs(this._jumpVelocity / GRAVITY);
        this._maxJumpHeight = (this._jumpVelocity * this._jumpVelocity) / (2 * GRAVITY);
    }

    takeDamage(amount) {
        if (this._maxHp === 0 || this._isDead) return;
        this._hp -= amount;
        if (this._hp <= 0) this._hp = 0;
        this._state = State.STUNNED;
        this._stunTimer = this._stunDuration;
    }

    _onDeathComplete() {
        this._isDead = false;
        this._hp = this._maxHp;
        this._respawn();
    }

    // --- Arrastar (chamado pelo main.qml) ---

    beginDrag() {
        this._state = State.DRAGGING;
        this._vx = 0;
        this._vy = 0;
        this._surface = null;
        this._dragHistory = [];
        this._dropTime = 0;
        this._updateAnimation();
    }

    dragTo(x, y) {
        this._x = x;
        this._y = y;
        const now = Date.now();
        this._dragHistory.push({ x, y, time: now });
        const HISTORY_LIMIT_MS = 200;
        while (this._dragHistory.length > 0 && now - this._dragHistory[0].time > HISTORY_LIMIT_MS) {
            this._dragHistory.shift();
        }
    }

    endDrag() {
        if (this._state !== State.DRAGGING) return;
        this._dropTime = Date.now();
        this._state = State.FALLING;
        const momentum = this._calculateMomentum();
        this._vx = momentum.vx;
        this._vy = momentum.vy;
    }

    _calculateMomentum() {
        if (!this._dragHistory || this._dragHistory.length < 2) {
            return { vx: 0, vy: 0 };
        }

        const last = this._dragHistory[this._dragHistory.length - 1];

        if (this._dropTime && (this._dropTime - last.time > 100)) {
            return { vx: 0, vy: 0 };
        }

        let prev = this._dragHistory[0];
        for (let i = this._dragHistory.length - 2; i >= 0; i--) {
            const sample = this._dragHistory[i];
            const dt = last.time - sample.time;
            if (dt >= 50 && dt <= 150) {
                prev = sample;
                break;
            }
        }

        const dt = last.time - prev.time;
        if (dt <= 0) return { vx: 0, vy: 0 };

        const SCALE_FACTOR = 0.25;
        const MAX_VELOCITY = 50;
        let vx = (last.x - prev.x) / dt * UPDATE_INTERVAL_MS * SCALE_FACTOR;
        let vy = (last.y - prev.y) / dt * UPDATE_INTERVAL_MS * SCALE_FACTOR;
        vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vx));
        vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vy));
        return { vx, vy };
    }

    serialize() {
        return {
            type: this._typeName,
            x: this._x,
            y: this._y,
            vx: this._vx,
            vy: this._vy,
            state: this._state,
            facing: this._savedFacing,
            idleTimer: this._idleTimer,
            hp: this._hp,
        };
    }

    deserialize(data) {
        if (!data) return;

        if (data.type && data.type !== this._typeName && this._resourceProvider) {
            let res = this._resourceProvider(data.type);
            if (res) {
                this._typeName = res.type;
                this._frameImages = res.frames;
                this._frameWidth = res.w;
                this._frameHeight = res.h;
                this.updateScale();
            }
        }

        if (data.x !== undefined) this._x = data.x;
        if (data.y !== undefined) this._y = data.y;
        if (data.vx !== undefined) this._vx = data.vx;
        if (data.vy !== undefined) this._vy = data.vy;
        if (data.state !== undefined) this._state = data.state;
        if (data.facing !== undefined) this._savedFacing = data.facing;
        if (data.idleTimer !== undefined) this._idleTimer = data.idleTimer;
        if (data.hp !== undefined) this._hp = data.hp;
        if (this._state === State.DRAGGING) this._state = State.FALLING;
    }

    /**
     * Main update loop. `windows` = [{ rect, ref, isDock }]; `dockContainer` não é usado
     * no KWin (fica na assinatura para as subclasses repassarem igual ao GNOME).
     */
    update(windows, forceBackground, dockContainer, allEntities = [], projectiles = []) {
        if (!this.actor) return;

        if (this._state === State.DRAGGING) {
            this._updateAnimation();
            return;
        }

        // --- Doom: Guards de estado de combate ---
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
                    this._pickNewAction();
                }
            }
            this._updateAnimation();
            return;
        }

        if (this._state === State.SPAWNING) {
            this._spawnTimer--;
            if (this._spawnTimer <= 0) this._pickNewAction();
            this._updateAnimation();
            return;
        }

        if (this._state === State.FALLING || this._state === State.JUMPING) {
            this._vy += GRAVITY;
        }

        if (this._state === State.IDLE) {
            this._vx = 0;
        }

        let prevY = this._y;
        this._x += this._vx;
        this._y += this._vy;

        let feetX = this._x + this._displayW / 2;
        let feetY = this._y + this._displayH;

        let monitors = platform.monitors().filter(m => feetX >= m.x && feetX < m.x + m.width);

        let currentMonitor = null;
        if (monitors.length === 0) {
            currentMonitor = platform.primaryMonitor();
        } else if (monitors.length === 1) {
            currentMonitor = monitors[0];
        } else {
            monitors.sort((a, b) => a.y - b.y);
            currentMonitor = monitors.find(m => feetY < m.y + m.height);
            if (!currentMonitor) currentMonitor = monitors[monitors.length - 1];
        }

        let floorY = currentMonitor.y + currentMonitor.height;

        if (this._y < currentMonitor.y) {
            this._y = currentMonitor.y;
            this._vy = 0;
        }

        let onFloorLevel = (this._y + this._displayH) >= floorY - 10;
        const stageW = platform.stageWidth();

        if (onFloorLevel) {
            if (this._x < -this._displayW || this._x > stageW) {
                this._respawn();
                return;
            }
        } else {
            let maxX = stageW - this._displayW;
            if (this._x < 0) {
                this._x = 0;
                this._vx *= -1;
            } else if (this._x > maxX) {
                this._x = maxX;
                this._vx *= -1;
            }
        }

        // --- Collision Detection ---
        let onGround = false;
        let landedOnWindow = null;

        if (this._vy >= 0) {
            for (let win of windows) {
                let rect = win.rect;
                let prevFeetY = prevY + this._displayH;
                let inHorizontalRange = (feetX >= rect.x) && (feetX <= rect.x + rect.width);
                let inVerticalRange = (feetY >= rect.y) && (prevFeetY <= rect.y + 25);

                if (inHorizontalRange && inVerticalRange) {
                    this._y = rect.y - this._displayH;
                    this._vy = 0;
                    onGround = true;
                    landedOnWindow = win;
                    break;
                }
            }

            if (!landedOnWindow) {
                if (feetY >= floorY) {
                    this._y = floorY - this._displayH;
                    this._vy = 0;
                    onGround = true;
                }
            }
        }

        // --- Camada: no GNOME o ator entrava no window_group logo acima da janela ---
        this._surface = (landedOnWindow && !landedOnWindow.isDock) ? landedOnWindow.ref : null;

        // --- State Machine Transitions ---
        if (onGround) {
            if (this._state === State.FALLING || this._state === State.JUMPING) {
                this._vy = 0;
                this._pickNewAction();
            }
        } else {
            if (this._state !== State.JUMPING) {
                let jumped = false;
                if (this._state === State.WALKING) {
                    if (Math.random() < 0.5) {
                        this._performJump();
                        jumped = true;
                    }
                }
                if (!jumped) {
                    this._state = State.FALLING;
                }
            }
        }

        // --- AI Behavior ---
        if (this._state === State.WALKING) {
            this._idleTimer = 0;
            if (Math.random() < 0.02) {
                this._state = State.IDLE;
                this._vx = 0;
                this._idleTimer = Math.random() * 60 + 20;
            }

            let canJump = false;
            let currFeetY = this._y + this._displayH;
            let currFeetX = this._x + this._displayW / 2;

            for (let win of windows) {
                if (landedOnWindow && win === landedOnWindow) continue;

                let rect = win.rect;
                let effectiveMinX = rect.x;
                let effectiveMaxX = rect.x + rect.width;

                if (currFeetX < rect.x && this.facingRight) {
                    effectiveMinX -= this._jumpReachX;
                } else if (currFeetX > rect.x + rect.width && !this.facingRight) {
                    effectiveMaxX += this._jumpReachX;
                }

                if (currFeetX >= effectiveMinX && currFeetX <= effectiveMaxX) {
                    let dist = currFeetY - rect.y;
                    if (dist > 0 && dist <= this._maxJumpHeight) {
                        if (rect.y - this._displayH >= currentMonitor.y) {
                            canJump = true;
                            break;
                        }
                    }
                }
            }

            if (canJump && Math.random() < 0.25) {
                this._performJump();
            }
        } else if (this._state === State.IDLE) {
            this._vx = 0;
            this._idleTimer--;
            if (this._idleTimer <= 0) {
                this._pickNewAction();
            }
        }

        this._updateAnimation();
    }

    _randomizeStartPos() {
        let monitors = platform.monitors();
        if (!monitors || monitors.length === 0) {
            this._x = Math.floor(Math.random() * (platform.stageWidth() - this._displayW));
            this._y = 0;
        } else {
            let m = monitors[Math.floor(Math.random() * monitors.length)];
            this._x = Math.floor(m.x + Math.random() * (m.width - this._displayW));
            this._y = m.y;
        }
        this._y += this._settings.get_int('spawn-offset');
    }

    _respawn() {
        if (this._resourceProvider) {
            // Personagens Doom têm classe própria: respawn nunca troca o tipo
            let res = this._resourceProvider(this._lockType ? this._typeName : null, !this._lockType);
            if (res) {
                this._typeName = res.type;
                this._frameImages = res.frames;
                this._frameWidth = res.w;
                this._frameHeight = res.h;
                this.updateScale();
            }
        }

        this._randomizeStartPos();
        this._vx = 0;
        this._vy = 0;
        this._state = State.FALLING;
        this._surface = null;
    }

    _pickNewAction() {
        if (Math.random() < 0.6) {
            this._state = State.WALKING;
            let dir = (Math.random() > 0.5) ? 1 : -1;
            this._vx = dir * WALK_SPEED;
        } else {
            this._state = State.IDLE;
            this._idleTimer = Math.random() * 60 + 20;
        }
    }

    _performJump() {
        this._state = State.JUMPING;
        this._vy = this._jumpVelocity;
        let dir = this.facingRight ? 1 : -1;
        this._vx = dir * WALK_SPEED * 2;
    }

    /** Nome da animação do manifesto: a do estado, ou uma variação de idle sorteada. */
    _animationName() {
        return this._withIdleVariant(this._stateAnimationName());
    }

    _scheduler() {
        if (!this._idleSched || this._idleSchedFor !== this._idleVariants) {
            this._idleSched = new IdleScheduler(this._idleVariants);
            this._idleSchedFor = this._idleVariants;
        }
        return this._idleSched;
    }

    /** Toca uma variação de idle agora, se o personagem tem esse quadro e está parado. */
    _playIdleVariant(name) {
        const anim = this._frameImages?.animations?.[name];
        if (!anim || this._state !== State.IDLE || this._idleVariant) return false;
        this._idleVariant = name;
        this._idleVariantTicks = Math.ceil(anim.frames.length * anim.ticks);
        this._idleTimer = Math.max(this._idleTimer, this._idleVariantTicks + 20);
        this._wasIdle = true;
        return true;
    }

    /**
     * Ao ficar parado, às vezes toca uma variação (recarregar, olhar, bocejar...).
     * As variações valem só se o manifesto do personagem tiver a animação.
     */
    _withIdleVariant(name) {
        if (this._state !== State.IDLE) {
            this._wasIdle = false;
            this._idleVariant = null;
            return name;
        }
        if (!this._wasIdle) {
            this._wasIdle = true;
            this._idleVariant = null;
            // Pausas curtas são de combate (esperando o cooldown): ficam só respirando
            if (this._idleTimer >= IDLE_VARIANT_MIN_TICKS && this._idleVariants.length) {
                const choice = this._scheduler().pick(n => !!this._frameImages?.animations?.[n]);
                if (choice) this._playIdleVariant(choice);
            }
        }
        if (this._idleVariant && this._idleVariantTicks-- > 0) return this._idleVariant;
        this._idleVariant = null;
        return name;
    }

    /** Chamado pelo Manager a cada tick com a posição do ponteiro e há quantos ticks ele está parado. */
    observePointer(px, py, still = 0) {
        if (!this.actor) return;
        this._idleSched?.tick();
        const cx = this._x + this._displayW / 2, cy = this._y + this._displayH / 2;
        const dist = Math.hypot(px - cx, py - cy);
        const before = this._curiosity.level;
        const level = this._curiosity.update(dist);
        this._pointer = { x: px, y: py, dist, level, still };
        if (this._state === State.IDLE && level >= 1) {
            this._savedFacing = facingToward(cx, px, this._savedFacing);
        }
        if (level === 2 && before < 2 && this._stareReaction) {
            this._playIdleVariant(this._stareReaction);
        }
    }

    /**
     * Algo aconteceu em (px, py) — uma janela abriu, fechou ou minimizou: para e olha para lá.
     * Só reage quem está andando ou parado; em combate/flutuando ignora.
     */
    notice(px, py) {
        if (!this.actor || this._isDead) return false;
        if (this._state !== State.WALKING && this._state !== State.IDLE) return false;
        const cx = this._x + this._displayW / 2;
        this._savedFacing = facingToward(cx, px, this._savedFacing);
        this._state = State.IDLE;
        this._vx = 0;
        this._idleTimer = Math.max(this._idleTimer, NOTICE_PAUSE_TICKS);
        this._wasIdle = false;
        this._idleVariant = null;
        this._playIdleVariant(this._stareReaction);
        return true;
    }

    /**
     * Entra em cena pousando no topo de uma janela (saída de portal).
     * Devolve o centro do personagem, onde o portal deve abrir.
     */
    arriveAt(rect) {
        this._x = rect.x + Math.random() * Math.max(1, rect.width - this._displayW);
        this._y = rect.y - this._displayH;
        this._vx = 0;
        this._vy = 0;
        this._state = State.SPAWNING;
        this._spawnTimer = 8;
        return { x: this._x + this._displayW / 2, y: this._y + this._displayH / 2 };
    }

    _stateAnimationName() {
        switch (this._state) {
            case State.CHASING:    return 'run';
            case State.FLOATING:   return 'float';
            case State.IDLE:       return 'idle';
            case State.JUMPING:    return 'jump';
            case State.FALLING:    return 'fall';
            case State.THROWING:
            case State.SHOOTING:   return 'attack';
            case State.STUNNED:    return 'hurt';
            case State.DYING:      return 'death';
            case State.GLORY_KILL: return 'glory';
            case State.PETTING:    return 'pet';
            case State.DRAGGING:   return 'held';
            default:               return 'walk';
        }
    }

    enterFromEdge(fromLeft) {
        const monitor = platform.primaryMonitor();
        this._x = fromLeft
            ? monitor.x - this._displayW * 0.7
            : monitor.x + monitor.width - this._displayW * 0.3;
        this._y = monitor.y + monitor.height - this._displayH;
        this._vx = (fromLeft ? 1 : -1) * WALK_SPEED;
        this._vy = 0;
        this._savedFacing = fromLeft;
        this._state = State.WALKING;
    }

    _updateAnimation() {
        this._animationTimer++;

        const name = this._animationName();
        if (name !== this._animName) {
            this._animName = name;
            this._animClock = 0;
        } else {
            this._animClock++;
        }

        const anim = this._frameImages?.animations?.[name];
        if (anim) {
            let i = Math.floor(this._animClock / anim.ticks);
            i = anim.loop ? i % anim.frames.length : Math.min(i, anim.frames.length - 1);
            this.setFrame(anim.frames[i]);
            return;
        }

        let frameIndex = 0;
        const t = this._animationTimer;
        switch (this._state) {
            case State.WALKING:  frameIndex = [0, 1, 2, 3][Math.floor(t / 4) % 4]; break;
            case State.CHASING:  frameIndex = [0, 1, 2, 3][Math.floor(t / 3) % 4]; break;
            case State.FLOATING: frameIndex = [0, 1, 2, 3][Math.floor(t / 6) % 4]; break;
            case State.IDLE:     frameIndex = 4; break;
            case State.JUMPING:
            case State.FALLING:  frameIndex = 5; break;
            case State.THROWING:
            case State.SHOOTING: frameIndex = [6, 7][Math.floor(t / 6) % 2]; break;
            case State.STUNNED:  frameIndex = this._frameImages[9] ? 9 : 6; break;
            case State.DYING:    frameIndex = this._frameImages[8] ? 8 : 7; break;
            case State.GLORY_KILL: frameIndex = [6, 7][Math.floor(t / 8) % 2]; break;
            case State.PETTING:  frameIndex = 4; break;
            case State.SPAWNING: frameIndex = 0; break;
            case State.DRAGGING: {
                const dragFrames = (this._frameImages[6] && this._frameImages[7]) ? [6, 7] : [1, 3];
                frameIndex = dragFrames[Math.floor(t / 8) % dragFrames.length];
                break;
            }
        }
        this.setFrame(frameIndex);
    }

    setFrame(frameIndex) {
        this._frame = frameIndex;
    }

    destroy() {
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
        this._surface = null;
        this._frameImages = [];
    }
}
