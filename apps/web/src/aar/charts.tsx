import { useState, type PointerEvent, type ReactNode } from 'react';
import type { AarLuck, AarRace, AarStrength } from '@asl/platform';

/*
 * The report's charts, drawn to scale as inline SVG with the app's tokens: 2px lines, a 10%
 * wash under an area, 4px markers ringed in the surface colour, hairline grid, direct labels at
 * the line ends and a hover tooltip. Series are coloured by side through the `.side-xx` tokens.
 */

const W = 680;
const H = 250;

interface Tip {
  x: number;
  y: number;
  html: ReactNode;
}

/** A tooltip that follows the pointer over a chart's hit targets. */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const at = (e: PointerEvent, html: ReactNode) => setTip({ x: Math.min(e.clientX + 14, window.innerWidth - 250), y: e.clientY + 14, html });
  const bind = (html: ReactNode) => ({
    onPointerEnter: (e: PointerEvent) => at(e, html),
    onPointerMove: (e: PointerEvent) => at(e, html),
    onPointerLeave: () => setTip(null),
  });
  const node = tip ? <div className="aar-tip" style={{ left: tip.x, top: tip.y }}>{tip.html}</div> : null;
  return { bind, node };
}

const niceCeil = (v: number, step: number) => Math.max(step, Math.ceil(v / step) * step);

/** Squad-equivalents on the board per player turn, both sides, losses marked. */
export function StrengthChart({ data, sideName }: { data: AarStrength; sideName(side: string): string }) {
  const { bind, node } = useTip();
  const L = 34, R = 64, T = 14, B = 34;
  const n = data.labels.length;
  const sides = Object.keys(data.sides);
  const top = Math.max(1, ...sides.flatMap((s) => data.sides[s] ?? []));
  const ymax = niceCeil(top, 2);
  const step = ymax > 20 ? 5 : 2;
  const x = (i: number) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : 0);
  const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const grid: number[] = [];
  for (let g = 0; g <= ymax; g += step) grid.push(g);
  return (
    <div className="aar-chart-wrap">
      <svg className="aar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Squad equivalents on board per player turn, both sides">
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className={g === 0 ? 'axis' : 'grid'} />
            <text x={L - 6} y={y(g) + 4} textAnchor="end">{g}</text>
          </g>
        ))}
        {data.labels.map((lab, i) => (
          <text key={i} x={x(i)} y={H - B + 16} textAnchor="middle">{lab}</text>
        ))}
        <text x={L} y={H - 4}>player turn</text>
        {sides.map((s) => {
          const ys = data.sides[s] ?? [];
          const pts = ys.map((v, i) => `${x(i)},${y(v)}`);
          const last = ys[n - 1] ?? 0;
          return (
            <g key={s} className={`side-${s}`}>
              <path d={`M${x(0)},${y(0)} L${pts.join(' L')} L${x(n - 1)},${y(0)} Z`} fill="var(--side)" opacity={0.1} />
              <polyline points={pts.join(' ')} fill="none" stroke="var(--side)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {(data.losses[s] ?? []).map((i) => (
                <circle key={i} cx={x(i)} cy={y(ys[i] ?? 0)} r={4} fill="var(--side)" stroke="var(--panel)" strokeWidth={2} />
              ))}
              <text x={x(n - 1) + 10} y={y(last) + 4} className="lbl">{sideName(s)} {last}</text>
              {ys.map((v, i) => (
                <rect key={i} x={x(i) - 12} y={y(v) - 12} width={24} height={24} className="hit" {...bind(<><b>{data.labels[i]}</b><br />{sideName(s)}: {v} squad-equivalents</>)} />
              ))}
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}

const WAYS = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];

/** Share of each side's DRs by result, against the 2d6 curve. */
export function DiceChart({ hist, sideName }: { hist: Record<string, { hist: number[]; drs: number }>; sideName(side: string): string }) {
  const { bind, node } = useTip();
  const L = 34, R = 12, T = 14, B = 34;
  const sides = Object.keys(hist);
  const pct = (s: string, i: number) => { const d = hist[s]!; return d.drs ? ((d.hist[i] ?? 0) / d.drs) * 100 : 0; };
  const top = Math.max(20, ...sides.flatMap((s) => WAYS.map((_, i) => pct(s, i))));
  const ymax = niceCeil(top, 5);
  const slot = (W - L - R) / 11, bw = 12, gap = 2;
  const x = (i: number) => L + slot * i + slot / 2;
  const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const grid: number[] = [];
  for (let g = 0; g <= ymax; g += 5) grid.push(g);
  const groupW = sides.length * bw + (sides.length - 1) * gap;
  return (
    <div className="aar-chart-wrap">
      <svg className="aar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histogram of dice results 2 to 12 by side">
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className={g === 0 ? 'axis' : 'grid'} />
            <text x={L - 6} y={y(g) + 4} textAnchor="end">{g}%</text>
          </g>
        ))}
        {WAYS.map((_, i) => (
          <text key={i} x={x(i)} y={H - B + 16} textAnchor="middle" className="lbl">{i + 2}</text>
        ))}
        {WAYS.map((_, i) =>
          sides.map((s, k) => {
            const p = pct(s, i);
            const bx = x(i) - groupW / 2 + k * (bw + gap);
            const h = Math.max(0, y(0) - y(p));
            const d = h > 4 ? `M${bx},${y(0)} v${-(h - 4)} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 v${h - 4} z` : `M${bx},${y(0)} v${-h} h${bw} v${h} z`;
            return (
              <g key={`${s}${i}`} className={`side-${s}`}>
                <path d={d} fill="var(--side)" {...bind(<><b>{sideName(s)} · DR {i + 2}</b><br />{hist[s]!.hist[i] ?? 0} of {hist[s]!.drs} DRs ({p.toFixed(1)}%)<br />expected {((WAYS[i]! / 36) * 100).toFixed(1)}%</>)} />
              </g>
            );
          }),
        )}
        <polyline points={WAYS.map((w, i) => `${x(i)},${y((w / 36) * 100)}`).join(' ')} className="expected" strokeLinejoin="round" />
        {WAYS.map((w, i) => (
          <circle key={i} cx={x(i)} cy={y((w / 36) * 100)} r={2.5} fill="var(--line-hi)" />
        ))}
        <text x={W - R} y={H - 4} textAnchor="end">dice result</text>
      </svg>
      {node}
    </div>
  );
}

