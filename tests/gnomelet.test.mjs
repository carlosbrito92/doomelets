// Roda as classes reais com o Shell simulado (ver tests/support).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calls } from './support/shell-stubs.mjs';
import { State } from '../src/utils.js';
import { Gnomelet } from '../src/gnomelet.js';
import { DoomSlayer } from '../src/characters/doom-slayer.js';
import { Imp } from '../src/characters/imp.js';
import { Cacodemon } from '../src/characters/cacodemon.js';
import { LostSoul } from '../src/characters/lost-soul.js';

const settings = {
    get_int: k => ({ 'gnomelet-scale': 64, 'jump-power': 40, 'spawn-offset': 0 })[k] ?? 0,
    get_boolean: () => false,
    get_string: k => (k === 'floor-z-order' ? 'allow' : 'on'),
};

/** Quadros falsos + o animations.json de verdade do personagem. */
function frames(name) {
    const f = Array.from({ length: 120 }, (_, i) => `frame-${i}`);
    f.animations = JSON.parse(fs.readFileSync(new URL(`../src/images/${name}/animations.json`, import.meta.url)));
    return f;
}
const make = (Cls, name) => new Cls(name, frames(name), 144, 153, settings, () => null, () => {});
const ground = (c) => { c._y = 1080 - c._displayH; c._vy = 0; };

test('base: movimento entre ticks desliza; salto grande posiciona direto', () => {
    const c = make(Gnomelet, 'Imp');
    calls.length = 0;
    c._x = 100; c._y = 500; c._placeActor();            // primeiro posicionamento do tick
    c._x = 103; c._y = 500; c._placeActor();            // passo pequeno
    assert.deepEqual(calls.at(-1), ['set_position', 103, 500, 'ease']);
    c._x = 900; c._placeActor();                        // salto > 48 px
    assert.deepEqual(calls.slice(-2), [['remove_all_transitions'], ['set_position', 900, 500, 'snap']]);
    c._placeActor(true);
    assert.equal(calls.at(-1)[3], 'snap');
});

test('Slayer parado: sorteia variação do manifesto (reload / look / respirar)', () => {
    const s = make(DoomSlayer, 'DoomSlayer'); ground(s);
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
        s._state = State.IDLE; s._idleTimer = 50; s._wasIdle = false; s._idleVariant = null;
        s._updateAnimation(); seen.add(s._animName);
        s._state = State.WALKING; s._updateAnimation();
    }
    assert.ok(seen.has('reload') && seen.has('look') && seen.has('idle'), [...seen].join());
});

test('pausa curta de combate (idleTimer < 20) não sorteia variação', () => {
    const s = make(DoomSlayer, 'DoomSlayer');
    for (let i = 0; i < 30; i++) {
        s._state = State.IDLE; s._idleTimer = 4; s._wasIdle = false; s._idleVariant = null;
        s._updateAnimation(); assert.equal(s._animName, 'idle');
        s._state = State.WALKING; s._updateAnimation();
    }
});

test('cursor perto de um personagem parado: ele vira para o cursor', () => {
    const s = make(DoomSlayer, 'DoomSlayer'); ground(s);
    s._state = State.IDLE; s._savedFacing = false;
    const cx = s._x + s._displayW / 2, cy = s._y + s._displayH / 2;
    for (let i = 0; i < 8; i++) s.observePointer(cx + 120, cy);
    assert.equal(s._savedFacing, true);
    for (let i = 0; i < 8; i++) s.observePointer(cx - 120, cy);   // dwell continua alto: troca de lado
    assert.equal(s._savedFacing, false);
});

test('Slayer encarado pelo cursor ~3 s toca "look"; Imp sem "taunt" no manifesto não faz nada', () => {
    const s = make(DoomSlayer, 'DoomSlayer'); ground(s);
    const imp = make(Imp, 'Imp'); ground(imp);
    for (const c of [s, imp]) { c._state = State.IDLE; c._idleTimer = 100; c._wasIdle = true; }
    const cx = s._x + s._displayW / 2, cy = s._y + s._displayH / 2;
    for (let i = 0; i < 70; i++) { s.observePointer(cx + 50, cy); imp.observePointer(imp._x + 10, imp._y + 10); }
    assert.equal(s._idleVariant, 'look');
    assert.equal(imp._idleVariant, null);
});

