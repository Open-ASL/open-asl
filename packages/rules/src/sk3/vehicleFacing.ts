import type { PieceId, QueryEnv, RuleBuilder, SideId } from '@asl/engine';
import { byId, hexOf, swHeldBy } from '../common/pieces';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import type { FireMode } from '../sk1/fire';
import { phaseOwner } from '../sk1/firePhases';
import { fireMarker, isMalf, pieceOf, setTags } from '../sk1/status';
import { SPINES } from '../sk2/arc';
import { ACQ_CLEAR, T2, firePhaseKey } from '../sk2/status';
import { T3, crewCanAct, inMotion, isWreck, stunWord, tcaOf, vcaOf, vehicle } from './status';
import { hullTurnRefusal } from './vehicleMove';
import { maIllegal } from './vehicleFire';
import { vehicleMgOf } from './vehicleMg';

/*
 * A vehicle's Covered Arcs changed without MP at the end of a fire phase (SK4 3.3.2): "A TCA/VCA may also be changed
 * without MP expenditure ... at the end of any fire phase in which it is still eligible to fire a turret/bow mounted
 * weapon without using Intensive Fire (bow mounted NA for TCA)." So an eligible bow weapon (an NT vehicle's MA, or the
 * BMG) lets the hull turn, and an eligible turret weapon (a turreted MA, or the CMG) the turret. The change comes at the
 * end of the phase, so the vehicle fires no more in it (`caTurned`, as a Gun's CA change, SK4 3.2.4); made in the PFPh
 * it cancels the vehicle's movement for the rest of the Player Turn (`caLocked`; ASLRB C3.22 "even a vehicular Gun",
 * where SK is silent). Both tags come off when the CCPh ends (sk2.guns.cleanup). The other way to turn without MP,
 * firing outside the Covered Arc, is the ordnance rules' (`sk3.vehicleFire.nt-vca`).
 */

export type VehicleFaceAction = { type: 'vehicle.face'; vehicle: PieceId; vca?: number; tca?: number };

const FIRE_PHASES: Record<string, FireMode> = { PFPh: 'prep', DFPh: 'final', AFPh: 'advancing' };

/** Whether the vehicle could still fire the weapon now without Intensive Fire: the MA (the vehicle itself) or one of its MGs. */
function weaponReady(env: QueryEnv, vehicleId: PieceId, weaponId: PieceId, mode: FireMode): boolean {
  const v = env.state.pieces[vehicleId]!;
  if (mode === 'prep' && inMotion(v)) return false;
  if (weaponId === vehicleId) {
    if (fireMarker(v) || v.tags[T2.intensive] || isMalf(v)) return false;
    // Its own hex as the target: only what stops the MA at any target counts here.
    return maIllegal(env, { weapon: v.id, target: hexOf(env.state, v) ?? '', targetType: 'ITT' }, mode) === null;
  }
  const w = env.state.pieces[weaponId]!;
  if (fireMarker(w) || isMalf(w) || w.tags[T3.mgDisabled]) return false;
  // A vehicle that fired anything in its MPh has no MG fire in the AFPh (SK4 3.3.2.2).
  if (mode === 'advancing' && v.tags[T3.bff]) return false;
  return true;
}

