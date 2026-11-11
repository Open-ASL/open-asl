import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type MapGeoJSONFeature } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { feature } from 'topojson-client';
import countries from 'world-atlas/countries-110m.json';
import regionalAtlasUrl from 'world-atlas/countries-50m.json?url';
import tacticalAtlasUrl from 'world-atlas/countries-10m.json?url';
import type { FeatureCollection, LineString, Point, Position } from 'geojson';
import { SCENARIO_CATALOG, THEATERS, scenarioById, type ScenarioCatalogEntry, type TheaterId } from '@asl/content';
import { COL, COMPUTER_AVAILABLE, COMPUTER_NAME, COMPUTER_OPPONENTS, balanceLabel, type RulesetId, type ScenarioStatsDoc } from '@asl/platform';
import { useLobbyRuleset } from './ruleset';

/** Scenarios the computer opponent can sit down at. */
const botPlays = (id: string) => (COMPUTER_OPPONENTS[id]?.length ?? 0) > 0;
import { db } from '../firebase';
import { Briefing } from '../panels/Briefing';
import { Emblem as NationalEmblem } from '../fx/TurnChit';
import { NATION } from '../game/describe';
import { addMatchupBadges, badgeId, matchupOf } from './matchupBadge';

function clipRingAtLongitude(ring: Position[], longitude: number, keepGreater: boolean): Position[] {
  const source = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const clipped: Position[] = [];
  const inside = (point: Position) => keepGreater ? point[0]! >= longitude : point[0]! <= longitude;
  const intersection = (from: Position, to: Position): Position => {
    const distance = to[0]! - from[0]!;
    const amount = distance === 0 ? 0 : (longitude - from[0]!) / distance;
    return [longitude, from[1]! + (to[1]! - from[1]!) * amount];
  };

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]!;
    const previous = source[(index + source.length - 1) % source.length]!;
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside !== previousInside) clipped.push(intersection(previous, current));
    if (currentInside) clipped.push(current);
  }
  if (clipped.length >= 3) clipped.push([...clipped[0]!]);
  return clipped;
}

function splitPolygonAtAntimeridian(polygon: Position[][]): Position[][][] {
  const outer = polygon[0];
  if (!outer?.some((point, index) => index > 0 && Math.abs(point[0]! - outer[index - 1]![0]!) > 180)) return [polygon];

  let offset = 0;
  let previousLongitude = outer[0]![0]!;
  const unwrapped = outer.map((point, index) => {
    if (index === 0) return [...point];
    let longitude = point[0]! + offset;
    while (longitude - previousLongitude > 180) { offset -= 360; longitude -= 360; }
    while (longitude - previousLongitude < -180) { offset += 360; longitude += 360; }
    previousLongitude = longitude;
    return [longitude, point[1]!, ...point.slice(2)];
  });

  const pieces: Position[][][] = [];
  for (const shift of [-360, 0, 360]) {
    const shifted = unwrapped.map((point) => [point[0]! + shift, ...point.slice(1)]);
    const westClipped = clipRingAtLongitude(shifted, -180, true);
    const fullyClipped = clipRingAtLongitude(westClipped, 180, false);
    if (fullyClipped.length >= 4) pieces.push([fullyClipped]);
  }
  return pieces;
}

function seamSafeGeoJSON(collection: FeatureCollection): FeatureCollection {
  return {
    ...collection,
    features: collection.features.map((item) => {
      if (!item.geometry || (item.geometry.type !== 'Polygon' && item.geometry.type !== 'MultiPolygon')) return item;
      const polygons = item.geometry.type === 'Polygon' ? [item.geometry.coordinates] : item.geometry.coordinates;
      return { ...item, geometry: { type: 'MultiPolygon', coordinates: polygons.flatMap(splitPolygonAtAntimeridian) } };
    }),
  };
}

const COUNTRY_GEOJSON = seamSafeGeoJSON(feature(countries, countries.objects['countries']!) as unknown as FeatureCollection);
const LAND_GEOJSON = seamSafeGeoJSON(feature(countries, countries.objects['land']!) as unknown as FeatureCollection);
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WWII_YEARS = Array.from({ length: 7 }, (_, index) => 1939 + index);
const SCENARIO_NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const alphabeticalKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLocaleLowerCase();
const validWWIIYear = (value: string | null) => value && WWII_YEARS.includes(Number(value)) ? value : '';
const MAP_ATTRIBUTION = '<a href="https://openfreemap.org/">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ALLIED_NATION_IDS = new Set(['al', 'am', 'br', 'ru']);
const AXIS_NATION_IDS = new Set(['ax', 'ge', 'it', 'ja']);

type AtlasTopology = typeof countries;

function graticuleData(step: number): FeatureCollection<LineString> {
  const features: FeatureCollection<LineString>['features'] = [];
  for (let longitude = -180; longitude <= 180; longitude += step) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: Array.from({ length: 33 }, (_, index) => [longitude, -80 + index * 5]) } });
  }
  for (let latitude = -80; latitude <= 80; latitude += step) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: Array.from({ length: 73 }, (_, index) => [-180 + index * 5, latitude]) } });
  }
  return { type: 'FeatureCollection', features };
}

function atlasGeometry(topology: AtlasTopology, object: 'countries' | 'land') {
  return seamSafeGeoJSON(feature(topology, topology.objects[object]!) as unknown as FeatureCollection);
}

