import { hexOfLoc } from '../common/location';
import type { Action, Piece, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { defOf, hexOf, statics, swHeldBy } from '../common/pieces';
import { PHASE_DECISION } from '../common/turn';
import { FP, firedAt, isRofShot, type FireAttackCtx, type FireDeclaration, type FireMode, type FirePart, type ResolveFireFn } from '../sk1/fire';
import { moveState, movingInfo, moveInternals } from '../sk1/movement';
import { fireMarker, pieceOf, setTags, sw, vehicleIfe } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';
import { caChangeDrm, inCoveredArc, nearestSpine, spineChange } from '../sk2/arc';
import { OP, type OrdnanceFireFn, type ShotCtx } from '../sk2/ordnance';
import { ACQ_CLEAR, T2, coveredArc, ordnanceOf } from '../sk2/status';
import { T3, crewCanAct, inMotion, isCe, isWreck, tcaOf, vcaOf, vehicle, type VehicleMgKind } from './status';
import { movingVehicle } from './vehicleMove';
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
// has fired after a turn, the vehicle's other turret weapons firing in that TCA this phase pay the same penalty (ASL
// D3.51 Maintaining CA; SK4 is silent). The turn this phase is kept on the vehicle: the phase, the hexspines, and the
// turret weapons that have paid for it.
const TURN = { phase: 'tcaTurnPhase', spines: 'tcaTurnSpines', paid: 'tcaTurnPaid' } as const;
const phaseKey = (env: QueryEnv) => `${env.state.turn}${env.state.attacker}${env.state.phase}`;
const turreted = (env: QueryEnv, v: Piece) => (vehicle(env, v)?.turret ?? 'NT') !== 'NT';

/** The turret turn a vehicle made this phase, if any, and which of its turret weapons have paid for it. */
function turnThisPhase(env: QueryEnv, v: Piece): { spines: number; paid: string[] } | null {
  if (v.tags[TURN.phase] !== phaseKey(env)) return null;
  return { spines: (v.tags[TURN.spines] as number | undefined) ?? 0, paid: String(v.tags[TURN.paid] ?? '').split(',').filter(Boolean) };
}

/** Case 8 for a turret turned `spines` hexspines: by turret type, doubled for a vehicle in a building. */
function turretDrm(env: QueryEnv, v: Piece, spines: number): number {
  const hex = hexOf(env.state, v);
  const building = !!hex && (!!statics(env).map.hex(hex)?.buildingId || terrainOf(env, hex).id.startsWith('building'));
  return caChangeDrm(vehicle(env, v)!.turret, spines) * (building ? 2 : 1);
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

/** Why a vehicle's MGs (and its MA's IFE with them) may not fire this declaration, or null. */
export function vehicleMgIllegal(env: QueryEnv, decl: FireDeclaration, mode: FireMode, side: string, moving?: PieceId[]): string | null {
  const mgs = decl.sw.map((id) => ({ id, mg: vehicleMgOf(env, id) })).filter((x) => x.mg);
  const ife = decl.sw.filter((id) => ifeOf(env, id));
  // The MA's IFE alone: the ordnance rules judge it, but for the Fire Group it may owe the MGs.
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
  if (!crewCanAct(v)) return v.tags[T3.shock] ? 'A Shocked crew cannot fire' : 'A Stunned crew cannot fire this Player Turn';
  const at = hexOf(env.state, v)!;
  const map = statics(env).map;
  const target = map.hex(hexOfLoc(decl.target));
  if (!target) return 'Unknown target hex';
  const me = map.hex(at)!;
  // Turning the turret to fire (SK4 3.2.4: a CMG "may ... change its CA prior to firing (and suffer the resulting ...
  // IFT ... Firer Based penalties)"): the CMG/RMG and the MA's IFE then fire through the new TCA.
  if (decl.tca !== undefined) {
    if (!Number.isInteger(decl.tca) || decl.tca < 0 || decl.tca > 5) return 'The turret turns to a hexspine 0-5';
    if (d.turret === 'NT') return 'This vehicle has no turret: its weapons turn with the hull';
    if (mode === 'bounding') return 'In its MPh a vehicle turns its turret before firing (no Covered Arc change DRM)';
    if (decl.tca === tcaOf(env, v)) return 'The turret already points that way';
    if (!ife.length && !mgs.some((x) => x.mg!.kind === 'cmg' || x.mg!.kind === 'rmg')) return 'Only the turret weapons (CMG, RMG, MA) turn with the turret';
  }
  const tca = decl.tca ?? tcaOf(env, v);
  for (const { id, mg } of mgs) {
    const kind = mg!.kind;
    if (pieceOf(env, id).tags[T3.mgDisabled]) return `The ${kind.toUpperCase()} is disabled`;
    if (kind === 'aamg' && !isCe(v)) return 'The AAMG fires only while Crew Exposed';
    if (d.openTopped && !isCe(v) && kind !== 'bmg') return 'A Buttoned Up Open-Topped AFV fires only its bow MG';
    if (kind === 'cmg' && isCe(v) && (d.turret === 'RST' || d.turret === '1MT')) return 'A Restricted Slow Traverse or One Man Turret cannot fire its CMG while Crew Exposed';
    if (decl.target !== at && kind !== 'aamg') {
      const spine = kind === 'bmg' ? vcaOf(v) : kind === 'rmg' ? (tca + 3) % 6 : tca;
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
    const why = env.query('ordnance.illegal', { shot: { weapon: v.id, target: decl.target, targetType: 'IFE', ...(decl.tca !== undefined ? { ca: decl.tca } : {}) }, mode, side, ...(moving ? { moving } : {}) }, null);
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
    // The MA's IFE in the MGs' Fire Group has fired its MA, as a lone IFE shot does (SK4 6.8, 6.10): it loses any
    // acquisition and has fired other than Smoke this phase.
    r.procedure<ResolveFireFn>(FP.resolve, (next) => (ctx, declared, mode, opts) => {
      const tw = mode === 'bounding' ? null : turretWeapons(ctx, declared.sw);
      let decl = declared;
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
      if (tw && ctx.state.pieces[tw.v.id]?.loc.kind === 'hex') {
        if (decl.caChange && decl.caChange.spines > 0 && decl.caChange.weapon === tw.v.id) {
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
          if (p.tags[TURN.phase] !== undefined) setTags(ctx, p.id, { [TURN.phase]: null, [TURN.spines]: null, [TURN.paid]: null });
      },
    });
    // The MA's To Hit shots: a turn records it; a shot without one pays for an earlier turn by another turret weapon.
    r.procedure<OrdnanceFireFn>(OP.fire, (next) => (ctx, shot, mode, opts) => {
      const g = ctx.state.pieces[shot.weapon];
      const v = g && ordnanceOf(ctx, g)?.vehicle && turreted(ctx, g) && mode !== 'bounding' && shot.targetType !== 'IFE' ? g : null;
      const spines = v && shot.ca !== undefined ? spineChange(coveredArc(v), shot.ca) : 0;
      const out = next!(ctx, shot, mode, opts);
      if (v && ctx.state.pieces[v.id]?.loc.kind === 'hex') {
        if (spines > 0) setTags(ctx, v.id, { [TURN.phase]: phaseKey(ctx), [TURN.spines]: spines, [TURN.paid]: v.id });
        else {
          const turn = turnThisPhase(ctx, pieceOf(ctx, v.id));
          if (turn) setTags(ctx, v.id, { [TURN.paid]: [...new Set([...turn.paid, v.id])].join(',') });
        }
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
      return turreted(env, v) ? owedOn(env, v, [v.id]) : 0;
    };
    r.contribute({
      id: 'sk3.th.maintain-ca',
      query: 'ordnance.thDrm',
      ref: 'ASL D3.51',
      label: (sc: ShotCtx, env: QueryEnv) => `+${owedTh(sc, env)} Covered Arc change (the turret turned earlier this phase)`,
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
