'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BeatLanesEngine, starsFor, type FinishInfo } from '@/lib/beat-lanes/engine';
import { DIFFICULTY, OFFSET_LIMIT_MS, type Difficulty } from '@/lib/beat-lanes/core';
import { DIFFICULTY_MIN_LEVEL, levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import { POINTS_DISCLAIMER } from '@/lib/copy';
import Icon from './Icon';
import Mascot from './Mascot';
import CountUp from './CountUp';
import RewardPopup from './RewardPopup';

interface Props { level: number; xp: number; levels: LevelRow[]; stamina: number; staminaCap: number }

interface ServerResult {
  verdict: 'accepted' | 'flagged' | 'rejected';
  flags?: string[];
  reasons?: string[];
  score?: number;
  accuracy?: number;
  maxCombo?: number;
  perfects?: number;
  goods?: number;
  misses?: number;
  strays?: number;
  completed?: boolean;
  granted?: { xp?: number; coins?: number; airdrop_points?: number };
}

type Phase = 'menu' | 'starting' | 'playing' | 'calibrating' | 'submitting' | 'results';

const store = {
  get(k: string, d: string) { try { return localStorage.getItem('nexora.' + k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem('nexora.' + k, v); } catch { /* storage unavailable */ } },
};

const TITLE = 'Beat Lanes'.split('');

export default function BeatLanes({ level, xp, levels, stamina, staminaCap }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BeatLanesEngine | null>(null);
  const sessionRef = useRef<string | null>(null);
  const soundRef = useRef(true);
  // Props read inside the engine callback, which is created once.
  const progressRef = useRef({ xp, level, levels });
  progressRef.current = { xp, level, levels };

  const [phase, setPhase] = useState<Phase>('menu');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [offset, setOffset] = useState(0);
  const [sound, setSound] = useState(true);
  const [stamLeft, setStamLeft] = useState(stamina);
  const [error, setError] = useState<string | null>(null);
  const [calMsg, setCalMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ServerResult | null>(null);
  const [levelUp, setLevelUp] = useState<LevelRow | null>(null);

  useEffect(() => { setStamLeft(stamina); }, [stamina]);
  useEffect(() => {
    setOffset(Number(store.get('offset', '0')) || 0);
    const s = store.get('sound', '1') === '1';
    setSound(s);
    soundRef.current = s;
  }, []);

  const submit = useCallback(async (info: FinishInfo) => {
    setPhase('submitting');
    try {
      const res = await fetch(`/api/runs/${sessionRef.current}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taps: info.taps, offsetMs: info.offsetMs }),
      });
      const data = (await res.json()) as ServerResult & { error?: string };
      if (!res.ok && !data.verdict) throw new Error(data.error ?? 'submit_failed');

      // Level-up check against the XP the player had before this run.
      const p = progressRef.current;
      const before = levelForXp(p.xp, p.levels);
      const after = levelForXp(p.xp + (data.granted?.xp ?? 0), p.levels);
      if (data.verdict !== 'rejected') engineRef.current?.celebrate(starsFor(data.accuracy ?? 0, !!data.completed));
      setResult(data);
      setLevelUp(after.level > before.level ? after : null);
      setPhase('results');
      router.refresh();
    } catch {
      setError('Could not reach the server to check your run. Your result was not saved.');
      setPhase('menu');
    }
  }, [router]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new BeatLanesEngine(canvasRef.current, { onFinish: submit, sound: soundRef.current });
    engineRef.current = engine;
    return () => engine.destroy();
  }, [submit]);

  async function start() {
    setError(null);
    setPhase('starting');
    engineRef.current?.unlockAudio();
    const res = await fetch('/api/runs/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'insufficient_stamina') {
        const mins = Math.ceil((data.secondsUntilNext ?? 0) / 60);
        setError(`Out of stamina! The next bolt arrives in about ${mins} min.`);
        setStamLeft(data.stamina ?? 0);
      } else if (data.error === 'locked') {
        setError(`That difficulty unlocks at level ${data.requiredLevel}.`);
      } else {
        setError('Could not start a run. Try again.');
      }
      setPhase('menu');
      return;
    }
    sessionRef.current = data.sessionId;
    setStamLeft(data.stamina);
    setPhase('playing');
    engineRef.current?.start(data.seed, data.difficulty, offset);
  }

  async function calibrate() {
    setCalMsg(null);
    setPhase('calibrating');
    const measured = await engineRef.current?.calibrate();
    if (measured === null || measured === undefined) {
      setCalMsg('Calibration cancelled or too few taps. Offset unchanged.');
    } else {
      setOffset(measured);
      store.set('offset', String(measured));
      setCalMsg(`Nice! Offset set to ${measured} ms.`);
    }
    setPhase('menu');
  }

  const granted = result?.granted ?? {};
  const stars = result && result.verdict !== 'rejected' ? starsFor(result.accuracy ?? 0, !!result.completed) : 0;
  const chips = [
    { icon: 'star', label: 'XP', value: granted.xp ?? 0 },
    { icon: 'coin', label: 'Coins', value: granted.coins ?? 0 },
    { icon: 'gem', label: 'Airdrop Points', value: granted.airdrop_points ?? 0 },
  ];

  return (
    <div className="stage">
      <canvas ref={canvasRef} role="img" aria-label="Beat Lanes playfield: four colourful lanes with falling note tiles and piano keys at the bottom" />

      {phase === 'menu' || phase === 'starting' ? (
        <section className="panel" aria-labelledby="bl-title">
          <div className="hero">
            <Mascot />
            <div>
              <h1 className="title" id="bl-title" aria-label="Beat Lanes">
                {TITLE.map((ch, i) => (
                  <span key={i} aria-hidden="true" style={{ '--i': i } as React.CSSProperties}>{ch === ' ' ? '\u00A0' : ch}</span>
                ))}
              </h1>
              <p className="tagline">Tap the tiles. Make music!</p>
            </div>
          </div>

          <div className="group">
            <span className="label" id="bl-diff">Pick your challenge</span>
            <div className="seg" role="radiogroup" aria-labelledby="bl-diff">
              {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => {
                const locked = level < DIFFICULTY_MIN_LEVEL[d];
                return (
                  <button key={d} type="button" role="radio" data-d={d} aria-checked={d === difficulty} disabled={locked} onClick={() => setDifficulty(d)}>
                    {d[0].toUpperCase() + d.slice(1)}
                    <span>{locked ? `Unlocks at level ${DIFFICULTY_MIN_LEVEL[d]}` : `${DIFFICULTY[d].durationMs / 1000} s, ${DIFFICULTY[d].maxMisses} lives`}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="group">
            <label className="label" htmlFor="bl-offset">Timing offset</label>
            <div className="row">
              <input
                id="bl-offset" type="range" min={-OFFSET_LIMIT_MS} max={OFFSET_LIMIT_MS} step={1} value={offset}
                onChange={(e) => { const v = Number(e.target.value); setOffset(v); store.set('offset', String(v)); }}
              />
              <span className="value">{offset > 0 ? '+' : ''}{offset} ms</span>
              <button className="btn cyan" type="button" onClick={calibrate} disabled={!sound} style={{ padding: '10px 14px', fontSize: 16 }}>Calibrate</button>
            </div>
            <span className="hint">{calMsg ?? 'Hits feel early or late? Calibrate once and tap along to the beat.'}</span>
          </div>

          <label className="check">
            <input
              type="checkbox" checked={sound}
              onChange={(e) => { setSound(e.target.checked); soundRef.current = e.target.checked; engineRef.current?.setSound(e.target.checked); store.set('sound', e.target.checked ? '1' : '0'); }}
            />
            Sound on
          </label>

          {error ? <p className="bad" role="alert">{error}</p> : null}
          <div className="actions">
            <button className="btn primary" type="button" onClick={start} disabled={phase === 'starting' || stamLeft < 1} style={{ fontSize: 22, padding: '16px 28px' }}>
              <Icon name="play" size={26} /> {phase === 'starting' ? 'Starting' : 'Play!'}
            </button>
            <span className="stamina" aria-label={`Stamina ${stamLeft} of ${staminaCap}`}>
              {Array.from({ length: staminaCap }, (_, i) => (
                <span key={i} className={`pip${i < stamLeft ? ' on' : ''}`}><Icon name="bolt" size={18} /></span>
              ))}
            </span>
          </div>
          <p className="hint">Keys: D F J K, or tap the lanes. Tapping an empty lane costs a life.</p>
        </section>
      ) : null}

      {phase === 'calibrating' ? (
        <div className="floating-cancel">
          <button className="btn" type="button" onClick={() => engineRef.current?.cancelCalibration()}>Cancel</button>
        </div>
      ) : null}

      {phase === 'submitting' ? (
        <section className="panel" aria-live="polite" style={{ justifyContent: 'center', textAlign: 'center' }}>
          <h2>Checking your run</h2>
          <p>The server is replaying your taps against the chart.</p>
          <div className="dots" aria-hidden="true"><i /><i /><i /></div>
        </section>
      ) : null}

      {phase === 'results' && result ? (
        <section className="panel" aria-labelledby="bl-res">
          <h2 id="bl-res" style={{ textAlign: 'center' }}>
            {result.verdict === 'rejected' ? 'Run not accepted' : result.completed ? 'Song complete!' : 'Out of lives!'}
          </h2>
          {result.verdict === 'rejected' ? (
            <p className="bad">The server could not verify this run ({result.reasons?.join(', ')}). Nothing was granted.</p>
          ) : (
            <>
              <div className="stars" aria-label={`${stars} out of 3 stars`}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`st${i < stars ? ' on' : ''}`} style={{ '--i': i } as React.CSSProperties}><Icon name="star" size={58} /></span>
                ))}
              </div>
              <div className="score"><CountUp value={result.score ?? 0} /></div>
              <dl className="stats">
                <div><dt>Perfect</dt><dd>{result.perfects}</dd></div>
                <div><dt>Good</dt><dd>{result.goods}</dd></div>
                <div><dt>Missed</dt><dd>{result.misses}</dd></div>
                <div><dt>Empty taps</dt><dd>{result.strays}</dd></div>
                <div><dt>Best combo</dt><dd>{result.maxCombo}</dd></div>
                <div><dt>Accuracy</dt><dd>{Math.round((result.accuracy ?? 0) * 100)}%</dd></div>
              </dl>
              <div className={`ribbon ${result.verdict === 'accepted' ? 'ok' : 'warn'}`}>
                {result.verdict === 'accepted' ? 'Run accepted' : 'Run flagged for review: Airdrop Points held'}
              </div>
              <div className="chips" aria-label="Rewards earned">
                {chips.map((c, i) => (
                  <span className="chip" key={c.label} style={{ '--i': i } as React.CSSProperties}>
                    <Icon name={c.icon} size={28} />+<CountUp value={c.value} ms={700} /> {c.label}
                  </span>
                ))}
              </div>
            </>
          )}
          <p className="hint">{POINTS_DISCLAIMER}</p>
          <div className="actions sticky-actions">
            <button className="btn primary" type="button" onClick={() => { setResult(null); setLevelUp(null); setPhase('menu'); }}>Play again</button>
          </div>
        </section>
      ) : null}

      {phase === 'results' && levelUp ? (
        <RewardPopup
          title="LEVEL UP!" bigIcon="trophy"
          subtitle={`You reached level ${levelUp.level}: ${levelUp.name}`}
          onClose={() => setLevelUp(null)}
        />
      ) : null}
    </div>
  );
}