async function addRegionalDetail(map: MlMap) {
  if (map.getSource('countries-regional')) return;
  const topology = await fetch(regionalAtlasUrl).then((response) => response.json()) as AtlasTopology;
  if (!map.isStyleLoaded() || map.getSource('countries-regional')) return;
  map.addSource('land-regional', { type: 'geojson', data: atlasGeometry(topology, 'land') });
  map.addSource('countries-regional', { type: 'geojson', data: atlasGeometry(topology, 'countries') });
  map.addLayer({ id: 'regional-land', type: 'fill', source: 'land-regional', minzoom: 2.35, paint: { 'fill-color': '#293126', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2.35, 0, 3.2, 0.94] } }, 'detail-landcover');
  map.addLayer({ id: 'regional-coast-shadow', type: 'line', source: 'land-regional', minzoom: 2.35, paint: { 'line-color': '#090c0b', 'line-width': ['interpolate', ['linear'], ['zoom'], 2.35, 2, 6, 6], 'line-blur': 2.5, 'line-opacity': 0.72 } }, 'detail-landcover');
  map.addLayer({ id: 'regional-coast', type: 'line', source: 'land-regional', minzoom: 2.35, paint: { 'line-color': '#89956f', 'line-width': ['interpolate', ['linear'], ['zoom'], 2.35, 0.65, 6, 1.5], 'line-opacity': 0.82 } }, 'detail-landcover');
  map.addLayer({ id: 'regional-borders-shadow', type: 'line', source: 'countries-regional', minzoom: 2.7, paint: { 'line-color': '#0b0e0c', 'line-width': ['interpolate', ['linear'], ['zoom'], 2.7, 1.5, 7, 3], 'line-opacity': 0.65 } }, 'detail-landcover');
  map.addLayer({ id: 'regional-borders', type: 'line', source: 'countries-regional', minzoom: 2.7, paint: { 'line-color': '#647057', 'line-width': ['interpolate', ['linear'], ['zoom'], 2.7, 0.45, 7, 1], 'line-dasharray': [4, 2], 'line-opacity': 0.9 } }, 'detail-landcover');
}

async function addTacticalDetail(map: MlMap) {
  if (map.getSource('countries-tactical')) return;
  const topology = await fetch(tacticalAtlasUrl).then((response) => response.json()) as AtlasTopology;
  if (!map.isStyleLoaded() || map.getSource('countries-tactical')) return;
  map.addSource('land-tactical', { type: 'geojson', data: atlasGeometry(topology, 'land') });
  map.addSource('countries-tactical', { type: 'geojson', data: atlasGeometry(topology, 'countries') });
  map.addLayer({ id: 'tactical-land', type: 'fill', source: 'land-tactical', minzoom: 4.65, paint: { 'fill-color': '#2b3328', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4.65, 0, 5.35, 1] } }, 'detail-landcover');
  map.addLayer({ id: 'tactical-coast-shadow', type: 'line', source: 'land-tactical', minzoom: 4.65, paint: { 'line-color': '#080b09', 'line-width': ['interpolate', ['linear'], ['zoom'], 4.65, 4, 10, 10], 'line-blur': 4, 'line-opacity': 0.78 } }, 'detail-landcover');
  map.addLayer({ id: 'tactical-coast', type: 'line', source: 'land-tactical', minzoom: 4.65, paint: { 'line-color': '#a1a982', 'line-width': ['interpolate', ['linear'], ['zoom'], 4.65, 0.8, 10, 2], 'line-opacity': 0.92 } }, 'detail-landcover');
  map.addLayer({ id: 'tactical-borders-shadow', type: 'line', source: 'countries-tactical', minzoom: 4.8, paint: { 'line-color': '#0b0e0c', 'line-width': ['interpolate', ['linear'], ['zoom'], 4.8, 2, 10, 5], 'line-opacity': 0.7 } }, 'detail-landcover');
  map.addLayer({ id: 'tactical-borders', type: 'line', source: 'countries-tactical', minzoom: 4.8, paint: { 'line-color': '#727d62', 'line-width': ['interpolate', ['linear'], ['zoom'], 4.8, 0.6, 10, 1.35], 'line-dasharray': [4, 2], 'line-opacity': 0.94 } }, 'detail-landcover');
}

