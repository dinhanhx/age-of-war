// DOM-free game simulation, a port of the original Flash (AS2) logic. One tick = one Flash frame (40 Hz).
// Rendering reads the public arrays: units, bullets, parts, turrets, beams, planes. Events go to `events`.
import {
  EN, TU, TS, ES, EV, TURRET_ANIM, ADDON_COST, SPECIAL_COOLDOWN, WORLD, ENEMY_TURRETS,
} from './data.js';

const DEG = Math.PI / 180;
const GROUND = WORLD.groundY;

// particle kinds
export const P = { BLOOD: 1, DUST: 2, CHIP: 3, SHRAPNEL: 4, FIRE: 5, BOOM_S: 6, BOOM_L: 7, TEXT: 8, BIT: 9 };

export class Game {
  /**
   * @param {object} o
   * @param {number} o.diff 1 normal, 2 harder (x1.3), 3 impossible (x2) - enemy hp/damage multiplier
   * @param {object} o.anims anims[unitId][state] = { n, hit: [[frame,'m'|'r'],...] }
   * @param {object} o.hitzone hitzone[unitId] = [width, height]
   * @param {() => number} [o.rng]
   */
  constructor({ diff = 1, anims, hitzone, rng = Math.random }) {
    this.diff = diff;
    this.anims = anims;
    this.hitzone = hitzone;
    this.rng = rng;
    this.events = [];
    this.over = null; // 'win' | 'lose'
    this.time = 0;

    this.cash = WORLD.startCash;
    this.xp = 0;
    this.age = 1;
    this.addons = 0;                 // extra turret slots bought (0..3)
    this.specialTimer = 1999;
    this.specialHeal = 0;            // frames of healing aura left
    this.shake = 0;                  // screen shake amplitude (render only)

    // training queue: tray[0] is in training
    this.tray = [0, 0, 0, 0, 0];
    this.trainTimer = -1;
    this.trainTotal = 0;

    this.uidCounter = 1;
    this.base1 = { kind: 'base', side: 1, x: WORLD.baseHit[1].x, hzW: WORLD.baseHit[1].w, hzH: 77, health: WORLD.baseHp, max: WORLD.baseHp, dead: false, uid: 0 };
    this.base2 = { kind: 'base', side: 2, x: WORLD.baseHit[2].x, hzW: WORLD.baseHit[2].w, hzH: 77, health: WORLD.baseHp, max: WORLD.baseHp, dead: false, uid: 0 };
    // `targets` mirrors the original _root.ennemies list (bases first, then live units)
    this.targets = [this.base1, this.base2];
    this.units = [];
    this.bullets = [];
    this.parts = [];
    this.turrets = [];              // both sides
    this.spots1 = [null, null, null, null];
    this.spots2 = [null, null, null, null];
    this.beams = [];                // special 5 flashes {x, life}
    this.planes = [];               // special 4 bombers {x}
    this.emitters = [];             // special 1/2 meteor emitters

    // enemy AI state (base_comp)
    this.e = {
      age: 1, addons: 0, techTimer: 0, unitLevel: 1, timer: 0, uTimer: -1, uTotal: 0,
      uof: 0, willCreate: 0, checkAction: false, action: 0,
    };

    this._unitPool = [];
    this._bulletPool = [];
    this._partPool = [];
  }

  // ---- helpers -------------------------------------------------------------------------------
  rand(n) { return Math.floor(this.rng() * n); }
  emit(ev) { this.events.push(ev); }

  // ---- player commands -------------------------------------------------------------------------
  /** Queue a unit for training. Returns true if accepted. */
  queueUnit(id) {
    if (this.over || !EN[id]) return false;
    const cost = EN[id][1];
    if (this.cash < cost) return false;
    const free = this.tray.indexOf(0);
    if (free < 0) return false; // original refunds when the tray is full; here we never charge
    this.cash -= cost;
    this.tray[free] = id;
    if (free === 0) this._startTraining(id);
    this.emit('queue');
    return true;
  }

  _startTraining(id) {
    if (this.trainTotal === 0) {
      this.trainTimer = EN[id][2];
      this.trainTotal = EN[id][2];
    }
  }

