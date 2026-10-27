// HUD (DOM) - money/xp panel, training queue, context menu. Icons are CSS sprites from assets/ui.webp.
import {
  EN, TU, EV, AGE_NAMES, AGE_UNITS, AGE_TURRETS, SPECIAL_COOLDOWN, SPECIAL_NAMES, ADDON_COST,
} from './data.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const fmt = n => Math.floor(n).toLocaleString('en-US');

export class UI {
  /**
   * @param {HTMLElement} root  the #hud element
   * @param {object} meta       assets/meta.json
   * @param {object} cb         { onPause, onSound, onFullscreen, onView, soundOn, wideOn }
   */
  constructor(root, meta, cb) {
    this.root = root;
    this.meta = meta;
    this.cb = cb;
    this.g = null;
    this.mode = 'main';       // main | units | turrets | place | sell
    this.placeId = 0;
    this.hoverSlot = 0;
    this.desc = '';
    this._sig = '';
    this._last = {};
    const uiSize = meta.atlases.ui.size;
    document.documentElement.style.setProperty('--aw', uiSize[0]);
    document.documentElement.style.setProperty('--ah', uiSize[1]);
    // absolute URL: the file name carries a content hash (see tools/pack.py hash_names)
    document.documentElement.style.setProperty('--ui-url', `url("${new URL('assets/' + meta.atlases.ui.file, document.baseURI).href}")`);
    this._build();
  }

  _icon(rectId, parent) {
    const r = this.meta.atlases.ui.rects[rectId];
    const d = el('i', 'ic', parent);
    d.style.setProperty('--x', r[0]); d.style.setProperty('--y', r[1]);
    d.style.setProperty('--w', r[2]); d.style.setProperty('--h', r[3]);
    return d;
  }

