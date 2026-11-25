import type { Action, Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, isPersonnelDef, isVehicleDef, otherSide, statics, swHeldBy, unitsAt } from '../common/pieces';
import { acrossSide, cornerHexes, mod6 } from '../common/hexCorners';
import { hexOfLoc, locId, locOf, locationsOf, parseLoc, type LocId } from '../common/location';
import { hasLos } from '../sk1/known';
import { SETUP_DECISION, SETUP_PLACED, type SetupAction, type SetupPlacedFn } from '../sk1/scenario';
import { gun, isGoodOrder, mmc, smc, squadEquivalents } from '../sk1/status';
import { hasFeature, terrainOf } from '../sk1/terrain';
import { T2 } from '../sk2/status';
import { interiorBuildingHex } from './levels';
import { isRubbled } from './rubble';

/*
 * Fortification counters at setup (ASLRB A12.33, B26.1, B27.1, B27.12, B27.51, B27.56, B28.1, B28.45–B28.48, B28.5,
 * B28.53, B29.1, B30.1, B30.111, B30.12; full ASL only). A scenario that lists the `fortifications` special rule gives
 * one side Wire, foxholes (by squad capacity), trenches (as trenches or as an A-T Ditch), minefield factors (hidden,
 * Known, Dummy, A-T), roadblocks and pillboxes. That side places them as part of its setup, before or among its
 * units (`fort.place`, answered in its `setup` decision; one placement per side), openly or hidden: every counter
 * may set up hidden (A12.33: "may always"), a minefield is always recorded (B28.1) except A-T mines in full view on
 * a paved road (B28.53), and a Known or Dummy minefield is always on the board (B28.45, B28.47).
 *
 * A hidden counter stays off the other side's board until a Good Order enemy ground unit has a LOS to its Location
 * within 16 hexes (at any range in non-Concealment Terrain), a hidden unit in its hex is revealed, or (later steps)
 * its TEM is claimed; minefields are revealed only by their own rules (B28.1: an attack, Searching). The record is a
 * secret `ext` slice with a redactor, so online each seat receives only what it may see; a hotseat screen hides it
 * through `fortificationView(env, null)`.
 *
 * Units set up beneath a foxhole, trench or Wire counter (`SetupAction.beneath`) or inside a pillbox (a placement at
 * the `:pb` Location) are checked against the counter's capacity (B27.12, B27.51, B30.111) here; what the counters
 * do in play (entrenchment TEM, Wire entry, mine attacks, pillbox fire) is left to their own rules.
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether the pillbox of `hex` holds units `viewer` may not inspect (B30.7; `asl/pillboxes.ts`): shown as occupied. */
    'pillbox.occupiedUnseen': { ctx: { hex: HexId; viewer: SideId | null }; value: boolean };
  }
}

export const FORTIFICATIONS_MODULE = 'fortifications';
export const FORT_EXT = 'asl.fortifications';

export type FortKind = 'foxhole' | 'trench' | 'ditch' | 'wire' | 'roadblock' | 'pillbox' | 'mines';

export interface PillboxFactors {
  /** Squad-equivalents it holds (B30.111). */
  capacity: 1 | 2 | 3;
  /** The CA Defense Modification (B30.112). */
  ca: 3 | 4 | 5;
  /** The NCA Defense Modification (B30.113). */
  nca: 5 | 6 | 7;
}

export interface MineFactors {
  /** A-P strength: 6, 8 or 12 factors (B28.1). */
  ap?: 6 | 8 | 12;
  /** A-T factors, 1–5 (B28.5), alone or with an A-P strength. */
  at?: 1 | 2 | 3 | 4 | 5;
  /** A Known Minefield counter, on the board from the start with its strength down (B28.45). */
  known?: true;
  /** A Dummy Minefield: a Known Minefield counter with nothing under it (B28.47). */
  dummy?: true;
  /** The strength has been shown to the other side (B28.41). */
  strengthRevealed?: true;
  /** An unmined hex of a Known belt found by a ground unit: marked with a Dummy counter for everyone (B28.47 EXC). */
  found?: true;
}

/** One counter as placed: what the owner chose. `hex` is the ground Location of its hex. */
export interface FortPlacement {
  kind: FortKind;
  hex: HexId;
  /** Placed hidden (A12.33). A minefield is always recorded; a Known or Dummy minefield never. */
  hidden: boolean;
  /** A foxhole's 1S/2S/3S size (B27.1); a trench or A-T Ditch holds three squads (B27.51). */
  capacity?: 1 | 2 | 3;
  /** A roadblock's hexside (B29.1), numbered as `sideToward` does (0 south-east, clockwise). */
  hexside?: number;
  /** A pillbox's Covered Arc: the hexspine its arrow points at (B30.1, C3.2), 0 east, clockwise. */
  ca?: number;
  pillbox?: PillboxFactors;
  mines?: MineFactors;
  /** The Known minefield belt (B28.46) this hex belongs to. */
  belt?: string;
}

export interface FortRecord extends FortPlacement {
  /** `<side>.fort<n>`: names the owner, never the hex. */
  id: string;
  side: SideId;
  /** Shown to the other side (A12.33; never cleared, A12.31). A minefield: its presence. */
  revealed?: true;
  /** A pillbox from within which an attack has been made or SMOKE placed: its contents are Known (B30.7); for the game. */
  known?: true;
  /** View only: a pillbox whose contents the viewer may not inspect holds units (B30.7). Never in the state itself. */
  occupied?: true;
}

/**
 * A multi-hex Known minefield (B28.46): two arrowed Known counters along a Hex Grain, or an Alternate Hex Grain whose left
 * or right zigzag the owner declares (A9.221), marking every hex between them inclusive. Public: the arrows are on the board.
 */
export interface MineBelt {
  id: string;
  from: HexId;
  to: HexId;
  grain: 'hex' | 'alt-left' | 'alt-right';
}

export interface FortState {
  counters: FortRecord[];
  /** Known minefield belts (B28.46). */
  belts?: (MineBelt & { side: SideId })[];
  /** Dummy Minefield counters a side gained on its Secret dr (B28.47), beyond the special rule's allotment. */
  extraDummies?: Record<SideId, number>;
}

export interface FortificationsParams {
  side: SideId;
  /** Foxholes, as their total squad capacity (B27.1): any mix of 1S, 2S and 3S counters. */
  foxholes?: number;
  trenches?: number;
  /** Trench counters placed as an A-T Ditch (B27.56). */
  ditch?: number;
  wire?: number;
  roadblocks?: number;
  pillboxes?: PillboxFactors[];
  mines?: {
    /** Hidden A-P minefield factors (B28.1), each minefield 6, 8 or 12 of them. */
    factors?: number;
    /** Known minefield factors (B28.45), A-P only. */
    known?: number;
    /** Dummy Minefield counters allotted (B28.47). */
    dummies?: number;
    /** The hidden factors may be exchanged for A-T mines, three per A-T factor (B28.5). */
    at?: boolean;
  };
  /** Where the counters may go: the side's setup area (default), or these hexes. */
  within?: 'setup' | HexId[];
  /** The card's name for the rule, e.g. 'SSR 3'. */
  rule?: string;
}

export type FortPlaceAction = Action & { counters: FortPlacement[]; belts?: MineBelt[] };

export function fortificationsParams(env: QueryEnv, side?: SideId): FortificationsParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === FORTIFICATIONS_MODULE && (!side || (r.params as unknown as FortificationsParams).side === side));
  return s ? (s.params as unknown as FortificationsParams) : null;
}

