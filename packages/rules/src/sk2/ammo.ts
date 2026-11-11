import type { Piece, PieceId, QueryEnv } from '@asl/engine';
import { statics } from '../common/pieces';
import type { AmmoKind, GunDef, SpecialAmmoDef } from '../common/statics';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Why a Gun may not fire an ammo kind under the scenario's rules ("no Smoke can be placed"), or null. */
    'ammo.denied': { ctx: { gun: PieceId; kind: AmmoKind }; value: string | null };
  }
}

/*
 * Ordnance ammunition (SK4 6.0, 6.2). A Gun has unlimited HE (unless its caliber is underscored)
 * and AP (unless overscored, or a Mortar). Anything else, and any HE/AP the back of the counter
 * lists with a Depletion Number, is limited: the firer announces it before the To Hit DR and the
 * original DR decides whether the Gun had it (below the number), had it for this shot only (equal)
 * or never had it (above: the Gun has not fired). Depleted ammo is kept on the Gun as a tag.
 */

export const AMMO_NAME: Record<AmmoKind, string> = {
  HE: 'HE',
  AP: 'AP',
  HEAT: 'HEAT',
  APCR: 'APCR',
  APDS: 'APDS',
  SMOKE: 'Smoke',
  WP: 'WP',
};

/** Tag on a Gun: the limited ammo it has run out of, as a comma list of kinds. */
export const AMMO_OUT = 'ammoOut';

export const ammoOut = (g: Piece): AmmoKind[] => String(g.tags[AMMO_OUT] ?? '').split(',').filter(Boolean) as AmmoKind[];

/** The scenario's year and month (month from the card; year from its dateline), if known. */
export function scenarioDate(env: QueryEnv): { year?: number; month: number } {
  const s = statics(env).scenario;
  const m = /\b19(\d\d)\b/.exec(s.date ?? '');
  return { ...(m ? { year: 1900 + Number(m[1]) } : {}), month: s.month };
}

/**
 * The Depletion Number a Special Ammo entry has at the scenario date, or null when it is not
 * available then. Scenarios without a year in their dateline get the first step. Theater-limited
 * entries: every scenario so far is in Europe, so a PTO-only entry is never available.
 */
export function depletionAt(env: QueryEnv, sa: SpecialAmmoDef): number | null {
  if (sa.theater === 'PTO') return null;
  const { year, month } = scenarioDate(env);
  if (year === undefined) return sa.steps[0]?.n ?? null;
  let n: number | null = null;
  for (const step of sa.steps) {
    if (!step.from) n = step.n;
    else if (year > step.from.year || (year === step.from.year && month >= (step.from.month ?? 1))) n = step.n;
  }
  return n;
}

/** The counter's limitation entry for an ammo kind, if it lists one. */
export const specialAmmoOf = (def: GunDef, kind: AmmoKind): SpecialAmmoDef | undefined => def.specialAmmo?.find((s) => s.kind === kind);

export interface AmmoStatus {
  kind: AmmoKind;
  /** The Gun may announce it now. */
  available: boolean;
  /** Its Depletion Number at the scenario date; undefined for unlimited ammo. */
  depletion?: number;
  /** Why it cannot be fired, when it cannot. */
  why?: string;
}

/** Whether a Gun can fire an ammo kind at all now (scoring, counter, date, depletion). */
export function ammoStatus(env: QueryEnv, g: Piece, def: GunDef, kind: AmmoKind): AmmoStatus {
  const denied = env.query('ammo.denied', { gun: g.id, kind }, null);
  if (denied) return { kind, available: false, why: denied };
  const listed = specialAmmoOf(def, kind);
  if (listed) {
    const n = depletionAt(env, listed);
    if (n === null) return { kind, available: false, why: `No ${AMMO_NAME[kind]} at this date` };
    if (ammoOut(g).includes(kind)) return { kind, available: false, depletion: n, why: `Out of ${AMMO_NAME[kind]}` };
    return { kind, available: true, depletion: n };
  }
  // A LATW fires HEAT only, without limit (SK4 4.4).
  if (def.latw) return kind === 'HEAT' ? { kind, available: true } : { kind, available: false, why: `The ${def.type} fires HEAT only` };
  if (kind === 'HE') return def.ammo.he ? { kind, available: true } : { kind, available: false, why: 'The Gun fires no HE' };
  if (kind === 'AP') return def.ammo.ap && def.type !== 'MTR' ? { kind, available: true } : { kind, available: false, why: 'The Gun fires no AP' };
  return { kind, available: false, why: `The Gun has no ${AMMO_NAME[kind]}` };
}

