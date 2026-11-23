import type { GameState, HexId, PieceId, QueryEnv, SideId } from '@asl/engine';
import { attackFp, buildAttack, firerLos, hexOf, iftColumn, mmc, otherSide, p2d6, smc, statics, withoutSecrets, type FireAttackCtx, type FireDeclaration, type FireMode } from '@asl/rules';
import type { SsHeat } from '@asl/platform';
import { shotFirers } from './checks';

/**
 * How dangerous a hex is to one side: the chance a Good Order squad of it there is broken or worse by the fire that can
 * reach it, the FP of that fire, and where each part comes from.
 */
export interface DangerCell {
  /** The chance of the squad being broken, Casualty Reduced or eliminated by any of the attacks (each stack firing once). */
  p: number;
  fp: number;
  /** Each firing hex: its FP there, its DRM there (TEM, hindrance, leadership) and its chance alone. */
  sources: { hex: HexId; fp: number; drm: number; p: number }[];
}

export interface DangerOptions {
  /** The side under threat: the map shows its enemy's fire. */
  side: SideId;
  /** Prep Fire and Defensive First Fire put the firers' full FP on a hex; Advancing Fire half of it. */
  mode: 'prep' | 'first' | 'advancing';
  /** Count the Support Weapons as well as the units' own FP. */
  sw: boolean;
  /** Firers the viewer may see (null: all); a hidden one adds nothing to the map. */
  visible: Set<PieceId> | null;
  /** A secret DRM (an unrevealed fortified building) counts only when every side's hidden information is shown. */
  secrets: boolean;
}

/** The Morale of the squad the map is worked out for: the most common among the side's squads (7 when it has none). */
export function typicalMorale(env: QueryEnv, side: SideId): number {
  const seen = new Map<number, number>();
  for (const p of Object.values(env.state.pieces)) {
    const d = p.side === side && p.loc.kind !== 'eliminated' ? mmc(env, p) : null;
    if (d?.kind === 'squad') seen.set(d.morale, (seen.get(d.morale) ?? 0) + 1);
  }
  return [...seen].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 7;
}

/**
 * The chance one attack breaks, Casualty Reduces or eliminates a lone Good Order squad of `morale` (SK1 3.2.1), exact
 * over the 36 rolls: a KIA or K always harms it; an MC or NMC when its DR, the MC's number added, beats its Morale (an
 * original 12 always); a PTC never does. An original doubles shifts the column `cower` left.
 */
export function harmChance(env: QueryEnv, fp: number, drm: number, cower: number, morale: number): number {
  const column = iftColumn(env, fp);
  if (column === null) return 0;
  const shifted = iftColumn(env, fp, cower);
  const ift = statics(env).tables.ift;
  let p = 0;
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      const col = a === b && cower ? shifted : column;
      if (col === null) continue;
      const r = ift(col, a + b + drm);
      if (r.kind === 'KIA' || r.kind === 'K') p += 1 / 36;
      else if (r.kind === 'MC' || r.kind === 'NMC') {
        let fail = p2d6(12);
        for (let n = 2; n <= 11; n++) if (n + (r.n ?? 0) > morale) fail += p2d6(n);
        p += fail / 36;
      }
    }
  return p;
}

/**
 * The danger map, worked out a step at a time (each `yield` is a moment to give the screen back, with how far along it
 * is, 0..1). For each enemy hex with units able to fire, the attack a whole stack would make at each hex in reach is
 * built by the rules (`buildAttack`: PBF, long range, Advancing Fire, a leader directing, the SW a unit may fire), the
 * parts out of even long range left out; it counts on every hex the stack has LOS to (`firerLos`, Smoke included).
 * Its DRM there is the rules' (`fire.drm`): the hex's TEM, the hindrance along that LOS, the leader's; with the FP and
 * cowering it gives the chance a squad there is harmed. The stacks' chances combine as separate attacks.
 */
