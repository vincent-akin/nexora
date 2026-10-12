'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import '@/styles/vault.css';
import { CardBoard, type CardApi, type FlipResponse } from '@/lib/card-clash/board';
import { CARD_CONFIG, CARD_MIN_LEVEL, keysFor, type CardDifficulty } from '@/lib/card-clash/core';
import { levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import { VAULT_DOOR_SVG } from '@/lib/icons';
import { POINTS_DISCLAIMER } from '@/lib/copy';
import Icon from './Icon';
import CountUp from './CountUp';
import RewardPopup from './RewardPopup';

interface Props { level: number; xp: number; levels: LevelRow[]; stamina: number; staminaCap: number }

interface Settled {
  score: number;
  matchedPairs: number;
  totalPairs: number;
  mismatches: number;
  cleared: boolean;
  timeMs: number;
  quality: number;
  bestStreak: number;
  flipCount: number;
  verdict: 'accepted' | 'flagged' | 'rejected';
  flags?: string[];
  reasons?: string[];
  granted?: { xp?: number; coins?: number; airdrop_points?: number };
}

type Phase = 'menu' | 'starting' | 'playing' | 'results';

const store = {
  get(k: string, d: string) { try { return localStorage.getItem('nexora.' + k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem('nexora.' + k, v); } catch { /* storage unavailable */ } },
};
const label = (d: string) => d[0].toUpperCase() + d.slice(1);
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export default function CardClash({ level, xp, levels, stamina, staminaCap }: Props) {
  const router = useRouter();
  const boardRoot = useRef<HTMLDivElement>(null);
  const boardRef = useRef<CardBoard | null>(null);
  const soundRef = useRef(true);
  const progressRef = useRef({ xp, levels });
  progressRef.current = { xp, levels };

  const [phase, setPhase] = useState<Phase>('menu');
  const [difficulty, setDifficulty] = useState<CardDifficulty>('normal');
  const [sound, setSound] = useState(true);
  const [stamLeft, setStamLeft] = useState(stamina);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<Settled | null>(null);
  const [levelUp, setLevelUp] = useState<LevelRow | null>(null);

  useEffect(() => { setStamLeft(stamina); }, [stamina]);
  useEffect(() => {
    const s = store.get('vault.sound', '1') === '1';
    setSound(s);
    soundRef.current = s;
  }, []);

  const handleEnd = useCallback((final: unknown) => {
    const data = final as Settled;
    const p = progressRef.current;
    const before = levelForXp(p.xp, p.levels);
    const after = levelForXp(p.xp + (data.granted?.xp ?? 0), p.levels);
    setResult(data);
    setLevelUp(after.level > before.level ? after : null);
    setPhase('results');
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!boardRoot.current) return;
    const board = new CardBoard(boardRoot.current);
    boardRef.current = board;
    return () => board.destroy();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  async function start() {
    setError(null);
    setPhase('starting');
    boardRef.current?.unlockAudio();
    const res = await fetch('/api/cards/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'insufficient_stamina') {
        setError(`Out of stamina. The next point arrives in about ${Math.ceil((data.secondsUntilNext ?? 0) / 60)} min.`);
        setStamLeft(data.stamina ?? 0);
      } else if (data.error === 'locked') {
        setError(`That difficulty unlocks at level ${data.requiredLevel}.`);
      } else {
        setError('Could not start a run. Try again.');
      }
      setPhase('menu');
      return;
    }
    setStamLeft(data.stamina);
    const id = data.sessionId as string;
    // Every card face arrives through this call. The deck itself never reaches the browser.
    const api: CardApi = {
      async flip(index) {
        const r = await fetch(`/api/cards/${id}/flip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index }),
        });
        const body = await r.json();
        if (r.status === 410) throw { final: body.final };
        if (!r.ok) throw new Error(body.error ?? 'flip_failed');
        return body as FlipResponse;
      },
      async finish() {
        const r = await fetch(`/api/cards/${id}/finish`, { method: 'POST' });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'finish_failed');
        return body;
      },
    };
    setPhase('playing');
    boardRef.current?.start({
      cols: data.cols, rows: data.rows, pairs: data.pairs, timeLimitMs: data.timeLimitMs,
      api, sound: soundRef.current, onEnd: handleEnd, onError: (m) => setNotice(m),
    });
  }

  const granted = result?.granted ?? {};
  const keys = result && result.verdict !== 'rejected' ? keysFor(result.quality, result.cleared) : 0;
  const chips = [
    { icon: 'star', label: 'XP', value: granted.xp ?? 0 },
    { icon: 'coin', label: 'Coins', value: granted.coins ?? 0 },
    { icon: 'gem', label: 'Airdrop Points', value: granted.airdrop_points ?? 0 },
  ];

  return (
    <div className="vault">
      <div className="vb-wrap" ref={boardRoot} />
      {notice ? <div role="status" className="vhint" style={{ position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center', zIndex: 5 }}>{notice}</div> : null}

      {phase === 'menu' || phase === 'starting' ? (
        <section className="vpanel" aria-labelledby="cc-title">
          <div className="vhero">
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: VAULT_DOOR_SVG }} />
            <div>
              <h1 className="vtitle" id="cc-title">Card Clash</h1>
              <p className="vtag">Find every pair before the vault locks.</p>
            </div>
          </div>

          <div className="vgroup">
            <span className="vlabel" id="cc-diff">Choose a vault</span>
            <div className="vseg" role="radiogroup" aria-labelledby="cc-diff">
              {(Object.keys(CARD_CONFIG) as CardDifficulty[]).map((d) => {
                const c = CARD_CONFIG[d];
                const locked = level < CARD_MIN_LEVEL[d];
                return (
                  <button key={d} type="button" role="radio" aria-checked={d === difficulty} disabled={locked} onClick={() => setDifficulty(d)}>
                    {label(d)}
                    <span>{locked ? `Unlocks at level ${CARD_MIN_LEVEL[d]}` : `${c.pairs} pairs, ${c.timeLimitMs / 1000} s`}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="vcheck">
            <input
              type="checkbox" checked={sound}
              onChange={(e) => { setSound(e.target.checked); soundRef.current = e.target.checked; boardRef.current?.setSound(e.target.checked); store.set('vault.sound', e.target.checked ? '1' : '0'); }}
            />
            Sound on
          </label>

          {error ? <p className="vbad" role="alert">{error}</p> : null}
          <div className="vactions">
            <button className="vbtn gold" type="button" onClick={start} disabled={phase === 'starting' || stamLeft < 1}>
              {phase === 'starting' ? 'Opening' : 'Open the vault'}
            </button>
            <span className="vstam"><Icon name="bolt" size={16} /> {stamLeft} / {staminaCap}</span>
          </div>
          <p className="vhint">Flip two cards at a time. Matches stay face up, mistakes cost points, and quick clears earn a time bonus.</p>
          <p className="vhint">The deck is dealt and kept on the server. Every card you flip is checked there.</p>
        </section>
      ) : null}

      {phase === 'results' && result ? (
        <section className="vpanel" aria-labelledby="cc-res">
          <h2 id="cc-res">{result.verdict === 'rejected' ? 'Run not accepted' : result.cleared ? 'Vault cracked!' : 'The vault locked'}</h2>
          {result.verdict === 'rejected' ? (
            <p className="vbad">The server could not verify this run ({result.reasons?.join(', ')}). Nothing was granted.</p>
          ) : (
            <>
              <div className="vkeys" role="img" aria-label={`${keys} out of 3 keys`}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`k${i < keys ? ' on' : ''}`} style={{ '--i': i } as React.CSSProperties}><Icon name="key" size={64} /></span>
                ))}
              </div>
              <div className="vscore"><CountUp value={result.score} /></div>
              <dl className="vstats">
                <div><dt>Pairs</dt><dd>{result.matchedPairs}/{result.totalPairs}</dd></div>
                <div><dt>Mistakes</dt><dd>{result.mismatches}</dd></div>
                <div><dt>Time</dt><dd>{result.cleared ? mmss(result.timeMs) : 'Locked'}</dd></div>
                <div><dt>Best streak</dt><dd>{result.bestStreak}</dd></div>
                <div><dt>Accuracy</dt><dd>{Math.round(result.quality * 100)}%</dd></div>
                <div><dt>Flips</dt><dd>{result.flipCount}</dd></div>
              </dl>
              <div className={`vribbon ${result.verdict === 'accepted' ? 'ok' : 'warn'}`}>
                {result.verdict === 'accepted' ? 'Run accepted' : 'Run flagged for review: Airdrop Points held'}
              </div>
              <div className="vchips" aria-label="Rewards earned">
                {chips.map((c, i) => (
                  <span className="vchip" key={c.label} style={{ '--i': i } as React.CSSProperties}>
                    <Icon name={c.icon} size={24} />+<CountUp value={c.value} ms={700} /> {c.label}
                  </span>
                ))}
              </div>
            </>
          )}
          <p className="vhint">{POINTS_DISCLAIMER}</p>
          <div className="vactions sticky-actions">
            <button className="vbtn gold" type="button" onClick={() => { setResult(null); setLevelUp(null); setPhase('menu'); }}>Play again</button>
          </div>
        </section>
      ) : null}

      {phase === 'results' && levelUp ? (
        <RewardPopup variant="vault" title="LEVEL UP" bigIcon="trophy" subtitle={`You reached level ${levelUp.level}: ${levelUp.name}`} onClose={() => setLevelUp(null)} />
      ) : null}
    </div>
  );
}