/** Why `side` may not turn the vehicle's hull to `vca` and/or its turret to `tca` now, or null. */
export function faceIllegal(env: QueryEnv, a: { vehicle: PieceId; vca?: number; tca?: number }, side: SideId): string | null {
  const v = env.state.pieces[a.vehicle];
  const d = v && vehicle(env, v);
  if (!v || !d) return 'Not a vehicle';
  if (v.side !== side) return 'Not your vehicle';
  const mode = FIRE_PHASES[env.state.phase];
  if (!mode || phaseOwner(env) !== side) return 'A vehicle turns without MP only at the end of your own fire phase';
  if (v.loc.kind !== 'hex') return 'The vehicle is not on the map';
  if (isWreck(v)) return 'A wreck does not turn';
  if (!crewCanAct(v)) return v.tags[T3.shock] ? 'A Shocked crew cannot act' : `A ${stunWord(v, 'Stunned')} crew cannot act this Player Turn`;
  if (v.tags[T2.caTurned] === firePhaseKey(env)) return 'It has already turned this phase';
  if (a.vca === undefined && a.tca === undefined) return 'Choose a hexspine for the hull or the turret';
  for (const s of [a.vca, a.tca]) if (s !== undefined && (!Number.isInteger(s) || s < 0 || s >= SPINES)) return 'A Covered Arc is a hexspine 0-5';
  const mgs = swHeldBy(env.state, v.id).map((w) => ({ id: w.id, kind: vehicleMgOf(env, w.id)?.kind })).filter((x) => x.kind);
  const ready = (id: PieceId) => weaponReady(env, v.id, id, mode);
  if (a.vca !== undefined) {
    if (a.vca === vcaOf(v)) return 'The hull already faces that way';
    const never = hullTurnRefusal(env, v);
    if (never) return never;
    const bow = (d.turret === 'NT' && d.ma && ready(v.id)) || mgs.some((x) => x.kind === 'bmg' && ready(x.id));
    if (!bow) return 'Only a vehicle that could still fire a bow-mounted weapon (an NT Main Armament or the BMG) turns its hull at the end of the phase';
  }
  if (a.tca !== undefined) {
    if (d.turret === 'NT') return 'The vehicle has no turret';
    // Turned with the hull, the turret rides round with it (SK4 7.8): it "already points" where the hull would carry it.
    const riding = a.vca === undefined ? tcaOf(env, v) : (tcaOf(env, v) + a.vca - vcaOf(v) + SPINES) % SPINES;
    if (a.tca === riding) return a.vca === undefined ? 'The turret already points that way' : 'The turret rides there with the hull anyway';
    // "bow mounted NA for TCA": only a turret weapon earns the turret its turn.
    const turret = (!!d.ma && ready(v.id)) || mgs.some((x) => (x.kind === 'cmg' || x.kind === 'rmg') && ready(x.id));
    if (!turret) return 'Only a vehicle that could still fire a turret weapon (its Main Armament or CMG) turns its turret at the end of the phase';
  }
  return null;
}

/**
 * Installed by the vehicle fire module (`sk3.vehicleFire`), not as a module of its own: the ruleset version hash is the
 * module list, and live matches are pinned to it.
 */
export function installVehicleFacing(r: RuleBuilder): void {
  r.event<{ vehicle: PieceId; vca?: number; tca?: number; fromVca: number; fromTca: number; noMove?: boolean }>({ type: 'sk3.vehicle.faced', apply() {} });
  r.action<VehicleFaceAction & { side: SideId; decisionId: string }>({
    type: 'vehicle.face',
    decisionKinds: [PHASE_DECISION],
    // Each of the phase owner's vehicles that may turn, to each other hexspine of hull and turret.
    legal(env, d) {
      const out: VehicleFaceAction[] = [];
      if (!FIRE_PHASES[env.state.phase]) return out;
      for (const v of Object.values(env.state.pieces).filter((p) => p.side === d.owner && vehicle(env, p)).sort(byId)) {
        for (let s = 0; s < SPINES; s++) {
          if (!faceIllegal(env, { vehicle: v.id, vca: s }, d.owner)) out.push({ type: 'vehicle.face', vehicle: v.id, vca: s });
          if (!faceIllegal(env, { vehicle: v.id, tca: s }, d.owner)) out.push({ type: 'vehicle.face', vehicle: v.id, tca: s });
        }
      }
      return out;
    },
    validate: (env, a) => faceIllegal(env, a, a.side),
    resolve(ctx, a) {
      const v = pieceOf(ctx, a.vehicle);
      const d = vehicle(ctx, v)!;
      const fromVca = vcaOf(v);
      const fromTca = tcaOf(ctx, v);
      const vca = a.vca ?? fromVca;
      // The turret keeps its place on the hull unless it is pointed too; an NT vehicle's weapons point with the hull.
      const tca = d.turret === 'NT' ? vca : (a.tca ?? (fromTca + vca - fromVca + SPINES) % SPINES);
      ctx.emit('sk3.vehicle.faced', { vehicle: v.id, ...(a.vca !== undefined ? { vca } : {}), ...(a.tca !== undefined ? { tca } : {}), fromVca, fromTca, ...(ctx.state.phase === 'PFPh' ? { noMove: true } : {}) });
      // The MA's Covered Arc moved: its acquisition is lost, as a Gun's (SK4 6.10).
      const maMoved = tca !== fromTca;
      setTags(ctx, v.id, { [T3.vca]: vca, [T2.ca]: tca, [T2.caTurned]: firePhaseKey(ctx), ...(ctx.state.phase === 'PFPh' ? { [T2.caLocked]: true } : {}), ...(maMoved ? ACQ_CLEAR : {}) });
      ctx.popDecision();
      askPhaseOwner(ctx, phaseOwner(ctx));
    },
  });
}
