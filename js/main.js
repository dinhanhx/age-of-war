import { WORLD, FPS } from './data.js';
import { Game } from './sim.js';
import { simTables } from './meta.js';
import { Assets, Renderer } from './render.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';

const $ = id => document.getElementById(id);
const STEP = 1000 / FPS;
const WORLD_W = 1000;                       // playable world width (px)
const inShell = window.parent !== window;  // running inside the index.html iframe
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');

const app = {
  assets: new Assets(), renderer: null, ui: null, sound: null, tables: null,
  g: null, screen: 'loading', paused: false, cam: 0, camMax: 350, viewW: 650, u: 1,
  wide: false,                              // false = original 650x450 view (default), true = widen to the window
  mouse: { x: 0, y: 0, inside: false, type: 'mouse' },
  keys: { left: false, right: false },
  endTimer: 0, diff: 1, ageCheck: 0,
};
window.__aow = app; // handy for debugging / automated tests

// ---------------------------------------------------------------- layout
try { app.wide = localStorage.getItem('aow-view') === 'wide'; } catch (e) { /* storage blocked */ }

function toggleView() {
  app.wide = !app.wide;
  try { localStorage.setItem('aow-view', app.wide ? 'wide' : 'classic'); } catch (e) { /* ignore */ }
  layout();
}

function layout() {
  const W = window.innerWidth, H = window.innerHeight;
  const viewW = app.wide ? Math.round(Math.min(WORLD_W, Math.max(WORLD.viewW, WORLD.viewH * W / H))) : WORLD.viewW;
  const u = Math.min(H / WORLD.viewH, W / viewW);
  app.viewW = viewW;
  app.u = u;
  app.camMax = Math.max(0, WORLD_W - viewW);
  app.cam = Math.min(app.cam, app.camMax);
  const root = document.documentElement.style;
  root.setProperty('--u', u.toFixed(4));
  root.setProperty('--s', Math.max(u, 1).toFixed(4));
  $('frame').style.width = viewW * u + 'px';
  $('frame').style.height = WORLD.viewH * u + 'px';
  if (app.renderer) app.renderer.resize(viewW, WORLD.viewH * u, Math.min(window.devicePixelRatio || 1, 2));
}

function show(name) {
  app.screen = name;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'scr-' + name;
  $('hud').hidden = !(name === 'game' || name === 'pause' || name === 'end');
  $('scroll-btns').hidden = name !== 'game';
}

// ---------------------------------------------------------------- game flow
async function startGame(diff) {
  app.diff = diff;
  app.sound.unlock();
  app.sound.preload();
  app.g = new Game({ ...app.tables, diff });
  app.cam = 0;
  app.paused = false;
  app.endTimer = 0;
  await app.assets.ensureAge(1);
  app.ui.setGame(app.g);
  show('game');
  app.sound.startMusic();
}

function setPaused(p) {
  if (!app.g || app.g.over) return;
  if (p && app.screen !== 'game') return;
  app.paused = p;
  if (p) show('pause'); else if (app.screen === 'pause') show('game');
}

function toTitle() {
  app.g = null;
  app.sound.stopMusic();
  app.assets.release(new Set([1]));
  show('title');
}

function quit() { toTitle(); }

function endGame() {
  const win = app.g.over === 'win';
  $('end-title').textContent = win ? 'Victory!' : 'Defeat!';
  $('end-text').textContent = win ? 'Congratulations, you won the war and destroyed your enemy.' : "Maybe you didn't try hard enough?";
  app.sound.stopMusic();
  show('end');
}

// ---------------------------------------------------------------- simulation step
function tickOnce() {
  const g = app.g;
  // desktop edge scrolling (original behaviour) + keyboard
  const m = app.mouse;
  if (m.inside && m.type === 'mouse' && m.y > 120) {
    if (m.x > app.viewW - 100) app.cam += (m.x - (app.viewW - 100)) / 10;
    else if (m.x < 100) app.cam -= (100 - m.x) / 10;
  }
  if (app.keys.left) app.cam -= 8;
  if (app.keys.right) app.cam += 8;
  app.cam = Math.min(app.camMax, Math.max(0, app.cam));
  g.tick();
  const ev = g.events;
  for (let i = 0; i < ev.length; i++) app.sound.event(ev[i]);
  ev.length = 0;
}

/** Keep only the unit atlases that are (or soon will be) needed. */
function manageAtlases() {
  const g = app.g, a = app.assets;
  const need = new Set([g.age, g.e.age]);
  if (g.age < 5 && g.xp >= 0.8 * g.evolveCost()) need.add(g.age + 1);
  if (g.e.age < 5 && g.e.techTimer > 7000) need.add(g.e.age + 1);
  for (const u of g.units) need.add(a.meta.units[u.id].age);
  for (const n of need) a.ensureAge(n);
  a.release(need);
}

// ---------------------------------------------------------------- loop
let acc = 0, last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(250, now - last);
  last = now;
  const g = app.g;
  if (g && app.screen === 'game' && !app.paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) { tickOnce(); acc -= STEP; n++; }
    if (n === 6) acc = 0;
    if (++app.ageCheck >= 30) { app.ageCheck = 0; manageAtlases(); }
    if (g.over && !app.endTimer) app.endTimer = now;
  } else acc = 0;
  if (g && g.over && app.endTimer && now - app.endTimer > 1500 && app.screen === 'game') endGame();
  if (app.renderer) {
    app.renderer.draw(g, app.cam, app.ui);
    if (g) app.ui.update();
  }
}