/** Every ammo kind a Gun's counter allows (available now or not), HE and AP first. */
export function ammoKinds(def: GunDef): AmmoKind[] {
  if (def.latw) return ['HEAT'];
  const out: AmmoKind[] = [];
  if (def.ammo.he || specialAmmoOf(def, 'HE')) out.push('HE');
  if ((def.ammo.ap && def.type !== 'MTR') || specialAmmoOf(def, 'AP')) out.push('AP');
  for (const s of def.specialAmmo ?? []) if (!out.includes(s.kind)) out.push(s.kind);
  return out;
}

/**
 * The ammo a shot uses when none is announced (SK4 6.2): unlimited HE, else unlimited AP; limited
 * HE/AP (with a Depletion Number) only when the Gun has nothing unlimited.
 */
export function defaultAmmo(env: QueryEnv, g: Piece, def: GunDef): AmmoKind {
  if (def.latw) return 'HEAT';
  const unlimited = (k: AmmoKind) => !specialAmmoOf(def, k) && ammoStatus(env, g, def, k).available;
  if (unlimited('HE')) return 'HE';
  if (unlimited('AP')) return 'AP';
  if (ammoStatus(env, g, def, 'HE').available) return 'HE';
  if (ammoStatus(env, g, def, 'AP').available) return 'AP';
  return 'HE';
}

/** Smoke and WP place a ⅝" counter instead of attacking on the IFT. */
export const isSmokeAmmo = (kind: AmmoKind) => kind === 'SMOKE' || kind === 'WP';

/** AP, APCR and APDS leave no Residual FP (SK4 3.3.5, 6.2). */
export const leavesResidual = (kind: AmmoKind) => kind === 'HE' || kind === 'HEAT';

/**
 * The IFT column an ordnance hit with this ammo attacks on (SK4 6.2): HE the chart's column; AP
 * the 1 (under 37mm) or 2 FP column; APCR/APDS the 1; HEAT one column lower than HE. A Critical
 * Hit doubles the ammo's FP (6.1; the chart's CH column for HE), with no halving for the ATT.
 */
export function ammoColumn(env: QueryEnv, def: GunDef, kind: AmmoKind, targetType: 'ITT' | 'ATT', ch: boolean): number | null {
  const tables = statics(env).tables;
  const cols = tables.iftColumns;
  const doubled = (fp: number) => {
    const want = fp * 2;
    return cols.filter((c) => c <= want).pop() ?? fp;
  };
  switch (kind) {
    case 'HE':
      return tables.gunColumn(def, ch ? 'CH' : targetType);
    case 'AP': {
      const fp = def.caliber < 37 ? 1 : 2;
      return ch ? doubled(fp) : fp;
    }
    case 'APCR':
    case 'APDS':
      return ch ? doubled(1) : 1;
    case 'HEAT': {
      // A LATW hit on Infantry in a building attacks on its counter's FP column (SK4 4.4.1), doubled for a CH.
      if (def.latw) return ch ? doubled(def.latw.fp) : def.latw.fp;
      const he = tables.gunColumn(def, ch ? 'CH' : 'ITT');
      if (he === null) return null;
      const i = cols.indexOf(he);
      return i > 0 ? cols[i - 1]! : null;
    }
    default:
      return null;
  }
}
