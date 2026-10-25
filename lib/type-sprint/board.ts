/**
 * The Type Sprint board: words fall, letters fly off as they are typed, and every outcome has its
 * own motion and sound. Plain DOM, so the React app and any standalone page share it.
 *
 * It never decides the result. It runs the same SprintSim the server replays, and hands over its
 * keystroke log when the run ends; the server's answer is the one that counts.
 */
import { RUN_CAP_MS, SprintSim, summarize, type Key, type SprintEvent, type SprintSpec, type SprintSummary, type WordInst } from './core.ts';
import { Sfx } from '../sfx.ts';
import { icon } from '../icons.ts';

export interface SprintTheme { skin?: { theme?: string }; sound?: { keys?: string } }

export interface TypeBoardOptions {
  seed: number;
  spec: SprintSpec;
  sound: boolean;
  theme?: SprintTheme;
  onFinish: (info: { keys: Key[]; local: SprintSummary }) => void;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** A pentatonic scale, so a run of correct letters sounds like a tune and never clashes. */
const SCALE = [0, 2, 4, 7, 9];
const note = (semi: number, base = 392) => base * 2 ** (semi / 12);
const PARTICLE_COLOURS = ['#5CFFB0', '#FFD23F', '#7DE3FF', '#FF7AD9', '#B6F23A'];

export class TypeBoard {
  private root: HTMLElement;
  private sfx = new Sfx();
  private o: TypeBoardOptions | null = null;
  private sim: SprintSim | null = null;
  private keys: Key[] = [];
  private t0 = 0;
  private raf = 0;
  private finished = false;
  private input: HTMLInputElement | null = null;
  private arena: HTMLElement | null = null;
  private els = new Map<string, HTMLElement>();
  private cleanup: (() => void)[] = [];
  private timers: number[] = [];
  private lastSecond = -1;
  private reduced = false;
  private maxLives = 3;

  constructor(root: HTMLElement) { this.root = root; }

  setSound(on: boolean) { this.sfx.enabled = on; }
  unlockAudio() { this.sfx.unlock(); }
  focus() { this.input?.focus({ preventScroll: true }); }

  start(o: TypeBoardOptions) {
    this.stop();
    this.o = o;
    this.sfx.enabled = o.sound;
    this.sfx.unlock();
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.sim = new SprintSim(o.seed, o.spec);
    this.keys = []; this.finished = false; this.lastSecond = -1; this.els.clear();
    this.maxLives = this.sim.lives;
    this.root.classList.remove('low', 'theme-amber', 'theme-ice');
    const frame = this.root.parentElement;
    frame?.classList.remove('theme-amber', 'theme-ice');
    const theme = o.theme?.skin?.theme;
    if (theme) { this.root.classList.add(`theme-${theme}`); frame?.classList.add(`theme-${theme}`); }

    const hearts = Array.from({ length: this.maxLives }, () => `<i class="ts-heart">${icon('heart', 20)}</i>`).join('');
    this.root.innerHTML =
      `<div class="ts-hud">` +
        `<div class="ts-stat"><span class="ts-label">Level</span><span class="ts-val" data-k="level">${this.sim.level}</span></div>` +
        `<div class="ts-time"><div class="ts-hearts" data-k="hearts" aria-label="Lives">${hearts}</div><div class="ts-bar"><i data-k="bar"></i></div></div>` +
        `<div class="ts-stat ts-right"><span class="ts-label">Score</span><span class="ts-val" data-k="score">0</span></div>` +
      `</div>` +
      `<div class="ts-arena" data-k="arena"><div class="ts-ready" data-k="ready">Get ready</div><div class="ts-banner" data-k="banner" aria-live="polite"></div><div class="ts-floor"></div></div>` +
      `<div class="ts-foot"><span data-k="streak"></span><span data-k="wpm">0 wpm</span><span data-k="time">${clock(RUN_CAP_MS)}</span></div>` +
      `<input class="ts-input" data-k="input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Type the falling words">` +
      `<button class="ts-focus" type="button" data-k="focus">Click here to type</button>`;

    this.arena = this.q('arena');
    this.input = this.q<HTMLInputElement>('input');
    const input = this.input!;
    const focusBtn = this.q('focus')!;
    const keydown = (e: KeyboardEvent) => {
      if (this.finished || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); this.press(e.key.toLowerCase(), e.timeStamp - this.t0); }
      else if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
    };
    // Phone keyboards often send "input" rather than useful keydowns.
    const onInput = () => {
      const v = input.value.toLowerCase();
      input.value = '';
      for (const c of v) if (/^[a-z]$/.test(c)) this.press(c, performance.now() - this.t0);
    };
    const onFocus = () => focusBtn.classList.add('hidden');
    const onBlur = () => { if (!this.finished) focusBtn.classList.remove('hidden'); };
    const onTap = () => input.focus({ preventScroll: true });
    input.addEventListener('keydown', keydown);
    input.addEventListener('input', onInput);
    input.addEventListener('focus', onFocus);
    input.addEventListener('blur', onBlur);
    focusBtn.addEventListener('click', onTap);
    this.arena!.addEventListener('click', onTap);
    this.cleanup.push(() => { input.removeEventListener('keydown', keydown); input.removeEventListener('input', onInput); input.removeEventListener('focus', onFocus); input.removeEventListener('blur', onBlur); });
    input.focus({ preventScroll: true });

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
  private key(w: WordInst) { return `${w.stage}:${w.index}`; }

