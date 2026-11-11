import { HexGridMap, SK4_TERRAIN, type BoardPlacement, type HexGridMapOptions, type HexTerrainSpec, type MapHex } from '@asl/rules';
import boards from './generated/boards.json';
import { BUILDING_LEVELS } from './buildingLevels';
import { LOS_M } from './generated/los-m';
import { LOS_N } from './generated/los-n';
import { LOS_O } from './generated/los-o';
import { LOS_T } from './generated/los-t';
import { LOS_V } from './generated/los-v';
import { LOS_U } from './generated/los-u';
import { LOS_W } from './generated/los-w';
import { LOS_X } from './generated/los-x';
import { LOS_Y } from './generated/los-y';
import { LOS_Z } from './generated/los-z';
import { decodeRaster, NON_INHERENT, pixelTracers, type BoardRaster, type RasterSource } from './los';

interface BoardJson {
  hexes: Record<string, HexTerrainSpec>;
  roadHexsides: [string, string][];
}

const BOARDS = boards as unknown as Record<string, BoardJson>;
const RASTERS: Record<string, RasterSource> = { m: LOS_M, n: LOS_N, o: LOS_O, t: LOS_T, u: LOS_U, v: LOS_V, w: LOS_W, x: LOS_X, y: LOS_Y, z: LOS_Z };
const decoded = new Map<string, BoardRaster>();

export const availableBoards = () => Object.keys(BOARDS).sort();

/** A board's hexes as recorded: id (with board letter) → terrain spec. For scenario data helpers. */
export const boardHexes = (board: string): Record<string, HexTerrainSpec> => {
  const b = BOARDS[board];
  if (!b) throw new Error(`Unknown board ${board}`);
  return b.hexes;
};

function raster(board: string): BoardRaster {
  let r = decoded.get(board);
  if (!r) {
    const src = RASTERS[board];
    if (!src) throw new Error(`No LOS raster for board ${board}`);
    r = decodeRaster(board, src);
    decoded.set(board, r);
  }
  return r;
}

/** A board's raster without its elevation layer: the board played flat (SSR "Hills do not exist"). */
function flatRaster(board: string): BoardRaster {
  const { elevation: _elevation, ...rest } = raster(board);
  return rest;
}

const roadKind = (h: HexTerrainSpec | undefined) => h?.features?.find((f) => f.startsWith('road:'));
const hasRoad = (h: HexTerrainSpec | undefined) => !!h?.features?.some((f) => f.startsWith('road:') || f === 'woods-road' || f === 'orchard-road');

/**
 * A road crossing a hexside runs through both hexes, but the import marks a hex as a road hex only
 * when the road passes its center pixel: a winding road (board y T7, U7, V7) or one leaving the
 * board along the A5/A6 hexside is missed. Give every hex on a road hexside the road, of the kind
 * (dirt or paved) of the road it joins; replaces `terrain` entries rather than editing board data.
 */
function fillRoadHexes(terrain: Record<string, HexTerrainSpec>, roads: [string, string][]) {
  const next = new Map<string, string[]>();
  for (const [a, b] of roads) {
    next.set(a, [...(next.get(a) ?? []), b]);
    next.set(b, [...(next.get(b) ?? []), a]);
  }
  // Spread each known road's kind along the hexsides into the hexes it reaches.
  const kind = new Map<string, string>();
  const queue = [...next.keys()].filter((h) => roadKind(terrain[h])).sort();
  for (const h of queue) kind.set(h, roadKind(terrain[h])!);
  for (let i = 0; i < queue.length; i++) {
    for (const n of (next.get(queue[i]!) ?? []).sort()) {
      if (kind.has(n)) continue;
      kind.set(n, kind.get(queue[i]!)!);
      queue.push(n);
    }
  }
  for (const h of [...next.keys()].sort()) {
    const spec = terrain[h];
    if (!spec || hasRoad(spec)) continue;
    terrain[h] = { ...spec, features: [...(spec.features ?? []), kind.get(h) ?? 'road:dirt'] };
  }
}

const isBuildingTerrain = (t: string) => t.startsWith('building');

