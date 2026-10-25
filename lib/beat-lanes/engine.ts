/**
 * Browser engine for Beat Lanes: a living canvas (animated sky, candy tiles,
 * particles, popups), input, audio and calibration around the shared core.
 * It records a tap log and hands it to the caller; it never decides a final
 * score. The server replays the log and is the authority.
 */
import {
  beatConfig,
  WINDOWS,
  clampOffset,
  evaluateRun,
  generateChart,
  type BeatSpec,
  type Note,
  type RunResult,
  type Tap,
} from './core.ts';

export interface FinishInfo {
  taps: Tap[];
  offsetMs: number;
  /** Local result for instant feedback. The server's replay is the one that counts. */
  local: RunResult;
}

export interface EngineOptions {
  onFinish: (info: FinishInfo) => void;
  sound: boolean;
}

const KEYS: Record<string, number> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const KEY_LABELS = ['D', 'F', 'J', 'K'];
// D major pentatonic: each lane is one note, so tapping builds a tune.
const LANE_HZ = [293.66, 329.63, 369.99, 440.0];
const MIN_SAME_LANE_TAP_MS = 50; // above the server's 45 ms limit, so honest double-bounces are never rejected

interface LaneColors { light: string; mid: string; dark: string; rgb: string }
const DEFAULT_LANE: readonly LaneColors[] = [
  { light: '#FF9CCB', mid: '#FF4D9D', dark: '#C0176F', rgb: '255,77,157' },
  { light: '#9BF3FF', mid: '#29E0FF', dark: '#0E9CC0', rgb: '41,224,255' },
  { light: '#DDFF8A', mid: '#B6F23A', dark: '#6FA800', rgb: '182,242,58' },
  { light: '#FFD98A', mid: '#FFB02E', dark: '#E5701A', rgb: '255,176,46' },
];
/** The active tile palette. A purchased skin replaces it; there is one game on screen at a time. */
let LANE: readonly LaneColors[] = DEFAULT_LANE;

type Part = readonly [number, OscillatorType, number];
interface Timbre { parts: readonly Part[]; decay: number }
const TIMBRES: Record<string, Timbre> = {
  default: { parts: [[1, 'triangle', 1], [2, 'sine', 0.22], [3, 'sine', 0.06]], decay: 0.9 },
  marimba: { parts: [[1, 'sine', 1], [4, 'sine', 0.3], [10, 'sine', 0.07]], decay: 0.5 },
  synth: { parts: [[1, 'sawtooth', 0.45], [2, 'square', 0.16], [0.5, 'sine', 0.3]], decay: 0.7 },
};
let TIMBRE: Timbre = TIMBRES.default;

/** What an equipped skin and sound pack carry. Both are optional. */
export interface BeatTheme { skin?: { palette?: LaneColors[] }; sound?: { timbre?: string } }
const GRADE = {
  perfect: { text: 'PERFECT!', color: '#FFF3B0' },
  good: { text: 'Good', color: '#9BF3FF' },
  early: { text: 'Early', color: '#D2C6FF' },
  miss: { text: 'Miss', color: '#FF8FA3' },
} as const;
const DISPLAY = "'Fredoka', 'Baloo 2', 'Avenir Next Rounded', system-ui, sans-serif";
const BODY = "'Nunito', system-ui, sans-serif";
const OUTLINE = '#2A0B5E';
const CONFETTI = ['#FF4D9D', '#29E0FF', '#B6F23A', '#FFB02E', '#FFF3B0', '#B28CFF'];
const MILESTONES: Record<number, { text: string; color: string }> = {
  10: { text: 'NICE!', color: '#9BF3FF' },
  25: { text: 'GREAT!', color: '#DDFF8A' },
  50: { text: 'AWESOME!', color: '#FFD98A' },
  100: { text: 'UNSTOPPABLE!', color: '#FF9CCB' },
};

