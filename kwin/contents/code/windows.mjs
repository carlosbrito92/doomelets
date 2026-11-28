// Coleta de janelas para o KWin — equivalente ao _tick()/_scanForDocks() de src/manager.js.
// Recebe o objeto Workspace do QML (org.kde.kwin) e devolve superfícies { rect, ref, isDock }.

export const OWN_CAPTION_PREFIX = 'Doomelets';

/** Janela nossa (overlay ou alça de arrastar)? */
export function isOwnWindow(w) {
    return w.resourceClass === '' && String(w.caption).startsWith(OWN_CAPTION_PREFIX);
}

/** Janela nossa e ainda viva (as de uma instância anterior ficam um tempo como `deleted`). */
export function isLiveOwnWindow(w) {
    return !w.deleted && isOwnWindow(w);
}

/** A janela está de fato na tela atual (desktop/atividade atuais, não minimizada)? */
export function isShown(w, workspace) {
    if (!w || w.deleted || w.minimized || w.hidden) return false;
    if (!w.onAllDesktops) {
        const cur = workspace.currentDesktop;
        if (!cur || !w.desktops.some(d => d.id === cur.id)) return false;
    }
    const acts = w.activities;
    if (acts && acts.length > 0 && !acts.includes(workspace.currentActivity)) return false;
    return true;
}

/** Janela "de verdade" onde dá para pisar (exclui painel, desktop, popups, OSDs...). */
export function isSurface(w) {
    return !w.specialWindow && !w.popupWindow && !w.skipTaskbar && (w.normalWindow || w.dialog);
}

function isMax(w) {
    return w.normalWindow && (w.maximizeMode === 3 || w.fullScreen);
}

function rectOf(w) {
    const g = w.frameGeometry;
    return { x: Math.floor(g.x), y: Math.floor(g.y), width: Math.floor(g.width), height: Math.floor(g.height) };
}

/** Retângulo da janela se ela é uma superfície viva e visível agora; senão null. */
export function liveRect(w, workspace) {
    if (!w || isOwnWindow(w) || !isShown(w, workspace) || !isSurface(w)) return null;
    return rectOf(w);
}

/** Retângulo de uma janela que está saindo (fechando/minimizando); null se não der para ler. */
export function departingRect(w) {
    try {
        if (!w || isOwnWindow(w) || !isSurface(w)) return null;
        return rectOf(w);
    } catch (e) {
        return null;
    }
}

/**
 * floorMode: 'allow' | 'partial' | 'disallow' (mesmo significado da chave floor-z-order).
 * Retorna { windows, forceBackground, stack } — `stack` são as janelas visíveis de baixo
 * para cima, usado pelo main.qml para saber o que cobre cada personagem.
 */
export function collectWindows(workspace, floorMode, walkOnPanels) {
    const stack = workspace.stackingOrder.filter(w => !isOwnWindow(w) && isShown(w, workspace));
    const actors = stack.filter(isSurface);
    const focusWindow = workspace.activeWindow;

    let focusedIndex = -1;
    const maximizedIndices = [];
    for (let i = 0; i < actors.length; i++) {
        if (actors[i] === focusWindow) focusedIndex = i;
        if (isMax(actors[i])) maximizedIndices.push(i);
    }

    let minIndex = -1;
    let maxIndex = actors.length;
    let forceBackground = false;
    const focusedIsMaximized = focusedIndex !== -1 && isMax(actors[focusedIndex]);

    if (floorMode === 'partial') {
        if (focusedIsMaximized) {
            forceBackground = true;
            maxIndex = focusedIndex;
            let prevMax = -1;
            for (const idx of maximizedIndices) {
                if (idx < focusedIndex) prevMax = idx;
                else break;
            }
            minIndex = prevMax;
        } else if (maximizedIndices.length > 0) {
            minIndex = maximizedIndices[maximizedIndices.length - 1];
        }
    } else if (floorMode === 'disallow') {
        if (maximizedIndices.length > 0) {
            forceBackground = true;
            maxIndex = maximizedIndices[0];
        }
    } else if (maximizedIndices.length > 0) {
        minIndex = maximizedIndices[maximizedIndices.length - 1];
    }

    const windows = [];
    for (let i = minIndex + 1; i < maxIndex; i++) {
        const w = actors[i];
        if (isMax(w)) continue;
        windows.push({ rect: rectOf(w), ref: w });
    }

    // Painéis do Plasma fazem o papel do Dash to Dock / Dash to Panel
    let allowDock = walkOnPanels;
    if (allowDock && maximizedIndices.length > 0) {
        if (floorMode === 'disallow') allowDock = false;
        else if (floorMode === 'partial' && (focusedIndex === -1 || focusedIsMaximized)) allowDock = false;
    }
    if (allowDock) {
        for (const w of stack) {
            if (w.dock) windows.push({ rect: rectOf(w), ref: w, isDock: true });
        }
    }

    return { windows, forceBackground, stack };
}

/**
 * Personagem pisando em `surface` está coberto por alguma janela acima dela?
 * (No GNOME ele ficava de fato atrás; aqui o overlay é um só e fica acima de tudo,
 * então escondemos.) Com surface null, conta qualquer janela da pilha.
 */
export function isCovered(stack, surface, cx, cy) {
    // surface null = está no fundo (chão/desktop): qualquer janela cobre
    const idx = surface ? stack.indexOf(surface) : -1;
    if (surface && idx < 0) return false;
    for (let i = idx + 1; i < stack.length; i++) {
        const w = stack[i];
        // Janelas invisíveis (ex.: a ponte de vídeo do Xwayland tem opacidade 0) não cobrem nada
        if (w.desktopWindow || w.opacity < 0.1) continue;
        const g = w.frameGeometry;
        if (cx >= g.x && cx < g.x + g.width && cy >= g.y && cy < g.y + g.height) return true;
    }
    return false;
}
