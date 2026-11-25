import { smoke58Counters } from '@asl/rules';

/**
 * The ⅝" Ordnance Smoke/WP counters in a hex (SK4 1.2.5), oldest first, as the VASL markers that show them:
 * full Smoke +3, Dispersed Smoke +2, WP +2, Dispersed WP +1.
 */
export function smoke58Chits(m: Record<string, unknown> | undefined): { marker: string; label: string }[] {
  return smoke58Counters(m).map(({ kind, dispersed, side }) => {
    if (kind === 'wp') return dispersed ? { marker: 'WP1', label: 'Dispersed WP (+1)' } : { marker: 'WP2', label: 'WP (+2)' };
    // Full ASL: Dispersed SMOKE drifting from a Blaze in a Mild Breeze, on gray counters so it is told apart from
    // original SMOKE (ASLRB A24.61).
    if (side.startsWith('drift~')) return { marker: 'Smk2gr', label: 'Drifting Smoke from a Blaze (+2)' };
    return dispersed ? { marker: 'Smk2', label: 'Dispersed Smoke (+2)' } : { marker: 'Smk3', label: 'Smoke (+3)' };
  });
}
