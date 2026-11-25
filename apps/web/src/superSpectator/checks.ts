import type { GameState, HexId, Piece, PieceId, QueryEnv, SideId } from '@asl/engine';
import {
  attackFp,
  buildAttack,
  drmNotes,
  firerLos,
  fpNotes,
  hexOf,
  gun,
  vehicle,
  shotOutlook,
  p2d6,
  type TargetType,
  hexPixel,
  humanize,
  hexOfLoc,
  iftColumn,
  isBroken,
  isMalf,
  isPinned,
  mmc,
  otherSide,
  partLoc,
  pieceLabel,
  shotOdds,
  smc,
  statics,
  sw,
  swHeldBy,
  withoutSecrets,
  type FireAttackCtx,
  type FireDeclaration,
  type FireMode,
  type LosTrace,
  type ShotOdds,
} from '@asl/rules';

/** The fire modes a commentator can try a shot in, whatever the phase. */
export const SHOT_MODES: { mode: FireMode; label: string }[] = [
  { mode: 'prep', label: 'Prep Fire' },
  { mode: 'first', label: 'Defensive First Fire' },
  { mode: 'subsequentFirst', label: 'Subsequent First Fire' },
  { mode: 'fpf', label: 'Final Protective Fire' },
  { mode: 'final', label: 'Final Fire' },
  { mode: 'advancing', label: 'Advancing Fire' },
];

/** Where a LOS thread is drawn and where it stops. */
export interface LosLine {
  from: HexId;
  to: HexId;
  clear: boolean;
  /** Map pixels where the thread meets what blocks it. */
  blockedAt?: { x: number; y: number };
}

export interface LosView {
  line: LosLine;
  trace: LosTrace;
}

/** The thread from one Location to another (the hex itself in the Starter Kit), as the rules trace it for fire. */
export function losCheck(env: QueryEnv, from: string, to: string): LosView {
  const trace = env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] } as LosTrace);
  return { trace, line: { from: hexOfLoc(from), to: hexOfLoc(to), clear: trace.clear, ...blockPoint(env, trace, hexOfLoc(from), hexOfLoc(to)) } };
}

/**
 * Where to show the thread blocked: the point the LOS data knows (pixel LOS), else the centre of the hex the reason
 * names, else of the obstacle the map's own LOS met (or the first blocking hex the thread crosses).
 */
function blockPoint(env: QueryEnv, trace: LosTrace, from: HexId, to: HexId): { blockedAt?: { x: number; y: number } } {
  if (trace.clear) return {};
  if (trace.blockedAt) return { blockedAt: trace.blockedAt };
  const st = statics(env);
  const map = st.map;
  const named = (trace.blockedBy ?? '').split(/[^A-Za-z0-9]+/).map((w) => map.hex(w)).find((h) => !!h);
  if (named) return { blockedAt: hexPixel(named.cube) };
  const [a, b] = [map.hex(from), map.hex(to)];
  if (!a || !b) return {};
  // The first blocking hex the thread passes through: its centre within half a hex of the line, nearest the firer.
  const pa = hexPixel(a.cube);
  const pb = hexPixel(b.cube);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len2 = dx * dx + dy * dy || 1;
  const half = Math.hypot(hexPixel({ q: a.cube.q + 1, r: a.cube.r, s: a.cube.s - 1 }).x - pa.x, hexPixel({ q: a.cube.q + 1, r: a.cube.r, s: a.cube.s - 1 }).y - pa.y) / 2;
  let best: { u: number; at: { x: number; y: number } } | null = null;
  for (const h of map.hexes()) {
    if (h.id === from || h.id === to || st.terrain[h.terrain]?.los !== 'obstacle') continue;
    const c = hexPixel(h.cube);
    const u = ((c.x - pa.x) * dx + (c.y - pa.y) * dy) / len2;
    if (u <= 0 || u >= 1) continue;
    if (Math.hypot(pa.x + u * dx - c.x, pa.y + u * dy - c.y) > half) continue;
    if (!best || u < best.u) best = { u, at: c };
  }
  return best ? { blockedAt: best.at } : {};
}

/** A firing piece offered in the shot check: a unit, a weapon it holds, or a leader who may direct. */
export interface ShotFirer {
  id: PieceId;
  hex: HexId;
  label: string;
  /** `ordnance`: a weapon that fires on the To Hit Table (a Gun, a vehicle's Main Armament, a mortar, a bazooka ...), checked alone. */
  role: 'unit' | 'sw' | 'leader' | 'ordnance';
  /** Why it cannot take part (broken, malfunctioned ...); it is listed, never fired. */
  out?: string;
}

