// Canvas renderer + atlas loading. Unit atlases are loaded per age and released when unused (memory).
import { WORLD } from './data.js';
import { P } from './sim.js';

const DEG = Math.PI / 180;
const GROUND = WORLD.groundY;

// Turret art pivot inside the 165x62 union canvas of the decompiled render (my estimate, tuned by eye).
const TURRET_PIVOT = [40, 45];
// Base art top-left in clip coordinates (derived from template matching, see tools notes).
const BASE_ART = { x: -91, y: -146.5 };
// Add-on art top-left (clip coords, player side) for add-ons 1..3, and the mirrored enemy origin.
const ADDON_ART = [null, { x: 10, y: -173.5 }, { x: 22, y: -267.5 }, { x: 21, y: -236.5 }];

async function loadBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('load failed: ' + url);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

export class Assets {
  constructor(base = 'assets/') {
    this.base = base;
    this.meta = null;
    this.atlas = {};        // name -> { bmp, rects }
    this.loading = {};      // name -> promise
    this.bg = null;
  }

  async init() {
    this.meta = await (await fetch(this.base + 'meta.json', { cache: 'no-cache' })).json();
    const [bg] = await Promise.all([
      loadBitmap(this.base + this.meta.bg.file),
      this.ensure('world'), this.ensure('ui'), this.ensure('units1'),
    ]);
    this.bg = bg;
  }

  /** Load an atlas (once). */
  ensure(name) {
    if (this.atlas[name]) return Promise.resolve(this.atlas[name]);
    if (this.loading[name]) return this.loading[name];
    const info = this.meta.atlases[name];
    this.loading[name] = loadBitmap(this.base + info.file).then(bmp => {
      this.atlas[name] = { bmp, rects: info.rects };
      delete this.loading[name];
      return this.atlas[name];
    });
    return this.loading[name];
  }

  ensureAge(age) { return this.ensure('units' + age); }

  /** Close unit atlases for ages that are neither in `keep` nor current. */
  release(keepAges) {
    for (let a = 1; a <= 5; a++) {
      const n = 'units' + a;
      if (this.atlas[n] && !keepAges.has(a)) {
        this.atlas[n].bmp.close();
        delete this.atlas[n];
      }
    }
  }

  loadedBytes() {
    let b = 0;
    for (const k in this.atlas) { const s = this.meta.atlases[k].size; b += s[0] * s[1] * 4; }
    if (this.bg) b += this.bg.width * this.bg.height * 4;
    return b;
  }
}

