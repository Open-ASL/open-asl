import type { HexId, Piece, PieceId, QueryEnv } from '@asl/engine';
import { defOf, hexOf, swHeldBy } from '../common/pieces';
import type { GunDef, GunType } from '../common/statics';
import { gun, pieceOf } from '../sk1/status';

/** Tag keys used by the SK2 rules (on Gun pieces unless noted). */
export const T2 = {
  /** Covered Arc: the hexspine the Gun points at, 0–5 (see `arc.ts`). */
  ca: 'ca',
  /** Emplaced (SK4 6.3): never moved, not set up on a paved road. */
  emplaced: 'emplaced',
  /** Hidden Initial Placement (SK4 6.4), on the Gun and its crew, until revealed. */
  hip: 'hip',
  /**
   * Acquired Target (SK4 6.10, 6.11), kept on the Gun but sitting on the target: `acq` is the counter
   * ('ITT' the ½" one on the target units, 'ATT' the ⅝" one on the hex), `acqHex` where it lies,
   * `acqUnits` the acquired units it follows (comma list, empty when it waits in the hex), `acqLevel` 1 or 2.
   */
  acq: 'acq',
  acqHex: 'acqHex',
  acqUnits: 'acqUnits',
  acqLevel: 'acqLevel',
  /** Fired Intensive Fire this Player Turn (SK4 3.2.4): no more shots. */
  intensive: 'intensive',
  /** Changed its CA without firing at the end of a fire phase: the Gun and its crew may not move this Player Turn. */
  caLocked: 'caLocked',
  /**
   * The fire phase (`turn`+`attacker`+`phase`) in which the Gun and its crew turned the CA without firing. SK4 3.2.4 allows
   * that only "at the end of a friendly fire phase", so neither may fire again in that phase (`caTurnedIllegal`).
   */
  caTurned: 'caTurned',
  /** Attempted to manhandle a Gun this Player Turn (unit and Gun): no AFPh fire, no APh advance. */
  manhandled: 'manhandled',
  /** Hazardous Movement (SK4 6.5), on units manhandling a Gun: -2 DRM to fire against them until pinned. */
  hazardous: 'hazardous',
  /** Fired something other than Smoke/WP this phase: no more Smoke this phase (SK4 6.2). */
  firedNonSmoke: 'firedNonSmoke',
} as const;

export const coveredArc = (p: Piece): number => (p.tags[T2.ca] as number | undefined) ?? 0;
export const isEmplaced = (p: Piece) => p.tags[T2.emplaced] === true;
export const isHidden = (p: Piece) => p.tags[T2.hip] === true;

/** The key of the current fire phase, as `caTurned` stores it. */
export const firePhaseKey = (env: { state: { turn: number; attacker: string; phase: string } }) => `${env.state.turn}${env.state.attacker}${env.state.phase}`;

/**
 * Why a Gun, or the unit manning it, may not fire: it turned the CA without firing this phase (SK4 3.2.4, "at the end of
 * a friendly fire phase"; so a Gun turned mid-PFPh may not fire at the new facing without case 8).
 */
export const caTurnedIllegal = (env: { state: { turn: number; attacker: string; phase: string } }, p: Piece): string | null =>
  p.tags[T2.caTurned] === firePhaseKey(env) ? 'It turned its Covered Arc without firing, which ends its fire this phase (SK4 3.2.4)' : null;

/** The hex a Gun is in (its possessor's when held). */
export const gunHex = (env: QueryEnv, g: Piece) => hexOf(env.state, g);

/** The unit possessing a Gun, if any. */
export const gunManner = (env: QueryEnv, g: Piece): Piece | null => (g.loc.kind === 'held' ? pieceOf(env, g.loc.by) : null);

/** Every Gun piece of a side (alive), in id order. */
export const gunsOf = (env: QueryEnv, side?: string): Piece[] =>
  Object.values(env.state.pieces)
    .filter((p) => (side === undefined || p.side === side) && p.loc.kind !== 'eliminated' && gun(env, p))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

export const gunById = (env: QueryEnv, id: PieceId): Piece => {
  const p = pieceOf(env, id);
  if (!gun(env, p)) throw new Error(`${id} is not a Gun`);
  return p;
};

/**
 * A weapon that fires through the To Hit process, described as a Gun: a Gun's own def, or a Light
 * Mortar SW (SK4 4.5) as a 360° small-target Mortar Gun with its counter's caliber, range, ROF and
 * Special Ammo, marked `light`. Null for anything else.
 */
