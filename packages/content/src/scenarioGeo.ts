import { scenarioRuleset, type ScenarioDef, type ScenarioRuleset } from '@asl/rules';
import { COUNTERS } from './counters';
import { ALL_SCENARIOS, isPlayable, scenarioName, scenarioNumber } from './catalog';
import { productById } from './products';

export type TheaterId = 'eto' | 'pto' | 'dto' | 'korea';

export interface ScenarioCatalogEntry {
  id: string;
  rulesetId: ScenarioRuleset;
  theater: TheaterId;
  theaterName: string;
  region: string;
  area: string;
  latitude: number;
  longitude: number;
  dateISO: string | null;
  year: number | null;
  month: number;
  number: string;
  name: string;
  title: string;
  place: string;
  product: string;
  productName: string;
  designer: string;
  playable: boolean;
  turns: number;
  halfFinalTurn: boolean;
  nations: string[];
  vehicles: string[];
  guns: string[];
  unitClasses: string[];
  unitCount: number;
  searchText: string;
}

interface PlaceGeo {
  match: string;
  region: string;
  area: string;
  latitude: number;
  longitude: number;
  /** The atlas theater the pin belongs to; the European Theater unless said otherwise. */
  theater?: TheaterId;
}

const THEATER_NAMES: Record<TheaterId, string> = {
  eto: 'European Theater of Operations',
  pto: 'Pacific Theater of Operations',
  dto: 'Desert Theater of Operations',
  korea: 'Korean War',
};

/**
 * Reviewed scenario-card datelines. These are deliberately separate from engine definitions:
 * geography is catalogue presentation data and must not change a recording's ruleset hash.
 */
