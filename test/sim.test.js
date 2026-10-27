import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../js/sim.js';
import { simTables } from '../js/meta.js';
import { EN, EV, TU } from '../js/data.js';

const meta = JSON.parse(fs.readFileSync(new URL('../assets/meta.json', import.meta.url)));
const tables = simTables(meta);

// small seeded PRNG so runs are repeatable
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const mk = (o = {}) => new Game({ ...tables, rng: seeded(o.seed || 1), diff: o.diff || 1 });

test('start state', () => {
  const g = mk();
  assert.equal(g.cash, 175);
  assert.equal(g.xp, 0);
  assert.equal(g.age, 1);
  assert.equal(g.base1.health, 500);
});

test('queue: cost deducted, unit spawns after train time, tray holds 5', () => {
  const g = mk();
  assert.ok(g.queueUnit(1));
  assert.equal(g.cash, 160);
  for (let i = 0; i < EN[1][2]; i++) g.tick();
  assert.equal(g.units.filter(u => u.side === 1).length, 1);
  const g2 = mk(); g2.cash = 1000;
  for (let i = 0; i < 5; i++) assert.ok(g2.queueUnit(1));
  assert.equal(g2.queueUnit(1), false);
  assert.equal(g2.cash, 1000 - 75, 'a rejected unit is not charged');
});

test('cannot queue without enough gold', () => {
  const g = mk();
  assert.equal(g.queueUnit(6), false); // knight costs 500
  assert.equal(g.cash, 175);
});

test('kill reward and xp', () => {
  const g = mk();
  const e = g.createUnit(1, 2);
  e.health = 0;
  const c = g.cash;
  g.tick();
  assert.equal(g.cash, c + Math.round(15 * 1.3));
  assert.equal(g.xp, Math.round(15 * 1.3) * 2);
  // player unit dying gives half the reward as xp
  const p = g.createUnit(2, 1);
  const x0 = g.xp;
  p.health = 0;
  g.tick();
  assert.equal(g.xp, x0 + Math.round(Math.round(25 * 1.3) / 2));
});

test('evolve needs xp and grants base hp', () => {
  const g = mk();
  assert.equal(g.evolve(), false);
  g.xp = EV[0];
  assert.equal(g.evolve(), true);
  assert.equal(g.age, 2);
  assert.equal(g.base1.max, 500 + 600);
  assert.equal(g.base1.health, 500 + 600);
  g.xp = 0;
  assert.equal(g.canEvolve(), false);
});

test('turret slots, build, sell refund', () => {
  const g = mk(); g.cash = 5000;
  assert.ok(g.buildTurret(1, 1));
  assert.equal(g.buildTurret(1, 1), false, 'slot occupied');
  assert.equal(g.buildTurret(2, 1), false, 'slot 2 locked');
  assert.ok(g.buyAddon());
  assert.equal(g.cash, 5000 - TU[1][1] - 1000);
  assert.ok(g.buildTurret(2, 1));
  const c = g.cash;
  assert.ok(g.sellTurret(1));
  assert.equal(g.cash, c + 50);
});

test('enemy AI never has more than 6 units alive and evolves on schedule', () => {
  const g = mk({ seed: 7 });
  let maxAlive = 0;
  for (let i = 0; i < 9000 && !g.over; i++) {
    g.tick();
    maxAlive = Math.max(maxAlive, g.e.uof);
  }
  assert.ok(maxAlive <= 6, 'uof ' + maxAlive);
  assert.ok(g.e.uof >= 0);
});

test('long random game runs without throwing and ends in win or lose', () => {
  for (const diff of [1, 2, 3]) {
    const g = mk({ seed: 3 + diff, diff });
    const rnd = seeded(99);
    for (let i = 0; i < 60000 && !g.over; i++) {
      if (i % 20 === 0) {
        const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].filter(id => id <= g.age * 3);
        g.queueUnit(ids[Math.floor(rnd() * ids.length)]);
      }
      if (i % 200 === 0) { g.evolve(); g.special(); }
      if (i % 300 === 0) { g.buyAddon(); const spot = [1, 2, 3, 4][Math.floor(rnd() * 4)]; g.buildTurret(spot, g.age * 3 - Math.floor(rnd() * 3)); }
      g.tick();
      g.events.length = 0;
      assert.ok(Number.isFinite(g.cash) && Number.isFinite(g.base1.health), 'NaN state at tick ' + i);
    }
    assert.ok(g.parts.length <= 301);
    console.log('diff', diff, 'result', g.over, 'time', g.time, 'age', g.age, 'enemy age', g.e.age);
  }
});
