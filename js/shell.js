// Outer page: toolbar (zoom, fullscreen) around the game iframe. The game itself lives in game.html.
(() => {
  const $ = id => document.getElementById(id);
  const frame = $('game'), app = $('app');
  const ZMIN = 0.5, ZMAX = 2, ZSTEP = 0.1;
  let z = 1;

  function setZoom(v) {
    z = Math.min(ZMAX, Math.max(ZMIN, Math.round(v * 10) / 10));
    document.documentElement.style.setProperty('--z', z);
    $('z-label').textContent = z === 1 ? 'Fit' : Math.round(z * 100) + '%';
    $('z-out').disabled = z <= ZMIN;
    $('z-in').disabled = z >= ZMAX;
    $('z-fit').disabled = z === 1;
  }

  function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (app.requestFullscreen || app.webkitRequestFullscreen).call(app);
  }

  // buttons keep focus after a click; hand it back so Space / arrows / A D reach the game
  const refocus = () => { try { frame.contentWindow.focus(); } catch (e) { /* ignore */ } };
  const act = (id, fn) => $(id).addEventListener('click', () => { fn(); refocus(); });
  act('z-out', () => setZoom(z - ZSTEP));
  act('z-in', () => setZoom(z + ZSTEP));
  act('z-fit', () => setZoom(1));
  act('fs', toggleFullscreen);
  if (!app.requestFullscreen && !app.webkitRequestFullscreen) $('fs').hidden = true;

  function zoomKey(k) {
    if (k === '+' || k === '=') setZoom(z + ZSTEP);
    else if (k === '-' || k === '_') setZoom(z - ZSTEP);
    else if (k === '0') setZoom(1);
  }
  window.addEventListener('keydown', e => { if (!e.ctrlKey && !e.metaKey && !e.altKey) zoomKey(e.key); });

  // requests from the game (same origin): its own fullscreen button and the zoom keys
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow || !e.data) return;
    if (e.data.type === 'aow-fullscreen') toggleFullscreen();
    else if (e.data.type === 'aow-zoomkey') zoomKey(String(e.data.key));
  });

  frame.addEventListener('load', refocus);
  setZoom(1);
})();