  /** Free turret slots for the player (slot index 0..3 usable up to addons). */
  slotUsable(spot) { return spot >= 1 && spot <= this.addons + 1 && !this.spots1[spot - 1]; }

  buildTurret(spot, id) {
    if (this.over || !TU[id] || this.cash < TU[id][1] || !this.slotUsable(spot)) return false;
    this.cash -= TU[id][1];
    this._placeTurret(1, spot, id);
    this.emit('build');
    return true;
  }

  sellTurret(spot) {
    const t = this.spots1[spot - 1];
    if (this.over || !t) return false;
    this.cash += Math.round(TU[t.id][1] / 2);
    this._removeTurret(t);
    this.emit('sell');
    return true;
  }

  addonCost() { return this.addons >= 3 ? 0 : ADDON_COST[this.addons]; }

  buyAddon() {
    if (this.over || this.addons >= 3 || this.cash < ADDON_COST[this.addons]) return false;
    this.cash -= ADDON_COST[this.addons];
    this.addons++;
    this.emit('build');
    return true;
  }

  evolveCost() { return this.age < 5 ? EV[this.age - 1] : 0; }

  canEvolve() { return this.age < 5 && this.xp >= EV[this.age - 1]; }

  evolve() {
    if (this.over || !this.canEvolve()) return false;
    this.age++;
    this.base1.max += 300 * this.age;
    this.base1.health += 300 * this.age;
    this.emit('evolve');
    return true;
  }

  specialReady() { return this.specialTimer >= SPECIAL_COOLDOWN; }

  special() {
    if (this.over || !this.specialReady()) return false;
    this.specialTimer = 0;
    const a = this.age;
    if (a === 1 || a === 2) this.emitters.push({ kind: a, timer: 200, cc: 0 });
    else if (a === 3) this.specialHeal = 600;
    else if (a === 4) this.planes.push({ x: -100, cc: 0 });
    else this.beams.push({ x: 150, cc: 0, step: true, flashes: [] });
    this.emit('special');
    return true;
  }

  // ---- unit / turret creation -------------------------------------------------------------------
  createUnit(id, side) {
    const u = this._unitPool.pop() || { kind: 'unit' };
    const es = ES[id];
    u.side = side; u.id = id; u.uid = this.uidCounter++;
    u.x = (side === 1 ? WORLD.base1X : WORLD.base2X) + this.rng();
    u.speed = side === 1 ? 0.7 : -0.7;
    u.closestDist = side === 1 ? 300 : -300;
    u.ed = u.closestDist;
    u.edTarget = null; u.edUid = 0;
    u.limit = 100;
    u.c = 3;
    let m = 1;
    if (side === 2) m = this.diff === 2 ? 1.3 : this.diff === 3 ? 2 : 1;
    u.health = es[0] * m; u.max = u.health;
    u.damage = es[1] * m; u.rdamage = es[2] * m;
    u.rangeMelee = es[3]; u.rangeShoot = es[4];
    u.reward = Math.round(EN[id][1] * 1.3);
    u.hzW = this.hitzone[id][0]; u.hzH = this.hitzone[id][1];
    u.dead = false; u.dc = 0;
    u.moving = false; u.state = 'idle'; u.frame = 1;
    this.units.push(u);
    this.targets.push(u);
    this.emit(side === 1 ? 'spawn' : 'espawn');
    return u;
  }

  _placeTurret(side, spot, id) {
    const arr = side === 1 ? this.spots1 : this.spots2;
    const t = {
      side, spot, id,
      x: side === 1 ? WORLD.turretX : WORLD.base2Origin - WORLD.turretX,
      y: GROUND + WORLD.slotY[spot - 1],
      rot: side === 2 ? -180 : 0,
      c: 0, ed: 100000, edTarget: null, edUid: 0, edH: 0, st: 0,
      playing: false, af: 1, kick: 0,
    };
    arr[spot - 1] = t;
    this.turrets.push(t);
  }

