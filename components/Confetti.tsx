'use client';

import { useMemo } from 'react';

const COLORS = ['#FF4D9D', '#29E0FF', '#B6F23A', '#FFB02E', '#FFF3B0', '#B28CFF'];

/** DOM confetti for popups. Client-only (random values), so render it after an interaction. */
export default function Confetti({ count = 44 }: { count?: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: Math.random() * 100,
        w: 7 + Math.random() * 8,
        c: COLORS[i % COLORS.length],
        d: Math.random() * 0.6,
        t: 1.7 + Math.random() * 1.5,
        r: `${Math.round(Math.random() * 720 - 360)}deg`,
      })),
    [count],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {items.map((it, i) => (
        <i key={i} style={{ '--x': `${it.x}%`, '--w': `${it.w}px`, '--c': it.c, '--d': `${it.d}s`, '--t': `${it.t}s`, '--r': it.r } as React.CSSProperties} />
      ))}
    </div>
  );
}
