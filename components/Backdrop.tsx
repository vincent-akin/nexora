/** Fixed, CSS-only floating notes and stars behind every page. Deterministic, so no hydration mismatch. */
const ITEMS = [
  ['\u266A', 6, 34, '#FF4D9D', 19, 0], ['\u2605', 17, 22, '#FFB02E', 24, 4], ['\u266B', 29, 40, '#29E0FF', 21, 8],
  ['\u25CF', 41, 14, '#B6F23A', 26, 2], ['\u266A', 52, 30, '#FFF3B0', 18, 11], ['\u2605', 63, 26, '#FF4D9D', 23, 6],
  ['\u266B', 74, 42, '#B6F23A', 20, 1], ['\u25CF', 84, 16, '#29E0FF', 27, 9], ['\u266A', 92, 32, '#FFB02E', 22, 5],
  ['\u2605', 11, 18, '#29E0FF', 28, 13], ['\u266B', 47, 36, '#FF4D9D', 25, 15], ['\u25CF', 69, 12, '#FFF3B0', 29, 10],
] as const;

export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      {ITEMS.map(([ch, x, s, c, t, d], i) => (
        <span key={i} style={{ '--x': `${x}%`, '--s': `${s}px`, '--c': c, '--t': `${t}s`, '--d': `-${d}s` } as React.CSSProperties}>{ch}</span>
      ))}
    </div>
  );
}