export const fortState = (env: QueryEnv): FortState | null => (env.state.ext[FORT_EXT] as FortState | undefined) ?? null;

/** Every counter on the board (the owner's view). */
export const fortCounters = (env: QueryEnv): FortRecord[] => fortState(env)?.counters ?? [];

/** The counters in a hex, as the owner knows them. */
export const fortificationsAt = (env: QueryEnv, hex: HexId): FortRecord[] => fortCounters(env).filter((c) => c.hex === hex);

export const pillboxAt = (env: QueryEnv, hex: HexId): FortRecord | null => fortificationsAt(env, hex).find((c) => c.kind === 'pillbox') ?? null;
export const minefieldAt = (env: QueryEnv, hex: HexId): FortRecord | null => fortificationsAt(env, hex).find((c) => c.kind === 'mines') ?? null;
/** The foxhole, trench or A-T Ditch in a hex (one at most, B27.12, B27.51). */
export const entrenchmentAt = (env: QueryEnv, hex: HexId): FortRecord | null => fortificationsAt(env, hex).find((c) => c.kind === 'foxhole' || c.kind === 'trench' || c.kind === 'ditch') ?? null;
export const wireAt = (env: QueryEnv, hex: HexId): FortRecord | null => fortificationsAt(env, hex).find((c) => c.kind === 'wire') ?? null;
export const roadblocks = (env: QueryEnv): FortRecord[] => fortCounters(env).filter((c) => c.kind === 'roadblock');

/** Whether a counter of `kind` in `hex` is still hidden from the other side (A12.33: entering one costs nothing). */
export const fortHiddenAt = (env: QueryEnv, hex: HexId, kind?: FortKind): boolean =>
  fortificationsAt(env, hex).some((c) => c.hidden && !c.revealed && (!kind || c.kind === kind));

/** A "gray" pillbox, the 5+7 counters (B30.92: only a ≥ 100mm Indirect Fire CH eliminates it; C1.822). */
export const pillboxGray = (f: PillboxFactors): boolean => f.ca === 5 && f.nca === 7;

/** The pillbox Location of a hex. */
export const pillboxLoc = (hex: HexId): LocId => locId(hex, 0, 'pb');
export const isPillboxLoc = (loc: LocId) => parseLoc(loc).sub === 'pb';

/** A counter as `viewer` may see it: the owner everything; anyone else only what is open or revealed, a minefield's strength only once shown, a hidden pillbox's arc never. */
export function shownCounter(c: FortRecord, viewer: SideId | null): FortRecord | null {
  if (viewer === c.side) return c;
  if (c.hidden && !c.revealed) return null;
  if (c.kind !== 'mines') return c;
  const m = c.mines ?? {};
  // An unmined belt hex once found is a Dummy counter for everyone (B28.47 EXC).
  if (m.found) return { ...c, mines: { known: true, dummy: true, found: true } };
  // A Known (or Dummy) minefield on the board, or a hidden one whose presence came out: the counter with no strength
  // on it until the strength is revealed (B28.45, B28.48); a Dummy looks exactly like a Known minefield (B28.47).
  const mines: MineFactors = m.strengthRevealed ? { ...m, dummy: undefined } : {};
  if (m.known) mines.known = true;
  if (m.strengthRevealed) mines.strengthRevealed = true;
  return { ...c, mines: Object.fromEntries(Object.entries(mines).filter(([, v]) => v !== undefined)) as MineFactors };
}

/** The counters a viewer may see (a `null` viewer, a hotseat screen or a spectator, sees only what is open or revealed). */
export const fortificationView = (env: QueryEnv, viewer: SideId | null): FortRecord[] =>
  fortCounters(env)
    .map((c) => shownCounter(c, viewer))
    .filter((c): c is FortRecord => !!c);

// ---------------------------------------------------------------- Known minefield belts (B28.46)

/**
 * The hexes of a belt from `from` to `to`, both inclusive, or null when they are not on one Hex Grain (or, for an
 * Alternate Hex Grain, on one zigzag: A9.221's alternating pair of hexsides, `alt-left` starting with the counterclockwise
 * one as seen from `from`).
 */
export function beltHexes(env: QueryEnv, b: Pick<MineBelt, 'from' | 'to' | 'grain'>): HexId[] | null {
  const map = statics(env).map;
  if (!map.hex(b.from) || !map.hex(b.to) || b.from === b.to) return null;
  const limit = map.distance(b.from, b.to) * 2 + 2;
  for (let k = 0; k < 6; k++) {
    const sides = b.grain === 'hex' ? [k] : b.grain === 'alt-left' ? [k, k + 1] : [k + 1, k];
    const path: HexId[] = [b.from];
    let at: HexId | undefined = b.from;
    for (let i = 0; at && at !== b.to && i < limit; i++) {
      at = acrossSide(map, at, mod6(sides[i % sides.length]!));
      if (at && map.hex(at)) path.push(at);
      else at = undefined;
    }
    if (at === b.to) return path;
  }
  return null;
}

/** Why a side's belts are illegal with its counters (B28.46), or null. */
export function beltsIllegal(env: QueryEnv, counters: FortPlacement[], belts: MineBelt[]): string | null {
  const ids = new Set<string>();
  for (const b of belts) {
    if (!b.id || ids.has(b.id)) return 'Each Known minefield belt needs its own name';
    ids.add(b.id);
    const path = beltHexes(env, b);
    if (!path) return `${b.from} and ${b.to} are not along one ${b.grain === 'hex' ? 'Hex Grain' : 'Alternate Hex Grain'} (ASLRB B28.46)`;
    for (const h of path) {
      const here = counters.filter((c) => c.kind === 'mines' && c.hex === h);
      // B28.46: every hex between and inclusive is a Known minefield, with only one A-P/A-T minefield however many belts cross it.
      if (!here.length) return `${h} lies on the belt ${b.from}–${b.to}: record its mines (or none) there (ASLRB B28.46)`;
      if (here.some((c) => !c.mines?.known)) return `${h} lies on a Known minefield belt: its mines are Known (ASLRB B28.46)`;
    }
  }
  for (const c of counters) {
    if (!c.belt) continue;
    const b = belts.find((x) => x.id === c.belt);
    if (!b || !(beltHexes(env, b) ?? []).includes(c.hex)) return `${c.hex} is not on the belt ${c.belt}`;
  }
  return null;
}

// ---------------------------------------------------------------- where a counter may go

/** Concealment Terrain for A12.33 (the Terrain Chart's red terrain): woods, brush, orchard, grain, buildings, rubble, shellholes; never Open Ground or a road alone. */
export function concealmentTerrainAt(env: QueryEnv, hex: HexId): boolean {
  const t = terrainOf(env, hex);
  if (t.concealment) return true;
  return ['woods', 'brush', 'orchard', 'grain', 'shellholes'].includes(t.id) || t.id.startsWith('building') || t.id.startsWith('rubble');
}

const isBuildingHex = (env: QueryEnv, hex: HexId) => !!statics(env).map.hex(hex)?.buildingId || terrainOf(env, hex).id.startsWith('building');
const pavedRoad = (env: QueryEnv, hex: HexId) => hasFeature(env, hex, 'road:paved');
const anyRoad = (env: QueryEnv, hex: HexId) => (statics(env).map.hex(hex)?.features ?? []).some((f) => f.startsWith('road:'));
/** Terrain that takes no entrenchment, Wire or pillbox on any board (B26.1, B27.1, B28.1, B30.1): none of it is on boards t–z. */
const waterLike = (env: QueryEnv, hex: HexId) => /marsh|water|stream|crag|bridge|runway|sewer/.test(terrainOf(env, hex).id);