test('Cacodemon acompanha o cursor com viragem suave e mantém distância', () => {
    const c = make(Cacodemon, 'Cacodemon');
    c._state = State.FLOATING; c._floatSpeedX = -1.5; c._x = 500; c._velX = -1.5;
    const target = 1000;
    let prev = c._velX, maxStep = 0;
    for (let i = 0; i < 300; i++) {
        c.observePointer(target, c._y + 50);
        c.update([], false, null, [], []);
        maxStep = Math.max(maxStep, Math.abs(c._velX - prev)); prev = c._velX;
    }
    assert.ok(maxStep <= 0.1201, 'aceleração limitada: ' + maxStep);
    const dx = target - (c._x + c._displayW / 2);
    assert.ok(Math.abs(dx) >= 100 && Math.abs(dx) <= 400, 'ficou perto, sem sobrepor o cursor: ' + dx);
});

test('Cacodemon sem cursor por perto continua à deriva e rebate nas bordas', () => {
    const c = make(Cacodemon, 'Cacodemon');
    c._state = State.FLOATING; c._floatSpeedX = 1.5; c._velX = 1.5; c._x = 1900;
    for (let i = 0; i < 200; i++) { c.observePointer(-5000, -5000); c.update([], false, null, [], []); }
    assert.ok(c._floatSpeedX < 0 && c._x < 1900);
});

// ---------- cenas e eventos de janela ----------
import { GnomeletManager } from '../src/manager.js';
import { guardMove } from '../src/behavior.js';

test('Imp com pouca vida foge do Slayer (corre para longe) e com vida cheia luta', () => {
    const imp = make(Imp, 'Imp'); ground(imp); imp._x = 800;
    const slayer = make(DoomSlayer, 'DoomSlayer'); ground(slayer); slayer._x = 600;
    imp._allEntities = [slayer, imp];
    imp._hp = 1; imp._pickNewAction();
    assert.equal(imp._state, State.CHASING);
    assert.ok(imp._vx > 0, 'foge para a direita, longe do Slayer à esquerda');
    imp._hp = 3; imp._pickNewAction();
    assert.equal(imp._fleeing, false);
});

test('Slayer com o cursor parado ~30 s anda até ele e fica de guarda olhando para ele', () => {
    const s = make(DoomSlayer, 'DoomSlayer'); ground(s); s._x = 100;
    s._allEntities = [s];
    s._pointer = { x: 1200, y: 900, dist: 1000, level: 0, still: 700 };
    s._pickNewAction();
    assert.equal(s._state, State.WALKING); assert.ok(s._vx > 0); assert.equal(s._guarding, true);
    s._x = 1150;                                         // chegou (a menos de 140 px do centro)
    s._x = 1200 - s._displayW / 2 - 50;
    s._pickNewAction();
    assert.equal(s._state, State.IDLE); assert.equal(s._savedFacing, true);
    s._pointer.still = 5;                                // mexeu o mouse: volta ao normal
    s._pickNewAction();
    assert.equal(s._guarding, false);
});

test('notice: personagem andando para, vira para o evento e fica parado um instante', () => {
    const imp = make(Imp, 'Imp'); ground(imp); imp._x = 500;
    imp._state = State.WALKING; imp._vx = -4; imp._savedFacing = false;
    assert.equal(imp.notice(1500, 400), true);
    assert.equal(imp._state, State.IDLE); assert.equal(imp._vx, 0); assert.equal(imp._savedFacing, true);
    assert.ok(imp._idleTimer >= 30);
    imp._state = State.THROWING;                         // em combate: ignora
    assert.equal(imp.notice(0, 0), false);
});

test('notice: Slayer toca "look" se o manifesto tiver', () => {
    const s = make(DoomSlayer, 'DoomSlayer'); ground(s); s._state = State.WALKING;
    s.notice(1500, 400);
    assert.equal(s._idleVariant, 'look');
});

test('arriveAt: Imp pousa no topo da janela; Cacodemon surge flutuando sobre ela', () => {
    const rect = { x: 300, y: 400, width: 800, height: 500 };
    const imp = make(Imp, 'Imp');
    const at = imp.arriveAt(rect);
    assert.equal(imp._state, State.SPAWNING);
    assert.equal(imp._y + imp._displayH, 400);           // pés na borda superior
    assert.ok(imp._x >= 300 && imp._x <= 1100);
    assert.ok(at.x > 300 && at.y < 400);
    const caco = make(Cacodemon, 'Cacodemon');
    caco.arriveAt(rect);
    assert.equal(caco._state, State.SPAWNING);
    assert.ok(Math.abs(caco._x + caco._displayW / 2 - 700) < 1);
});