/** Running total of (7 − DR) per player turn; above zero is lucky. Original 2s and 12s are marked. */
export function LuckChart({ data, sideName }: { data: AarLuck; sideName(side: string): string }) {
  const { bind, node } = useTip();
  const L = 34, R = 92, T = 14, B = 34;
  const n = data.labels.length;
  const sides = Object.keys(data.sides);
  const all = sides.flatMap((s) => data.sides[s] ?? [0]);
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const span = Math.max(10, hi - lo);
  const step = span > 60 ? 20 : span > 30 ? 10 : 5;
  const ymin = Math.min(-step, Math.floor(lo / step) * step - (lo % step === 0 ? 0 : 0));
  const ymax = Math.max(step, Math.ceil(hi / step) * step);
  const x = (i: number) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : 0);
  const y = (v: number) => T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B);
  const grid: number[] = [];
  for (let g = ymin; g <= ymax; g += step) grid.push(g);
  return (
    <div className="aar-chart-wrap">
      <svg className="aar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative luck by player turn, both sides">
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className={g === 0 ? 'zero' : 'grid'} />
            <text x={L - 6} y={y(g) + 4} textAnchor="end">{g > 0 ? `+${g}` : g}</text>
          </g>
        ))}
        {data.labels.map((lab, i) => (
          <text key={i} x={x(i)} y={H - B + 16} textAnchor="middle">{lab}</text>
        ))}
        <text x={L + 4} y={T + 10}>lucky ↑</text>
        <text x={L + 4} y={H - B - 4}>unlucky ↓</text>
        {sides.map((s) => {
          const ys = data.sides[s] ?? [];
          const last = ys[n - 1] ?? 0;
          return (
            <g key={s} className={`side-${s}`}>
              <polyline points={ys.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="var(--side)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {(data.marks[s] ?? []).map((m, k) => (
                <circle key={k} cx={x(m.at)} cy={y(ys[m.at] ?? 0)} r={4.5} fill={m.v === 2 ? 'var(--green)' : 'var(--red-hi)'} stroke="var(--panel)" strokeWidth={2} {...bind(<><b>{sideName(s)} · {data.labels[m.at]}</b><br />original {m.v}</>)} />
              ))}
              <text x={x(n - 1) + 10} y={y(last) + 4} className="lbl">{sideName(s)} {last > 0 ? '+' : ''}{last}</text>
              {ys.map((v, i) => (
                <rect key={i} x={x(i) - 10} y={y(v) - 10} width={20} height={20} className="hit" {...bind(<><b>{data.labels[i]}</b><br />{sideName(s)}: {v > 0 ? '+' : ''}{v} pips vs average</>)} />
              ))}
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}

/** A race of two tallies per player turn (CVP inflicted, exit VP), with each side's goal line when printed. */
export function RaceChart({ data, sideName }: { data: AarRace; sideName(side: string): string }) {
  const { bind, node } = useTip();
  const L = 34, R = 92, T = 14, B = 34;
  const n = data.labels.length;
  const sides = Object.keys(data.sides);
  const top = Math.max(1, ...sides.flatMap((s) => data.sides[s] ?? []), ...Object.values(data.goal ?? {}));
  const step = top > 40 ? 10 : top > 16 ? 5 : 2;
  const ymax = niceCeil(top, step);
  const x = (i: number) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : 0);
  const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const grid: number[] = [];
  for (let g = 0; g <= ymax; g += step) grid.push(g);
  return (
    <div className="aar-chart-wrap">
      <svg className="aar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${data.label} per player turn, both sides`}>
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className={g === 0 ? 'axis' : 'grid'} />
            <text x={L - 6} y={y(g) + 4} textAnchor="end">{g}</text>
          </g>
        ))}
        {data.labels.map((lab, i) => (
          <text key={i} x={x(i)} y={H - B + 16} textAnchor="middle">{lab}</text>
        ))}
        {sides.map((s) => {
          const ys = data.sides[s] ?? [];
          const last = ys[n - 1] ?? 0;
          const goal = data.goal?.[s];
          return (
            <g key={s} className={`side-${s}`}>
              {goal !== undefined && (
                <>
                  <line x1={L} x2={W - R} y1={y(goal)} y2={y(goal)} stroke="var(--side)" strokeWidth={1} opacity={0.5} />
                  <text x={W - R + 10} y={y(goal) + 4} className="goal">{sideName(s)} needs {goal}</text>
                </>
              )}
              <polyline points={ys.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="var(--side)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(n - 1)} cy={y(last)} r={4} fill="var(--side)" stroke="var(--panel)" strokeWidth={2} />
              <text x={x(n - 1) + 10} y={y(last) + (goal !== undefined && Math.abs(y(goal) - y(last)) < 12 ? 16 : 4)} className="lbl">{sideName(s)} {last}</text>
              {ys.map((v, i) => (
                <rect key={i} x={x(i) - 10} y={y(v) - 10} width={20} height={20} className="hit" {...bind(<><b>{data.labels[i]}</b><br />{sideName(s)}: {v} {data.label.toLowerCase()}</>)} />
              ))}
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}