/** The hexes the special rule lets `side` place counters in: the card's list, else the side's at-start setup area. */
export function fortArea(env: QueryEnv, side: SideId): HexId[] {
  const p = fortificationsParams(env, side);
  const map = statics(env).map;
  if (p && Array.isArray(p.within)) return p.within.filter((h) => !!map.hex(h));
  const area = new Set<HexId>();
  for (const f of statics(env).scenario.forces) {
    if (f.side !== side || f.setup.kind === 'enter' || f.setup.kind === 'scatter') continue;
    for (const h of f.setup.hexes) if (map.hex(h)) area.add(h);
  }
  return [...area].sort();
}

const KIND_NAME: Record<FortKind, string> = { foxhole: 'foxhole', trench: 'trench', ditch: 'A-T Ditch', wire: 'Wire', roadblock: 'roadblock', pillbox: 'pillbox', mines: 'minefield' };
export const fortKindName = (c: Pick<FortPlacement, 'kind' | 'capacity' | 'pillbox' | 'mines'>): string => {
  if (c.kind === 'foxhole') return `foxhole ${c.capacity ?? 1}S`;
  if (c.kind === 'pillbox' && c.pillbox) return `pillbox ${c.pillbox.capacity}+${c.pillbox.ca}+${c.pillbox.nca}`;
  if (c.kind === 'mines' && c.mines) {
    if (c.mines.dummy) return 'Dummy minefield';
    const s = [c.mines.ap ? `A-P ${c.mines.ap}` : '', c.mines.at ? `A-T ${c.mines.at}` : ''].filter(Boolean).join(' + ');
    // Without a strength (the other side's view of a Known or Dummy counter, a revealed presence) it is just a minefield
    // (B28.45, B28.47: the Known and Dummy faces are alike until the strength is shown).
    return s ? `${c.mines.known ? 'Known ' : ''}minefield (${s})` : 'minefield';
  }
  return KIND_NAME[c.kind];
};

/** Why one counter may not go where it is, on its own terms (terrain, hexside, arc, strength), or null. */
export function counterTerrainIllegal(env: QueryEnv, c: FortPlacement): string | null {
  const map = statics(env).map;
  const hex = c.hex;
  if (!map.hex(hex)) return `${hex} is not on the map`;
  const building = isBuildingHex(env, hex);
  const rubble = isRubbled(env, hex) || terrainOf(env, hex).id.startsWith('rubble');
  // "The only Fortification allowed in a building hex is a minefield or the fortification of the building itself" (B23.5).
  if (building && c.kind !== 'mines') return `${hex} is a building hex: only a minefield may go there (ASLRB B23.5)`;
  switch (c.kind) {
    case 'wire':
      if (rubble || waterLike(env, hex)) return `Wire cannot be set up in ${hex} (ASLRB B26.1)`;
      return null;
    case 'foxhole':
    case 'trench':
    case 'ditch':
      if (c.kind === 'foxhole' && !c.capacity) return 'A foxhole is a 1S, 2S or 3S counter (ASLRB B27.1)';
      if (pavedRoad(env, hex)) return `${hex} is a paved road hex: no ${KIND_NAME[c.kind]} (ASLRB B27.1, B3.5)`;
      if (rubble || waterLike(env, hex)) return `A ${KIND_NAME[c.kind]} cannot be placed in ${hex} (ASLRB B27.1)`;
      return null;
    case 'mines': {
      const m = c.mines;
      if (!m) return 'A minefield needs its factors';
      if (m.dummy) {
        if (m.ap || m.at) return 'A Dummy minefield has no factors (ASLRB B28.47)';
      } else {
        if (m.ap !== undefined && ![6, 8, 12].includes(m.ap)) return 'An A-P minefield is 6, 8 or 12 factors (ASLRB B28.1)';
        if (m.at !== undefined && (m.at < 1 || m.at > 5)) return 'A-T mines are one to five factors per hex (ASLRB B28.5)';
        if (m.ap === undefined && m.at === undefined) return 'A minefield needs its factors';
        if (m.known && m.at) return 'Known minefield factors cannot be exchanged for A-T mines (ASLRB B28.45)';
      }
      if (interiorBuildingHex(env, hex)) return `${hex} is an Interior Building Hex: no minefield (ASLRB B28.1)`;
      if (rubble || waterLike(env, hex)) return `A minefield cannot be placed in ${hex} (ASLRB B28.1)`;
      // A-P mines never on a paved road; A-T mines may, but in full view (B28.53).
      if (pavedRoad(env, hex)) {
        if (m.ap !== undefined || m.dummy || m.known || m.at === undefined) return `${hex} is a paved road hex: no minefield (ASLRB B28.1, B3.5)`;
        if (c.hidden) return `A-T mines on a paved road are placed in full view (ASLRB B28.53)`;
      }
      return null;
    }
    case 'roadblock': {
      if (!anyRoad(env, hex)) return `${hex} is not a road hex: a roadblock goes only in a road Location (ASLRB B29.1)`;
      if (c.hexside === undefined) return 'A roadblock needs the road hexside it obstructs (ASLRB B29.1)';
      const across = acrossSide(map, hex, c.hexside);
      if (!across || !map.roadHexside?.(hex, across)) return `No road crosses that hexside of ${hex} (ASLRB B29.1)`;
      return null;
    }
    case 'pillbox': {
      if (!c.pillbox) return 'A pillbox needs its strength factors (ASLRB B30.11)';
      // The counters pair the CA and NCA Defense Modifications as 3+5, 4+6 and 5+7 (B30.11; the 5+7 ones are "gray", B30.92).
      if (c.pillbox.nca !== c.pillbox.ca + 2) return `No pillbox counter is ${c.pillbox.capacity}+${c.pillbox.ca}+${c.pillbox.nca}: its NCA Defense Modification is its CA one plus two (ASLRB B30.11)`;
      if (c.ca === undefined || c.ca < 0 || c.ca > 5) return 'A pillbox needs a Covered Arc: a hexspine (ASLRB B30.1)';
      const t = terrainOf(env, hex).id;
      if (rubble || !['open', 'brush', 'orchard', 'grain', 'woods', 'shellholes'].includes(t)) return `A pillbox goes only in Open Ground, brush, orchard, grain or woods (ASLRB B30.1): not in ${hex}`;
      return null;
    }
  }
}

/** Why a counter may not be hidden or open as placed, or null (A12.33, B28.1, B28.45, B28.47, B28.53). */
export function hipIllegal(env: QueryEnv, c: FortPlacement): string | null {
  if (c.kind !== 'mines') return null;
  const m = c.mines ?? {};
  if ((m.known || m.dummy) && c.hidden) return 'A Known or Dummy minefield is placed on the board (ASLRB B28.45, B28.47)';
  if (!m.known && !m.dummy && !c.hidden && !(m.at !== undefined && m.ap === undefined && pavedRoad(env, c.hex))) return 'A minefield is recorded, not placed (ASLRB B28.1)';
  return null;
}

/**
 * The Dummy Minefield counters a side may set up (B28.47): those the scenario allots or, when it allots none, one for
 * every 24 Known minefield factors set up (at no cost).
 */
function dummyAllotment(allotted: number, placed: FortPlacement[]): number {
  if (allotted > 0) return allotted;
  const known = placed.reduce((n, c) => n + (c.kind === 'mines' && c.mines?.known && !c.mines.dummy ? (c.mines.ap ?? 0) : 0), 0);
  return Math.floor(known / 24);
}

