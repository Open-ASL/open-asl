import type { QueryEnv } from '@asl/engine';
import { withoutSecrets, type FireAttackCtx } from '@asl/rules';
import { pieceLabel } from './describe';

/**
 * Each target's own DRM, as lines for the shot preview: "4-4-7: -1 vs FT possessor (DRM +1 vs it)". A unit's own
 * modifier (-1 vs a FT possessor, SK1 4.2, ASLRB A22.4: "any attack ... against it") applies to that unit's result alone,
 * so it is not in the attack's DRM; without these lines the DRM shown reads as missing it. `shared` is the attack's DRM
 * as shown. Concealed targets are never named, and secret contributions are left out as for the attack's DRM.
 */
export function targetOwnDrms(env: QueryEnv, attack: FireAttackCtx, shared: number): string[] {
  return attack.targets.flatMap((u) => {
    const p = env.state.pieces[u];
    if (!p || p.loc.kind !== 'hex' || p.tags['concealed']) return [];
    const own = withoutSecrets(env.explain('fire.unitDrm', { attack, unit: u }, 0));
    const labels = own.trace.filter((t) => !t.suppressedBy && t.label && t.after !== t.before).map((t) => t.label!);
    if (!own.value || !labels.length) return [];
    const total = shared + own.value;
    return [`${pieceLabel(env, p)}: ${labels.join(', ')} (DRM ${total >= 0 ? '+' : ''}${total} vs it)`];
  });
}
