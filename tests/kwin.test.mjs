// Porte KWin: mesmas cenas dos testes do GNOME, rodando as classes de kwin/contents/code.
// node --import ./tests/support/kwin-register.mjs --test tests/kwin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { State } from '../kwin/contents/code/utils.mjs';
import { DoomSlayer } from '../kwin/contents/code/characters/doom-slayer.mjs';
import { Imp } from '../kwin/contents/code/characters/imp.mjs';
import { Cacodemon } from '../kwin/contents/code/characters/cacodemon.mjs';
import { GnomeletManager } from '../kwin/contents/code/manager.mjs';

const HP = { 'health-DoomSlayer': 12, 'health-Imp': 3, 'health-Cacodemon': 5 };
const settings = (strv = ['Imp', 'Cacodemon', 'DoomSlayer']) => ({
    get_int: k => ({ 'gnomelet-scale': 64, 'jump-power': 20, 'spawn-offset': 0, 'gnomelet-count': 5,
                     'demon-respawn-min': 100, 'demon-respawn-max': 200, ...HP })[k] ?? 0,
    get_boolean: k => k === 'is-enabled' || k === 'walk-on-panels',
    get_string: () => 'allow',
    get_strv: () => strv,
});

function frames(name) {
    const f = Array.from({ length: 120 }, (_, i) => `frame-${i}`);
    f.animations = JSON.parse(fs.readFileSync(new URL(`../src/images/${name}/animations.json`, import.meta.url)));
    return f;
}
const make = (Cls, name) => {
    const c = new Cls(name, frames(name), 144, 153, settings(), () => null, () => {});
    c.actor = { destroy() {} };
    return c;
};
const ground = c => { c._y = 1080 - c._displayH; c._vy = 0; };

test('Slayer parado sorteia reload / look / respirar do manifesto', () => {
    const s = make(DoomSlayer, 'DoomSlayer'); ground(s);
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
        s._state = State.IDLE; s._idleTimer = 50; s._wasIdle = false; s._idleVariant = null;
        s._updateAnimation(); seen.add(s._animName);
        s._state = State.WALKING; s._updateAnimation();
    }
    assert.ok(seen.has('reload') && seen.has('look') && seen.has('idle'), [...seen].join());
});

test('cursor perto vira o personagem parado; encarado ~3 s, o Slayer toca "look" e o Imp não faz nada', () => {
    const s = make(DoomSlayer, 'DoomSlayer'); ground(s);
    const imp = make(Imp, 'Imp'); ground(imp);
    for (const c of [s, imp]) { c._state = State.IDLE; c._idleTimer = 100; c._wasIdle = true; c._savedFacing = false; }
    const cx = s._x + s._displayW / 2, cy = s._y + s._displayH / 2;
    for (let i = 0; i < 70; i++) { s.observePointer(cx + 50, cy); imp.observePointer(imp._x + 10, imp._y + 10); }
    assert.equal(s._savedFacing, true);
    assert.equal(s._idleVariant, 'look');
    assert.equal(imp._idleVariant, null);
});

test('Cacodemon acompanha o cursor com viragem suave e mantém distância', () => {
    const c = make(Cacodemon, 'Cacodemon');
    c._state = State.FLOATING; c._floatSpeedX = -1.5; c._x = 500; c._velX = -1.5;
    let prev = c._velX, maxStep = 0;
    for (let i = 0; i < 300; i++) {
        c.observePointer(1000, c._y + 50);
        c.update([], false, null, [], []);
        maxStep = Math.max(maxStep, Math.abs(c._velX - prev)); prev = c._velX;
    }
    assert.ok(maxStep <= 0.1201, 'aceleração limitada: ' + maxStep);
    const dx = 1000 - (c._x + c._displayW / 2);
    assert.ok(Math.abs(dx) >= 100 && Math.abs(dx) <= 400, 'distância tímida: ' + dx);
});

test('Imp com pouca vida foge do Slayer; com vida cheia não', () => {
    const imp = make(Imp, 'Imp'); ground(imp); imp._x = 800;
    const slayer = make(DoomSlayer, 'DoomSlayer'); ground(slayer); slayer._x = 600;
    imp._allEntities = [slayer, imp];
    imp._hp = 1; imp._pickNewAction();
    assert.equal(imp._state, State.CHASING); assert.ok(imp._vx > 0);
    imp._hp = 3; imp._pickNewAction();
    assert.equal(imp._fleeing, false);
});

