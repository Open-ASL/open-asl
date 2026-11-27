import type { Piece, PieceId, QueryEnv } from '@asl/engine';
import { statics } from '../common/pieces';
import type { IftResult } from '../common/statics';
import { attackFp, iftColumn, type FireAttackCtx } from './fire';
import { isBroken, isGoodOrder, isPinned, lendsLeadershipTo, mmc, smc } from './status';

/** P(2d6 = n), n in 2..12. */
export const p2d6 = (n: number) => (n < 2 || n > 12 ? 0 : (6 - Math.abs(n - 7)) / 36);

/** The 36 equally likely rolls of a white and a coloured die. */
const ROLLS: [number, number][] = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) ROLLS.push([a, b]);

/** Chances of what one attack does to one target unit; the four add up to at most 1, the rest is no harm. */
export interface UnitOdds {
  /** Eliminated (KIA, or a Casualty Reduction a half-squad, crew or broken unit does not survive). */
  elim: number;
  /** Casualty Reduced and still on the map (a squad to a half-squad; a leader Wounded), broken or not. */
  reduced: number;
  /** Broken (and not reduced): a Good Order unit failing its check, or broken by a KIA. */
  broken: number;
  /** Pinned, and nothing worse (SK1 3.2.1: a check equal to its Morale, or a failed PTC). */
  pinned: number;
}

export interface ShotOdds {
  fp: number;
  /** The IFT column, null when the FP is below the first column. */
  column: number | null;
  /** The attack's DRM (TEM, hindrance, leadership, FFMO/FFNAM ...), before any one unit's own DRM. */
  drm: number;
  /** Columns an original doubles roll shifts left by cowering (0 when it cannot cower). */
  cower: number;
  /** The chance the attack's result is PTC or better on the attack's DRM: what any unit in the hex would face. */
  effect: number;
  /** The chance of each IFT result on the attack's DRM, best first ("KIA2", "K/1", "1MC", "NMC", "PTC"). */
  results: { label: string; p: number }[];
  /** Per target unit (personnel only), from the units' own DRM, Morale and leadership. */
  units: Record<PieceId, UnitOdds>;
}

const resultLabel = (r: IftResult) => (r.kind === 'KIA' ? `${r.n ?? 1}KIA` : r.kind === 'K' ? `K/${r.n ?? 0}` : r.kind === 'MC' ? `${r.n ?? 0}MC` : r.kind);
const RANK: Record<string, number> = { KIA: 5, K: 4, MC: 3, NMC: 3, PTC: 1, none: 0 };

/** Chances of a Morale Check against `morale` with `mod` added to the DR: fail, pin (equal, an unbroken unit only), original 12. */
function mcOdds(morale: number, mod: number, broken: boolean) {
  let fail = 0;
  let pin = 0;
  for (let n = 2; n <= 11; n++) {
    const f = n + mod;
    if (f > morale) fail += p2d6(n);
    else if (f === morale && !broken) pin += p2d6(n);
  }
  return { fail, pin, twelve: p2d6(12) };
}

/**
 * The odds of a fire attack, worked out exactly over the 36 rolls rather than rolled: the attack comes from the rules'
 * own `buildAttack`, so the FP, the DRM and cowering are the rules' (PBF, long range, Area Fire, FFMO/FFNAM, TEM,
 * hindrance, leadership ...), and each result is applied as `applyIftResult` applies it (SK1 3.2.1):
 * - each unit's own DRM (a FT possessor's -1) gives it its own final DR;
 * - a K picks one unit of those that got it: a squad is reduced and still checks; a half-squad, crew or broken unit is
 *   eliminated; a leader is wounded and takes no MC; the others take the MC;
 * - a KIA eliminates as many as its number, at random; the rest break, or are reduced if already broken;
 * - every pick a K or KIA may make is weighed in turn, the same pick for every unit in the hex (a leader it kills is one
 *   the squads beside him lose);
 * - an MC or NMC breaks a Good Order unit that fails it, pins one that equals its Morale, and Casualty Reduces it too
 *   on an original 12; a broken unit failing it is Casualty Reduced, and eliminated on an original 12;
 * - a PTC pins a Good Order unpinned unit whose DR beats its Morale;
 * - the leaders check first, the best first; one Good Order and unpinned who passes unharmed lends his leadership DRM
 *   (only a negative one) to the checks after his, the best lent applying; each leader broken makes those below his
 *   Morale take a LLTC, each eliminated a LLMC.
 * A unit's Morale follows what the attack did to it (broken, it checks on its broken side). Simplified: a leader broken by
 * a Leader Loss check causes no further one, and a unit Replaced for ELR (SK1 5.1) or reduced keeps its Morale; against
 * the engine these come to about a point in the chances of a stack with two leaders under point-blank fire.
 * A vehicle in the hex is left out (fire on its crew is for a later check).
 */