function addDeepZoomBasemap(map: MlMap) {
  const label: ExpressionSpecification = ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
  map.addSource('openmaptiles', {
    type: 'vector',
    url: 'https://tiles.openfreemap.org/planet',
  });
  map.addLayer({ id: 'detail-landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', minzoom: 4.25, paint: { 'fill-color': ['match', ['get', 'class'], 'wood', '#263526', 'grass', '#35402d', 'farmland', '#3a3b2b', 'ice', '#a8aea0', 'sand', '#5b5235', '#30362a'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4.25, 0, 5.25, 0.7] } });
  map.addLayer({ id: 'detail-landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', minzoom: 6, paint: { 'fill-color': ['match', ['get', 'class'], 'residential', '#343735', 'industrial', '#40362f', 'military', '#43312b', 'cemetery', '#2d3a2d', '#36362e'], 'fill-opacity': 0.58 } });
  map.addLayer({ id: 'detail-parks', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', minzoom: 5, paint: { 'fill-color': '#2c3d2a', 'fill-opacity': 0.56 } });
  map.addLayer({ id: 'detail-water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', minzoom: 4.25, paint: { 'fill-color': '#111b1b', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4.25, 0, 5, 0.96] } });
  map.addLayer({ id: 'detail-waterways-shadow', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', minzoom: 6, paint: { 'line-color': '#080d0e', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 5], 'line-opacity': 0.8 } });
  map.addLayer({ id: 'detail-waterways', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', minzoom: 6, paint: { 'line-color': '#3f6561', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.55, 12, 2], 'line-opacity': 0.86 } });
  map.addLayer({ id: 'detail-boundaries', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', minzoom: 4.25, filter: ['<=', ['get', 'admin_level'], 4], paint: { 'line-color': '#8d8764', 'line-width': ['interpolate', ['linear'], ['zoom'], 4.25, 0.45, 10, 1.2], 'line-dasharray': [5, 3], 'line-opacity': 0.5 } });
  map.addLayer({ id: 'detail-roads-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 6, filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#151613', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.6, 12, 7], 'line-opacity': 0.85 } });
  map.addLayer({ id: 'detail-roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 6, filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#a17b3f', ['primary', 'secondary'], '#837550', '#676650'], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 3.4], 'line-opacity': 0.88 } });
  map.addLayer({ id: 'detail-minor-roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 8, filter: ['match', ['get', 'class'], ['minor', 'service', 'track', 'path'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#5d6050', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.35, 13, 2], 'line-opacity': 0.66 } });
  map.addLayer({ id: 'detail-railways', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 7, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#88826d', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.45, 13, 1.4], 'line-dasharray': [3, 3], 'line-opacity': 0.68 } });
  map.addLayer({ id: 'detail-buildings', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 12, paint: { 'fill-color': '#4a4940', 'fill-outline-color': '#1a1c18', 'fill-opacity': 0.78 } });
  map.addLayer({ id: 'detail-water-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name', minzoom: 5, layout: { 'symbol-placement': 'line', 'text-field': label, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-letter-spacing': 0.12 }, paint: { 'text-color': '#71918d', 'text-halo-color': '#111716', 'text-halo-width': 1.5 } });
  map.addLayer({ id: 'detail-place-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 5, filter: ['match', ['get', 'class'], ['city', 'town', 'village'], true, false], layout: { 'text-field': label, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 13], 'text-letter-spacing': 0.08, 'text-transform': 'uppercase', 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.6, 'text-optional': true }, paint: { 'text-color': '#c8c4ac', 'text-halo-color': '#151914', 'text-halo-width': 1.5, 'text-halo-blur': 0.5 } });
}

// Vite pre-bundles MapLibre's main module, so its default sibling-worker URL does not exist.
// Emitting the worker explicitly keeps both development and production atlas rendering reliable.
setWorkerUrl(mapWorkerUrl);

const CLUSTER_RADIUS_PX = 46;
const CLUSTER_MAX_ZOOM = 9;

/** Web Mercator pixel position at an integer zoom (512px world at zoom 0). */
function project(lon: number, lat: number, zoom: number): [number, number] {
  const world = 512 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * world, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world];
}

/**
 * Scenarios grouped for one zoom level: anything within the cluster radius on the screen joins a
 * cluster. Done here rather than by the map so the grouping follows the zoom the player sees;
 * the map's own clustering keys on its internal tile zoom, which drifts with latitude on the
 * globe, so merely rotating it regrouped the pins. Above the max zoom only co-located scenarios
 * are grouped, which is what the card's "several scenarios here" picker needs.
 */
function clusterData(entries: ScenarioCatalogEntry[], zoom: number): FeatureCollection<Point> {
  const z = Math.min(zoom, CLUSTER_MAX_ZOOM);
  const radius = zoom > CLUSTER_MAX_ZOOM ? 0.5 : CLUSTER_RADIUS_PX;
  const pts = entries.map((s) => ({ s, p: project(s.longitude, s.latitude, z) }));
  const taken = new Set<number>();
  const features: FeatureCollection<Point>['features'] = [];
  let clusterId = 1_000_000;
  pts.forEach((a, i) => {
    if (taken.has(i)) return;
    taken.add(i);
    const members = [a];
    pts.forEach((b, j) => { if (!taken.has(j) && Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) <= radius) { taken.add(j); members.push(b); } });
    if (members.length === 1) {
      const { s } = a;
      features.push({ type: 'Feature', id: entries.indexOf(s), geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] }, properties: { id: s.id, number: s.number, title: s.name, place: s.place, region: s.region, year: s.year, badge: badgeId(matchupOf(s.id)) } });
    } else {
      const lon = members.reduce((sum, m) => sum + m.s.longitude, 0) / members.length;
      const lat = members.reduce((sum, m) => sum + m.s.latitude, 0) / members.length;
      features.push({ type: 'Feature', id: clusterId++, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { point_count: members.length, point_count_abbreviated: String(members.length), ids: JSON.stringify(members.map((m) => m.s.id)) } });
    }
  });
  return { type: 'FeatureCollection', features };
}

/**
 * The zoom as the player sees it on the globe. MapLibre's reported zoom is a Mercator zoom that
 * drifts with the latitude under the view centre (by log2 of its cosine) as the globe rotates,
 * while the apparent scale stays put; removing that term gives a number that only changes when
 * the player actually zooms, so the grouping never flips on a rotation.
 */
function apparentZoom(map: MlMap): number {
  return map.getZoom() - Math.log2(Math.max(0.05, Math.cos((map.getCenter().lat * Math.PI) / 180)));
}

/**
 * The first zoom at which a cluster's members no longer all sit in one cluster, or null when they
 * never part: scenarios pinned to the same spot, which only the briefing's picker can tell apart.
 */
function expansionZoom(ids: string[], from: number): number | null {
  const members = SCENARIO_CATALOG.filter((s) => ids.includes(s.id));
  for (let z = Math.floor(from) + 1; z <= CLUSTER_MAX_ZOOM + 1; z++) if (clusterData(members, z).features.length > 1) return z;
  return null;
}

function useScenarioStats(ruleset: RulesetId, id: string | null) {
  const [stats, setStats] = useState<ScenarioStatsDoc | null>(null);
  useEffect(() => {
    setStats(null);
    if (!id) return;
    return onSnapshot(doc(db, COL.scenarioStats, `${ruleset}_${id}`), (snap) => setStats((snap.data() as ScenarioStatsDoc | undefined) ?? null), () => setStats(null));
  }, [ruleset, id]);
  return stats;
}

interface NationChoice { value: string; counterNation: string; name: string }

function actualNations(scenario: ScenarioCatalogEntry): NationChoice[] {
  const definition = scenarioById(scenario.id);
  return scenario.nations.flatMap((counterNation) => {
    const name = definition?.nationalityNames?.[counterNation] ?? NATION[counterNation];
    // Allied/Axis Minor describes the counter set, not the country represented by it. Scenario
    // definitions provide the real name (Greek, Dutch, and so on) whenever those counters appear.
    if (!name || name === 'Allied Minor' || name === 'Axis Minor') return [];
    return [{ value: name === NATION[counterNation] ? counterNation : `${counterNation}:${name}`, counterNation, name }];
  });
}

function hasActualNation(scenario: ScenarioCatalogEntry, value: string): boolean {
  return actualNations(scenario).some((nation) => nation.value === value || nation.counterNation === value);
}

function NationFilter({ label, emptyLabel, value, choices, onChange }: { label: string; emptyLabel: string; value: string; choices: NationChoice[]; onChange(value: string): void }) {
  const selected = choices.find((item) => item.value === value);
  return <label className="nation-filter"><span>{label}</span><div className={`nation-select ${selected ? 'has-emblem' : ''}`}>{selected && <i className="nation-filter-emblem" aria-hidden><svg viewBox="-24 -24 48 48"><NationalEmblem side={selected.counterNation} /></svg></i>}<select value={selected?.value ?? ''} onChange={(event) => onChange(event.target.value)}><option value="">{emptyLabel}</option>{choices.map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}</select></div></label>;
}

export function ScenarioExplorer() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const ruleset = useLobbyRuleset();
  // Each lobby's atlas shows only the scenarios of its ruleset.
  const rulesetCatalog = useMemo(() => SCENARIO_CATALOG.filter((s) => s.rulesetId === ruleset), [ruleset]);
  const [params, setParams] = useSearchParams();
  // One theater at a time: its scenarios on the map and in the list, its regions and nations in the filters. A link to a
  // scenario opens on that scenario's theater.
  const [theater, setTheater] = useState<TheaterId>(() => {
    const asked = params.get('theater') as TheaterId | null;
    if (asked && THEATERS.some((t) => t.id === asked && t.enabled)) return asked;
    const linked = params.get('scenario');
    return (linked && SCENARIO_CATALOG.find((s) => s.id === linked)?.theater) || 'eto';
  });
  const catalog = useMemo(() => rulesetCatalog.filter((s) => s.theater === theater), [rulesetCatalog, theater]);
  const shownRef = useRef<ScenarioCatalogEntry[]>(catalog);
  // The scenario whose briefing opens once the map has flown to it; a later click supersedes it.
  const pendingOpenRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [region, setRegion] = useState(params.get('region') ?? '');
  const legacyNation = params.get('nation') ?? '';
  const [alliedNation, setAlliedNation] = useState(params.get('allied') ?? (ALLIED_NATION_IDS.has(legacyNation) ? legacyNation : ''));
  const [axisNation, setAxisNation] = useState(params.get('axis') ?? (AXIS_NATION_IDS.has(legacyNation) ? legacyNation : ''));
  const [product, setProduct] = useState(params.get('product') ?? '');
  const [month, setMonth] = useState(params.get('month') ?? '');
  const [yearFrom, setYearFrom] = useState(() => validWWIIYear(params.get('from')));
  const [yearTo, setYearTo] = useState(() => {
    const from = validWWIIYear(params.get('from'));
    const to = validWWIIYear(params.get('to'));
    return from && to && Number(from) > Number(to) ? from : to;
  });
  const [playableOnly, setPlayableOnly] = useState(params.get('playable') === '1');
  const [botOnly, setBotOnly] = useState(params.get('bot') === '1');
  const [selectedIds, setSelectedIds] = useState<string[]>(() => params.get('scenario') ? [params.get('scenario')!] : []);
  // A challenge started from the roster, chat or a profile comes here to pick the scenario; the player being challenged rides along.
  const [challenge] = useState(() => params.get('challenge'));
  const [locatedId, setLocatedId] = useState(() => params.get('scenario') ?? '');
  const regions = useMemo(() => Array.from(new Set(catalog.map((s) => s.region))).sort(), [catalog]);
  const alliedNations = useMemo(() => Array.from(new Map(catalog.flatMap(actualNations).filter((nation) => ALLIED_NATION_IDS.has(nation.counterNation)).map((nation) => [nation.value, nation])).values()).sort((a, b) => a.name.localeCompare(b.name)), [catalog]);
  const axisNations = useMemo(() => Array.from(new Map(catalog.flatMap(actualNations).filter((nation) => AXIS_NATION_IDS.has(nation.counterNation)).map((nation) => [nation.value, nation])).values()).sort((a, b) => a.name.localeCompare(b.name)), [catalog]);
  const products = useMemo(() => Array.from(new Map(catalog.filter((s) => s.product).map((s) => [s.product, s.productName || s.product])).entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [catalog]);

  const filtered = useMemo(() => {
    const words = search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return catalog.filter((s) => {
      if (region && s.region !== region) return false;
      if (alliedNation && !hasActualNation(s, alliedNation)) return false;
      if (axisNation && !hasActualNation(s, axisNation)) return false;
      if (product && s.product !== product) return false;
      if (month && s.month !== Number(month)) return false;
      if (playableOnly && !s.playable) return false;
      if (botOnly && ruleset === 'starter-kit' && !botPlays(s.id)) return false;
      if (yearFrom && (s.year ?? 0) < Number(yearFrom)) return false;
      if (yearTo && (s.year ?? 9999) > Number(yearTo)) return false;
      return words.every((word) => s.searchText.includes(word));
    }).sort((a, b) => SCENARIO_NAME_COLLATOR.compare(alphabeticalKey(a.name), alphabeticalKey(b.name)) || SCENARIO_NAME_COLLATOR.compare(a.number, b.number));
  }, [catalog, search, region, alliedNation, axisNation, product, month, yearFrom, yearTo, playableOnly, botOnly]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (theater !== 'eto') next.set('theater', theater);
    if (search) next.set('q', search);
    if (region) next.set('region', region);
    if (alliedNation) next.set('allied', alliedNation);
    if (axisNation) next.set('axis', axisNation);
    if (product) next.set('product', product);
    if (month) next.set('month', month);
    if (yearFrom) next.set('from', yearFrom);
    if (yearTo) next.set('to', yearTo);
    if (playableOnly) next.set('playable', '1');
    if (botOnly) next.set('bot', '1');
    if (selectedIds.length === 1) next.set('scenario', selectedIds[0]!);
    if (challenge) next.set('challenge', challenge);
    setParams(next, { replace: true });
  }, [theater, search, region, alliedNation, axisNation, product, month, yearFrom, yearTo, playableOnly, botOnly, selectedIds, challenge, setParams]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new MlMap({
      container: mapNode.current,
      style: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'void', type: 'background', paint: { 'background-color': '#0d100e' } }] },
      // Europe at the default zoom; another theater opens on its own view.
      ...(theater === 'eto' ? { center: [18, 45] as [number, number], zoom: 1.65 } : { center: THEATERS.find((t) => t.id === theater)!.center, zoom: THEATERS.find((t) => t.id === theater)!.zoom }),
      minZoom: 1.2, maxZoom: 13,
      renderWorldCopies: false,
      attributionControl: { compact: true, customAttribution: MAP_ATTRIBUTION },
    });
    const attributionTimer = window.setTimeout(() => mapNode.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'), 5000);
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-left');
    // Dev-only hook for the headless drivers, like window.aslBoard on the match screen.
    if (import.meta.env.DEV) (window as unknown as { aslAtlas?: MlMap }).aslAtlas = map;
    map.on('load', () => {
      map.setProjection({ type: 'globe' });
      map.addSource('countries', { type: 'geojson', data: COUNTRY_GEOJSON });
      map.addSource('land', { type: 'geojson', data: LAND_GEOJSON });
      map.addSource('graticule-major', { type: 'geojson', data: graticuleData(15) });
      map.addSource('graticule-minor', { type: 'geojson', data: graticuleData(5) });
      map.addLayer({ id: 'country-fill', type: 'fill', source: 'countries', paint: { 'fill-color': '#232923', 'fill-opacity': 0.82 } });
      map.addLayer({ id: 'country-lines', type: 'line', source: 'countries', paint: { 'line-color': '#55624a', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.45, 6, 1.2], 'line-opacity': 0.78 } });
      map.addLayer({ id: 'world-coast-highlight', type: 'line', source: 'land', maxzoom: 3.4, paint: { 'line-color': '#788467', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.45, 3.4, 1], 'line-opacity': 0.72 } });
      map.addLayer({ id: 'major-grid', type: 'line', source: 'graticule-major', paint: { 'line-color': '#899171', 'line-width': 0.45, 'line-dasharray': [2, 4], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.18, 4, 0.28, 7, 0.08] } });
      map.addLayer({ id: 'minor-grid', type: 'line', source: 'graticule-minor', minzoom: 4, paint: { 'line-color': '#899171', 'line-width': 0.35, 'line-dasharray': [1, 5], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 5.2, 0.2, 9, 0.09] } });
      addDeepZoomBasemap(map);
      map.addSource('scenarios', { type: 'geojson', data: clusterData(shownRef.current, Math.floor(apparentZoom(map))) });
      // Regroup only when the apparent zoom crosses a whole number, so rotating or panning never changes the grouping.
      let groupedAt = Math.floor(apparentZoom(map));
      map.on('move', () => {
        const z = Math.floor(apparentZoom(map));
        if (z === groupedAt) return;
        groupedAt = z;
        (map.getSource('scenarios') as GeoJSONSource | undefined)?.setData(clusterData(shownRef.current, z));
      });
      // A slow pulse ring under every cluster, at every zoom, so the groups read as things to click (a scenario's own
      // pin is its matchup badge, which needs no help to be seen).
      map.addLayer({ id: 'scenario-pulse', type: 'circle', source: 'scenarios', filter: ['has', 'point_count'], paint: { 'circle-color': '#f0cf72', 'circle-radius': 9, 'circle-opacity': 0.4, 'circle-stroke-color': '#f0cf72', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.6 } });
      map.addLayer({ id: 'scenario-halos', type: 'circle', source: 'scenarios', minzoom: 4.5, filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#c9a24a', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 10, 9, 25], 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0, 5.3, 0.14], 'circle-stroke-color': '#c9a24a', 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.35 } });
      const clusterHovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
      map.addLayer({ id: 'scenario-clusters', type: 'circle', source: 'scenarios', filter: ['has', 'point_count'], paint: { 'circle-color': ['case', clusterHovered, '#e2bd63', '#c9a24a'], 'circle-radius': ['+', ['step', ['get', 'point_count'], 18, 8, 22, 25, 28], ['case', clusterHovered, 4, 0]], 'circle-stroke-color': '#f0cf72', 'circle-stroke-width': ['case', clusterHovered, 3, 2], 'circle-opacity': 0.94, 'circle-radius-transition': { duration: 120 } } });
      map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'scenarios', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 }, paint: { 'text-color': '#0b1110' } });
      const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
      // Each scenario's pin is a badge of the two nations it pits against each other (Allied left, Axis right); a
      // brass glow under it shows the hovered one. The badges are drawn once per matchup, then the layer goes in.
      map.addLayer({ id: 'scenario-pin-glow', type: 'circle', source: 'scenarios', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#f0cf72', 'circle-radius': ['case', hovered, 34, 24], 'circle-opacity': ['case', hovered, 0.55, 0], 'circle-blur': 0.5, 'circle-radius-transition': { duration: 120 }, 'circle-opacity-transition': { duration: 120 } } });
      void addMatchupBadges(map, [...new Map(SCENARIO_CATALOG.map((s) => [badgeId(matchupOf(s.id)), matchupOf(s.id)])).values()]).then(() => {
        if (map.getLayer('scenario-pins') || !map.getStyle()) return;
        map.addLayer({ id: 'scenario-pins', type: 'symbol', source: 'scenarios', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': ['get', 'badge'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 1, 6, 1.2, 9, 1.4], 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, 'scenario-labels');
      });
      map.addLayer({ id: 'scenario-labels', type: 'symbol', source: 'scenarios', minzoom: 6, filter: ['!', ['has', 'point_count']], layout: { 'text-field': ['concat', ['get', 'number'], '  ', ['get', 'title'], '\n', ['get', 'place']], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 9, 14], 'text-offset': [0, 2.3], 'text-anchor': 'top', 'text-max-width': 18, 'text-optional': true, 'symbol-sort-key': ['get', 'year'] }, paint: { 'text-color': '#e6dec5', 'text-halo-color': '#10140f', 'text-halo-width': 2, 'text-halo-blur': 1 } });
      map.on('click', 'scenario-pins', (event) => {
        const id = event.features?.[0]?.properties?.['id'];
        if (typeof id === 'string') {
          pendingOpenRef.current = null;
          setLocatedId(id);
          setSelectedIds([id]);
        }
      });
      map.on('click', 'scenario-clusters', async (event) => {
        const hit = event.features?.[0] as MapGeoJSONFeature | undefined;
        const raw = hit?.properties?.['ids'];
        const ids: string[] = typeof raw === 'string' ? (JSON.parse(raw) as string[]) : [];
        if (!hit || !ids.length) return;
        const zoom = expansionZoom(ids, apparentZoom(map));
        if (zoom === null) {
          pendingOpenRef.current = null;
          setLocatedId(ids[0] ?? '');
          setSelectedIds(ids);
        } else {
          // Convert the apparent target back to the map's own zoom at the cluster's latitude.
          const lat = ((hit.geometry as Point).coordinates[1] ?? 0) * Math.PI / 180;
          map.easeTo({ center: (hit.geometry as Point).coordinates as [number, number], zoom: zoom + 0.2 + Math.log2(Math.max(0.05, Math.cos(lat))) });
        }
      });
      let hoveredId: number | string | undefined;
      const unhover = () => { if (hoveredId !== undefined) map.setFeatureState({ source: 'scenarios', id: hoveredId }, { hover: false }); hoveredId = undefined; };
      const hoverLayer = (event: { features?: Array<{ id?: number | string }> }) => {
        const id = event.features?.[0]?.id;
        if (id === hoveredId) return;
        unhover();
        if (id !== undefined) { hoveredId = id; map.setFeatureState({ source: 'scenarios', id }, { hover: true }); }
      };
      map.on('mousemove', 'scenario-pins', hoverLayer);
      map.on('mousemove', 'scenario-clusters', hoverLayer);
      map.on('mouseleave', 'scenario-pins', unhover);
      map.on('mouseleave', 'scenario-clusters', unhover);
      // The pulse: radius and fade loop every 2.4 s, cheap enough to run on one small layer.
      let pulseFrame = 0;
      const pulse = (t: number) => {
        const k = (t % 2400) / 2400;
        if (map.getLayer('scenario-pulse')) {
          map.setPaintProperty('scenario-pulse', 'circle-radius', ['+', ['case', ['has', 'point_count'], ['step', ['get', 'point_count'], 18, 8, 22, 25, 28], 9], 14 * k]);
          map.setPaintProperty('scenario-pulse', 'circle-opacity', 0.35 * (1 - k));
          map.setPaintProperty('scenario-pulse', 'circle-stroke-opacity', 0.7 * (1 - k));
        }
        pulseFrame = requestAnimationFrame(pulse);
      };
      pulseFrame = requestAnimationFrame(pulse);
      map.once('remove', () => cancelAnimationFrame(pulseFrame));
      for (const layer of ['scenario-clusters', 'scenario-pins']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }
      let regionalRequested = false;
      let tacticalRequested = false;
      const updateDetail = () => {
        const zoom = map.getZoom();
        if (zoom >= 2.2 && !regionalRequested) {
          regionalRequested = true;
          void addRegionalDetail(map).catch(() => undefined);
        }
        if (zoom >= 4.45 && !tacticalRequested) {
          tacticalRequested = true;
          void addTacticalDetail(map).catch(() => undefined);
        }
      };
      map.on('zoomend', updateDetail);
      updateDetail();
      setMapReady(true);
    });
    return () => { window.clearTimeout(attributionTimer); mapRef.current = null; map.remove(); };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    shownRef.current = filtered;
    const map = mapRef.current;
    if (map) (map.getSource('scenarios') as GeoJSONSource | undefined)?.setData(clusterData(filtered, Math.floor(apparentZoom(map))));
  }, [filtered, mapReady]);

  const selected = selectedIds.map((id) => catalog.find((s) => s.id === id)).filter((s): s is ScenarioCatalogEntry => !!s);
  const locate = (entry: ScenarioCatalogEntry) => {
    setLocatedId(entry.id);
    mapRef.current?.flyTo({ center: [entry.longitude, entry.latitude], zoom: 10.25, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1400 });
  };
  /**
   * Fly to the scenario and open its briefing when the flight lands, so the zoom plays out unobscured
   * and the player need not click the pin afterwards. Starting a flight ends any flight in progress,
   * which fires its `moveend` at once, so the listener goes on after the flight starts; a zero-duration
   * flight (reduced motion) has already landed by then and opens straight away. A later click supersedes
   * an earlier one, whose landing is then ignored.
   */
  const locateAndOpen = (entry: ScenarioCatalogEntry) => {
    const map = mapRef.current;
    pendingOpenRef.current = entry.id;
    locate(entry);
    if (!map?.isMoving()) {
      pendingOpenRef.current = null;
      setSelectedIds([entry.id]);
      return;
    }
    map.once('moveend', () => {
      if (pendingOpenRef.current !== entry.id) return;
      pendingOpenRef.current = null;
      setSelectedIds([entry.id]);
    });
  };
  const changeYearFrom = (value: string) => {
    setYearFrom(value);
    if (value && yearTo && Number(value) > Number(yearTo)) setYearTo(value);
  };
  const changeYearTo = (value: string) => {
    setYearTo(value);
    if (value && yearFrom && Number(value) < Number(yearFrom)) setYearFrom(value);
  };

  return (
    <main className="scenario-atlas">
      <aside className="atlas-controls">
        <div className="atlas-title"><p className="eyebrow">Scenario atlas</p></div>
        <div className="theater-picks">{THEATERS.map((t) => <button key={t.id} disabled={!t.enabled} className={t.id === theater ? 'on' : ''} onClick={() => { if (t.id !== theater) { setTheater(t.id); setRegion(''); setSelectedIds([]); } mapRef.current?.flyTo({ center: t.center, zoom: t.zoom, duration: 1300 }); }}><b>{t.short}</b><span>{t.name}</span>{!t.enabled && <small>Coming soon</small>}</button>)}</div>
        <label className="atlas-search"><span>⌕</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, place, vehicle, gun…" /></label>
        <div className="atlas-filter-grid">
          <label className="region-filter"><span>Region</span><select value={region} onChange={(e) => setRegion(e.target.value)}><option value="">All regions</option>{regions.map((r) => <option key={r}>{r}</option>)}</select></label>
          <NationFilter label="Allied nation" emptyLabel="Any Allied nation" value={alliedNation} choices={alliedNations} onChange={setAlliedNation} />
          <NationFilter label="Axis nation" emptyLabel="Any Axis nation" value={axisNation} choices={axisNations} onChange={setAxisNation} />
          <label className="product-filter"><span>Product</span><select value={product} onChange={(e) => setProduct(e.target.value)}><option value="">All products</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Month</span><select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">Any month</option>{MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
          <label className="year-range"><span>Years</span><div><select aria-label="From year" value={yearFrom} onChange={(e) => changeYearFrom(e.target.value)}><option value="">From</option>{WWII_YEARS.filter((year) => !yearTo || year <= Number(yearTo)).map((year) => <option key={year}>{year}</option>)}</select><select aria-label="To year" value={yearTo} onChange={(e) => changeYearTo(e.target.value)}><option value="">To</option>{WWII_YEARS.filter((year) => !yearFrom || year >= Number(yearFrom)).map((year) => <option key={year}>{year}</option>)}</select></div></label>
        </div>
        <div className="atlas-checks">
          <label className="check-row"><input type="checkbox" checked={playableOnly} onChange={(e) => setPlayableOnly(e.target.checked)} /> Playable now</label>
          {COMPUTER_AVAILABLE && ruleset === 'starter-kit' && <label className="check-row" title={`Scenarios ${COMPUTER_NAME} can play`}><input type="checkbox" checked={botOnly} onChange={(e) => setBotOnly(e.target.checked)} /> {COMPUTER_NAME} can play</label>}
        </div>
        <p className="atlas-hint">Click a pin on the map, or a scenario below, to open its card.</p>
        <div className="atlas-result-head"><b>{filtered.length}</b> scenarios <button onClick={() => { setSearch(''); setRegion(''); setAlliedNation(''); setAxisNation(''); setProduct(''); setMonth(''); setYearFrom(''); setYearTo(''); setPlayableOnly(false); setBotOnly(false); }}>Clear</button></div>
        <div className="atlas-results" aria-label="Scenario results">{filtered.map((entry) => <button key={entry.id} className={locatedId === entry.id || selectedIds.includes(entry.id) ? 'on' : ''} onClick={() => locateAndOpen(entry)}><b><span className="result-title">{entry.name}</span><span className="result-code">{entry.number}</span></b><small>{[entry.place, entry.year].filter(Boolean).join(' · ')}{botPlays(entry.id) && <span className="result-bot">{COMPUTER_NAME}</span>}</small></button>)}</div>
      </aside>
      <section className="atlas-map-wrap" aria-label="Interactive scenario globe">
        <div ref={mapNode} className="atlas-map" />
        {!!selected.length && <ScenarioAtlasDialog entries={selected} ruleset={ruleset} challenge={challenge} onClose={() => { pendingOpenRef.current = null; setSelectedIds([]); }} />}
      </section>
    </main>
  );
}

