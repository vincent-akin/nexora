'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import '@/styles/sprint.css';
import { TypeBoard, type SprintTheme } from '@/lib/type-sprint/board';
import { RUN_CAP_MS, SPRINT_MAX_LEVEL, sprintConfig, type Key } from '@/lib/type-sprint/core';
import { levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import { BOOSTED_RUN_NOTE, type BoostKind } from '@/lib/boosts';
import { POINTS_DISCLAIMER } from '@/lib/copy';
import Icon from './Icon';
import CountUp from './CountUp';
import RewardPopup from './RewardPopup';
import { BoostPicker, LevelPicker, type RunSetupTheme } from './RunSetup';

interface Props {
  level: number; xp: number; levels: LevelRow[]; stamina: number; staminaCap: number; theme?: SprintTheme;
  /** Highest game level the player may start, and the boosts they own. */
  unlocked: number; owned: Partial<Record<BoostKind, number>>;
  /** Admin practice mode: every level and boost is open, and nothing is earned. */
  practice?: boolean;
}

interface Settled {
  verdict: 'accepted' | 'flagged' | 'rejected';
  flags?: string[];
  reasons?: string[];
  score?: number;
  wpm?: number;
  accuracy?: number;
  correctChars?: number;
  errors?: number;
  wordsDone?: number;
  missed?: number;
  bestStreak?: number;
  stagesCleared?: number;
  startLevel?: number;
  reachedLevel?: number;
  endReason?: 'lives' | 'time';
  stars?: number;
  boosts?: string[];
  practice?: boolean;
  unlocked?: number | null;
  granted?: { xp?: number; coins?: number; airdrop_points?: number };
}

type Phase = 'menu' | 'starting' | 'playing' | 'submitting' | 'results';

const RS_THEME: RunSetupTheme = { accent: '#5CFFB0', accentRgb: '92, 255, 176', ink: '#E8FFF4', dim: '#7FA99A', font: "var(--s-mono)" };

const store = {
  get(k: string, d: string) { try { return localStorage.getItem('nexora.' + k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem('nexora.' + k, v); } catch { /* storage unavailable */ } },
};

function levelSummary(n: number) {
  const c = sprintConfig(n);
  return `${c.minLen} to ${c.maxLen} letters, ${(c.fallMs / 1000).toFixed(1)} s to fall`;
}

export default function TypeSprint({ xp, levels, stamina, staminaCap, theme, unlocked, owned, practice }: Props) {
  const router = useRouter();
  const boardRoot = useRef<HTMLDivElement>(null);
  const boardRef = useRef<TypeBoard | null>(null);
  const soundRef = useRef(true);
  const sessionRef = useRef<string | null>(null);
  const progressRef = useRef({ xp, levels });
  progressRef.current = { xp, levels };

  const [phase, setPhase] = useState<Phase>('menu');
  const [gameLevel, setGameLevel] = useState(Math.min(unlocked, SPRINT_MAX_LEVEL));
  const [boosts, setBoosts] = useState<BoostKind[]>([]);
  const [ladder, setLadder] = useState(unlocked);
  const [sound, setSound] = useState(true);
  const [stamLeft, setStamLeft] = useState(stamina);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Settled | null>(null);
  const [levelUp, setLevelUp] = useState<LevelRow | null>(null);

  useEffect(() => { setStamLeft(stamina); }, [stamina]);
  useEffect(() => { setLadder(unlocked); }, [unlocked]);
  useEffect(() => {
    const s = store.get('sprint.sound', '1') === '1';
    setSound(s);
    soundRef.current = s;
  }, []);
  useEffect(() => {
    if (!boardRoot.current) return;
    const board = new TypeBoard(boardRoot.current);
    boardRef.current = board;
    return () => board.destroy();
  }, []);

  async function submit(keys: Key[]) {
    setPhase('submitting');
    try {
      const res = await fetch(`/api/sprint/${sessionRef.current}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      });
      const data = (await res.json()) as Settled & { error?: string };
      if (!res.ok && !data.verdict) throw new Error(data.error ?? 'submit_failed');
      const p = progressRef.current;
      const before = levelForXp(p.xp, p.levels);
      const after = levelForXp(p.xp + (data.granted?.xp ?? 0), p.levels);
      setResult(data);
      if (data.unlocked) {
        setLadder((u) => Math.max(u, data.unlocked!));
        setGameLevel(Math.min(SPRINT_MAX_LEVEL, data.unlocked));
      }
      setLevelUp(after.level > before.level ? after : null);
      setPhase('results');
      router.refresh();
    } catch {
      setError('Could not reach the server to check your run. Your result was not saved.');
      setPhase('menu');
    }
  }

  async function start() {
    setError(null);
    setPhase('starting');
    boardRef.current?.unlockAudio();
    const res = await fetch('/api/sprint/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: gameLevel, boosts }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'insufficient_stamina') {
        setError(`Out of stamina. The next point arrives in about ${Math.ceil((data.secondsUntilNext ?? 0) / 60)} min.`);
        setStamLeft(data.stamina ?? 0);
      } else if (data.error === 'locked') setError(`Type Sprint unlocks at level ${data.requiredLevel}.`);
      else if (data.error === 'level_locked') setError('That level is still locked. Clear the one before it first.');
      else if (data.error === 'boost_not_owned') setError('You do not own that boost any more. Buy more in the shop.');
      else setError('Could not start a run. Try again.');
      setPhase('menu');
      return;
    }
    sessionRef.current = data.sessionId;
    setStamLeft(data.stamina);
    setBoosts([]);
    setPhase('playing');
    boardRef.current?.start({
      seed: data.seed, spec: { level: data.level, boosts: data.boosts }, sound: soundRef.current, theme,
      onFinish: ({ keys }) => void submit(keys),
    });
  }

  const granted = result?.granted ?? {};
  const stars = result && result.verdict !== 'rejected' ? result.stars ?? 0 : 0;
  const chips = [
    { icon: 'star', label: 'XP', value: granted.xp ?? 0 },
    { icon: 'coin', label: 'Coins', value: granted.coins ?? 0 },
    { icon: 'gem', label: 'Airdrop Points', value: granted.airdrop_points ?? 0 },
  ];

  return (
    <div className={`sprint${theme?.skin?.theme ? ` theme-${theme.skin.theme}` : ''}`}>
      <div className="ts-wrap" ref={boardRoot} />

      {phase === 'menu' || phase === 'starting' ? (
        <section className="sp-panel" aria-labelledby="sp-title">
          <div className="sp-hero">
            <span className="sp-kbd" aria-hidden="true">T</span>
            <div>
              <h1 className="sp-title" id="sp-title">Type Sprint</h1>
              <p>Words fall. Type them before they land. Every level is faster and the words get longer.</p>
            </div>
          </div>
          <div className="sp-level">
            <LevelPicker theme={RS_THEME} maxLevel={SPRINT_MAX_LEVEL} unlocked={ladder} value={gameLevel} onChange={setGameLevel} summary={levelSummary(gameLevel)} />
            <BoostPicker theme={RS_THEME} game="type_sprint" owned={owned} selected={boosts} onChange={setBoosts} />
            {practice ? <p className="sp-hint">Practice mode: every level and boost is open and free. Nothing you earn here is paid or ranked.</p> : null}
          </div>
          <label className="sp-check">
            <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); soundRef.current = e.target.checked; boardRef.current?.setSound(e.target.checked); store.set('sprint.sound', e.target.checked ? '1' : '0'); }} />
            Sound on
          </label>
          {error ? <p className="sp-bad" role="alert">{error}</p> : null}
          <div className="sp-actions">
            <button className="sp-btn go" type="button" onClick={start} disabled={phase === 'starting' || stamLeft < 1}>{phase === 'starting' ? 'Starting' : `Start level ${gameLevel}`}</button>
            <span className="sp-stam"><Icon name="bolt" size={16} /> {stamLeft} / {staminaCap}</span>
          </div>
          <p className="sp-hint">Press a word&apos;s first letter to lock onto it, then finish it. A wrong key costs points and your streak. A word that lands costs a life. Clear every word in a level and the next, faster level starts on its own. A run lasts at most {RUN_CAP_MS / 1000} seconds.</p>
        </section>
      ) : null}

      {phase === 'submitting' ? (
        <section className="sp-panel" aria-live="polite" style={{ justifyContent: 'center', textAlign: 'center' }}>
          <h2>Checking your run</h2>
          <p>The server is replaying your keystrokes.</p>
        </section>
      ) : null}

      {phase === 'results' && result ? (
        <section className="sp-panel" aria-labelledby="sp-res">
          <h2 id="sp-res">{result.verdict === 'rejected' ? 'Run not accepted' : result.endReason === 'time' ? 'Time' : 'Out of lives'}</h2>
          {result.verdict === 'rejected' ? (
            <p className="sp-bad">The server could not verify this run ({result.reasons?.join(', ')}). Nothing was granted.</p>
          ) : (
            <>
              <div className="sp-stars" role="img" aria-label={`${stars} out of 3 stars`}>
                {[0, 1, 2].map((i) => <span key={i} className={`st${i < stars ? ' on' : ''}`} style={{ '--i': i } as React.CSSProperties}><Icon name="star" size={48} /></span>)}
              </div>
              <div className="sp-score"><CountUp value={result.score ?? 0} /></div>
              <dl className="sp-stats">
                <div><dt>Reached level</dt><dd>{result.reachedLevel}</dd></div>
                <div><dt>Speed</dt><dd>{result.wpm} wpm</dd></div>
                <div><dt>Accuracy</dt><dd>{Math.round((result.accuracy ?? 0) * 100)}%</dd></div>
                <div><dt>Words</dt><dd>{result.wordsDone}</dd></div>
                <div><dt>Missed</dt><dd>{result.missed}</dd></div>
                <div><dt>Best streak</dt><dd>{result.bestStreak}</dd></div>
              </dl>
              <div className={`sp-ribbon ${result.verdict === 'accepted' ? 'ok' : 'warn'}`}>
                {result.verdict === 'accepted' ? 'Run accepted' : 'Run flagged for review: Airdrop Points held, level progress paused'}
              </div>
              <p className="sp-hint">
                {result.unlocked ? `Level ${result.unlocked} is open.` : result.verdict === 'accepted' ? `Clear level ${result.startLevel} to unlock the next.` : ''}
                {result.boosts && result.boosts.length ? ` ${BOOSTED_RUN_NOTE}` : ''}
                {result.practice ? ' Practice run: nothing was earned.' : ''}
              </p>
              <div className="sp-chips" aria-label="Rewards earned">
                {chips.map((c, i) => <span className="sp-chip" key={c.label} style={{ '--i': i } as React.CSSProperties}><Icon name={c.icon} size={22} />+<CountUp value={c.value} ms={700} /> {c.label}</span>)}
              </div>
            </>
          )}
          <p className="sp-hint">{POINTS_DISCLAIMER}</p>
          <div className="sp-actions sticky-actions">
            <button className="sp-btn go" type="button" onClick={() => { setResult(null); setLevelUp(null); setPhase('menu'); }}>Play again</button>
          </div>
        </section>
      ) : null}

      {phase === 'results' && levelUp ? <RewardPopup variant="shell" title="Level up" bigIcon="trophy" subtitle={`You reached level ${levelUp.level}: ${levelUp.name}`} onClose={() => setLevelUp(null)} /> : null}
    </div>
  );
}