/** What a side has left to place, given the counters placed so far. */
export function fortPools(env: QueryEnv, side: SideId, placed: FortPlacement[]) {
  const p = fortificationsParams(env, side);
  const extra = fortState(env)?.extraDummies?.[side] ?? 0;
  const sum = (f: (c: FortPlacement) => number) => placed.reduce((n, c) => n + f(c), 0);
  const pill = p?.pillboxes ?? [];
  const pillKey = (x: PillboxFactors) => `${x.capacity}+${x.ca}+${x.nca}`;
  const pillLeft = pill.filter((x) => {
    const n = pill.filter((y) => pillKey(y) === pillKey(x)).length;
    const used = placed.filter((c) => c.kind === 'pillbox' && c.pillbox && pillKey(c.pillbox) === pillKey(x)).length;
    return used < n;
  });
  return {
    foxholes: (p?.foxholes ?? 0) - sum((c) => (c.kind === 'foxhole' ? (c.capacity ?? 1) : 0)),
    trenches: (p?.trenches ?? 0) - sum((c) => (c.kind === 'trench' ? 1 : 0)),
    ditch: (p?.ditch ?? 0) - sum((c) => (c.kind === 'ditch' ? 1 : 0)),
    wire: (p?.wire ?? 0) - sum((c) => (c.kind === 'wire' ? 1 : 0)),
    roadblocks: (p?.roadblocks ?? 0) - sum((c) => (c.kind === 'roadblock' ? 1 : 0)),
    pillboxes: pillLeft,
    /** Hidden A-P factors left; A-T mines cost three each (B28.5). */
    factors: (p?.mines?.factors ?? 0) - sum((c) => (c.kind === 'mines' && c.mines && !c.mines.known && !c.mines.dummy ? (c.mines.ap ?? 0) + 3 * (c.mines.at ?? 0) : 0)),
    known: (p?.mines?.known ?? 0) - sum((c) => (c.kind === 'mines' && c.mines?.known && !c.mines.dummy ? (c.mines.ap ?? 0) : 0)),
    // An unmined hex of a belt is no Dummy counter (B28.46, B28.47 EXC: one is put there only once it is found).
    dummies: dummyAllotment(p?.mines?.dummies ?? 0, placed) + extra - sum((c) => (c.kind === 'mines' && c.mines?.dummy && !c.belt ? 1 : 0)),
    at: !!p?.mines?.at,
  };
}

/** Why a side's whole placement is illegal, or null: each counter's terrain and status, one per hex and the exclusions, the pools, the area. */
export function fortPlaceIllegal(env: QueryEnv, side: SideId, counters: FortPlacement[], belts: MineBelt[] = []): string | null {
  const p = fortificationsParams(env, side);
  if (!p) return 'This side has no fortification counters to place';
  if (fortCounters(env).some((c) => c.side === side)) return 'The fortifications are already placed';
  const area = new Set(fortArea(env, side));
  for (const c of counters) {
    if (!area.has(c.hex)) return `${c.hex} is outside the area the ${p.rule ?? 'special rule'} allows`;
    const why = counterTerrainIllegal(env, c) ?? hipIllegal(env, c);
    if (why) return why;
    const here = counters.filter((x) => x.hex === c.hex && x !== c);
    const ent = (k: FortKind) => k === 'foxhole' || k === 'trench' || k === 'ditch';
    if (c.kind === 'wire' && here.some((x) => x.kind === 'wire')) return `Only one Wire counter per Location (${c.hex}; ASLRB B26.1)`;
    if (c.kind === 'foxhole' && here.some((x) => x.kind === 'foxhole')) return `One foxhole counter per hex (${c.hex}; ASLRB B27.12)`;
    if ((c.kind === 'trench' || c.kind === 'ditch') && here.some((x) => x.kind === 'trench' || x.kind === 'ditch')) return `One trench counter per hex (${c.hex}; ASLRB B27.51)`;
    if (ent(c.kind) && here.some((x) => ent(x.kind) && x.kind !== c.kind && (c.kind === 'foxhole' || x.kind === 'foxhole'))) return `A trench may not share a Location with a foxhole (${c.hex}; ASLRB B27.51)`;
    if (c.kind === 'mines' && here.some((x) => x.kind === 'mines')) return `One minefield per hex (${c.hex}; ASLRB B28.1, B28.5, B28.46)`;
    // One roadblock per hexside (B29.2: a wall across it), whichever of its two hexes it is set up in, and whichever side placed it.
    if (c.kind === 'roadblock' && c.hexside !== undefined) {
      const across = acrossSide(statics(env).map, c.hex, c.hexside);
      const same = (x: Pick<FortPlacement, 'kind' | 'hex' | 'hexside'>) =>
        x.kind === 'roadblock' && x.hexside !== undefined && ((x.hex === c.hex && x.hexside === c.hexside) || (x.hex === across && mod6(x.hexside + 3) === c.hexside));
      if (counters.some((x) => x !== c && same(x)) || fortCounters(env).some(same)) return `One roadblock per hexside (${c.hex}${across ? `-${across}` : ''}; ASLRB B29.1, B29.2)`;
    }
    // A pillbox may share its hex with a foxhole, trench or A-T Ditch (B30.8: "A Pillbox counter in the same hex with a
    // trench ... is considered a bunker"; B27.1 does not list a pillbox hex among the terrain a foxhole may not occupy).
    if (c.kind === 'pillbox' && here.some((x) => x.kind === 'pillbox')) return `A pillbox may not be placed in the same hex as another pillbox (${c.hex}; ASLRB B30.1)`;
  }
  if (belts.length || counters.some((c) => c.belt)) {
    if (!p.mines?.known) return 'No Known minefield factors to lay a belt with (ASLRB B28.46)';
    const why = beltsIllegal(env, counters, belts);
    if (why) return why;
  }
  const left = fortPools(env, side, counters);
  if (left.foxholes < 0) return `Only ${p.foxholes ?? 0} squad${(p.foxholes ?? 0) === 1 ? '' : 's'} of foxhole capacity (ASLRB B27.1)`;
  if (left.trenches < 0) return `Only ${p.trenches ?? 0} trench counter${(p.trenches ?? 0) === 1 ? '' : 's'}`;
  if (left.ditch < 0) return `Only ${p.ditch ?? 0} A-T Ditch counter${(p.ditch ?? 0) === 1 ? '' : 's'}`;
  if (left.wire < 0) return `Only ${p.wire ?? 0} Wire counter${(p.wire ?? 0) === 1 ? '' : 's'} (ASLRB B26.1)`;
  if (left.roadblocks < 0) return `Only ${p.roadblocks ?? 0} roadblock${(p.roadblocks ?? 0) === 1 ? '' : 's'}`;
  for (const c of counters) {
    if (c.kind !== 'pillbox' || !c.pillbox) continue;
    const key = `${c.pillbox.capacity}+${c.pillbox.ca}+${c.pillbox.nca}`;
    const n = (p.pillboxes ?? []).filter((x) => `${x.capacity}+${x.ca}+${x.nca}` === key).length;
    if (counters.filter((x) => x.kind === 'pillbox' && x.pillbox && `${x.pillbox.capacity}+${x.pillbox.ca}+${x.pillbox.nca}` === key).length > n) return n ? `Only ${n} pillbox ${key}` : `No pillbox ${key} in the order of battle`;
  }
  if (left.factors < 0) return `Only ${p.mines?.factors ?? 0} minefield factors${p.mines?.at ? ' (an A-T factor costs three, ASLRB B28.5)' : ''}`;
  if (!left.at && counters.some((c) => c.kind === 'mines' && c.mines?.at)) return `No A-T mines in the order of battle (ASLRB B28.5)`;
  if (left.known < 0) return `Only ${p.mines?.known ?? 0} Known minefield factors (ASLRB B28.45)`;
  if (left.dummies < 0) {
    const n = dummyAllotment(p.mines?.dummies ?? 0, counters) + (fortState(env)?.extraDummies?.[side] ?? 0);
    return `Only ${n} Dummy Minefield counter${n === 1 ? '' : 's'}${p.mines?.dummies ? '' : ': one for every 24 Known minefield factors set up'} (ASLRB B28.47)`;
  }
  return null;
}

