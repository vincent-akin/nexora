/**
 * The Market Detective board: one round at a time, as chart cards. The server
 * hands out each round and times each answer, and reveals the right answer
 * only after the player has committed. Plain DOM, shared by the app and the
 * standalone prototype.
 *
 * The charts show TEST DATA (made-up companies, generated prices).
 */
import { Sfx } from '../sfx.ts';
import type { PublicRound } from './core.ts';

export interface AnswerResponse {
  correct: boolean;
  answerIndex: number;
  metrics: number[];
  score: number;
  correctCount: number;
  streak: number;
  done: boolean;
  final?: unknown;
}

export interface DetectiveApi {
  round(n: number): Promise<{ round: PublicRound; remainingMs: number }>;
  answer(choice: number): Promise<AnswerResponse>;
}

export interface DetectiveTheme { skin?: { theme?: string } }

export interface DetectiveOptions {
  rounds: number;
  roundMs: number;
  api: DetectiveApi;
  sound: boolean;
  theme?: DetectiveTheme;
  onEnd: (final: unknown) => void;
  onError: (message: string) => void;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

export class DetectiveBoard {
  private root: HTMLElement;
  private sfx = new Sfx();
  private o: DetectiveOptions | null = null;
  private round: PublicRound | null = null;
  private n = 0;
  private locked = false;
  private active = false;
  private endsAt = 0;
  private raf = 0;
  private lastSec = -1;
  private timers: number[] = [];

  constructor(root: HTMLElement) { this.root = root; }

  setSound(on: boolean) { this.sfx.enabled = on; }
  unlockAudio() { this.sfx.unlock(); }

  start(o: DetectiveOptions) {
    this.stop();
    this.o = o;
    this.sfx.enabled = o.sound;
    this.sfx.unlock();
    this.n = 0; this.locked = false; this.active = true;
    this.root.classList.remove('low', 'theme-slate', 'theme-gold');
    const frame = this.root.parentElement;
    frame?.classList.remove('theme-slate', 'theme-gold');
    const theme = o.theme?.skin?.theme;
    if (theme) { this.root.classList.add(`theme-${theme}`); frame?.classList.add(`theme-${theme}`); }
    this.root.innerHTML =
      `<div class="dk-hud">` +
        `<div class="dk-stat"><span class="dk-label">Round</span><span class="dk-val" data-k="round">1/${o.rounds}</span></div>` +
        `<div class="dk-time"><div class="dk-bar"><i data-k="bar"></i></div><span class="dk-clock" data-k="clock">${secs(o.roundMs)}</span></div>` +
        `<div class="dk-stat dk-right"><span class="dk-label">Score</span><span class="dk-val" data-k="score">0</span></div>` +
      `</div>` +
      `<p class="dk-badge">Test data: made-up companies and generated prices</p>` +
      `<h2 class="dk-prompt" data-k="prompt" aria-live="polite"></h2>` +
      `<div class="dk-grid" data-k="grid" role="group" aria-label="Stocks"></div>` +
      `<div class="dk-foot"><span data-k="streak"></span><span data-k="msg" role="status"></span></div>`;
    void this.load();
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  destroy() { this.stop(); this.sfx.close(); }

  private q<T extends HTMLElement = HTMLElement>(k: string): T | null { return this.root.querySelector<T>(`[data-k="${k}"]`); }
  private later(fn: () => void, ms: number) { this.timers.push(window.setTimeout(fn, ms)); }

  private async load() {
    const o = this.o;
    if (!o || !this.active) return;
    try {
      const { round, remainingMs } = await o.api.round(this.n);
      this.round = round;
      this.draw(round);
      this.locked = false;
      this.endsAt = performance.now() + remainingMs;
      this.lastSec = -1;
      this.root.classList.remove('low');
      this.q('round')!.textContent = `${this.n + 1}/${o.rounds}`;
      this.q('msg')!.textContent = '';
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.loop);
    } catch {
      this.active = false;
      o.onError('Could not load the next round. Check your connection.');
    }
  }