export function shotOdds(env: QueryEnv, attack: FireAttackCtx): ShotOdds {
  const fp = attackFp(env, attack);
  const drm = env.query('fire.drm', { attack }, 0);
  const cower = env.query('fire.cowerShift', { attack }, 0);
  const column = iftColumn(env, fp);
  const shifted = column === null ? null : iftColumn(env, fp, cower);
  const ift = statics(env).tables.ift;
  const empty: ShotOdds = { fp, column, drm, cower, effect: 0, results: [], units: {} };
  if (column === null) return empty;
  const colOf = (a: number, b: number) => (a === b && cower ? shifted : column);

  // What the attack does on its own DRM: the chance of each result, and of any effect at all.
  const byLabel = new Map<string, { p: number; rank: number; order: number }>();
  let effect = 0;
  for (const [a, b] of ROLLS) {
    const col = colOf(a, b);
    if (col === null) continue;
    const r = ift(col, a + b + drm);
    if (r.kind === 'none') continue;
    effect += 1 / 36;
    const label = resultLabel(r);
    const e = byLabel.get(label) ?? { p: 0, rank: RANK[r.kind] ?? 0, order: r.kind === 'KIA' ? -(r.n ?? 1) : r.kind === 'K' || r.kind === 'MC' ? -(r.n ?? 0) : 0 };
    e.p += 1 / 36;
    byLabel.set(label, e);
  }
  const results = [...byLabel].sort((x, y) => y[1].rank - x[1].rank || x[1].order - y[1].order).map(([label, e]) => ({ label, p: e.p }));

  const targets = attack.targets.map((id) => env.state.pieces[id]).filter((p): p is Piece => !!p && p.loc.kind !== 'eliminated' && !!(mmc(env, p) || smc(env, p)));
  const units: Record<PieceId, UnitOdds> = Object.fromEntries(targets.map((p) => [p.id, { elim: 0, reduced: 0, broken: 0, pinned: 0 }]));
  if (!targets.length) return { ...empty, effect, results };

  const unitDrm = Object.fromEntries(targets.map((p) => [p.id, env.query('fire.unitDrm', { attack, unit: p.id }, 0)]));
  const morale = (p: Piece) => env.query('unit.morale', { unit: p.id }, isBroken(p) ? (mmc(env, p) ?? smc(env, p))!.brokenMorale : (mmc(env, p) ?? smc(env, p))!.morale);
  /** The Morale a unit checks on once the attack has left it broken or not: its broken side's for a unit it broke (a 4-4-7 checks on 6). */
  const moraleAs = (p: Piece, broken: boolean) => {
    const d = (mmc(env, p) ?? smc(env, p))!;
    const printed = (b: boolean) => (b ? d.brokenMorale : d.morale);
    return printed(broken) + (morale(p) - printed(isBroken(p)));
  };
  const mcDrm = (p: Piece, kind: 'MC' | 'PTC') => env.query('mc.drm', { unit: p.id, kind, reason: 'fire' }, 0);
  // Every leader checks first, the best first (SK1 3.2.1, as `checkGroup`: by leadership, then Morale).
  const leaders = targets
    .filter((p) => smc(env, p))
    .sort((x, y) => smc(env, x)!.leadership - smc(env, y)!.leadership || smc(env, y)!.morale - smc(env, x)!.morale || (x.id < y.id ? -1 : 1));
  /**
   * The DRM the leaders who passed lend a unit: the best one's, and only a DRM that helps (one he may lead with); only a
   * leader of its own side lends, unpinned and in Good Order, so never one in Melee (`lendsLeadershipTo`, SK1 3.2.1).
   */
  const lentBy = (lenders: Piece[], to: Piece) =>
    Math.min(0, ...lenders.filter((l) => lendsLeadershipTo(env, l, to)).map((l) => env.query('unit.leadership', { unit: l.id, for: to.id }, smc(env, l)!.leadership)));

  // What becomes of one unit, as chances of each state it can end in.
  type Dist = { none: number; pinned: number; broken: number; reduced: number; reducedBroken: number; elim: number };
  const zero = (): Dist => ({ none: 0, pinned: 0, broken: 0, reduced: 0, reducedBroken: 0, elim: 0 });
  /** A Casualty Reduction of a unit in state `from` (broken or not), with weight `w`: a squad becomes a half-squad; a leader is wounded, killed on a wound dr of 5+ (4+ if already wounded); anything else is gone. */
  const crInto = (d: Dist, p: Piece, broken: boolean, w: number) => {
    if (smc(env, p)) {
      const dies = (p.tags['wounds'] as number | undefined) ? 3 / 6 : 2 / 6;
      d.elim += w * dies;
      d[broken ? 'reducedBroken' : 'reduced'] += w * (1 - dies);
    } else if (mmc(env, p)?.kind === 'squad' && mmc(env, p)?.reducesTo) d[broken ? 'reducedBroken' : 'reduced'] += w;
    else d.elim += w;
  };
  /**
   * A Morale Check on a unit in each state of `d` (SK1 3.2.1): a Good Order unit breaks on a failure, pins on its Morale
   * exactly and is also reduced on an original 12; a broken one is reduced on a failure and eliminated on an original 12.
   */
  const mcOn = (d: Dist, p: Piece, mod: number): Dist => {
    const out = zero();
    for (const [state, w] of Object.entries(d) as [keyof Dist, number][]) {
      if (w <= 0) continue;
      if (state === 'elim') {
        out.elim += w;
        continue;
      }
      const broken = state === 'broken' || state === 'reducedBroken';
      const m = moraleAs(p, broken);
      const reduced = state === 'reduced' || state === 'reducedBroken';
      const o = mcOdds(m, mod + mcDrm(p, 'MC'), broken);
      const pass = 1 - o.fail - o.pin - o.twelve;
      out[state] += w * pass;
      if (broken) {
        // Reduced again: a half-squad is gone.
        if (reduced) out.elim += w * o.fail;
        else crInto(out, p, true, w * o.fail);
        out.elim += w * o.twelve;
      } else {
        out[reduced ? 'reducedBroken' : 'broken'] += w * o.fail;
        out[reduced ? 'reduced' : 'pinned'] += w * o.pin;
        if (reduced) out.elim += w * o.twelve;
        else crInto(out, p, true, w * o.twelve);
      }
    }
    return out;
  };
  /** A Pin Task Check (SK1 3.2.1): only a Good Order unit not yet pinned can be pinned, when its DR beats its Morale. */
  const ptcOn = (d: Dist, p: Piece, mod: number): Dist => {
    const out = { ...d };
    if (isPinned(p)) return out;
    const o = mcOdds(moraleAs(p, false), mod + mcDrm(p, 'PTC'), true);
    const pin = o.fail + o.twelve;
    out.pinned += out.none * pin;
    out.none *= 1 - pin;
    return out;
  };
  const start = (p: Piece): Dist => ({ ...zero(), [isBroken(p) ? 'broken' : 'none']: 1 });
  const only = (k: keyof Dist): Dist => ({ ...zero(), [k]: 1 });
  const scale = (d: Dist, w: number): Dist => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v * w])) as Dist;
  const sum = (x: Dist, y: Dist): Dist => Object.fromEntries(Object.keys(x).map((k) => [k, x[k as keyof Dist] + y[k as keyof Dist]])) as Dist;
  /**
   * One unit's own result: `picked` says whether it is the unit a K Casualty Reduces or one a KIA eliminates (the picks are
   * made once for the hex, so every unit's fate is worked out for the same ones); `lent` is the DRM a passing leader lends.
   */
  const ownResult = (p: Piece, r: IftResult, picked: boolean, lent: number): Dist => {
    const d = start(p);
    switch (r.kind) {
      case 'none':
        return d;
      case 'PTC':
        return ptcOn(d, p, lent);
      case 'MC':
      case 'NMC':
        return mcOn(d, p, (r.n ?? 0) + lent);
      case 'K': {
        if (!picked) return mcOn(d, p, (r.n ?? 0) + lent);
        // The unit picked is Casualty Reduced: a reduced squad still takes the MC with the others, a wounded leader
        // does not (SK1 3.2.1).
        const hit = zero();
        crInto(hit, p, isBroken(p), 1);
        return smc(env, p) ? hit : mcOn(hit, p, (r.n ?? 0) + lent);
      }
      case 'KIA': {
        if (picked) return only('elim');
        // The rest break, or are reduced if already broken.
        const rest = zero();
        if (isBroken(p)) crInto(rest, p, true, 1);
        else rest.broken = 1;
        return rest;
      }
    }
  };
  // Leader Loss (SK1 3.2.1): a leader broken makes the others in his Location below his Morale take a LLTC, one
  // eliminated a LLMC, his leadership DRM added to their DR as a penalty; they come after the attack's own checks.
  type Loss = { kind: 'LLTC' | 'LLMC'; from: PieceId; side: string; morale: number; mod: number };
  const lossOf = (l: Piece, kind: Loss['kind']): Loss => ({
    kind,
    from: l.id,
    side: l.side,
    morale: env.query('unit.morale', { unit: l.id }, smc(env, l)!.morale),
    mod: Math.max(0, -env.query('unit.leadership', { unit: l.id }, smc(env, l)!.leadership)),
  });
  const STATES = ['none', 'pinned', 'broken', 'reduced', 'reducedBroken', 'elim'] as const;
  /** Every way to pick `n` of `xs`, equally likely (the random selection of a K or KIA, SK1 3.2.1). */
  const choose = <T,>(xs: T[], n: number): T[][] => (n === 0 ? [[]] : n > xs.length ? [] : [...choose(xs.slice(1), n - 1).map((c) => [xs[0]!, ...c]), ...choose(xs.slice(1), n)]);

  for (const [a, b] of ROLLS) {
    const col = colOf(a, b);
    if (col === null) continue;
    const resOf = (p: Piece) => ift(col, a + b + drm + unitDrm[p.id]!);
    // The units that got the same result share it: one K, or a KIA's number, picked at random among them.
    const groups = new Map<number, Piece[]>();
    for (const p of targets) groups.set(unitDrm[p.id]!, [...(groups.get(unitDrm[p.id]!) ?? []), p]);
    let pickings: { w: number; picked: Set<PieceId> }[] = [{ w: 1, picked: new Set() }];
    for (const g of groups.values()) {
      const r = resOf(g[0]!);
      const n = r.kind === 'K' ? 1 : r.kind === 'KIA' ? Math.min(g.length, r.n ?? 1) : 0;
      const ways = choose(g.map((p) => p.id), n);
      pickings = pickings.flatMap((pk) => ways.map((c) => ({ w: pk.w / ways.length, picked: new Set([...pk.picked, ...c]) })));
    }
    for (const { w: pw, picked } of pickings) {
      // What befalls each leader, in the order they check: a branch per combination of their fates, each saying which
      // leaders passed unharmed (they lend their DRM to those after them) and what Leader Loss checks the rest cause.
      type Branch = { p: number; lenders: Piece[]; losses: Loss[]; fate: Map<PieceId, keyof Dist> };
      let branches: Branch[] = [{ p: pw, lenders: [], losses: [], fate: new Map() }];
      for (const l of leaders) {
        const r = resOf(l);
        // Only a leader Good Order (not in Melee) and unpinned before his check lends (`checkGroup`).
        const usable = !isBroken(l) && !isPinned(l) && isGoodOrder(env, l);
        const next: Branch[] = [];
        for (const br of branches) {
          const own = ownResult(l, r, picked.has(l.id), lentBy(br.lenders, l));
          for (const k of STATES) {
            const w = own[k];
            if (w <= 0) continue;
            // He checked and came through unharmed (a wounded leader picked by a K does not check).
            const passed = r.kind !== 'none' && !(r.kind === 'KIA') && !(r.kind === 'K' && picked.has(l.id)) && usable && k === 'none';
            // Broken by this attack (one broken already causes nothing new), or eliminated.
            const loss = k === 'elim' ? lossOf(l, 'LLMC') : !isBroken(l) && (k === 'broken' || k === 'reducedBroken') ? lossOf(l, 'LLTC') : null;
            next.push({ p: br.p * w, lenders: passed ? [...br.lenders, l] : br.lenders, losses: loss ? [...br.losses, loss] : br.losses, fate: new Map(br.fate).set(l.id, k) });
          }
        }
        branches = next;
      }

      for (const p of targets) {
        let d = zero();
        for (const br of branches) {
          let own = smc(env, p) ? only(br.fate.get(p.id)!) : ownResult(p, resOf(p), picked.has(p.id), lentBy(br.lenders, p));
          // Each Leader Loss check this unit is below, in turn (a leader broken by one causing another is left out).
          for (const loss of br.losses) {
            // Only his own side's units check, and a LLTC only those in Good Order (SK1 3.2.1; `flushLeaderLoss`).
            if (loss.from === p.id || loss.side !== p.side || (loss.kind === 'LLTC' && !isGoodOrder(env, p))) continue;
            // Only those below the leader's Morale check, as they stand by then (broken, a unit checks on its broken side).
            const below = { ...zero() };
            const rest = { ...zero() };
            for (const k of STATES) (k !== 'elim' && moraleAs(p, k === 'broken' || k === 'reducedBroken') < loss.morale ? below : rest)[k] = own[k];
            own = sum(rest, loss.kind === 'LLMC' ? mcOn(below, p, loss.mod) : ptcOn(below, p, loss.mod));
          }
          d = sum(d, scale(own, br.p));
        }
        const u = units[p.id]!;
        u.elim += d.elim / 36;
        u.reduced += (d.reduced + d.reducedBroken) / 36;
        // A unit broken before the attack and left so is no new harm.
        u.broken += (isBroken(p) ? 0 : d.broken) / 36;
        u.pinned += d.pinned / 36;
      }
    }
  }
  return { fp, column, drm, cower, effect, results, units };
}
