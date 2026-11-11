import type { Ctx, PieceId, RuleModule } from '@asl/engine';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether a unit never takes a PAATC (SK4 8.1.8.3: the Japanese are exempt). */
    'paatc.exempt': { ctx: { unit: PieceId }; value: boolean };
  }
}
import { personnelAt } from '../common/pieces';
import { locOf } from '../common/location';
import { AP, type PaatcFn } from '../sk1/advance';
import { P as MP } from '../sk1/morale';
import { isBroken, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc } from '../sk1/status';

/*
 * Pre-AFV Advance/Attack Task Check (SK4 3.7): before an MMC advances into an enemy AFV's hex, places
 * a DC against one, or Reaction Fires at one, it rolls ≤ its morale (a leader stacked with it lends
 * his DRM even if he stays behind; Inexperienced, non-elite Italian, Allied Minor and Axis Minor
 * Infantry add 1). A failure pins it. One passed check serves the unit against that AFV for the rest
 * of the Player Turn (3.3.4 "only one PAATC is required per unit per AFV").
 */

/** Tag prefix on the unit: `paatc_<vehicle>` = true once passed this Player Turn. */
export const PAATC_PASSED = 'paatc_';
const MINOR_NATIONS = new Set(['it', 'al', 'ax']);

export function paatcDrm(ctx: Ctx, unit: PieceId): { drm: number; explain: { id: string; label: string }[] } {
  const p = pieceOf(ctx, unit);
  const loc = locOf(ctx.state, p)!;
  const explain: { id: string; label: string }[] = [];
  let drm = 0;
  const leaders = personnelAt(ctx, loc, p.side).filter((l) => l.id !== unit && smc(ctx, l) && isGoodOrder(ctx, l) && !isPinned(l) && !isBroken(l));
  if (leaders.length) {
    const best = Math.min(...leaders.map((l) => ctx.query('unit.leadership', { unit: l.id, for: unit }, smc(ctx, l)!.leadership)));
    if (best !== 0) {
      drm += best;
      explain.push({ id: 'sk3.paatc.leader', label: `${best > 0 ? '+' : ''}${best} leadership` });
    }
  }
  const m = mmc(ctx, p);
  if (ctx.query('unit.inexperienced', { unit }, false)) {
    drm += 1;
    explain.push({ id: 'sk3.paatc.inexperienced', label: '+1 Inexperienced' });
  } else if (m && m.quality !== 'E' && MINOR_NATIONS.has(m.nationality)) {
    drm += 1;
    explain.push({ id: 'sk3.paatc.minor', label: `+1 non-elite ${m.nationality === 'it' ? 'Italian' : m.nationality === 'al' ? 'Allied Minor' : 'Axis Minor'}` });
  }
  return { drm, explain };
}

export function paatc(ctx: Ctx, unit: PieceId, vehicle: PieceId, reason: 'advance' | 'dc' | 'reactionFire'): boolean {
  const p = pieceOf(ctx, unit);
  const m = mmc(ctx, p);
  // Leaders never take one (SK4 3.7); a check already passed against this AFV this Player Turn stands.
  if (!m) return true;
  if (p.tags[PAATC_PASSED + vehicle] === true) return true;
  if (ctx.query('paatc.exempt', { unit }, false)) return true;
  const morale = ctx.query('unit.morale', { unit }, m.morale);
  const { drm, explain } = paatcDrm(ctx, unit);
  const roll = ctx.roll(`PAATC ${unit} vs ${vehicle}`);
  const passed = roll.total + drm <= morale;
  ctx.emit('sk3.paatc', { unit, vehicle, reason, dr: roll.dice as [number, number], drm, explain, morale, passed });
  if (passed) setTags(ctx, unit, { [PAATC_PASSED + vehicle]: true });
  else ctx.proc<(c: Ctx, id: PieceId) => void>(MP.pin)(ctx, unit);
  return passed;
}

export const paatcModule: RuleModule = {
  id: 'sk3.paatc',
  ref: 'SK4 3.7, 3.3.4',
  summary: 'Pre-AFV Advance/Attack Task Check before advancing into, placing a DC on, or Reaction Firing at an enemy AFV.',
  requires: ['sk1.advance', 'sk3.vehicles'],
  install(r) {
    r.event<{ unit: PieceId; vehicle: PieceId; reason: string; dr: [number, number]; drm: number; explain: { id: string; label: string }[]; morale: number; passed: boolean }>({
      type: 'sk3.paatc',
      apply() {},
    });
    r.procedure<PaatcFn>(AP.paatc, () => (ctx, unit, vehicle, reason) => paatc(ctx, unit, vehicle, reason));
    // The passes expire with the Player Turn.
    r.on<{ phase: string }>({
      id: 'sk3.paatc.cleanup',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        for (const p of Object.values(ctx.state.pieces).sort((a, b) => (a.id < b.id ? -1 : 1))) {
          const keys = Object.keys(p.tags).filter((k) => k.startsWith(PAATC_PASSED));
          if (keys.length) setTags(ctx, p.id, Object.fromEntries(keys.map((k) => [k, null])));
        }
      },
    });
  },
};
