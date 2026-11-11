import { northWords } from './Hud';

interface Props {
  /** Where the card's north points on screen, in degrees clockwise from up (see `northScreenAngle`). */
  north: number;
  /** Turn the map a quarter turn: +1 clockwise, -1 counterclockwise. */
  onRotate(dir: 1 | -1): void;
}

const POINTS = [
  { letter: 'N', angle: 0 },
  { letter: 'E', angle: 90 },
  { letter: 'S', angle: 180 },
  { letter: 'W', angle: 270 },
] as const;

/**
 * The compass rose in the corner of the map: the card's cardinal directions, lettered, turned
 * with the view so that "the east edge" on the card can be found on the screen at a glance.
 * North is the long brass point. The letters stay upright whichever way the map is turned.
 * Clicking it turns the map a quarter turn clockwise (shift-click: counterclockwise).
 */
export function CompassRose({ north, onRotate }: Props) {
  return (
    <button
      type="button"
      className="compass-rose"
      onClick={(e) => onRotate(e.shiftKey ? -1 : 1)}
      title={`${northWords(north)} · click to turn the map (shift-click the other way)`}
      aria-label={`Compass: ${northWords(north)}. Turn the map clockwise`}
    >
      <svg viewBox="0 0 100 100" width="84" height="84" aria-hidden="true">
        <circle cx="50" cy="50" r="47" className="rose-dial" />
        <circle cx="50" cy="50" r="40" className="rose-ring" />
        <g className="rose-turn" style={{ transform: `rotate(${north}deg)` }}>
          {/* ordinal (short) points, then the cardinal star; north's point is long and bright */}
          {[45, 135, 225, 315].map((a) => (
            <polygon key={a} points="50,50 50,32 54,46 50,50 46,46" className="rose-ordinal" transform={`rotate(${a} 50 50)`} />
          ))}
          {[90, 180, 270].map((a) => (
            <g key={a} transform={`rotate(${a} 50 50)`}>
              <polygon points="50,24 55,50 50,50" className="rose-point lit" />
              <polygon points="50,24 45,50 50,50" className="rose-point" />
            </g>
          ))}
          <polygon points="50,14 56,50 50,50" className="rose-north lit" />
          <polygon points="50,14 44,50 50,50" className="rose-north" />
          <circle cx="50" cy="50" r="2.4" className="rose-hub" />
          {POINTS.map(({ letter, angle }) => {
            // The letter sits on the dial past the point's tip; it is turned back upright.
            const r = 33;
            const rad = ((angle - 90) * Math.PI) / 180;
            const x = 50 + r * Math.cos(rad);
            const y = 50 + r * Math.sin(rad);
            return (
              <text key={letter} x={x} y={y} className={`rose-letter ${letter === 'N' ? 'north' : ''}`} style={{ transform: `rotate(${-north}deg)`, transformOrigin: `${x}px ${y}px` }}>
                {letter}
              </text>
            );
          })}
        </g>
      </svg>
    </button>
  );
}
