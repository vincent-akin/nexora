'use client';

import { useEffect, useState } from 'react';

/** Counts a number up with an ease-out. Jumps straight to the value if the user prefers reduced motion. */
export default function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(value); return; }
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{n.toLocaleString()}</>;
}
