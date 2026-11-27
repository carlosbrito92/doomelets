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