/** The weapons that fire on the IFT; mortars and the launchers fire on the To Hit Table, Panzerfausts and DCs on their own. */
const IFT_SW = new Set(['LMG', 'MMG', 'HMG', 'FT', 'ATR']);
const TO_HIT_SW = new Set(['MTR', 'BAZ', 'PSK', 'PIAT']);

/** The pieces in the firing hexes that could take part in an IFT attack, each with why not where it cannot. */
export function shotFirers(env: QueryEnv, state: GameState, hexes: HexId[]): ShotFirer[] {
  const out: ShotFirer[] = [];
  for (const hex of hexes) {
    const here = Object.values(state.pieces)
      .filter((p) => p.loc.kind === 'hex' && hexOf(state, p) === hex)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const p of here) {
      if (mmc(env, p)) {
        out.push({ id: p.id, hex, label: pieceLabel(env, p), role: 'unit', ...(isBroken(p) ? { out: 'broken' } : {}) });
        for (const s of swHeldBy(state, p.id)) {
          const d = sw(env, s);
          if (!d) continue;
          const why = isMalf(s) ? 'malfunctioned' : isBroken(p) ? 'its holder is broken' : !IFT_SW.has(d.type) && !TO_HIT_SW.has(d.type) ? 'fires on its own table' : undefined;
          out.push({ id: s.id, hex, label: pieceLabel(env, s), role: TO_HIT_SW.has(d.type) ? 'ordnance' : 'sw', ...(why ? { out: why } : {}) });
        }
      } else if (gun(env, p) || vehicle(env, p)?.ma) {
        out.push({ id: p.id, hex, label: vehicle(env, p) ? `${pieceLabel(env, p)} main armament` : pieceLabel(env, p), role: 'ordnance', ...(isMalf(p) ? { out: 'malfunctioned' } : {}) });
      } else if (smc(env, p)) {
        const why = isBroken(p) ? 'broken' : isPinned(p) ? 'pinned: may not direct' : undefined;
        out.push({ id: p.id, hex, label: pieceLabel(env, p), role: 'leader', ...(why ? { out: why } : {}) });
      }
    }
  }
  return out;
}

/** The phase a fire mode belongs to, and whose turn that is: the firer's, or (Defensive fire) the other side's. */
function phaseFor(mode: FireMode): { phase: string; firerAttacks: boolean } {
  switch (mode) {
    case 'prep':
      return { phase: 'PFPh', firerAttacks: true };
    case 'advancing':
      return { phase: 'AFPh', firerAttacks: true };
    case 'bounding':
      return { phase: 'MPh', firerAttacks: true };
    case 'final':
      return { phase: 'DFPh', firerAttacks: false };
    default:
      return { phase: 'MPh', firerAttacks: false };
  }
}

export interface ShotSpec {
  firers: HexId[];
  /** Pieces left out of the attack (unticked). */
  exclude: PieceId[];
  target: string;
  mode: FireMode;
  /** Resolved as Area Fire (at concealed units: ½ FP, SK4 8.3.2). */
  areaFire: boolean;
  /** The target is moving (Defensive First Fire): FFNAM, and FFMO where the rules apply it. */
  moving: 'none' | 'moving' | 'assault';
  /** An ordnance weapon checked on its own To Hit Table instead of the IFT attack. */
  weapon?: PieceId;
}

export interface ShotView {
  side: SideId;
  modeLabel: string;
  fp: number;
  column: number | null;
  drm: number;
  /** How the FP came about (½ Advancing Fire, x2 PBF ...). */
  fpNotes: string[];
  /** Each DRM of the attack ("+3 Stone building", "+1 Grain hindrance", "-1 leader"). */
  drmNotes: string[];
  odds: ShotOdds;
  /** Each target unit with its own DRM, if any. */
  targets: { id: PieceId; label: string; side: SideId; unitDrm: string[] }[];
  /** Firers that took no part, and why (no LOS, out of the attack). */
  leftOut: string[];
  /** What the rules would say to this shot in play (another phase, already fired, out of range ...). */
  illegal: string | null;
  error?: string;
}

/**
 * A shot tried in any phase: the position is set to the mode's phase, with the firers carrying the First Fire marker
 * Subsequent First Fire and FPF need (the rules halve the FP of a unit "firing again", SK1 3.3.1), then the attack is
 * built by the rules as it would be declared. Firers with no LOS to the target are left out, as when the shot is
 * resolved (SK1 3.2); the odds come from `shotOdds`.
 */
