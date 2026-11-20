import { Layer, type RuleModule } from '@asl/engine';
import { defOf, personnelAt } from '../common/pieces';
import { locOf } from '../common/location';
import { isBroken, mmc, pieceOf } from '../sk1/status';
import { smokeIn } from '../sk1/terrain';
import { ceDrmApplies } from '../sk3/vehicleFire';

/**
 * Chapter B terrain where the full rule differs from the Starter Kit's (first needed
 * for board u). Everything else the board-u terrain needs is shared code.
 *
 * - **B.2 COT:** the Cost of Terrain is the hex's entry cost plus its Artificial Terrain (SMOKE) cost, and it is the COT
 *   that a move to a higher elevation doubles (A4.133, B10.4): Infantry entering an uphill hex holding SMOKE pay
 *   2 × (1 + 1) = 4 MF, not 2 × 1 + 1 = 3 (B.2's own example). The Starter Kit adds the Smoke MF after the doubling
 *   (SK1 3.3 makes it a separate +1; SK4 1.1.1 doubles the "Cost of Terrain" without counting Smoke in it).
 */
export const aslTerrainModule: RuleModule = {
  id: 'asl.terrain',
  ref: 'ASLRB B.2, B10.4, A4.12, B10.31, A19.3',
  summary: 'Chapter B terrain beyond the Starter Kit: SMOKE is part of the COT doubled uphill; the leader MF bonus needs the same nationality (A4.12); no Height Advantage with a CE DRM (B10.31); a Green MMC with an unbroken leader is not Inexperienced (A19.3).',
  requires: ['sk1.terrain'],
  install(r) {
    // A4.12: the leader MF bonus only from a leader "of the same nationality" (the Starter Kit names none).
    r.contribute({
      id: 'asl.move.leader-nationality',
      query: 'move.leaderBonusFrom',
      ref: 'ASLRB A4.12',
      apply: (v, { leader, unit }, env) => v && defOf(env, pieceOf(env, leader)).nationality === defOf(env, pieceOf(env, unit)).nationality,
    });
    // B10.31: no Height Advantage for a unit "eligible to receive any other positive TEM or CE DRM": a vehicle whose crew
    // takes the CE DRM keeps that DRM instead (SK4 1.1.1 names only the TEM).
    r.suppress<'fire.unitDrm'>({
      id: 'asl.ha.not-with-ce',
      query: 'fire.unitDrm',
      target: 'sk2.drm.height-advantage',
      ref: 'ASLRB B10.31',
      label: 'no Height Advantage with a CE DRM',
      when: ({ attack, unit }, env) => ceDrmApplies(env, attack, unit),
    });
    // A19.3: a Green MMC "stacked with an unbroken leader" is exempt from the Inexperienced restrictions: unbroken, not
    // Good Order (the Starter Kit's 5.4 wording), and a leader, not a hero (Q&A [K33] to A19.3: "is a leader who is unbroken
    // but not Good Order still eligible to cancel any Inexperienced Personnel penalties? Yes."; the leader exempts the
    // squad whether or not he takes part in the attack, the PAATC or the CC).
    r.contribute({
      id: 'asl.inexperienced.unbroken-leader',
      query: 'unit.inexperienced',
      ref: 'ASLRB A19.3',
      layer: Layer.Base + 10,
      apply(v, { unit }, env) {
        const p = pieceOf(env, unit);
        if (mmc(env, p)?.quality !== 'G') return v;
        const loc = locOf(env.state, p);
        return !loc || !personnelAt(env, loc, p.side).some((l) => defOf(env, l).kind === 'leader' && !isBroken(l));
      },
    });
    // A4.62: Hazardous Movement holds while the unit is "so engaged": pushing a Gun only during the MPh (Q&A [K33] to
    // A4.62, C10.3: "only during the applicable MPh? Yes."). The Starter Kit keeps it for the Player Turn (SK4 6.5).
    r.suppress<'fire.unitDrm'>({
      id: 'asl.hazardous.push-mph-only',
      query: 'fire.unitDrm',
      target: 'sk2.drm.hazardous',
      ref: 'ASLRB A4.62, C10.3',
      when: ({ unit }, env) => env.state.phase !== 'MPh' && pieceOf(env, unit).tags['manhandled'] === true,
    });
    r.suppress<'move.cost'>({ id: 'asl.move.not-sk-smoke-cost', query: 'move.cost', target: 'sk1.move.smoke-cost', ref: 'ASLRB B.2' });
    // Before the Crest Line doubling (Base + 50), so it doubles with the terrain.
    r.contribute({
      id: 'asl.move.smoke-cot',
      query: 'move.cost',
      layer: Layer.Base + 10,
      ref: 'ASLRB B.2, A24.7',
      label: '+1 MF entering SMOKE (part of the COT)',
      when: ({ to }, env) => smokeIn(env, to),
      apply: (v) => v + 1,
    });
  },
};