test('Slayer com o cursor parado ~30 s vai guardá-lo; se o mouse mexe, volta ao normal', () => {
    const s = make(DoomSlayer, 'DoomSlayer'); ground(s); s._x = 100; s._allEntities = [s];
    s._pointer = { x: 1200, y: 900, dist: 1000, level: 0, still: 700 };
    s._pickNewAction();
    assert.equal(s._state, State.WALKING); assert.ok(s._vx > 0); assert.equal(s._guarding, true);
    s._x = 1200 - s._displayW / 2 - 50;
    s._pickNewAction();
    assert.equal(s._state, State.IDLE); assert.equal(s._savedFacing, true);
    s._pointer.still = 5; s._pickNewAction();
    assert.equal(s._guarding, false);
});

test('notice: para, olha para o evento; em combate ignora; Slayer toca "look"', () => {
    const imp = make(Imp, 'Imp'); ground(imp); imp._x = 500; imp._state = State.WALKING; imp._vx = -4; imp._savedFacing = false;
    assert.equal(imp.notice(1500, 400), true);
    assert.equal(imp._state, State.IDLE); assert.equal(imp._vx, 0); assert.equal(imp._savedFacing, true);
    imp._state = State.THROWING; assert.equal(imp.notice(0, 0), false);
    const s = make(DoomSlayer, 'DoomSlayer'); ground(s); s._state = State.WALKING;
    s.notice(1500, 400); assert.equal(s._idleVariant, 'look');
});

test('arriveAt: Imp pousa no topo da janela; Cacodemon surge flutuando sobre ela', () => {
    const rect = { x: 300, y: 400, width: 800, height: 500 };
    const imp = make(Imp, 'Imp'); const at = imp.arriveAt(rect);
    assert.equal(imp._state, State.SPAWNING);
    assert.equal(imp._y + imp._displayH, 400);
    assert.ok(imp._x >= 300 && imp._x <= 1100 && at.y < 400);
    const caco = make(Cacodemon, 'Cacodemon'); caco.arriveAt(rect);
    assert.ok(Math.abs(caco._x + caco._displayW / 2 - 700) < 1);
});

// ---------- Manager com host falso ----------
function manager(strv) {
    const views = [], portalViews = [];
    const pointer = { x: 10, y: 10 };
    const rects = new Map();
    const host = {
        sprites: {},
        imageUrl: () => 'x',
        createView: () => { const v = { destroy() { v.dead = true; } }; views.push(v); return v; },
        createProjectileView: () => ({ destroy() {} }),
        createPortalView: p => { const v = { x: p.x, y: p.y, destroy() { v.dead = true; } }; portalViews.push(v); return v; },
        pointer: () => pointer,
        windowRect: w => rects.get(w) ?? null,
        collectWindows: () => ({ windows: [], forceBackground: false, stack: [] }),
    };
    const m = new GnomeletManager(settings(strv), host);
    for (const n of ['Imp', 'Cacodemon', 'DoomSlayer']) m._resources[n] = { frames: frames(n), w: 144, h: 153 };
    m._portalGate.rng = () => 0; m._portalGate.chance = 1;
    return { m, portalViews, pointer, rects };
}

test('manager: janela nova solta um demônio efêmero com portal depois de ~6 ticks', () => {
    const { m, portalViews, rects } = manager();
    const win = {}; rects.set(win, { x: 200, y: 300, width: 900, height: 600 });
    m.onWindowAdded(win);
    for (let i = 0; i < 5; i++) m.tick();
    assert.equal(m.gnomelets.length, 0, 'ainda esperando o primeiro frame');
    m.tick(); m.tick();
    assert.equal(m.gnomelets.length, 1);
    const d = m.gnomelets[0];
    assert.ok(['Imp', 'Cacodemon'].includes(d._typeName) && d._ephemeral && d._portalTtl > 2000);
    assert.equal(portalViews.length, 1);
});

test('manager: janela que sumiu antes do primeiro frame ou pequena demais não abre portal', () => {
    const { m, rects } = manager();
    const gone = {}, tiny = {}; rects.set(tiny, { x: 0, y: 0, width: 100, height: 80 });
    m.onWindowAdded(gone); m.onWindowAdded(tiny);
    for (let i = 0; i < 10; i++) m.tick();
    assert.equal(m.gnomelets.length, 0);
});

