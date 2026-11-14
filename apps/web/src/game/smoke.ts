import { smoke58Counters } from '@asl/rules';

/**
 * The ⅝" Ordnance Smoke/WP counters in a hex (SK4 1.2.5), oldest first, as the VASL markers that show them:
 * full Smoke +3, Dispersed Smoke +2, WP +2, Dispersed WP +1.
 */
export function smoke58Chits(m: Record<string, unknown> | undefined): { marker: string; label: string }[] {
  return smoke58Counters(m).map(({ kind, dispersed }) => {
    if (kind === 'wp') return dispersed ? { marker: 'WP1', label: 'Dispersed WP (+1)' } : { marker: 'WP2', label: 'WP (+2)' };
    return dispersed ? { marker: 'Smk2', label: 'Dispersed Smoke (+2)' } : { marker: 'Smk3', label: 'Smoke (+3)' };
  });
}