  /** Draws every chart on one shared scale, so heights compare fairly. */
  private draw(r: PublicRound) {
    this.q('prompt')!.textContent = r.prompt;
    const all = r.options.flatMap((x) => x.series);
    const lo = Math.min(...all), hi = Math.max(...all);
    const W = 220, H = 96, pad = 6;
    const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
    const x = (i: number, n: number) => pad + (i / (n - 1)) * (W - pad * 2);
    const base = y(100);
    const grid = this.q('grid')!;
    grid.style.setProperty('--n', String(r.options.length));
    grid.innerHTML = r.options.map((opt, i) => {
      const pts = opt.series.map((v, k) => `${x(k, opt.series.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      const out = !!r.crossedOut?.includes(i);
      return `<button class="dk-card${out ? ' out' : ''}" type="button" data-i="${i}"${out ? ' disabled' : ''} aria-label="${esc(opt.name)}, ${esc(opt.ticker)}${out ? ', crossed out' : ''}">` +
        `<span class="dk-head"><b>${esc(opt.ticker)}</b><small>${esc(opt.name)}</small></span>` +
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${base.toFixed(1)}" y2="${base.toFixed(1)}" class="dk-base"/><polyline points="${pts}" class="dk-line"/></svg>` +
        `<span class="dk-metric" data-m></span></button>`;
    }).join('');
    grid.querySelectorAll<HTMLButtonElement>('.dk-card').forEach((c) => c.addEventListener('click', () => void this.choose(Number(c.dataset.i))));
  }

  private loop = (now: number) => {
    const o = this.o;
    if (!o || !this.active || this.locked) return;
    const left = this.endsAt - now;
    const bar = this.q('bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (left / o.roundMs) * 100))}%`;
    const s = secs(left);
    if (s !== this.lastSec) {
      this.lastSec = s;
      this.q('clock')!.textContent = String(s);
      if (s <= 5 && s > 0) { this.root.classList.add('low'); this.sfx.tone(980, 0.04, 'square', 0.04); }
    }
    if (left <= 0) { void this.choose(-1); return; }
    this.raf = requestAnimationFrame(this.loop);
  };

  private async choose(choice: number) {
    const o = this.o;
    if (!o || !this.active || this.locked || !this.round) return;
    this.locked = true;
    cancelAnimationFrame(this.raf);
    const cards = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.dk-card'));
    cards.forEach((c) => (c.disabled = true));
    if (choice >= 0) cards[choice]?.classList.add('picked');
    try {
      const r = await o.api.answer(choice);
      const kind = this.round.kind;
      cards.forEach((c, i) => {
        const m = c.querySelector<HTMLElement>('[data-m]');
        if (m) m.textContent = kind === 'most_volatile' ? `Volatility ${r.metrics[i].toFixed(1)}` : `${r.metrics[i] >= 0 ? '+' : ''}${r.metrics[i].toFixed(1)}%`;
        c.classList.add('revealed');
        if (i === r.answerIndex) c.classList.add('right');
        else if (i === choice) c.classList.add('wrong');
      });
      this.q('score')!.textContent = r.score.toLocaleString();
      this.q('streak')!.textContent = r.streak >= 2 ? `Streak x${r.streak}` : '';
      this.q('msg')!.textContent = choice < 0 ? 'Time is up.' : r.correct ? 'Correct.' : 'Not this time.';
      if (r.correct) this.sfx.arpeggio([659.25, 880], 0.08, 'triangle', 0.13);
      else this.sfx.tone(180, 0.2, 'sawtooth', 0.07, 0, 110);
      if (r.done) {
        this.active = false;
        this.later(() => o.onEnd(r.final), 1700);
      } else {
        this.n += 1;
        this.later(() => void this.load(), 1700);
      }
    } catch {
      this.locked = false;
      cards.forEach((c) => (c.disabled = false));
      o.onError('Could not submit that answer. Try again.');
      this.endsAt = performance.now() + 4000;
      this.raf = requestAnimationFrame(this.loop);
    }
  }
}
