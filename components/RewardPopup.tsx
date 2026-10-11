'use client';

import { useEffect, useRef } from 'react';
import Confetti from './Confetti';
import Icon from './Icon';

export interface Chip { icon: string; label: string; value: number }

interface Props {
  title: string;
  subtitle?: string;
  bigIcon?: string;
  chips?: Chip[];
  /** Cover the whole page (true) or only the nearest positioned parent such as the game stage. */
  fixed?: boolean;
  onClose: () => void;
}

/** A bouncy celebratory popup with confetti. Closes on the button, a backdrop click, or Escape. */
export default function RewardPopup({ title, subtitle, bigIcon = 'sparkle', chips = [], fixed = false, onClose }: Props) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`popup-back${fixed ? ' fixed' : ''}`} onClick={onClose} role="presentation">
      <Confetti />
      <div className="popup" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="big-ic"><Icon name={bigIcon} size={84} /></span>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
        {chips.length ? (
          <div className="chips">
            {chips.map((c, i) => (
              <span className="chip" key={c.label} style={{ '--i': i } as React.CSSProperties}>
                <Icon name={c.icon} size={28} />+{c.value.toLocaleString()} {c.label}
              </span>
            ))}
          </div>
        ) : null}
        <button ref={btn} className="btn lime" type="button" onClick={onClose}>Awesome!</button>
      </div>
    </div>
  );
}
