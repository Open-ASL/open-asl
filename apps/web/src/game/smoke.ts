import { SMOKE58 } from '@asl/rules';

/**
 * The ⅝" Ordnance Smoke/WP counter in a hex (SK4 1.2.5), as the VASL marker that shows it:
 * full Smoke +3, Dispersed Smoke +2, WP +2, Dispersed WP +1.
 */
export function smoke58Marker(m: Record<string, unknown> | undefined): { marker: string; label: string } | null {
  const kind = m?.[SMOKE58.kind];
  if (!kind) return null;
  const dispersed = m?.[SMOKE58.dispersed] === true;
  if (kind === 'wp') return dispersed ? { marker: 'WP1', label: 'Dispersed WP (+1)' } : { marker: 'WP2', label: 'WP (+2)' };
  return dispersed ? { marker: 'Smk2', label: 'Dispersed Smoke (+2)' } : { marker: 'Smk3', label: 'Smoke (+3)' };
}