  // ------------------------------------------------------------------ input
  private press(c: string, rawT: number) {
    const sim = this.sim;
    if (!sim || this.finished) return;
    // Never go back in time: the log and the live simulation must agree exactly.
    const t = Math.round(Math.max(rawT, sim.now) * 10) / 10;
    this.keys.push({ c, t });
    sim.press(c, t);
    this.handle(sim.drain());
    this.paint(t);
    if (sim.ended) this.end();
  }

  // ------------------------------------------------------------------ frame loop
  private loop = (now: number) => {
    const sim = this.sim;
    if (!sim || this.finished) return;
    const t = now - this.t0;
    sim.advance(t);
    this.handle(sim.drain());
    this.paint(t);
    if (sim.ended) { this.end(); return; }
    this.raf = requestAnimationFrame(this.loop);
  };

  private paint(t: number) {
    const sim = this.sim, arena = this.arena;
    if (!sim || !arena) return;
    const H = arena.clientHeight, W = arena.clientWidth;
    this.q('level')!.textContent = String(sim.level);
    this.q('score')!.textContent = sim.score.toLocaleString();
    this.q('streak')!.textContent = sim.streak >= 5 ? `Streak ${sim.streak}` : '';
    const left = RUN_CAP_MS - t;
    this.q('bar')!.style.width = `${Math.max(0, Math.min(100, (left / RUN_CAP_MS) * 100))}%`;
    const secs = Math.ceil(left / 1000);
    if (secs !== this.lastSecond) {
      this.lastSecond = secs;
      this.q('time')!.textContent = clock(left);
      const mins = Math.max(10_000, t) / 60_000;
      this.q('wpm')!.textContent = `${Math.round(sim.correct / 5 / mins)} wpm`;
      if (secs <= 10 && secs > 0) { this.root.classList.add('low'); this.sfx.tone(980, 0.04, 'square', 0.04); }
    }
    if (t > 1200) this.q('ready')?.classList.add('gone');

    for (const w of sim.words) {
      if (w.status !== 'falling' || w.spawnT > t) continue;
      let el = this.els.get(this.key(w));
      if (!el) el = this.spawn(w);
      const progress = Math.min(1, (t - w.spawnT) / w.fallMs);
      const wordH = el.offsetHeight || 40;
      const wordW = el.offsetWidth || 120;
      el.style.transform = `translate(${Math.max(0, Math.min(W - wordW - 8, w.x * W))}px, ${progress * (H - wordH - 6)}px)`;
      el.classList.toggle('near', progress > 0.68 && progress <= 0.86);
      el.classList.toggle('crit', progress > 0.86);
      el.classList.toggle('locked', sim.locked === w);
    }
  }

  private spawn(w: WordInst): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ts-word';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = [...w.text].map((ch) => `<span class="ch">${esc(ch)}</span>`).join('');
    this.arena!.appendChild(el);
    this.els.set(this.key(w), el);
    return el;
  }

  // ------------------------------------------------------------------ outcomes: motion and sound
  private handle(events: SprintEvent[]) {
    for (const e of events) {
      if (e.type === 'hit') this.onHit(e.word, e.streak);
      else if (e.type === 'word') this.onWord(e.word, e.points);
      else if (e.type === 'err') this.onErr(e.word);
      else if (e.type === 'miss') this.onMiss(e.word, e.lives);
      else if (e.type === 'stage') this.onStage(e.level, e.bonus);
    }
  }

