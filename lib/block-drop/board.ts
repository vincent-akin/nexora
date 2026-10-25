/**
 * The Block Drop board: canvas drawing, keyboard and touch input, animation and sound. It runs the
 * same BlockSim the server replays, and hands over its action log when the run ends. The server's
 * answer is the one that counts.
 */
import {
  BlockSim, COLS, ROWS, RUN_CAP_MS, COLOUR_OF, shapeOf, summarize,
  type Action, type ActionCode, type BlockEvent, type BlockSpec, type BlockSummary, type PieceType,
} from './core.ts';
import { Sfx } from '../sfx.ts';

export interface BlockTheme { skin?: { theme?: string }; sound?: { set?: string } }

export interface BlockBoardOptions {
  seed: number;
  spec: BlockSpec;
  sound: boolean;
  theme?: BlockTheme;
  onFinish: (info: { actions: Action[]; local: BlockSummary }) => void;
}

/** Colours by board value 1 to 7 (I O T S Z J L). Skins swap the whole set. */
const PALETTES: Record<string, string[]> = {
  default: ['', '#29E0FF', '#FFD23F', '#B054E8', '#9BE82B', '#FF4D6D', '#5B8CFF', '#FFA02E'],
  emerald: ['', '#3DDC97', '#F2C14E', '#1FA86B', '#B8F26A', '#E0B33A', '#2BB3A0', '#8FD694'],
  obsidian: ['', '#C9D1DE', '#E8ECF3', '#8E98AB', '#AAB3C4', '#6F7A8E', '#9AA6BC', '#D7DCE6'],
};

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (k > 0 ? (255 - v) * k : v * k))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; colour: string; size: number }

export class BlockBoard {
  private root: HTMLElement;
  private sfx = new Sfx();
  private o: BlockBoardOptions | null = null;
  private sim: BlockSim | null = null;
  private actions: Action[] = [];
  private t0 = 0;
  private raf = 0;
  private finished = false;
  private canvas: HTMLCanvasElement | null = null;
  private next: HTMLCanvasElement | null = null;
  private holdC: HTMLCanvasElement | null = null;
  private cell = 24;
  private palette = PALETTES.default;
  private sparks: Spark[] = [];
  private flashes: { rows: number[]; at: number; lines: number }[] = [];
  private shakeUntil = 0;
  private banner: { text: string; at: number } | null = null;
  private lastHud = '';
  private cleanup: (() => void)[] = [];
  private timers: number[] = [];
  private reduced = false;

  constructor(root: HTMLElement) { this.root = root; }

  setSound(on: boolean) { this.sfx.enabled = on; }
  unlockAudio() { this.sfx.unlock(); }