/**
 * Upper building levels from the reviewed per-board table (`buildingLevels.ts`, ASLRB B23.21–23): every hex of a
 * Two Story House has level 1 and an inherent stairwell and is a 1½-level obstacle; a Multi-Story Building has
 * levels 1 and 2, stairs only in its printed stairwell hexes, and is a 2½-level obstacle. A Single Story House
 * gets nothing. Only the full ASL ruleset reads these (`'hex.locations'`); the Starter Kit plays at ground level.
 */
function addBuildingLevels(terrain: Record<string, HexTerrainSpec>, board: string) {
  for (const b of Object.values(BUILDING_LEVELS[board] ?? {})) {
    if (b.kind === 'single') continue;
    for (const h of b.hexes) {
      const spec = terrain[h];
      if (!spec) continue;
      const stairwell = b.kind === 'two' ? 'inherent' : b.stairwells?.includes(h) ? 'printed' : undefined;
      terrain[h] = { ...spec, building: { upper: b.kind === 'two' ? 1 : 2, ...(stairwell ? { stairwell } : {}) }, obstacleHeight: b.kind === 'two' ? 1.5 : 2.5 };
    }
  }
}

const cornerRoadCache = new Map<string, [string, string][]>();

/**
 * The edge roads of the geomorphic boards leave their hex through a corner and run on along the hexside there to
 * the board edge (B5 along the A5/A6 hexside, FF5 along GG5/GG6, ...). The import records that stretch as the
 * hexside only, so the hex the road comes from is a dead end beside it and a stack on the road cannot follow it
 * (no road bonus, e.g. S17 board x B5). Worked out on the whole board, never on a scenario's
 * cut of it (a road leaving the playing area is a dead end of another kind): a road hex with a single road
 * hexside that touches both hexes of a road hexside it is not joined to is joined to both.
 */
function cornerRoads(board: string): [string, string][] {
  let out = cornerRoadCache.get(board);
  if (out) return out;
  const b = BOARDS[board]!;
  const m = new HexGridMap({ boards: [{ board, x: 0, y: 0 }], terrain: b.hexes, roadHexsides: b.roadHexsides, losEffect: (t) => SK4_TERRAIN[t]?.los ?? 'none' });
  const joined = (id: string) => m.neighbors(id).filter((n) => m.roadHexside(id, n));
  out = [];
  for (const id of Object.keys(b.hexes).sort()) {
    if (!m.hex(id) || joined(id).length !== 1) continue;
    const nbrs = m.neighbors(id).filter((n) => !m.roadHexside(id, n));
    for (const a of nbrs) for (const c of nbrs) if (a < c && m.roadHexside(a, c)) out.push([id, a], [id, c]);
  }
  cornerRoadCache.set(board, out);
  return out;
}

/** PTO Terrain variants a card's SSR 1 sets (SK4 8.2): see `buildMap`'s `pto`. */
export interface PtoMapOptions {
  light?: boolean;
  kunaiJungle?: boolean;
  interiorDense?: boolean;
  /** "No buildings are huts" (S69 SSR 1): wooden building clusters stay wooden buildings. */
  noHuts?: boolean;
  /** Bamboo counts as a jungle neighbour for `interiorDense` (S66 SSR 1: "bordered on all six hexsides by jungle or bamboo"). */
  interiorBamboo?: boolean;
  /** Paths by SSR: each list is a line of hexes a path runs through (S66 SSR 1: "along Hex Grain N2-U6"), hexside to hexside. */
  paths?: string[][];
  /** "Roads exist normally" (S70 SSR 1): roads, Woods-Roads and Orchard-Roads stay as printed (no paths). */
  roads?: boolean;
  /** "All single-hex buildings are huts" (S71 SSR 1): a building wholly within one hex is a hut too, wooden or stone. */
  singleHexHuts?: boolean;
}

/**
 * Assemble a scenario map from geomorphic boards. Terrain comes from the VASL
 * import; LOS is pixel-accurate against the VASL terrain rasters (or hex-level
 * when `los: 'grid'`).
 */