function ScenarioAtlasDialog({ entries, ruleset, challenge, onClose }: { entries: ScenarioCatalogEntry[]; ruleset: RulesetId; challenge: string | null; onClose(): void }) {
  const [activeId, setActiveId] = useState(entries[0]!.id);
  // With a challenge in hand the deploy desk opens straight on sending it to that player.
  const deployLink = (id: string) => `/app/${ruleset}/games?scenario=${id}${challenge ? `&challenge=${challenge}` : ''}`;
  // Keyed on the ids, not the array, which the atlas rebuilds on every render.
  const entryKey = entries.map((e) => e.id).join(',');
  useEffect(() => setActiveId(entryKey.split(',')[0]!), [entryKey]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const entry = entries.find((e) => e.id === activeId) ?? entries[0]!;
  const scenario = scenarioById(entry.id);
  const stats = useScenarioStats(ruleset, entry.id);
  const label = stats ? balanceLabel(stats) : null;

  return <div className="atlas-brief-backdrop" onMouseDown={onClose}>
    <section className="atlas-brief-dialog" role="dialog" aria-modal="true" aria-label={`${entry.number} ${entry.name}`} onMouseDown={(event) => event.stopPropagation()}>
      <header className="atlas-brief-toolbar">
        <div className="atlas-brief-heading">
          <span className="eyebrow">Complete scenario briefing</span>
          {entries.length > 1 && <label><span>{entries.length} scenarios at this location</span><select value={entry.id} onChange={(event) => setActiveId(event.target.value)}>{entries.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.number} {candidate.name}</option>)}</select></label>}
        </div>
        <div className="atlas-brief-actions">
          <Link className={`btn primary ${entry.playable ? '' : 'disabled'}`} aria-disabled={!entry.playable} to={entry.playable ? deployLink(entry.id) : '#'}>{entry.playable ? (challenge ? 'Challenge with this scenario' : 'Choose this scenario') : 'Coming soon'}</Link>
          <button className="atlas-brief-close" onClick={onClose} aria-label="Close scenario" title="Close (Esc)">×</button>
        </div>
      </header>
      <div className="atlas-brief-scroll">
        {scenario ? <Briefing scenario={scenario}>
          <section className="brief-section atlas-community-record">
            <h4>Community record</h4>
            <dl className="atlas-record-facts">
              <div><dt>Public plays</dt><dd>{stats?.publicPlays ?? 0}</dd></div>
              <div><dt>Ranked results</dt><dd>{stats?.rankedResults ?? 0}</dd></div>
              <div><dt>Perceived balance</dt><dd>{label ?? (stats ? `${10 - stats.rankedResults} more ranked results needed` : 'Awaiting play')}</dd></div>
            </dl>
            {stats && <div className="side-records">{scenario.sides.map((side) => <span key={side.side}><b>{side.name}</b> {stats.sideWins[side.side] ?? 0} wins</span>)}</div>}
          </section>
        </Briefing> : <p className="empty-state">This scenario briefing is not available yet.</p>}
      </div>
    </section>
  </div>;
}
