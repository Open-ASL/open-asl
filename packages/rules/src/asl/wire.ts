import type { Action, Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, isVehicleDef, personnelAt, swHeldBy, unpossessedWeaponsAt } from '../common/pieces';
import { hexOfLoc, isGroundLoc, locOf } from '../common/location';
import { PHASE_DECISION } from '../common/turn';
import { AP, type AdvanceAction, type AdvanceEnterFn } from '../sk1/advance';
import { FP, type AttackResolvedFn } from '../sk1/fire';
import { MOVE_ENTER, MOVE_ENTERED, afterMfExpenditure, moveInternals, ppCarried, remaining, type MoveEnterFn, type MoveEnteredFn, type MoveState } from '../sk1/movement';
import { moveState } from '../sk1/moveState';
import { ROUT_ENTERED, activeRout, mustRoutNow, routEscorts, routInPlace, routMfLeft, routRequirement, routersNow, type RoutEnteredFn } from '../sk1/rout';
import { T, gun, isPinned, mmc, pieceOf, ppOf, setTags, smc } from '../sk1/status';
import { vehicle } from '../sk3/status';
import { removeFortification, revealFortification, shownCounter, wireAt, type FortRecord } from './fortifications';

/*
 * Wire in play (ASLRB B26; full ASL only: neither Starter Kit rulebook has Wire).
 *
 * A unit in a Wire hex is on top of the counter or beneath it (`loc.pos.wire`), one Location either way (B26.32): stacking,
 * targets, CC, leadership and Residual FP are per Location and untouched. Only the rules below read the position.
 * - Entering (B26.4): no MF beyond the hex's COT; every Infantry unit arriving, in any phase, is placed on top. A unit on
 *   top leaves the Location only once beneath: in its MPh or RtPh only (never in the APh), each unit makes a Wire Exit dr
 *   (∆: no leadership or other DRM, A.10) and spends that many MF to go beneath, the rest left to move or rout on. A dr
 *   above the MF left uses the remaining MF and hangs the unit up on top for the rest of that MPh/RtPh. The DEFENDER sees
 *   the dr before he declares First Fire: the dr is one MF expenditure of the stack (A8.12), counted at the largest dr paid.
 *   A unit whose dr uses all its MF is finished there, left behind as a First Fire target as a stopped unit is; one that
 *   was Assault Moving loses Assault Movement and takes FFNAM (A4.61). The MF qualify for FFMO in Open Ground (Wire has no
 *   TEM, B26.3). No dr under Double Time (B26.46), nor for a stack pushing a Gun (C10.3).
 * - A unit that started the turn on top may, after its dr, leave excess PP on top to have the MF it needs (B26.4).
 * - On top (B26.4, B26.45): no entrenchment entered or dug, no DC Placed, no Recovery across the Wire; CC with the units
 *   beneath is allowed. +1 to every attack a unit on top makes, a To Hit DRM for ordnance (B26.31); -1 to a CC attack on
 *   a unit on top, per target as A4.8's TI -1 is.
 * - Rout (B26.41): the dr in the RtPh, spent from the rout MF, no Interdiction for it (only the hex entered is
 *   Interdicted, A10.53); a rout of nothing more than getting beneath is a Low Crawl. A unit that must rout and is held on
 *   the Wire (hung, or left without the MF to reach an allowable rout hex) is eliminated for Failure to Rout. The nearest
 *   shelter counts getting beneath Wire on the way as one MF (A10.531; Q&A to A10.51/B26: `rout.planLeaveMf`).
 * - Hidden Wire (A12.33): a unit entering or leaving its own hidden Wire pays nothing (it is placed beneath at once, and a
 *   unit on top goes beneath with no dr); a unit entering the other side's hidden Wire knows nothing of it and is given no
 *   position. The non-MF restrictions still apply (Q&A [K33] to A12.33): no unit gets beneath it in the APh or under
 *   Double Time (B26.4, B26.46), so it stays on top there; it bars Bypass (`asl/bypass.ts`, found by the attempt); a
 *   vehicle pays its MP and checks for Bog (B26.43), and one that cannot know of it finds it by the attempt. The
 *   positions are redacted while the counter is hidden (`asl.fort.pieceRedact`).
 * - Vehicles (B26.43, D8.21, B26.53): never on or beneath it; +2 MP (fully tracked) or +4 MP (others) on top of the COT
 *   and a Bog Check at +2 to enter, a Bog Check per hexspine to change VCA in it; a fully-tracked vehicle passing a Bog
 *   Check there with a colored dr of 1 removes the Wire.
 * - Removal: a Placed DC's Original KIA (B26.51), the vehicle's colored 1 (B26.53), Clearance (B24.73, `asl/clearance.ts`),
 *   falling rubble (B24.121). With the counter gone every position in the hex goes too.
 * Bypass beside Wire is refused in `asl/bypass.ts` (B26.44). Not here: Cavalry, motorcycles and gliders (B26.42: no such
 * units), VBM (B26.44), FFE (B26.52), Set and Thrown DC (A23.6, A23.7), Minimum Move and Dash (not built; when they are, they
 * never take a unit beneath Wire, B26.4, B26.46), A12.15 (a unit forced back into a Wire Location), Sewer Movement.
 */

