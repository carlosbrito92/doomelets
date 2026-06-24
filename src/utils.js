export const UPDATE_INTERVAL_MS = 50; // Update loop runs every 50ms (~20 FPS)
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
    // Estados originais — não remover
    FALLING:    'FALLING',
    WALKING:    'WALKING',
    IDLE:       'IDLE',
    JUMPING:    'JUMPING',
    DRAGGING:   'DRAGGING',
    // Estados Doom — novos
    FLOATING:   'FLOATING',    // Cacodemon: movimento senoidal sem gravidade
    THROWING:   'THROWING',    // Imp: lançando bola de fogo
    CHASING:    'CHASING',     // Perseguindo alvo
    SHOOTING:   'SHOOTING',    // Doom Slayer: animação de tiro
    GLORY_KILL: 'GLORY_KILL',  // Doom Slayer: execução corpo a corpo
    STUNNED:    'STUNNED',     // Atingido: pausa antes de morrer ou recuperar
    DYING:      'DYING',       // Animação de morte em andamento
    SPAWNING:   'SPAWNING',    // Fade-in de entrada na tela
};

/**
 * Utility to check if a window is maximized or full-screen
 */
export function isWindowMaximized(window) {
    if (!window) return false;
    const isMax = window.maximized_horizontally && window.maximized_vertically;
    const isFull = typeof window.is_fullscreen === 'function' ? window.is_fullscreen() : false;
    return isMax || isFull;
}
