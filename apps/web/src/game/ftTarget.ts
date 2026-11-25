import type { HexId, PieceId, QueryEnv, SideId } from '@asl/engine';
import { defOf, isPersonnelDef, isVehicleDef, type FireDeclaration } from '@asl/rules';

/** A declaration that fires one Flamethrower and nothing else: the only attack that may predesignate an AFV (SK4 4.2). */
export function isLoneFt(env: QueryEnv, decl: FireDeclaration | null): boolean {
  if (!decl || decl.units.length !== 0 || decl.sw.length !== 1) return false;
  const ft = env.state.pieces[decl.sw[0]!];
  return !!ft && (defOf(env, ft) as { type?: string }).type === 'FT';
}

/**
 * The AFVs a lone Flamethrower may predesignate in `hex` when they are all the enemy there that the firing side sees: an
 * attack on the IFT never harms a Buttoned Up AFV, and against one the FT "must predesignate the AFV as the target before
 * making the attack" to roll on the HE & Flame To Kill table (SK4 4.2). Empty when the declaration is not a lone FT or
 * enemy personnel are seen in the hex too (then an IFT attack on them is a real choice). `env` is the firing side's view.
 */
export function ftAfvTargets(env: QueryEnv, decl: FireDeclaration | null, hex: HexId, side: SideId): PieceId[] {
  if (!isLoneFt(env, decl)) return [];
  // Weapons a vehicle or unit holds are `held`, not in the hex; only what stands there counts.
  const enemy = Object.values(env.state.pieces).filter((p) => p.side !== side && p.loc.kind === 'hex' && p.loc.hex === hex);
  if (enemy.some((p) => isPersonnelDef(defOf(env, p)))) return [];
  return enemy.filter((p) => isVehicleDef(defOf(env, p)) && p.tags['wreck'] !== true).map((p) => p.id);
}