  _build() {
    const root = this.root;
    root.textContent = '';
    // left panel
    const left = el('div', 'panel', root); left.id = 'hud-left';
    const r1 = el('div', 'row', left); el('span', '', r1, '$ Money'); this.cash = el('span', 'v', r1, '0');
    const r2 = el('div', 'row', left); el('span', '', r2, 'XP'); this.xp = el('span', 'v', r2, '0');
    const r3 = el('div', 'row age', left); this.ageName = el('span', '', r3, AGE_NAMES[0]);
    this.baseHp = el('span', 'v', r3, '');
    const bar = el('div', 'bar', left); this.prog = el('i', '', bar);
    this.tray = el('div', '', left); this.tray.id = 'tray';
    this.slots = [];
    for (let i = 0; i < 5; i++) {
      const s = el('div', 'slot', this.tray);
      this.slots.push({ s, pg: el('div', 'pg', s), ic: null, id: 0 });
    }
    // top-right small buttons
    const tr = el('div', '', root); tr.id = 'hud-top-right';
    this.bPause = el('button', '', tr, '❚❚'); this.bPause.title = 'Pause (space)';
    this.bSound = el('button', '', tr, this.cb.soundOn() ? '♪' : '✕'); this.bSound.title = 'Sound';
    this.bView = el('button', '', tr);
    const viewLabel = () => {
      const wide = this.cb.wideOn();
      this.bView.textContent = wide ? '▭' : '◻';
      this.bView.title = wide ? 'View: wide (click for classic 2000s view)' : 'View: classic 2000s (click for wide)';
    };
    viewLabel();
    this.bView.onclick = () => { this.cb.onView(); viewLabel(); };
    this.bFull = el('button', '', tr, '⛶'); this.bFull.title = 'Fullscreen';
    if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) this.bFull.hidden = true;
    this.bPause.onclick = () => this.cb.onPause();
    this.bSound.onclick = () => { this.cb.onSound(); this.bSound.textContent = this.cb.soundOn() ? '♪' : '✕'; };
    this.bFull.onclick = () => this.cb.onFullscreen();
    // right panel
    const right = el('div', 'panel', root); right.id = 'hud-right';
    this.title = el('h3', '', right);
    this.titleText = el('span', '', this.title, 'Menu');
    this.btns = el('div', '', right); this.btns.id = 'btns';
    this.descEl = el('div', '', right); this.descEl.id = 'desc';
    this.hint = el('div', '', root); this.hint.id = 'hint'; this.hint.hidden = true;
    this.items = [];
    this._sig = '';
  }

  setGame(g) {
    this.g = g;
    this.mode = 'main';
    this.hoverSlot = 0;
    this._sig = '';
    this._last = {};
    this.update();
  }

  setMode(m, placeId = 0) {
    this.mode = m;
    this.placeId = placeId;
    this.hoverSlot = 0;
    this.desc = '';
    this._sig = '';
    this.update();
  }

  cancel() { if (this.mode !== 'main') this.setMode('main'); }

  /** Activate the n-th button of the current menu (keyboard 1..5). */
  pressIndex(n) { const it = this.items[n]; if (it && !it.off) it.btn.click(); }

  setDesc(t) { this.desc = t; this.descEl.textContent = t; }

  _item(opts) {
    const b = el('button', 'ib' + (opts.cls ? ' ' + opts.cls : ''), this.btns);
    b.type = 'button';
    if (opts.icon !== undefined) this._icon(opts.icon, b); else b.textContent = opts.label;
    b.setAttribute('aria-label', opts.tip);
    const tip = () => this.setDesc(typeof opts.tip === 'function' ? opts.tip() : opts.tip);
    b.addEventListener('pointerenter', tip);
    b.addEventListener('focus', tip);
    b.addEventListener('pointerleave', () => this.setDesc(''));
    b.addEventListener('click', () => { if (!opts.disabled || !opts.disabled()) { opts.run(); tip(); } });
    const it = { btn: b, off: false, opts };
    this.items.push(it);
    if (opts.cooldown) { it.cd = el('div', 'cd', b); }
    return it;
  }

  _rebuildMenu() {
    const g = this.g, ui = this.meta.ui;
    this.btns.textContent = '';
    this.items = [];
    const back = { label: '◀', cls: 'txt-btn', tip: 'Back', run: () => this.setMode('main') };
    switch (this.mode) {
      case 'main':
        this.titleText.textContent = 'Menu';
        this._item({ icon: ui.menu[0], tip: 'Train units', run: () => this.setMode('units') });
        this._item({ icon: ui.menu[1], tip: 'Build turrets', run: () => this.setMode('turrets') });
        this._item({ icon: ui.menu[2], tip: 'Sell a turret', run: () => this.setMode('sell') });
        this._item({
          icon: ui.menu[3],
          tip: () => (g.addons >= 3 ? "Can't build any more" : `${fmt(ADDON_COST[g.addons])}$ - Add a turret spot`),
          disabled: () => g.addons >= 3 || g.cash < ADDON_COST[g.addons],
          run: () => g.buyAddon(),
        });
        this._item({
          icon: ui.menu[4],
          tip: () => (g.age < 5 ? `${fmt(EV[g.age - 1])} XP - Evolve to next age` : 'You cannot evolve anymore'),
          disabled: () => !g.canEvolve(),
          run: () => g.evolve(),
        });
        this._item({
          icon: ui.special[g.age - 1], cls: 'special', cooldown: true,
          tip: () => `Special: ${SPECIAL_NAMES[g.age - 1]}` + (g.specialReady() ? '' : ' (recharging)'),
          disabled: () => !g.specialReady(),
          run: () => g.special(),
        });
        break;
      case 'units':
        this.titleText.textContent = 'Train units';
        this._item(back);
        for (const id of AGE_UNITS[g.age]) {
          this._item({
            icon: ui.unit[id], tip: `${fmt(EN[id][1])}$ - ${EN[id][0]}`,
            disabled: () => g.cash < EN[id][1] || g.tray[4] !== 0, run: () => g.queueUnit(id), unit: id,
          });
        }
        break;
      case 'turrets':
        this.titleText.textContent = 'Build turrets';
        this._item(back);
        for (const id of AGE_TURRETS[g.age]) {
          this._item({
            icon: ui.turret[id], tip: `${fmt(TU[id][1])}$ - ${TU[id][0]}`,
            disabled: () => g.cash < TU[id][1], run: () => this.setMode('place', id), turret: id,
          });
        }
        break;
      case 'place':
        this.titleText.textContent = 'Place turret';
        this._item({ label: 'CANCEL', cls: 'txt-btn', tip: 'Cancel', run: () => this.setMode('main') });
        break;
      case 'sell':
        this.titleText.textContent = 'Sell a turret';
        this._item({ label: 'CANCEL', cls: 'txt-btn', tip: 'Cancel', run: () => this.setMode('main') });
        break;
      default: break;
    }
    const hints = { place: 'Select a free turret spot on your base', sell: 'Select a turret to sell (half price)' };
    this.hint.hidden = !hints[this.mode];
    this.hint.textContent = hints[this.mode] || '';
  }

  /** Called every rendered frame; only touches the DOM when a value changed. */
  update() {
    const g = this.g;
    if (!g) return;
    const sig = this.mode + ':' + g.age;
    if (sig !== this._sig) { this._sig = sig; this._rebuildMenu(); this._last.afford = -1; }
    const L = this._last;
    const cash = Math.floor(g.cash), xp = Math.floor(g.xp);
    if (cash !== L.cash) { L.cash = cash; this.cash.textContent = fmt(cash); }
    if (xp !== L.xp || g.age !== L.age) {
      L.xp = xp;
      this.xp.textContent = g.age < 5 ? `${fmt(xp)} / ${fmt(EV[g.age - 1])}` : fmt(xp);
    }
    if (g.age !== L.age) { L.age = g.age; this.ageName.textContent = AGE_NAMES[g.age - 1]; }
    const hp = Math.max(0, Math.round(g.base1.health));
    if (hp !== L.hp) { L.hp = hp; this.baseHp.textContent = `Base ${hp}/${Math.round(g.base1.max)}`; }
    // training progress + queue
    const pr = g.trainTotal ? 100 - (g.trainTimer / g.trainTotal) * 100 : 0;
    const prr = Math.round(pr);
    if (prr !== L.pr) { L.pr = prr; this.prog.style.width = prr + '%'; }
    for (let i = 0; i < 5; i++) {
      const sl = this.slots[i], id = g.tray[i];
      if (sl.id !== id) {
        sl.id = id;
        if (sl.ic) { sl.ic.remove(); sl.ic = null; }
        if (id) sl.ic = this._icon(this.meta.ui.unit[id], sl.s);
      }
    }
    const p0 = g.trainTotal ? Math.round(pr) : 0;
    if (p0 !== L.p0) { L.p0 = p0; this.slots[0].pg.style.height = p0 + '%'; }
    // enable/disable states depend on cash, tray and age
    const afford = cash + ':' + g.tray[4] + ':' + g.addons + ':' + (g.canEvolve() ? 1 : 0) + ':' + (g.specialReady() ? 1 : 0);
    if (afford !== L.afford) {
      L.afford = afford;
      for (const it of this.items) {
        const off = it.opts.disabled ? it.opts.disabled() : false;
        if (off !== it.off) { it.off = off; it.btn.classList.toggle('off', off); }
        if (it.opts.cooldown) it.btn.classList.toggle('ready', !off);
      }
    }
    // special cooldown overlay
    const sp = this.items[5];
    if (sp && sp.cd && this.mode === 'main') {
      const ratio = Math.min(1, g.specialTimer / SPECIAL_COOLDOWN);
      const hgt = Math.round((1 - ratio) * 100);
      if (hgt !== L.cd) { L.cd = hgt; sp.cd.style.height = hgt + '%'; }
    }
  }
}
