'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import '@/styles/detective.css';
import { DetectiveBoard, type AnswerResponse, type DetectiveApi, type DetectiveTheme } from '@/lib/market-detective/board';
import { DETECTIVE_MAX_LEVEL, detectiveConfig, detectiveStars } from '@/lib/market-detective/core';
import type { BoostKind } from '@/lib/boosts';
import { BOOSTED_RUN_NOTE } from '@/lib/boosts';
import { BoostPicker, LevelPicker, type RunSetupTheme } from './RunSetup';
import { levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import { POINTS_DISCLAIMER } from '@/lib/copy';
import Icon from './Icon';
import CountUp from './CountUp';
import RewardPopup from './RewardPopup';

interface Props {
  level: number; xp: number; levels: LevelRow[]; stamina: number; staminaCap: number; theme?: DetectiveTheme;
  /** Highest game level the player may start, and the boosts they own. */
  unlocked: number; owned: Partial<Record<BoostKind, number>>;
  /** Admin practice mode: every level and boost is open, and nothing is earned. */
  practice?: boolean;
}

const RS_THEME: RunSetupTheme = { accent: '#4CC9F0', accentRgb: '76, 201, 240', ink: '#E8EEF9', dim: '#8FA0BE' };

interface Settled {
  verdict: 'accepted' | 'flagged' | 'rejected';
  flags?: string[];
  reasons?: string[];
  score: number;
  correct: number;
  rounds: number;
  quality: number;
  bestStreak: number;
  medianMs: number;
  granted?: { xp?: number; coins?: number; airdrop_points?: number };
  level?: number;
  boosts?: string[];
  practice?: boolean;
  cleared?: boolean;
  unlocked?: number | null;
}

type Phase = 'menu' | 'starting' | 'playing' | 'results';

const store = {
  get(k: string, d: string) { try { return localStorage.getItem('nexora.' + k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem('nexora.' + k, v); } catch { /* storage unavailable */ } },
};
function levelSummary(n: number) {
  const c = detectiveConfig({ level: n, boosts: [] });
  return `${c.rounds} rounds, ${Math.round(c.roundMs / 1000)} s each, ${c.options} companies`;
}

export default function MarketDetective({ level, xp, levels, stamina, staminaCap, theme, unlocked, owned, practice }: Props) {
  const router = useRouter();
  const boardRoot = useRef<HTMLDivElement>(null);
  const boardRef = useRef<DetectiveBoard | null>(null);
  const soundRef = useRef(true);
  const progressRef = useRef({ xp, levels });
  progressRef.current = { xp, levels };

  const [phase, setPhase] = useState<Phase>('menu');
  const [gameLevel, setGameLevel] = useState(Math.min(unlocked, DETECTIVE_MAX_LEVEL));
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
    const s = store.get('detective.sound', '1') === '1';
    setSound(s);
    soundRef.current = s;
  }, []);
  useEffect(() => {
    if (!boardRoot.current) return;
    const board = new DetectiveBoard(boardRoot.current);
    boardRef.current = board;
    return () => board.destroy();
  }, []);

  function end(final: unknown) {
    const data = final as Settled;
    const p = progressRef.current;
    const before = levelForXp(p.xp, p.levels);
    const after = levelForXp(p.xp + (data.granted?.xp ?? 0), p.levels);
    setResult(data);
    if (data.unlocked) { setLadder((u) => Math.max(u, data.unlocked!)); if (data.cleared) setGameLevel(Math.min(DETECTIVE_MAX_LEVEL, (data.level ?? gameLevel) + 1)); }
    setLevelUp(after.level > before.level ? after : null);
    setPhase('results');
    router.refresh();
  }

  async function start() {
    setError(null);
    setPhase('starting');
    boardRef.current?.unlockAudio();
    const res = await fetch('/api/detective/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: gameLevel, boosts }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'insufficient_stamina') {
        setError(`Out of stamina. The next point arrives in about ${Math.ceil((data.secondsUntilNext ?? 0) / 60)} min.`);
        setStamLeft(data.stamina ?? 0);
      } else if (data.error === 'locked') setError(`Market Detective unlocks at level ${data.requiredLevel}.`);
      else if (data.error === 'level_locked') setError('That level is still locked. Clear the one before it first.');
      else if (data.error === 'boost_not_owned') setError('You do not own that boost any more. Buy more in the shop.');
      else setError('Could not start a run. Try again.');
      setPhase('menu');
      return;
    }
    setStamLeft(data.stamina);
    const id = data.sessionId as string;
    // One round at a time. The answer to a round is revealed only after the answer is submitted.
    const api: DetectiveApi = {
      async round(n) {
        const r = await fetch(`/api/detective/${id}/round`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n }) });
        if (!r.ok) throw new Error('round_failed');
        return r.json();
      },
      async answer(choice) {
        const r = await fetch(`/api/detective/${id}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) });
        if (!r.ok) throw new Error('answer_failed');
        return (await r.json()) as AnswerResponse;
      },
    };
    setPhase('playing');
    boardRef.current?.start({
      rounds: data.rounds, roundMs: data.roundMs, api, sound: soundRef.current, theme, onEnd: end,
      onError: (m) => setError(m),
    });
  }

  const granted = result?.granted ?? {};
  const stars = result && result.verdict !== 'rejected' ? detectiveStars(result.quality) : 0;
  const chips = [
    { icon: 'star', label: 'XP', value: granted.xp ?? 0 },
    { icon: 'coin', label: 'Coins', value: granted.coins ?? 0 },
    { icon: 'gem', label: 'Airdrop Points', value: granted.airdrop_points ?? 0 },
  ];

  return (
    <div className={`desk${theme?.skin?.theme ? ` theme-${theme.skin.theme}` : ''}`}>
      <div className="dk-wrap" ref={boardRoot} />

      {phase === 'menu' || phase === 'starting' ? (
        <section className="dp-panel" aria-labelledby="dp-title">
          <div className="dp-hero">
            <span className="dp-glyph" aria-hidden="true"><svg viewBox="0 0 44 30"><polyline points="2,26 12,16 20,21 30,8 42,3" /></svg></span>
            <div>
              <h1 className="dp-title" id="dp-title">Market Detective</h1>
              <p>Read the charts and answer before the clock runs out.</p>
            </div>
          </div>
          <LevelPicker theme={RS_THEME} maxLevel={DETECTIVE_MAX_LEVEL} unlocked={ladder} value={gameLevel} onChange={setGameLevel} summary={levelSummary(gameLevel)} />
          <BoostPicker theme={RS_THEME} game="market_detective" owned={owned} selected={boosts} onChange={setBoosts} />
          {practice ? <p className="dp-hint">Practice mode: every level and boost is open and free. Nothing you earn here is paid or ranked.</p> : null}
          <label className="dp-check">
            <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); soundRef.current = e.target.checked; boardRef.current?.setSound(e.target.checked); store.set('detective.sound', e.target.checked ? '1' : '0'); }} />
            Sound on
          </label>
          {error ? <p className="dp-bad" role="alert">{error}</p> : null}
          <div className="dp-actions">
            <button className="dp-btn go" type="button" onClick={start} disabled={phase === 'starting' || stamLeft < 1}>{phase === 'starting' ? 'Opening' : 'Open the desk'}</button>
            <span className="dp-stam"><Icon name="bolt" size={16} /> {stamLeft} / {staminaCap}</span>
          </div>
          <p className="dp-hint">Higher levels bring more rounds, less time, more companies and harder questions. Test data: the companies are made up and the prices are generated. Past performance is not a guide to the future, and nothing here is investment advice. Each round is dealt by the server, which times your answer and keeps the right answer until you commit.</p>
        </section>
      ) : null}

      {phase === 'results' && result ? (
        <section className="dp-panel" aria-labelledby="dp-res">
          <h2 id="dp-res">{result.verdict === 'rejected' ? 'Run not accepted' : 'Case closed'}</h2>
          {result.verdict === 'rejected' ? (
            <p className="dp-bad">The server could not verify this run ({result.reasons?.join(', ')}). Nothing was granted.</p>
          ) : (
            <>
              <div className="dp-stars" role="img" aria-label={`${stars} out of 3 stars`}>
                {[0, 1, 2].map((i) => <span key={i} className={`st${i < stars ? ' on' : ''}`} style={{ '--i': i } as React.CSSProperties}><Icon name="star" size={48} /></span>)}
              </div>
              <div className="dp-score"><CountUp value={result.score} /></div>
              <dl className="dp-stats">
                <div><dt>Correct</dt><dd>{result.correct}/{result.rounds}</dd></div>
                <div><dt>Best streak</dt><dd>{result.bestStreak}</dd></div>
                <div><dt>Median time</dt><dd>{(result.medianMs / 1000).toFixed(1)} s</dd></div>
              </dl>
              <div className={`dp-ribbon ${result.verdict === 'accepted' ? 'ok' : 'warn'}`}>
                {result.verdict === 'accepted' ? 'Run accepted' : 'Run flagged for review: Airdrop Points held'}
              </div>
              <p className="dp-hint">
                {result.cleared ? `Level ${result.level} cleared.${(result.level ?? 0) < DETECTIVE_MAX_LEVEL ? ` Level ${(result.level ?? 0) + 1} is open.` : ' You finished the ladder.'}` : `Level ${result.level} not cleared. Get 60% right to unlock the next one.`}
                {result.boosts && result.boosts.length ? ` ${BOOSTED_RUN_NOTE}` : ''}
                {result.practice ? ' Practice run: nothing was earned.' : ''}
              </p>
              <div className="dp-chips" aria-label="Rewards earned">
                {chips.map((c, i) => <span className="dp-chip" key={c.label} style={{ '--i': i } as React.CSSProperties}><Icon name={c.icon} size={22} />+<CountUp value={c.value} ms={700} /> {c.label}</span>)}
              </div>
            </>
          )}
          <p className="dp-hint">{POINTS_DISCLAIMER}</p>
          <div className="dp-actions sticky-actions">
            <button className="dp-btn go" type="button" onClick={() => { setResult(null); setLevelUp(null); setPhase('menu'); }}>Play again</button>
          </div>
        </section>
      ) : null}

      {phase === 'results' && levelUp ? <RewardPopup variant="shell" title="Level up" bigIcon="trophy" subtitle={`You reached level ${levelUp.level}: ${levelUp.name}`} onClose={() => setLevelUp(null)} /> : null}
    </div>
  );
}
