'use client';

import { useEffect, useRef } from 'react';
import Confetti from './Confetti';
import Icon from './Icon';
import LineIcon from './LineIcon';

export interface Chip { icon: string; label: string; value: number }

interface Props {
  title: string;
  subtitle?: string;
  bigIcon?: string;
  chips?: Chip[];
  /** 'game' is the bouncy candy popup (Beat Lanes). 'vault' is the gold-and-teal popup (Card Clash). 'shell' is the calm platform modal. */
  variant?: 'game' | 'shell' | 'vault';
  onClose: () => void;
}

export default function RewardPopup({ title, subtitle, bigIcon = 'sparkle', chips = [], variant = 'game', onClose }: Props) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (variant === 'vault') {
    return (
      <div className="v-popup-back" onClick={onClose} role="presentation">
        <div className="v-popup" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <span className="big-ic"><Icon name={bigIcon} size={76} /></span>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
          <button ref={btn} className="vbtn gold" type="button" onClick={onClose}>Continue</button>
        </div>
      </div>
    );
  }

  if (variant === 'shell') {
    return (
      <div className="modal-back" onClick={onClose} role="presentation">
        <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <span className="modal-icon"><LineIcon name="check" size={26} /></span>
          <h2>{title}</h2>
          {subtitle ? <p className="dim">{subtitle}</p> : null}
          {chips.length ? (
            <ul className="reward-list">
              {chips.map((c) => (
                <li key={c.label}><Icon name={c.icon} size={22} /><span>{c.label}</span><b>+{c.value.toLocaleString()}</b></li>
              ))}
            </ul>
          ) : null}
          <button ref={btn} className="btn primary" type="button" onClick={onClose}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div className="popup-back" onClick={onClose} role="presentation">
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