  private pos(el: HTMLElement, child?: Element | null) {
    const a = this.arena!.getBoundingClientRect();
    const r = (child ?? el).getBoundingClientRect();
    return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 };
  }

  private onHit(w: WordInst, streak: number) {
    const el = this.els.get(this.key(w));
    const ch = el?.children[w.typed - 1] as HTMLElement | undefined;
    if (el && ch) {
      ch.classList.add('typed');
      if (!this.reduced) {
        const p = this.pos(el, ch);
        const fly = document.createElement('span');
        fly.className = 'ts-fly';
        fly.textContent = ch.textContent;
        fly.style.left = `${p.x}px`; fly.style.top = `${p.y}px`;
        fly.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 70)}px`);
        fly.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 120)}deg`);
        this.arena!.appendChild(fly);
        this.later(() => fly.remove(), 650);
      }
    }
    // Rising tune: each correct letter in a streak steps up the scale.
    const step = (streak - 1) % 10;
    const semi = SCALE[step % 5] + 12 * Math.floor(step / 5);
    const set = this.o?.theme?.sound?.keys ?? 'default';
    if (set === 'mechanical') { this.sfx.tone(1900, 0.02, 'square', 0.05); this.sfx.tone(note(semi, 330), 0.06, 'triangle', 0.06); }
    else if (set === 'soft') this.sfx.tone(note(semi, 330), 0.1, 'sine', 0.06);
    else this.sfx.tone(note(semi), 0.09, 'triangle', 0.08);
  }

  private onWord(w: WordInst, points: number) {
    const el = this.els.get(this.key(w));
    const lvl = this.sim?.level ?? 1;
    if (el) {
      const p = this.pos(el);
      el.classList.add('done');
      this.later(() => { el.remove(); }, 420);
      this.els.delete(this.key(w));
      this.float(p.x, p.y, `+${points}`, 'good');
      if (!this.reduced) this.burst(p.x, p.y, 12);
    }
    const base = 523.25 * 2 ** (Math.min(lvl, 12) / 24);
    this.sfx.arpeggio([base, base * 1.26, base * 1.5], 0.055, 'triangle', 0.1);
  }

  private onErr(w: WordInst | null) {
    const arena = this.arena!;
    arena.classList.remove('shake', 'flash'); void arena.offsetWidth;
    if (!this.reduced) arena.classList.add('shake');
    arena.classList.add('flash');
    this.later(() => arena.classList.remove('flash'), 220);
    if (w) {
      const el = this.els.get(this.key(w));
      if (el) { el.classList.remove('wiggle'); void el.offsetWidth; el.classList.add('wiggle'); }
    }
    this.sfx.tone(150, 0.2, 'sawtooth', 0.1, 0, 70);
    this.sfx.tone(98, 0.22, 'square', 0.05, 0.02, 60);
  }

  private onMiss(w: WordInst, lives: number) {
    const el = this.els.get(this.key(w));
    const p = el ? this.pos(el) : { x: this.arena!.clientWidth / 2, y: this.arena!.clientHeight - 20 };
    if (el) { el.classList.add('missed'); this.later(() => el.remove(), 520); this.els.delete(this.key(w)); }
    this.float(p.x, this.arena!.clientHeight - 30, 'Missed', 'bad');
    if (!this.reduced) this.burst(p.x, this.arena!.clientHeight - 10, 8, '#FF6B7A');
    const arena = this.arena!;
    arena.classList.remove('crash'); void arena.offsetWidth;
    if (!this.reduced) arena.classList.add('crash');
    const hearts = this.root.querySelectorAll('.ts-heart');
    const h = hearts[Math.max(0, Math.min(hearts.length - 1, lives))];
    h?.classList.add('lost');
    this.sfx.tone(120, 0.4, 'sine', 0.18, 0, 42);
    this.sfx.tone(260, 0.14, 'sawtooth', 0.06, 0, 120);
  }

  private onStage(level: number, bonus: number) {
    const b = this.q('banner')!;
    b.innerHTML = `<b>Level ${level}</b><span>Faster. Longer words. +${bonus}</span>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    this.later(() => b.classList.remove('show'), 1800);
    this.sfx.arpeggio([523.25, 659.25, 783.99, 1046.5], 0.08, 'triangle', 0.12);
    if (!this.reduced) this.burst(this.arena!.clientWidth / 2, this.arena!.clientHeight / 2, 24);
  }

  private float(x: number, y: number, text: string, kind: 'good' | 'bad') {
    const f = document.createElement('span');
    f.className = `ts-float ${kind}`;
    f.textContent = text;
    f.style.left = `${x}px`; f.style.top = `${y}px`;
    this.arena!.appendChild(f);
    this.later(() => f.remove(), 900);
  }

  private burst(x: number, y: number, n: number, colour?: string) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'ts-spark';
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.6;
      const dist = 40 + Math.random() * 60;
      p.style.left = `${x}px`; p.style.top = `${y}px`;
      p.style.background = colour ?? PARTICLE_COLOURS[i % PARTICLE_COLOURS.length];
      p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
      this.arena!.appendChild(p);
      this.later(() => p.remove(), 700);
    }
  }

  // ------------------------------------------------------------------ end
  private end() {
    const o = this.o, sim = this.sim;
    if (!o || !sim || this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.raf);
    this.input?.blur();
    if (sim.endReason === 'lives') this.sfx.arpeggio([392, 330, 262], 0.14, 'sawtooth', 0.09);
    else this.sfx.arpeggio([523.25, 659.25, 783.99, 1046.5], 0.09);
    // Let the last animation play before the results cover the board.
    this.later(() => o.onFinish({ keys: this.keys, local: summarize(sim) }), 700);
  }
}

