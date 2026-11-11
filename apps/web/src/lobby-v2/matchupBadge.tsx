import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Map as MlMap } from 'maplibre-gl';
import { scenarioById } from '@asl/content';
import { Emblem } from '../fx/TurnChit';

/** The Axis nations; every other counter nationality is on the Allied side. */
const AXIS = new Set(['ge', 'it', 'jp', 'ax']);
/** Counter colour of each nationality (the --ge, --ru… tokens), the chit an emblem sits on. */
const CHIT: Record<string, string> = { ge: '#86acd0', ru: '#d0a24e', am: '#9cbb4e', br: '#d9c38a', al: '#8fb36a', it: '#aab4ba' };

/** A scenario's two sides as counter nationalities, Allied first, Axis second (the order the badge reads). */
export function matchupOf(scenarioId: string): string[] {
  const nations = [...new Set((scenarioById(scenarioId)?.sides ?? []).map((s) => s.nationality))];
  return nations.sort((a, b) => Number(AXIS.has(a)) - Number(AXIS.has(b)));
}

/** The map image id of a matchup's badge. */
export const badgeId = (nations: string[]) => `vs-${nations.join('-')}`;

const R = 15;
const W = 60;
const H = 34;

/** One nation's chit: its counter colour, its emblem, a brass rim. */
function Chit({ nation, cx }: { nation: string; cx: number }) {
  return (
    <g transform={`translate(${cx},${H / 2})`}>
      <circle r={R} fill={CHIT[nation] ?? '#b9b09a'} stroke="#f0cf72" strokeWidth="1.8" />
      <circle r={R - 2.6} fill="none" stroke="#10140f" strokeOpacity="0.35" strokeWidth="1" />
      <g transform="scale(0.5)">
        <Emblem side={nation} />
      </g>
    </g>
  );
}

/**
 * The matchup badge: the two sides' chits overlapping, Allied left and Axis right, with a "VS" seal where they
 * meet, so the atlas shows who fights whom at a glance. A one-nation scenario gets its single chit.
 */
function Badge({ nations }: { nations: string[] }) {
  const [a, b] = nations;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={W * 2} height={H * 2} viewBox={`0 0 ${W} ${H}`}>
      <ellipse cx={W / 2} cy={H / 2 + 2.5} rx={W / 2 - 2} ry={R} fill="#000" fillOpacity="0.45" />
      {b ? (
        <>
          <Chit nation={b} cx={W - R - 1.5} />
          <Chit nation={a!} cx={R + 1.5} />
          <g transform={`translate(${W / 2},${H / 2})`}>
            <path d="M0,-9.5 L9.5,0 L0,9.5 L-9.5,0 Z" fill="#10140f" stroke="#f0cf72" strokeWidth="1.4" />
            <text y="2.9" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="7.8" fill="#f0cf72">
              VS
            </text>
          </g>
        </>
      ) : (
        <Chit nation={a ?? '?'} cx={W / 2} />
      )}
    </svg>
  );
}

/** The badge as SVG markup (rendered once per matchup, off screen). */
function badgeSvg(nations: string[]): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(<Badge nations={nations} />));
  const svg = host.innerHTML;
  root.unmount();
  return svg;
}

/** Add the badge images the map does not have yet; resolves once they are all usable by a symbol layer. */
export async function addMatchupBadges(map: MlMap, matchups: string[][]): Promise<void> {
  const todo = new Map(matchups.map((n) => [badgeId(n), n]));
  await Promise.all(
    [...todo].map(async ([id, nations]) => {
      if (map.hasImage(id)) return;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg(nations))}`;
      await img.decode();
      if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
    }),
  );
}
