import type { Ctx, Piece, PieceId, RuleModule } from '@asl/engine';
import { hexOf, otherSide, statics } from '../common/pieces';
import type { IftResult } from '../common/statics';
import { FP, iftColumn, type FireDeclaration, type FireMode, type FireOutcome, type ResolveFireFn } from '../sk1/fire';
import { FPP, type ResolveDcFn } from '../sk1/firePhases';
import { T, mmc, pieceOf, setTags, sw } from '../sk1/status';
import { facingOf, hitLocation } from './facing';
import { T3, isCe, isImmobile, inMotion, isWreck, vehicle } from './status';
import { applyVehicleEffect, crewTakesResult } from './vehicleStatus';

/*
 * Flamethrowers and Demolition Charges against AFVs (SK4 4.2, 4.3):
 *  - A FT predesignating an AFV attacks on the HE & Flame To Kill table (TK 8, halved at 2 hexes,
 *    +1 vs CE, +2 vs Open-Topped), ignoring Armor Factors: below the TK the AFV burns.
 *  - A DC placed against an AFV first rolls on the DC Placement vs AFV table: ≤ 8 attacks the armor
 *    (TK 16, hull/turret from the same dice, the facing of the hexside it was placed through);
 *    9-11 a full-strength attack on a CE crew only; ≥ 12 an area attack that spares the AFV.
 */

/** HE & Flame To Kill Table: a Flamethrower's TK number (ASLSK Combat Charts p.12). */
export const FT_TK = 8;
/** A DC placed against an AFV attacks with TK 16 on the HE table (SK4 4.3). */
export const DC_TK = 16;

function ftVsVehicle(ctx: Ctx, decl: FireDeclaration, mode: FireMode): FireOutcome {
  const ft = pieceOf(ctx, decl.sw[0]!);
  const holder = pieceOf(ctx, (ft.loc as { by: PieceId }).by);
  const v = pieceOf(ctx, decl.vsVehicle!);
  const d = vehicle(ctx, v)!;
  const from = hexOf(ctx.state, ft)!;
  const range = statics(ctx).map.distance(from, decl.target);
  const explain: { id: string; label: string }[] = [{ id: 'sk3.ft.tk', label: `FT To Kill ${FT_TK}` }];
  let tk = FT_TK;
  if (range >= 2) {
    tk = Math.floor(tk / 2);
    explain.push({ id: 'sk3.ft.long', label: '½ long range' });
  }
  if (isCe(v)) {
    tk += 1;
    explain.push({ id: 'sk3.ft.ce', label: '+1 Crew Exposed' });
  }
  if (d.openTopped) {
    tk += 2;
    explain.push({ id: 'sk3.ft.ot', label: '+2 Open-Topped' });
  }
  const roll = ctx.roll(`FT To Kill ${v.id} (TK ${tk})`);
  const dr = roll.total;
  // The HE & Flame table knows no hull or turret: below the TK the AFV burns; equal is read as Shock (a FT never Immobilizes, SK4 7.10).
  const result = dr === 12 ? 'dud' : dr < tk ? 'kill' : dr === tk ? 'shock' : 'none';
  ctx.emit('sk3.toKill', { weapon: ft.id, target: v.id, ammo: 'FT', ch: false, location: 'hull', facing: 'side', af: 0, tk: FT_TK, modifiedTk: tk, finalTk: tk, dr: roll.dice as [number, number], result, explain });
  if (result === 'kill') applyVehicleEffect(ctx, v.id, 'wreck', `Flamethrower (TK ${tk}, DR ${dr})`);
  else if (result === 'shock') applyVehicleEffect(ctx, v.id, 'shock', `Flamethrower (TK ${tk}, DR ${dr})`);
  // The FT has fired: marked by mode, used as a SW; removed on its X# (SK1 4.2).
  const marker = mode === 'prep' ? 'prep' : mode === 'advancing' ? 'adv' : mode === 'first' ? 'first' : 'final';
  setTags(ctx, ft.id, { [T.fire]: marker });
  setTags(ctx, holder.id, { [T.fire]: marker, [T.firedSw]: true });
  const x = ctx.query('sw.breakdown', { sw: ft.id, user: holder.id }, sw(ctx, ft)?.x ?? 10) ?? 10;
  const removed = dr >= x;
  if (removed) ctx.emit('piece.eliminated', { id: ft.id, reason: 'FT removed (X#)' });
  return { column: null, dr: roll.dice as [number, number], cowered: false, results: {}, rofKept: [], malfunctioned: [], residualFp: 0 };
}