/** The engine's own placement (tests, auto-placement): each pool in the first legal hexes of the area, hidden wherever the rule allows, the hidden factors in as few minefields as possible. */
export function defaultFortPlacement(env: QueryEnv, side: SideId): FortPlacement[] {
  const p = fortificationsParams(env, side);
  if (!p) return [];
  const out: FortPlacement[] = [];
  const area = fortArea(env, side);
  const map = statics(env).map;
  const ok = (c: FortPlacement) => !counterTerrainIllegal(env, c) && !hipIllegal(env, c) && !fortPlaceIllegal(env, side, [...out, c]);
  const put = (make: (hex: HexId) => FortPlacement): boolean => {
    for (const hex of area) {
      const c = make(hex);
      if (ok(c)) {
        out.push(c);
        return true;
      }
    }
    return false;
  };
  for (let n = p.foxholes ?? 0; n > 0; ) {
    const cap = Math.min(3, n) as 1 | 2 | 3;
    if (!put((hex) => ({ kind: 'foxhole', hex, hidden: true, capacity: cap }))) break;
    n -= cap;
  }
  for (let i = 0; i < (p.trenches ?? 0); i++) if (!put((hex) => ({ kind: 'trench', hex, hidden: true, capacity: 3 }))) break;
  for (let i = 0; i < (p.ditch ?? 0); i++) if (!put((hex) => ({ kind: 'ditch', hex, hidden: true, capacity: 3 }))) break;
  for (let i = 0; i < (p.wire ?? 0); i++) if (!put((hex) => ({ kind: 'wire', hex, hidden: true }))) break;
  for (let i = 0; i < (p.roadblocks ?? 0); i++) {
    let done = false;
    for (const hex of area) {
      for (let k = 0; k < 6 && !done; k++) {
        const c: FortPlacement = { kind: 'roadblock', hex, hidden: true, hexside: k };
        if (ok(c)) {
          out.push(c);
          done = true;
        }
      }
      if (done) break;
    }
    if (!done) break;
  }
  for (const pb of p.pillboxes ?? []) if (!put((hex) => ({ kind: 'pillbox', hex, hidden: true, ca: 0, pillbox: pb }))) break;
  for (let n = p.mines?.factors ?? 0; n >= 6; ) {
    const ap = (n >= 12 ? 12 : n >= 8 ? 8 : 6) as 6 | 8 | 12;
    if (!put((hex) => ({ kind: 'mines', hex, hidden: true, mines: { ap } }))) break;
    n -= ap;
  }
  for (let n = p.mines?.known ?? 0; n >= 6; ) {
    const ap = (n >= 12 ? 12 : n >= 8 ? 8 : 6) as 6 | 8 | 12;
    if (!put((hex) => ({ kind: 'mines', hex, hidden: false, mines: { ap, known: true } }))) break;
    n -= ap;
  }
  const dummies = dummyAllotment(p.mines?.dummies ?? 0, out) + (fortState(env)?.extraDummies?.[side] ?? 0);
  for (let i = 0; i < dummies; i++) if (!put((hex) => ({ kind: 'mines', hex, hidden: false, mines: { known: true, dummy: true } }))) break;
  void map;
  return out;
}

// ---------------------------------------------------------------- units with the counters at setup

const ENTRENCHMENTS: readonly FortKind[] = ['foxhole', 'trench', 'ditch'];
/** The counter a unit set up `beneath` in `hex` goes under: the foxhole/trench/ditch, else the Wire. */
const beneathTarget = (env: QueryEnv, side: SideId, hex: HexId): FortRecord | null =>
  fortificationsAt(env, hex).find((c) => c.side === side && ENTRENCHMENTS.includes(c.kind)) ?? fortificationsAt(env, hex).find((c) => c.side === side && c.kind === 'wire') ?? null;

/** Why the units set up beneath counters or inside pillboxes break their capacities (B27.1, B27.12, B27.51, B30.111), or null. */
export function fortSetupIllegal(env: QueryEnv, side: SideId, action: SetupAction): string | null {
  const pieces = env.state.pieces;
  const sw = action.sw ?? {};
  const heldBy = (unit: PieceId): Piece[] => [...swHeldBy(env.state, unit), ...Object.entries(sw).filter(([, by]) => by === unit).map(([w]) => pieces[w]).filter((w): w is Piece => !!w)];
  // Beneath a foxhole, trench, A-T Ditch or Wire counter of the side in the unit's own hex.
  const beneath = [...new Set(action.beneath ?? [])];
  const byCounter = new Map<string, Piece[]>();
  for (const id of beneath) {
    const u = pieces[id];
    const loc = action.placements[id];
    if (!u || !loc) return `${id} is not being set up`;
    if (isPillboxLoc(loc)) return `${id} cannot be both in the pillbox and beneath a counter`;
    const target = beneathTarget(env, side, hexOfLoc(loc));
    if (!target) return `No foxhole, trench or Wire of yours in ${hexOfLoc(loc)} to set up beneath`;
    // B27.51: "Any counter may start a scenario beneath a trench counter", an A-T Ditch being a trench (B27.56); B27.55 and
    // B27.56 bar a vehicle from entering one, not from starting beneath it, so an Armored Car may too. A foxhole takes
    // Infantry, SW and a mortar only (B27.1); "Vehicles are never placed beneath Wire" (B26.43).
    if (isVehicleDef(defOf(env, u))) {
      if (target.kind === 'trench' || target.kind === 'ditch') continue;
      return target.kind === 'wire' ? 'Vehicles are never placed beneath Wire (ASLRB B26.43)' : `A vehicle cannot set up beneath a ${fortKindName(target)}: only Infantry, SW and a mortar may (ASLRB B27.1)`;
    }
    // Only Infantry and SW beneath a foxhole; a mortar is the one 5/8" counter allowed (B27.1). Any counter may start beneath a trench (B27.51).
    if (target.kind === 'foxhole' && gun(env, u) && gun(env, u)!.type !== 'MTR') return `${id} cannot be placed beneath a foxhole: only Infantry, SW and a mortar may (ASLRB B27.1)`;
    if (target.kind === 'foxhole') for (const w of heldBy(id)) if (gun(env, w) && gun(env, w)!.type !== 'MTR') return `${w.id} cannot be placed beneath a foxhole: only Infantry, SW and a mortar may (ASLRB B27.1)`;
    byCounter.set(target.id, [...(byCounter.get(target.id) ?? []), u]);
  }
  for (const [cid, units] of byCounter) {
    const c = fortCounters(env).find((x) => x.id === cid)!;
    if (c.kind === 'wire') continue;
    const cap = c.capacity ?? 3;
    if (squadEquivalents(env, units) > cap) return `${fortKindName(c)} in ${c.hex} holds ${cap} squad${cap === 1 ? '' : 's'}${c.kind === 'foxhole' ? ' (ASLRB B27.12)' : ' (ASLRB B27.51)'}`;
    if (units.filter((u) => smc(env, u)).length > 4) return `${fortKindName(c)} in ${c.hex} holds at most four SMC (ASLRB B27.12)`;
  }
  // Inside a pillbox: its capacity, one Gun, no vehicle (B30.111); only the owner's pillbox.
  const inPb = new Map<HexId, Piece[]>();
  for (const [id, loc] of Object.entries(action.placements)) {
    if (!isPillboxLoc(loc)) continue;
    const hex = hexOfLoc(loc);
    const pb = pillboxAt(env, hex);
    if (!pb || pb.side !== side) return `No pillbox of yours in ${hex}`;
    const u = pieces[id];
    if (!u) continue;
    if (isVehicleDef(defOf(env, u))) return `No vehicle may occupy a pillbox (ASLRB B30.111)`;
    inPb.set(hex, [...(inPb.get(hex) ?? []), u]);
  }
  for (const [hex, units] of inPb) {
    const pb = pillboxAt(env, hex)!;
    const cap = pb.pillbox?.capacity ?? 1;
    if (squadEquivalents(env, units) > cap) return `The pillbox in ${hex} holds ${cap} squad${cap === 1 ? '' : 's'} (ASLRB B30.111)`;
    if (units.filter((u) => smc(env, u)).length > 4) return `The pillbox in ${hex} holds at most four SMC (ASLRB A5.5)`;
    if (units.flatMap((u) => heldBy(u.id)).filter((w) => gun(env, w)).length > 1) return `A pillbox may contain one Gun (ASLRB B30.111)`;
  }
  return null;
}

