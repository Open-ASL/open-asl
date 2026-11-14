/** A pair of dice, drawn rather than typed: the ⚄ glyph is too small to spot at HUD size. */
export function DiceIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <rect x="2" y="7" width="12" height="12" rx="2.5" />
      <g transform="rotate(14 16 10)">
        <rect x="11" y="3" width="11" height="11" rx="2.5" />
      </g>
      <g fill="currentColor" stroke="none">
        <circle cx="5.2" cy="10.2" r="1.15" />
        <circle cx="8" cy="13" r="1.15" />
        <circle cx="10.8" cy="15.8" r="1.15" />
        <g transform="rotate(14 16 10)">
          <circle cx="14" cy="6" r="1.05" />
          <circle cx="19" cy="11" r="1.05" />
        </g>
      </g>
    </svg>
  );
}
