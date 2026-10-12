/** The Nexora mark: a rounded square with a clean N. */
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="nx-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8F7CFF" />
          <stop offset="1" stopColor="#5B4BE6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#nx-logo)" />
      <path d="M10 23V9l12 14V9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