export function ordnanceOf(env: QueryEnv, p: Piece): GunDef | null {
  const g = gun(env, p);
  if (g) return g;
  const d = defOf(env, p);
  if (d.kind === 'vehicle') {
    // A vehicle's Main Armament (SK4 7.2) seen as a Gun: the vehicle piece is the weapon, its turret type the mount.
    if (!d.ma) return null;
    return {
      id: d.id,
      nationality: d.nationality,
      kind: 'gun',
      type: d.ma.type === 'MG' ? 'MG' : 'AT',
      caliber: d.ma.caliber,
      ...(d.ma.barrel ? { barrel: d.ma.barrel } : {}),
      ...(d.ma.rof ? { rof: d.ma.rof } : {}),
      ...(d.ma.ife ? { ife: d.ma.ife } : {}),
      m: 0,
      targetSize: 'normal',
      mount: d.turret,
      qsu: false,
      gunshield: false,
      ammo: d.ma.ammo,
      ...(d.ma.specialAmmo?.length ? { specialAmmo: d.ma.specialAmmo } : {}),
      ...(d.ma.noIntensive ? { noIntensive: true } : {}),
      ...(d.ma.b !== undefined ? { b: d.ma.b } : {}),
      repair: 1,
      vehicle: true,
    };
  }
  if (d.kind === 'sw' && d.latw) {
    // A LATW (SK4 4.4): HEAT on its own To Hit Table; no Covered Arc, ROF or Intensive Fire.
    return {
      id: d.id,
      nationality: d.nationality,
      kind: 'gun',
      type: d.type as GunType,
      caliber: 0,
      m: 0,
      targetSize: 'small',
      mount: '360',
      qsu: true,
      gunshield: false,
      ammo: { he: false, ap: false },
      maxRange: d.range,
      noIntensive: true,
      light: true,
      latw: { th: d.latw.th, fp: d.fp, ...(d.x !== undefined ? { x: d.x } : {}), ...(d.latw.tk !== undefined ? { tk: d.latw.tk } : {}) },
      // A PIAT has a B# instead of an X#: it malfunctions and is repaired like a MG (SK4 4.4.5).
      ...(d.b !== undefined ? { b: d.b } : {}),
      ...(d.repair !== undefined ? { repair: d.repair } : {}),
      ...(d.removeOnRepair6 ? { removeOnRepair6: true } : {}),
    };
  }
  if (d.kind === 'sw' && d.type === 'ATR') {
    // An Anti-Tank Rifle (SK4 4.4.4): a LATW on the chart's "All ATR" row, Vehicle Target Type and AP
    // only, 12 hexes and no long range; vs Infantry it is a 1 FP SW on the IFT instead.
    return {
      id: d.id,
      nationality: d.nationality,
      kind: 'gun',
      type: 'ATR',
      caliber: 0,
      m: 0,
      targetSize: 'small',
      mount: '360',
      qsu: true,
      gunshield: false,
      ammo: { he: false, ap: true },
      maxRange: d.range,
      noIntensive: true,
      light: true,
      // No B# printed: normal breakdown on a 12 (SK4 4.4.4).
      b: d.b ?? 12,
      ...(d.repair !== undefined ? { repair: d.repair } : {}),
      ...(d.removeOnRepair6 ? { removeOnRepair6: true } : {}),
    };
  }
  if (d.kind !== 'sw' || d.type !== 'MTR' || !d.ordnance) return null;
  const o = d.ordnance;
  return {
    id: d.id,
    nationality: d.nationality,
    kind: 'gun',
    type: 'MTR',
    caliber: o.caliber,
    ...(o.barrel ? { barrel: o.barrel } : {}),
    ...(d.rof ? { rof: d.rof } : {}),
    m: 0,
    targetSize: 'small',
    mount: '360',
    qsu: true,
    gunshield: false,
    ammo: { he: true, ap: false },
    ...(o.specialAmmo?.length ? { specialAmmo: o.specialAmmo } : {}),
    ...(o.minRange !== undefined ? { minRange: o.minRange } : {}),
    ...(o.maxRange !== undefined ? { maxRange: o.maxRange } : {}),
    ...(d.b !== undefined ? { b: d.b } : {}),
    ...(d.repair !== undefined ? { repair: d.repair } : {}),
    ...(d.removeOnRepair6 ? { removeOnRepair6: true } : {}),
    noIntensive: true,
    light: true,
  };
}

/** The ordnance weapon (Gun or Light Mortar) a unit possesses, if any. */
export const ordnanceHeldBy = (env: QueryEnv, unit: PieceId): Piece | undefined => swHeldBy(env.state, unit).find((w) => ordnanceOf(env, w));

/** Tag changes that take a Gun's acquisition away. */
export const ACQ_CLEAR = { [T2.acq]: null, [T2.acqHex]: null, [T2.acqUnits]: null, [T2.acqLevel]: null } as const;

/** A Gun's Acquired Target counter, if it has one. */
export function acquisitionOf(g: Piece): { type: 'ITT' | 'ATT'; hex: HexId; units: PieceId[]; level: number } | null {
  const type = g.tags[T2.acq] as 'ITT' | 'ATT' | undefined;
  const hex = g.tags[T2.acqHex] as HexId | undefined;
  if (!type || !hex) return null;
  const units = String(g.tags[T2.acqUnits] ?? '').split(',').filter(Boolean);
  return { type, hex, units, level: (g.tags[T2.acqLevel] as number | undefined) ?? 1 };
}

/** The Acquired Target counters lying in a hex, by the Guns that placed them. */
export function acquisitionsAt(env: QueryEnv, hex: HexId): { gun: Piece; type: 'ITT' | 'ATT'; units: PieceId[]; level: number }[] {
  const out: { gun: Piece; type: 'ITT' | 'ATT'; units: PieceId[]; level: number }[] = [];
  for (const p of Object.values(env.state.pieces)) {
    if (!ordnanceOf(env, p)) continue;
    const a = acquisitionOf(p);
    if (a && a.hex === hex) out.push({ gun: p, ...a });
  }
  return out.sort((a, b) => (a.gun.id < b.gun.id ? -1 : 1));
}

/**
 * A letter telling a side's Guns apart (A, B, C… by piece id, eliminated ones keeping theirs), so
 * each Gun's Acquired Target counters and fire can be traced to it on the board and in the log.
 */
export function gunIdents(state: { pieces: Record<string, Piece> }, env: { statics: unknown }): Map<PieceId, string> {
  const out = new Map<PieceId, string>();
  const bySide = new Map<string, Piece[]>();
  for (const p of Object.values(state.pieces)) {
    if (!ordnanceOf(env as QueryEnv, p)) continue;
    const list = bySide.get(p.side) ?? [];
    list.push(p);
    bySide.set(p.side, list);
  }
  for (const list of bySide.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((p, i) => out.set(p.id, String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '')));
  }
  return out;
}
export const gunIdent = (env: QueryEnv, g: Piece): string => gunIdents(env.state, env).get(g.id) ?? '';