test('manager: só solta tipos selecionados', () => {
    const { m, rects } = manager(['Custom']);
    const win = {}; rects.set(win, { x: 0, y: 0, width: 900, height: 600 });
    m.onWindowAdded(win);
    for (let i = 0; i < 10; i++) m.tick();
    assert.equal(m.gnomelets.length, 0);
});

test('manager: demônio de portal some no TTL, com portal de saída, sem renascer', () => {
    const { m, portalViews, rects } = manager();
    const win = {}; rects.set(win, { x: 200, y: 300, width: 900, height: 600 });
    m.onWindowAdded(win);
    for (let i = 0; i < 8; i++) m.tick();
    const d = m.gnomelets[0]; d._portalTtl = 2;
    m.tick(); m.tick();
    assert.equal(m.gnomelets.length, 0);
    assert.equal(m._demonQueue.length, 0);
    assert.equal(portalViews.length, 2);
    for (let i = 0; i < 20; i++) m.tick();
    assert.equal(m._portals.length, 0);
    assert.ok(portalViews.every(v => v.dead));
});

test('manager: janela fechando faz os próximos olharem; ponteiro parado é contado e repassado', () => {
    const { m, pointer } = manager();
    const near = make(Imp, 'Imp'); ground(near); near._x = 500; near._state = State.WALKING;
    const far = make(Imp, 'Imp'); ground(far); far._x = 1800; far._state = State.WALKING;
    m._gnomelets.push(near, far);
    m.onWindowGone({ x: 400, y: near._y - 100, width: 400, height: 300 });
    assert.equal(near._state, State.IDLE); assert.equal(far._state, State.WALKING);
    for (let i = 0; i < 30; i++) m.tick();
    assert.ok(near._pointer.still >= 29);
    pointer.x = 900; m.tick();
    assert.equal(near._pointer.still, 0);
});

test('manager: com a contagem alta do usuário (7 demônios já em cena) a janela nova ainda abre portal', () => {
    const { m, rects } = manager();
    for (let i = 0; i < 6; i++) m._gnomelets.push(make(Imp, 'Imp'));
    m._gnomelets.push(make(Cacodemon, 'Cacodemon'));
    assert.equal(m._gnomelets.length, 7);
    const win = {}; rects.set(win, { x: 200, y: 300, width: 900, height: 600 });
    m.onWindowAdded(win);
    for (let i = 0; i < 8; i++) m.tick();
    assert.equal(m._gnomelets.filter(g => g._ephemeral).length, 1, 'um demônio de portal');
});

test('manager: o teto vale só para demônios de portal (3), não para o total', () => {
    const { m, rects } = manager();
    m._portalGate.cooldown = 0;
    const win = {}; rects.set(win, { x: 200, y: 300, width: 900, height: 600 });
    for (let k = 0; k < 6; k++) { m.onWindowAdded(win); for (let i = 0; i < 7; i++) m.tick(); }
    assert.equal(m._gnomelets.filter(g => g._ephemeral).length, 3);
});

test('PortalGate explica por que não abriu (lastReason), para o log', async () => {
    const { PortalGate } = await import('../src/behavior.js');
    const g = new PortalGate({ chance: 0, maxActive: 1 }, () => 0.9);
    assert.equal(g.consider(0), null); assert.equal(g.lastReason, 'sem sorte');
    const h = new PortalGate({ chance: 1, maxActive: 1 }, () => 0);
    assert.equal(h.consider(1), null); assert.equal(h.lastReason, 'teto de demônios de portal');
    assert.equal(h.consider(0, () => false), null); assert.equal(h.lastReason, 'nenhum tipo disponível');
    assert.ok(h.consider(0)); assert.equal(h.consider(0), null); assert.equal(h.lastReason, 'intervalo');
});

test('manager (KWin): sem seleção usa os personagens padrão (e nunca o Slayer no sorteio)', () => {
    const { m } = manager([]);
    const types = new Set();
    for (let i = 0; i < 40; i++) types.add(m._pickResource().type);
    assert.deepEqual([...types].sort(), ['Cacodemon', 'Imp']);
});
