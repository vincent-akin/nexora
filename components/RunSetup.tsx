'use client';

import Link from 'next/link';
import '@/styles/runsetup.css';
import LineIcon from './LineIcon';
import { BOOST_TEXT, BOOSTED_RUN_NOTE, GAME_BOOSTS, MAX_BOOSTS_PER_RUN, type BoostKind } from '@/lib/boosts';
import type { GameKey } from '@/lib/levels';

/** Colours each game passes in so the shared pickers match its own screen. */
export interface RunSetupTheme { accent: string; accentRgb: string; ink: string; dim: string; font?: string }

const vars = (t: RunSetupTheme) => ({ '--rs-accent': t.accent, '--rs-rgb': t.accentRgb, '--rs-ink': t.ink, '--rs-dim': t.dim, '--rs-font': t.font ?? 'inherit' }) as React.CSSProperties;

interface LevelProps {
  theme: RunSetupTheme;
  maxLevel: number;
  unlocked: number;
  value: number;
  onChange: (level: number) => void;
  /** One short line describing what the chosen level is like. */
  summary: string;
}

/** A row of numbered chips. Levels past the highest unlocked one are locked. */
export function LevelPicker({ theme, maxLevel, unlocked, value, onChange, summary }: LevelProps) {
  return (
    <div className="rs" style={vars(theme)}>
      <div className="rs-head">
        <span className="rs-label" id="rs-level">Level</span>
        <span className="rs-sum" aria-live="polite">{summary}</span>
      </div>
      <div className="rs-levels" role="radiogroup" aria-labelledby="rs-level">
        {Array.from({ length: maxLevel }, (_, i) => i + 1).map((n) => {
          const locked = n > unlocked;
          return (
            <button key={n} type="button" role="radio" aria-checked={n === value} disabled={locked} onClick={() => onChange(n)}
              className={`rs-chip${n === value ? ' on' : ''}${locked ? ' locked' : ''}`} aria-label={locked ? `Level ${n}, locked` : `Level ${n}`}>
              {locked ? <LineIcon name="lock" size={12} /> : n}
            </button>
          );
        })}
      </div>
      <p className="rs-note">Clear a level to unlock the next. You have unlocked {unlocked} of {maxLevel}.</p>
    </div>
  );
}

interface BoostProps {
  theme: RunSetupTheme;
  game: GameKey;
  /** What the player owns, by kind. */
  owned: Partial<Record<BoostKind, number>>;
  selected: BoostKind[];
  onChange: (next: BoostKind[]) => void;
}

/** Toggles for the boosts this game sells. Owning none sends the player to the shop. */
export function BoostPicker({ theme, game, owned, selected, onChange }: BoostProps) {
  const kinds = GAME_BOOSTS[game];
  function toggle(k: BoostKind) {
    if (selected.includes(k)) onChange(selected.filter((x) => x !== k));
    else if (selected.length < MAX_BOOSTS_PER_RUN) onChange([...selected, k]);
  }
  return (
    <div className="rs" style={vars(theme)}>
      <div className="rs-head">
        <span className="rs-label">Boosts</span>
        <Link href="/shop" className="rs-link"><LineIcon name="bag" size={13} /> Shop</Link>
      </div>
      <div className="rs-boosts">
        {kinds.map((k) => {
          const text = BOOST_TEXT[game][k]!;
          const qty = owned[k] ?? 0;
          const on = selected.includes(k);
          return (
            <button key={k} type="button" aria-pressed={on} disabled={qty < 1} onClick={() => toggle(k)} className={`rs-boost${on ? ' on' : ''}`}>
              <b>{text.name}</b>
              <span>{text.blurb}</span>
              <em>{qty > 0 ? `${qty} owned` : 'None owned'}</em>
            </button>
          );
        })}
      </div>
      {selected.length ? <p className="rs-note warn">{BOOSTED_RUN_NOTE}</p> : null}
    </div>
  );
}
