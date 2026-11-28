// Port KWin das constantes de src/utils.js — mantenha os dois em sincronia.

export const UPDATE_INTERVAL_MS = 50; // Update loop runs every 50ms (~20 FPS)
// Interação com o ponteiro e eventos de janela (espelha src/utils.js)
export const SMOOTH_SNAP_PX = 48;       // saltos maiores que isso (px/tick) não são suavizados na tela
export const CURIOSITY_RANGE = 220;
export const CURIOSITY_NOTICE_TICKS = 6;
export const CURIOSITY_STARE_TICKS = 60;
export const CACO_FOLLOW_RANGE = 700;
export const CACO_FOLLOW_STOP = 150;
export const CACO_FOLLOW_SPEED = 2.4;
export const CACO_FOLLOW_ACCEL = 0.12;
export const IDLE_VARIANT_MIN_TICKS = 20;
export const NOTICE_RANGE = 700;
export const NOTICE_PAUSE_TICKS = 30;
export const PORTAL_DEMON_TTL = 2400;
export const GUARD_AFTER_TICKS = 600;
// Personagens selecionados quando nada está selecionado nas configurações
export const DEFAULT_TYPES = ['DoomSlayer', 'Imp', 'Cacodemon'];
export const GRAVITY = 2;             // Vertical acceleration per frame
export const WALK_SPEED = 3;          // Horizontal pixels per frame

// Doom — velocidades específicas por criatura
export const IMP_WALK_SPEED     = 4;    // px/tick
export const IMP_CHASE_SPEED    = 6;    // px/tick
export const SLAYER_CHASE_SPEED = 7;    // px/tick

// Doom — física do Cacodemon
export const FLOAT_AMPLITUDE    = 30;   // px — amplitude da oscilação vertical
export const FLOAT_FREQUENCY    = 0.05; // rad/tick

export const State = {
    FALLING:    'FALLING',
    WALKING:    'WALKING',
    IDLE:       'IDLE',
    JUMPING:    'JUMPING',
    DRAGGING:   'DRAGGING',
    FLOATING:   'FLOATING',
    THROWING:   'THROWING',
    CHASING:    'CHASING',
    SHOOTING:   'SHOOTING',
    GLORY_KILL: 'GLORY_KILL',
    PETTING:    'PETTING',
    STUNNED:    'STUNNED',
    DYING:      'DYING',
    SPAWNING:   'SPAWNING',
};

/**
 * Ponte com o compositor. No GNOME isso vinha de Main.layoutManager e global.stage;
 * no KWin o main.qml preenche estas funções com dados do Workspace.
 * Coordenadas são globais e lógicas (as mesmas de Workspace.virtualScreenGeometry).
 */
export const platform = {
    /** @returns {{x:number,y:number,width:number,height:number}[]} */
    monitors: () => [],
    /** @returns {{x:number,y:number,width:number,height:number}} */
    primaryMonitor: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    /** Equivalente a global.stage.width/height (borda direita/inferior do desktop virtual). */
    stageWidth: () => 1920,
    stageHeight: () => 1080,
};
