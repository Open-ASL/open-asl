import type { ScenarioDef, Weather, WindFrom } from '@asl/rules';

/** Card-compass directions as clockwise degrees from the card's north. */
const DIR_ANGLE: Record<WindFrom, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

/**
 * Where the card's north points on screen, as a clockwise angle in screen degrees (0 = up) for
 * the current view. The card's directions are turned to the board's through the scenario compass
 * (card north may be board east), and the board's to the screen's by the view rotation. The
 * compass rose turns by this number; it is 0 at the default view.
 */
export function northScreenAngle(scenario: ScenarioDef, rotation: number): number {
  const cardToBoard = { N: 0, E: 90, S: 180, W: 270 }[scenario.compass?.N ?? 'N'];
  return (((cardToBoard + rotation) % 360) + 360) % 360;
}

/**
 * Where the wind blows to, as a clockwise angle in screen degrees (0 = up) for the current
 * view: the card direction it blows towards, turned with the card's north.
 */
export function windScreenAngle(scenario: ScenarioDef, weather: Weather, rotation: number): number {
  const to = DIR_ANGLE[weather.wind.from] + 180;
  return (to + northScreenAngle(scenario, rotation)) % 360;
}

/** The visual effect the map draws for a sky: falling particles, a wash, or nothing. */
export type WeatherFxKind = 'snow' | 'rain' | 'fog' | 'mist' | null;

export function weatherFxKind(weather: Weather): WeatherFxKind {
  switch (weather.sky) {
    case 'fallingSnow':
      return 'snow';
    case 'rain':
      return 'rain';
    case 'fog':
      return 'fog';
    case 'mist':
      return 'mist';
    default:
      return null;
  }
}
