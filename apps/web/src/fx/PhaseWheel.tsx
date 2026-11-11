import { useEffect, useRef, useState } from 'react';
import type { SideId } from '@asl/engine';
import { playSfx } from '../audio/engine';
import { PHASE_NAME } from '../game/describe';
import { WHEEL_TIMING, type FxLevel } from './settings';
import type { WheelCue } from './useGameFx';
import { ChitFace } from './TurnChit';

interface Props {
  cue: WheelCue;
  phases: readonly string[];
  sideName(s: SideId): string;
  level: FxLevel;
  onDone(): void;
}

/** A click this soon after the wheel appears does not skip it: the player was still clicking on the board. */
const SKIP_GRACE_MS = 600;
const SIZE = 320;
const C = SIZE / 2;
const R = 150;
const RI = 80;
/** Line spacing of a two-line facet label. */
const LINE = 13;
const SHORT: Record<string, string> = { RPh: 'RALLY', PFPh: 'PREP FIRE', MPh: 'MOVE', DFPh: 'DEF. FIRE', AFPh: 'ADV. FIRE', RtPh: 'ROUT', APh: 'ADVANCE', CCPh: 'CLOSE COMBAT' };

/**
 * Accumulated rotation (in sectors) and the last phase shown, kept across mounts so the wheel
 * always slides in showing the previous phase and turns forward to the new one.
 */
const ring = { steps: 0, prev: -1, cue: -1 };
export const resetWheel = () => Object.assign(ring, { steps: 0, prev: -1, cue: -1 });

const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};

/**
 * One facet of the ring, centred on `deg` (clockwise from 12 o'clock), `span` degrees wide.
 * The ring is a polygon with one flat side per phase (an octagon for the eight ASL phases),
 * so each facet is a trapezoid between the outer and inner polygons.
 */
function sectorPath(deg: number, span: number): string {
  const a0 = deg - span / 2;
  const a1 = deg + span / 2;
  const o0 = pt(a0, R);
  const o1 = pt(a1, R);
  const i0 = pt(a0, RI);
  const i1 = pt(a1, RI);
  return `M${o0.x},${o0.y} L${o1.x},${o1.y} L${i1.x},${i1.y} L${i0.x},${i0.y} Z`;
}

/** Polygon with one corner per phase boundary, radius `r` (a flat side sits under the pointer). */
const polygonPoints = (n: number, r: number) =>
  Array.from({ length: n }, (_, i) => pt(-i * (360 / n) - 180 / n, r))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

/**
 * The phase wheel: slides in, turns so the new phase sits under the pointer, announces whose
 * turn it is, and slides out. The ring keeps turning the same way game after game, so the
 * rotation accumulates across cues.
 */
