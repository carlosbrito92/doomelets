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

import { PointerTracker, PortalGate, fleeDirection, guardMove } from '../src/behavior.js';

test('PointerTracker: conta ticks parado e zera ao mexer', () => {
    const t = new PointerTracker();
    assert.equal(t.update(100, 100), 0);
    assert.equal(t.update(101, 100), 1);          // dentro da tolerância
    assert.equal(t.update(100, 101), 2);
    assert.equal(t.update(300, 100), 0);          // moveu
});

test('PortalGate: intervalo, teto de demônios, chance e disponibilidade', () => {
    const g = new PortalGate({ cooldown: 3, chance: 1, maxActive: 2, weights: { Imp: 1, Cacodemon: 1 } }, seq(0.0, 0.0, 0.0));
    assert.equal(g.consider(0), 'Imp');
    assert.equal(g.consider(0), null);            // em intervalo
    g.tick(); g.tick(); g.tick();
    assert.equal(g.consider(2), null);            // teto atingido
    assert.equal(g.consider(1, n => n === 'Cacodemon'), 'Cacodemon');   // só o disponível
    const none = new PortalGate({ chance: 0 });
    assert.equal(none.consider(0), null);
});

test('PortalGate: sem nada disponível não abre portal', () => {
    assert.equal(new PortalGate({ chance: 1 }, seq(0)).consider(0, () => false), null);
});

test('fleeDirection: só com pouca vida, longe da borda e dentro do raio', () => {
    const base = { maxHp: 3, selfX: 800, threatX: 600, dist: 200, screenW: 1920 };
    assert.equal(fleeDirection({ ...base, hp: 3 }), 0);          // saudável: luta
    assert.equal(fleeDirection({ ...base, hp: 1 }), 1);          // ameaça à esquerda: foge para a direita
    assert.equal(fleeDirection({ ...base, hp: 1, threatX: 1000 }), -1);
    assert.equal(fleeDirection({ ...base, hp: 1, dist: 400 }), 0);                  // fora do raio
    assert.equal(fleeDirection({ ...base, hp: 1, dist: 400, fleeing: true }), 1);   // histerese
    assert.equal(fleeDirection({ ...base, hp: 1, selfX: 1900 }), 0);                // encurralado
    assert.equal(fleeDirection({ ...base, hp: 0 }), 0);
});

test('guardMove: só depois de muito tempo parado; chega e fica', () => {
    assert.deepEqual(guardMove({ still: 100, selfX: 0, pointerX: 900 }), { guarding: false, dir: 0 });
    assert.deepEqual(guardMove({ still: 600, selfX: 0, pointerX: 900 }), { guarding: true, dir: 1 });
    assert.deepEqual(guardMove({ still: 600, selfX: 1000, pointerX: 900 }), { guarding: true, dir: 0 });
    assert.deepEqual(guardMove({ still: 900, selfX: 900, pointerX: 100 }), { guarding: true, dir: -1 });
});