// ---------------------------------------------------------------- reveal (A12.33)

/** A Good Order enemy ground unit (Infantry or a vehicle that is not a wreck) on the map. */
const revealer = (env: QueryEnv, p: Piece, enemy: SideId) =>
  p.side === enemy && p.loc.kind === 'hex' && ((!!(mmc(env, p) || smc(env, p)) && isGoodOrder(env, p)) || (isVehicleDef(defOf(env, p)) && p.tags['wreck'] !== true));

/** Whether a Good Order enemy ground unit has a LOS to the counter's Location: within 16 hexes in Concealment Terrain, at any range elsewhere (A12.33). */
export function seenByEnemy(env: QueryEnv, c: FortRecord): boolean {
  const map = statics(env).map;
  const enemy = otherSide(env.state, c.side);
  const concealing = concealmentTerrainAt(env, c.hex);
  // A Good Order enemy ground unit in the counter's own hex sees its Location; a broken one (or a wreck) does not.
  if (unitsAt(env, c.hex, enemy).some((u) => revealer(env, u, enemy))) return true;
  return Object.values(env.state.pieces)
    .sort(byId)
    .some((e) => {
      if (!revealer(env, e, enemy) || e.loc.kind !== 'hex') return false;
      if (concealing && map.distance(e.loc.hex, c.hex) > 16) return false;
      return hasLos(env, locOf(env.state, e)!, c.hex);
    });
}

export function revealFortification(ctx: Ctx, id: string, reason: 'los' | 'tem' | 'concealment' | 'entry' | 'attempt' | 'attack' | 'search' | 'grown' | 'rout') {
  const c = fortCounters(ctx).find((x) => x.id === id);
  if (!c || !c.hidden || c.revealed) return;
  ctx.emit('asl.fort.revealed', { counter: { ...c, revealed: true }, reason });
}

/** Take a counter off the board (clearance, a Dummy found, falling rubble: the rules that do so say why). */
export function removeFortification(ctx: Ctx, id: string, reason: string) {
  const c = fortCounters(ctx).find((x) => x.id === id);
  if (!c) return;
  // A counter still hidden from the other side goes without telling it (A12.33): `hidden` lets the redactor drop the event.
  ctx.emit('asl.fort.removed', { id, hex: c.hex, kind: c.kind, reason, ...(c.hidden && !c.revealed ? { hidden: true } : {}) });
}

/**
 * The reveal sweep: every hidden counter (minefields excepted, B28.1) a Good Order enemy ground unit can now see; and
 * the factors of A-T mines set up in full view on a paved road, "revealed per A12.33" (B28.53).
 */
function sweep(ctx: Ctx) {
  if (ctx.state.phase === 'setup') return;
  for (const c of fortCounters(ctx)) {
    const m = c.mines;
    if (c.kind === 'mines' && !c.hidden && m?.at && !m.known && !m.dummy && !m.strengthRevealed) {
      if (seenByEnemy(ctx, c)) ctx.emit('asl.fort.revealed', { counter: { ...c, mines: { ...m, strengthRevealed: true } }, reason: 'strength' });
      continue;
    }
    if (!c.hidden || c.revealed || c.kind === 'mines') continue;
    if (seenByEnemy(ctx, c)) revealFortification(ctx, c.id, 'los');
  }
}

// ---------------------------------------------------------------- geometry for the board and later rules

/** A pillbox's two CA hexsides (B30.1: the only part of its own hex in its CA): the hexsides either side of its hexspine. */
export const pillboxCaHexsides = (ca: number): [number, number] => [mod6(ca - 1), mod6(ca)];

/**
 * The woods or building hexes a roadblock extends into (B29.2), with the vertex of the hexside (a corner of the counter's
 * hex) the extension runs from: those meeting the hexside at a vertex, not the hex across it. A rubbled building is no
 * building (B24.2): no extension into it.
 */
export function roadblockExtensionAt(env: QueryEnv, c: Pick<FortPlacement, 'hex' | 'hexside'>): { hex: HexId; vertex: number }[] {
  if (c.hexside === undefined) return [];
  const map = statics(env).map;
  const across = acrossSide(map, c.hex, c.hexside);
  const out: { hex: HexId; vertex: number }[] = [];
  for (const k of [c.hexside, c.hexside + 1])
    for (const h of cornerHexes(map, c.hex, k)) if (h !== across && (terrainOf(env, h).id === 'woods' || (isBuildingHex(env, h) && !isRubbled(env, h)))) out.push({ hex: h, vertex: mod6(k) });
  return out.sort((a, b) => (a.hex < b.hex ? -1 : 1));
}
/** The adjacent woods or building hexes a roadblock extends into (B29.2). */
export function roadblockExtension(env: QueryEnv, c: Pick<FortPlacement, 'hex' | 'hexside'>): HexId[] {
  return [...new Set(roadblockExtensionAt(env, c).map((e) => e.hex))].sort();
}

// ---------------------------------------------------------------- the module

/**
 * The counters themselves, in every full ASL game: the record, its events and redactor, the reveal by enemy LOS (A12.33),
 * the pillbox Location and what the other side may see of a unit's position. A scenario's `fortifications` special rule
 * (`fortificationsModule`) adds the setup pools and placement; Entrenching (B27.11, `asl/entrenchments.ts`) adds foxholes
 * in play, which is why the record lives here and not in the special rule.
 */