  _removeTurret(t) {
    (t.side === 1 ? this.spots1 : this.spots2)[t.spot - 1] = null;
    const i = this.turrets.indexOf(t);
    if (i >= 0) this.turrets.splice(i, 1);
  }

  // ---- main tick ----------------------------------------------------------------------------------
  tick() {
    if (this.over) return;
    this.time++;
    this._trainTick();
    this._enemyAI();
    for (let i = 0; i < this.units.length; i++) this._unitTick(this.units[i]);
    for (let i = this.turrets.length - 1; i >= 0; i--) this._turretTick(this.turrets[i]);
    this._bulletsTick();
    this._partsTick();
    this._specialsTick();
    if (this.specialTimer < SPECIAL_COOLDOWN) this.specialTimer++;
    // remove dead units that finished lying around (iterate backwards, swap-remove keeps creation order stable enough)
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].dc > 80) {
        const u = this.units[i];
        this.units.splice(i, 1);
        this._unitPool.push(u);
      }
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.25);
    // win / lose checks (original: round(health) < 0)
    if (Math.round(this.base1.health) < 0) { this.over = 'lose'; this.emit('lose'); }
    else if (Math.round(this.base2.health) < 0) { this.over = 'win'; this.emit('win'); }
  }

  _trainTick() {
    if (this.trainTimer > 0) {
      this.trainTimer--;
      if (this.trainTimer === 0) {
        this.createUnit(this.tray[0], 1);
        this.trainTotal = 0;
        this.trainTimer = -1;
        this.tray.copyWithin(0, 1);
        this.tray[4] = 0;
        if (this.tray[0] !== 0) this._startTraining(this.tray[0]);
      }
    }
  }

  // ---- enemy AI (base_comp/DoAction.as) ------------------------------------------------------------
  _enemyAI() {
    const e = this.e;
    e.techTimer++;
    if (e.unitLevel === 1) { if (e.techTimer === 1500) e.unitLevel++; }
    else if (e.unitLevel === 2) { if (e.techTimer === 5000) e.unitLevel++; }
    if (e.techTimer === 8000 && e.age !== 5) {
      e.age++;
      this.base2.health += 300 * e.age;
      this.base2.max += 300 * e.age;
      e.unitLevel = 1;
      e.techTimer = 0;
    }
    const sched = ENEMY_TURRETS[e.age] && ENEMY_TURRETS[e.age][e.techTimer];
    if (sched) {
      for (const a of sched) {
        if (a[0] === 'a') e.addons = a[1];
        else if (a[0] === 's') { const t = this.spots2[a[1] - 1]; if (t) this._removeTurret(t); }
        else if (a[0] === 'c' && !this.spots2[a[1] - 1]) this._placeTurret(2, a[1], a[2]);
      }
    }
    e.timer++;
    if (e.timer === 40) {
      e.action = this.rng() < 0.3 ? 1 : 3;
      e.timer = 0;
      e.checkAction = true;
    }
    if (e.checkAction && e.action === 1 && e.uTimer < -5 && e.uof < 6) {
      let t = this.rand(e.unitLevel) + 1;
      t += (e.age - 1) * 3;
      e.willCreate = t;
      e.uTimer = EN[t][2];
      e.uTotal = EN[t][2];
      e.uof++;
      e.checkAction = false;
    }
    if (e.uTimer === 0) this.createUnit(e.willCreate, 2);
    e.uTimer--;
  }

  // ---- units (ennemy/DoAction.as) -----------------------------------------------------------------
  _unitTick(u) {
    if (u.health > 0) {
      if (this.specialHeal > 0 && u.side === 1 && u.health < u.max) u.health++;
      if (Math.abs(u.closestDist) > u.limit) { u.x += u.speed; u.moving = true; } else u.moving = false;
      let melee = false, range = false;
      const aed = Math.abs(u.ed);
      if (aed < u.rangeMelee) melee = true;
      else if (aed < u.rangeShoot) range = true;
      let st = u.state;
      if (!melee && !u.moving && !range) st = 'idle';
      else if (melee && !u.moving) st = 'attack';
      else if (range && u.moving) st = 'shootwalk';
      else if (range && !u.moving) st = 'shoot';
      else if (!melee && u.moving && !range) st = 'walk';
      this._advanceAnim(u, st);
      if (--u.c === 0) { this._scan(u); u.c = 5; }
    } else {
      if (!u.dead) this._killUnit(u);
      this._advanceAnim(u, 'die');
      u.dc++;
    }
  }

  _advanceAnim(u, st) {
    const clip = this.anims[u.id][st] || this.anims[u.id].idle;
    if (st !== u.state) {
      u.state = st;
      u.frame = 1;
      this._animHit(u, clip, 1);
    } else if (st === 'die') {
      if (u.frame < clip.n) u.frame++;
    } else {
      u.frame = u.frame >= clip.n ? 1 : u.frame + 1;
      this._animHit(u, clip, u.frame);
    }
  }

  _animHit(u, clip, f) {
    if (!clip.hit || u.dead) return;
    for (let i = 0; i < clip.hit.length; i++) {
      if (clip.hit[i][0] !== f) continue;
      const t = u.edTarget;
      if (!t || t.uid !== u.edUid || t.dead) return;
      const ranged = clip.hit[i][1] === 'r';
      t.health -= (ranged ? u.rdamage : u.damage) - this.rng() * 2;
      if (t.kind === 'unit') this._blood(t.x, GROUND - t.hzH / 1.5, 5);
      this.emit((ranged ? 'shoot' : 'hit') + u.id);
    }
  }

  _scan(u) {
    const side = u.side;
    u.edTarget = null; u.edUid = 0;
    u.closestDist = side === 1 ? 300 : -300;
    u.ed = u.closestDist;
    const ts = this.targets;
    for (let a = ts.length - 1; a >= 0; a--) {
      const t = ts[a];
      const dist = t.x - u.x;
      if (side === 1) {
        if (dist > 0) {
          if (u.closestDist > dist) { u.closestDist = dist; u.limit = u.hzW / 2 + t.hzW / 2 + 2; }
          if (t.side !== side && u.ed > dist - t.hzW / 2) { u.ed = dist - t.hzW / 2; u.edTarget = t; u.edUid = t.uid; }
        }
      } else if (dist < 0) {
        if (u.closestDist < dist) { u.closestDist = dist; u.limit = u.hzW / 2 + t.hzW / 2 + 2; }
        if (t.side !== side && u.ed < dist + t.hzW / 2) { u.ed = dist + t.hzW / 2; u.edTarget = t; u.edUid = t.uid; }
      }
    }
  }

  _killUnit(u) {
    const i = this.targets.indexOf(u);
    if (i >= 0) this.targets.splice(i, 1);
    if (u.side === 2) {
      this.e.uof--;
      this.cash += u.reward;
      this.xp += u.reward * 2;
      this._text(u.x, GROUND - u.hzH, '+ ' + u.reward);
    } else {
      this.xp += Math.round(u.reward / 2);
    }
    this._blood(u.x, GROUND - u.hzH / 1.5, 9);
    u.dead = true;
    this.emit('die');
  }

  // ---- turrets (turret/DoAction.as) ---------------------------------------------------------------
  _turretTick(t) {
    const ts = TS[t.id];
    if (++t.c === 10) {
      t.ed = 100000;
      const arr = this.targets;
      for (let a = arr.length - 1; a >= 0; a--) {
        const o = arr[a];
        if (o.side === t.side) continue;
        const dx = o.x - t.x, dy = GROUND - t.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (t.ed > d) { t.ed = d; t.edTarget = o; t.edUid = o.uid; t.edH = o.hzH; }
      }
      t.c = 0;
    }
    if (t.edTarget && t.edTarget.uid !== t.edUid) { t.edTarget = null; t.ed = 100000; }
    if (t.ed < ts[3] && t.edTarget) {
      if (t.id !== 6) {
        const tx = t.edTarget.x, ty = GROUND - t.edH / 1.3;
        t.rot = Math.round(Math.atan2(ty - t.y, tx - t.x) / DEG);
      }
      if (++t.st >= ts[0]) {
        if (!t.playing) { t.playing = true; t.af = 1; }
        t.st = 0;
      }
    }
    if (t.playing) {
      const an = TURRET_ANIM[t.id];
      t.af++;
      if (an.fire.indexOf(t.af) >= 0) this._shoot(t);
      if (t.af >= an.len) { t.playing = false; t.af = 1; }
    }
    if (t.kick > 0) t.kick--;
  }

  _shoot(t) {
    const ts = TS[t.id];
    this._createBullet(t.x, t.y, t.rot, ts[2], ts[1], t.side);
    t.kick = 6;
    this.emit('turret' + ts[1]);
  }

  // ---- bullets (bulletN/DoAction.as) --------------------------------------------------------------
  _newBullet() { return this._bulletPool.pop() || {}; }

  _createBullet(x, y, rot, dmg, type, side) {
    const b = this._newBullet();
    b.type = type; b.side = side; b.dmg = dmg; b.rot = rot; b.x = x; b.y = y;
    b.g = 0; b.gf = 0.05; b.rotS = 0; b.sub = 1; b.acc = 1; b.cap = 0; b.life = 600; b.kind = 0;
    b.scale = 1;
    const s = Math.sin(rot * DEG), c = Math.cos(rot * DEG);
    switch (type) {
      case 1: b.xs = 7 * c; b.ys = 7 * s; b.x += b.xs * 5; b.y += b.ys * 5; b.rotS = 2; break;
      case 2: b.xs = 7 * c; b.ys = 7 * s; b.x += b.xs * 4; b.y += b.ys * 4; b.rotS = this.rand(6) - 3; break;
      case 3: case 4:
        b.xs = 7 * c; b.ys = 7 * s;
        b.y += side === 1 ? -b.xs * 5 : b.xs * 5;
        b.rotS = type === 3 ? 2 : 6; break;
      case 5: // oil: a burst of burning drops in front of the turret
        b.kind = 1; b.x += side === 1 ? 116 : -116; b.y += 7; b.life = 40; b.cc = 0; break;
      case 6: case 7: case 8:
        b.xs = 7 * c; b.ys = 7 * s; b.x += b.xs * 5; b.y += b.ys * 5; b.gf = 0.02; b.sub = 4; break;
      case 9:
        b.xs = 0.2 * c; b.ys = 0.2 * s; b.x += b.xs * 200; b.y += b.ys * 200; b.acc = 1.01; b.sub = 8; break;
      case 10: case 11:
        b.xs = 0.2 * c; b.ys = 0.2 * s; b.x += b.xs * 42; b.y += b.ys * 42; b.acc = 1.01; b.sub = 8; b.cap = 15; break;
      case 12:
        b.xs = 0.2 * c; b.ys = 0.2 * s; b.x += b.xs * 100; b.y += b.ys * 100; b.acc = 1.01; b.sub = 8; b.cap = 15; break;
      case 'sp1': case 'sp2': {
        const r = 80 + this.rand(20);
        b.rot = r; b.xs = 10 * Math.cos(r * DEG); b.ys = 10 * Math.sin(r * DEG);
        b.x = this.rand(500) + 200; b.y = -100; b.scale = (this.rand(70) + 120) / 100; break;
      }
      case 'sp4':
        b.rot = 0; b.xs = 4; b.ys = 1; b.gf = 0.2; b.rotS = this.rand(10) - 5; b.kind = 2; break;
      default: break;
    }
    this.bullets.push(b);
  }

  _bulletsTick() {
    const bl = this.bullets;
    for (let i = bl.length - 1; i >= 0; i--) {
      const b = bl[i];
      let done = false;
      if (--b.life <= 0) done = true;
      else if (b.kind === 1) done = this._oilTick(b);
      else {
        for (let s = 0; s < b.sub && !done; s++) {
          if (b.kind === 2) { // bomber bomb: terminal velocity gravity
            if (b.g < 15) b.g += b.gf;
            b.xs /= 1.02; b.x += b.xs; b.y += b.ys + b.g;
          } else if (b.acc !== 1) {
            if (!b.cap || b.xs < b.cap) { b.x += b.xs; b.y += b.ys; b.xs *= b.acc; b.ys *= b.acc; }
          } else {
            b.g += b.gf; b.x += b.xs; b.y += b.ys + b.g;
          }
          b.rot += b.rotS / b.sub;
          if (b.y > GROUND) { this._impact(b, null); done = true; break; }
          const t = this._hitTest(b.x, b.y, b.side);
          if (t) {
            t.health -= b.dmg;
            this._impact(b, t);
            done = true;
          }
        }
        if (b.x < -300 || b.x > 1400) done = true;
      }
      if (done) { bl[i] = bl[bl.length - 1]; bl.pop(); this._bulletPool.push(b); }
    }
  }

  _oilTick(b) {
    if (++b.cc === 2) {
      b.cc = 0;
      this._part(P.FIRE, b.x + (this.rng() * 2 - 1), b.y + (this.rng() * 2 - 1), 0, 1, b.side, TS[5][2]);
    }
    return false;
  }

  _hitTest(x, y, side) {
    const ts = this.targets;
    for (let a = ts.length - 1; a >= 0; a--) {
      const t = ts[a];
      if (t.side === side) continue;
      let l, r, top, bot;
      if (t.kind === 'base') {
        // base hit zones are offset from the base clip origin
        l = t.side === 1 ? t.x - 66.8 : t.x - 94.65; r = l + t.hzW; top = GROUND - 37; bot = GROUND + 40;
      } else { l = t.x - t.hzW / 2; r = t.x + t.hzW / 2; top = GROUND - t.hzH; bot = GROUND; }
      if (x >= l && x <= r && y >= top && y <= bot) return t;
    }
    return null;
  }

  _impact(b, t) {
    const type = b.type;
    if (t && t.kind === 'unit') this._blood(t.x, GROUND - t.hzH / 1.5, 5);
    switch (type) {
      case 1: case 3: this._dust(b.x, b.y, t ? 4 : 7); break;
      case 4:
        for (let i = 0; i < 3; i++) this._chip(b.x, b.y, b.side, 10);
        this._part(P.BOOM_S, b.x, b.y, 0, 0, 0, 0);
        break;
      case 7:
        for (let i = 0; i < 3; i++) this._chip(b.x, b.y, b.side, 30, true);
        this._part(P.BOOM_S, b.x, b.y, 0, 0, 0, 0);
        break;
      case 9: this._part(P.BOOM_S, b.x, b.y, 0, 0, 0, 0); break;
      case 6: case 8: case 10: case 11: case 12: this._part(P.BIT, b.x, b.y, 0, 0, 0, 0); break;
      case 'sp1': case 'sp2': case 'sp4':
        this._part(P.BOOM_L, b.x, b.y, 0, 0, 0, 0);
        this.shake = Math.max(this.shake, 3);
        break;
      default: break;
    }
    if (t) this.emit('impact');
  }

  // ---- particles ---------------------------------------------------------------------------------
  _part(k, x, y, xs, ys, side, dmg) {
    if (this.parts.length > 300) return null;
    const p = this._partPool.pop() || {};
    p.k = k; p.x = x; p.y = y; p.xs = xs; p.ys = ys; p.side = side; p.dmg = dmg;
    p.g = ys; p.rot = 0; p.rotS = 0; p.frame = 0; p.life = 60; p.text = null; p.scale = 1; p.alpha = 1;
    this.parts.push(p);
    return p;
  }

  _blood(x, y, n) {
    for (let i = 0; i < n; i++) {
      const p = this._part(P.BLOOD, x + this.rng() * 6 - 3, y + this.rng() * 6 - 3, this.rng() * 2 - 1, this.rng() * 1.5 - 1, 0, 0);
      if (p) p.rotS = this.rand(4) - 1.5;
    }
  }

  _dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      const p = this._part(P.DUST, x + this.rng() * 9 - 4, y + this.rng() * 9 - 4, this.rng() * 6 - 3, -this.rng() * 3 + 1, 0, 0);
      if (p) { p.scale = (this.rand(40) + 100) / 100; p.rotS = this.rand(4) - 1.5; }
    }
  }

  _chip(x, y, side, dmg, shrapnel) {
    const a = (-90 + (this.rand(60) - 30)) * DEG;
    const p = this._part(shrapnel ? P.SHRAPNEL : P.CHIP, x, y, 7 * Math.cos(a), 7 * Math.sin(a) + this.rng(), side, dmg);
    if (p) { p.g = 0; p.ys = 7 * Math.sin(a) + this.rng(); p.rotS = this.rand(20) - 10; }
  }

  _text(x, y, text) {
    const p = this._part(P.TEXT, x, y, 0, 3, 0, 0);
    if (p) { p.text = text; p.life = 140; }
  }

  _partsTick() {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      let done = false;
      switch (p.k) {
        case P.BLOOD: case P.DUST: case P.BIT:
          p.g += p.k === P.DUST ? 0.15 : 0.2;
          p.xs /= 1.1; p.x += p.xs; p.y += p.g; p.rot += p.rotS;
          if (p.y > GROUND) done = true;
          break;
        case P.CHIP: case P.SHRAPNEL:
          p.g += 0.2; p.x += p.xs; p.y += p.ys + p.g; p.rot += p.rotS;
          if (p.ys + p.g > 0) {
            if (p.y > GROUND) done = true;
            else {
              const t = this._hitTest(p.x, p.y, p.side);
              if (t) { t.health -= p.dmg; done = true; }
            }
          }
          break;
        case P.FIRE:
          p.g += 0.2; p.y += p.g; p.rot += 1;
          { const t = this._hitTest(p.x, p.y, p.side); if (t) { t.health -= p.dmg; done = true; } }
          if (p.y > GROUND) done = true;
          break;
        case P.BOOM_S: case P.BOOM_L:
          if (++p.frame >= 20) done = true; break;
        case P.TEXT:
          // rises ~30 px, then stays readable for ~2 s and fades over the last ~1.2 s
          p.y -= p.ys; p.ys /= 1.1;
          p.alpha = Math.min(1, p.life / 50);
          if (--p.life <= 0) done = true;
          break;
        default: done = true;
      }
      if (done) { ps[i] = ps[ps.length - 1]; ps.pop(); this._partPool.push(p); }
    }
  }

  // ---- special attacks ----------------------------------------------------------------------------
  _specialsTick() {
    if (this.specialHeal > 0) this.specialHeal--;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const m = this.emitters[i];
      m.cc++; m.timer--;
      if (m.cc === (m.kind === 1 ? 9 : 5)) { this._createBullet(0, 0, 0, 200, m.kind === 1 ? 'sp1' : 'sp2', 1); m.cc = 0; }
      this.shake = Math.max(this.shake, m.kind === 1 ? 5 : 2);
      if (m.timer === 0) this.emitters.splice(i, 1);
    }
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      p.cc++;
      if (p.cc === 15 && p.x < 700) { this._createBullet(p.x, 200, 0, 400, 'sp4', 1); p.cc = 0; }
      p.x += 4;
      this.shake = Math.max(this.shake, 1.5);
      if (p.x > 1000) this.planes.splice(i, 1);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const m = this.beams[i];
      m.cc++;
      if (m.cc === 5 && m.x < 700) {
        const x = m.x + 30;
        const t = this._hitTest(x, GROUND - 5, 1);
        if (t) t.health -= 1000;
        m.flashes.push({ x, life: 10 });
        m.x += 50; m.cc = 0;
      }
      for (let k = m.flashes.length - 1; k >= 0; k--) if (--m.flashes[k].life <= 0) m.flashes.splice(k, 1);
      this.shake = Math.max(this.shake, 1.5);
      if (m.x >= 700 && m.flashes.length === 0) this.beams.splice(i, 1);
    }
  }

  /** Release pooled objects (used for long sessions / memory pass). */
  trimPools() {
    this._unitPool.length = Math.min(this._unitPool.length, 8);
    this._bulletPool.length = Math.min(this._bulletPool.length, 32);
    this._partPool.length = Math.min(this._partPool.length, 64);
  }
}