function manager(strv = ['Imp', 'Cacodemon', 'DoomSlayer'], rng = () => 0) {
    const st = { ...settings, get_strv: () => strv };
    const m = new GnomeletManager(st);
    m._isPaused = false;
    for (const n of ['Imp', 'Cacodemon', 'DoomSlayer']) {
        const f = frames(n); m._resources[n] = { frames: f, w: 144, h: 153 };
    }
    m._portalGate.rng = rng; m._portalGate.chance = 1;
    return m;
}

test('manager: janela nova solta um demônio efêmero com portal; o portão respeita intervalo e teto', () => {
    const m = manager();
    const rect = { x: 200, y: 300, width: 900, height: 600 };
    const d = m._portalDemon(rect);
    assert.ok(d && ['Imp', 'Cacodemon'].includes(d._typeName));
    assert.equal(d._ephemeral, true); assert.equal(d._portalTtl, 2400);
    assert.equal(m._portals.length, 1); assert.equal(m._gnomelets.length, 1);
    assert.equal(m._portalDemon(rect), null, 'em intervalo');
});

test('manager: não solta demônio que o usuário não selecionou', () => {
    const m = manager(['Custom'], () => 0);
    assert.equal(m._portalDemon({ x: 0, y: 0, width: 900, height: 600 }), null);
    assert.equal(m._gnomelets.length, 0);
});

test('manager: demônio de portal some depois do TTL, com portal de saída e sem renascer', () => {
    const m = manager();
    const d = m._portalDemon({ x: 200, y: 300, width: 900, height: 600 });
    d._portalTtl = 2;
    m._updateEphemeral(); assert.equal(d._markedForRemoval, false);
    m._updateEphemeral(); assert.equal(d._markedForRemoval, true);
    assert.equal(m._portals.length, 2);                  // entrada + saída
    for (let i = 0; i < 20; i++) m._updatePortals();     // os portais terminam
    assert.equal(m._portals.length, 0);
    assert.equal(m._demonQueue.length, 0);
});

test('manager: evento de janela faz os próximos olharem, os distantes não', () => {
    const m = manager();
    const near = make(Imp, 'Imp'); ground(near); near._x = 500; near._state = State.WALKING;
    const far = make(Imp, 'Imp'); ground(far); far._x = 1800; far._state = State.WALKING;
    m._gnomelets.push(near, far);
    m._noticeAround(600, near._y);
    assert.equal(near._state, State.IDLE);
    assert.equal(far._state, State.WALKING);
});

test('manager (GNOME): com 7 demônios já em cena (contagem do usuário) ainda abre portal; teto de 3 só para os de portal', () => {
    const m = manager();
    for (let i = 0; i < 6; i++) m._gnomelets.push(make(Imp, 'Imp'));
    m._gnomelets.push(make(Cacodemon, 'Cacodemon'));
    m._portalGate.cooldown = 0;
    const rect = { x: 200, y: 300, width: 900, height: 600 };
    for (let k = 0; k < 6; k++) m._portalDemon(rect);
    assert.equal(m._gnomelets.filter(g => g._ephemeral).length, 3);
});

test('manager (GNOME): sem seleção salva usa os personagens padrão (e nunca o Slayer no sorteio)', () => {
    const m = manager([]);
    const types = new Set();
    for (let i = 0; i < 40; i++) types.add(m._pickResource().type);
    assert.deepEqual([...types].sort(), ['Cacodemon', 'Imp']);
});

test('Lost Soul flutua como o Cacodemon, mas é inofensiva: sem vida, sem atirar, e olha para onde vai', () => {
    const ls = make(LostSoul, 'LostSoul');
    const slayer = make(DoomSlayer, 'DoomSlayer'); ground(slayer); slayer._x = ls._x + 20; slayer._y = ls._y;
    for (let i = 0; i < 400; i++) {
        ls.update([], false, null, [slayer, ls]);
        assert.notEqual(ls._state, State.SHOOTING);
    }
    assert.equal(ls._maxHp, 0);
    assert.equal(ls._state, State.FLOATING);
    ls.takeDamage(5); assert.equal(ls._isDead, false);
    ls._velX = -2; assert.equal(ls.facingRight, false);
    ls._velX = 2; assert.equal(ls.facingRight, true);
});
