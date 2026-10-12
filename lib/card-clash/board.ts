/**
 * The Card Clash board: grid, flip animation, HUD and timer, built as plain DOM
 * so the React app and the standalone prototype share one implementation.
 *
 * The board never knows a card's face until the server reveals it through
 * api.flip(), so there is nothing in the page to peek at.
 */
import { icon } from '../icons.ts';
import { VaultAudio } from './audio.ts';

export interface FlipResponse {
  face: number;
  result: 'first' | 'match' | 'mismatch';
  done: boolean;
  score: number;
  streak: number;
  matched: number;
  mismatches: number;
  final?: unknown;
}

export interface CardApi {
  /** Rejects with an Error, or with { final } when the server says time is up. */
  flip(index: number): Promise<FlipResponse>;
  finish(): Promise<unknown>;
}

export interface BoardOptions {
  cols: number;
  rows: number;
  pairs: number;
  timeLimitMs: number;
  api: CardApi;
  sound: boolean;
  onEnd: (final: unknown) => void;
  onError: (message: string) => void;
}

/** One icon per face, chosen to read clearly on the ivory card. Order matches the deck's face ids. */
export const FACE_ICONS = ['coin', 'star', 'gem', 'bolt', 'heart', 'gift', 'trophy', 'flame', 'shield', 'target'];

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class CardBoard {
  private root: HTMLElement;
  private audio = new VaultAudio();
  private o: BoardOptions | null = null;
  private cards: HTMLButtonElement[] = [];
  private grid: HTMLElement | null = null;
  private upSet = new Set<number>();
  private matchedSet = new Set<number>();
  private pending: number | null = null;
  private busy = false;
  private active = false;
  private t0 = 0;
  private raf = 0;
  private lastTick = -1;
  private lastScore = 0;
  private timers: number[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
  }

  setSound(on: boolean) { this.audio.enabled = on; }
  unlockAudio() { this.audio.unlock(); }

  start(o: BoardOptions) {
    this.stop();
    this.o = o;
    this.audio.enabled = o.sound;
    this.audio.unlock();
    this.root.classList.remove('low');
    this.upSet.clear(); this.matchedSet.clear();
    this.pending = null; this.busy = false; this.lastScore = 0; this.lastTick = -1;

    const total = o.cols * o.rows;
    this.root.innerHTML =
      `<div class="vb-hud">` +
        `<div class="vb-stat"><span class="vb-label">Score</span><span class="vb-val" data-k="score">0</span></div>` +
        `<div class="vb-time"><div class="vb-timebar"><i data-k="bar"></i></div><span class="vb-clock" data-k="time">${fmt(o.timeLimitMs)}</span></div>` +
        `<div class="vb-stat vb-right"><span class="vb-label">Pairs</span><span class="vb-val" data-k="pairs">0/${o.pairs}</span></div>` +
      `</div>` +
      `<div class="vb-grid" style="--cols:${o.cols}" role="group" aria-label="Cards">` +
        Array.from({ length: total }, (_, i) =>
          `<button class="vcard" type="button" data-i="${i}" aria-label="Card ${i + 1}, face down"><span class="vcard-inner"><span class="vcard-back"></span><span class="vcard-front"></span></span></button>`,
        ).join('') +
      `</div>` +
      `<div class="vb-foot"><span data-k="streak"></span><span data-k="mistakes">No mistakes yet</span></div>` +
      `<div class="vb-live" aria-live="polite" data-k="live"></div>`;
    this.grid = this.root.querySelector('.vb-grid');
    this.cards = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.vcard'));
    this.cards.forEach((c, i) => c.addEventListener('click', () => this.click(i)));

    this.active = true;
    this.t0 = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  destroy() { this.stop(); this.audio.close(); }

  private later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private q(k: string) { return this.root.querySelector<HTMLElement>(`[data-k="${k}"]`); }
  private say(msg: string) { const el = this.q('live'); if (el) el.textContent = msg; }

  // ------------------------------------------------------------------ clock
  private loop = (now: number) => {
    const o = this.o;
    if (!this.active || !o) return;
    const left = o.timeLimitMs - (now - this.t0);
    const bar = this.q('bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (left / o.timeLimitMs) * 100))}%`;
    const secs = Math.ceil(left / 1000);
    if (secs !== this.lastTick) {
      this.lastTick = secs;
      const t = this.q('time');
      if (t) t.textContent = fmt(left);
      if (secs <= 10 && secs > 0) { this.root.classList.add('low'); this.audio.tick(); }
    }
    if (left <= 0) { void this.timeUp(); return; }
    this.raf = requestAnimationFrame(this.loop);
  };

  private async timeUp() {
    const o = this.o;
    if (!o || !this.active) return;
    this.active = false;
    this.audio.lose();
    this.say('Time is up.');
    // The server decides when time is up; retry briefly if our clock was a touch ahead.
    for (let n = 0; n < 4; n++) {
      try { o.onEnd(await o.api.finish()); return; } catch { await new Promise((r) => setTimeout(r, 700)); }
    }
    o.onError('Could not close the run. Check your connection.');
  }

  // ------------------------------------------------------------------ flipping
  private async click(i: number) {
    const o = this.o;
    if (!o || !this.active || this.busy || this.upSet.has(i) || this.matchedSet.has(i)) return;
    this.busy = true;
    const card = this.cards[i];
    card.classList.add('wait');
    this.audio.flip();
    try {
      const r = await o.api.flip(i);
      card.classList.remove('wait');
      this.reveal(i, r.face);
      this.apply(i, r);
    } catch (e) {
      card.classList.remove('wait');
      this.busy = false;
      const err = e as { final?: unknown; message?: string };
      if (err && err.final !== undefined) { this.active = false; this.audio.lose(); o.onEnd(err.final); return; }
      o.onError(err?.message === 'too_fast' ? 'Easy there, one flip at a time.' : 'Could not flip that card. Try again.');
    }
  }

  private reveal(i: number, face: number) {
    const card = this.cards[i];
    const front = card.querySelector('.vcard-front');
    if (front) front.innerHTML = icon(FACE_ICONS[face] ?? 'star', 60);
    card.classList.add('up');
    card.setAttribute('aria-label', `Card ${i + 1}, ${FACE_ICONS[face] ?? 'card'}`);
    this.upSet.add(i);
  }

  private hide(i: number) {
    const card = this.cards[i];
    card.classList.remove('up');
    this.upSet.delete(i);
    card.setAttribute('aria-label', `Card ${i + 1}, face down`);
    // Clear the face once the card has turned over, so a hidden card holds no information.
    this.later(() => { if (!this.upSet.has(i)) { const f = card.querySelector('.vcard-front'); if (f) f.innerHTML = ''; } }, 480);
  }

  private apply(i: number, r: FlipResponse) {
    const o = this.o!;
    this.q('score')!.textContent = r.score.toLocaleString();
    this.q('pairs')!.textContent = `${r.matched}/${o.pairs}`;
    this.q('mistakes')!.textContent = r.mismatches ? `${r.mismatches} mistake${r.mismatches === 1 ? '' : 's'}` : 'No mistakes yet';
    this.q('streak')!.textContent = r.streak >= 2 ? `Streak x${r.streak}` : '';

    if (r.result === 'first') { this.pending = i; this.busy = false; return; }

    const a = this.pending!;
    this.pending = null;
    if (r.result === 'match') {
      const gained = r.score - this.lastScore;
      this.later(() => {
        [a, i].forEach((k) => { this.cards[k].classList.add('matched'); this.matchedSet.add(k); });
        this.float(i, `+${gained}`);
        this.audio.match(r.streak - 1);
        this.say(`Match. ${r.matched} of ${o.pairs} pairs found.`);
      }, 380);
      this.lastScore = r.score;
      this.later(() => { this.busy = false; }, 420);
      if (r.done) {
        this.active = false;
        this.q('time')!.textContent = 'Cleared';
        this.later(() => { this.audio.win(); }, 500);
        this.later(() => o.onEnd(r.final), 1300);
      }
      return;
    }
    // mismatch: show both faces briefly, then turn them back
    this.lastScore = r.score;
    this.later(() => {
      this.audio.mismatch();
      [a, i].forEach((k) => { this.cards[k].classList.add('miss'); });
    }, 480);
    this.later(() => {
      [a, i].forEach((k) => { this.cards[k].classList.remove('miss'); this.hide(k); });
      this.busy = false;
    }, 950);
  }

  private float(i: number, text: string) {
    if (!this.grid) return;
    const c = this.cards[i];
    const f = document.createElement('span');
    f.className = 'vfloat';
    f.textContent = text;
    f.style.left = `${c.offsetLeft + c.offsetWidth / 2}px`;
    f.style.top = `${c.offsetTop + c.offsetHeight / 3}px`;
    this.grid.appendChild(f);
    this.later(() => f.remove(), 950);
  }
}
