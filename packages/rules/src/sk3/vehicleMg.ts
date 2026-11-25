import { hexOfLoc } from '../common/location';
import type { Action, Ctx, Piece, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { defOf, hexOf, statics, swHeldBy } from '../common/pieces';
import { PHASE_DECISION } from '../common/turn';
import { FP, firedAt, isRofShot, type FireAttackCtx, type FireDeclaration, type FireMode, type FirePart, type ResolveFireFn } from '../sk1/fire';
import { moveState, movingInfo, moveInternals } from '../sk1/movement';
import { fireMarker, pieceOf, setTags, sw, vehicleIfe } from '../sk1/status';
import { isWoodsRoad, terrainOf } from '../sk1/terrain';
import { caChangeDrm, inCoveredArc, nearestSpine, spineChange } from '../sk2/arc';
import { OP, woodsBuildingOrRubble, type OrdnanceFireFn, type ShotCtx } from '../sk2/ordnance';
import { ACQ_CLEAR, T2, caTurnedIllegal, coveredArc, ordnanceOf } from '../sk2/status';
import { BOW_TURN, T3, crewCanAct, inMotion, isCe, isWreck, stunWord, tcaOf, vcaOf, vehicle, type VehicleMgKind } from './status';
import { hullTurnRefusal, movingVehicle, turnRiskingBog, closeTerrain } from './vehicleMove';
import { firerNonStoppedVehicle } from './vehicleFire';

/*
 * Vehicular machine guns (SK4 7.8): each is a piece held by its vehicle and fires on the IFT like
 * any MG, with the vehicle's own restrictions: the BMG through the VCA, the CMG and RMG through the
 * TCA (the RMG rearwards), the AAMG only Crew Exposed; they form Fire Groups only with each other and
 * the MA's IFE (which must join them against the same target: Mandatory FG), never cower, fire in the same fire phase as the Main Armament, are halved in the MPh (Bounding
 * First Fire) and quartered if the vehicle has not stopped; a Fixed Mount BMG adds +1 vs a moving
 * target.
 */

const MG_KIND: Record<string, VehicleMgKind> = { BMG: 'bmg', CMG: 'cmg', AAMG: 'aamg', RMG: 'rmg' };

/** The vehicle a MG piece belongs to, and its kind, or null for any other piece. */
export function vehicleMgOf(env: QueryEnv, id: PieceId): { vehicle: PieceId; kind: VehicleMgKind } | null {
  const p = env.state.pieces[id];
  const d = p && defOf(env, p);
  if (!p || !d || d.kind !== 'sw' || !d.fixed || p.loc.kind !== 'held') return null;
  const kind = MG_KIND[d.type];
  return kind ? { vehicle: p.loc.by, kind } : null;
}

/** The fire phase class a marker or mode belongs to: the MPh and DFPh count as one (SK4 7.8). */
const phaseClass = (m: FireMode | 'prep' | 'adv' | 'first' | 'final' | 'bff' | undefined): 'PFPh' | 'AFPh' | 'DF' | null =>
  m === 'prep' ? 'PFPh' : m === 'adv' || m === 'advancing' ? 'AFPh' : m ? 'DF' : null;

/** The vehicle piece itself among a declaration's weapons: its MA firing IFE on the IFT (SK4 6.8). */
const ifeOf = (env: QueryEnv, id: PieceId) => {
  const p = env.state.pieces[id];
  return p && p.loc.kind === 'hex' && vehicleIfe(env, p) ? p : null;
};

/**
 * Mandatory Fire Group for a vehicle's IFE/MGs (SK4 7.8: "Mandatory FG applies"; 2.0 FG: "A vehicle's MG/IFE would
 * have to combine to fire on the same target"): none of them may attack a target another already attacked this
 * phase from the vehicle (a moving stack: on the same expenditure), but for a ROF shot or firing again as SFF.
 */
function armamentFgIllegal(env: QueryEnv, v: PieceId, decl: FireDeclaration, mode: FireMode, moving: boolean): string | null {
  if (mode === 'subsequentFirst' || mode === 'fpf' || isRofShot(env, decl)) return null;
  const at = hexOf(env.state, pieceOf(env, v));
  if (!at) return null;
  const earlier = firedAt(env, at, decl.target, moving).filter((id) => !decl.sw.includes(id) && (id === v || vehicleMgOf(env, id)?.vehicle === v));
  if (!earlier.length) return null;
  const names = earlier.map((id) => (id === v ? 'MA (IFE)' : (sw(env, pieceOf(env, id))?.type ?? id))).join(' and ');
  return `The ${names} already fired at this target: a vehicle's IFE and MGs attacking one target fire together (Mandatory Fire Group)`;
}

// ---------------------------------------------------------------- turret turns
// A turret weapon may turn the turret before firing and pays the Covered Arc change DRM (SK4 3.2.4 case 8: "To Hit
// [or IFT if using MG/IFE] Firer Based penalties"), on its first shot after the change only. Once one turret weapon
// has fired after a turn, the vehicle's other turret weapons firing in that TCA this phase pay the same penalty (SK4
// 7.8: "once a vehicle fires any turret-mounted weapon, any of its other turret-mounted weapons must pay the same CA
// penalties as the first weapon that fired"; ASL D3.51 Maintaining CA). The turn this phase is kept on the vehicle: the
// phase, the hexspines, and the turret weapons that have paid for it.
const TURN = { phase: 'tcaTurnPhase', spines: 'tcaTurnSpines', paid: 'tcaTurnPaid' } as const;
// The bow-mounted weapons the same (SK4 7.8: "These same principles apply to bow-mounted weapons if changing the VCA to
// fire"): a BMG, or an NT vehicle's MA or its IFE, that turned the hull to fire; the other bow weapon firing in that VCA
// this phase pays the same NT penalty ("BMG = NT").
const BOW = BOW_TURN;
const phaseKey = (env: QueryEnv) => `${env.state.turn}${env.state.attacker}${env.state.phase}`;
const turreted = (env: QueryEnv, v: Piece) => (vehicle(env, v)?.turret ?? 'NT') !== 'NT';

/** The turret (or, `bow`, hull) turn a vehicle made this phase, if any, and which of its weapons have paid for it. */
function turnThisPhase(env: QueryEnv, v: Piece, rec: typeof TURN | typeof BOW = TURN): { spines: number; paid: string[] } | null {
  if (v.tags[rec.phase] !== phaseKey(env)) return null;
  return { spines: (v.tags[rec.spines] as number | undefined) ?? 0, paid: String(v.tags[rec.paid] ?? '').split(',').filter(Boolean) };
}
/** Record a turn for the attack's weapons, or that they paid for this phase's turn. */
function recordTurn(ctx: Ctx, v: PieceId, rec: typeof TURN | typeof BOW, ids: PieceId[], spines: number) {
  if (spines > 0) {
    setTags(ctx, v, { [rec.phase]: phaseKey(ctx), [rec.spines]: spines, [rec.paid]: ids.join(',') });
    return;
  }
  const turn = turnThisPhase(ctx, pieceOf(ctx, v), rec);
  if (turn) setTags(ctx, v, { [rec.paid]: [...new Set([...turn.paid, ...ids])].join(',') });
}
/** Case 8 for a hull turned `spines` hexspines to fire a bow weapon: NT (SK4 7.8 "BMG = NT"), doubled as a turret's. */
function hullDrm(env: QueryEnv, v: Piece, spines: number): number {
  const hex = hexOf(env.state, v);
  const close = !!hex && woodsBuildingOrRubble(env, hex) && !isWoodsRoad(env, hex);
  return caChangeDrm('NT', spines) * (close ? 2 : 1);
}
/** The bow-mounted weapons among an attack's: the BMG, and an NT vehicle's MA as IFE. */
function bowWeapons(env: QueryEnv, ids: PieceId[]): { v: Piece; ids: PieceId[] } | null {
  let v: Piece | null = null;
  const out: PieceId[] = [];
  for (const id of ids) {
    const mg = vehicleMgOf(env, id);
    const veh = mg?.kind === 'bmg' ? mg.vehicle : ifeOf(env, id) && !turreted(env, pieceOf(env, id)) ? id : null;
    if (!veh) continue;
    v = pieceOf(env, veh);
    out.push(id);
  }
  return v ? { v, ids: out } : null;
}

/**
 * Case 8 for a turret turned `spines` hexspines: by turret type, doubled for a vehicle in woods, a building or rubble,
 * though not on the road of a Woods-Road hex (ASLRB C5.11).
 */
function turretDrm(env: QueryEnv, v: Piece, spines: number): number {
  const hex = hexOf(env.state, v);
  const close = !!hex && woodsBuildingOrRubble(env, hex) && !isWoodsRoad(env, hex);
  return caChangeDrm(vehicle(env, v)!.turret, spines) * (close ? 2 : 1);
}

/** The vehicle whose turret weapons (CMG, RMG, its turreted MA's IFE) take part in an attack, with those weapons. */
function turretWeapons(env: QueryEnv, ids: PieceId[]): { v: Piece; ids: PieceId[] } | null {
  let v: Piece | null = null;
  const out: PieceId[] = [];
  for (const id of ids) {
    const mg = vehicleMgOf(env, id);
    const veh = mg && (mg.kind === 'cmg' || mg.kind === 'rmg') ? mg.vehicle : ifeOf(env, id) ? id : null;
    if (!veh) continue;
    v = pieceOf(env, veh);
    out.push(id);
  }
  return v && turreted(env, v) ? { v, ids: out } : null;
}

/**
 * The turret hexspine a vehicle's MG/IFE attack must turn to for its turret weapons to bear on `target` (the fewest
 * hexspines; an RMG alone points the turret's rear), or undefined when they already bear or cannot.
 */
export function turretTurnFor(env: QueryEnv, decl: Pick<FireDeclaration, 'sw' | 'target'>): number | undefined {
  const tw = turretWeapons(env, decl.sw);
  if (!tw) return undefined;
  const at = hexOf(env.state, tw.v);
  const map = statics(env).map;
  const me = at ? map.hex(at) : undefined;
  const target = map.hex(hexOfLoc(decl.target));
  if (!me || !target || at === decl.target) return undefined;
  const rearOnly = tw.ids.every((id) => vehicleMgOf(env, id)?.kind === 'rmg');
  const tca = tcaOf(env, tw.v);
  const facing = rearOnly ? (tca + 3) % 6 : tca;
  if (inCoveredArc(me.cube, facing, target.cube)) return undefined;
  const spine = nearestSpine(me.cube, facing, target.cube);
  if (spine === null) return undefined;
  return rearOnly ? (spine + 3) % 6 : spine;
}

/**
 * The hull hexspine a vehicle's bow-weapon attack (its BMG, with an NT vehicle's MA as IFE) must turn to for them to
 * bear on `target` (the fewest hexspines; SK4 7.8), or undefined when they already bear, when the attack has turret
 * weapons too (they turn the turret instead), or when no MG takes part (the MA alone turns as it fires).
 */
export function hullTurnFor(env: QueryEnv, decl: Pick<FireDeclaration, 'sw' | 'target'>): number | undefined {
  const bw = bowWeapons(env, decl.sw);
  if (!bw || decl.sw.some((id) => !bw.ids.includes(id)) || !decl.sw.some((id) => vehicleMgOf(env, id)?.kind === 'bmg')) return undefined;
  const at = hexOf(env.state, bw.v);
  const map = statics(env).map;
  const me = at ? map.hex(at) : undefined;
  const target = map.hex(hexOfLoc(decl.target));
  if (!me || !target || at === decl.target || inCoveredArc(me.cube, vcaOf(bw.v), target.cube)) return undefined;
  return nearestSpine(me.cube, vcaOf(bw.v), target.cube) ?? undefined;
}

/**
 * Why a vehicle MG may not fire now whatever its target (disabled, or barred by the crew's posture: the AAMG only
 * Crew Exposed, SK4 7.8; ASLRB D1.83), or null. The wheel offers only the MGs this passes.
 */
export function vehicleMgUnavailable(env: QueryEnv, id: PieceId): string | null {
  const mg = vehicleMgOf(env, id);
  if (!mg) return null;
  const v = pieceOf(env, mg.vehicle);
  const d = vehicle(env, v);
  const kind = mg.kind;
  if (pieceOf(env, id).tags[T3.mgDisabled]) return `The ${kind.toUpperCase()} is disabled`;
  if (kind === 'aamg' && !isCe(v)) return 'The AAMG fires only while Crew Exposed';
  if (d?.openTopped && !isCe(v) && kind !== 'bmg') return 'A Buttoned Up Open-Topped AFV fires only its bow MG';
  if (kind === 'cmg' && isCe(v) && (d?.turret === 'RST' || d?.turret === '1MT')) return 'A Restricted Slow Traverse or One Man Turret cannot fire its CMG while Crew Exposed';
  return null;
}

/** Why a vehicle's MGs (and its MA's IFE with them) may not fire this declaration, or null. */
export function vehicleMgIllegal(env: QueryEnv, decl: FireDeclaration, mode: FireMode, side: string, moving?: PieceId[]): string | null {
  const mgs = decl.sw.map((id) => ({ id, mg: vehicleMgOf(env, id) })).filter((x) => x.mg);
  const ife = decl.sw.filter((id) => ifeOf(env, id));
  // The MA's IFE alone: the ordnance rules judge it, but for the Fire Group it may owe the MGs.
  if (mgs.length === 0 && decl.vca !== undefined) return 'The Main Armament turns the hull as it fires its own shot';
  if (mgs.length === 0) return ife.length === 1 && decl.sw.length === 1 && decl.units.length === 0 ? armamentFgIllegal(env, ife[0]!, decl, mode, !!moving) : null;
  const vehicles = new Set([...mgs.map((x) => x.mg!.vehicle), ...ife]);
  if (vehicles.size > 1 || decl.units.length > 0 || decl.sw.length !== mgs.length + ife.length) return "A vehicle's MGs form a Fire Group only with each other and its MA's IFE";
  if (decl.directors?.length) return 'Leadership never directs vehicle fire';
  // FPF is an option of DEFENDING Infantry only (ASLRB A8.31): a vehicle never takes its NMC.
  if (mode === 'fpf') return 'Final Protective Fire is for Infantry only: a vehicle’s MGs cannot use it';
  const v = pieceOf(env, mgs[0]!.mg!.vehicle);
  const d = vehicle(env, v)!;
  if (v.side !== side) return 'Not your vehicle';
  if (isWreck(v)) return 'A wreck does not fire';
  if (!crewCanAct(v)) return v.tags[T3.shock] ? 'A Shocked crew cannot fire' : `A ${stunWord(v, 'Stunned')} crew cannot fire this Player Turn`;
  // Turned without MP at the end of this phase (SK4 3.3.2): it fires no more in it.
  const turned = caTurnedIllegal(env, v);
  if (turned) return turned;
  const at = hexOf(env.state, v)!;
  const map = statics(env).map;
  const target = map.hex(hexOfLoc(decl.target));
  if (!target) return 'Unknown target hex';
  const me = map.hex(at)!;
  // Turning the turret to fire (SK4 3.2.4: a CMG "may ... change its CA prior to firing (and suffer the resulting ...
  // IFT ... Firer Based penalties)"): the CMG/RMG and the MA's IFE then fire through the new TCA.
  if (decl.tca !== undefined && decl.vca !== undefined) return 'One attack turns the hull or the turret, not both';
  if (decl.tca !== undefined) {
    if (!Number.isInteger(decl.tca) || decl.tca < 0 || decl.tca > 5) return 'The turret turns to a hexspine 0-5';
    if (d.turret === 'NT') return 'This vehicle has no turret: its weapons turn with the hull';
    if (mode === 'bounding') return 'In its MPh a vehicle turns its turret before firing (no Covered Arc change DRM)';
    if (decl.tca === tcaOf(env, v)) return 'The turret already points that way';
    if (!ife.length && !mgs.some((x) => x.mg!.kind === 'cmg' || x.mg!.kind === 'rmg')) return 'Only the turret weapons (CMG, RMG, MA) turn with the turret';
  }
  // Turning the hull to fire (SK4 3.2.4: a BMG "may ... change its CA prior to firing"; 3.3.2: "A TCA/VCA may also be
  // changed without MP expenditure as a result of firing outside the CA during any fire phase (other than its own MPh)";
  // 7.8: "These same principles apply to bow-mounted weapons if changing the VCA to fire. If the VCA changes, the TCA
  // changes the same number of hexspines relative to the VCA"): the bow weapons (BMG, an NT MA's IFE) then fire through
  // the new VCA, and a turret weapon with them through the TCA the hull carried round.
  if (decl.vca !== undefined) {
    if (!Number.isInteger(decl.vca) || decl.vca < 0 || decl.vca > 5) return 'The hull turns to a hexspine 0-5';
    if (mode === 'bounding') return 'In its MPh a vehicle turns its hull only by spending MP: a Bounding First Firer fires within its Covered Arc';
    if (decl.vca === vcaOf(v)) return 'The hull already faces that way';
    if (!bowWeapons(env, decl.sw)) return 'Only the bow-mounted weapons (BMG, an NT Main Armament) turn with the hull';
    const never = hullTurnRefusal(env, v);
    if (never) return never;
  }
  const vca = decl.vca ?? vcaOf(v);
  const tca = decl.tca ?? (decl.vca !== undefined ? (tcaOf(env, v) + decl.vca - vcaOf(v) + 6) % 6 : tcaOf(env, v));
  for (const { id, mg } of mgs) {
    const kind = mg!.kind;
    const unavailable = vehicleMgUnavailable(env, id);
    if (unavailable) return unavailable;
    if (decl.target !== at && kind !== 'aamg') {
      const spine = kind === 'bmg' ? vca : kind === 'rmg' ? (tca + 3) % 6 : tca;
      if (!inCoveredArc(me.cube, spine, target.cube)) return `The ${kind.toUpperCase()} fires through the ${kind === 'bmg' ? 'Vehicle' : 'Turret'} Covered Arc: turn first`;
    }
  }
  // Same fire phase as the Main Armament (MPh and DFPh counting as one), either way round (7.8).
  const maClass = phaseClass(fireMarker(v) ?? (v.tags[T3.bff] ? 'bff' : undefined));
  const myClass = phaseClass(mode);
  if (maClass && myClass && maClass !== myClass) return 'Vehicular MGs fire in the same fire phase as the Main Armament';
  if (mode === 'bounding') {
    const m = movingVehicle(env);
    if (!m || m.p.id !== v.id) return 'Bounding First Fire is for the vehicle that is moving';
    if (m.ms.vehicle.bffFrom && m.ms.hex !== m.ms.vehicle.bffFrom) return 'In its MPh a vehicle fires every weapon from the hex of its first MA shot';
  }
  if (ife.length) {
    if (mode === 'bounding') return 'Bounding First Fire with the MGs leaves the MA to fire on its own';
    // Everything that would stop the MA firing its IFE alone stops it here: crew, arc (no turning; SK4 7.8 "the
    // target lies within the CA for all"), range 16, its fire marker.
    const ca = decl.tca ?? (decl.vca !== undefined ? tca : undefined);
    const why = env.query('ordnance.illegal', { shot: { weapon: v.id, target: decl.target, targetType: 'IFE', ...(ca !== undefined ? { ca } : {}) }, mode, side, ...(moving ? { moving } : {}) }, null);
    if (why) return `MA (IFE): ${why}`;
  }
  return armamentFgIllegal(env, v.id, decl, mode, !!moving);
}

export const vehicleMgModule: RuleModule = {
  id: 'sk3.vehicleMg',
  ref: 'SK4 3.3.2.2, 7.8',
  summary: 'Vehicular machine guns: arcs, CE, Fire Groups, same phase as the MA, halving in the MPh, no cowering.',
  requires: ['sk1.fire', 'sk2.ordnance', 'sk3.vehicleMove'],
  install(r) {
    r.contribute({ id: 'sk3.fire.illegal.vehicle-mg', query: 'fire.illegal', apply: (v, { decl, mode, side, moving }, env) => v ?? vehicleMgIllegal(env, decl, mode, side, moving) });
    // A bow weapon's attack turned the hull first (SK4 7.8): where it reached, and whether a Bog Check stopped it.
    r.event<{ vehicle: PieceId; from: number; to: number; spines: number; bogged: boolean }>({ type: 'sk3.vehicle.hullTurnToFire', apply() {} });
    // The MA's IFE in the MGs' Fire Group has fired its MA, as a lone IFE shot does (SK4 6.8, 6.10): it loses any
    // acquisition and has fired other than Smoke this phase.
    r.procedure<ResolveFireFn>(FP.resolve, (next) => (ctx, declared, mode, opts) => {
      const tw = mode === 'bounding' ? null : turretWeapons(ctx, declared.sw);
      const bw = mode === 'bounding' ? null : bowWeapons(ctx, declared.sw);
      let decl = declared;
      if (bw && declared.vca !== undefined) {
        // The hull turns first, the turret riding round with it (SK4 7.8), then the attack pays the NT case 8 for it.
        // In woods or a building each hexspine takes a Bog Check (SK4 7.6; ASLRB D8.2): bogging stops the hull, and
        // the attack is not made.
        const v = bw.v;
        const from = vcaOf(v);
        const tca0 = tcaOf(ctx, v);
        const hex = hexOf(ctx.state, v);
        const reached = closeTerrain(ctx, hex) ? turnRiskingBog(ctx, v, hex!, declared.vca) : { vca: declared.vca, bogged: false };
        const delta = (reached.vca - from + 6) % 6;
        const spines = spineChange(from, declared.vca);
        ctx.emit('sk3.vehicle.hullTurnToFire', { vehicle: v.id, from, to: reached.vca, spines, bogged: reached.bogged });
        setTags(ctx, v.id, { [T3.vca]: reached.vca, [T2.ca]: turreted(ctx, v) ? (tca0 + delta) % 6 : reached.vca });
        if (reached.vca !== declared.vca) return { column: null, dr: [0, 0], cowered: false, results: {}, rofKept: [], malfunctioned: [], residualFp: 0 };
        const { vca: _vca, ...rest } = declared;
        decl = { ...rest, caChange: { weapon: v.id, spines, mount: 'NT' } };
      }
      if (tw && declared.tca !== undefined) {
        // The MGs' own turn comes first, then the attack pays for it as a Gun's IFE does (case 8, doubled in a building).
        const from = tcaOf(ctx, tw.v);
        const spines = spineChange(from, declared.tca);
        ctx.emit('sk2.gun.ca', { gun: tw.v.id, from, to: declared.tca, spines, reason: 'fire' });
        const { tca: _tca, ...rest } = declared;
        decl = { ...rest, caChange: { weapon: tw.v.id, spines, mount: vehicle(ctx, tw.v)!.turret } };
      }
      const out = next!(ctx, decl, mode, opts);
      if (decl.sw.some((id) => vehicleMgOf(ctx, id)))
        for (const id of decl.sw) if (ifeOf(ctx, id)) setTags(ctx, id, { ...ACQ_CLEAR, [T2.firedNonSmoke]: true });
      // A CMG fired at a different hex loses its MA's Acquisition (SK4 6.10; ASLRB C6.5 "or its CMG"); the BMG, AAMG
      // and RMG are named in neither.
      for (const id of decl.sw) {
        const mg = vehicleMgOf(ctx, id);
        const v = mg?.kind === 'cmg' ? ctx.state.pieces[mg.vehicle] : undefined;
        if (v && v.tags[T2.acqHex] !== undefined && v.tags[T2.acqHex] !== hexOfLoc(decl.target)) setTags(ctx, v.id, ACQ_CLEAR);
      }
      // The hull turned for this attack (a bow weapon's own turn, or an NT MA's IFE fired with a new CA), or it paid.
      // (An NT MA's IFE fired with a new CA turned the hull through the ordnance rules, which recorded it with the VCA.)
      if (bw && ctx.state.pieces[bw.v.id]?.loc.kind === 'hex') recordTurn(ctx, bw.v.id, BOW, bw.ids, declared.vca !== undefined && decl.caChange?.weapon === bw.v.id ? decl.caChange.spines : 0);
      if (tw && ctx.state.pieces[tw.v.id]?.loc.kind === 'hex') {
        if (decl.caChange && decl.caChange.spines > 0 && decl.caChange.weapon === tw.v.id && declared.vca === undefined) {
          // The turret turned for this attack (the MGs' own turn, or the MA's IFE fired with a new CA).
          setTags(ctx, tw.v.id, { [TURN.phase]: phaseKey(ctx), [TURN.spines]: decl.caChange.spines, [TURN.paid]: tw.ids.join(',') });
        } else {
          const turn = turnThisPhase(ctx, pieceOf(ctx, tw.v.id));
          if (turn) setTags(ctx, tw.v.id, { [TURN.paid]: [...new Set([...turn.paid, ...tw.ids])].join(',') });
        }
      }
      return out;
    });
    // The turn record is for its phase only (the phase key expires it); it comes off with the Player Turn.
    r.on<{ phase: string }>({
      id: 'sk3.vehicleMg.turn-clear',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        for (const p of Object.values(ctx.state.pieces).sort((a, b) => (a.id < b.id ? -1 : 1)))
          // One change for both records, so a piece's tags come off together.
          if (p.tags[TURN.phase] !== undefined || p.tags[BOW.phase] !== undefined)
            setTags(ctx, p.id, { ...(p.tags[TURN.phase] !== undefined ? { [TURN.phase]: null, [TURN.spines]: null, [TURN.paid]: null } : {}), ...(p.tags[BOW.phase] !== undefined ? { [BOW.phase]: null, [BOW.spines]: null, [BOW.paid]: null } : {}) });
      },
    });
    // The MA's To Hit shots: a turn records it; a shot without one pays for an earlier turn by another weapon in that arc
    // (the turret's for a turreted MA, the hull's for an NT one).
    r.procedure<OrdnanceFireFn>(OP.fire, (next) => (ctx, shot, mode, opts) => {
      const g = ctx.state.pieces[shot.weapon];
      const v = g && ordnanceOf(ctx, g)?.vehicle && mode !== 'bounding' && shot.targetType !== 'IFE' ? g : null;
      const spines = v && shot.ca !== undefined ? spineChange(coveredArc(v), shot.ca) : 0;
      const out = next!(ctx, shot, mode, opts);
      // An NT MA's own turn was recorded with its VCA (`sk3.vehicleFire.nt-vca`); without one it pays for the BMG's.
      if (v && ctx.state.pieces[v.id]?.loc.kind === 'hex') {
        if (turreted(ctx, v)) recordTurn(ctx, v.id, TURN, [v.id], spines);
        else if (spines === 0) recordTurn(ctx, v.id, BOW, [v.id], 0);
      }
      return out;
    });
    // Case 8 on the IFT for the MGs' own turn, as declared (previews); once resolving, the turn is a `caChange`.
    const turnOf = (env: QueryEnv, attack: FireAttackCtx) => {
      const tw = turretWeapons(env, attack.parts.map((p) => p.piece));
      return tw && attack.tca !== undefined ? turretDrm(env, tw.v, spineChange(tcaOf(env, tw.v), attack.tca)) : 0;
    };
    r.contribute({
      id: 'sk3.drm.turret-turn',
      query: 'fire.drm',
      ref: 'SK4 3.2.4 (case 8)',
      label: ({ attack }, env) => `+${turnOf(env, attack)} Covered Arc change`,
      when: ({ attack }, env) => attack.mode !== 'bounding' && turnOf(env, attack) > 0,
      apply: (v, { attack }, env) => v + turnOf(env, attack),
    });
    // Maintaining CA: an earlier turn this phase by another turret weapon (ASL D3.51).
    const owedOn = (env: QueryEnv, v: Piece, ids: PieceId[]) => {
      const turn = turnThisPhase(env, v);
      return turn && ids.some((id) => !turn.paid.includes(id)) ? turretDrm(env, v, turn.spines) : 0;
    };
    // The hull's turn earlier this phase, owed by a bow weapon firing in that VCA without one of its own (SK4 7.8).
    const owedBow = (env: QueryEnv, v: Piece, ids: PieceId[]) => {
      const turn = turnThisPhase(env, v, BOW);
      return turn && ids.some((id) => !turn.paid.includes(id)) ? hullDrm(env, v, turn.spines) : 0;
    };
    const owedBowIft = (env: QueryEnv, attack: FireAttackCtx) => {
      if (attack.mode === 'bounding' || attack.vca !== undefined || (attack.caChange && attack.caChange.spines > 0)) return 0;
      const bw = bowWeapons(env, attack.parts.map((p) => p.piece));
      return bw ? owedBow(env, bw.v, bw.ids) : 0;
    };
    r.contribute({
      id: 'sk3.drm.maintain-vca',
      query: 'fire.drm',
      ref: 'SK4 7.8',
      label: ({ attack }, env) => `+${owedBowIft(env, attack)} Covered Arc change (the hull turned earlier this phase)`,
      when: ({ attack }, env) => owedBowIft(env, attack) > 0 && owedIft(env, attack) === 0,
      apply: (v, { attack }, env) => v + owedBowIft(env, attack),
    });
    // Case 8 on the IFT for a bow weapon's own hull turn, as declared (previews); once resolving, the turn is a `caChange`.
    const hullTurnOf = (env: QueryEnv, attack: FireAttackCtx) => {
      const bw = bowWeapons(env, attack.parts.map((p) => p.piece));
      return bw && attack.vca !== undefined ? hullDrm(env, bw.v, spineChange(vcaOf(bw.v), attack.vca)) : 0;
    };
    r.contribute({
      id: 'sk3.drm.hull-turn',
      query: 'fire.drm',
      ref: 'SK4 7.8 (case 8, NT)',
      label: ({ attack }, env) => `+${hullTurnOf(env, attack)} Covered Arc change (hull turned: NT)`,
      when: ({ attack }, env) => attack.mode !== 'bounding' && hullTurnOf(env, attack) > 0,
      apply: (v, { attack }, env) => v + hullTurnOf(env, attack),
    });
    const owedIft = (env: QueryEnv, attack: FireAttackCtx) => {
      if (attack.mode === 'bounding' || attack.tca !== undefined || (attack.caChange && attack.caChange.spines > 0)) return 0;
      const tw = turretWeapons(env, attack.parts.map((p) => p.piece));
      return tw ? owedOn(env, tw.v, tw.ids) : 0;
    };
    r.contribute({
      id: 'sk3.drm.maintain-ca',
      query: 'fire.drm',
      ref: 'ASL D3.51',
      label: ({ attack }, env) => `+${owedIft(env, attack)} Covered Arc change (the turret turned earlier this phase)`,
      when: ({ attack }, env) => owedIft(env, attack) > 0,
      apply: (v, { attack }, env) => v + owedIft(env, attack),
    });
    const owedTh = (sc: ShotCtx, env: QueryEnv) => {
      if (sc.mode === 'bounding' || sc.spines > 0 || !sc.def.vehicle) return 0;
      const v = pieceOf(env, sc.weapon);
      return turreted(env, v) ? owedOn(env, v, [v.id]) : owedBow(env, v, [v.id]);
    };
    r.contribute({
      id: 'sk3.th.maintain-ca',
      query: 'ordnance.thDrm',
      ref: 'ASL D3.51',
      label: (sc: ShotCtx, env: QueryEnv) => `+${owedTh(sc, env)} Covered Arc change (the ${turreted(env, pieceOf(env, sc.weapon)) ? 'turret' : 'hull'} turned earlier this phase)`,
      when: (sc: ShotCtx, env: QueryEnv) => owedTh(sc, env) > 0,
      apply: (v: number, sc: ShotCtx, env: QueryEnv) => v + owedTh(sc, env),
    });
    // Halved in the MPh, quartered when the vehicle has not stopped (3.3.2.2).
    r.contribute({
      id: 'sk3.fp.bounding-mg',
      query: 'fire.partFp',
      ref: 'SK4 3.3.2.2',
      label: ({ attack }, env) => (firerNonStoppedVehicle(env, attack) ? '¼ vehicular MG Non-Stopped' : '½ vehicular MG in the MPh'),
      when: ({ attack, part }, env) => attack.mode === 'bounding' && !!vehicleMgOf(env, part.piece),
      apply: (v, { attack }, env) => (firerNonStoppedVehicle(env, attack) ? v / 4 : v / 2),
    });
    // Motion Fire (SK4 2.0): "The MG/IFE firepower of such a vehicle is halved while still in Motion/Non-Stopped".
    // Bounding First Fire already halves (quarters Non-Stopped) above; this is a Motion vehicle firing in any other
    // phase (Defensive First Fire after a Motion attempt, the DFPh or AFPh after ending its MPh in Motion).
    r.contribute({
      id: 'sk3.fp.motion-mg',
      query: 'fire.partFp',
      ref: 'SK4 2.0 Motion Fire',
      label: '½ vehicle in Motion',
      when: ({ attack, part }, env) => {
        if (attack.mode === 'bounding') return false;
        const v = vehicleMgOf(env, part.piece)?.vehicle ?? (ifeOf(env, part.piece) ? part.piece : null);
        return !!v && inMotion(pieceOf(env, v));
      },
      apply: (v) => v / 2,
    });
    // A Fixed Mount BMG: +1 vs a moving target (7.8).
    r.contribute({
      id: 'sk3.drm.fixed-bmg',
      query: 'fire.drm',
      ref: 'SK4 7.8',
      label: '+1 Fixed Mount BMG vs a moving target',
      when: ({ attack }, env) => !!attack.moving && attack.parts.some((p) => fixedBmg(env, p)),
      apply: (v) => v + 1,
    });
    function fixedBmg(env: QueryEnv, part: FirePart): boolean {
      const d = sw(env, pieceOf(env, part.piece));
      return !!d?.fixed && !!d.fixedMount;
    }
    // Vehicle fire never cowers (SK4 3.2.2).
    r.contribute({
      id: 'sk3.cower.vehicle',
      query: 'fire.cowerShift',
      layer: 900,
      when: ({ attack }, env) => attack.parts.some((p) => !!vehicleMgOf(env, p.piece)),
      apply: () => 0,
    });

    // Bounding First Fire with the MGs, from the moving vehicle (3.3.2.2).
    r.action<Action & { type: 'vmove.bffMg'; decl: FireDeclaration }>({
      type: 'vmove.bffMg',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const m = movingVehicle(env);
        if (!m || !m.ms.hex) return [];
        const mgs = swHeldBy(env.state, m.p.id).filter((w) => vehicleMgOf(env, w.id) && !fireMarker(w)).map((w) => w.id);
        if (!mgs.length) return [];
        const out: { type: 'vmove.bffMg'; decl: FireDeclaration }[] = [];
        const targets = [...new Set(Object.values(env.state.pieces).filter((p) => p.side !== m.p.side && p.loc.kind === 'hex').map((p) => (p.loc as { hex: string }).hex))];
        const ok = (sw: PieceId[], target: string) => !env.query('fire.illegal', { decl: { units: [], sw, target }, mode: 'bounding', side: m.p.side }, null);
        for (const target of targets) {
          // Every MG, or else those whose own arc covers the target (the CMG need not wait for the BMG).
          const sw = ok(mgs, target) ? mgs : mgs.filter((id) => ok([id], target));
          if (sw.length && ok(sw, target)) out.push({ type: 'vmove.bffMg', decl: { units: [], sw, target } });
        }
        return out;
      },
      validate(env, a) {
        const m = movingVehicle(env);
        if (!m) return 'No vehicle is moving';
        if (!m.ms.hex) return 'Fire from the map';
        if (!a.decl.sw.every((id) => vehicleMgOf(env, id)?.vehicle === m.p.id)) return 'Only the moving vehicle fires Bounding First Fire';
        return env.query('fire.illegal', { decl: a.decl, mode: 'bounding', side: m.p.side }, null);
      },
      resolve(ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, 'bounding');
        const m = movingVehicle(ctx);
        // Firing anything but the MA in the MPh forfeits the AFPh (3.3.2.2): the BFF tag without ROF kept records it.
        if (m) {
          ctx.emit('sk1.move.state', { state: { ...m.ms, vehicle: { ...m.ms.vehicle, bffFrom: m.ms.vehicle.bffFrom ?? m.ms.hex ?? undefined } } });
          ctx.emit('piece.tagged', { id: m.p.id, tags: { [T3.bff]: true, [T3.bffRof]: null } });
        }
        if (!ctx.state.result) moveInternals.reAskMover(ctx);
      },
    });
    void moveState;
    void movingInfo;
  },
};