const ETO_PLACES: PlaceGeo[] = [
  { match: 'Vierville', region: 'Western Europe', area: 'Normandy', latitude: 49.358, longitude: -1.247 },
  { match: 'Chef-du-Pont', region: 'Western Europe', area: 'Normandy', latitude: 49.384, longitude: -1.343 },
  { match: 'Carentan', region: 'Western Europe', area: 'Normandy', latitude: 49.303, longitude: -1.248 },
  { match: 'Amfréville', region: 'Western Europe', area: 'Normandy', latitude: 49.411, longitude: -1.388 },
  { match: 'Putot', region: 'Western Europe', area: 'Normandy', latitude: 49.212, longitude: -0.547 },
  { match: 'Colleville', region: 'Western Europe', area: 'Normandy', latitude: 49.347, longitude: -0.843 },
  { match: 'Plouzane', region: 'Western Europe', area: 'Brittany', latitude: 48.383, longitude: -4.616 },
  { match: 'Pointe de Corsen', region: 'Western Europe', area: 'Brittany', latitude: 48.414, longitude: -4.796 },
  { match: 'Le Muy', region: 'Western Europe', area: 'Provence', latitude: 43.473, longitude: 6.566 },
  { match: 'Baerendorf', region: 'Western Europe', area: 'Alsace', latitude: 48.832, longitude: 7.088 },
  { match: 'Aachen', region: 'Western Europe', area: 'Rhineland', latitude: 50.776, longitude: 6.083 },
  { match: 'Bleialf', region: 'Western Europe', area: 'Eifel', latitude: 50.239, longitude: 6.286 },
  { match: 'Baruth', region: 'Western Europe', area: 'Brandenburg', latitude: 52.052, longitude: 13.503 },
  { match: 'Apweiler', region: 'Western Europe', area: 'Rhineland', latitude: 50.96, longitude: 6.1 },
  { match: 'Foy, Belgium', region: 'Western Europe', area: 'Ardennes', latitude: 50.031, longitude: 5.734 },
  { match: 'Hosingen', region: 'Western Europe', area: 'Ardennes', latitude: 50.012, longitude: 6.091 },
  { match: 'Skyline Drive', region: 'Western Europe', area: 'Luxembourg', latitude: 49.99, longitude: 6.1 },
  { match: 'Oosterbeek', region: 'Western Europe', area: 'The Netherlands', latitude: 51.986, longitude: 5.845 },
  { match: 'Zon, Holland', region: 'Western Europe', area: 'The Netherlands', latitude: 51.511, longitude: 5.494 },
  { match: 'Scherpenzeel', region: 'Western Europe', area: 'The Netherlands', latitude: 52.08, longitude: 5.489 },
  { match: 'Nuenen', region: 'Western Europe', area: 'The Netherlands', latitude: 51.47, longitude: 5.552 },
  { match: 'Stalingrad', region: 'Eastern Front', area: 'Stalingrad', latitude: 48.708, longitude: 44.514 },
  { match: 'Red Barricades', region: 'Eastern Front', area: 'Stalingrad', latitude: 48.78, longitude: 44.55 },
  { match: 'Istra', region: 'Eastern Front', area: 'Moscow', latitude: 55.914, longitude: 36.86 },
  { match: 'Borisovka', region: 'Eastern Front', area: 'Belgorod', latitude: 50.601, longitude: 36.016 },
  { match: 'Krupki', region: 'Eastern Front', area: 'Byelorussia', latitude: 54.317, longitude: 29.137 },
  { match: 'North of Kaunas', region: 'Eastern Front', area: 'Lithuania', latitude: 55.15, longitude: 23.9 },
  { match: 'Vyazivok', region: 'Eastern Front', area: 'Ukraine', latitude: 49.1, longitude: 32.6 },
  { match: 'Slobodka', region: 'Eastern Front', area: 'Russia', latitude: 54.65, longitude: 32.05 },
  { match: 'Puspokladany', region: 'Eastern Front', area: 'Hungary', latitude: 47.318, longitude: 21.116 },
  { match: 'Avola', region: 'Mediterranean', area: 'Sicily', latitude: 36.909, longitude: 15.135 },
  { match: 'Biscari Station', region: 'Mediterranean', area: 'Sicily', latitude: 37.156, longitude: 14.445 },
  { match: 'Station San Oliva', region: 'Mediterranean', area: 'Sicily', latitude: 37.15, longitude: 14.5 },
  { match: 'Niscemi', region: 'Mediterranean', area: 'Sicily', latitude: 37.146, longitude: 14.386 },
  { match: 'Porto Ferraio', region: 'Mediterranean', area: 'Elba', latitude: 42.813, longitude: 10.316 },
  { match: 'Radicofani', region: 'Mediterranean', area: 'Italy', latitude: 42.897, longitude: 11.768 },
  { match: 'Ile d’Elbe', region: 'Mediterranean', area: 'Elba', latitude: 42.78, longitude: 10.28 },
  { match: 'Sarandoporo', region: 'Mediterranean', area: 'Greece', latitude: 40.05, longitude: 22.05 },
  { match: 'Korinthos', region: 'Mediterranean', area: 'Greece', latitude: 37.94, longitude: 22.932 },
  { match: 'Galatas', region: 'Mediterranean', area: 'Crete', latitude: 35.499, longitude: 23.963 },
  { match: 'Marciana Marina', region: 'Mediterranean', area: 'Elba', latitude: 42.806, longitude: 10.198 },
  /** Open ASL's own demo scenarios (board y, no real battle): pinned together in the Normandy bocage. */
  { match: 'Training ground, Normandy', region: 'Western Europe', area: 'Normandy', latitude: 49.07, longitude: -1.12 },
  /** The Full ASL test bed (board u, no real battle). */
  { match: 'Training ground, Eastern Front', region: 'Eastern Front', area: 'Russia', latitude: 54.2, longitude: 33.0 },
  /** S64: Edson's Ridge, south of Henderson Field. */
  { match: 'Henderson Field, Guadalcanal', region: 'Pacific', area: 'Solomon Islands', latitude: -9.457, longitude: 160.049, theater: 'pto' },
  /** S65: the Raiders' lines west of Lunga Ridge (Edson's Ridge). */
  { match: 'Lunga Ridge, Guadalcanal', region: 'Pacific', area: 'Solomon Islands', latitude: -9.46, longitude: 160.04, theater: 'pto' },
  /** S66: the Matanikau footbridge, upstream of the river mouth. */
  { match: 'Matanikau River', region: 'Pacific', area: 'Solomon Islands', latitude: -9.43, longitude: 159.93, theater: 'pto' },
  /** S67: Nhpum Ga in the Kachin hills, north Burma (approximate; the CBI theater is pinned with the Pacific). */
  { match: 'Nhpum Ga', region: 'Burma', area: 'Kachin Hills', latitude: 26.55, longitude: 96.65, theater: 'pto' },
  /** S68: Charpate, north of Myitkyina (approximate). */
  { match: 'Charpate', region: 'Burma', area: 'Myitkyina', latitude: 25.45, longitude: 97.38, theater: 'pto' },
  /** S69: the beachhead north of Charan Kanoa, Saipan. */
  { match: 'Charan Kanoa', region: 'Pacific', area: 'Marianas', latitude: 15.15, longitude: 145.71, theater: 'pto' },
  /** S70: the Romauldo Hills caves, north-west Angaur, Palau Islands (approximate). */
  { match: 'Angaur Island', region: 'Pacific', area: 'Palau Islands', latitude: 6.915, longitude: 134.13, theater: 'pto' },
  /** S71: Potpot, near the Lingayen Gulf beachhead, Luzon (approximate). */
  { match: 'Potpot Luzon', region: 'Pacific', area: 'Philippines', latitude: 16.0, longitude: 120.55, theater: 'pto' },
  /** The Pacific demo (board o, no real battle): pinned on Guadalcanal. */
  { match: 'Training ground, Solomon Islands', region: 'Pacific', area: 'Solomon Islands', latitude: -9.43, longitude: 160.05, theater: 'pto' },
];