export function PhaseWheel({ cue, phases, sideName, level, onDone }: Props) {
  const n = phases.length;
  const span = 360 / n;
  const idx = phases.indexOf(cue.phase);
  const [angle, setAngle] = useState(() => ring.steps * span);
  const [stage, setStage] = useState<'in' | 'turn' | 'out'>('in');
  // The turn marker chit on the hub shows whose turn it is. When the active side changes the
  // chit comes in still showing the old side, then flips over to the other nation's face.
  const flipFrom = cue.flipFrom ?? null;
  const [flipped, setFlipped] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  /** When this cue came on screen: a click that lands in the first moments was meant for the board. */
  const shownAt = useRef(0);

  useEffect(() => {
    const t = WHEEL_TIMING[level];
    if (idx >= 0 && ring.cue !== cue.id) {
      const from = ring.prev;
      ring.steps += from < 0 ? idx : ((idx - from + n) % n) || n;
      ring.prev = idx;
    }
    ring.cue = cue.id;
    shownAt.current = performance.now();
    setStage('in');
    setFlipped(false);
    const timers = [
      setTimeout(() => {
        setAngle(ring.steps * span);
        setStage('turn');
        playSfx(cue.kind === 'phase' ? 'phase.turn' : cue.kind === 'setup' ? 'phase.setup' : 'phase.playerTurn');
      }, t.enter),
      ...(flipFrom
        ? [
            setTimeout(() => {
              setFlipped(true);
              playSfx('ui.flip');
            }, t.enter + t.flip),
          ]
        : []),
      setTimeout(() => setStage('out'), t.enter + (cue.kind === 'phase' ? t.hold : t.holdTurn)),
      setTimeout(() => done.current(), t.enter + (cue.kind === 'phase' ? t.hold : t.holdTurn) + t.exit),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue.id]);

  const skip = () => {
    if (stage === 'out' || performance.now() - shownAt.current < SKIP_GRACE_MS) return;
    setStage('out');
    setTimeout(() => done.current(), WHEEL_TIMING[level].exit);
  };

  const phaseName = (PHASE_NAME[cue.phase] ?? cue.phase).replace(/ Phase$/, '');
  const total = n;
  const scenarioSetup = cue.kind === 'setup' && !cue.reinforcements;
  const chitLabel = scenarioSetup ? 'SET UP' : 'TURN';
  const chitTurn = scenarioSetup ? undefined : cue.turn;
  return (
    <div className={`pw-overlay ${stage} side-${cue.side}`} onClick={skip}>
      <div className="pw-stage">
        <div className="pw-wheel-wrap">
          <svg className="pw-wheel" viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <defs>
              <radialGradient id="pw-shade" cx="50%" cy="50%" r="50%">
                <stop offset="60%" stopColor="#000" stopOpacity="0" />
                <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
              </radialGradient>
            </defs>
            <polygon points={polygonPoints(n, R + 6)} fill="#0b0d0b" stroke="#4a5443" strokeWidth="2" strokeLinejoin="round" />
            {/* The turning ring is clipped to the plate: mid-turn its facets' corners (and the glow
                of the current one) would otherwise sweep out past the octagon's edge. */}
            <clipPath id="pw-plate">
              <polygon points={polygonPoints(n, R + 5)} />
            </clipPath>
            <g clipPath="url(#pw-plate)">
              <g className="pw-ring" style={{ transform: `rotate(${angle}deg)` }}>
                {phases.map((ph, i) => {
                  const deg = -i * span;
                  const isNow = i === idx;
                  const isDone = idx >= 0 && i < idx;
                  const def = ph === 'DFPh';
                  // Halfway across the facet, measured along its centre line (the polygons' flats sit
                  // closer in than their corners), which keeps a two-line label clear of the pointer.
                  const label = pt(deg, ((R + RI) / 2) * Math.cos((span * Math.PI) / 360) + 1);
                  // A word to a line: labels stay upright, so on the side facets one runs across the
                  // ring's depth, too shallow for two words side by side.
                  const lines = (SHORT[ph] ?? ph).split(' ');
                  return (
                    <g key={ph} className={def ? `side-${cue.defender}` : undefined}>
                      <path className={`pw-sector ${isNow ? 'now' : isDone ? 'done' : ''} ${def ? 'def' : ''}`} d={sectorPath(deg, span)} />
                      {/* Labels counter-rotate with the ring so they always read upright. */}
                      <g className="pw-label-g" style={{ transform: `rotate(${-angle}deg)`, transformOrigin: `${label.x}px ${label.y}px` }}>
                        <text className={`pw-label ${isNow ? 'now' : isDone ? 'done' : ''}`} x={label.x} y={label.y + 4.5 - ((lines.length - 1) * LINE) / 2} style={{ fontSize: 12.5 }}>
                          {lines.map((w, j) => (
                            <tspan key={j} x={label.x} dy={j ? LINE : 0}>
                              {w}
                            </tspan>
                          ))}
                        </text>
                      </g>
                    </g>
                  );
                })}
                {phases.map((_, i) => {
                  const a = pt(-i * span - span / 2, R);
                  const b = pt(-i * span - span / 2, RI);
                  return <line key={i} className="pw-tick" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
                })}
              </g>
            </g>
            <polygon points={polygonPoints(n, R + 2)} fill="url(#pw-shade)" pointerEvents="none" />
            <circle className="pw-hub" cx={C} cy={C} r={RI - 8} />
            <polygon className="pw-pointer" points={`${C},${4} ${C - 14},${30} ${C + 14},${30}`} />
          </svg>
          <div className="pw-chit" aria-hidden="true">
            <div className={`pw-chit-card ${flipped ? 'flipped' : ''}`}>
              <div className="pw-chit-face front">
                <ChitFace side={flipFrom ?? cue.side} label={chitLabel} turn={chitTurn} />
              </div>
              {flipFrom && (
                <div className="pw-chit-face back">
                  <ChitFace side={cue.side} label={chitLabel} turn={chitTurn} />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="pw-banner">
          {cue.kind === 'playerTurn' && cue.endedSide && (
            <div className="ended side-ended" style={{ ['--ended-side' as string]: `var(--${cue.endedSide})` }}>
              <span className="sw" />
              <s>{sideName(cue.endedSide)} player turn</s> complete
            </div>
          )}
          <div className="kicker">
            {cue.kind === 'setup' ? (cue.reinforcements ? `Turn ${cue.turn} · Reinforcements` : 'Deployment') : cue.kind === 'playerTurn' ? `Turn ${cue.turn}` : `Turn ${cue.turn} · phase ${idx + 1} of ${total}`}
          </div>
          <div className="who">{sideName(cue.side)}</div>
          <div className="what">{cue.kind === 'setup' ? (cue.reinforcements ? 'Set up your reinforcements' : 'Set up your forces') : cue.kind === 'playerTurn' ? 'Player turn' : phaseName}</div>
          <div className="rule" />
          {cue.kind === 'playerTurn' && <div className="sub">Begins with the {phaseName}</div>}
          {cue.kind === 'phase' && cue.phase === 'DFPh' && <div className="sub">{sideName(cue.defender)} fire</div>}
        </div>
      </div>
      <div className="pw-skip">click to continue</div>
    </div>
  );
}