export function buildMap(
  placements: BoardPlacement[],
  opts: {
    los?: 'pixel' | 'grid';
    compass?: HexGridMapOptions['compass'];
    offboardTerrain?: boolean;
    /** SSR terrain that is another terrain in every respect: printed id → id, `bareOnly` for hexes with no other feature. */
    /** `elevation`: the redrawn hexes, and the printed art, are a hill of that level (LMA7 SSR 1: "the fields are in fact hills"). */
    /** `noHills`: the board plays flat (LMA4 SSR 1: "Hills do not exist"). */
    redraw?: { terrain?: Record<string, string>; bareOnly?: boolean; nonInherent?: boolean; elevation?: number; noHills?: boolean }[];
    /** SSR roads that are an Embankment Railroad instead: their road is gone, except where it meets `roads` that stay. */
    railroad?: { hexes: string[]; roads?: string[] }[];
    /** Hexes in which "no building exists" (S70 SSR 2's Cave hexes): their building is gone, Open Ground on their hill. */
    noBuilding?: string[];
    /** Hidden hexes (S70: the Connection Location; see `HexGridMapOptions.hiddenHexes`). */
    hiddenHexes?: HexGridMapOptions['hiddenHexes'];
    /** Hexes at another level by SSR (S66: the footbridge hex "one level lower"). */
    levels?: Record<string, number>;
    /** Entry edges inside the map (see `HexGridMapOptions.stagingEdges`). */
    stagingEdges?: HexGridMapOptions['stagingEdges'];
    /**
     * PTO Terrain is in effect (SK4 8.2): woods are jungle (Light when `light`), brush bamboo, orchards palm trees, grain
     * kunai, wooden buildings of two or more separate depictions huts; roads do not exist, Woods-Roads are paths.
     * `kunaiJungle`: "Kunai is jungle" (S65 SSR 1). `interiorDense`: "Interior jungle/ex-kunai hexes (hexes bordered on
     * all six hexsides by jungle/ex-kunai) are Dense jungle; all other jungle hexes are Light jungle" (S65 SSR 1), judged
     * on the printed boards, so a hex beside a hexrow the card cuts away still counts the jungle printed there.
     */
    pto?: boolean | PtoMapOptions;
  } = {},
): HexGridMap {
  const terrain: Record<string, HexTerrainSpec> = {};
  let roads: [string, string][] = [];
  for (const p of placements) {
    const b = BOARDS[p.board];
    if (!b) throw new Error(`Unknown board ${p.board}`);
    Object.assign(terrain, b.hexes);
    roads.push(...b.roadHexsides, ...cornerRoads(p.board));
    addBuildingLevels(terrain, p.board);
  }
  fillRoadHexes(terrain, roads);
  // PTO Terrain (SK4 8.2): the transform comes before any SSR redraw, so a card may redraw the jungle it produces.
  let paths: [string, string][] = [];
  if (opts.pto) {
    const o: PtoMapOptions = typeof opts.pto === 'object' ? opts.pto : {};
    const PTO: Record<string, string> = { woods: o.light ? 'jungle-light' : 'jungle', brush: 'bamboo', orchard: 'palm', grain: o.kunaiJungle ? 'jungle' : 'kunai' };
    const isWoodsRoad = (h: string) => !!terrain[h]?.features?.includes('woods-road');
    // Woods-Roads are paths: a road hexside into or out of one (SK4 8.2.1 Paths: Infantry enter a jungle hex along it for 1 MF).
    paths = o.roads ? [] : roads.filter(([a, b]) => isWoodsRoad(a) || isWoodsRoad(b));
    const hexesOfBuilding = new Map<string, number>();
    for (const spec of Object.values(terrain)) if (spec.buildingId) hexesOfBuilding.set(spec.buildingId, (hexesOfBuilding.get(spec.buildingId) ?? 0) + 1);
    const singleHex = (spec: HexTerrainSpec) => !!o.singleHexHuts && isBuildingTerrain(spec.terrain) && !!spec.buildingId && hexesOfBuilding.get(spec.buildingId) === 1;
    for (const [h, spec] of Object.entries(terrain)) {
      const hut = (!o.noHuts && spec.terrain === 'building-wood' && (spec.buildings ?? 0) >= 2 && !spec.partialBuilding) || singleHex(spec);
      const to = hut ? 'hut' : PTO[spec.terrain];
      const features = o.roads ? [...(spec.features ?? [])] : (spec.features ?? []).filter((f) => !f.startsWith('road:') && f !== 'orchard-road' && f !== 'woods-road');
      if (isWoodsRoad(h) && !o.roads) features.push('path');
      if (!to && features.length === (spec.features ?? []).length) continue;
      terrain[h] = { ...spec, ...(to ? { terrain: to } : {}), ...(features.length ? { features } : {}) };
      if (!features.length) delete terrain[h]!.features;
    }
    if (!o.roads) roads = [];
    for (const line of o.paths ?? []) for (let i = 1; i < line.length; i++) paths.push([line[i - 1]!, line[i]!]);
    if (o.interiorDense) {
      const grid = new HexGridMap({ boards: placements.map(({ board, x, y, rotation }) => ({ board, x, y, ...(rotation ? { rotation } : {}) })), terrain, losEffect: () => 'none' });
      const jungle = (h: string) => terrain[h]?.terrain === 'jungle' || terrain[h]?.terrain === 'jungle-light';
      const border = (h: string) => jungle(h) || (!!o.interiorBamboo && terrain[h]?.terrain === 'bamboo');
      const dense = new Set(Object.keys(terrain).filter((h) => jungle(h) && grid.hex(h) && grid.neighbors(h).length === 6 && grid.neighbors(h).every(border)));
      for (const h of Object.keys(terrain)) if (jungle(h)) terrain[h] = { ...terrain[h]!, terrain: dense.has(h) ? 'jungle' : 'jungle-light' };
    }
  }
  for (const [h, level] of Object.entries(opts.levels ?? {})) if (terrain[h]) terrain[h] = { ...terrain[h]!, elevation: level };
  for (const h of opts.noBuilding ?? []) {
    const spec = terrain[h];
    if (!spec) continue;
    const { buildingId: _b, buildings: _n, partialBuilding: _p, building: _l, ...rest } = spec;
    terrain[h] = { ...rest, terrain: 'open' };
  }
  // SSR "Hills do not exist": every hex is at ground level, and the LOS sees no higher ground (no elevation raster).
  const flat = (opts.redraw ?? []).some((r) => r.noHills);
  if (flat) for (const [h, spec] of Object.entries(terrain)) if (spec.elevation) terrain[h] = { ...spec, elevation: 0 };
  for (const r of opts.redraw ?? []) {
    for (const [h, spec] of Object.entries(terrain)) {
      const to = r.terrain?.[spec.terrain];
      if (!to || (r.bareOnly && spec.features?.length)) continue;
      // A building redrawn as something else (rubble) loses its levels with it (ASLRB B24.1).
      const { building: _levels, obstacleHeight: _height, ...kept } = spec;
      terrain[h] = {
        ...(isBuildingTerrain(to) ? spec : kept),
        terrain: to,
        ...(r.nonInherent ? { features: [...(spec.features ?? []), NON_INHERENT] } : {}),
        ...(r.elevation !== undefined ? { elevation: Math.max(spec.elevation ?? 0, r.elevation) } : {}),
      };
    }
  }
  // Terrain that blocks a road (rubble, ASLRB B24.4) takes the road out of its hex: no road feature, no road hexsides.
  const roadless = new Set(Object.keys(terrain).filter((h) => SK4_TERRAIN[terrain[h]!.terrain]?.blocksRoad));
  for (const h of roadless) {
    const spec = terrain[h]!;
    if (spec.features?.length) terrain[h] = { ...spec, features: spec.features.filter((f) => !hasRoad({ terrain: spec.terrain, features: [f] })) };
  }
  let openRoads = roadless.size ? roads.filter(([a, b]) => !roadless.has(a) && !roadless.has(b)) : roads;
  // An Embankment Railroad (SSR) is no road: its road hexsides go, but not those of a road that stays (both hexes
  // in `roads`); a hex left with no road hexside loses its road, unless it is one of `roads`.
  for (const rr of opts.railroad ?? []) {
    const rail = new Set(rr.hexes);
    const keep = new Set(rr.roads ?? []);
    const dropped = openRoads.filter(([a, b]) => (rail.has(a) || rail.has(b)) && !(keep.has(a) && keep.has(b)));
    openRoads = openRoads.filter((x) => !dropped.includes(x));
    const touched = new Set(dropped.flat());
    for (const h of touched) {
      const spec = terrain[h];
      if (!spec?.features?.length || keep.has(h) || openRoads.some(([a, b]) => a === h || b === h)) continue;
      terrain[h] = { ...spec, features: spec.features.filter((f) => !hasRoad({ terrain: spec.terrain, features: [f] })) };
    }
  }
  // A non-inherent redraw: the printed art hinders as the new terrain where the thread crosses it, and nowhere else.
  const hinderingArt = Object.assign({}, ...(opts.redraw ?? []).filter((r) => r.nonInherent).map((r) => r.terrain ?? {})) as Record<string, string>;
  const raisedArt: Record<string, number> = {};
  for (const r of opts.redraw ?? []) if (r.elevation !== undefined) for (const printed of Object.keys(r.terrain ?? {})) raisedArt[printed] = r.elevation;
  const inherentObstacle = (h: MapHex) => SK4_TERRAIN[h.terrain]?.los === 'obstacle' && !!SK4_TERRAIN[h.terrain]?.inherent;
  // Inherent Hindrances (orchard, palm trees) hinder whenever the thread enters the hex; a hut only across its art.
  const inherentHindrance = (h: MapHex) => SK4_TERRAIN[h.terrain]?.los === 'hindrance' && !!SK4_TERRAIN[h.terrain]?.inherent && !h.features.includes(NON_INHERENT);
  const artHindrance = (h: MapHex) => !!SK4_TERRAIN[h.terrain]?.artHindrance;
  const obstacleBetweenLevels = (h: MapHex) => !!SK4_TERRAIN[h.terrain]?.obstacleBetweenLevels;
  const pixel =
    opts.los !== 'grid'
      ? pixelTracers(
          placements.map((p) => ({ raster: flat ? flatRaster(p.board) : raster(p.board), x: p.x, y: p.y, ...(p.rotation ? { rotation: p.rotation } : {}) })),
          {
            hinderingArt,
            inherentObstacle,
            inherentHindrance,
            artHindrance,
            obstacleBetweenLevels,
            ...(Object.keys(raisedArt).length ? { raisedArt } : {}),
            heightOf: (h) => h.obstacleHeight ?? SK4_TERRAIN[h.terrain]?.height ?? 1,
            // PTO: brush art is bamboo (an obstacle), grain art is kunai.
            // "Kunai is jungle" (S65 SSR 1): grain art blocks as jungle does.
            ...(opts.pto ? (typeof opts.pto === 'object' && opts.pto.kunaiJungle ? { obstacleArt: ['brush', 'grain'] } : { obstacleArt: ['brush'], artAs: { grain: 'kunai' } }) : {}),
          },
        )
      : undefined;
  return new HexGridMap({
    boards: placements,
    terrain,
    roadHexsides: openRoads,
    ...(paths.length ? { pathHexsides: paths } : {}),
    losEffect: (t) => SK4_TERRAIN[t]?.los ?? 'none',
    inherent: (t, h) => !!SK4_TERRAIN[t]?.inherent && !h?.features.includes(NON_INHERENT),
    height: (t) => SK4_TERRAIN[t]?.height,
    ...(pixel ? { los: pixel.los, losAt: pixel.losAt, bypassSides: pixel.bypassSides } : {}),
    ...(opts.compass ? { compass: opts.compass } : {}),
    ...(opts.offboardTerrain ? { offboardTerrain: true } : {}),
    ...(opts.stagingEdges?.length ? { stagingEdges: opts.stagingEdges } : {}),
    ...(opts.hiddenHexes?.length ? { hiddenHexes: opts.hiddenHexes } : {}),
  });
}
