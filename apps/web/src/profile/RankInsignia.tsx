import type { Rank } from '@asl/platform';

const GOLD = '#d9b451';
const SILVER = '#d8dcd4';

/** Chevrons and rockers for the enlisted; bars, leaves, eagles and stars for officers. Stylised, not to regulation. */
export function RankInsignia({ rank, size = 56 }: { rank: Rank; size?: number }) {
  return (
    <svg className="insignia" width={size} height={size} viewBox="0 0 64 64" aria-label={rank.title} role="img">
      <circle cx="32" cy="32" r="30" fill="#1b201b" stroke="#55624a" strokeWidth="2" />
      {glyph(rank.id)}
    </svg>
  );
}

/** Chevrons stacked from the top, rockers curving below; the whole group is then centred on the badge. */
function chevrons(n: number, rockers: number) {
  const out = [];
  const CHEVRON = 7;
  const ROCKER = 6;
  for (let i = 0; i < n; i++) {
    const y = 26 + i * CHEVRON;
    out.push(<path key={`c${i}`} d={`M14 ${y + 8} L32 ${y - 4} L50 ${y + 8}`} fill="none" stroke={GOLD} strokeWidth="4" strokeLinejoin="round" />);
  }
  const rockerTop = 26 + (n - 1) * CHEVRON + 18;
  for (let i = 0; i < rockers; i++) {
    const y = rockerTop + i * ROCKER;
    out.push(<path key={`r${i}`} d={`M16 ${y} Q32 ${y + 10} 48 ${y}`} fill="none" stroke={GOLD} strokeWidth="4" strokeLinecap="round" />);
  }
  // Extents including stroke: the first chevron's point, and the last chevron's arms or the last rocker's curve.
  const top = 26 - 4 - 2;
  const bottom = rockers ? rockerTop + (rockers - 1) * ROCKER + 7 : 26 + (n - 1) * CHEVRON + 8 + 2;
  // Tall stacks are scaled down so every badge keeps a margin inside the 60px ring.
  const height = bottom - top;
  const k = Math.min(1, 46 / height);
  return <g transform={`translate(32 32) scale(${k.toFixed(3)}) translate(-32 ${(-(top + bottom) / 2).toFixed(1)})`}>{out}</g>;
}

const bar = (x: number, colour: string) => <rect key={x} x={x} y="18" width="10" height="28" rx="1.5" fill={colour} stroke="#000" strokeOpacity="0.4" />;

const leaf = (colour: string) => (
  <g fill={colour} stroke="#000" strokeOpacity="0.35">
    <path d="M32 12 C44 20 48 34 32 52 C16 34 20 20 32 12 Z" />
    <path d="M32 18 L32 48" stroke={colour === GOLD ? '#8a6d1f' : '#777'} strokeWidth="1.5" />
  </g>
);

const star = (cx: number, cy: number, r = 8) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`);
  }
  return <polygon key={`${cx},${cy}`} points={pts.join(' ')} fill={SILVER} stroke="#000" strokeOpacity="0.35" />;
};

function stars(n: number) {
  const gap = n > 3 ? 11 : 14;
  const x0 = 32 - ((n - 1) * gap) / 2;
  return <g>{Array.from({ length: n }, (_, i) => star(x0 + i * gap, 32, n > 3 ? 6.5 : 8))}</g>;
}

function glyph(id: string) {
  switch (id) {
    case 'pvt':
      return <circle cx="32" cy="32" r="4" fill={GOLD} />;
    case 'pfc':
      return chevrons(1, 0);
    case 'cpl':
      return chevrons(2, 0);
    case 'sgt':
      return chevrons(3, 0);
    case 'ssg':
      return chevrons(3, 1);
    case 'tsg':
      return chevrons(3, 2);
    case 'msg':
      return chevrons(3, 3);
    case '2lt':
      return bar(27, GOLD);
    case '1lt':
      return bar(27, SILVER);
    case 'cpt':
      return (
        <g>
          {bar(19, SILVER)}
          {bar(35, SILVER)}
        </g>
      );
    case 'maj':
      return leaf(GOLD);
    case 'ltc':
      return leaf(SILVER);
    case 'col':
      return (
        <g fill={SILVER} stroke="#000" strokeOpacity="0.35">
          <path d="M8 30 C18 22 26 26 32 30 C38 26 46 22 56 30 C48 32 42 34 36 36 L36 44 L28 44 L28 36 C22 34 16 32 8 30 Z" />
          <circle cx="32" cy="26" r="3.5" />
        </g>
      );
    case 'bg':
      return stars(1);
    case 'mg':
      return stars(2);
    case 'ltg':
      return stars(3);
    case 'gen':
      return stars(4);
    case 'ga':
      return (
        <g>
          {star(32, 19, 7)}
          {star(20, 28, 7)}
          {star(44, 28, 7)}
          {star(24, 42, 7)}
          {star(40, 42, 7)}
        </g>
      );
    default:
      return null;
  }
}