  start(o: BlockBoardOptions) {
    this.stop();
    this.o = o;
    this.sfx.enabled = o.sound;
    this.sfx.unlock();
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.palette = PALETTES[o.theme?.skin?.theme ?? 'default'] ?? PALETTES.default;
    this.sim = new BlockSim(o.seed, o.spec);
    this.actions = []; this.finished = false; this.sparks = []; this.flashes = []; this.banner = null; this.lastHud = '';

    this.root.innerHTML =
      `<div class="bd-hud">` +
        `<div class="bd-stat"><span class="bd-label">Level</span><span class="bd-val" data-k="level">${this.sim.level}</span></div>` +
        `<div class="bd-stat"><span class="bd-label">Score</span><span class="bd-val" data-k="score">0</span></div>` +
        `<div class="bd-stat"><span class="bd-label">Lines</span><span class="bd-val" data-k="lines">0</span></div>` +
        `<div class="bd-stat"><span class="bd-label">Time</span><span class="bd-val" data-k="time">2:30</span></div>` +
      `</div>` +
      `<div class="bd-play">` +
        `<div class="bd-side"><span class="bd-label">Hold</span><canvas data-k="hold" width="84" height="84" aria-label="Held piece"></canvas></div>` +
        `<div class="bd-well"><canvas data-k="well" aria-label="Playing field"></canvas><div class="bd-banner" data-k="banner" aria-live="polite"></div></div>` +
        `<div class="bd-side"><span class="bd-label">Next</span><canvas data-k="next" width="84" height="252" aria-label="Next pieces"></canvas></div>` +
      `</div>` +
      `<div class="bd-pad" role="group" aria-label="Touch controls">` +
        `<button type="button" data-act="L" aria-label="Move left">&#9664;</button>` +
        `<button type="button" data-act="CCW" aria-label="Rotate left">&#8634;</button>` +
        `<button type="button" data-act="HD" aria-label="Drop" class="big">DROP</button>` +
        `<button type="button" data-act="CW" aria-label="Rotate right">&#8635;</button>` +
        `<button type="button" data-act="R" aria-label="Move right">&#9654;</button>` +
        `<button type="button" data-act="SD" aria-label="Soft drop">&#9660;</button>` +
        `<button type="button" data-act="H" aria-label="Hold piece">HOLD</button>` +
      `</div>` +
      `<p class="bd-keys">Arrows move, Up or X rotate, Z rotate back, Space drops, C holds.</p>`;

    this.canvas = this.q<HTMLCanvasElement>('well');
    this.next = this.q<HTMLCanvasElement>('next');
    this.holdC = this.q<HTMLCanvasElement>('hold');
    this.resize();

    const KEYS: Record<string, ActionCode> = {
      ArrowLeft: 'L', ArrowRight: 'R', ArrowDown: 'SD', ArrowUp: 'CW', x: 'CW', X: 'CW', z: 'CCW', Z: 'CCW', ' ': 'HD', c: 'H', C: 'H', Shift: 'H',
    };
    const keydown = (e: KeyboardEvent) => {
      if (this.finished || e.ctrlKey || e.metaKey || e.altKey) return;
      const a = KEYS[e.key];
      if (!a) return;
      e.preventDefault();
      // Hard drop and hold fire once per press; movement may repeat while the key is held.
      if (e.repeat && (a === 'HD' || a === 'H' || a === 'CW' || a === 'CCW')) return;
      this.act(a, e.timeStamp - this.t0);
    };
    window.addEventListener('keydown', keydown);
    this.cleanup.push(() => window.removeEventListener('keydown', keydown));

    // Touch and mouse buttons. Movement buttons repeat while held.
    this.root.querySelectorAll<HTMLButtonElement>('.bd-pad button').forEach((btn) => {
      const a = btn.dataset.act as ActionCode;
      let rep = 0;
      const down = (e: Event) => {
        e.preventDefault();
        this.act(a, performance.now() - this.t0);
        if (a === 'L' || a === 'R' || a === 'SD') { window.clearInterval(rep); rep = window.setInterval(() => this.act(a, performance.now() - this.t0), a === 'SD' ? 55 : 95); }
      };
      const up = () => window.clearInterval(rep);
      btn.addEventListener('pointerdown', down);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, up));
      this.cleanup.push(() => { up(); btn.removeEventListener('pointerdown', down); });
    });
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.cleanup.push(() => window.removeEventListener('resize', onResize));

    this.t0 = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
  }

  destroy() { this.stop(); this.sfx.close(); }

  private q<T extends HTMLElement = HTMLElement>(k: string): T | null { return this.root.querySelector<T>(`[data-k="${k}"]`); }
  private later(fn: () => void, ms: number) { this.timers.push(window.setTimeout(fn, ms)); }

  private resize() {
    const c = this.canvas;
    if (!c) return;
    const availW = Math.max(160, (this.root.clientWidth || 420) - 2 * 96);
    const availH = Math.max(320, Math.min(window.innerHeight * 0.62, 640));
    this.cell = Math.max(14, Math.floor(Math.min(availW / COLS, availH / ROWS)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = COLS * this.cell * dpr; c.height = ROWS * this.cell * dpr;
    c.style.width = `${COLS * this.cell}px`; c.style.height = `${ROWS * this.cell}px`;
    c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------------ input
  private act(a: ActionCode, rawT: number) {
    const sim = this.sim;
    if (!sim || this.finished) return;
    // Never go back in time: the log and the live simulation must agree exactly.
    const t = Math.round(Math.max(rawT, sim.now) * 10) / 10;
    this.actions.push({ a, t });
    const moved = sim.act(a, t);
    if (moved) {
      if (a === 'L' || a === 'R') this.sfx.tone(this.chimes ? 880 : 240, 0.03, this.chimes ? 'sine' : 'square', 0.03);
      else if (a === 'CW' || a === 'CCW') this.sfx.tone(this.chimes ? 1175 : 520, 0.05, this.chimes ? 'sine' : 'triangle', 0.05);
      else if (a === 'H') this.sfx.tone(660, 0.08, 'triangle', 0.06, 0, 880);
      else if (a === 'HD') this.sfx.tone(220, 0.1, 'sawtooth', 0.08, 0, 70);
    }
    this.handle(sim.drain(), t);
    if (sim.ended) this.end();
  }

  private get chimes() { return this.o?.theme?.sound?.set === 'chimes'; }

  // ------------------------------------------------------------------ frame loop
  private loop = (now: number) => {
    const sim = this.sim;
    if (!sim || this.finished) return;
    const t = now - this.t0;
    sim.advance(t);
    this.handle(sim.drain(), t);
    this.draw(t);
    if (sim.ended) { this.end(); return; }
    this.raf = requestAnimationFrame(this.loop);
  };

  // ------------------------------------------------------------------ outcomes
  private handle(events: BlockEvent[], t: number) {
    for (const e of events) {
      if (e.type === 'lock') {
        this.sfx.tone(this.chimes ? 700 : 150, 0.09, this.chimes ? 'sine' : 'triangle', 0.08, 0, this.chimes ? undefined : 90);
      } else if (e.type === 'clear') {
        this.flashes.push({ rows: e.rows, at: t, lines: e.lines });
        const col = this.palette;
        if (!this.reduced) {
          for (const y of e.rows) for (let x = 0; x < COLS; x++) {
            for (let k = 0; k < 2; k++) this.sparks.push({
              x: (x + 0.5) * this.cell, y: (y + 0.5) * this.cell, vx: (Math.random() - 0.5) * 340, vy: -80 - Math.random() * 280,
              life: 0, max: 600 + Math.random() * 500, colour: col[1 + ((x + y + k) % 7)], size: 3 + Math.random() * 4,
            });
          }
          if (e.lines >= 4) this.shakeUntil = t + 380;
        }
        const base = 440 * 2 ** (Math.min(this.sim?.level ?? 1, 15) / 30);
        const notes = [1, 1.25, 1.5, 2].slice(0, Math.min(4, e.lines + 1));
        this.sfx.arpeggio(notes.map((n) => base * n), 0.05, this.chimes ? 'sine' : 'triangle', 0.12);
        if (e.lines === 4) this.say('BLOCK DROP!', t);
        else if (e.combo >= 2) this.say(`Combo x${e.combo}`, t);
      } else if (e.type === 'level') {
        this.say(`Level ${e.level}`, t, 'Faster');
        this.sfx.arpeggio([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.07, 'triangle', 0.12);
      } else if (e.type === 'second') {
        this.say('Second chance', t, 'Top half cleared');
        this.sfx.tone(200, 0.5, 'sawtooth', 0.1, 0, 1200);
        if (!this.reduced) this.shakeUntil = t + 300;
      }
    }
  }

  private say(text: string, _t: number, sub?: string) {
    const b = this.q('banner');
    if (!b) return;
    b.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    this.later(() => b.classList.remove('show'), 1500);
  }

  // ------------------------------------------------------------------ drawing
  private block(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string, alpha = 1) {
    ctx.globalAlpha = alpha;
    const r = Math.max(2, size * 0.18), pad = 1;
    const g = ctx.createLinearGradient(x, y, x, y + size);
    g.addColorStop(0, shade(colour, 0.38)); g.addColorStop(0.5, colour); g.addColorStop(1, shade(colour, -0.32));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x + pad, y + pad, size - pad * 2, size - pad * 2, r); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x + pad + 1, y + pad + 1, size - pad * 2 - 2, (size - pad * 2) * 0.42, r); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private draw(t: number) {
    const sim = this.sim, c = this.canvas;
    if (!sim || !c) return;
    const ctx = c.getContext('2d')!;
    const S = this.cell, W = COLS * S, H = ROWS * S;
    const hue = (sim.level * 26) % 360;
    ctx.save();
    if (t < this.shakeUntil) ctx.translate((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
    // The background shifts colour with every level, so progress is visible without reading a number.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, `hsl(${hue} 55% 14%)`); bg.addColorStop(1, `hsl(${(hue + 40) % 360} 60% 7%)`);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 1; x < COLS; x++) { ctx.moveTo(x * S + 0.5, 0); ctx.lineTo(x * S + 0.5, H); }
    for (let y = 1; y < ROWS; y++) { ctx.moveTo(0, y * S + 0.5); ctx.lineTo(W, y * S + 0.5); }
    ctx.stroke();

    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const v = sim.board[y][x]; if (v) this.block(ctx, x * S, y * S, S, this.palette[v]); }

    if (!sim.ended) {
      const p = sim.piece, col = this.palette[COLOUR_OF[p.type]];
      const gy = sim.ghostY();
      for (const [cx, cy] of shapeOf(p.type, p.rot)) {
        if (gy + cy >= 0) { ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.strokeRect((p.x + cx) * S + 3, (gy + cy) * S + 3, S - 6, S - 6); ctx.globalAlpha = 1; }
      }
      for (const [cx, cy] of shapeOf(p.type, p.rot)) if (p.y + cy >= 0) this.block(ctx, (p.x + cx) * S, (p.y + cy) * S, S, col);
    }

    this.flashes = this.flashes.filter((f) => t - f.at < 320);
    for (const f of this.flashes) {
      const k = (t - f.at) / 320;
      ctx.fillStyle = `rgba(255,255,255,${(1 - k) * 0.85})`;
      for (const y of f.rows) ctx.fillRect(0, y * S, W, S);
    }
    const dt = 16;
    this.sparks = this.sparks.filter((s) => s.life < s.max);
    for (const s of this.sparks) {
      s.life += dt; s.vy += 900 * (dt / 1000); s.x += s.vx * (dt / 1000); s.y += s.vy * (dt / 1000);
      ctx.globalAlpha = Math.max(0, 1 - s.life / s.max); ctx.fillStyle = s.colour;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (1 - s.life / s.max * 0.5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    c.parentElement!.style.setProperty('--hue', String(hue));
    this.drawPreview(this.next, sim.queue.slice(0, 3), 84);
    this.drawPreview(this.holdC, sim.hold ? [sim.hold] : [], 84);

    const left = RUN_CAP_MS - t;
    const hud = `${sim.level}|${sim.score}|${sim.lines}|${Math.ceil(left / 1000)}`;
    if (hud !== this.lastHud) {
      this.lastHud = hud;
      this.q('level')!.textContent = String(sim.level);
      this.q('score')!.textContent = sim.score.toLocaleString();
      this.q('lines')!.textContent = String(sim.lines);
      const s = Math.max(0, Math.ceil(left / 1000));
      this.q('time')!.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
  }

  private drawPreview(c: HTMLCanvasElement | null, pieces: PieceType[], size: number) {
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const s = 18;
    pieces.forEach((type, i) => {
      const cells = shapeOf(type, 0);
      const minX = Math.min(...cells.map((q) => q[0])), maxX = Math.max(...cells.map((q) => q[0]));
      const minY = Math.min(...cells.map((q) => q[1]));
      const ox = (size - (maxX - minX + 1) * s) / 2 - minX * s;
      for (const [cx, cy] of cells) this.block(ctx, ox + cx * s, 8 + i * 80 + (cy - minY) * s + 12, s, this.palette[COLOUR_OF[type]]);
    });
  }

  // ------------------------------------------------------------------ end
  private end() {
    const o = this.o, sim = this.sim;
    if (!o || !sim || this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.raf);
    if (sim.endReason === 'topout') this.sfx.arpeggio([392, 330, 262, 196], 0.14, 'sawtooth', 0.09);
    else this.sfx.arpeggio([523.25, 659.25, 783.99, 1046.5], 0.09);
    this.draw(sim.endedAt ?? 0);
    this.later(() => o.onFinish({ actions: this.actions, local: summarize(sim) }), 800);
  }
}
