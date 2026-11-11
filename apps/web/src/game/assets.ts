import { ASSETS } from '@asl/content';

const BASE = (import.meta.env.VITE_ASSET_BASE as string | undefined) ?? '';

export const assetUrl = (path: string) => `${BASE}/${path}`;

export function counterImage(defId: string, flipped: boolean): string | null {
  const a = ASSETS.counters[defId];
  if (!a) return null;
  return assetUrl(flipped && a.back ? a.back : a.front);
}

export const markerImage = (name: string) => {
  const path = ASSETS.markers[name] ?? extraMarkers[name];
  return path ? assetUrl(path) : null;
};

/** Markers built by tools/counter-art beyond the VASL set (markers/extra.json): per-nationality CX. */
let extraMarkers: Record<string, string> = {};

/** The CX marker of a unit's own army when the HD set has one, else the plain one (after `loadTurrets`). */
export const cxMarker = (nationality: string | undefined) => (nationality && extraMarkers[`cx-${nationality}`] ? `cx-${nationality}` : 'cx');
export const boardImage = (board: string) => (ASSETS.boards[board] ? assetUrl(ASSETS.boards[board]!.image) : null);

/**
 * A vehicle whose HD art splits into hull and turret (tools/counter-art): the hull counter, the
 * turret image (upright, front up) and where its pivot sits on the counter, in counter px.
 */
export interface SplitTurret {
  hull: string;
  turret: string;
  x: number;
  y: number;
  size: number;
}

let turrets: Record<string, SplitTurret> = {};
let turretsLoad: Promise<void> | undefined;

const json = <T>(path: string, empty: T): Promise<T> =>
  fetch(assetUrl(path))
    .then((r) => (r.ok ? (r.json() as Promise<T>) : empty))
    .catch(() => empty);

/**
 * Load the HD art's manifests once: counters/turrets.json (split turrets) and markers/extra.json
 * (per-nationality markers). Without them (VASL art) every vehicle keeps its one-piece counter and
 * every unit the plain markers.
 */
export function loadTurrets(): Promise<void> {
  turretsLoad ??= Promise.all([json<Record<string, SplitTurret>>('counters/turrets.json', {}), json<Record<string, string>>('markers/extra.json', {})]).then(([t, m]) => {
    turrets = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { ...v, hull: assetUrl(v.hull), turret: assetUrl(v.turret) }]));
    extraMarkers = m;
  });
  return turretsLoad;
}

/** The split art of a vehicle's front face, if it has one (after `loadTurrets`). */
export function splitTurret(defId: string): SplitTurret | null {
  const front = ASSETS.counters[defId]?.front;
  return (front && turrets[front]) || null;
}
