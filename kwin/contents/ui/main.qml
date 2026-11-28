/*
    Doomelets para KWin (Plasma 6) — front-end do script declarativo.

    Um único overlay transparente cobre todo o desktop virtual e desenha personagens e
    projéteis. Ele tem `outputOnly: true`, então o KWin não entrega cliques a ele.
    Com "Permitir interação" ligado, cada personagem ganha uma janelinha invisível
    (alça) que recebe o clique de arrastar.

    A lógica do jogo fica em ../code/*.mjs (port de src/*.js).
*/
import QtQuick
import QtQuick.Window as QW
import org.kde.kwin
import "../code/utils.mjs" as Utils
import "../code/manager.mjs" as Core
import "../code/windows.mjs" as Win
import "../code/sprites.mjs" as Sprites

Item {
    id: root

    readonly property var characterTypes: ["DoomSlayer", "Imp", "Cacodemon", "Kitten", "Mouse", "Puppy", "Santa", "Squirrel", "Tux"]
    readonly property var floorModes: ["allow", "partial", "disallow"]

    property var manager: null
    property var cfg: ({})
    property bool petsEnabled: true
    property var lastStack: []
    property var dragged: null          // entidade sendo arrastada
    property point dragOffset: Qt.point(0, 0)

    // ---------------------------------------------------------------- configuração

    function readBool(key, def) {
        const v = KWin.readConfig(key, def);
        return v === true || v === "true";
    }

    function readInt(key, def) {
        const n = parseInt(KWin.readConfig(key, def));
        return isNaN(n) ? def : n;
    }

    function readCfg() {
        const types = characterTypes.filter(t =>
            readBool("Type" + t, t === "DoomSlayer" || t === "Imp" || t === "Cacodemon"));
        return {
            "gnomelet-count": Math.max(0, Math.min(50, readInt("Count", 5))),
            "gnomelet-scale": Math.max(16, Math.min(512, readInt("Scale", 64))),
            "jump-power": Math.max(1, readInt("JumpPower", 20)),
            "spawn-offset": readInt("SpawnOffset", 0),
            "allow-interaction": readBool("AllowInteraction", true),
            "walk-on-panels": readBool("WalkOnPanels", true),
            "floor-z-order": floorModes[readInt("FloorZOrder", 0)] || "allow",
            "gnomelet-type": types,
            "game-speed": Math.max(25, Math.min(300, readInt("GameSpeed", 100))),
            // Segundos → ticks de 50 ms (o mínimo nunca passa do máximo)
            "demon-respawn-min": Math.min(readInt("RespawnMin", 5), readInt("RespawnMax", 10)) * 20,
            "demon-respawn-max": Math.max(readInt("RespawnMin", 5), readInt("RespawnMax", 10)) * 20,
            "health-DoomSlayer": Math.max(1, readInt("SlayerHealth", 12)),
            "health-Imp": Math.max(1, readInt("ImpHealth", 3)),
            "health-Cacodemon": Math.max(1, readInt("CacodemonHealth", 5)),
        };
    }

    // Mesma interface do Gio.Settings usado no GNOME
    readonly property var settings: ({
        get_int: key => root.cfg[key],
        get_boolean: key => key === "is-enabled" ? root.petsEnabled : root.cfg[key],
        get_string: key => root.cfg[key],
        get_strv: key => root.cfg[key],
        set_boolean: (key, value) => {
            if (key !== "is-enabled" || root.petsEnabled === value) return;
            root.petsEnabled = value;
            root.manager.onSettingsChanged(key);
        },
    })

    function reloadConfig() {
        const next = readCfg();
        const changed = Object.keys(next).filter(k => JSON.stringify(next[k]) !== JSON.stringify(cfg[k]));
        if (changed.length === 0) return;
        cfg = next;
        if (!manager) return;
        for (const k of changed) manager.onSettingsChanged(k);
        if (changed.includes("allow-interaction")) syncHandles();
    }

    // ---------------------------------------------------------------- plataforma

    function screenRects() {
        return Workspace.screens.map(s => ({ x: s.geometry.x, y: s.geometry.y, width: s.geometry.width, height: s.geometry.height }));
    }

    function installPlatform() {
        Utils.platform.monitors = screenRects;
        // No Plasma 6 a primeira tela da lista é a de maior prioridade (a "principal")
        Utils.platform.primaryMonitor = () => screenRects()[0] ?? { x: 0, y: 0, width: 1920, height: 1080 };
        Utils.platform.stageWidth = () => Workspace.virtualScreenGeometry.x + Workspace.virtualScreenGeometry.width;
        Utils.platform.stageHeight = () => Workspace.virtualScreenGeometry.y + Workspace.virtualScreenGeometry.height;
    }

    readonly property var host: ({
        sprites: Sprites.SPRITES,
        imageUrl: (type, i) => Qt.resolvedUrl("../images/" + type + "/" + i + ".png"),
        createView: entity => spriteComponent.createObject(stage, { entity: entity }),
        createProjectileView: p => projectileComponent.createObject(stage, { look: p.look }),
        pointer: () => Workspace.cursorPos,
        createPortalView: p => portalComponent.createObject(stage, { cx: p.x - overlay.x, cy: p.y - overlay.y }),
        windowRect: w => Win.liveRect(w, Workspace),
        collectWindows: (floorMode, walkOnPanels) => {
            const r = Win.collectWindows(Workspace, floorMode, walkOnPanels);
            root.lastStack = r.stack;
            return r;
        },
    })

    // ---------------------------------------------------------------- overlay

    QW.Window {
        id: overlay
        // Lido pelo KWin (InternalWindow::hitTest): a janela só desenha, nunca recebe input
        property bool outputOnly: true
        title: Win.OWN_CAPTION_PREFIX
        flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus | Qt.BypassWindowManagerHint
        color: "transparent"

        Item { id: stage; anchors.fill: parent }
    }

    function placeOverlay() {
        const g = Workspace.virtualScreenGeometry;
        overlay.x = g.x;
        overlay.y = g.y;
        overlay.width = g.width;
        overlay.height = g.height;
    }

    /**
     * Esconde nossas janelas da barra de tarefas, do pager e do Alt+Tab. Elas aparecem no
     * Workspace um pouco depois de show(), então isto roda a cada tick até pegar todas.
     * (Camada não precisa: com BypassWindowManagerHint o KWin já as põe na camada de OSD,
     * acima das janelas comuns. Por isso o modo "atrás de maximizadas" é emulado no render.)
     */
    function configureOwnWindows() {
        for (const w of Workspace.stackingOrder) {
            if (Win.isLiveOwnWindow(w) && !(w.skipTaskbar && w.skipSwitcher && w.skipPager)) {
                w.skipTaskbar = true;
                w.skipPager = true;
                w.skipSwitcher = true;
            }
        }
    }

    // ---------------------------------------------------------------- visões

    Component {
        id: spriteComponent
        Image {
            property var entity
            property var handle: null
            // Movimento contínuo: a lógica roda a 20 Hz, então cada passo desliza durante um tick.
            // glide=false posiciona direto (arrastar, teleporte, primeira posição).
            property bool glide: false
            property real tx: 0
            property real ty: 0
            property bool placed: false
            Behavior on x { enabled: glide; NumberAnimation { duration: tickTimer.interval; easing.type: Easing.Linear } }
            Behavior on y { enabled: glide; NumberAnimation { duration: tickTimer.interval; easing.type: Easing.Linear } }
            smooth: true
            fillMode: Image.PreserveAspectFit
            cache: true
            asynchronous: false
            Behavior on opacity { NumberAnimation { duration: 120 } }
            Component.onDestruction: if (handle) handle.destroy()
        }
    }

    Component {
        id: projectileComponent
        Item {
            property var look
            width: look.size
            height: look.size
            Behavior on x { NumberAnimation { duration: tickTimer.interval; easing.type: Easing.Linear } }
            Behavior on y { NumberAnimation { duration: tickTimer.interval; easing.type: Easing.Linear } }
            Rectangle {   // brilho
                anchors.centerIn: parent
                width: parent.width + look.glowSize * 2
                height: width
                radius: width / 2
                color: look.glow
                opacity: 0.45
            }
            Rectangle {
                anchors.fill: parent
                radius: width / 2
                color: look.color
            }
        }
    }

    // Anel de fogo onde um demônio entra ou sai de cena (centro em cx, cy)
    Component {
        id: portalComponent
        Rectangle {
            property real cx: 0
            property real cy: 0
            width: 64
            height: 64
            x: cx - width / 2
            y: cy - height / 2
            radius: 32
            color: "#40ff5a14"
            border.width: 3
            border.color: "#ff7a1a"
            transformOrigin: Item.Center
            NumberAnimation on scale { from: 0.2; to: 1.3; duration: 700; easing.type: Easing.OutQuad }
            NumberAnimation on opacity { from: 1; to: 0; duration: 700; easing.type: Easing.OutQuad }
        }
    }

    // Alça invisível para arrastar (só existe com "Permitir interação" ligado)
    Component {
        id: handleComponent
        QW.Window {
            property var entity
            title: Win.OWN_CAPTION_PREFIX + " handle"
            flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus | Qt.BypassWindowManagerHint
            color: "transparent"
            MouseArea {
                anchors.fill: parent
                cursorShape: root.dragged ? Qt.ClosedHandCursor : Qt.OpenHandCursor
                onPressed: root.beginDrag(entity)
                onReleased: root.endDrag()
                onCanceled: root.endDrag()
            }
        }
    }

    function syncHandles() {
        const want = !!cfg["allow-interaction"] && petsEnabled;
        if (!manager) return;
        for (const e of manager.gnomelets) {
            const view = e.actor;
            if (!view) continue;
            if (want && !view.handle) {
                view.handle = handleComponent.createObject(root, { entity: e });
                view.handle.show();
            } else if (!want && view.handle) {
                view.handle.destroy();
                view.handle = null;
            }
        }
    }
    function beginDrag(entity) {
        if (!entity || !entity.actor) return;
        const c = Workspace.cursorPos;
        dragOffset = Qt.point(c.x - entity._x, c.y - entity._y);
        dragged = entity;
        entity.actor.glide = false;
        entity.beginDrag();
        entity.dragTo(entity._x, entity._y);
    }

    function endDrag() {
        if (!dragged) return;
        dragged.endDrag();
        dragged = null;
    }

    /** Copia o estado das entidades para os itens QML. */
    function render() {
        const ox = overlay.x, oy = overlay.y;
        for (const e of manager.gnomelets) {
            const v = e.actor;
            if (!v) continue;
            const url = e.frameUrl;
            if (url && v.source !== url) v.source = url;
            v.width = e._displayW;
            v.height = e._displayH;
            const nx = Math.floor(e._x) - ox, ny = Math.floor(e._y) - oy;
            // Saltos grandes (renascer, arremesso, troca de tela) e o arrasto não deslizam
            v.glide = v.placed && e !== dragged && Math.hypot(nx - v.tx, ny - v.ty) <= Utils.SMOOTH_SNAP_PX;
            v.x = nx;
            v.y = ny;
            v.tx = nx;
            v.ty = ny;
            v.placed = true;
            v.mirror = !e.facingRight;
            const cx = e._x + e._displayW / 2, cy = e._y + e._displayH / 2;
            // Pisando numa janela: some atrás das janelas acima dela. No chão/painel, só em
            // modo de fundo (GNOME: _backgroundGroup), aí some atrás de qualquer janela.
            // O Cacodemon flutua sempre na frente, como no GNOME.
            const covered = e._surface ? Win.isCovered(lastStack, e._surface, cx, cy)
                : (manager.forceBackground && !e._floatsAbove && Win.isCovered(lastStack, null, cx, cy));
            v.opacity = covered ? 0 : 1;
            if (v.handle && e !== dragged) {
                v.handle.x = Math.floor(e._x);
                v.handle.y = Math.floor(e._y);
                v.handle.width = Math.max(1, e._displayW);
                v.handle.height = Math.max(1, e._displayH);
                v.handle.visible = !covered;
            }
        }
        for (const p of manager.projectiles) {
            if (!p.actor) continue;
            p.actor.x = Math.floor(p._x) - ox;
            p.actor.y = Math.floor(p._y) - oy;
        }
    }

    // ---------------------------------------------------------------- eventos de janela

    property var hooked: []     // janelas cujo minimizedChanged já ouvimos

    function hookWindow(w) {
        if (!w || hooked.indexOf(w) >= 0 || Win.isOwnWindow(w)) return;
        hooked.push(w);
        w.minimizedChanged.connect(() => {
            if (w.minimized && root.manager) root.manager.onWindowGone(Win.departingRect(w));
        });
    }

    function pruneHooked() {
        hooked = hooked.filter(w => { try { return !w.deleted; } catch (e) { return false; } });
    }

    // ---------------------------------------------------------------- laços

    Timer {
        id: tickTimer
        // Velocidade do jogo: 100 % = 50 ms por tick, como no GNOME
        interval: Math.round(Utils.UPDATE_INTERVAL_MS * 100 / (root.cfg["game-speed"] || 100))
        repeat: true
        onTriggered: {
            if (!root.manager) return;
            root.manager.tick();
            root.syncHandles();
            root.configureOwnWindows();
            root.render();
        }
    }

    // Arrastar precisa ser mais fluido que os 20 FPS da simulação
    Timer {
        interval: 16
        repeat: true
        running: root.dragged !== null
        onTriggered: {
            const e = root.dragged;
            if (!e || !e.actor) { root.dragged = null; return; }
            const c = Workspace.cursorPos;
            e.dragTo(c.x - root.dragOffset.x, c.y - root.dragOffset.y);
            const h = e.actor.handle;
            if (h) { h.x = Math.floor(e._x); h.y = Math.floor(e._y); }
            e.actor.x = Math.floor(e._x) - overlay.x;
            e.actor.y = Math.floor(e._y) - overlay.y;
        }
    }

    // O KCM salva no kwinrc; relemos de tempos em tempos (é barato)
    Timer {
        interval: 2000
        repeat: true
        running: true
        onTriggered: root.reloadConfig()
    }

    Connections {
        target: Workspace
        function onVirtualScreenGeometryChanged() { root.placeOverlay(); }
        function onWindowAdded(w) {
            root.hookWindow(w);
            if (root.manager && !Win.isOwnWindow(w) && Win.isSurface(w)) root.manager.onWindowAdded(w);
        }
        function onWindowRemoved(w) {
            if (root.manager) root.manager.onWindowGone(Win.departingRect(w));
            root.pruneHooked();
        }
    }

    ShortcutHandler {
        name: "Doomelets: Toggle"
        text: "Doomelets: show or hide the characters"
        sequence: "Meta+Ctrl+D"
        onActivated: {
            root.settings.set_boolean("is-enabled", !root.petsEnabled);
            overlay.visible = root.petsEnabled;
            tickTimer.running = root.petsEnabled;
            root.syncHandles();
        }
    }

    ShortcutHandler {
        name: "Doomelets: Respawn"
        text: "Doomelets: respawn all characters"
        sequence: "Meta+Ctrl+R"
        onActivated: if (root.manager && root.petsEnabled) root.manager._hardReset()
    }

    Component.onCompleted: {
        cfg = readCfg();
        console.warn("Doomelets: started with", JSON.stringify(cfg));
        installPlatform();
        placeOverlay();
        overlay.show();
        manager = new Core.GnomeletManager(settings, host);
        manager.enable();
        for (const w of Workspace.stackingOrder) hookWindow(w);
        tickTimer.start();
    }

    Component.onDestruction: {
        if (manager) manager.disable();
    }
}