/**
 * Where a card's history puts the fight more precisely than its dateline does. Scenarios that share a
 * dateline would otherwise share one pin, which the atlas can never pull apart by zooming.
 */
const SCENARIO_SPOTS: Record<string, { latitude: number; longitude: number }> = {
  /** 194th IR north of the Stalingrad-1 station, pushing for the central ferry landings. */
  'sk-s35': { latitude: 48.715, longitude: 44.533 },
  /** Bread Factory #2, just south of the Barrikady works. */
  'sk-s18': { latitude: 48.779, longitude: 44.572 },
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function isoDate(value: string | undefined): string | null {
  const m = value?.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  return month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

function facets(s: ScenarioDef) {
  const units = s.forces.flatMap((force) => force.units.map((unit) => ({ ...unit, forceSide: force.side })));
  const defs = units.map((u) => COUNTERS[u.def]).filter((d): d is NonNullable<typeof d> => d !== undefined);
  const vehicles = defs.filter((d) => d!.kind === 'vehicle').map((d) => (d!.kind === 'vehicle' ? d!.name : d!.id));
  const guns = defs
    .filter((d) => d!.kind === 'gun')
    .map((d) => (d!.kind === 'gun' ? `${d.nationality} ${d.type} ${d.caliber}${d.barrel ?? ''}` : d!.id));
  const unitClasses = Array.from(new Set(defs.map((d) => d!.kind)));
  return {
    nations: Array.from(new Set(s.sides.flatMap((side) => side.nationalities ?? [side.nationality]))),
    vehicles: Array.from(new Set(vehicles)),
    guns: Array.from(new Set(guns)),
    unitClasses,
    unitCount: units.reduce((sum, u) => sum + u.count, 0),
  };
}

export function scenarioCatalogEntry(s: ScenarioDef): ScenarioCatalogEntry | null {
  // The longest match is the most specific: 'Red Barricades, Stalingrad' is the Barricades, not the city.
  const geo = ETO_PLACES.filter((place) => s.place?.includes(place.match)).sort((a, b) => b.match.length - a.match.length)[0];
  if (!geo) return null;
  const f = facets(s);
  const dateISO = isoDate(s.date);
  const productName = productById(s.product)?.name ?? '';
  const { theater = 'eto', ...where } = geo;
  const entry: Omit<ScenarioCatalogEntry, 'searchText'> = {
    id: s.id,
    rulesetId: scenarioRuleset(s),
    theater,
    theaterName: THEATER_NAMES[theater],
    ...where,
    ...SCENARIO_SPOTS[s.id],
    dateISO,
    year: dateISO ? Number(dateISO.slice(0, 4)) : null,
    month: s.month,
    number: scenarioNumber(s),
    name: scenarioName(s),
    title: s.title,
    place: s.place ?? '',
    product: s.product ?? '',
    productName,
    designer: s.designer ?? '',
    playable: isPlayable(s),
    turns: s.turns,
    halfFinalTurn: s.halfFinalTurn,
    ...f,
  };
  return {
    ...entry,
    searchText: [entry.number, entry.title, entry.place, s.date ?? '', entry.dateISO ?? '', entry.productName, entry.designer, ...entry.nations, ...entry.vehicles, ...entry.guns]
      .join(' ')
      .toLocaleLowerCase(),
  };
}

/** Every scenario with a dateline the atlas can pin: the historical cards and Open ASL's demo scenarios. */
export const SCENARIO_CATALOG: ScenarioCatalogEntry[] = ALL_SCENARIOS.filter((s) => !s.devOnly).map(scenarioCatalogEntry).filter((x): x is ScenarioCatalogEntry => x !== null);

export const THEATERS: ReadonlyArray<{ id: TheaterId; short: string; name: string; enabled: boolean; center: [number, number]; zoom: number }> = [
  { id: 'eto', short: 'ETO', name: 'European Theater', enabled: true, center: [18, 49], zoom: 3.2 },
  { id: 'pto', short: 'PTO', name: 'Pacific Theater', enabled: true, center: [135, 10], zoom: 2.5 },
  { id: 'dto', short: 'DTO', name: 'Desert Theater', enabled: false, center: [19, 29], zoom: 3 },
  { id: 'korea', short: 'Korea', name: 'Korean War', enabled: false, center: [127.5, 37.5], zoom: 4 },
];
