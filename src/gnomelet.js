import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {
    State,
    GRAVITY,
    WALK_SPEED,
    IMP_WALK_SPEED,
    IMP_CHASE_SPEED,
    SLAYER_CHASE_SPEED,
    FLOAT_AMPLITUDE,
    FLOAT_FREQUENCY,
    isWindowMaximized,
    UPDATE_INTERVAL_MS,
    CURIOSITY_RANGE,
    CURIOSITY_NOTICE_TICKS,
    CURIOSITY_STARE_TICKS,
    IDLE_VARIANT_MIN_TICKS,
    NOTICE_PAUSE_TICKS,
} from './utils.js';
import { IdleScheduler, Curiosity, facingToward } from './behavior.js';
import { placeActor, resetMotion } from './motion.js';

/**
 * Gnomelet Class
 * Represents a single animated character on the screen.
 * Uses pre-sliced images loaded by the Manager.
 */
export const Gnomelet = GObject.registerClass(
    class Gnomelet extends GObject.Object {
        _init(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider) {
            super._init();

            this._typeName = typeName;
            this._settings = settings;
            this._resourceProvider = resourceProvider;

            // --- State Initialization ---
            this._state = State.FALLING;
            this._vx = 0; // Velocity X
            this._vy = 0; // Velocity Y

            // --- Animation State ---
            this._frame = 0; // Current sprite frame index
            this._animationTimer = 0; // Counter for animation timing
            this._savedFacing = Math.random() > 0.5; // Initial Direction
            this._idleTimer = 0; // Countdown for how long to stay idle

            // --- Idle com variações e curiosidade com o ponteiro (ver behavior.js) ---
            this._idleVariants = [];        // subclasses: [{ name, weight, cooldown }]; name null = só respirar
            this._idleSched = null;
            this._idleSchedFor = null;
            this._wasIdle = false;
            this._idleVariant = null;
            this._idleVariantTicks = 0;
            this._stareReaction = null;     // animação tocada ao ser encarado pelo cursor ('look', 'taunt'...)
            this._pointer = null;           // { x, y, dist, level }
            this._curiosity = new Curiosity({
                range: CURIOSITY_RANGE,
                noticeTicks: CURIOSITY_NOTICE_TICKS,
                stareTicks: CURIOSITY_STARE_TICKS,
            });

            // --- Configurable Dimensions ---
            this._frameWidth = frameWidth;
            this._frameHeight = frameHeight;

            // --- Image Resources ---
            this._frameImages = frameImages;

            // --- Dimensions and Scale ---
            // Calculate initial dimensions accounting for interface scale
            let iconSize = this._updateDimensions();

            this._randomizeStartPos();

            // --- Actor Setup (St.Icon) ---
            // NOTE: St.Icon handles scaling better when using only icon_size.
            // We avoid explicit width/height to prevent conflicts with internal icon management.
            this._icon = new St.Icon({
                visible: true,
                reactive: false,
                icon_size: iconSize,
                style: 'padding: 0px; object-fit: fill;',
            });

            this.actor = new St.Widget({
                visible: true,
                reactive: false,
                layout_manager: new Clutter.BinLayout(),
            });
            this.actor.add_child(this._icon);

            // Set initial frame content
            if (this._frameImages.length > 0 && this._frameImages[0]) {
                this._icon.set_gicon(this._frameImages[0]);
            }

            this.actor._delegate = this; // Fix for DND source identification

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

            // Set initial layer based on context (Fix for maximized window visibility)
            this._resetLayer();
            this._placeActor(true);

            this._updateInteraction();
            this.updateJumpPower();
            this._updateAnimation();
        }

        // Property to define facing based on Velocity X
        get facingRight() {
            let sign = Math.sign(this._vx);
            if (sign !== 0 && !isNaN(sign)) {
                this._savedFacing = (sign > 0);
            }
            return this._savedFacing;
        }

        // Mock 'app' property to prevent crashes with gtk4-ding
        get app() {
            return null;
        }

        /**
         * Calculates dimensions based on settings and interface scale.
         * Returns the icon_size parameter to be used for St.Icon.
         */
        _updateDimensions() {
            const settingsScale = this._settings.get_int('gnomelet-scale');
            const themeContext = St.ThemeContext.get_for_stage(global.stage);
            const interfaceScale = themeContext ? themeContext.scale_factor : 1;

            let iconSizeParam = Math.floor(settingsScale / interfaceScale);
            if (iconSizeParam < 1) iconSizeParam = 1;

            this._displayH = iconSizeParam * interfaceScale;
            this._displayW = Math.floor(this._displayH * (this._frameWidth / this._frameHeight));

            return iconSizeParam;
        }

        /**
         * Updates the gnomelet scale when settings change or interface scale changes.
         */
        updateScale() {
            let oldH = this._displayH;

            let iconSize = this._updateDimensions();

            this._icon.set_icon_size(iconSize);

            this._y = this._y + oldH - this._displayH;
            this._placeActor(true);
        }

        /**
         * Updates jump parameters from settings.
         */
        updateJumpPower() {
            let power = this._settings.get_int('jump-power');
            this._jumpVelocity = -Math.abs(power);
            this._jumpReachX = (WALK_SPEED * 2) * Math.abs(this._jumpVelocity / GRAVITY);
            this._maxJumpHeight = (this._jumpVelocity * this._jumpVelocity) / (2 * GRAVITY);
        }

        /**
         * Doom: Recebe dano. hp=0 na classe base = invulnerável.
         */
        takeDamage(amount) {
            if (this._maxHp === 0 || this._isDead) return;
            this._hp -= amount;
            if (this._hp <= 0) {
                this._hp = 0;
                this._state = State.STUNNED;
                this._stunTimer = this._stunDuration;
            } else {
                this._state = State.STUNNED;
                this._stunTimer = this._stunDuration;
            }
        }

        /**
         * Doom: Chamado quando a animação de morte termina.
         * Comportamento padrão: respawn (compatível com personagens originais).
         * Subclasses sobrescrevem para destruir a entidade.
         */
        _onDeathComplete() {
            this._isDead = false;
            this._hp = this._maxHp;
            this._respawn();
        }

        /**
         * Updates the interaction mode (dragging) based on settings.
         */
        _updateInteraction() {
            let allowInteraction = this._settings.get_boolean('allow-interaction');

            if (allowInteraction) {
                if (!this._draggable) {
                    this.actor.reactive = true;
                    this._draggable = DND.makeDraggable(this.actor);
                    this._dragBeginId = this._draggable.connect('drag-begin', this._onDragBegin.bind(this));
                    this._dragEndId = this._draggable.connect('drag-end', this._onDragEnd.bind(this));
                }
            } else {
                this.actor.reactive = false;
            }
        }

        _onDragBegin() {
            resetMotion(this.actor);
            this._state = State.DRAGGING;
            this._vx = 0;
            this._vy = 0;
            this._updateAnimation();
            this._dragHistory = [];
            this._dropTime = 0;

            this._dragOverlay = new Clutter.Actor({
                width: global.stage.width,
                height: global.stage.height,
                reactive: true
            });
            this._dragOverlay._delegate = this;
            Main.layoutManager.uiGroup.add_child(this._dragOverlay);
        }

        handleDragOver(source, actor, x, y) {
            if (!this._dragHistory) this._dragHistory = [];

            const now = Date.now();
            this._dragHistory.push({ x, y, time: now });

            const HISTORY_LIMIT_MS = 200;
            while (this._dragHistory.length > 0 && now - this._dragHistory[0].time > HISTORY_LIMIT_MS) {
                this._dragHistory.shift();
            }

            return DND.DragMotionResult.MOVE_DROP;
        }

        acceptDrop(source, actor, x, y, time) {
            this._x = actor.x;
            this._y = actor.y;
            this._dropTime = time;

            let parent = this.actor.get_parent();
            if (parent === Main.layoutManager.uiGroup) {
                Main.layoutManager.removeChrome(this.actor);
            } else if (parent) {
                parent.remove_child(this.actor);
            }
            global.window_group.add_child(this.actor);

            this._placeActor(true);

            return true;
        }

        _onDragEnd() {
            if (this._dragOverlay) {
                this._dragOverlay.destroy();
                this._dragOverlay = null;
            }

            resetMotion(this.actor);
            this._x = this.actor.x;
            this._y = this.actor.y;

            this.actor.rotation_angle_z = 0;
            this.actor.scale_y = 1;
            this.actor.scale_x = 1;
            this.actor.opacity = 255;

            this._icon.set_pivot_point(0.5, 0.5);
            this._icon.scale_x = this.facingRight ? 1 : -1;

            this._state = State.FALLING;

            const momentum = this._calculateMomentum();
            this._vx = momentum.vx;
            this._vy = momentum.vy;

            this._resetLayer();
        }

        /**
         * Calculates velocity based on drag history.
         */
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

            const vX_ms = (last.x - prev.x) / dt;
            const vY_ms = (last.y - prev.y) / dt;

            const SCALE_FACTOR = 0.25;

            let vx = vX_ms * UPDATE_INTERVAL_MS * SCALE_FACTOR;
            let vy = vY_ms * UPDATE_INTERVAL_MS * SCALE_FACTOR;

            const MAX_VELOCITY = 50;
            vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vx));
            vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vy));

            return { vx, vy };
        }

        /**
         * Serializes the state for persistence.
         */
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

        /**
         * Restores saved state.
         */
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

            this._placeActor(true);
            this.setFrame(this._frame);
        }

        /**
         * Main update loop for the gnomelet.
         */
        update(windows, forceBackground, dockContainer, allEntities = [], projectiles = []) {
            if (!this.actor) return; // Guard against updates after destruction

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

            // Physics (Gravity)
            if (this._state === State.FALLING || this._state === State.JUMPING) {
                this._vy += GRAVITY;
            }

            // Stop movement if idle (prevents sliding)
            if (this._state === State.IDLE) {
                this._vx = 0;
            }

            // Update Position
            let prevY = this._y;
            this._x += this._vx;
            this._y += this._vy;

            // Determine current monitor based on "feet" position
            let feetX = this._x + this._displayW / 2;
            let feetY = this._y + this._displayH;

            let monitors = Main.layoutManager.monitors.filter(m => feetX >= m.x && feetX < m.x + m.width);

            let currentMonitor = null;
            if (monitors.length === 0) {
                currentMonitor = Main.layoutManager.primaryMonitor;
            } else if (monitors.length === 1) {
                currentMonitor = monitors[0];
            } else {
                monitors.sort((a, b) => a.y - b.y);
                currentMonitor = monitors.find(m => feetY < m.y + m.height);
                if (!currentMonitor) currentMonitor = monitors[monitors.length - 1];
            }

            let floorY = currentMonitor.y + currentMonitor.height;

            // Ceiling collision
            if (this._y < currentMonitor.y) {
                this._y = currentMonitor.y;
                this._vy = 0;
            }

            // --- Logic: Reposition if walking off floor ---
            let onFloorLevel = (this._y + this._displayH) >= floorY - 10;

            if (onFloorLevel) {
                if (this._x < -this._displayW || this._x > global.stage.width) {
                    this._respawn();
                    return;
                }
            } else {
                let maxX = global.stage.width - this._displayW;
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

            // --- Z-Ordering / Layering Logic ---
            if (landedOnWindow && !landedOnWindow.isDock) {
                let parent = this.actor.get_parent();
                if (parent !== global.window_group) {
                    if (parent === Main.layoutManager.uiGroup) {
                        Main.layoutManager.removeChrome(this.actor);
                    } else if (parent) {
                        parent.remove_child(this.actor);
                    }
                    global.window_group.add_child(this.actor);
                }

                global.window_group.set_child_above_sibling(this.actor, landedOnWindow.actor);

            } else {
                let parent = this.actor.get_parent();

                if (!forceBackground) {
                    if (parent !== Main.layoutManager.uiGroup) {
                        if (parent) parent.remove_child(this.actor);
                        Main.layoutManager.addChrome(this.actor);
                    }

                    if (dockContainer && this.actor.get_parent() === Main.layoutManager.uiGroup &&
                        dockContainer.get_parent() === Main.layoutManager.uiGroup) {

                        let dockOrder = this._settings.get_boolean('dock-z-order');
                        if (dockOrder) {
                            Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, dockContainer);
                        } else {
                            Main.layoutManager.uiGroup.set_child_below_sibling(this.actor, dockContainer);
                        }
                    }
                } else {
                    let bgGroup = Main.layoutManager._backgroundGroup;
                    if (bgGroup && parent !== bgGroup) {
                        if (parent === Main.layoutManager.uiGroup) {
                            Main.layoutManager.removeChrome(this.actor);
                        } else if (parent) {
                            parent.remove_child(this.actor);
                        }
                        bgGroup.add_child(this.actor);
                    }
                }
            }

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

                if (canJump) {
                    if (Math.random() < 0.25) {
                        this._performJump();
                    }
                }

            } else if (this._state === State.IDLE) {
                this._vx = 0;
                this._idleTimer--;
                if (this._idleTimer <= 0) {
                    this._pickNewAction();
                }
            }

            this._updateAnimation();
            this._placeActor();
        }

        /**
         * Determines if the gnomelet should be in the background layer.
         */
        _isBackgroundMode() {
            let floorMode = this._settings.get_string('floor-z-order');
            if (floorMode === 'allow') return false;

            let focusWindow = global.display.focus_window;
            let focusedIsMaximized = focusWindow && isWindowMaximized(focusWindow);

            if (floorMode === 'partial') {
                return focusedIsMaximized;
            }

            if (focusedIsMaximized) return true;

            let actors = global.window_group.get_children();
            for (let actor of actors) {
                if (actor.visible && actor.meta_window && !actor.meta_window.minimized &&
                    actor.meta_window.get_window_type() === Meta.WindowType.NORMAL &&
                    isWindowMaximized(actor.meta_window)) {
                    return true;
                }
            }
            return false;
        }

        /**
         * Sets the initial layer for the actor based on the floor z-order setting.
         */
        _resetLayer() {
            let spawnInBackground = this._isBackgroundMode();
            let parent = this.actor.get_parent();

            if (spawnInBackground) {
                let bgGroup = Main.layoutManager._backgroundGroup;
                if (bgGroup && parent !== bgGroup) {
                    if (parent === Main.layoutManager.uiGroup) {
                        Main.layoutManager.removeChrome(this.actor);
                    } else if (parent) {
                        parent.remove_child(this.actor);
                    }
                    bgGroup.add_child(this.actor);
                }
            } else {
                if (parent !== Main.layoutManager.uiGroup) {
                    if (parent) parent.remove_child(this.actor);
                    Main.layoutManager.addChrome(this.actor);
                }
            }
        }

        /**
         * Generates a random start position above one of the monitors.
         */
        _randomizeStartPos() {
            let monitors = Main.layoutManager.monitors;
            if (!monitors || monitors.length === 0) {
                this._x = Math.floor(Math.random() * (global.stage.width - this._displayW));
                this._y = 0;
            } else {
                let m = monitors[Math.floor(Math.random() * monitors.length)];
                this._x = Math.floor(m.x + Math.random() * (m.width - this._displayW));
                this._y = m.y;
            }

            let spawnOffset = this._settings.get_int('spawn-offset');
            this._y += spawnOffset;
        }

        /**
         * Resets the character to the top.
         */
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

            this._resetLayer();
        }

        /**
         * Decides the next action when on the ground.
         */
        _pickNewAction() {
            let r = Math.random();
            if (r < 0.6) {
                this._state = State.WALKING;
                let dir = (Math.random() > 0.5) ? 1 : -1;
                this._vx = dir * WALK_SPEED;
            } else {
                this._state = State.IDLE;
                this._idleTimer = Math.random() * 60 + 20;
            }
        }

        /**
         * Performs a jump.
         */
        _performJump() {
            this._state = State.JUMPING;
            this._vy = this._jumpVelocity;
            let dir = this.facingRight ? 1 : -1;
            this._vx = dir * WALK_SPEED * 2;
        }

        /** Posiciona o ator; desliza entre ticks (20 Hz → movimento contínuo) salvo `snap`. */
        _placeActor(snap = false) {
            placeActor(this.actor, Math.floor(this._x), Math.floor(this._y), snap);
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

        /**
         * Chamado pelo Manager a cada tick com a posição do ponteiro.
         * Calcula a curiosidade e reage quando o nível muda.
         */
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

        /** Aparece suavemente (fade-in). */
        _fadeIn(ms = 400) {
            this.actor.opacity = 0;
            this.actor.save_easing_state();
            this.actor.set_easing_duration(ms);
            this.actor.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
            this.actor.opacity = 255;
            this.actor.restore_easing_state();
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
            this._fadeIn();
            this._placeActor(true);
            return { x: this._x + this._displayW / 2, y: this._y + this._displayH / 2 };
        }

        /** Nome da animação do manifesto correspondente ao estado atual. */
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

        /** Entra andando por uma das bordas do monitor principal. */
        enterFromEdge(fromLeft) {
            const monitor = Main.layoutManager.primaryMonitor;
            this._x = fromLeft
                ? monitor.x - this._displayW * 0.7
                : monitor.x + monitor.width - this._displayW * 0.3;
            this._y = monitor.y + monitor.height - this._displayH;
            this._vx = (fromLeft ? 1 : -1) * WALK_SPEED;
            this._vy = 0;
            this._savedFacing = fromLeft;
            this._state = State.WALKING;
            this._placeActor(true);
        }

        /**
         * Calculates the correct frame based on state and time.
         */
        _updateAnimation() {
            this._animationTimer++;

            const name = this._animationName();
            if (name !== this._animName) {
                this._animName = name;
                this._animClock = 0;
            } else {
                this._animClock++;
            }

            // Com manifesto (animations.json) cada animação tem seus próprios quadros e ritmo
            const anim = this._frameImages?.animations?.[name];
            if (anim) {
                let i = Math.floor(this._animClock / anim.ticks);
                i = anim.loop ? i % anim.frames.length : Math.min(i, anim.frames.length - 1);
                this.setFrame(anim.frames[i]);
                return;
            }

            // Sem manifesto: contrato original de quadros numerados
            let frameIndex = 0;
            switch (this._state) {
                case State.WALKING:
                    let walkFrames = [0, 1, 2, 3];
                    let speed = 4;
                    let idx = Math.floor(this._animationTimer / speed) % walkFrames.length;
                    frameIndex = walkFrames[idx];
                    break;
                case State.CHASING:
                    let chaseFrames = [0, 1, 2, 3];
                    let chaseIdx = Math.floor(this._animationTimer / 3) % chaseFrames.length;
                    frameIndex = chaseFrames[chaseIdx];
                    break;
                case State.FLOATING:
                    let floatFrames = [0, 1, 2, 3];
                    let floatIdx = Math.floor(this._animationTimer / 6) % floatFrames.length;
                    frameIndex = floatFrames[floatIdx];
                    break;
                case State.IDLE:
                    frameIndex = 4;
                    break;
                case State.JUMPING:
                case State.FALLING:
                    frameIndex = 5;
                    break;
                case State.THROWING:
                case State.SHOOTING:
                    let throwFrames = [6, 7];
                    let throwIdx = Math.floor(this._animationTimer / 6) % throwFrames.length;
                    frameIndex = throwFrames[throwIdx];
                    break;
                case State.STUNNED:
                    frameIndex = this._frameImages[9] ? 9 : 6;   // 9.png (dano) é opcional
                    break;
                case State.DYING:
                    frameIndex = this._frameImages[8] ? 8 : 7;   // 8.png (morte) é opcional
                    break;
                case State.GLORY_KILL:
                    let gloryFrames = [6, 7];
                    let gloryIdx = Math.floor(this._animationTimer / 8) % gloryFrames.length;
                    frameIndex = gloryFrames[gloryIdx];
                    break;
                case State.PETTING:
                    frameIndex = 4;
                    break;
                case State.SPAWNING:
                    frameIndex = 0;
                    break;
                case State.DRAGGING:
                    let dragFrames = [1, 3];
                    if (this._frameImages[6] && this._frameImages[7]) {
                        dragFrames = [6, 7];
                    }
                    let dragSpeed = 8;
                    let dIdx = Math.floor(this._animationTimer / dragSpeed) % dragFrames.length;
                    frameIndex = dragFrames[dIdx];
                    break;
            }
            this.setFrame(frameIndex);
        }

        /**
         * Applies the frame and handles horizontal flipping (mirroring).
         */
        setFrame(frameIndex) {
            if (this._frame === frameIndex && this._lastFacing === this.facingRight) return;

            this._frame = frameIndex;
            this._lastFacing = this.facingRight;

            if (this._frameImages && this._frameImages[frameIndex]) {
                this._icon.set_gicon(this._frameImages[frameIndex]);
            }

            this._icon.set_pivot_point(0.5, 0.5);
            if (this.facingRight) {
                this._icon.scale_x = 1;
            } else {
                this._icon.scale_x = -1;
            }
        }

        /**
         * Removes the actor and cleans up references.
         */
        destroy() {
            if (this._draggable) {
                if (this._dragBeginId) this._draggable.disconnect(this._dragBeginId);
                if (this._dragEndId) this._draggable.disconnect(this._dragEndId);
                this._draggable = null;
            }

            if (this.actor) {
                let parent = this.actor.get_parent();
                if (parent === Main.layoutManager.uiGroup) {
                    Main.layoutManager.removeChrome(this.actor);
                } else if (parent) {
                    parent.remove_child(this.actor);
                }
                this.actor.destroy();
                this.actor = null;
            }
            this._frameImages = [];
        }
    });
