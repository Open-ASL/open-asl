import type { SideId } from '@asl/engine';

/** Counter stock colours of the SK1 and SK2 nationalities (sampled from the counter art). */
const STOCK: Record<string, string> = { am: '#ebf0b3', ge: '#d3ebfb', ru: '#eed1a3', br: '#e5cea0', al: '#bfe3c4', it: '#d2d6d8' };

/** National emblem drawn centred on the origin, roughly 40 units across. */
export function Emblem({ side }: { side: SideId }) {
  switch (side) {
    case 'ge':
      // Balkenkreuz: a black cross edged in white.
      return (
        <g>
          <path d="M-6,-20 H6 V-6 H20 V6 H6 V20 H-6 V6 H-20 V-6 H-6 Z" fill="#fff" stroke="#fff" strokeWidth="5" strokeLinejoin="miter" />
          <path d="M-6,-20 H6 V-6 H20 V6 H6 V20 H-6 V6 H-20 V-6 H-6 Z" fill="#111" />
        </g>
      );
    case 'am':
      return <path d={star(21)} fill="#fff" stroke="#111" strokeWidth="2" strokeLinejoin="round" />;
    case 'ru':
      return <path d={star(21)} fill="#d22d26" stroke="#111" strokeWidth="1.5" strokeLinejoin="round" />;
    case 'br':
      // RAF-style roundel, as on the British counters' scenario cards.
      return (
        <g>
          <circle r="21" fill="#2a4b9b" stroke="#111" strokeWidth="1.5" />
          <circle r="14" fill="#fff" />
          <circle r="7" fill="#d22d26" />
        </g>
      );
    case 'it':
      // Three fasces, the Italian mark on the scenario cards.
      return (
        <g fill="#4a3a48" stroke="#111" strokeWidth="1">
          {[-12, 0, 12].map((x) => (
            <g key={x}>
              <rect x={x - 2.5} y="-20" width="5" height="40" />
              <path d={`M${x + 2.5},4 l6,-4 l-1,9 l-5,1 Z`} />
            </g>
          ))}
        </g>
      );
    case 'ja':
      // The red disc of the Japanese scenario cards.
      return <circle r="19" fill="#c8102e" stroke="#111" strokeWidth="1.5" />;
    default:
      return (
        <text y="8" textAnchor="middle" fontFamily="var(--font-display)" fontSize="26" fill="#111">
          {side.toUpperCase()}
        </text>
      );
  }
}

function star(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const rr = i % 2 === 0 ? r : r * 0.42;
    pts.push(`${(Math.cos(a) * rr).toFixed(2)},${(Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

interface FaceProps {
  side: SideId;
  label: string;
  turn?: number;
}

/**
 * One face of the turn marker: a cardboard counter in the nationality's stock colour with its
 * emblem and the turn number, as the chit players park in the middle of the phase track.
 */
export function ChitFace({ side, label, turn }: FaceProps) {
  const stock = STOCK[side] ?? '#e5e2d0';
  return (
    <svg className={`pw-chit-face-svg side-${side}`} viewBox="0 0 100 100">
      <defs>
        <linearGradient id={`chit-sheen-${side}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="96" height="96" rx="7" fill={stock} stroke="#1a1a14" strokeWidth="2" />
      <rect x="2" y="2" width="96" height="96" rx="7" fill={`url(#chit-sheen-${side})`} />
      <g transform="translate(50 39)">
        <Emblem side={side} />
      </g>
      <text className="pw-chit-lbl" x="50" y={turn === undefined ? 84 : 74}>
        {label}
      </text>
      {turn !== undefined && (
        <text className="pw-chit-turn" x="50" y="94">
          {turn}
        </text>
      )}
    </svg>
  );
}