export const WIRE_EXT = 'asl.wire';
/** The latest Wire Exit drs of the MPh, for the DEFENDER's First Fire question that follows them (B26.4): gone with the MPh. */
export const WIRE_LAST_EXT = 'asl.wire.last';
interface WireLast {
  hex: HexId;
  /** The moving stack's `trail` length after the dr: the drs are the latest expenditure while it is unchanged. */
  trail: number;
  units: WireExitResult[];
}
/** The decision a mover gets after a Wire Exit dr that excess PP made too high: leave SW on top of the Wire (B26.4). */
export const WIRE_DROP_DECISION = 'wireDrop';

export interface WireRoll {
  unit: PieceId;
  dr: number;
}
interface WireState {
  hex: HexId;
  rolls: WireRoll[];
  /** Units still to decide whether to leave PP on top of the Wire (B26.4). */
  drop: PieceId[];
}
export interface WireExitResult {
  unit: PieceId;
  dr: number;
  mf: number;
  outcome: 'beneath' | 'hung';
}
export type WireExitAction = Action & { type: 'move.wire' };
export type WireDropAction = (Action & { type: 'wire.drop'; unit: PieceId; sw: PieceId[] }) | (Action & { type: 'wire.keep'; unit: PieceId });
/** `leaders`: Good Order leaders stacked with the unit who rout with it (A10.711), named when the dr begins the rout. */
export type RoutWireAction = Action & { type: 'rout.wire'; unit: PieceId; lowCrawl?: true; leaders?: PieceId[] };

/** On top of the Wire of its hex. */
export const onWire = (p: Piece | undefined): boolean => !!p && p.loc.kind === 'hex' && p.loc.pos?.wire === 'on';
/** The Wire counter of a hex as `side` knows it: its own, or one open or revealed (A12.33). */
export function wireKnownTo(env: QueryEnv, hex: HexId, side: SideId | null): FortRecord | null {
  const c = wireAt(env, hex);
  return c && shownCounter(c, side) ? c : null;
}
/** Wire of `side`'s own still hidden from the other side: entering and leaving it costs nothing (A12.33). */
export const ownHiddenWire = (c: FortRecord, side: SideId) => c.side === side && c.hidden && !c.revealed;
/**
 * Wire that holds `p` on top until it gets beneath: Wire known to its side, its own hidden Wire included. Beneath its own
 * hidden Wire it goes for nothing, but it still goes (Q&A [K33] to A12.33: Infantry going beneath hidden Wire is "Wire
 * Exit" and costs no MF; the non-MF restrictions apply, e.g. no CX unit crosses it, B26.46).
 */
function holding(env: QueryEnv, p: Piece): FortRecord | null {
  if (!onWire(p) || p.loc.kind !== 'hex') return null;
  return wireKnownTo(env, p.loc.hex, p.side);
}

const wireState = (env: QueryEnv) => env.state.ext[WIRE_EXT] as WireState | undefined;

/** Set (or with null, clear) the Wire position of pieces standing in `hex`. */
export function setWirePos(ctx: Ctx, ids: PieceId[], hex: HexId, wire: 'on' | 'beneath' | null) {
  for (const id of [...ids].sort()) {
    const p = ctx.state.pieces[id];
    if (!p || p.loc.kind !== 'hex' || p.loc.hex !== hex) continue;
    const { pos: was, ...loc } = p.loc;
    if ((was?.wire ?? null) === wire) continue;
    const pos = { ...(was ?? {}) };
    if (wire) pos.wire = wire;
    else delete pos.wire;
    ctx.emit('piece.moved', { id, loc: Object.keys(pos).length ? { ...loc, pos } : loc });
  }
}

/**
 * Units arriving in `hex` are placed on top of its Wire (B26.4). On their own hidden Wire they go beneath at once for no
 * MF (A12.33), but only where B26.4/B26.46 let a unit get beneath: in its MPh not Double Timing, or its RtPh; in the APh
 * (or under Double Time) they stay on top (Q&A [K33] to A12.33: the non-MF restrictions apply to hidden Wire).
 */
function arrive(ctx: Ctx, units: PieceId[], hex: HexId) {
  const c = wireAt(ctx, hex);
  if (!c) return;
  const phase = ctx.state.phase;
  const free = phase === 'RtPh' || (phase === 'MPh' && !moveState(ctx)?.doubleTime);
  for (const id of [...units].sort()) {
    const p = ctx.state.pieces[id];
    if (!p || p.loc.kind !== 'hex' || p.loc.hex !== hex || isVehicleDef(defOf(ctx, p))) continue;
    // The other side's hidden Wire: a unit that does not know of it passes it freely (A12.33) and gets no position.
    if (!shownCounter(c, p.side)) continue;
    setWirePos(ctx, [id], hex, ownHiddenWire(c, p.side) && free ? 'beneath' : 'on');
  }
}

/** Take a Wire counter off: every position in its hex goes with it. */
export function removeWire(ctx: Ctx, c: FortRecord, reason: string) {
  removeFortification(ctx, c.id, reason);
}

// ---------------------------------------------------------------- B26.4: the Wire Exit dr in the MPh

/** The units of the moving stack on top of the Wire that holds them. */
const stackOnTop = (env: QueryEnv, ms: MoveState): PieceId[] => ms.units.filter((u) => !!holding(env, pieceOf(env, u))).sort();

