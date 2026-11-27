import test from 'node:test';
import assert from 'node:assert/strict';
import { needsSnap, facingToward, steerToward, IdleScheduler, Curiosity } from '../src/behavior.js';

// rng determinístico: devolve os valores dados em sequência
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('needsSnap: só teleportes passam do limite', () => {
    assert.equal(needsSnap(3, 4, 48), false);
    assert.equal(needsSnap(40, 40, 48), true);   // ~56,6
    assert.equal(needsSnap(0, -49, 48), true);
});

test('facingToward: direita, esquerda e alinhado', () => {
    assert.equal(facingToward(10, 20), true);
    assert.equal(facingToward(20, 10), false);
    assert.equal(facingToward(10, 10, false), false);
});

test('steerToward: respeita a aceleração e chega ao alvo', () => {
    assert.equal(steerToward(0, 2, 0.5), 0.5);
    assert.equal(steerToward(1.8, 2, 0.5), 2);
    assert.equal(steerToward(1, -1, 0.5), 0.5);
    let v = 3; for (let i = 0; i < 20; i++) v = steerToward(v, 0, 0.25);
    assert.equal(v, 0);
});

test('IdleScheduler: sem variações devolve null', () => {
    assert.equal(new IdleScheduler([]).pick(), null);
});

test('IdleScheduler: pesos iguais reproduzem o sorteio uniforme antigo do Slayer', () => {
    const v = [{ name: 'reload' }, { name: 'look' }, { name: null }];
    const s = new IdleScheduler(v, seq(0.0, 0.34, 0.67, 0.99));
    assert.deepEqual([s.pick(), s.pick(), s.pick(), s.pick()], ['reload', 'look', null, null]);
});

test('IdleScheduler: ignora variações cujo quadro não existe', () => {
    const v = [{ name: 'taunt', weight: 100 }, { name: null, weight: 1 }];
    const s = new IdleScheduler(v, seq(0.5));
    assert.equal(s.pick(n => n !== 'taunt'), null);
    assert.equal(s.pick(() => true), 'taunt');
});

test('IdleScheduler: cooldown impede repetir a mesma variação', () => {
    const v = [{ name: 'yawn', weight: 1, cooldown: 100 }, { name: null, weight: 1 }];
    const s = new IdleScheduler(v, seq(0.0));          // sempre sorteia o primeiro
    assert.equal(s.pick(), 'yawn');
    assert.equal(s.pick(), null);                       // em cooldown: só sobra "respirar"
    for (let i = 0; i < 100; i++) s.tick();
    assert.equal(s.pick(), 'yawn');
});

test('IdleScheduler: pesos desiguais pendem para o mais pesado', () => {
    const v = [{ name: 'a', weight: 9 }, { name: 'b', weight: 1 }];
    let r = 12345; const rng = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
    const s = new IdleScheduler(v, rng); const n = { a: 0, b: 0 };
    for (let i = 0; i < 2000; i++) n[s.pick()]++;
    assert.ok(n.a > n.b * 6, JSON.stringify(n));
});

test('Curiosity: nota depois de poucos ticks e encara depois de muitos', () => {
    const c = new Curiosity({ range: 200, noticeTicks: 3, stareTicks: 10, decay: 2 });
    assert.equal(c.update(500), 0);
    assert.equal(c.update(100), 0); assert.equal(c.update(100), 0);
    assert.equal(c.update(100), 1);
    for (let i = 0; i < 6; i++) c.update(100);
    assert.equal(c.update(100), 2);
});

test('Curiosity: ao se afastar decai devagar e volta a 0', () => {
    const c = new Curiosity({ range: 200, noticeTicks: 3, stareTicks: 10, decay: 2 });
    for (let i = 0; i < 12; i++) c.update(100);
    assert.equal(c.level, 2);
    c.update(900); assert.equal(c.level, 2);            // 12 -> 10 ainda encara
    c.update(900); assert.equal(c.level, 1);
    for (let i = 0; i < 10; i++) c.update(900);
    assert.equal(c.level, 0);
});
