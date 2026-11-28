export const UPDATE_INTERVAL_MS = 50; // Update loop runs every 50ms (~20 FPS)
export const SMOOTH_SNAP_PX = 48;       // saltos maiores que isso (px/tick) não são suavizados

// Interação com o ponteiro do mouse
export const CURIOSITY_RANGE = 220;     // px — distância em que o personagem repara no cursor
export const CURIOSITY_NOTICE_TICKS = 6;   // ticks perto do cursor até virar para ele (~0,3 s)
export const CURIOSITY_STARE_TICKS = 60;   // ticks até encarar e fazer a reação especial (~3 s)
export const CACO_FOLLOW_RANGE = 700;   // px — o Cacodemon acompanha o cursor dentro desse raio
export const CACO_FOLLOW_STOP = 150;    // px — mas guarda essa distância horizontal (tímido)
export const CACO_FOLLOW_SPEED = 2.4;   // px/tick
export const CACO_FOLLOW_ACCEL = 0.12;  // px/tick² — viragem suave
export const IDLE_VARIANT_MIN_TICKS = 20;   // pausas mais curtas são de combate e não sorteiam variação
// Eventos de janela e cenas
export const NOTICE_RANGE = 700;        // px — quem está a essa distância repara numa janela que abre/fecha/minimiza
export const NOTICE_PAUSE_TICKS = 30;   // ticks parado olhando (~1,5 s)
export const PORTAL_DEMON_TTL = 2400;   // ticks que um demônio de portal fica (~2 min) antes de sumir
export const GUARD_AFTER_TICKS = 600;   // ticks de cursor parado até o Slayer vir guardá-lo (~30 s)
// Personagens selecionados quando nada (ou nada que ainda exista) está salvo nas configurações
export const DEFAULT_TYPES = ['DoomSlayer', 'Imp', 'Cacodemon', 'Daisy', 'Pinky', 'LostSoul'];
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
    PETTING:    'PETTING',     // Doom Slayer: fazendo carinho em um personagem original
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
