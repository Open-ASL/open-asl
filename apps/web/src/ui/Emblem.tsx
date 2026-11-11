/** Stencilled hex emblem for the masthead. */
export function Emblem({ size = 88 }: { size?: number }) {
  const h = Math.round((size * 96) / 88);
  return (
    <svg className="hex-logo" width={size} height={h} viewBox="0 0 88 96" aria-hidden>
      <defs>
        <linearGradient id="em" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0cf72" />
          <stop offset="1" stopColor="#a8842e" />
        </linearGradient>
      </defs>
      <path d="M44 3 82 25v46L44 93 6 71V25z" fill="#15190f" stroke="url(#em)" strokeWidth="4" />
      <path d="M44 14 72 30v36L44 82 16 66V30z" fill="none" stroke="#3e4634" strokeWidth="1.5" />
      <text x="44" y="56.5" textAnchor="middle" fontFamily="'Black Ops One', Impact, sans-serif" fontSize="24" letterSpacing="-1" fill="url(#em)">
        OASL
      </text>
    </svg>
  );
}