export const aslFortificationsModule: RuleModule = {
  id: 'asl.fortifications',
  ref: 'ASLRB A12.33, B26–B30',
  summary: 'Fortification counters: the record, what each side sees of it, the reveal by enemy LOS, the pillbox Location.',
  requires: ['sk1.scenario', 'sk1.movement', 'asl.rubble', 'asl.levels'],
  install(r) {
    r.event<{ side: SideId; counters: FortRecord[]; belts?: (MineBelt & { side: SideId })[] }>({
      type: 'asl.fort.placed',
      apply(d, p) {
        const st = (d.ext[FORT_EXT] as FortState | undefined) ?? { counters: [] };
        // A side's setup placement comes once; a foxhole dug in play (B27.11) joins the counters already down.
        d.ext[FORT_EXT] = { ...st, counters: [...st.counters.filter((c) => !p.counters.some((n) => n.id === c.id)), ...p.counters], ...(p.belts?.length ? { belts: [...(st.belts ?? []), ...p.belts] } : {}) };
      },
    });
    r.event<{ counter: FortRecord; reason: string }>({
      type: 'asl.fort.revealed',
      apply(d, p) {
        const st = (d.ext[FORT_EXT] as FortState | undefined) ?? { counters: [] };
        const rest = st.counters.filter((c) => c.id !== p.counter.id);
        d.ext[FORT_EXT] = { ...st, counters: [...rest, p.counter].sort((a, b) => (a.id < b.id ? -1 : 1)) };
      },
    });
    r.event<{ id: string; hex: HexId; kind: FortKind; reason: string }>({
      type: 'asl.fort.removed',
      apply(d, p) {
        const st = d.ext[FORT_EXT] as FortState | undefined;
        if (st) d.ext[FORT_EXT] = { ...st, counters: st.counters.filter((c) => c.id !== p.id) };
      },
    });
    r.event<{ side: SideId; dr: number; extra: number }>({
      type: 'asl.fort.dummies',
      apply(d, p) {
        const st = (d.ext[FORT_EXT] as FortState | undefined) ?? { counters: [] };
        d.ext[FORT_EXT] = { ...st, extraDummies: { ...(st.extraDummies ?? {}), [p.side]: p.extra } };
      },
    });

    // What the other side (or a hotseat screen, a spectator) may see: open and revealed counters, a minefield's
    // strength only once shown, nothing of the Dummy dr.
    // A pillbox whose contents the viewer may not inspect shows only that it is occupied (B30.7).
    const occupancy = (c: FortRecord, viewer: SideId | null, env: QueryEnv): FortRecord =>
      c.kind === 'pillbox' && viewer !== c.side && env.query('pillbox.occupiedUnseen', { hex: c.hex, viewer }, false) ? { ...c, occupied: true } : c;
    const shownState = (st: FortState, viewer: SideId | null, env: QueryEnv): FortState => ({
      counters: st.counters.map((c) => shownCounter(c, viewer)).filter((c): c is FortRecord => !!c).map((c) => occupancy(c, viewer, env)),
      ...(st.belts?.length ? { belts: st.belts } : {}),
      ...(st.extraDummies && viewer && st.extraDummies[viewer] !== undefined ? { extraDummies: { [viewer]: st.extraDummies[viewer]! } } : {}),
    });
    r.redact({
      id: 'asl.fort.redact',
      ext: FORT_EXT,
      redactExt: (slice, viewer, env) => shownState(slice as FortState, viewer, env),
      events: ['asl.fort.placed', 'asl.fort.revealed', 'asl.fort.dummies', 'asl.fort.grown', 'asl.fort.removed'],
      redactEvent(ev, viewer, env) {
        if (ev.type === 'asl.fort.removed') {
          const p = ev.payload as { id: string; hidden?: true };
          return !p.hidden || viewer === p.id.split('.')[0] ? ev : null;
        }
        if (ev.type === 'asl.fort.grown') {
          const c = fortCounters(env).find((x) => x.id === (ev.payload as { id: string }).id);
          return c && shownCounter(c, viewer) ? ev : null;
        }
        if (ev.type === 'asl.fort.placed') {
          const p = ev.payload as { side: SideId; counters: FortRecord[]; belts?: MineBelt[] };
          return { ...ev, payload: { side: p.side, counters: p.counters.map((c) => shownCounter(c, viewer)).filter((c): c is FortRecord => !!c), ...(p.belts ? { belts: p.belts } : {}) } };
        }
        if (ev.type === 'asl.fort.revealed') {
          const p = ev.payload as { counter: FortRecord; reason: string };
          const c = shownCounter(p.counter, viewer);
          return c ? { ...ev, payload: { counter: c, reason: p.reason } } : null;
        }
        const p = ev.payload as { side: SideId };
        return viewer === p.side ? ev : null;
      },
    });

    // B24.121: falling rubble "eliminates any ... Fortification/TB in that hex": Wire, mines, roadblocks and pillboxes here,
    // the entrenchments with the units' positions in `asl.entrenchments`.
    r.on<{ hex: HexId; falls: boolean; to?: HexId }>({
      id: 'asl.fort.fallingRubble',
      event: 'asl.rubble.falling',
      handler(ctx, ev) {
        const to = ev.payload.to;
        if (!ev.payload.falls || !to) return;
        // A pillbox goes with its contents (B30.92), in `asl/pillboxes.ts`.
        for (const c of fortificationsAt(ctx, to)) if (!ENTRENCHMENTS.includes(c.kind) && c.kind !== 'pillbox') removeFortification(ctx, c.id, 'falling rubble (ASLRB B24.121)');
      },
    });

    // B24.5: "No Fortifications are allowed in a rubble Location": a building whose ground level is rubbled loses the
    // counters in its hex (a minefield; Q&A [K33] to B24.11, B24.5 & B28: the mines are eliminated).
    r.on<{ hex: HexId; from: number }>({
      id: 'asl.fort.rubbled',
      event: 'asl.rubble',
      handler(ctx, ev) {
        if (ev.payload.from !== 0) return;
        for (const c of fortificationsAt(ctx, ev.payload.hex)) removeFortification(ctx, c.id, 'its Location rubbled (ASLRB B24.5)');
      },
    });

    // A foxhole dug beside an existing one grows it: 1S to 2S to 3S (B27.12).
    r.event<{ id: string; capacity: 1 | 2 | 3 }>({
      type: 'asl.fort.grown',
      apply(d, p) {
        const st = d.ext[FORT_EXT] as FortState | undefined;
        if (st) d.ext[FORT_EXT] = { ...st, counters: st.counters.map((c) => (c.id === p.id ? { ...c, capacity: p.capacity } : c)) };
      },
    });
    // A pillbox is a Location of its own in its hex (B30.1), ADJACENT to the ground outside it (B30.6).
    r.contribute({
      id: 'asl.fort.pillbox.locations',
      query: 'hex.locations',
      ref: 'B30.1',
      apply: (v, { hex }, env) => (pillboxAt(env, hex) ? [...v, pillboxLoc(hex)] : v),
    });
    r.contribute({
      id: 'asl.fort.pillbox.adjacent',
      query: 'loc.adjacent',
      ref: 'B30.6',
      layer: 50,
      apply(v, { loc }, env) {
        if (isPillboxLoc(loc)) return [hexOfLoc(loc)];
        return parseLoc(loc).level === 0 && !parseLoc(loc).sub && pillboxAt(env, loc) ? [...v, pillboxLoc(loc)] : v;
      },
    });
    r.contribute({
      id: 'asl.fort.pillbox.height',
      query: 'loc.height',
      ref: 'B30.1',
      apply: (v, { loc }, env) => (isPillboxLoc(loc) ? env.query('loc.height', { loc: hexOfLoc(loc) }, v) : v),
    });

    // A unit beneath a hidden foxhole, trench or Wire, or inside a hidden pillbox, would give the counter away by its own
    // Location: the other side sees it in the hex, with no position (and no pillbox Location, which it does not know of).
    r.contribute({
      id: 'asl.fort.pieceRedact',
      query: 'piece.redact',
      ref: 'A12.33',
      apply(v, { viewer }, env) {
        const p = v;
        if (p.loc.kind !== 'hex' || viewer === p.side) return v;
        const hex = p.loc.hex;
        if (p.loc.sub === 'pb' && !pillboxKnownTo(env, hex, viewer)) {
          const { sub: _s, ...loc } = p.loc;
          return { ...p, loc };
        }
        if (!p.loc.pos) return v;
        const pos = { ...p.loc.pos };
        const ent = entrenchmentAt(env, hex);
        if (pos.ent && ent && !shownCounter(ent, viewer)) delete pos.ent;
        const wire = wireAt(env, hex);
        if (pos.wire && wire && !shownCounter(wire, viewer)) delete pos.wire;
        if (Object.keys(pos).length === Object.keys(p.loc.pos).length) return v;
        const { pos: _p, ...loc } = p.loc;
        return { ...p, loc: Object.keys(pos).length ? { ...loc, pos } : loc };
      },
    });

    // The reveal sweep (A12.33): after every move of a piece, a status change and each phase start; at the end of setup
    // "just prior to placing non-OB ?", i.e. as the first Player Turn begins.
    for (const event of ['piece.moved', 'piece.tagged', 'turn.phaseStarted', 'turn.playerTurn']) r.on({ id: `asl.fort.sweep.${event}`, event, handler: (ctx) => sweep(ctx) });
    // A hidden unit revealed in the hex ("a unit therein loses its concealment").
    r.on<{ hex: HexId | null }>({
      id: 'asl.fort.reveal.unit',
      event: 'sk2.hip.unitRevealed',
      handler(ctx, ev) {
        if (!ev.payload.hex) return;
        for (const c of fortificationsAt(ctx, ev.payload.hex)) if (c.hidden && !c.revealed && c.kind !== 'mines') revealFortification(ctx, c.id, 'concealment');
      },
    });
    r.on<{ gun: PieceId; hex: HexId | null }>({
      id: 'asl.fort.reveal.gun',
      event: 'sk2.hip.revealed',
      handler(ctx, ev) {
        if (!ev.payload.hex) return;
        for (const c of fortificationsAt(ctx, ev.payload.hex)) if (c.hidden && !c.revealed && c.kind !== 'mines') revealFortification(ctx, c.id, 'concealment');
      },
    });
  },
};