// ---------------------------------------------------------------- input
function logical(e) {
  const r = $('frame').getBoundingClientRect();
  return { x: (e.clientX - r.left) / app.u, y: (e.clientY - r.top) / app.u };
}

function slotAt(lx, ly) {
  const wx = lx + app.cam;
  const hit = Math.max(17, 22 / app.u);
  for (let s = 1; s <= 4; s++) {
    if (Math.abs(wx - WORLD.turretX) <= hit && Math.abs(ly - (WORLD.groundY + WORLD.slotY[s - 1])) <= hit) return s;
  }
  return 0;
}

function bindInput() {
  const cv = $('game');
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    app.sound.unlock();
    const p = logical(e);
    drag = { id: e.pointerId, x0: p.x, cam0: app.cam, moved: false, type: e.pointerType };
    app.mouse.type = e.pointerType;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  cv.addEventListener('pointermove', e => {
    const p = logical(e);
    app.mouse.x = p.x; app.mouse.y = p.y; app.mouse.inside = true; app.mouse.type = e.pointerType;
    if (drag && drag.id === e.pointerId && e.pointerType !== 'mouse') {
      const dx = p.x - drag.x0;
      if (Math.abs(dx) > 6) drag.moved = true;
      if (drag.moved) app.cam = Math.min(app.camMax, Math.max(0, drag.cam0 - dx));
    }
    if (app.ui && (app.ui.mode === 'place' || app.ui.mode === 'sell')) app.ui.hoverSlot = slotAt(p.x, p.y);
  });
  cv.addEventListener('pointerup', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const p = logical(e);
    const tapped = !drag.moved;
    drag = null;
    if (tapped && app.g && app.screen === 'game' && !app.paused) clickWorld(p.x, p.y);
  });
  cv.addEventListener('pointercancel', () => { drag = null; });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') app.mouse.inside = false; });
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // hold-to-scroll buttons for touch (same effect as the arrow keys)
  for (const [id, key] of [['scroll-left', 'left'], ['scroll-right', 'right']]) {
    const b = $(id);
    const set = v => { app.keys[key] = v; b.classList.toggle('on', v); };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      app.sound.unlock();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      set(true);
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, () => set(false));
    b.addEventListener('contextmenu', e => e.preventDefault());
  }

  window.addEventListener('keydown', e => {
    if (inShell && !e.ctrlKey && !e.metaKey && !e.altKey && /^[-+=_0]$/.test(e.key)) {
      parent.postMessage({ type: 'aow-zoomkey', key: e.key }, location.origin);
      return;
    }
    if (e.repeat && e.code === 'Space') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (app.screen === 'game') setPaused(true); else if (app.screen === 'pause') setPaused(false);
        break;
      case 'Escape':
        if (app.screen === 'game') { if (app.ui.mode !== 'main') app.ui.cancel(); else setPaused(true); }
        else if (app.screen === 'pause') setPaused(false);
        break;
      case 'ArrowLeft': case 'KeyA': app.keys.left = true; break;
      case 'ArrowRight': case 'KeyD': app.keys.right = true; break;
      default:
        if (app.screen === 'game' && /^Digit[1-6]$/.test(e.code)) app.ui.pressIndex(+e.code.slice(5) - 1);
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') app.keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') app.keys.right = false;
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    app.sound.unlock();
    switch (b.dataset.act) {
      case 'play': show('diff'); break;
      case 'start': startGame(+b.dataset.diff); break;
      case 'help': show('help'); break;
      case 'back': case 'title': show('title'); break;
      case 'resume': setPaused(false); break;
      case 'quit': quit(); break;
      default: break;
    }
  });
  $('scr-pause').addEventListener('pointerup', e => { if (e.target.id === 'scr-pause') setPaused(false); });

  portraitMQ.addEventListener('change', () => { if (portraitMQ.matches) setPaused(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('blur', () => { app.keys.left = app.keys.right = false; });
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 100));
}

function clickWorld(lx, ly) {
  const ui = app.ui, g = app.g;
  if (ui.mode === 'place') {
    const s = slotAt(lx, ly);
    if (s && g.buildTurret(s, ui.placeId)) ui.setMode('main');
  } else if (ui.mode === 'sell') {
    const s = slotAt(lx, ly);
    if (s && g.sellTurret(s)) ui.setMode('main');
  }
}

function toggleFullscreen() {
  // embedded in index.html: let the shell fullscreen itself so its toolbar and zoom stay available
  if (inShell) { parent.postMessage({ type: 'aow-fullscreen' }, location.origin); return; }
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  } else {
    const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    Promise.resolve(p).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {});
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  layout();
  show('loading');
  try {
    await app.assets.init();
  } catch (err) {
    $('scr-loading').querySelector('h2').textContent = 'Could not load assets: ' + err.message;
    throw err;
  }
  app.tables = simTables(app.assets.meta);
  app.sound = new Sound(app.assets.meta);
  app.renderer = new Renderer($('game'), app.assets);
  app.ui = new UI($('hud'), app.assets.meta, {
    onPause: () => setPaused(true),
    onSound: () => app.sound.toggle(),
    soundOn: () => app.sound.on,
    onFullscreen: toggleFullscreen,
    onView: toggleView,
    wideOn: () => app.wide,
  });
  layout();
  bindInput();
  show('title');
  requestAnimationFrame(frame);
}

boot();