export class Renderer {
  constructor(canvas, assets) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assets = assets;
    this.viewW = WORLD.viewW;
    this.k = 1;
  }

  /** Set logical view width (height is always 450) and backing-store scale. */
  resize(viewW, cssH, dpr) {
    this.viewW = viewW;
    const k = Math.min(Math.max(cssH / WORLD.viewH * dpr, 0.5), 2);
    this.k = k;
    this.cv.width = Math.round(viewW * k);
    this.cv.height = Math.round(WORLD.viewH * k);
  }

  draw(g, cam, ui) {
    const ctx = this.ctx, a = this.assets, k = this.k;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (!this.sky) {
      this.sky = ctx.createLinearGradient(0, 0, 0, a.meta.bg.top);
      this.sky.addColorStop(0, a.meta.bg.sky0);
      this.sky.addColorStop(1, a.meta.bg.sky1);
    }
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, this.viewW, WORLD.viewH);
    let sx = 0, sy = 0;
    if (g && g.shake > 0) { sx = (Math.random() * 2 - 1) * g.shake; sy = (Math.random() * 2 - 1) * g.shake; }
    ctx.setTransform(k, 0, 0, k, Math.round((-cam + sx) * k), Math.round(sy * k));
    ctx.drawImage(a.bg, 0, a.meta.bg.top);
    const world = a.atlas.world;
    if (!world) return;
    const w = a.meta.world;

    const age1 = g ? g.age : 1, age2 = g ? g.e.age : 1;
    this._base(world, w, 1, age1, g ? g.addons : 0);
    this._base(world, w, 2, age2, g ? g.e.addons : 0);
    if (!g) return;

    for (let i = 0; i < g.turrets.length; i++) this._turret(world, w, g.turrets[i]);
    this._slots(g, ui, cam);
    for (let i = 0; i < g.units.length; i++) this._unit(g, g.units[i]);
    this._bullets(world, w, g);
    this._parts(world, w, g);
    this._specials(world, w, g);
    this._bars(g);
  }

  _sprite(atlas, e, x, y) {
    // e = [rectId, ox, oy]; draws the trimmed rect at canvas origin (x,y) + offset
    const r = atlas.rects[e[0]];
    this.ctx.drawImage(atlas.bmp, r[0], r[1], r[2], r[3], x + e[1], y + e[2], r[2], r[3]);
  }

  _base(world, w, side, age, addons) {
    const ctx = this.ctx;
    const art = w['base' + age];
    if (side === 1) {
      this._sprite(world, art, BASE_ART.x, GROUND + BASE_ART.y);
      for (let n = 1; n <= addons; n++) this._sprite(world, w['add' + n + '_' + age], ADDON_ART[n].x, GROUND + ADDON_ART[n].y);
    } else {
      ctx.save();
      ctx.translate(1002.25, 0);
      ctx.scale(-1.005, 1);
      this._sprite(world, art, BASE_ART.x, GROUND + BASE_ART.y);
      ctx.restore();
      for (let n = 1; n <= addons; n++) {
        const e = w['add' + n + '_' + age];
        const r = world.rects[e[0]];
        // mirrored add-on: left = 1001.5 - leftPlayer - fullWidth(canvas); trimmed rect mirrored inside the canvas
        const full = this._addonW(n);
        const left = 1001.5 - ADDON_ART[n].x - full;
        ctx.save();
        ctx.translate(left + full, GROUND + ADDON_ART[n].y);
        ctx.scale(-1, 1);
        ctx.drawImage(world.bmp, r[0], r[1], r[2], r[3], e[1], e[2], r[2], r[3]);
        ctx.restore();
      }
    }
  }

  _addonW(n) { return n === 1 ? 81 : n === 2 ? 69 : 70; }

  _turret(world, w, t) {
    const ctx = this.ctx;
    const e = w['tur' + t.id];
    const r = world.rects[e[0]];
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.rot * DEG);
    if (t.side === 2) ctx.scale(1, -1);
    const kick = t.kick > 0 ? -t.kick * 0.5 : 0;
    ctx.drawImage(world.bmp, r[0], r[1], r[2], r[3], e[1] - TURRET_PIVOT[0] + kick, e[2] - TURRET_PIVOT[1], r[2], r[3]);
    ctx.restore();
  }

  _slots(g, ui, cam) {
    if (!ui || (ui.mode !== 'place' && ui.mode !== 'sell')) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 2;
    for (let s = 1; s <= 4; s++) {
      const cx = WORLD.turretX, cy = GROUND + WORLD.slotY[s - 1];
      const t = g.spots1[s - 1];
      if (ui.mode === 'place') {
        if (!g.slotUsable(s)) continue;
        ctx.strokeStyle = ui.hoverSlot === s ? '#ffe45c' : '#ff2a2a';
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(cx - 17, cy - 17, 34, 34);
        if (ui.hoverSlot === s) { ctx.fillStyle = 'rgba(255,228,92,.25)'; ctx.fillRect(cx - 17, cy - 17, 34, 34); }
      } else if (t) {
        ctx.strokeStyle = ui.hoverSlot === s ? '#ffffff' : '#39e05a';
        ctx.setLineDash([]);
        ctx.strokeRect(cx - 17, cy - 17, 34, 34);
        ctx.fillStyle = ui.hoverSlot === s ? 'rgba(255,255,255,.3)' : 'rgba(57,224,90,.22)';
        ctx.fillRect(cx - 17, cy - 17, 34, 34);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('$', cx, cy + 4);
      }
    }
    ctx.restore();
  }

  _unit(g, u) {
    const a = this.assets, ctx = this.ctx;
    const um = a.meta.units[u.id];
    const atlas = a.atlas[um.atlas];
    if (!atlas) return;
    const clip = um.clips[u.state] || um.clips.idle;
    const m = clip.f.length;
    let fi = ((u.frame - 1) / clip.step) | 0;
    // death clips keep their real last frame as an extra entry, shown only once the clip has finished
    if (clip.last) fi = u.frame >= clip.n ? m - 1 : Math.min(fi, m - 2);
    else if (fi >= m) fi = m - 1;
    const e = clip.f[fi];
    if (u.dead && u.dc > 60) ctx.globalAlpha = Math.max(0, 1 - (u.dc - 60) / 21);
    if (e) {
      const r = atlas.rects[e[0]];
      const ox = e[1], oy = e[2];
      const dy = GROUND - clip.ay + oy;
      if (g.specialHeal > 0 && u.side === 1 && !u.dead) this._aura(u);
      if (u.side === 1) {
        ctx.drawImage(atlas.bmp, r[0], r[1], r[2], r[3], Math.round(u.x - clip.ax + ox), dy, r[2], r[3]);
      } else {
        ctx.save();
        ctx.translate(Math.round(u.x), 0);
        ctx.scale(-1, 1);
        ctx.drawImage(atlas.bmp, r[0], r[1], r[2], r[3], ox - clip.ax, dy, r[2], r[3]);
        ctx.restore();
      }
    }
    if (u.dead) ctx.globalAlpha = 1;
    else if (u.health < u.max) {
      const bw = 24, bx = u.x - bw / 2, by = GROUND - u.hzH - 9;
      ctx.fillStyle = '#300';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = u.side === 1 ? '#3adf4a' : '#ff3b3b';
      ctx.fillRect(bx, by, bw * Math.max(0, u.health) / u.max, 3);
    }
  }

  _aura(u) {
    const ctx = this.ctx, a = this.assets;
    const w = a.atlas.world, e = a.meta.world.aura;
    const r = w.rects[e[0]];
    ctx.globalAlpha = 0.7;
    ctx.drawImage(w.bmp, r[0], r[1], r[2], r[3], u.x - r[2] / 2, GROUND - u.hzH / 2 - r[3] / 2, r[2], r[3]);
    ctx.globalAlpha = 1;
  }

  _centered(world, e, x, y, rot, scale) {
    const ctx = this.ctx, r = world.rects[e[0]];
    if (rot || scale !== 1) {
      ctx.save();
      ctx.translate(x, y);
      if (rot) ctx.rotate(rot * DEG);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.drawImage(world.bmp, r[0], r[1], r[2], r[3], -r[2] / 2, -r[3] / 2, r[2], r[3]);
      ctx.restore();
    } else ctx.drawImage(world.bmp, r[0], r[1], r[2], r[3], Math.round(x - r[2] / 2), Math.round(y - r[3] / 2), r[2], r[3]);
  }

  _bullets(world, w, g) {
    const bl = g.bullets;
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (b.kind === 1) continue; // oil emitter has no art, its drops are particles
      const e = typeof b.type === 'number' ? w['bul' + b.type] : w[b.type];
      if (e) this._centered(world, e, b.x, b.y, b.rot, b.scale);
    }
  }

  _parts(world, w, g) {
    const ctx = this.ctx, ps = g.parts;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      switch (p.k) {
        case P.BLOOD: this._centered(world, w.blood, p.x, p.y, p.rot, 1); break;
        case P.DUST: this._centered(world, w.dust, p.x, p.y, p.rot, p.scale); break;
        case P.CHIP: this._centered(world, w.spark, p.x, p.y, p.rot, 1); break;
        case P.SHRAPNEL: this._centered(world, w.p11, p.x, p.y, p.rot, 1); break;
        case P.FIRE: this._centered(world, w.fire, p.x, p.y, p.rot, 1); break;
        case P.BIT: this._centered(world, w.p10, p.x, p.y, p.rot, 1); break;
        case P.BOOM_S: case P.BOOM_L: {
          const seq = p.k === P.BOOM_S ? w.boomS : w.boomL;
          const e = seq[Math.min(p.frame, seq.length - 1)];
          if (e) {
            const r = world.rects[e[0]];
            ctx.drawImage(world.bmp, r[0], r[1], r[2], r[3], Math.round(p.x - r[2] / 2), Math.round(p.y - r[3] + 6), r[2], r[3]);
          }
          break;
        }
        case P.TEXT:
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = '#ffe62e'; ctx.fillText(p.text, p.x, p.y);
          ctx.globalAlpha = 1;
          break;
        default: break;
      }
    }
  }

  _specials(world, w, g) {
    const ctx = this.ctx;
    for (let i = 0; i < g.planes.length; i++) this._centered(world, w.plane, g.planes[i].x, 200, 0, 1);
    for (let i = 0; i < g.beams.length; i++) {
      const fl = g.beams[i].flashes;
      for (let j = 0; j < fl.length; j++) {
        const f = fl[j];
        const a = Math.min(1, f.life / 6);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fff';
        ctx.fillRect(f.x - 5 - (10 - f.life), -50, 10 + (10 - f.life) * 2, GROUND + 50);
        ctx.fillStyle = '#9fd8ff';
        ctx.fillRect(f.x - 2, -50, 4, GROUND + 50);
      }
      ctx.globalAlpha = 1;
    }
  }

  _bars(g) {
    // vertical base health bars like the original (next to each base)
    const ctx = this.ctx;
    const h = 148, bw = 14;
    const bars = [[g.base1, 3.5], [g.base2, 1000 - 17.5]];
    for (const [b, x] of bars) {
      const top = GROUND - 157.5 - h; // original bar registration is its bottom edge
      const r = Math.max(0, b.health) / b.max;
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 1, top - 1, bw + 2, h + 2);
      ctx.fillStyle = '#5b0000';
      ctx.fillRect(x, top, bw, h);
      ctx.fillStyle = '#ff1a1a';
      ctx.fillRect(x, top + h * (1 - r), bw, h * r);
    }
  }
}