/** Why the moving stack may not make its Wire Exit dr now (B26.4, B26.46, C10.3), or null. */
export function wireExitIllegal(env: QueryEnv): string | null {
  if (env.state.phase !== 'MPh') return 'Units get beneath Wire only in their MPh or RtPh (ASLRB B26.4)';
  const ms = moveState(env);
  if (!ms || !ms.hex || ms.off) return 'No stack is moving on the map';
  if (ms.vehicle) return 'Vehicles are never placed beneath Wire (ASLRB B26.43)';
  if (ms.halted) return 'The stack has ended its movement';
  if (wireState(env)) return 'Decide first whether to leave PP on top of the Wire';
  const c = wireKnownTo(env, ms.hex, env.state.attacker);
  if (!c || ms.level || ms.sub) return `No Wire in ${ms.hex}`;
  const top = stackOnTop(env, ms);
  if (top.length === 0) return 'No unit of the stack is on top of the Wire';
  if (ms.doubleTime) return 'Infantry may not Double Time in a turn in which they attempt to move beneath Wire (ASLRB B26.46, A4.5)';
  if (ms.manhandle) return 'Units pushing a Gun may never push it under Wire (ASLRB B26.4, C10.3)';
  if (ms.dcPending) return 'Finish the DC placement first';
  return null;
}

/** SW a unit could leave on top of the Wire after its dr (B26.4): not a Gun (C10.3). */
const droppable = (env: QueryEnv, unit: PieceId) => swHeldBy(env.state, unit).filter((s) => !gun(env, s)).sort(byId);

/** The units of the dr: each spends its own dr (or what it has left, hung up), every position set, the stack moved on. */
function settle(ctx: Ctx) {
  const st = wireState(ctx)!;
  const ms = moveState(ctx)!;
  const spent = { ...ms.spent };
  const results: WireExitResult[] = [];
  for (const r of st.rolls) {
    const left = Math.max(0, remaining(ctx, ms, r.unit));
    const fits = r.dr <= left;
    const mf = fits ? r.dr : left;
    spent[r.unit] = (spent[r.unit] ?? 0) + mf;
    results.push({ unit: r.unit, dr: r.dr, mf, outcome: fits ? 'beneath' : 'hung' });
  }
  // A unit that used all its MF (beneath with none left, or hung up) is finished there; it stays a First Fire target in
  // the Location with the stack's other stopped units, and if it was Assault Moving it no longer is (A4.61).
  const finished = results.filter((r) => (spent[r.unit] ?? 0) >= (ms.allowance[r.unit] ?? 0)).map((r) => r.unit);
  const paid = Math.max(0, ...results.map((r) => r.mf));
  const { trenchMove: _t, ...base } = ms;
  void _t;
  const next: MoveState = {
    ...base,
    spent,
    units: ms.units.filter((u) => !finished.includes(u)),
    mfHere: ms.mfHere + paid,
    ...(paid > 0 ? { trail: [...(ms.trail ?? []), { hex: ms.hex!, mp: paid }] } : {}),
    ...(finished.length ? { stopped: [...new Set([...(ms.stopped ?? []), ...finished])] } : {}),
    ...(finished.length && ms.assault ? { assaultVoided: [...new Set([...(ms.assaultVoided ?? []), ...finished])] } : {}),
  };
  ctx.emit('sk1.move.state', { state: next });
  setWirePos(ctx, results.filter((r) => r.outcome === 'beneath').map((r) => r.unit), st.hex, 'beneath');
  for (const u of finished) {
    setTags(ctx, u, { [T.moved]: true });
    for (const s of swHeldBy(ctx.state, u)) setTags(ctx, s.id, { [T.moved]: true });
  }
  ctx.emit('asl.wire.exit', { hex: st.hex, phase: 'MPh', units: results });
  ctx.emit('asl.wire.last', { last: { hex: st.hex, trail: next.trail?.length ?? 0, units: results } });
  ctx.emit('asl.wire.state', { state: null });
  afterMfExpenditure(ctx);
}

function askDrop(ctx: Ctx) {
  const st = wireState(ctx)!;
  const ms = moveState(ctx)!;
  const unit = st.drop[0]!;
  const dr = st.rolls.find((r) => r.unit === unit)!.dr;
  ctx.pushDecision({ kind: WIRE_DROP_DECISION, owner: ctx.state.attacker, deadlineClass: 'interrupt', data: { hex: st.hex, unit, dr, mf: remaining(ctx, ms, unit), sw: droppable(ctx, unit).map((s) => s.id) } });
}

// ---------------------------------------------------------------- the module