/** The DC Placement vs AFV DR (ASLSK Combat Charts p.3) and what it leads to. */
function dcVsVehicle(ctx: Ctx, dc: Piece, next: ResolveDcFn) {
  const v = ctx.state.pieces[dc.tags['dcVehicle'] as PieceId];
  const hex = (dc.loc as { hex: string }).hex;
  if (!v || !vehicle(ctx, v) || isWreck(v) || v.loc.kind !== 'hex' || v.loc.hex !== hex) {
    next(ctx, dc);
    return;
  }
  const d = vehicle(ctx, v)!;
  const map = statics(ctx).map;
  const from = dc.tags['dcFrom'] as string;
  const vca = (dc.tags['dcVca'] as number | undefined) ?? 0;
  const facing = facingOf(map.hex(hex)!.cube, vca, map.hex(from)!.cube, d.af.hull);
  const explain: { id: string; label: string }[] = [];
  let drm = 0;
  const add = (id: string, label: string, n: number) => {
    drm += n;
    explain.push({ id, label });
  };
  if (inMotion(v)) add('sk3.dc.motion', '+2 Motion AFV', 2);
  if (dc.tags['dcCx']) add('sk3.dc.cx', '+1 CX placer', 1);
  if (isCe(v)) add('sk3.dc.ce', '+1 target AFV is CE', 1);
  if (facing === 'front') add('sk3.dc.front', '+1 placed through the hull front', 1);
  if (facing === 'rear') add('sk3.dc.rear', '-1 placed through the hull rear', -1);
  if (isImmobile(v)) add('sk3.dc.immobile', '-2 immobile AFV', -2);
  const roll = ctx.roll(`DC placement vs ${v.id}`);
  const final = roll.total + drm;
  const kind = final <= 8 ? 'armor' : final <= 11 ? 'crew' : 'area';
  ctx.emit('sk3.dcPlacement', { dc: dc.id, vehicle: v.id, dr: roll.dice as [number, number], drm, explain, final, result: kind });
  if (kind === 'area') {
    next(ctx, dc);
    return;
  }
  if (kind === 'armor') {
    const [white, colored] = roll.dice as [number, number];
    const location = hitLocation(white, colored);
    const af = location === 'turret' ? d.af.turret[facing] : d.af.hull[facing];
    const modifiedTk = DC_TK + (facing === 'rear' ? 1 : 0);
    const finalTk = modifiedTk - af;
    const tkRoll = ctx.roll(`DC To Kill ${v.id} (${location} ${facing}, Final TK ${finalTk})`);
    const dr = tkRoll.total;
    const result = dr === 12 ? 'dud' : dr < finalTk ? 'kill' : dr === finalTk || dr === finalTk + 1 ? (location === 'hull' ? 'immobilized' : 'shock') : 'none';
    ctx.emit('sk3.toKill', { weapon: dc.id, target: v.id, ammo: 'DC', ch: false, location, facing, af, tk: DC_TK, modifiedTk, finalTk, dr: tkRoll.dice as [number, number], result });
    const by = `DC (${location} ${facing}, TK ${finalTk}, DR ${dr})`;
    if (result === 'kill') applyVehicleEffect(ctx, v.id, 'wreck', by);
    else if (result === 'immobilized') applyVehicleEffect(ctx, v.id, 'immobilized', by);
    else if (result === 'shock') applyVehicleEffect(ctx, v.id, 'shock', by);
  } else if (isCe(v)) {
    // 9-11: a full-strength attack on the CE crew alone, a new DR with only the CE DRM (SK4 4.3).
    const def = sw(ctx, dc)!;
    const column = iftColumn(ctx, def.fp);
    const crewRoll = ctx.roll(`DC attack on the crew of ${v.id}`);
    const res: IftResult = column === null ? { kind: 'none' } : statics(ctx).tables.ift(column, crewRoll.total + d.ceDrm);
    ctx.emit('sk1.fire.attack', { attack: { mode: 'advancing', target: hex, parts: [dc.id] }, fp: def.fp, column, dr: crewRoll.dice as [number, number], drm: d.ceDrm, cowered: false, explain: [{ id: 'sk3.dc.crew', label: `DC ${def.fp} FP on the CE crew` }, { id: 'sk3.ce', label: `+${d.ceDrm} Crew Exposed` }] });
    ctx.emit('sk1.fire.result', { unit: v.id, result: res, finalDr: crewRoll.total + d.ceDrm });
    crewTakesResult(ctx, v.id, res, 'DC on the CE crew');
  }
  ctx.emit('piece.eliminated', { id: dc.id, reason: 'DC detonated' });
}

export const infantryVsAfvModule: RuleModule = {
  id: 'sk3.infantryVsAfv',
  ref: 'SK4 4.2, 4.3',
  summary: 'Flamethrower and Demolition Charge attacks predesignated against an AFV.',
  requires: ['sk1.fire', 'sk1.firePhases', 'sk3.toKill', 'sk3.vehicleStatus'],
  install(r) {
    r.event<{ dc: PieceId; vehicle: PieceId; dr: [number, number]; drm: number; explain: { id: string; label: string }[]; final: number; result: 'armor' | 'crew' | 'area' }>({ type: 'sk3.dcPlacement', apply() {} });
    r.procedure<ResolveFireFn>(FP.resolve, (next) => (ctx, decl, mode, opts) => {
      const ft = decl.vsVehicle && decl.sw.length === 1 ? pieceOf(ctx, decl.sw[0]!) : null;
      if (ft && sw(ctx, ft)?.type === 'FT') return ftVsVehicle(ctx, decl, mode);
      return next!(ctx, decl, mode, opts);
    });
    r.procedure<ResolveDcFn>(FPP.resolveDc, (next) => (ctx, dc) => {
      if (dc.tags['dcVehicle']) dcVsVehicle(ctx, dc, next!);
      else next!(ctx, dc);
    });
    void mmc;
    void otherSide;
    void T3;
  },
};