export function shotCheck(base: QueryEnv, engine: { env(s: GameState): QueryEnv }, spec: ShotSpec, opts: { secrets: boolean }): ShotView | null {
  const firers = shotFirers(base, base.state, spec.firers).filter((f) => !f.out && !spec.exclude.includes(f.id));
  const units = firers.filter((f) => f.role === 'unit').map((f) => f.id);
  const sws = firers.filter((f) => f.role === 'sw').map((f) => f.id);
  if (units.length + sws.length === 0) return null;
  const side = base.state.pieces[units[0] ?? sws[0]!]!.side;
  // One directing leader per firing hex (SK1 3.2): the best one ticked there.
  const directors = spec.firers.flatMap((hex) => {
    const ls = firers.filter((f) => f.role === 'leader' && f.hex === hex).map((f) => base.state.pieces[f.id]!);
    const best = ls.sort((a, b) => smc(base, a)!.leadership - smc(base, b)!.leadership)[0];
    return best ? [best.id] : [];
  });
  // A unit using its SW still fires its own FP unless the rules say it forfeits it; that is the rules' to decide.
  const decl: FireDeclaration = { units, sw: sws, target: spec.target, ...(directors.length === spec.firers.length && directors.length ? { directors } : {}) };
  const { phase, firerAttacks } = phaseFor(spec.mode);
  const again = spec.mode === 'subsequentFirst' || spec.mode === 'fpf';
  const pieces = { ...base.state.pieces };
  for (const id of [...units, ...sws, ...directors]) {
    const p = pieces[id]!;
    const { fire: _was, ...tags } = p.tags;
    pieces[id] = { ...p, tags: again ? { ...tags, fire: 'first' } : tags } as Piece;
  }
  const state: GameState = { ...base.state, phase, attacker: firerAttacks ? side : otherSide(base.state, side), pieces };
  const env = engine.env(state);
  const modeLabel = SHOT_MODES.find((m) => m.mode === spec.mode)?.label ?? spec.mode;
  const targetsHere = Object.values(state.pieces).filter((p) => p.side !== side && p.loc.kind === 'hex' && (hexOfLoc(spec.target) === hexOf(state, p)));
  const moving = spec.moving !== 'none' ? targetsHere.map((p) => p.id) : undefined;
  const movingInfo = spec.moving !== 'none' ? { assault: spec.moving === 'assault', viaRoadIntoWoodsRoad: false } : undefined;
  const refused = env.query('fire.illegal', { decl, mode: spec.mode, side, ...(moving ? { moving } : {}) }, null);
  const illegal = refused ? humanize(env, refused) : null;
  try {
    let attack: FireAttackCtx = buildAttack(env, decl, spec.mode, side, moving, movingInfo);
    if (spec.areaFire) attack = { ...attack, vsConcealed: true };
    // No attack comes from a firer with no LOS to the target (SK1 3.2, as `resolveFire`).
    const leftOut: string[] = [];
    const blind = new Map<string, string>();
    for (const loc of new Set(attack.parts.map((p) => partLoc(env, p)))) {
      const los = firerLos(env, loc, decl);
      if (!los.clear) blind.set(loc, los.blockedBy ?? 'blocked');
    }
    if (blind.size) {
      for (const [loc, why] of blind) leftOut.push(`No LOS from ${hexOfLoc(loc).replace(/^[a-z]+/, '')}: ${why}`);
      attack = { ...attack, parts: attack.parts.filter((p) => !blind.has(partLoc(env, p))) };
    }
    for (const f of shotFirers(base, base.state, spec.firers)) if (f.out) leftOut.push(`${f.label}: ${f.out}`);
    if (!attack.parts.length) {
      const fp = 0;
      return { side, modeLabel, fp, column: null, drm: 0, fpNotes: [], drmNotes: [], odds: { fp, column: null, drm: 0, cower: 0, effect: 0, results: [], units: {} }, targets: [], leftOut, illegal };
    }
    const fp = attackFp(env, attack);
    const drmRes = env.explain('fire.drm', { attack }, 0);
    const shown = opts.secrets ? drmRes : withoutSecrets(drmRes);
    const odds = shotOdds(env, attack);
    return {
      side,
      modeLabel,
      fp,
      column: iftColumn(env, fp),
      drm: shown.value,
      fpNotes: fpNotes(env, attack).map((n) => n.label ?? n.id),
      drmNotes: drmNotes(shown).map((n) => n.label ?? n.id),
      odds,
      targets: attack.targets.map((id) => {
        const p = state.pieces[id]!;
        return { id, label: pieceLabel(env, p), side: p.side, unitDrm: drmNotes(env.explain('fire.unitDrm', { attack, unit: id }, 0)).map((n) => n.label ?? n.id) };
      }),
      leftOut,
      illegal,
    };
  } catch (e) {
    return { side, modeLabel, fp: 0, column: null, drm: 0, fpNotes: [], drmNotes: [], odds: { fp: 0, column: null, drm: 0, cower: 0, effect: 0, results: [], units: {} }, targets: [], leftOut: [], illegal, error: (e as Error).message };
  }
}