export const fortificationsModule: RuleModule = {
  id: 'ssr.fortifications',
  ref: 'ASLRB A12.33, B26–B30',
  summary: 'Fortification counters a side places at setup, openly or hidden; minefields recorded (SSR, full ASL).',
  requires: ['asl.fortifications'],
  install(r) {
    // The Dummy Minefield Secret dr (B28.47): a side allotted at least one Dummy gains half a dr more, rounded down.
    r.setup({
      id: 'asl.fort.dummies',
      priority: 9,
      run(ctx) {
        for (const s of statics(ctx).scenario.ssr) {
          if (s.module !== FORTIFICATIONS_MODULE) continue;
          const p = s.params as unknown as FortificationsParams;
          if (!(p.mines?.dummies ?? 0)) continue;
          // Secret: only its owner sees the die (B28.47 "Secret dr").
          const dr = ctx.roll(`${p.side}: Dummy Minefield Secret dr (ASLRB B28.47)`, 1, { secret: p.side }).total;
          ctx.emit('asl.fort.dummies', { side: p.side, dr, extra: Math.floor(dr / 2) });
        }
      },
    });

    // The placement: part of the side's setup, once; the units may then be set up beneath or inside the counters.
    r.action<FortPlaceAction>({
      type: 'fort.place',
      decisionKinds: [SETUP_DECISION],
      legal(env, d) {
        const p = fortificationsParams(env, d.owner);
        if (!p || fortCounters(env).some((c) => c.side === d.owner)) return [];
        const counters = defaultFortPlacement(env, d.owner);
        return counters.length ? [{ type: 'fort.place', counters }] : [];
      },
      validate: (env, a, d) => fortPlaceIllegal(env, d.owner, a.counters, a.belts ?? []),
      resolve(ctx, a, d: Decision) {
        const side = d.owner;
        const counters: FortRecord[] = a.counters.map((c, i) => ({ ...c, id: `${side}.fort${i + 1}`, side, hidden: c.hidden }));
        ctx.emit('asl.fort.placed', { side, counters, ...(a.belts?.length ? { belts: a.belts.map((b) => ({ ...b, side })) } : {}) });
      },
    });

    // Units set up beneath a counter or inside a pillbox: the capacities (B27.12, B27.51, B30.111).
    r.contribute({
      id: 'asl.fort.setup',
      query: 'setup.illegal',
      ref: 'B27.12, B27.51, B30.111',
      apply: (v, { side, action }, env) => v ?? fortSetupIllegal(env, side, action as SetupAction),
    });
    // After the placements: the units beneath go under their counter (a position within the Location, B27.13); a unit set
    // up in a Wire hex and not beneath it starts on top, as one entering would (B26.4).
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx, action, decision: Decision) => {
      next?.(ctx, action, decision);
      const side = decision.owner;
      const beneath = new Set(action.beneath ?? []);
      for (const [id, loc] of Object.entries(action.placements).sort()) {
        const u = ctx.state.pieces[id];
        if (!u || u.loc.kind !== 'hex') continue;
        if (isPillboxLoc(loc)) {
          // "If a pillbox sets up hidden, so do its contents" (B30.7), with the weapons they hold (A12.3); they are in
          // addition to any HIP allowance of the scenario, which counts only the units its rule hides.
          const pb = pillboxAt(ctx, hexOfLoc(loc));
          if (pb?.hidden && !pb.revealed) for (const x of [u, ...swHeldBy(ctx.state, id)]) if (x.tags[T2.hip] !== true) ctx.emit('piece.tagged', { id: x.id, tags: { [T2.hip]: true } });
          continue;
        }
        const hex = hexOfLoc(loc);
        const ent = fortificationsAt(ctx, hex).find((c) => c.side === side && ENTRENCHMENTS.includes(c.kind));
        const wire = wireAt(ctx, hex);
        if (!ent && !wire) continue;
        const pos: { ent?: 'foxhole' | 'trench' | 'ditch'; wire?: 'on' | 'beneath' } = {};
        // A vehicle beneath a trench is beneath that counter alone (B27.52; never beneath Wire, B26.43).
        const isVehicle = isVehicleDef(defOf(ctx, u));
        if (beneath.has(id)) {
          if (ent) pos.ent = ent.kind as 'foxhole' | 'trench' | 'ditch';
          if (wire && !isVehicle) pos.wire = 'beneath';
        } else if (wire) pos.wire = 'on';
        if (Object.keys(pos).length) ctx.emit('piece.moved', { id, loc: { ...u.loc, pos } });
      }
    });

  },
};

/** Whether a Location id names a pillbox the viewer may know of. */
export const pillboxKnownTo = (env: QueryEnv, hex: HexId, viewer: SideId | null): boolean => fortificationView(env, viewer).some((c) => c.kind === 'pillbox' && c.hex === hex);

/** The Locations of a hex a viewer may set up in or see: the pillbox only when it is theirs or revealed. */
export const fortLocationsKnownTo = (env: QueryEnv, hex: HexId, viewer: SideId | null): LocId[] => locationsOf(env, hex).filter((l) => !isPillboxLoc(l) || pillboxKnownTo(env, hex, viewer));

export const isPersonnelPiece = (env: QueryEnv, p: Piece) => isPersonnelDef(defOf(env, p));