interface Particle {
  x: number; y: number; vx: number; vy: number; g: number;
  life: number; max: number; size: number; color: string;
  rot: number; vr: number; shape: 0 | 1 | 2; // 0 rect, 1 circle, 2 star
}
interface Pop { text: string; x: number; y: number; at: number; life: number; color: string; size: number; rise: number }
interface Ring { x: number; y: number; at: number; color: string; big: boolean }
interface TilePop { lane: number; y: number; at: number }
interface RunState {
  chart: Note[]; spec: BeatSpec; offset: number; start: number;
  taps: Tap[]; lastTapByLane: number[]; pressedUntil: number[];
  prevGrades: (string | null)[]; prevStrays: number; prevCombo: number; prevScore: number;
  scoreBump: number; comboBump: number; heartLostAt: number[]; cdIdx: number;
  bot: boolean; botIdx: number;
  result: RunResult;
}
interface Calibration { t0: number; gap: number; beats: number; taps: number[]; resolve: (offset: number | null) => void }

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class BeatLanesEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: EngineOptions;
  private audio: AudioContext | null = null;
  private run: RunState | null = null;
  private cal: Calibration | null = null;
  private playing = false;
  private raf = 0;
  private last = 0;
  private W = 1;
  private H = 1;
  private observer: ResizeObserver;
  private reduceMotion = false;
  private energy = 0.15;
  private shakeUntil = 0;
  private shakeMag = 0;
  private flashUntil = 0;
  private flashColor = '255,80,110';
  private particles: Particle[] = [];
  private pops: Pop[] = [];
  private rings: Ring[] = [];
  private tilePops: TilePop[] = [];
  private stars = Array.from({ length: 38 }, () => ({ x: Math.random(), y: Math.random(), r: rnd(0.6, 1.8), ph: Math.random() * 6.28 }));
  private shapes = Array.from({ length: 16 }, (_, i) => ({
    x: Math.random(), y: Math.random(), s: rnd(12, 30), v: rnd(0.012, 0.04), type: i % 3, lane: i % 4,
    rot: Math.random() * 6.28, vr: rnd(-0.6, 0.6), ph: Math.random() * 6.28,
  }));

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.opts = opts;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement ?? canvas);
    canvas.addEventListener('pointerdown', this.onPointer);
    window.addEventListener('keydown', this.onKey);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------------ public API
  setSound(on: boolean) { this.opts.sound = on; }

  /** Applies an equipped skin and sound pack. Passing nothing restores the defaults. */
  setTheme(t?: BeatTheme) {
    const pal = t?.skin?.palette;
    LANE = pal && pal.length === 4 && pal.every((c) => c && c.light && c.mid && c.dark && c.rgb) ? pal : DEFAULT_LANE;
    TIMBRE = TIMBRES[t?.sound?.timbre ?? 'default'] ?? TIMBRES.default;
  }

  /** Must be called from a user gesture so the browser allows audio. */
  unlockAudio() {
    if (!this.audio) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) this.audio = new AC();
    }
    if (this.audio && this.audio.state === 'suspended') void this.audio.resume();
  }

  /** `bot` plays every note perfectly, to demonstrate the anti-cheat checks. */
  start(seed: number, spec: BeatSpec, offsetMs: number, bot = false) {
    this.unlockAudio();
    this.cancelCalibration();
    const chart = generateChart(seed, spec);
    const offset = clampOffset(offsetMs);
    this.particles = []; this.pops = []; this.rings = []; this.tilePops = [];
    this.run = {
      chart, spec, offset, start: performance.now(), taps: [],
      lastTapByLane: [-1e9, -1e9, -1e9, -1e9], pressedUntil: [0, 0, 0, 0],
      prevGrades: chart.map(() => null), prevStrays: 0, prevCombo: 0, prevScore: 0,
      scoreBump: 0, comboBump: 0, heartLostAt: new Array(beatConfig(spec).maxMisses).fill(0), cdIdx: -1,
      bot, botIdx: 0,
      result: evaluateRun(chart, [], spec, offset, -Infinity),
    };
    this.playing = true;
  }

  /** Confetti and a fanfare for the results screen. `stars` is 0 to 3. */
  celebrate(stars: number) {
    if (stars <= 0) return;
    const bursts = stars === 3 ? 7 : stars === 2 ? 4 : 2;
    for (let i = 0; i < bursts; i++) {
      this.burst(this.W * rnd(0.12, 0.88), this.H * rnd(0.2, 0.5), 26, CONFETTI, 1.3, true);
    }
    this.arpeggio([523.25, 659.25, 783.99, 1046.5].slice(0, stars + 1), 0.11);
  }

  /** Tap-along calibration. Resolves with the measured offset, or null if cancelled or too few taps. */
  calibrate(): Promise<number | null> {
    this.unlockAudio();
    this.cancelCalibration();
    const a = this.audio;
    if (!a) return Promise.resolve(null);
    const beats = 8, gap = 700;
    const t0 = performance.now() + 1200;
    const a0 = a.currentTime + 1.2;
    for (let i = 0; i < beats; i++) this.click(a0 + (i * gap) / 1000);
    return new Promise((resolve) => {
      this.cal = { t0, gap, beats, taps: [], resolve };
    });
  }

  cancelCalibration() {
    if (this.cal) { const c = this.cal; this.cal = null; c.resolve(null); }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.playing = false;
    this.cancelCalibration();
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointer);
    window.removeEventListener('keydown', this.onKey);
    void this.audio?.close();
  }

  // ------------------------------------------------------------------ input
  private stampOf(e: Event): number {
    const t = e.timeStamp;
    return t > 1e12 || t <= 0 ? performance.now() : t;
  }

  private tap(lane: number, stamp: number) {
    if (this.cal) {
      this.cal.taps.push(stamp);
      this.playNote(lane);
      this.burst(this.W * (lane + 0.5) / 4, this.H * 0.6, 6, [LANE[lane].mid, '#fff'], 0.7);
      return;
    }
    const r = this.run;
    if (!this.playing || !r || r.bot) return;
    const t = stamp - r.start;
    if (t < 0 || t - r.lastTapByLane[lane] < MIN_SAME_LANE_TAP_MS) return;
    r.lastTapByLane[lane] = t;
    r.taps.push({ lane, t: Math.round(t * 10) / 10 });
    r.pressedUntil[lane] = performance.now() + 120;
    this.playNote(lane);
  }

  private onPointer = (e: PointerEvent) => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const lane = Math.max(0, Math.min(3, Math.floor(((e.clientX - rect.left) / rect.width) * 4)));
    this.tap(lane, this.stampOf(e));
  };

  private onKey = (e: KeyboardEvent) => {
    if (!(e.code in KEYS) || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (!this.playing && !this.cal)) return;
    e.preventDefault();
    this.tap(KEYS[e.code], this.stampOf(e));
  };

  // ------------------------------------------------------------------ audio
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const a = this.audio;
    if (!this.opts.sound || !a) return;
    const t = a.currentTime + at;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private playNote(lane: number) {
    const a = this.audio;
    if (!this.opts.sound || !a) return;
    const now = a.currentTime;
    const out = a.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.3, now + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, now + TIMBRE.decay);
    out.connect(a.destination);
    TIMBRE.parts.forEach(([mult, type, level]) => {
      const osc = a.createOscillator();
      const g = a.createGain();
      osc.type = type;
      osc.frequency.value = LANE_HZ[lane] * mult;
      g.gain.value = level;
      osc.connect(g);
      g.connect(out);
      osc.start(now);
      osc.stop(now + TIMBRE.decay + 0.05);
    });
  }

  private arpeggio(freqs: number[], step: number) {
    freqs.forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.22, i * step));
  }

  private click(atSeconds: number) {
    const a = this.audio;
    if (!a) return;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = 'square';
    osc.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, atSeconds);
    g.gain.exponentialRampToValueAtTime(0.16, atSeconds + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, atSeconds + 0.04);
    osc.connect(g);
    g.connect(a.destination);
    osc.start(atSeconds);
    osc.stop(atSeconds + 0.05);
  }

  private buzz(ms: number | number[]) {
    try { navigator.vibrate?.(ms); } catch { /* not supported */ }
  }

  // ------------------------------------------------------------------ effects
  private burst(x: number, y: number, count: number, colors: readonly string[], power = 1, confetti = false) {
    const n = this.reduceMotion ? Math.min(count, 4) : count;
    for (let i = 0; i < n && this.particles.length < 420; i++) {
      const ang = confetti ? rnd(-Math.PI * 0.95, -Math.PI * 0.05) : rnd(0, Math.PI * 2);
      const sp = rnd(120, 360) * power;
      this.particles.push({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: confetti ? 620 : 380,
        life: 0, max: rnd(0.55, 1.1) * (confetti ? 1.5 : 1), size: rnd(4, confetti ? 10 : 8),
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: rnd(0, 6.28), vr: rnd(-9, 9), shape: (Math.random() < 0.34 ? 2 : Math.random() < 0.5 ? 1 : 0) as 0 | 1 | 2,
      });
    }
  }

  private pop(text: string, x: number, y: number, color: string, size: number, life = 0.8, rise = 46) {
    this.pops.push({ text, x, y, at: performance.now(), life: life * 1000, color, size, rise });
  }

  private shake(mag: number, ms: number) {
    if (this.reduceMotion) return;
    this.shakeMag = mag;
    this.shakeUntil = performance.now() + ms;
  }

  private flash(rgb: string, ms: number) {
    this.flashColor = rgb;
    this.flashUntil = performance.now() + ms;
  }

  // ------------------------------------------------------------------ loop
  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(now, dt);
    this.render(now);
    this.raf = requestAnimationFrame(this.tick);
  };

  private update(now: number, dt: number) {
    // particles
    for (const p of this.particles) {
      p.life += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 0.8 * dt;
      p.rot += p.vr * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    this.pops = this.pops.filter((p) => now - p.at < p.life);
    this.rings = this.rings.filter((r) => now - r.at < 520);
    this.tilePops = this.tilePops.filter((p) => now - p.at < 200);

    // background drift
    if (!this.reduceMotion) {
      for (const s of this.shapes) {
        s.y -= s.v * dt * (0.6 + this.energy);
        s.rot += s.vr * dt;
        if (s.y < -0.1) { s.y = 1.1; s.x = Math.random(); }
      }
    }

    // calibration
    if (this.cal) {
      const c = this.cal;
      if (now > c.t0 + (c.beats - 1) * c.gap + 500) this.finishCalibration();
      this.energy += (0.5 - this.energy) * dt * 3;
      return;
    }

    const r = this.run;
    const targetEnergy = this.playing && r ? Math.min(1, r.result.combo / 40) : 0.15;
    this.energy += (targetEnergy - this.energy) * dt * 3;
    if (!this.playing || !r) return;

    const t = now - r.start;
    if (r.bot) {
      while (r.botIdx < r.chart.length && r.chart[r.botIdx].t + r.offset <= t) {
        const n = r.chart[r.botIdx++];
        r.taps.push({ lane: n.lane, t: n.t + r.offset });
        r.pressedUntil[n.lane] = now + 120;
        this.playNote(n.lane);
      }
    }
    const res = evaluateRun(r.chart, r.taps, r.spec, r.offset, t - r.offset);

    // countdown beeps
    const cd = t < 600 ? 0 : t < 1200 ? 1 : t < 1800 ? 2 : t < 2300 ? 3 : 4;
    if (cd !== r.cdIdx && cd < 4) {
      r.cdIdx = cd;
      if (cd < 3) this.tone(660, 0.12, 'square', 0.12);
      else this.tone(990, 0.28, 'square', 0.14);
    }

    const laneW = this.W / 4;
    const hitY = this.hitY();
    res.grades.forEach((g, i) => {
      if (!g || g === r.prevGrades[i]) return;
      r.prevGrades[i] = g;
      const lane = r.chart[i].lane;
      const cx = lane * laneW + laneW / 2;
      if (g === 'miss') {
        this.pop(GRADE.miss.text, cx, hitY - 34, GRADE.miss.color, 20, 0.6, 24);
        this.burst(cx, hitY - 30, 8, ['#8E7BA8', '#B9A7D1'], 0.5);
        this.shake(5, 200); this.flash('255,80,110', 220); this.buzz(25);
        this.tone(160, 0.16, 'sawtooth', 0.1, 0, 70);
      } else {
        // Whatever the grade, a tapped tile pops right where it was.
        const tileBottom = hitY - ((r.chart[i].t - (t - r.offset)) / beatConfig(r.spec).travelMs) * hitY;
        this.tilePops.push({ lane, y: tileBottom, at: now });
        const perfect = g === 'perfect';
        const early = g === 'early';
        this.rings.push({ x: cx, y: Math.min(tileBottom, hitY), at: now, color: LANE[lane].light, big: perfect });
        this.burst(cx, Math.min(tileBottom, hitY) - 20, perfect ? 16 : early ? 6 : 8, [LANE[lane].light, LANE[lane].mid, '#fff', '#FFF3B0'], perfect ? 1 : early ? 0.5 : 0.7);
        this.pop(GRADE[g].text, cx, Math.min(tileBottom, hitY) - 44, GRADE[g].color, perfect ? 26 : early ? 17 : 20, 0.7, 40);
        this.buzz(8);
      }
    });
    if (res.strays > r.prevStrays) {
      r.prevStrays = res.strays;
      const last = r.taps[r.taps.length - 1];
      if (last) {
        const cx = last.lane * laneW + laneW / 2;
        this.pop('Oops', cx, hitY - 34, GRADE.miss.color, 18, 0.5, 20);
        this.shake(4, 160); this.flash('255,80,110', 180); this.buzz(20);
      }
    }
    // lost hearts
    const used = res.misses + res.strays;
    for (let i = 0; i < used && i < r.heartLostAt.length; i++) if (!r.heartLostAt[i]) r.heartLostAt[i] = now;

    if (res.score !== r.prevScore) { r.prevScore = res.score; r.scoreBump = now; }
    if (res.combo !== r.prevCombo) {
      if (res.combo > r.prevCombo) {
        r.comboBump = now;
        const m = MILESTONES[res.combo];
        if (m) {
          this.pop(m.text, this.W / 2, this.H * 0.34, m.color, 44, 1.1, 30);
          this.burst(this.W / 2, this.H * 0.34, 30, CONFETTI, 1.2, true);
          this.shake(7, 260);
          this.arpeggio([523.25, 659.25, 783.99], 0.07);
        }
      }
      r.prevCombo = res.combo;
    }
    r.result = res;

    const lastNote = r.chart[r.chart.length - 1].t;
    if (res.endedAtMs !== null || t > lastNote + WINDOWS.goodMs + 450) {
      this.playing = false;
      this.opts.onFinish({ taps: r.taps, offsetMs: r.offset, local: evaluateRun(r.chart, r.taps, r.spec, r.offset) });
    }
  }

  private finishCalibration() {
    const c = this.cal;
    if (!c) return;
    this.cal = null;
    const deltas: number[] = [];
    c.taps.forEach((t) => {
      const k = Math.round((t - c.t0) / c.gap);
      if (k < 0 || k >= c.beats) return;
      const d = t - (c.t0 + k * c.gap);
      if (Math.abs(d) <= 350) deltas.push(d);
    });
    if (deltas.length < 4) return c.resolve(null);
    deltas.sort((a, b) => a - b);
    this.celebrate(2);
    c.resolve(clampOffset(Math.round(deltas[Math.floor(deltas.length / 2)])));
  }

  // ------------------------------------------------------------------ drawing
  private hitY() {
    return this.H - Math.min(116, Math.round(this.H * 0.17));
  }

  private resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.W = Math.max(1, Math.floor(rect.width));
    this.H = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.W * dpr);
    this.canvas.height = Math.floor(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private rr(x: number, y: number, w: number, h: number, r: number) {
    const c = this.ctx;
    const k = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + k, y);
    c.arcTo(x + w, y, x + w, y + h, k);
    c.arcTo(x + w, y + h, x, y + h, k);
    c.arcTo(x, y + h, x, y, k);
    c.arcTo(x, y, x + w, y, k);
    c.closePath();
  }

  private starPath(x: number, y: number, r: number, rot: number) {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r;
      const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
      c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    c.closePath();
  }

  private heart(x: number, y: number, s: number, fill: string, stroke: string) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.scale(s / 24, s / 24);
    c.beginPath();
    c.moveTo(0, 9);
    c.bezierCurveTo(-12, 1, -10, -9, -4, -9);
    c.bezierCurveTo(-1.5, -9, 0, -7, 0, -5.5);
    c.bezierCurveTo(0, -7, 1.5, -9, 4, -9);
    c.bezierCurveTo(10, -9, 12, 1, 0, 9);
    c.closePath();
    c.fillStyle = fill; c.fill();
    c.lineWidth = 2.2; c.strokeStyle = stroke; c.stroke();
    c.restore();
  }

  private text(s: string, x: number, y: number, size: number, fill: string, align: CanvasTextAlign = 'center', alpha = 1) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = alpha;
    c.textAlign = align;
    c.font = `700 ${size}px ${DISPLAY}`;
    c.lineJoin = 'round';
    c.lineWidth = Math.max(3, size * 0.16);
    c.strokeStyle = OUTLINE;
    c.strokeText(s, x, y);
    c.fillStyle = fill;
    c.fillText(s, x, y);
    c.restore();
  }

  private render(now: number) {
    const { ctx, W, H } = this;
    const run = this.run;
    const laneW = W / 4;
    const hitY = this.hitY();
    const keyH = H - hitY;
    const tileH = Math.min(laneW * 1.05, 96);
    const playing = this.playing && !!run;
    const t = playing && run ? now - run.start : null;
    const adj = t !== null && run ? t - run.offset : now;
    const bpm = run ? beatConfig(run.spec).bpm : 96;
    const beatMs = 60000 / bpm;
    const phase = ((((adj % beatMs) + beatMs) % beatMs)) / beatMs;
    const pulse = this.reduceMotion ? 0.3 : Math.pow(1 - phase, 3);

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (now < this.shakeUntil && !this.reduceMotion) {
      const k = (this.shakeUntil - now) / 220;
      ctx.translate((Math.random() - 0.5) * this.shakeMag * k, (Math.random() - 0.5) * this.shakeMag * k);
    }

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1A0B3B');
    sky.addColorStop(0.55, '#3A1580');
    sky.addColorStop(1, '#7A2BA8');
    ctx.fillStyle = sky;
    ctx.fillRect(-10, -10, W + 20, H + 20);

    // beat glow
    const glow = ctx.createRadialGradient(W / 2, hitY, 10, W / 2, hitY, H * (0.55 + 0.12 * pulse + 0.15 * this.energy));
    glow.addColorStop(0, `rgba(255,77,157,${0.28 + 0.22 * pulse + 0.2 * this.energy})`);
    glow.addColorStop(0.5, `rgba(41,224,255,${0.1 + 0.08 * this.energy})`);
    glow.addColorStop(1, 'rgba(41,224,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // twinkling stars
    for (const s of this.stars) {
      const a = 0.35 + 0.45 * Math.sin(now / 600 + s.ph);
      ctx.fillStyle = `rgba(255,255,255,${this.reduceMotion ? 0.5 : Math.max(0.1, a)})`;
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H * 0.8, s.r, 0, 6.28); ctx.fill();
    }

    // floating shapes
    for (const s of this.shapes) {
      const x = s.x * W + (this.reduceMotion ? 0 : Math.sin(now / 1800 + s.ph) * 14);
      const y = s.y * H;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s.rot);
      ctx.globalAlpha = 0.16 + 0.1 * this.energy;
      ctx.fillStyle = LANE[s.lane].mid;
      ctx.strokeStyle = LANE[s.lane].light;
      ctx.lineWidth = 2.5;
      if (s.type === 0) { ctx.font = `700 ${s.s * 1.5}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.lane % 2 ? '\u266B' : '\u266A', 0, 0); }
      else if (s.type === 1) { ctx.beginPath(); ctx.arc(0, 0, s.s * 0.6, 0, 6.28); ctx.stroke(); }
      else { this.starPath(0, 0, s.s * 0.7, 0); ctx.fill(); }
      ctx.restore();
    }

    // equalizer
    if (!this.reduceMotion) {
      const bars = 22;
      const bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const h = (6 + 38 * Math.abs(Math.sin(now / 340 + i * 0.7)) * (0.35 + this.energy) + 20 * pulse) * 1;
        ctx.fillStyle = `rgba(${LANE[i % 4].rgb},0.13)`;
        this.rr(i * bw + 2, hitY - h, bw - 4, h, 3);
        ctx.fill();
      }
    }

    // lanes (glass)
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.075)' : 'rgba(255,255,255,0.035)';
      ctx.fillRect(i * laneW, 0, laneW, hitY);
      const lg = ctx.createLinearGradient(0, hitY - 160, 0, hitY);
      lg.addColorStop(0, `rgba(${LANE[i].rgb},0)`);
      lg.addColorStop(1, `rgba(${LANE[i].rgb},${0.16 + 0.1 * pulse})`);
      ctx.fillStyle = lg;
      ctx.fillRect(i * laneW, hitY - 160, laneW, 160);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(Math.round(i * laneW) + 0.5, 0); ctx.lineTo(Math.round(i * laneW) + 0.5, hitY); ctx.stroke();
    }

    // calibration visuals
    if (this.cal) {
      const c = this.cal;
      const k = Math.max(0, Math.min(c.beats - 1, Math.floor((now - c.t0) / c.gap)));
      const ph = (((now - c.t0) % c.gap) + c.gap) % c.gap / c.gap;
      ctx.fillStyle = 'rgba(20,6,50,0.4)'; ctx.fillRect(0, 0, W, hitY);
      if (now > c.t0 - 100) {
        ctx.strokeStyle = '#FFF3B0'; ctx.lineWidth = 6; ctx.globalAlpha = 1 - ph;
        ctx.beginPath(); ctx.arc(W / 2, hitY * 0.45, 40 + ph * 70, 0, 6.28); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(W / 2, hitY * 0.45, 30 - 8 * ph, 0, 6.28); ctx.fill();
      this.text('Tap with the beat!', W / 2, hitY * 0.2, 28, '#FFF3B0');
      this.text(`${Math.min(c.beats, k + 1)} / ${c.beats}`, W / 2, hitY * 0.45 + 12, 30, OUTLINE);
    }

    if (playing && run && t !== null) {
      const cfg = beatConfig(run.spec);

      // lane press beams
      for (let i = 0; i < 4; i++) {
        const left = run.pressedUntil[i] - now;
        if (left > 0) {
          const g = ctx.createLinearGradient(0, hitY - 260, 0, hitY);
          g.addColorStop(0, `rgba(${LANE[i].rgb},0)`);
          g.addColorStop(1, `rgba(${LANE[i].rgb},${(0.4 * left) / 120})`);
          ctx.fillStyle = g; ctx.fillRect(i * laneW, hitY - 260, laneW, 260);
        }
      }

      // notes: candy tiles
      run.chart.forEach((note, idx) => {
        const grade = run.result.grades[idx];
        const dt = note.t - adj;
        if (dt > cfg.travelMs + 60 || dt < -520 || grade === 'perfect' || grade === 'good' || grade === 'early') return;
        const yb = hitY - (dt / cfg.travelMs) * hitY;
        const x = note.lane * laneW + 4;
        const w = laneW - 8;
        const col = LANE[note.lane];
        if (grade === 'miss') {
          ctx.globalAlpha = Math.max(0, 0.5 - Math.max(0, -dt - 110) / 600);
          ctx.fillStyle = '#8E7BA8';
          this.rr(x, yb - tileH, w, tileH, 14); ctx.fill();
          ctx.globalAlpha = 1;
          return;
        }
        const sc = 1 + 0.035 * pulse;
        ctx.save();
        ctx.translate(x + w / 2, yb - tileH / 2);
        ctx.scale(sc, sc);
        if (!this.reduceMotion) { ctx.shadowColor = `rgba(${col.rgb},0.75)`; ctx.shadowBlur = 20; }
        const g = ctx.createLinearGradient(0, -tileH / 2, 0, tileH / 2);
        g.addColorStop(0, col.light); g.addColorStop(0.45, col.mid); g.addColorStop(1, col.dark);
        ctx.fillStyle = g;
        this.rr(-w / 2, -tileH / 2, w, tileH, 16); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        this.rr(-w / 2 + 1.5, -tileH / 2 + 1.5, w - 3, tileH - 3, 15); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        this.rr(-w / 2 + 8, -tileH / 2 + 7, w - 16, tileH * 0.22, 9); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = `700 ${Math.min(34, tileH * 0.46)}px ${DISPLAY}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(note.id % 2 ? '\u266B' : '\u266A', 0, tileH * 0.08);
        ctx.restore();
      });

      // tapped tiles: a quick swell and fade, so every tap visibly lands
      for (const tp of this.tilePops) {
        const age = (now - tp.at) / 200;
        const col = LANE[tp.lane];
        const sc = 1 + (this.reduceMotion ? 0 : 0.45 * age);
        ctx.save();
        ctx.globalAlpha = 1 - age;
        ctx.translate(tp.lane * laneW + laneW / 2, tp.y - tileH / 2);
        ctx.scale(sc, sc);
        if (!this.reduceMotion) { ctx.shadowColor = `rgba(${col.rgb},0.9)`; ctx.shadowBlur = 26; }
        ctx.fillStyle = col.light;
        this.rr(-(laneW - 8) / 2, -tileH / 2, laneW - 8, tileH, 16); ctx.fill();
        ctx.restore();
      }

      // hit rings
      for (const rg of this.rings) {
        const age = (now - rg.at) / 520;
        ctx.strokeStyle = rg.color; ctx.globalAlpha = 1 - age; ctx.lineWidth = rg.big ? 6 : 4;
        ctx.beginPath(); ctx.arc(rg.x, rg.y, laneW * (0.25 + (rg.big ? 0.7 : 0.45) * age), 0, 6.28); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // hit line
      ctx.fillStyle = `rgba(255,243,176,${0.45 + 0.4 * pulse})`;
      ctx.fillRect(0, hitY - 2, W, 4);

      // fire edge when multiplier is up
      const res = run.result;
      const mult = 1 + 0.25 * Math.min(4, Math.floor(res.combo / 10));
      if (mult >= 1.5) {
        const fe = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, H * 0.8);
        fe.addColorStop(0, 'rgba(255,138,43,0)');
        fe.addColorStop(1, `rgba(255,77,157,${0.2 + 0.15 * pulse + 0.1 * (mult - 1.5)})`);
        ctx.fillStyle = fe; ctx.fillRect(0, 0, W, H);
      }

      // HUD: score
      const sb = Math.max(0, 1 - (now - run.scoreBump) / 180);
      ctx.save();
      ctx.translate(14, 38); ctx.scale(1 + 0.18 * sb, 1 + 0.18 * sb);
      this.text(res.score.toLocaleString(), 0, 0, 32, '#fff', 'left');
      ctx.restore();

      // HUD: hearts
      const hs = 17;
      for (let i = 0; i < cfg.maxMisses; i++) {
        const lostAt = run.heartLostAt[i];
        const hx = W - 16 - i * (hs + 3) - hs / 2;
        if (lostAt) {
          const age = (now - lostAt) / 400;
          if (age < 1) { ctx.globalAlpha = 1 - age; this.heart(hx, 40 + age * 14, hs * (1 + 0.5 * age), '#FF4D6D', '#C9184A'); ctx.globalAlpha = 1; }
          this.heart(hx, 40, hs * 0.8, 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.25)');
        } else {
          this.heart(hx, 40, hs, '#FF4D6D', '#FFD1DC');
        }
      }

      // HUD: combo
      if (res.combo > 1) {
        const cb = Math.max(0, 1 - (now - run.comboBump) / 160);
        ctx.save();
        ctx.translate(W / 2, 92); ctx.scale(1 + 0.3 * cb, 1 + 0.3 * cb);
        this.text(String(res.combo), 0, 0, 46, mult >= 1.5 ? '#FFD98A' : '#fff');
        ctx.restore();
        this.text(mult > 1 ? `combo  x${mult.toFixed(2)}` : 'combo', W / 2, 118, 17, mult > 1 ? '#FFB02E' : '#E5D9FF');
      }

      // progress bar
      const prog = Math.max(0, Math.min(1, t / (run.chart[run.chart.length - 1].t + 400)));
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(0, 0, W, 5);
      const pg = ctx.createLinearGradient(0, 0, W, 0);
      pg.addColorStop(0, '#FF4D9D'); pg.addColorStop(0.5, '#FFB02E'); pg.addColorStop(1, '#B6F23A');
      ctx.fillStyle = pg; ctx.fillRect(0, 0, W * prog, 5);

      // countdown
      if (t < 2300) {
        const idx = t < 600 ? 0 : t < 1200 ? 1 : t < 1800 ? 2 : 3;
        const label = ['3', '2', '1', 'GO!'][idx];
        const local = idx < 3 ? (t - idx * 600) / 600 : (t - 1800) / 500;
        const sc = 1 + 0.5 * Math.pow(1 - Math.min(1, local * 2.2), 2);
        ctx.save();
        ctx.translate(W / 2, hitY * 0.46); ctx.scale(sc, sc);
        this.text(label, 0, 0, idx === 3 ? 84 : 110, idx === 3 ? '#DDFF8A' : '#FFF3B0', 'center', Math.max(0, 1 - Math.max(0, local - 0.7) / 0.3));
        ctx.restore();
      }
    }

    // particles
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      if (p.shape === 0) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66); ctx.restore(); }
      else if (p.shape === 1) { ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, 6.28); ctx.fill(); }
      else { this.starPath(p.x, p.y, p.size * 0.9, p.rot); ctx.fill(); }
    }
    ctx.globalAlpha = 1;

    // judgement popups
    for (const p of this.pops) {
      const age = (now - p.at) / p.life;
      const sc = 1 + 0.45 * Math.max(0, 1 - age * 5);
      ctx.save();
      ctx.translate(p.x, p.y - age * p.rise); ctx.scale(sc, sc);
      this.text(p.text, 0, 0, p.size, p.color, 'center', Math.max(0, 1 - Math.max(0, age - 0.6) / 0.4));
      ctx.restore();
    }

    // piano keys
    for (let i = 0; i < 4; i++) {
      const down = !!run && run.pressedUntil[i] > now;
      const col = LANE[i];
      ctx.fillStyle = '#1A0B3B'; ctx.fillRect(i * laneW, hitY, laneW, keyH);
      const kg = ctx.createLinearGradient(0, hitY, 0, H);
      if (down) { kg.addColorStop(0, col.light); kg.addColorStop(1, col.mid); }
      else { kg.addColorStop(0, '#FFFFFF'); kg.addColorStop(1, '#E6DDF5'); }
      ctx.fillStyle = kg;
      const dy = down ? 4 : 0;
      this.rr(i * laneW + 2, hitY + 3 + dy, laneW - 4, keyH - 6 - dy, 12); ctx.fill();
      ctx.fillStyle = col.mid;
      this.rr(i * laneW + 2, hitY + 3 + dy, laneW - 4, 8, 6); ctx.fill();
      ctx.fillStyle = down ? '#fff' : col.dark;
      ctx.font = `700 22px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(KEY_LABELS[i], i * laneW + laneW / 2, H - 18 + dy * 0.5);
    }

    // miss flash
    if (now < this.flashUntil) {
      ctx.fillStyle = `rgba(${this.flashColor},${0.22 * ((this.flashUntil - now) / 220)})`;
      ctx.fillRect(-10, -10, W + 20, H + 20);
    }
    ctx.restore();
  }
}

/** Star rating for the results screen: 0 to 3. A run that ended on the miss limit tops out at one star. */
export function starsFor(accuracy: number, completed: boolean): number {
  const stars = accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : accuracy >= 0.4 ? 1 : 0;
  return completed ? stars : Math.min(stars, 1);
}
