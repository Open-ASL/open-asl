import type { Action, Ctx, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { byId, swHeldBy } from '../common/pieces';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { T } from '../sk1/status';
import type { IftResult } from '../common/statics';
import { moveState } from '../sk1/movement';
import { pieceOf, setTags } from '../sk1/status';
import { T3, isCe, isWreck, vehicle } from './status';

/*
 * What happens to a vehicle (SK4 7.10, 3.2.3, 3.1 g): Shock and Unconfirmed Kill with their Rally
 * Phase recuperation, Stun and STUN (Recall), Immobilization, wrecks, and how a Crew Exposed crew
 * takes an IFT result. The To Kill module decides which of these a hit causes; Infantry fire on a
 * CE crew comes here too.
 */

export type VehicleEffect = 'wreck' | 'immobilized' | 'shock' | 'stun' | 'STUN' | 'bu';

/** A vehicle that is Shocked, Stunned, Immobilized or wrecked while moving comes to a halt (SK4 7.10). */
export function haltMover(ctx: Ctx, vehicleId: PieceId) {
  const ms = moveState(ctx);
  if (!ms?.vehicle || ms.units[0] !== vehicleId) return;
  ctx.emit('sk1.move.state', { state: { ...ms, halted: true, vehicle: { ...ms.vehicle, stopped: true, started: false, freeStop: false } } });
}

/** Apply an effect to a vehicle and say so (`by`: what caused it). */
export function applyVehicleEffect(ctx: Ctx, vehicleId: PieceId, effect: VehicleEffect, by: string) {
  const p = pieceOf(ctx, vehicleId);
  if (isWreck(p)) return;
  const d = vehicle(ctx, p)!;
  switch (effect) {
    case 'wreck': {
      const vp = ctx.query('vp.casualty', { unit: vehicleId }, 0);
      setTags(ctx, vehicleId, { [T3.wreck]: true, [T3.motion]: null, [T3.ce]: null, [T3.shock]: null, [T3.stun]: null, [T3.bff]: null, fire: null, acq: null, acqHex: null, acqUnits: null, acqLevel: null });
      ctx.emit('sk3.vehicle.wrecked', { vehicle: vehicleId, by });
      ctx.emit('sk1.casualty', { unit: vehicleId, side: p.side, kind: 'eliminated', defId: p.defId, vp, turn: ctx.state.turn, phase: ctx.state.phase, reason: by });
      haltMover(ctx, vehicleId);
      break;
    }
    case 'immobilized':
      setTags(ctx, vehicleId, { [T3.immob]: true, [T3.motion]: null, [T3.bog]: null });
      ctx.emit('sk3.vehicle.status', { vehicle: vehicleId, status: 'immobilized', by });
      haltMover(ctx, vehicleId);
      break;
    case 'shock':
      // A Shocked AFV's crew can do nothing; if CE they Button Up at once (7.10). Shocked again: a UK counter flips back to Shock.
      setTags(ctx, vehicleId, { [T3.shock]: 'shock', [T3.ce]: null, [T3.motion]: null });
      ctx.emit('sk3.vehicle.status', { vehicle: vehicleId, status: 'shock', by });
      haltMover(ctx, vehicleId);
      break;
    case 'stun': {
      // A second Stun (or any on a One Man Turret) is a STUN with Recall (7.10).
      const d = vehicle(ctx, p)!;
      if (p.tags[T3.stun] !== undefined || d.turret === '1MT') {
        applyVehicleEffect(ctx, vehicleId, 'STUN', by);
        return;
      }
      setTags(ctx, vehicleId, { [T3.stun]: 'fresh', [T3.ce]: null, [T3.motion]: null });
      ctx.emit('sk3.vehicle.status', { vehicle: vehicleId, status: 'stun', by });
      haltMover(ctx, vehicleId);
      break;
    }
    case 'STUN':
      setTags(ctx, vehicleId, { [T3.stun]: 'fresh', [T3.recall]: true, [T3.ce]: null, [T3.motion]: null });
      ctx.emit('sk3.vehicle.status', { vehicle: vehicleId, status: 'STUN', by });
      haltMover(ctx, vehicleId);
      break;
    case 'bu':
      if (isCe(p) && d.openTopped) {
        // An Open-Topped crew stays CE under a Pin, but counts as pinned for the Player Turn (7.13).
        setTags(ctx, vehicleId, { otPinned: true });
        ctx.emit('sk3.vehicle.status', { vehicle: vehicleId, status: 'pinned', by });
      } else if (isCe(p)) {
        setTags(ctx, vehicleId, { [T3.ce]: null });
        ctx.emit('sk3.vehicle.status', { vehicle: vehicleId, status: 'bu', by });
      }
      break;
  }
}

/**
 * A Crew Exposed crew takes an IFT result (SK4 3.2.3, 7.10): a KIA or K Stuns the AFV with Recall
 * (STUN); a failed MC Stuns it; an original 12 on the MC is a STUN; a pin Buttons it Up; a PTC
 * failed Buttons it Up (a pinned CE crew must BU, 3.2.3).
 */
export function crewTakesResult(ctx: Ctx, vehicleId: PieceId, res: IftResult, reason: string) {
  const p = pieceOf(ctx, vehicleId);
  if (!isCe(p) || isWreck(p)) return;
  const d = vehicle(ctx, p)!;
  switch (res.kind) {
    case 'none':
      return;
    case 'KIA':
    case 'K':
      applyVehicleEffect(ctx, vehicleId, 'STUN', `${reason}: ${res.kind} on the CE crew`);
      return;
    case 'PTC': {
      const roll = ctx.roll(`PTC for the crew of ${vehicleId}`);
      const passed = roll.total <= d.crewMorale;
      ctx.emit('sk3.vehicle.check', { vehicle: vehicleId, kind: 'PTC', dr: roll.dice as [number, number], morale: d.crewMorale, passed, reason });
      if (!passed) applyVehicleEffect(ctx, vehicleId, 'bu', `${reason}: pinned crew`);
      return;
    }
    case 'NMC':
    case 'MC': {
      const roll = ctx.roll(`${res.n ? `${res.n}MC` : 'NMC'} for the crew of ${vehicleId}`);
      const final = roll.total + (res.n ?? 0);
      const passed = final <= d.crewMorale;
      ctx.emit('sk3.vehicle.check', { vehicle: vehicleId, kind: 'MC', dr: roll.dice as [number, number], mod: res.n ?? 0, morale: d.crewMorale, passed, reason });
      if (roll.total === 12) applyVehicleEffect(ctx, vehicleId, 'STUN', `${reason}: the CE crew rolled 12 on its MC`);
      else if (!passed) applyVehicleEffect(ctx, vehicleId, 'stun', `${reason}: the CE crew failed its MC`);
      else if (final === d.crewMorale) applyVehicleEffect(ctx, vehicleId, 'bu', `${reason}: the CE crew pinned`);
      return;
    }
  }
}

/** Possible Shock (SK4 7.10): a NTC on the crew's morale; failure Shocks the AFV. */
export function possibleShock(ctx: Ctx, vehicleId: PieceId, reason: string): boolean {
  const p = pieceOf(ctx, vehicleId);
  const d = vehicle(ctx, p)!;
  const roll = ctx.roll(`Possible Shock: NTC for ${vehicleId}`);
  const passed = roll.total <= d.crewMorale;
  ctx.emit('sk3.vehicle.check', { vehicle: vehicleId, kind: 'NTC', dr: roll.dice as [number, number], morale: d.crewMorale, passed, reason });
  if (!passed) applyVehicleEffect(ctx, vehicleId, 'shock', reason);
  return !passed;
}

/** Why a vehicle may not try to repair a weapon now (SK4 3.1 c, 7.2, 7.8), or null. `weapon`: 'ma' or a MG piece id. */
export function repairIllegal(env: QueryEnv, vehicleId: PieceId, weapon: PieceId | 'ma', side: string): string | null {
  const p = env.state.pieces[vehicleId];
  const d = p && vehicle(env, p);
  if (!p || !d) return 'Not a vehicle';
  if (p.side !== side) return 'Not your vehicle';
  if (env.state.phase !== 'RPh') return 'Not the Rally Phase';
  if (isWreck(p)) return 'A wreck repairs nothing';
  // Not while Shocked or Unconfirmed Kill (7.2).
  if (p.tags[T3.shock] !== undefined) return 'A Shocked crew cannot repair';
  if (weapon === 'ma') {
    if (!d.ma) return 'The vehicle has no Main Armament';
    if (p.tags[T3.maDisabled]) return 'The Main Armament is disabled for good';
    if (!p.tags[T.malf]) return 'The Main Armament is not malfunctioned';
    if (p.tags[REPAIR_TRIED + 'ma']) return 'Already attempted this Rally Phase';
    return null;
  }
  const w = env.state.pieces[weapon];
  if (!w || w.loc.kind !== 'held' || w.loc.by !== vehicleId) return 'Not a weapon of this vehicle';
  const wd = w && (env.statics as { counters: Record<string, { kind: string; type?: string; fixed?: boolean }> }).counters[w.defId];
  if (!wd || wd.kind !== 'sw' || !wd.fixed) return 'Not a vehicular machine gun';
  if (w.tags[T3.mgDisabled]) return 'That machine gun is disabled for good';
  if (!w.tags[T.malf]) return 'That machine gun is not malfunctioned';
  // An AAMG is repaired only by a CE crew (7.8).
  if (wd.type === 'AAMG' && !isCe(p)) return 'The AAMG is repaired only while Crew Exposed';
  if (w.tags[REPAIR_TRIED]) return 'Already attempted this Rally Phase';
  return null;
}
const REPAIR_TRIED = 'repairTried_';

export const vehicleStatusModule: RuleModule = {
  id: 'sk3.vehicleStatus',
  ref: 'SK4 3.1 g, 3.2.3, 7.10',
  summary: 'Shock/UK recuperation, Stun and Recall, Immobilization and wrecks.',
  requires: ['sk1.rally', 'sk3.vehicles'],
  install(r) {
    r.event<{ vehicle: PieceId; by: string }>({ type: 'sk3.vehicle.wrecked', apply() {} });
    r.event<{ vehicle: PieceId; status: 'immobilized' | 'shock' | 'stun' | 'STUN' | 'bu' | 'uk' | 'recovered'; by: string }>({ type: 'sk3.vehicle.status', apply() {} });
    r.event<{ vehicle: PieceId; kind: 'MC' | 'PTC' | 'NTC'; dr: [number, number]; mod?: number; morale: number; passed: boolean; reason: string }>({ type: 'sk3.vehicle.check', apply() {} });
    r.event<{ vehicle: PieceId; dr: number; from: 'shock' | 'uk'; result: 'recovered' | 'uk' | 'wreck' }>({ type: 'sk3.vehicle.recuperation', apply() {} });

    // RPh step g (SK4 3.1): every Shocked AFV rolls for recuperation, both sides.
    r.on<{ phase: string }>({
      id: 'sk3.vehicleStatus.recuperation',
      event: 'turn.phaseStarted',
      priority: 5,
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        for (const p of Object.values(ctx.state.pieces).filter((x) => x.tags[T3.shock] !== undefined && !isWreck(x)).sort(byId)) {
          const from = p.tags[T3.shock] as 'shock' | 'uk';
          const dr = ctx.roll(`Shock recuperation for ${p.id}`, 1).dice[0]!;
          if (from === 'shock') {
            if (dr <= 2) {
              setTags(ctx, p.id, { [T3.shock]: null });
              ctx.emit('sk3.vehicle.recuperation', { vehicle: p.id, dr, from, result: 'recovered' });
            } else {
              setTags(ctx, p.id, { [T3.shock]: 'uk' });
              ctx.emit('sk3.vehicle.recuperation', { vehicle: p.id, dr, from, result: 'uk' });
            }
          } else if (dr <= 3) {
            setTags(ctx, p.id, { [T3.shock]: null });
            ctx.emit('sk3.vehicle.recuperation', { vehicle: p.id, dr, from, result: 'recovered' });
          } else {
            ctx.emit('sk3.vehicle.recuperation', { vehicle: p.id, dr, from, result: 'wreck' });
            applyVehicleEffect(ctx, p.id, 'wreck', 'Unconfirmed Kill');
          }
        }
      },
    });
    // End of the Player Turn: a Stun counter flips to its +1 side (7.10).
    r.on<{ phase: string }>({
      id: 'sk3.vehicleStatus.stun-flip',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        for (const p of Object.values(ctx.state.pieces).filter((x) => x.tags[T3.stun] === 'fresh').sort(byId)) setTags(ctx, p.id, { [T3.stun]: 'plus1' });
      },
    });
    // RPh step c (SK4 3.1): a Good Order vehicle may try to repair each broken MG or its MA: a dr of 1 repairs, a 6 disables it for good (a disabled MA Recalls the vehicle, 7.10).
    r.event<{ vehicle: PieceId; weapon: PieceId | 'ma'; dr: number; result: 'repaired' | 'disabled' | 'none' }>({ type: 'sk3.vehicle.repair', apply() {} });
    r.action<Action & { type: 'vehicle.repair'; vehicle: PieceId; weapon: PieceId | 'ma' }>({
      type: 'vehicle.repair',
      decisionKinds: [PHASE_DECISION],
      legal(env, d) {
        if (env.state.phase !== 'RPh') return [];
        const out: { type: 'vehicle.repair'; vehicle: PieceId; weapon: PieceId | 'ma' }[] = [];
        for (const p of Object.values(env.state.pieces).filter((x) => x.side === d.owner && vehicle(env, x)).sort(byId)) {
          if (!repairIllegal(env, p.id, 'ma', d.owner)) out.push({ type: 'vehicle.repair', vehicle: p.id, weapon: 'ma' });
          for (const w of swHeldBy(env.state, p.id).sort(byId)) if (!repairIllegal(env, p.id, w.id, d.owner)) out.push({ type: 'vehicle.repair', vehicle: p.id, weapon: w.id });
        }
        return out;
      },
      validate: (env, a) => repairIllegal(env, a.vehicle, a.weapon, a.side),
      resolve(ctx, a) {
        const dr = ctx.roll(`Repair ${a.weapon === 'ma' ? 'the MA' : a.weapon} of ${a.vehicle}`, 1).total;
        const target = a.weapon === 'ma' ? a.vehicle : a.weapon;
        setTags(ctx, target, { [REPAIR_TRIED + (a.weapon === 'ma' ? 'ma' : '')]: true });
        let result: 'repaired' | 'disabled' | 'none' = 'none';
        if (dr === 1) {
          setTags(ctx, target, { [T.malf]: null });
          result = 'repaired';
        } else if (dr === 6) {
          result = 'disabled';
          if (a.weapon === 'ma') setTags(ctx, a.vehicle, { [T.malf]: null, [T3.maDisabled]: true, [T3.recall]: true });
          else setTags(ctx, target, { [T.malf]: null, [T3.mgDisabled]: true });
        }
        ctx.emit('sk3.vehicle.repair', { vehicle: a.vehicle, weapon: a.weapon, dr, result });
        ctx.popDecision();
        askPhaseOwner(ctx, a.side);
      },
    });
    r.on<{ phase: string }>({
      id: 'sk3.vehicleStatus.rph-end',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        for (const p of Object.values(ctx.state.pieces).sort(byId)) {
          const keys = Object.keys(p.tags).filter((k) => k.startsWith(REPAIR_TRIED));
          if (keys.length) setTags(ctx, p.id, Object.fromEntries(keys.map((k) => [k, null])));
        }
      },
    });
    // Crew morale: the inherent crew checks on the nationality's best elite MMC morale (7.9).
    r.contribute({
      id: 'sk3.morale.crew',
      query: 'unit.morale',
      layer: 5,
      when: ({ unit }, env) => !!vehicle(env, pieceOf(env, unit)),
      apply: (_v, { unit }, env) => vehicle(env, pieceOf(env, unit))!.crewMorale,
    });
  },
};