export const aslWireModule: RuleModule = {
  id: 'asl.wire',
  ref: 'ASLRB B26, A4.61, A12.33, D8.21',
  summary: 'Wire in play: on top or beneath, the Wire Exit dr in the MPh and RtPh, the +1 from on top, rout and Failure to Rout, DC and vehicles.',
  requires: ['asl.fortifications', 'sk1.movement', 'sk1.rout', 'sk1.advance', 'sk1.fire'],
  install(r) {
    r.event<{ state: WireState | null }>({
      type: 'asl.wire.state',
      apply(d, p) {
        if (p.state) d.ext[WIRE_EXT] = p.state;
        else delete d.ext[WIRE_EXT];
      },
    });
    r.event<{ hex: HexId; phase: 'MPh' | 'RtPh'; units: WireExitResult[]; free?: true }>({ type: 'asl.wire.exit', apply() {} });
    r.event<{ last: WireLast | null }>({
      type: 'asl.wire.last',
      apply(d, p) {
        if (p.last) d.ext[WIRE_LAST_EXT] = p.last;
        else delete d.ext[WIRE_LAST_EXT];
      },
    });
    r.on({
      id: 'asl.wire.lastGone',
      event: 'turn.phaseEnded',
      handler(ctx) {
        if (ctx.state.ext[WIRE_LAST_EXT]) ctx.emit('asl.wire.last', { last: null });
      },
    });
    r.event<{ unit: PieceId; sw: PieceId[]; dr: number }>({ type: 'asl.wire.drop', apply() {} });

    // A unit getting beneath its own hidden Wire for nothing (A12.33) shows the other side nothing.
    r.redact({
      id: 'asl.wire.redact',
      events: ['asl.wire.exit'],
      redactEvent(ev, viewer, env) {
        const c = wireAt(env, (ev.payload as { hex: HexId }).hex);
        return !c || shownCounter(c, viewer) ? ev : null;
      },
    });

    // ---------------------------------------------------------------- arriving on top (B26.4)
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, (next) => (ctx, ms) => {
      if (!ms.vehicle && ms.hex && !ms.level && !ms.sub) arrive(ctx, ms.units, ms.hex);
      next?.(ctx, moveState(ctx) ?? ms);
    });
    r.procedure<AdvanceEnterFn>(AP.enter, (next) => (ctx, a: AdvanceAction) => {
      const was = new Map(a.units.map((u) => [u, locOf(ctx.state, pieceOf(ctx, u))]));
      next?.(ctx, a);
      if (!isGroundLoc(a.to)) return;
      // Only units that entered the hex: an advance within the hex (into or out of its entrenchment) keeps the position.
      arrive(ctx, a.units.filter((u) => was.get(u) !== a.to), hexOfLoc(a.to));
    });
    r.procedure<RoutEnteredFn>(ROUT_ENTERED, (next) => (ctx, units, loc, beneath) => {
      if (isGroundLoc(loc)) arrive(ctx, units, hexOfLoc(loc));
      next?.(ctx, units, loc, beneath);
    });
    // With the counter gone (Clearance, a DC, a vehicle, falling rubble), so are the positions in its hex.
    r.on<{ hex: HexId; kind: string }>({
      id: 'asl.wire.removed',
      event: 'asl.fort.removed',
      handler(ctx, ev) {
        if (ev.payload.kind !== 'wire') return;
        const hex = ev.payload.hex;
        setWirePos(ctx, [...personnelAt(ctx, hex).map((p) => p.id), ...unpossessedWeaponsAt(ctx, hex).map((w) => w.id)], hex, null);
      },
    });

    // ---------------------------------------------------------------- B26.4: the Wire Exit dr in the MPh
    r.action<WireExitAction>({
      type: 'move.wire',
      decisionKinds: [PHASE_DECISION],
      legal: (env) => (moveState(env) && !wireExitIllegal(env) ? [{ type: 'move.wire' }] : []),
      validate: (env) => wireExitIllegal(env),
      resolve(ctx) {
        const ms = moveState(ctx)!;
        const hex = ms.hex!;
        const c = wireAt(ctx, hex)!;
        if (ownHiddenWire(c, ctx.state.attacker)) {
          // Its own hidden Wire: beneath for no MF and no dr, and no expenditure for the other side to see (A12.33).
          const top = ms.units.filter((u) => onWire(pieceOf(ctx, u))).sort();
          setWirePos(ctx, top, hex, 'beneath');
          ctx.emit('asl.wire.exit', { hex, phase: 'MPh', units: top.map((unit) => ({ unit, dr: 0, mf: 0, outcome: 'beneath' as const })), free: true });
          moveInternals.reAskMover(ctx);
          return;
        }
        // One dr per unit on top, made at once (∆: no leadership or other DRM, A.10).
        const rolls = stackOnTop(ctx, ms).map((unit) => ({ unit, dr: ctx.roll(`Wire Exit dr: ${unit} (ASLRB B26.4)`, 1).total }));
        // A unit that started the turn on the Wire (it has entered no hex this MPh) and whose excess PP made the dr too
        // high may now leave PP on top (B26.4).
        const drop = ms.hexesEntered === 0 ? rolls.filter((x) => x.dr > remaining(ctx, ms, x.unit) && droppable(ctx, x.unit).length > 0 && x.dr <= remaining(ctx, ms, x.unit) + ppCarried(ctx, x.unit)).map((x) => x.unit) : [];
        ctx.emit('asl.wire.state', { state: { hex, rolls, drop } });
        if (drop.length) askDrop(ctx);
        else settle(ctx);
      },
    });
    const dropDef = {
      decisionKinds: [WIRE_DROP_DECISION],
      legal(env: QueryEnv, d: Decision): WireDropAction[] {
        const unit = d.data?.['unit'] as PieceId;
        const sws = (d.data?.['sw'] as PieceId[] | undefined) ?? [];
        const ms = moveState(env);
        if (!ms || !unit) return [];
        // The fewest SW (most PP first) that free the MF the dr needs; any choice may be made by hand.
        const dr = d.data?.['dr'] as number;
        const pick: PieceId[] = [];
        let freed = 0;
        for (const s of [...sws].sort((a, b) => ppOf(env, pieceOf(env, b)) - ppOf(env, pieceOf(env, a)) || (a < b ? -1 : 1))) {
          if (remaining(env, ms, unit) + freed >= dr) break;
          pick.push(s);
          freed += ppOf(env, pieceOf(env, s));
        }
        return [{ type: 'wire.keep', unit } as WireDropAction, ...(pick.length ? [{ type: 'wire.drop', unit, sw: pick } as WireDropAction] : [])];
      },
      validate(_env: QueryEnv, a: WireDropAction, d: Decision) {
        if (a.unit !== d.data?.['unit']) return 'Not the unit whose dr is being decided';
        if (a.type === 'wire.keep') return null;
        const sws = (d.data?.['sw'] as PieceId[] | undefined) ?? [];
        if (!a.sw.length || a.sw.some((s) => !sws.includes(s)) || new Set(a.sw).size !== a.sw.length) return 'Leave SW the unit carries (not a Gun: ASLRB C10.3)';
        return null;
      },
      resolve(ctx: Ctx, a: WireDropAction, d: Decision) {
        const st = wireState(ctx)!;
        if (a.type === 'wire.drop') {
          for (const s of [...a.sw].sort()) ctx.emit('piece.moved', { id: s, loc: { kind: 'hex', hex: st.hex, pos: { wire: 'on' } } });
          const ms = moveState(ctx)!;
          ctx.emit('sk1.move.state', { state: { ...ms, allowance: { ...ms.allowance, [a.unit]: ctx.query('unit.mf', { unit: a.unit, stack: ms.units, doubleTime: ms.doubleTime }, 0) } } });
          ctx.emit('asl.wire.drop', { unit: a.unit, sw: a.sw, dr: st.rolls.find((x) => x.unit === a.unit)!.dr });
        }
        ctx.popDecision(d.id);
        const rest = st.drop.filter((u) => u !== a.unit);
        ctx.emit('asl.wire.state', { state: { ...st, drop: rest } });
        if (rest.length) askDrop(ctx);
        else settle(ctx);
      },
    };
    r.action<WireDropAction>({ type: 'wire.drop', decisionKinds: dropDef.decisionKinds, legal: dropDef.legal, validate: dropDef.validate, resolve: dropDef.resolve });
    // Keeping every SW: the unit stays hung up on top (its options are listed under `wire.drop`).
    r.action<WireDropAction>({ type: 'wire.keep', decisionKinds: dropDef.decisionKinds, validate: dropDef.validate, resolve: dropDef.resolve });

    // Units on top that may still roll: an Assault Moving stack is not finished there while one of them may.
    r.contribute({ id: 'asl.wire.moreToDo', query: 'move.moreToDo', ref: 'ASLRB B26.4', apply: (v, _c, env) => v || !wireExitIllegal(env) });
    // Leaving the Location from on top: only once beneath the Wire (B26.4).
    const topRefusal = (env: QueryEnv, ms: MoveState): string | null => {
      const top = stackOnTop(env, ms);
      return top.length ? `${top.join(', ')} ${top.length === 1 ? 'is' : 'are'} on top of the Wire in ${ms.hex}: get beneath it first with the Wire Exit dr (ASLRB B26.4)` : null;
    };
    r.contribute({
      id: 'asl.wire.stepIllegal',
      query: 'move.stepIllegal',
      ref: 'ASLRB B26.4',
      apply(v, { ms, to, beneath }, env) {
        if (v || ms.vehicle || !ms.hex) return v;
        const top = topRefusal(env, ms);
        if (top) return top;
        // Straight beneath an entrenchment of a Wire hex: units entering are on top of the Wire, which bars it (B26.4).
        if (beneath && isGroundLoc(to)) {
          const c = wireKnownTo(env, hexOfLoc(to), env.state.attacker);
          if (c && !(ownHiddenWire(c, env.state.attacker) && !ms.doubleTime)) return 'Units entering a Wire Location are placed on top of the Wire, and cannot enter an entrenchment until beneath it (ASLRB B26.4)';
        }
        return null;
      },
    });
    r.contribute({ id: 'asl.wire.bypassSteps', query: 'move.bypassSteps', ref: 'ASLRB B26.4', layer: 900, apply: (v, { ms }, env) => (ms.hex && topRefusal(env, ms) ? [] : v) });
    r.contribute({
      id: 'asl.wire.bypassIllegal',
      query: 'move.bypassIllegal',
      ref: 'ASLRB B26.4',
      apply: (v, { ms }, env) => v ?? (ms.hex && !ms.bypass ? topRefusal(env, ms) : null),
    });
    // A Wire Exit dr that used an Assault Moving unit's last MF voids its Assault Movement: FFNAM against it alone (A4.61).
    r.contribute({
      id: 'asl.wire.ffnam',
      query: 'fire.unitDrm',
      ref: 'ASLRB B26.4, A4.61',
      label: '-1 FFNAM (Assault Movement voided by its Wire Exit dr)',
      when: ({ attack, unit }, env) => !!attack.moving && attack.moving.assault && !attack.moving.vehicle && !attack.moving.pinned && !!moveState(env)?.assaultVoided?.includes(unit) && !isPinned(pieceOf(env, unit)),
      apply: (v) => v - 1,
    });

    // ---------------------------------------------------------------- B26.4: what a unit on top may not do
    r.contribute({
      id: 'asl.wire.dc',
      query: 'dc.placeIllegal',
      ref: 'ASLRB B26.45',
      apply: (v, { placer }, env) => v ?? (holding(env, pieceOf(env, placer)) ? `${placer} is on top of the Wire: Infantry there may not Place a DC (ASLRB B26.45)` : null),
    });
    r.contribute({
      id: 'asl.wire.recover',
      query: 'recover.illegal',
      ref: 'ASLRB B26.4, A4.44',
      apply(v, { unit, sw }, env) {
        if (v) return v;
        const u = env.state.pieces[unit];
        const w = env.state.pieces[sw];
        if (!u || !w || u.loc.kind !== 'hex' || w.loc.kind !== 'hex' || !wireAt(env, u.loc.hex)) return null;
        const uOn = u.loc.pos?.wire === 'on';
        const wOn = w.loc.pos?.wire === 'on';
        if (uOn === wOn) return null;
        return wOn ? 'The weapon lies on top of the Wire: a unit beneath it cannot Recover it (ASLRB B26.4)' : 'The weapon lies beneath the Wire: a unit on top of it cannot Recover it (ASLRB B26.4)';
      },
    });
    r.contribute({
      id: 'asl.wire.advance',
      query: 'advance.illegal',
      ref: 'ASLRB B26.4',
      apply(v, { units, to, side, beneath }, env) {
        if (v) return v;
        // A unit on top stays there until it gets beneath, which it may not do in the APh: no advance out of the hex.
        const leaving = units.map((u) => pieceOf(env, u)).filter((p) => onWire(p) && p.loc.kind === 'hex' && p.loc.hex !== hexOfLoc(to));
        if (leaving.length) return `${leaving.map((p) => p.id).join(', ')} ${leaving.length > 1 ? 'are' : 'is'} on top of the Wire: no advance out of the Wire Location, as no unit gets beneath the Wire in the APh (ASLRB B26.4)`;
        if (!beneath || !isGroundLoc(to)) return v;
        // Its own hidden Wire too: no unit gets beneath Wire in the APh (B26.4; Q&A [K33] to A12.33).
        const c = wireKnownTo(env, hexOfLoc(to), side);
        if (!c) return null;
        const ps = units.map((u) => pieceOf(env, u));
        const within = ps.every((p) => locOf(env.state, p) === to);
        if (!within) return 'An advance into a Wire Location arrives on top of the Wire, and so not beneath an entrenchment (ASLRB B26.4)';
        return ps.some(onWire) ? 'Units on top of the Wire cannot enter an entrenchment (ASLRB B26.4)' : null;
      },
    });
    r.contribute({
      id: 'asl.wire.routBeneath',
      query: 'rout.beneath',
      ref: 'ASLRB B26.4',
      // After the entrenchment module has offered the step (it applies first, at the default layer).
      layer: 900,
      apply(v, { unit, to }, env) {
        if (v === null || typeof v === 'string' || !isGroundLoc(to)) return v;
        const side = pieceOf(env, unit).side;
        const c = wireKnownTo(env, hexOfLoc(to), side);
        return c && !ownHiddenWire(c, side) ? 'A routing unit entering a Wire Location is on top of the Wire, and cannot rout beneath an entrenchment there (ASLRB B26.4)' : v;
      },
    });

    // ---------------------------------------------------------------- B26.31: the +1 from on top, the -1 in CC
    const wireFirer = (env: QueryEnv, id: PieceId) => {
      const p = env.state.pieces[id];
      return !!p && onWire(p) && !!(mmc(env, p) || smc(env, p));
    };
    r.contribute({
      id: 'asl.wire.firer',
      query: 'fire.drm',
      ref: 'ASLRB B26.31',
      label: '+1 firer on Wire',
      // Ordnance takes it on its To Hit DR (below); an ordnance hit's IFT DR does not take it again.
      when: ({ attack }, env) => !attack.ordnance && attack.parts.some((p) => wireFirer(env, p.firer)),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'asl.wire.firer.th',
      query: 'ordnance.thDrm',
      ref: 'ASLRB B26.31',
      label: '+1 firer on Wire',
      when: (sc, env) => wireFirer(env, sc.firer),
      apply: (v) => v + 1,
    });
    // A positive DRM from outside the target Location: it lowers the Residual FP left (A8.26).
    r.contribute({ id: 'asl.wire.residual', query: 'fire.residualOutside', ref: 'ASLRB A8.26, B26.31', apply: (v) => [...v, 'asl.wire.firer'] });
    r.contribute({
      id: 'asl.wire.cc',
      query: 'cc.drm',
      ref: 'ASLRB B26.31',
      label: '+1 attacker on Wire',
      when: ({ attackers }, env) => attackers.some((a) => wireFirer(env, a)),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'asl.wire.ccTarget',
      query: 'cc.targetDrm',
      ref: 'ASLRB B26.31',
      label: '-1 defender on Wire',
      when: ({ target }, env) => wireFirer(env, target),
      apply: (v) => v - 1,
    });

    // ---------------------------------------------------------------- B26.41: rout
    const routHeld = (env: QueryEnv, unit: PieceId) => !!holding(env, pieceOf(env, unit));
    // The nearest shelter (A10.51) counts getting beneath Wire on the way as one MF: the Wire's cost is not ignored (Q&A
    // [K33] to A10.531: a rout does not enter or exit that Fortification, so A10.531's exclusion does not reach it), and
    // the Wire Exit dr is taken as 1 MF for the shortest route (Q&A to A10.51 & B26, Perry Cocke 14 Jun 2000). Its own
    // hidden Wire costs nothing (A12.33); a unit already beneath leaves its own hex freely.
    r.contribute({
      id: 'asl.wire.routPlan',
      query: 'rout.planLeaveMf',
      ref: 'ASLRB A10.51, A10.531, B26.41',
      apply(v, { unit, hex, start }, env) {
        const p = pieceOf(env, unit);
        const c = wireKnownTo(env, hex, p.side);
        if (!c || ownHiddenWire(c, p.side)) return v;
        return start && !onWire(p) ? v : v + 1;
      },
    });
    r.contribute({
      id: 'asl.wire.routFirst',
      query: 'rout.stepFirst',
      ref: 'ASLRB B26.41',
      apply: (v, { unit }, env) => v ?? (routHeld(env, unit) ? 'On top of the Wire: the Wire Exit dr comes first (ASLRB B26.41)' : null),
    });
    r.contribute({
      id: 'asl.wire.routInPlace',
      query: 'rout.inPlace',
      ref: 'ASLRB B26.41',
      apply: (v, { unit }, env) => v || (routHeld(env, unit) && routMfLeft(env, unit) > 0),
    });
    r.action<RoutWireAction>({
      type: 'rout.wire',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const out: RoutWireAction[] = [];
        for (const p of routersNow(env)) {
          if (!routHeld(env, p.id) || routMfLeft(env, p.id) <= 0) continue;
          out.push({ type: 'rout.wire', unit: p.id } as RoutWireAction);
          if (!activeRout(env) && !mustRoutNow(env, p.id)) out.push({ type: 'rout.wire', unit: p.id, lowCrawl: true } as RoutWireAction);
          // A10.711: a leader stacked with it may rout along from the start.
          if (!activeRout(env)) for (const l of routEscorts(env, p.id)) out.push({ type: 'rout.wire', unit: p.id, leaders: [l] } as RoutWireAction);
        }
        return out;
      },
      validate(env, a) {
        if (env.state.phase !== 'RtPh') return 'Units get beneath Wire only in their MPh or RtPh (ASLRB B26.4)';
        const p = env.state.pieces[a.unit];
        if (!p || p.side !== a.side) return 'Not your unit to rout';
        if (!routersNow(env).some((x) => x.id === a.unit)) return 'That unit may not rout now';
        if (!routHeld(env, a.unit)) return 'The unit is not on top of Wire';
        if (routMfLeft(env, a.unit) <= 0) return 'No rout MF left';
        if (a.lowCrawl && activeRout(env)) return 'Low Crawl is the whole rout';
        if (a.lowCrawl && mustRoutNow(env, a.unit)) return 'A unit that must rout has to rout into an allowable rout hex (ASLRB B26.41, A10.5)';
        if (a.leaders?.length) {
          if (activeRout(env)) return 'Leaders join a rout as it begins (ASLRB A10.711)';
          const ok = routEscorts(env, a.unit);
          if (new Set(a.leaders).size !== a.leaders.length) return 'A leader is listed twice';
          const bad = a.leaders.find((l) => !ok.includes(l));
          if (bad) return `${bad} cannot rout with the unit: a non-pinned Good Order leader already stacked with it, once per phase (ASLRB A10.711)`;
        }
        return null;
      },
      resolve(ctx, a) {
        const p = pieceOf(ctx, a.unit);
        const hex = (p.loc as { hex: HexId }).hex;
        const escort = activeRout(ctx)?.unit === a.unit ? activeRout(ctx)!.escort : (a.leaders ?? []);
        const left = routMfLeft(ctx, a.unit, escort);
        const results: WireExitResult[] = [];
        // Its own hidden Wire: beneath for no MF and no dr (A12.33; Q&A [K33]).
        const free = ownHiddenWire(wireAt(ctx, hex)!, p.side);
        // Each unit on top rolls its own dr (B26.4); an escort already beneath has none to make.
        for (const u of [a.unit, ...escort.filter((l) => routHeld(ctx, l))]) {
          if (free) {
            results.push({ unit: u, dr: 0, mf: 0, outcome: 'beneath' });
            continue;
          }
          const dr = ctx.roll(`Wire Exit dr: ${u} (ASLRB B26.41)`, 1).total;
          const fits = dr <= left;
          results.push({ unit: u, dr, mf: fits ? dr : left, outcome: fits ? 'beneath' : 'hung' });
        }
        const own = results[0]!;
        setWirePos(ctx, results.filter((x) => x.outcome === 'beneath').map((x) => x.unit), hex, 'beneath');
        ctx.emit('asl.wire.exit', { hex, phase: 'RtPh', units: results, ...(free ? { free: true as const } : {}) });
        routInPlace(ctx, a.unit, {
          ...(a.leaders?.length && activeRout(ctx)?.unit !== a.unit ? { leaders: a.leaders } : {}),
          cost: own.mf,
          end: own.outcome === 'hung' || !!a.lowCrawl,
          leave: results.slice(1).filter((x) => x.outcome === 'hung').map((x) => x.unit),
          // B26.41: held by the Wire while it must still rout: Failure to Rout.
          failure: (env) => (mustRoutNow(env, a.unit) && routRequirement(env, pieceOf(env, a.unit)) ? 'failure to rout: held by the Wire (ASLRB B26.41)' : null),
        });
      },
    });

    // ---------------------------------------------------------------- B26.51: a Placed DC as a bangalore torpedo
    r.procedure<AttackResolvedFn>(FP.attackResolved, (next) => (ctx, info) => {
      next?.(ctx, info);
      // The Placing unit is always in another Location: a DC is Placed into an ADJACENT one (A23.3; the Japanese same-hex
      // placement, A23.61, waits for the Japanese). "An Original KIA result on the IFT (i.e., an Original DR ≤ 5)": an
      // Original DR ≤ 5 even when Area Fire effects lower the DC's column (Q&A [K33] to B26.51: "An Original 5"); and a DC
      // cannot remove a hidden Wire (same Q&A), one the placing side does not know of.
      if (info.by !== 'dc' || info.malfunctioned || (info.originalDr ?? 13) > 5 || !isGroundLoc(info.target)) return;
      const c = wireAt(ctx, hexOfLoc(info.target));
      if (c && shownCounter(c, info.side ?? ctx.state.attacker)) removeWire(ctx, c, 'a Placed DC: Original DR ≤ 5 (ASLRB B26.51)');
    });

    // ---------------------------------------------------------------- B26.43, B26.53, D8.21: vehicles
    // Wire the vehicle's side knows of, its own hidden Wire included: A12.33's free entry is Infantry's (Q&A [K33] to
    // A12.33: "This is not the case for vehicles"; HIP Wire causes Bog checks). Wire the mover cannot see is found by the
    // attempt (below).
    const vehicleWire = (env: QueryEnv, vid: PieceId, hex: HexId) => wireKnownTo(env, hex, pieceOf(env, vid).side);
    // A vehicle entering Wire it cannot know of: the Wire is revealed (the vehicle at its edge is a Good Order enemy ground
    // unit with a LOS to its Location, A12.33), the step is not taken and nothing is spent, and the vehicle moves on
    // knowing of it, to pay its MP and check for Bog if it enters (B26.43).
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const c = ms.vehicle && isGroundLoc(to) ? wireAt(ctx, hexOfLoc(to)) : null;
      if (!c || shownCounter(c, ctx.state.attacker)) return next?.(ctx, ms, to, cost, woods, extra);
      revealFortification(ctx, c.id, 'attempt');
      ctx.emit('asl.wire.vehicleRefused', { vehicle: ms.units[0]!, hex: c.hex });
      moveInternals.reAskMover(ctx);
    });
    r.event<{ vehicle: PieceId; hex: HexId }>({ type: 'asl.wire.vehicleRefused', apply() {} });
    r.contribute({
      id: 'asl.wire.vehicleMp',
      query: 'vehicle.extraMp',
      ref: 'ASLRB B26.43',
      apply: (v, { vehicle: vid, hex }, env) => (vehicleWire(env, vid, hex) ? v + (vehicle(env, pieceOf(env, vid))?.tracked ? 2 : 4) : v),
    });
    r.contribute({
      id: 'asl.wire.bogIn',
      query: 'vehicle.bogIn',
      ref: 'ASLRB B26.43, D8.21',
      apply: (v, { vehicle: vid, hex }, env) => v || !!vehicleWire(env, vid, hex),
    });
    r.contribute({
      id: 'asl.wire.bogDrm',
      query: 'vehicle.bogDrm',
      ref: 'ASLRB D8.21',
      label: '+2 Wire',
      when: ({ vehicle: vid, hex }, env) => !!vehicleWire(env, vid, hex),
      apply: (v) => v + 2,
    });
    r.on<{ vehicle: PieceId; hex: HexId; dr: [number, number]; bogged: boolean }>({
      id: 'asl.wire.trackedClears',
      event: 'sk3.vehicle.bog',
      handler(ctx, ev) {
        const { vehicle: vid, hex, dr, bogged } = ev.payload;
        if (bogged || dr[1] !== 1 || !vehicle(ctx, pieceOf(ctx, vid))?.tracked) return;
        const c = wireAt(ctx, hex);
        if (c) removeWire(ctx, c, 'a fully-tracked vehicle passed its Bog Check with a colored dr of 1 (ASLRB B26.53)');
      },
    });
  },
};

/** Where the moving stack stands toward the Wire of its hex, for the UI: the units on top, and why the dr is refused. */
export function stackWire(env: QueryEnv, ms: MoveState | undefined): { counter: FortRecord; onTop: PieceId[]; refusal: string | null } | null {
  if (!ms?.hex) return null;
  const c = wireKnownTo(env, ms.hex, env.state.attacker);
  return c ? { counter: c, onTop: ms.units.filter((u) => onWire(pieceOf(env, u))), refusal: wireExitIllegal(env) } : null;
}

/** The Wire Exit drs the moving stack has just made, while they are its latest expenditure (B26.4: the DEFENDER sees them). */
export function lastWireExit(env: QueryEnv): WireExitResult[] | null {
  const last = env.state.ext[WIRE_LAST_EXT] as WireLast | undefined;
  const ms = moveState(env);
  return last && ms && ms.hex === last.hex && (ms.trail?.length ?? 0) === last.trail ? last.units : null;
}