export function* dangerSteps(base: QueryEnv, engine: { env(s: GameState): QueryEnv }, opts: DangerOptions): Generator<number, Map<HexId, DangerCell>> {
  const state0 = base.state;
  const enemy = otherSide(state0, opts.side);
  // The position in the mode's phase, the enemy firing: in its own turn for Prep or Advancing Fire, else defending.
  const phase = opts.mode === 'prep' ? 'PFPh' : opts.mode === 'advancing' ? 'AFPh' : 'MPh';
  const state: GameState = { ...state0, phase, attacker: opts.mode === 'first' ? opts.side : enemy };
  const env = engine.env(state);
  const map = statics(env).map;
  const shooters = [...new Set(Object.values(state.pieces).filter((p) => p.side === enemy && p.loc.kind === 'hex').map((p) => hexOf(state, p)!))].sort();
  const out = new Map<HexId, DangerCell>();
  const all = [...map.hexes()].map((h) => h.id);
  const morale = typicalMorale(env, opts.side);
  for (let i = 0; i < shooters.length; i++) {
    const from = shooters[i]!;
    const firers = shotFirers(env, state, [from]).filter((f) => !f.out && (!opts.visible || opts.visible.has(f.id)));
    const units = firers.filter((f) => f.role === 'unit').map((f) => f.id);
    const sws = opts.sw ? firers.filter((f) => f.role === 'sw').map((f) => f.id) : [];
    if (units.length + sws.length === 0) continue;
    const leaders = firers.filter((f) => f.role === 'leader').map((f) => state.pieces[f.id]!);
    const director = leaders.sort((a, b) => smc(env, a)!.leadership - smc(env, b)!.leadership)[0];
    const decl: Omit<FireDeclaration, 'target'> = { units, sw: sws, ...(director ? { directors: [director.id] } : {}) };
    // The attack at each distance, built once (its FP turns on the range: PBF, long range); each hex then takes its own
    // TEM and the hindrance along its LOS.
    const atDist = new Map<number, { attack: FireAttackCtx; fp: number; cower: number } | null>();
    const attackAt = (target: HexId, d: number) => {
      if (!atDist.has(d)) {
        const built = buildAttack(env, { ...decl, target }, opts.mode as FireMode, enemy);
        const parts = built.parts.filter((p) => p.dist <= p.range * 2);
        const attack = { ...built, parts, targets: [] };
        atDist.set(d, parts.length ? { attack, fp: attackFp(env, attack), cower: env.query('fire.cowerShift', { attack }, 0) } : null);
      }
      return atDist.get(d)!;
    };
    let n = 0;
    for (const to of all) {
      if (to === from) continue;
      const at = attackAt(to, map.distance(from, to));
      if (!at || at.fp <= 0) continue;
      const los = firerLos(env, from, { target: to });
      if (!los.clear) continue;
      const attack = { ...at.attack, target: to, hindrance: los.hindrance };
      const res = env.explain('fire.drm', { attack }, 0);
      const drm = (opts.secrets ? res : withoutSecrets(res)).value;
      const p = harmChance(env, at.fp, drm, at.cower, morale);
      const cell = out.get(to) ?? { p: 0, fp: 0, sources: [] };
      cell.fp += at.fp;
      cell.p = 1 - (1 - cell.p) * (1 - p);
      cell.sources.push({ hex: from, fp: at.fp, drm, p });
      out.set(to, cell);
      if (++n % 40 === 0) yield (i + n / all.length) / shooters.length;
    }
    yield (i + 1) / shooters.length;
  }
  return out;
}

/** The chance bands the break map is coloured by (a hex under 2% is left clear). */
const CHANCE_BANDS = [0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9];

/** The colour of a hex by the chance a squad there is harmed (nothing under 2%). */
export function chanceColor(p: number): number | null {
  let band = -1;
  for (let i = 0; i < CHANCE_BANDS.length; i++) if (p >= CHANCE_BANDS[i]!) band = i;
  return band < 0 ? null : RAMP[band]!;
}

/** The IFT columns, for colouring the map by the column its FP would attack on. */
const BANDS = [1, 2, 4, 6, 8, 12, 16, 20, 24, 30, 36];
/** Pale yellow through orange and red to magenta, one per column. */
const RAMP = [0xfff3a0, 0xffe066, 0xffc233, 0xffa31a, 0xff8000, 0xff5a1f, 0xff3030, 0xe6194b, 0xd0006f, 0xb0008f, 0x9000b0];

/** The colour of a hex by the IFT column its FP reaches (nothing below the first column). */
export function dangerColor(fp: number): number | null {
  let band = -1;
  for (let i = 0; i < BANDS.length; i++) if (fp >= BANDS[i]!) band = i;
  return band < 0 ? null : RAMP[band]!;
}

export const DANGER_LEGEND = BANDS.map((b, i) => ({ label: String(b), color: RAMP[i]! }));
export const CHANCE_LEGEND = CHANCE_BANDS.map((b, i) => ({ label: `${Math.round(b * 100)}%`, color: RAMP[i]! }));

/**
 * The room's danger map after a click: a side's button shows the danger to that side, replacing the other side's map
 * (the two are never shown together), or hides it when it is already shown; the settings keep what was chosen.
 */
export function nextHeat(cur: SsHeat | null, c: { side?: SideId | null; mode?: SsHeat['mode']; sw?: boolean; measure?: SsHeat['measure'] }): SsHeat | null {
  if (c.side !== undefined) {
    if (c.side === null || cur?.side === c.side) return null;
    return { side: c.side, mode: cur?.mode ?? 'prep', sw: cur?.sw ?? true, measure: cur?.measure ?? 'break' };
  }
  return cur ? { ...cur, ...(c.mode ? { mode: c.mode } : {}), ...(c.sw !== undefined ? { sw: c.sw } : {}), ...(c.measure ? { measure: c.measure } : {}) } : null;
}
