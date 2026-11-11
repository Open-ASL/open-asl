import { weatherLabel, type Sky, type Weather } from '@asl/rules';

interface Props {
  weather: Weather;
  /** Where the wind blows to, in screen degrees clockwise from up (see `windScreenAngle`). */
  windAngle: number;
}

/** Small line icons, one per sky condition, drawn in the HUD's brass. */
function SkyIcon({ sky }: { sky: Sky }) {
  const cloud = <path d="M7 15.5h8.5a3 3 0 0 0 .4-6 4.5 4.5 0 0 0-8.6-1.2A3.6 3.6 0 0 0 7 15.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />;
  switch (sky) {
    case 'clear':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" fill="currentColor" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="10" y1="2.2" x2="10" y2="4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${a} 10 10)`} />
          ))}
        </svg>
      );
    case 'overcast':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          {cloud}
        </svg>
      );
    case 'rain':
      return (
        <svg viewBox="0 0 20 22" width="18" height="20" aria-hidden="true">
          <g transform="translate(0 -2)">{cloud}</g>
          {[6.5, 10, 13.5].map((x) => (
            <line key={x} x1={x} y1="16" x2={x - 1.2} y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          ))}
        </svg>
      );
    case 'fallingSnow':
      return (
        <svg viewBox="0 0 20 22" width="18" height="20" aria-hidden="true">
          <g transform="translate(0 -2)">{cloud}</g>
          {[6, 10, 14].map((x, i) => (
            <circle key={x} cx={x} cy={i === 1 ? 20 : 17.5} r="1.1" fill="currentColor" />
          ))}
        </svg>
      );
    case 'fog':
    case 'mist':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          {[5, 8.5, 12, 15.5].map((y, i) => (
            <line key={y} x1={i % 2 ? 5 : 3} y1={y} x2={i % 2 ? 17 : 15} y2={y} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity={sky === 'mist' ? 0.7 : 1} />
          ))}
        </svg>
      );
  }
}

/** The weather in play: the sky's icon, the ground when it matters, and an arrow the wind blows along. */
export function WeatherChip({ weather, windAngle }: Props) {
  const label = weatherLabel(weather);
  const calm = weather.wind.force === 'calm';
  return (
    <div className={`weather-chip sky-${weather.sky}`} title={`Weather: ${label}`} aria-label={`Weather: ${label}`}>
      <span className="lbl muted small">WX</span>
      <span className="sky">
        <SkyIcon sky={weather.sky} />
      </span>
      {weather.ground !== 'normal' && <span className={`ground ground-${weather.ground}`}>{weather.ground}</span>}
      <span className={`wind ${calm ? 'calm' : `force-${weather.wind.force}`}`} style={{ transform: `rotate(${windAngle}deg)` }}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          {calm ? (
            <circle cx="10" cy="10" r="2.2" fill="currentColor" opacity="0.5" />
          ) : (
            <>
              <line x1="10" y1="17" x2="10" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <polyline points="5.5,9.5 10,4 14.5,9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
        </svg>
      </span>
    </div>
  );
}
