'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import '@/styles/blockdrop.css';
import { BlockBoard, type BlockTheme } from '@/lib/block-drop/board';
import { BLOCK_MAX_LEVEL, LINES_PER_LEVEL, gravityMs, type Action } from '@/lib/block-drop/core';
import { levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import { BOOSTED_RUN_NOTE, type BoostKind } from '@/lib/boosts';
import { POINTS_DISCLAIMER } from '@/lib/copy';
import Icon from './Icon';
import CountUp from './CountUp';
import RewardPopup from './RewardPopup';
import { BoostPicker, LevelPicker, type RunSetupTheme } from './RunSetup';

interface Props {
  level: number; xp: number; levels: LevelRow[]; stamina: number; staminaCap: number; theme?: BlockTheme;
  /** Highest game level the player may start, and the boosts they own. */
  unlocked: number; owned: Partial<Record<BoostKind, number>>;
  /** Admin practice mode: every level and boost is open, and nothing is earned. */
  practice?: boolean;
}

interface Settled {
  verdict: 'accepted' | 'flagged' | 'rejected';
  reasons?: string[];
  score?: number; lines?: number; pieces?: number; bestCombo?: number;
  startLevel?: number; reachedLevel?: number; endReason?: 'topout' | 'time';
  stars?: number; boosts?: string[]; practice?: boolean; unlocked?: number | null;
  granted?: { xp?: number; coins?: number; airdrop_points?: number };
}

type Phase = 'menu' | 'starting' | 'playing' | 'submitting' | 'results';

const RS_THEME: RunSetupTheme = { accent: '#B054E8', accentRgb: '176, 84, 232', ink: '#F1EEFF', dim: '#A59CCB' };

const store = {
  get(k: string, d: string) { try { return localStorage.getItem('nexora.' + k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem('nexora.' + k, v); } catch { /* storage unavailable */ } },
};

const levelSummary = (n: number) => `a block falls every ${(gravityMs(n) / 1000).toFixed(2)} s`;

export default function BlockDrop({ xp, levels, stamina, staminaCap, theme, unlocked, owned, practice }: Props) {
  const router = useRouter();
  const boardRoot = useRef<HTMLDivElement>(null);
  const boardRef = useRef<BlockBoard | null>(null);
  const soundRef = useRef(true);
  const sessionRef = useRef<string | null>(null);
  const progressRef = useRef({ xp, levels });
  progressRef.current = { xp, levels };

  const [phase, setPhase] = useState<Phase>('menu');
  const [gameLevel, setGameLevel] = useState(Math.min(unlocked, BLOCK_MAX_LEVEL));
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
    const s = store.get('blocks.sound', '1') === '1';
    setSound(s);
    soundRef.current = s;
  }, []);
  useEffect(() => {
    if (!boardRoot.current) return;
    const board = new BlockBoard(boardRoot.current);
    boardRef.current = board;
    return () => board.destroy();
  }, []);

  async function submit(actions: Action[]) {
    setPhase('submitting');
    try {
      const res = await fetch(`/api/blocks/${sessionRef.current}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actions }),
      });
      const data = (await res.json()) as Settled & { error?: string };
      if (!res.ok && !data.verdict) throw new Error(data.error ?? 'submit_failed');
      const p = progressRef.current;
      const before = levelForXp(p.xp, p.levels);
      const after = levelForXp(p.xp + (data.granted?.xp ?? 0), p.levels);
      setResult(data);
      if (data.unlocked) { setLadder((u) => Math.max(u, data.unlocked!)); setGameLevel(Math.min(BLOCK_MAX_LEVEL, data.unlocked)); }
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
    const res = await fetch('/api/blocks/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: gameLevel, boosts }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'insufficient_stamina') {
        setError(`Out of stamina. The next point arrives in about ${Math.ceil((data.secondsUntilNext ?? 0) / 60)} min.`);
        setStamLeft(data.stamina ?? 0);
      } else if (data.error === 'locked') setError(`Block Drop unlocks at level ${data.requiredLevel}.`);
      else if (data.error === 'level_locked') setError('That level is still locked. Reach it in a run first.');
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
      onFinish: ({ actions }) => void submit(actions),
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
    <div className={`blockdrop${theme?.skin?.theme ? ` theme-${theme.skin.theme}` : ''}`}>
      <div className="bd-wrap" ref={boardRoot} />

      {phase === 'menu' || phase === 'starting' ? (
        <section className="bp-panel" aria-labelledby="bp-title">
          <div className="bp-hero">
            <span className="bp-logo" aria-hidden="true"><i /><i /><i /><i /></span>
            <div>
              <h1 className="bp-title" id="bp-title">Block Drop</h1>
              <p>Stack the falling blocks and clear lines. Every {LINES_PER_LEVEL} lines the level rises and the blocks fall faster.</p>
            </div>
          </div>
          <LevelPicker theme={RS_THEME} maxLevel={BLOCK_MAX_LEVEL} unlocked={ladder} value={gameLevel} onChange={setGameLevel} summary={levelSummary(gameLevel)} />
          <BoostPicker theme={RS_THEME} game="block_drop" owned={owned} selected={boosts} onChange={setBoosts} />
          {practice ? <p className="bp-hint">Practice mode: every level and boost is open and free. Nothing you earn here is paid or ranked.</p> : null}
          <label className="bp-check">
            <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); soundRef.current = e.target.checked; boardRef.current?.setSound(e.target.checked); store.set('blocks.sound', e.target.checked ? '1' : '0'); }} />
            Sound on
          </label>
          {error ? <p className="bp-bad" role="alert">{error}</p> : null}
          <div className="bp-actions">
            <button className="bp-btn" type="button" onClick={start} disabled={phase === 'starting' || stamLeft < 1}>{phase === 'starting' ? 'Starting' : `Start level ${gameLevel}`}</button>
            <span className="bp-stam"><Icon name="bolt" size={16} /> {stamLeft} / {staminaCap}</span>
          </div>
          <p className="bp-hint">A run ends when the stack reaches the top, or after 150 seconds. Reach a higher level in a run to unlock it as a starting level.</p>
        </section>
      ) : null}

      {phase === 'submitting' ? (
        <section className="bp-panel" aria-live="polite" style={{ justifyContent: 'center', textAlign: 'center' }}>
          <h2>Checking your run</h2>
          <p>The server is replaying your moves.</p>
        </section>
      ) : null}

      {phase === 'results' && result ? (
        <section className="bp-panel" aria-labelledby="bp-res">
          <h2 id="bp-res">{result.verdict === 'rejected' ? 'Run not accepted' : result.endReason === 'time' ? 'Time' : 'Stacked out'}</h2>
          {result.verdict === 'rejected' ? (
            <p className="bp-bad">The server could not verify this run ({result.reasons?.join(', ')}). Nothing was granted.</p>
          ) : (
            <>
              <div className="bp-stars" role="img" aria-label={`${stars} out of 3 stars`}>
                {[0, 1, 2].map((i) => <span key={i} className={`st${i < stars ? ' on' : ''}`} style={{ '--i': i } as React.CSSProperties}><Icon name="star" size={48} /></span>)}
              </div>
              <div className="bp-score"><CountUp value={result.score ?? 0} /></div>
              <dl className="bp-stats">
                <div><dt>Reached level</dt><dd>{result.reachedLevel}</dd></div>
                <div><dt>Lines</dt><dd>{result.lines}</dd></div>
                <div><dt>Blocks</dt><dd>{result.pieces}</dd></div>
                <div><dt>Best combo</dt><dd>{result.bestCombo}</dd></div>
              </dl>
              <div className={`bp-ribbon ${result.verdict === 'accepted' ? 'ok' : 'warn'}`}>
                {result.verdict === 'accepted' ? 'Run accepted' : 'Run flagged for review: Airdrop Points held, level progress paused'}
              </div>
              <p className="bp-hint">
                {result.unlocked ? `Level ${result.unlocked} is open.` : result.verdict === 'accepted' ? `Clear ${LINES_PER_LEVEL} lines to move up from level ${result.startLevel}.` : ''}
                {result.boosts && result.boosts.length ? ` ${BOOSTED_RUN_NOTE}` : ''}
                {result.practice ? ' Practice run: nothing was earned.' : ''}
              </p>
              <div className="bp-chips" aria-label="Rewards earned">
                {chips.map((c, i) => <span className="bp-chip" key={c.label} style={{ '--i': i } as React.CSSProperties}><Icon name={c.icon} size={22} />+<CountUp value={c.value} ms={700} /> {c.label}</span>)}
              </div>
            </>
          )}
          <p className="bp-hint">{POINTS_DISCLAIMER}</p>
          <div className="bp-actions bp-sticky">
            <button className="bp-btn" type="button" onClick={() => { setResult(null); setLevelUp(null); setPhase('menu'); }}>Play again</button>
          </div>
        </section>
      ) : null}

      {phase === 'results' && levelUp ? <RewardPopup variant="shell" title="Level up" bigIcon="trophy" subtitle={`You reached level ${levelUp.level}: ${levelUp.name}`} onClose={() => setLevelUp(null)} /> : null}
    </div>
  );
}