export interface OrdnanceView {
  side: SideId;
  modeLabel: string;
  weapon: string;
  targetType: TargetType;
  /** The To Hit number, and the DRM with the LOS hindrance in it. */
  th: number;
  drm: number;
  parts: string[];
  /** The chance of a hit, and of a Critical Hit (an original DR at or under the CH number that hits). */
  hit: number;
  ch: number;
  /** At a vehicle: the To Kill number and the Armor Factors it is set against. */
  tk?: { target: string; tk: number | null; hull: Record<string, number>; turret: Record<string, number> } | null;
  los: LosTrace;
  illegal: string | null;
  error?: string;
}

/**
 * A To Hit check for one ordnance weapon (SK2-SK4): the rules' own `shotOutlook` gives the To Hit number and DRM; the
 * LOS hindrance, which the outlook leaves out until the shot is fired, is added here. The Target Type is the one a
 * player would pick: Vehicle at a vehicle, else Infantry, else Area (a mortar).
 */
export function ordnanceCheck(base: QueryEnv, engine: { env(s: GameState): QueryEnv }, spec: ShotSpec & { weapon: PieceId }): OrdnanceView | null {
  const w = base.state.pieces[spec.weapon];
  if (!w) return null;
  const side = w.side;
  const { phase, firerAttacks } = phaseFor(spec.mode);
  const state: GameState = { ...base.state, phase, attacker: firerAttacks ? side : otherSide(base.state, side) };
  const env = engine.env(state);
  const modeLabel = SHOT_MODES.find((m) => m.mode === spec.mode)?.label ?? spec.mode;
  const from = hexOf(state, w);
  const los = from ? losCheck(env, from, spec.target).trace : ({ clear: false, hindrance: 0, parts: [], blockedBy: 'not on the map' } as LosTrace);
  const enemyVehicle = Object.values(state.pieces).some((p) => p.side !== side && vehicle(env, p) && hexOf(state, p) === hexOfLoc(spec.target));
  const types: TargetType[] = enemyVehicle ? ['VTT', 'ITT', 'ATT'] : ['ITT', 'ATT'];
  let last: ReturnType<typeof shotOutlook> | null = null;
  for (const targetType of types) {
    const o = shotOutlook(env, { weapon: spec.weapon, target: spec.target, targetType }, spec.mode, side);
    last = o;
    if (o.th === null) continue;
    const drm = o.drm + (los.clear ? los.hindrance : 0);
    let hit = 0;
    let ch = 0;
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++) {
        // A Non-Stopped or Motion vehicle adds its lower die again (SK4 3.2.4 case 16).
        const dr = a + b + (o.nonStopped ? Math.min(a, b) : 0);
        if (dr + drm <= o.th) {
          hit += 1 / 36;
          if (a + b <= (o.ch ?? 0)) ch += 1 / 36;
        }
      }
    return {
      side,
      modeLabel,
      weapon: pieceLabel(env, w),
      targetType,
      th: o.th,
      drm,
      parts: [...o.parts, ...(los.clear && los.hindrance ? los.parts.map((p) => `${p.drm > 0 ? '+' : ''}${p.drm} ${p.label}`) : [])],
      hit: los.clear ? hit : 0,
      ch: los.clear ? ch : 0,
      ...(o.tk !== undefined ? { tk: o.tk } : {}),
      los,
      illegal: o.illegal ? humanize(env, o.illegal) : null,
    };
  }
  return { side, modeLabel, weapon: pieceLabel(env, w), targetType: types[0]!, th: 0, drm: 0, parts: [], hit: 0, ch: 0, los, illegal: last?.illegal ? humanize(env, last.illegal) : null, error: 'No To Hit number at this range or target' };
}

/**
 * The chance a hit on `facing` destroys the vehicle (SK4 7.9, as `resolveToKill`): a To Kill DR under the Final TK#
 * (the TK#, +1 at the rear, doubled by a Critical Hit, less the Armor Factor) kills, an original 12 is a dud.
 */
export const killChance = (tk: number, af: number, facing: string, ch = false) => {
  const finalTk = (tk + (facing === 'rear' ? 1 : 0)) * (ch ? 2 : 1) - af;
  let p = 0;
  for (let n = 2; n <= 11; n++) if (n < finalTk) p += p2d6(n);
  return p;
};
