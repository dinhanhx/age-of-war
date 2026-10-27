// Sound: small SFX decoded lazily with WebAudio, music streamed through an <audio> element.
// Which original sound belongs to which event is my guess ([Unverified]); the files are named by their Flash ids.
const MELEE = {
  1: [239, 240, 241, 242, 243], 2: [240], 3: [314], 4: [342, 347], 5: [342], 6: [451], 7: [470], 8: [480],
  9: [496], 10: [235], 11: [524], 12: [591], 13: [470], 14: [656], 15: [680], 16: [656],
};
const RANGED = { 2: 269, 5: 382, 8: 480, 11: 524, 14: 656, 16: 656 };
const TURRET = { 1: 269, 2: 269, 3: 733, 4: 733, 5: 733, 6: 745, 7: 496, 8: 496, 9: 496, 10: 843, 11: 843, 12: 843 };

export class Sound {
  constructor(meta, base = 'assets/') {
    this.files = meta.sounds || {};
    this.base = base;
    this.ctx = null;
    this.buf = {};
    this.pending = {};
    this.last = {};
    this.on = true;
    this.music = null;
    try { this.on = localStorage.getItem('aow-sound') !== '0'; } catch (e) { /* storage blocked */ }
  }

  /** Must be called from a user gesture (first tap/click). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('aow-sound', this.on ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.music) { if (this.on) this.music.play().catch(() => {}); else this.music.pause(); }
    return this.on;
  }

  startMusic() {
    if (!this.files['1035']) return;
    if (!this.music) {
      this.music = new Audio(this.base + this.files['1035']);
      this.music.loop = true;
      this.music.volume = 0.3;
      this.music.preload = 'none';
    }
    if (this.on) this.music.play().catch(() => {});
  }

  stopMusic() { if (this.music) this.music.pause(); }

  _load(id) {
    if (this.buf[id] || this.pending[id] || !this.files[id] || !this.ctx) return;
    this.pending[id] = fetch(this.base + this.files[id])
      .then(r => r.arrayBuffer())
      .then(a => new Promise((res, rej) => this.ctx.decodeAudioData(a, res, rej)))
      .then(b => { this.buf[id] = b; })
      .catch(() => {});
  }

  play(id, vol = 0.5) {
    if (!this.on || !this.ctx) return;
    const b = this.buf[id];
    if (!b) { this._load(id); return; }
    const now = this.ctx.currentTime;
    if (now - (this.last[id] || 0) < 0.07) return; // throttle identical sounds
    this.last[id] = now;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.buffer = b;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
  }

  /** Map a simulation event string to a sound. */
  event(ev) {
    if (ev.startsWith('hit')) {
      const l = MELEE[+ev.slice(3)];
      if (l) this.play(l[(Math.random() * l.length) | 0], 0.4);
    } else if (ev.startsWith('shoot')) {
      const s = RANGED[+ev.slice(5)];
      if (s) this.play(s, 0.35);
    } else if (ev.startsWith('turret')) {
      const s = TURRET[+ev.slice(6)];
      if (s) this.play(s, 0.3);
    } else if (ev === 'special') this.play(972, 0.6);
    else if (ev === 'evolve') this.play(1002, 0.7);
  }

  /** Preload the common effects after the first gesture so the first fight is not silent. */
  preload() { for (const id of Object.keys(this.files)) if (id !== '1035' && id !== '972') this._load(id); }
}
