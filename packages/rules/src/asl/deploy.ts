import type { Action, Decision, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, personnelAt, statics, swHeldBy } from '../common/pieces';
import { locOf } from '../common/location';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { RP, type RphActedFn, type RphActionKind } from '../sk1/rally';
import { DEPLOYED_FROM, mergeHalfSquads, splitSquad, type DeployQuota } from '../sk1/setupDeploy';
import { T, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc, squadEquivalents } from '../sk1/status';
import { revealUnit } from '../sk2/hip';
import { isHidden } from '../sk2/status';
import { WA_TAG } from './wallAdvantage';
import { laborTag, parseLabor } from './labor';

/*
 * Deployment and Recombination (ASLRB A1.3, A1.31, A1.32, A2.9, A2.52, A5.5, A25.2, A25.61).
 *
 * - Deploy (A1.31): a Good Order squad with a Good Order leader in its Location splits into its two HS (A1.3: "the
 *   corresponding HS for that Class and type") on a leader-modified NTC, the leader's modifier applying "even if 0 or +1"
 *   (A10.7). One squad per leader per RPh, one attempt per squad; "Regardless of the outcome, neither leader nor squad may
 *   attempt any other action in that RPh" (both carry `rphAction: 'deploy'`, and the two HS inherit it). The squad's
 *   possessions are "freely rearranged among its HS when Deployed": the player names the weapons the second HS takes. Only
 *   the ATTACKER Deploys in the RPh: the Advanced Sequence of Play, which takes precedence, lists it at 1.21A ("A").
 *   An offboard squad awaiting entry may Deploy if stacked with a leader (A2.52): the same offboard hex is its Location.
 * - Recombine (A1.32): two Good Order HS "of the same nationality with an identical Strength Factor" become "a squad of
 *   the same type and Class": A1.3 makes a squad's HS its own Class and type, so the two must be the same HS counter (a
 *   German and an SS 2-3-8, or an Assault Engineer and a plain HS, have no common squad). They must "occupy the same
 *   Location and terrain (see 2.8) with a friendly Good Order leader": the A2.8 EX denies it across an entrenchment's
 *   rim, so both HS and the leader share their position (beneath or outside a foxhole or trench, on top of or beneath
 *   Wire). Either side, in every RPh (ASOP 1.13B, "B"). It is the HS's sole action, and the leader's "sole activity ...
 *   is to permit the Recombination of any eligible HS in his Location" (`rphAction: 'recombine'`, which lets him permit
 *   others and nothing else). The removed HS is no casualty.
 * - Who may Deploy (A25): Russian squads never (A25.2), Italians only their elite 4-4-7s (A25.61); the Japanese and the
 *   U.S.M.C. Deploy by Chapter G rules (G1.16, G17.11), which full ASL does not have yet. Every other nationality with
 *   counters (German, American, British, Allied Minor) has no restriction on the National Capabilities Chart.
 * - At setup (A2.9): up to 10% (FRU) of the squads that set up on-board, and of those entering in a given turn, may be
 *   Deployed without leader or TC before setup (`setup.deployQuota`); a card's own allowance adds to it.
 * - A5.5: two hidden HS stand in for a hidden squad only where the nationality may Deploy; otherwise a HS counts as a
 *   squad against a hidden-units quota.
 * - A10.7 / A4.431: a leader attempts one action per phase, rallying any number of units being one; units that Transfer a
 *   SW in the RPh have acted (Q&A to A4.431, and to A3.1 & A4.431). Recorded in `rphAction`, cleared at the RPh's end.
 * - A hidden squad or HS (and its leader) is placed on the board to Deploy or Recombine (Q&A to A1.31 & A12.3).
 *
 * Deferred: the units that need no leader (Finns, Guards, Carrier HS, unarmed units; A1.31 EXC, A1.32 EXC, A20.5), the
 * capturing squad exchanged for a HS (A21.22), Fanatic HS (A1.32), loss of "?" (A12.141), Chapter G Deployment.
 */

export const ASL_DEPLOY_MODULE = 'asl.deploy';
/** The setup group a squad deployed at setup belongs to ('setup' on-board, 'entry:<turn>' entering), for the A2.9 count. */
export const DEPLOYED_AT = 'deployedAt';

/** Who may Deploy (A25 and the A./G. National Capabilities Chart), by counter nationality. */
const NATION_DEPLOY: Record<string, { kind: 'all' } | { kind: 'none' | 'elite' | 'chapterG'; why: string }> = {
  ge: { kind: 'all' },
  am: { kind: 'all' },
  br: { kind: 'all' },
  al: { kind: 'all' },
  ru: { kind: 'none', why: 'Russian squads may not Deploy (A25.2)' },
  it: { kind: 'elite', why: 'Only elite Italian squads (4-4-7) may Deploy (A25.61)' },
  ja: { kind: 'chapterG', why: 'Japanese Deployment is a Chapter G rule (G1.16), not in play' },
};
/** U.S.M.C. squads (SK4 8.4 counters) Deploy by G17.11. */
const USMC = /^am\.(768|668|558|558r|558p|458)(\.ae)?$/;
const USMC_WHY = 'U.S.M.C. Deployment is a Chapter G rule (G17.11), not in play';

const sf = (env: QueryEnv, p: Piece) => {
  const m = mmc(env, p);
  return m ? `${m.fp}-${m.range}-${m.morale}` : p.defId;
};

/** Why `unit`'s nationality may not Deploy it (A25), or null. Only squads are asked. */
export function deployIncapable(env: QueryEnv, unit: PieceId): string | null {
  const p = env.state.pieces[unit];
  return p ? squadDefIncapable(env, p.defId) : 'Only a squad Deploys (A1.31)';
}
/** Why squads of this counter may not Deploy (A25), or null. */
export function squadDefIncapable(env: QueryEnv, defId: string): string | null {
  const m = statics(env).counters[defId];
  if (!m || m.kind !== 'squad') return 'Only a squad Deploys (A1.31)';
  if (USMC.test(defId)) return USMC_WHY;
  const n = NATION_DEPLOY[m.nationality] ?? { kind: 'all' };
  if (n.kind === 'all') return null;
  // A25.61: "4-4-7 squads, their 2-4-7 HS, and 2-2-7 crews are the only elite Italian MMC".
  if (n.kind === 'elite') return m.fp === 4 && m.range === 4 && m.morale === 7 ? null : n.why;
  return n.why;
}

/** Why a HS of this nationality may not Recombine at all here, or null (A25.2: Russians may). */
function recombineIncapable(p: Piece, nationality: string): string | null {
  if (USMC.test(p.defId) || /^am\.(348h|238h|238rh|238ph|248h)(\.ae)?$/.test(p.defId)) return 'U.S.M.C. Recombination is a Chapter G rule (G17.11), not in play';
  if (nationality === 'ja') return 'Japanese Recombination is a Chapter G rule (G1.2), not in play';
  return null;
}

/** The squad two HS of this counter Recombine into: the one squad of the counter set whose HS it is (A1.3, A1.32). */
export function squadOf(env: QueryEnv, hsDef: string): string | null {
  const found = Object.values(statics(env).counters).filter((c) => (c.kind === 'squad' && c.reducesTo === hsDef));
  return found.length === 1 ? found[0]!.id : null;
}

const rallySide = (env: QueryEnv, d: Decision): SideId => (d.data?.['side'] as SideId | undefined) ?? env.state.attacker;

/** Offboard units set up awaiting entry (A2.52): in an offboard hex. */
const offboardStacked = (p: Piece) => p.loc.kind === 'offboard' && !!p.loc.hex && p.loc.edge !== 'setup' && p.loc.edge !== 'exited';
const sameLocation = (env: QueryEnv, a: Piece, b: Piece): boolean => {
  if (a.loc.kind === 'hex') return b.loc.kind === 'hex' && locOf(env.state, a) === locOf(env.state, b);
  return offboardStacked(a) && offboardStacked(b) && a.loc.kind === 'offboard' && b.loc.kind === 'offboard' && a.loc.hex === b.loc.hex;
};
const posOf = (p: Piece) => (p.loc.kind === 'hex' ? { ent: p.loc.pos?.ent, wire: p.loc.pos?.wire } : { ent: undefined, wire: undefined });
/** Why two units on the map are not in the same terrain of their Location (A2.8 and its EX), or null. */
function terrainDiffers(a: Piece, b: Piece, who: string): string | null {
  const pa = posOf(a);
  const pb = posOf(b);
  if (!!pa.ent !== !!pb.ent) return `${who} beneath the entrenchment, the other is not (A1.32, A2.8)`;
  if ((pa.wire ?? null) !== (pb.wire ?? null)) return `${who} ${pa.wire === 'beneath' || pb.wire === 'beneath' ? 'beneath' : 'on top of'} the Wire, the other is not (A1.32, A2.8)`;
  return null;
}

/** What a unit's `rphAction` says it did, for a reason. */
function didWhat(v: unknown, leader: boolean): string {
  if (v === 'rally') return 'rallied this RPh';
  if (v === 'transfer') return 'transferred a SW this RPh';
  if (v === 'deploy') return leader ? 'directed a Deployment this RPh' : 'attempted to Deploy this RPh';
  if (v === 'recombine') return leader ? 'permitted a Recombination this RPh' : 'recombined this RPh';
  if (typeof v === 'number') return 'attempted a repair this RPh';
  return 'acted this RPh';
}
/** Why a unit that has acted this RPh may not take `action` too (A3.1, A10.7), or null. */
export function actedIllegal(env: QueryEnv, unit: PieceId, action: RphActionKind): string | null {
  const p = env.state.pieces[unit];
  const v = p?.tags[T.rphAction];
  if (!p || v === undefined) return null;
  // Rallying more than one unit is one action (A10.7); further Transfers and Recombinations are the same action.
  if (v === action && (action === 'rally' || action === 'transfer' || action === 'recombine')) return null;
  if (action === 'repair' && typeof v === 'number') return null;
  const leader = !!smc(env, p);
  return leader ? `The leader already ${didWhat(v, true)}: one action per phase (A10.7)` : `Already ${didWhat(v, false)}: one action per RPh (A3.1)`;
}

/** The Good Order leaders of `side` that could direct `squad`'s Deployment where it stands. */
export const deployLeaders = (env: QueryEnv, squad: PieceId): Piece[] => {
  const p = env.state.pieces[squad];
  if (!p) return [];
  return Object.values(env.state.pieces)
    .filter((l) => l.side === p.side && l.id !== squad && !!smc(env, l) && sameLocation(env, p, l))
    .sort(byId);
};

/** Why `squad` may not attempt to Deploy under `leader` now (A1.31, A2.52, A3.1, A10.7, A25), or null. */
export function rphDeployIllegal(env: QueryEnv, side: SideId, squad: PieceId, leader: PieceId | null): string | null {
  if (env.state.phase !== 'RPh') return 'Only in the Rally Phase (A1.31)';
  const p = env.state.pieces[squad];
  if (!p || p.side !== side) return 'Not one of your units';
  const m = mmc(env, p);
  if (m?.kind !== 'squad' || !m.reducesTo) return 'Only a squad Deploys (A1.31)';
  if (env.state.attacker !== side) return 'Only the ATTACKER Deploys, in his own RPh (A1.31; ASOP 1.21A)';
  const incapable = deployIncapable(env, squad);
  if (incapable) return incapable;
  if (p.loc.kind !== 'hex' && !offboardStacked(p)) return 'The squad must be on the map, or set up offboard awaiting entry (A2.52)';
  if (!isGoodOrder(env, p) || isPinned(p)) return 'Only a Good Order squad Deploys (A1.31)';
  const done = p.tags[T.rphAction];
  if (p.tags[T.rallyTried]) return 'It rallied this RPh, so it may not also Deploy (A3.1 EX)';
  if (done !== undefined) return `Already ${didWhat(done, false)}: a squad may be subject to one Deployment attempt and no other action per RPh (A1.31, A3.1)`;
  const leaders = deployLeaders(env, squad).filter((l) => isGoodOrder(env, l) && !isPinned(l));
  if (!leaders.length) return p.loc.kind === 'hex' ? 'No Good Order leader in the Location (A1.31)' : 'No Good Order leader stacked with it offboard (A2.52)';
  if (leader === null) return null;
  const l = env.state.pieces[leader];
  if (!l || !leaders.some((x) => x.id === leader)) return 'That leader is not a Good Order leader in the squad’s Location (A1.31)';
  if (l.tags[T.rphAction] !== undefined) return `The leader already ${didWhat(l.tags[T.rphAction], true)}: he may direct one Deployment and do nothing else that RPh (A1.31, A10.7)`;
  return null;
}

/** Why `units` may not Recombine under `leader` now (A1.3, A1.32, A2.8, A10.7), or null. */
export function recombineIllegal(env: QueryEnv, side: SideId, units: PieceId[], leader: PieceId | null): string | null {
  if (env.state.phase !== 'RPh') return 'Only in the Rally Phase (A1.32)';
  if (units.length !== 2 || units[0] === units[1]) return 'Two half-squads Recombine (A1.32)';
  const ps = units.map((u) => env.state.pieces[u]);
  if (ps.some((p) => !p || p.side !== side)) return 'Not your units';
  const [a, b] = ps as [Piece, Piece];
  const ma = mmc(env, a);
  const mb = mmc(env, b);
  if (ma?.kind !== 'hs' || mb?.kind !== 'hs') return 'Only two half-squads Recombine (A1.32)';
  const incapable = recombineIncapable(a, ma.nationality) ?? recombineIncapable(b, mb.nationality);
  if (incapable) return incapable;
  if (ma.nationality !== mb.nationality) return 'Half-squads of different nationalities do not Recombine (A1.32)';
  if (sf(env, a) !== sf(env, b)) return `Different Strength Factors (${sf(env, a)}, ${sf(env, b)}) (A1.32)`;
  if (a.defId !== b.defId) return 'Different Class or type: only half-squads of the same Class and type Recombine (A1.3, A1.32)';
  if (!squadOf(env, a.defId)) return 'No squad of that Class and type to Recombine into (A1.3)';
  if (a.loc.kind !== 'hex' || b.loc.kind !== 'hex') return 'Only on the map: offboard units take no action but Deployment (A2.52)';
  if (locOf(env.state, a) !== locOf(env.state, b)) return 'Not in the same Location (A1.32)';
  const apart = terrainDiffers(a, b, 'One is');
  if (apart) return apart;
  if (!isGoodOrder(env, a) || !isGoodOrder(env, b) || isPinned(a) || isPinned(b)) return 'Both half-squads must be in Good Order (A1.32)';
  for (const p of [a, b]) if (p.tags[T.rphAction] !== undefined) return `Already ${didWhat(p.tags[T.rphAction], false)}: Recombining must be their sole action in the RPh (A1.32)`;
  const here = personnelAt(env, locOf(env.state, a)!, side).filter((l) => !!smc(env, l) && isGoodOrder(env, l) && !isPinned(l)).sort(byId);
  if (!here.length) return 'No Good Order leader in the Location (A1.32)';
  const sharing = here.filter((l) => !terrainDiffers(a, l, ''));
  if (!sharing.length) return `The leader must share their terrain: he is ${posOf(here[0]!).ent ? 'beneath the entrenchment' : posOf(here[0]!).wire ? `${posOf(here[0]!).wire === 'on' ? 'on top of' : 'beneath'} the Wire` : 'outside it'} (A1.32, A2.8)`;
  if (leader === null) return null;
  if (!here.some((l) => l.id === leader)) return 'That leader is not a Good Order leader in their Location (A1.32)';
  const l = pieceOf(env, leader);
  if (terrainDiffers(a, l, '')) return `That leader is not in their terrain (A1.32, A2.8)`;
  const done = l.tags[T.rphAction];
  if (done !== undefined && done !== 'recombine') return `The leader already ${didWhat(done, true)}: permitting Recombination must be his sole activity in the RPh (A1.32, A10.7)`;
  return null;
}

/** The default weapons split of a Deployment: one each in turn, the first HS first (A1.31). */
export const defaultDeploySplit = (env: QueryEnv, squad: PieceId): PieceId[] =>
  swHeldBy(env.state, squad)
    .sort(byId)
    .filter((_, i) => i % 2 === 1)
    .map((w) => w.id);

/** A setup group's squads and those of them already deployed (A2.9). */
function setupGroup(env: QueryEnv, side: SideId, p: Piece): { key: string; squads: number; used: number; entry: boolean } {
  const forces = statics(env).scenario.forces;
  const force = typeof p.tags['force'] === 'number' ? forces[p.tags['force'] as number] : undefined;
  const entering = force?.setup.kind === 'enter';
  const key = entering ? `entry:${p.tags['entryTurn']}` : 'setup';
  const used = Object.values(env.state.pieces).filter((q) => q.side === side && q.tags[DEPLOYED_AT] === key).length;
  let squads: number;
  if (!entering) {
    const counters = statics(env).counters;
    squads = forces.filter((f) => f.side === side && f.setup.kind !== 'enter').reduce((n, f) => n + f.units.filter((u) => counters[u.def]?.kind === 'squad').reduce((k, u) => k + u.count, 0), 0);
  } else {
    // Each turn's entering squads are their own count; a squad deployed at its offboard setup still counts.
    squads = Object.values(env.state.pieces).filter((q) => q.side === side && q.tags['entryTurn'] === p.tags['entryTurn'] && typeof q.tags['force'] === 'number' && forces[q.tags['force'] as number]?.setup.kind === 'enter' && mmc(env, q)?.kind === 'squad').length + used;
  }
  return { key, squads, used, entry: entering };
}

/** A5.5 in full ASL: a HS of a nationality that may not Deploy counts as a squad against a hidden-units quota. */
function hiddenQuotaSe(env: QueryEnv, pieces: Piece[]): number {
  return pieces.reduce((n, p) => {
    const m = mmc(env, p);
    if (m?.kind !== 'hs') return n + squadEquivalents(env, [p]);
    const squad = squadOf(env, p.defId);
    return n + (squad && !squadDefIncapable(env, squad) ? 0.5 : 1);
  }, 0);
}

type DeployAction = Action & { type: 'rally.deploy'; unit: PieceId; leader: PieceId; second?: PieceId[] };
type RecombineAction = Action & { type: 'rally.recombine'; units: PieceId[]; leader: PieceId };

export interface AslDeployEvent {
  unit: PieceId;
  leader: PieceId;
  from: string;
  to: string;
  dr: [number, number];
  drm: number;
  morale: number;
  passed: boolean;
  halves?: PieceId[];
  offboard?: boolean;
}
export interface AslRecombinedEvent {
  squad: PieceId;
  removed: PieceId;
  leader: PieceId;
  from: string;
  to: string;
}

export const aslDeployModule: RuleModule = {
  id: ASL_DEPLOY_MODULE,
  ref: 'ASLRB A1.31, A1.32, A2.9, A2.52, A5.5, A25.2, A25.61',
  summary: 'Deploy (a leader-directed NTC, the ATTACKER in his RPh, offboard too) and Recombine (both sides, a leader present); the A2.9 10% at setup; one action per leader per RPh.',
  requires: ['sk1.rally', 'ssr.setup-deploy'],
  install(r) {
    r.event<AslDeployEvent>({ type: 'asl.deploy', apply() {} });
    r.event<AslRecombinedEvent>({
      type: 'asl.recombined',
      // The removed HS is folded into the squad: off the map, no casualty.
      apply(d, p) {
        const gone = d.pieces[p.removed];
        if (gone) {
          gone.loc = { kind: 'eliminated' };
          gone.tags = { recombined: true };
        }
      },
    });

    // A10.7, A4.431: one action per leader, a Transfer an action.
    r.contribute({ id: 'asl.deploy.acted', query: 'rally.actionIllegal', ref: 'ASLRB A3.1, A10.7, A4.431', apply: (v, { unit, action }, env) => v ?? actedIllegal(env, unit, action) });
    r.procedure<RphActedFn>(RP.acted, (next) => (ctx, unit, action) => {
      next?.(ctx, unit, action);
      if (ctx.state.pieces[unit]?.tags[T.rphAction] !== action) setTags(ctx, unit, { [T.rphAction]: action });
    });

    // A2.9: the 10% (FRU) per setup group, added to any card allowance; refused for a nationality that may not Deploy.
    r.contribute({
      id: 'asl.deploy.quota',
      query: 'setup.deployQuota',
      ref: 'ASLRB A2.9',
      apply(v, { side, unit }, env) {
        const p = env.state.pieces[unit];
        if (!p) return v;
        const why = mmc(env, p)?.kind === 'squad' ? deployIncapable(env, unit) : null;
        if (why) return v ?? { max: 0, used: 0, rule: 'A2.9', refused: why };
        const g = setupGroup(env, side, p);
        const tenth = Math.ceil(g.squads / 10);
        const extra = v ? v.max : 0;
        // A card's allowance is one count over the side's setup deployments beyond each group's own 10%.
        let elsewhere = 0;
        if (v) {
          const keys = new Set(Object.values(env.state.pieces).filter((q) => q.side === side && typeof q.tags[DEPLOYED_AT] === 'string').map((q) => q.tags[DEPLOYED_AT] as string));
          for (const k of keys) {
            if (k === g.key) continue;
            const rep = Object.values(env.state.pieces).find((q) => q.side === side && q.tags[DEPLOYED_AT] === k)!;
            const o = setupGroup(env, side, rep);
            elsewhere += Math.max(0, o.used - Math.ceil(o.squads / 10));
          }
        }
        const quota: DeployQuota = {
          max: tenth + Math.max(0, extra - elsewhere),
          used: g.used,
          rule: v ? `A2.9 and ${v.rule}` : 'A2.9',
          full: `10% of ${g.squads} squad${g.squads === 1 ? '' : 's'}, rounded up: ${tenth}${v ? `, plus ${v.rule}` : ''} (A2.9)`,
          ...(g.entry ? { entry: true } : {}),
        };
        return quota;
      },
    });
    r.on<{ side: SideId; squad: PieceId }>({
      id: 'asl.deploy.setupGroup',
      event: 'ssr.setup-deploy',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.squad];
        if (p) setTags(ctx, p.id, { [DEPLOYED_AT]: setupGroup(ctx, p.side, p).key });
      },
    });

    // A5.5: a hidden HS stands for half a squad only where its nationality may Deploy.
    r.contribute({
      id: 'asl.deploy.hiddenQuota',
      query: 'hidden.quotaSquadEquivalents',
      ref: 'ASLRB A5.5',
      apply: (_v, { units }, env) => hiddenQuotaSe(env, units.map((u) => env.state.pieces[u]).filter((p): p is Piece => !!p)),
    });

    // A1.31, A2.52: Deploy in the RPh.
    r.action<DeployAction>({
      type: 'rally.deploy',
      decisionKinds: [PHASE_DECISION],
      legal(env, d) {
        if (env.state.phase !== 'RPh') return [];
        const side = rallySide(env, d);
        if (side !== env.state.attacker) return [];
        const out: DeployAction[] = [];
        for (const p of Object.values(env.state.pieces).filter((x) => x.side === side && mmc(env, x)?.kind === 'squad').sort(byId)) {
          if (rphDeployIllegal(env, side, p.id, null)) continue;
          for (const l of deployLeaders(env, p.id)) {
            if (!rphDeployIllegal(env, side, p.id, l.id)) out.push({ type: 'rally.deploy', unit: p.id, leader: l.id, second: defaultDeploySplit(env, p.id) } as DeployAction);
          }
        }
        return out;
      },
      validate(env, a, d) {
        const why = rphDeployIllegal(env, rallySide(env, d), a.unit, a.leader ?? null);
        if (why) return why;
        if (!a.leader) return 'Name the leader who directs the Deployment (A1.31)';
        const held = new Set(swHeldBy(env.state, a.unit).map((w) => w.id));
        if ((a.second ?? []).some((w) => !held.has(w))) return 'The second half-squad may take only the squad’s own weapons (A1.31)';
        return null;
      },
      resolve(ctx, a, d) {
        const side = rallySide(ctx, d);
        // A hidden squad and its leader are placed on the board to Deploy (Q&A to A1.31 & A12.3).
        for (const id of [a.unit, a.leader]) if (isHidden(pieceOf(ctx, id))) revealUnit(ctx, id, 'deploy');
        const p = pieceOf(ctx, a.unit);
        const m = mmc(ctx, p)!;
        const morale = ctx.query('unit.morale', { unit: a.unit }, m.morale);
        const drm = ctx.query('unit.leadership', { unit: a.leader, for: a.unit }, smc(ctx, pieceOf(ctx, a.leader))!.leadership);
        const roll = ctx.roll(`NTC to Deploy ${a.unit}`);
        const passed = roll.total + drm <= morale;
        // Pass or fail, neither may attempt any other action this RPh (A1.31); the HS inherit the squad's tag.
        setTags(ctx, a.unit, { [T.rphAction]: 'deploy' });
        setTags(ctx, a.leader, { [T.rphAction]: 'deploy' });
        const base = { unit: a.unit, leader: a.leader, from: p.defId, to: m.reducesTo!, dr: roll.dice as [number, number], drm, morale, ...(p.loc.kind === 'offboard' ? { offboard: true } : {}) };
        if (passed) {
          const second = `${p.id}.d${ctx.state.seq}`;
          splitSquad(ctx, p.id, second);
          for (const w of [...(a.second ?? [])].sort()) ctx.emit('piece.moved', { id: w, loc: { kind: 'held', by: second } });
          ctx.emit('asl.deploy', { ...base, passed: true, halves: [p.id, second] } satisfies AslDeployEvent);
        } else ctx.emit('asl.deploy', { ...base, passed: false } satisfies AslDeployEvent);
        ctx.popDecision(d.id);
        askPhaseOwner(ctx, side, { side });
      },
    });

    // A1.32: Recombine, either side, every RPh.
    r.action<RecombineAction>({
      type: 'rally.recombine',
      decisionKinds: [PHASE_DECISION],
      legal(env, d) {
        if (env.state.phase !== 'RPh') return [];
        const side = rallySide(env, d);
        const out: RecombineAction[] = [];
        const hs = Object.values(env.state.pieces).filter((p) => p.side === side && p.loc.kind === 'hex' && mmc(env, p)?.kind === 'hs').sort(byId);
        for (let i = 0; i < hs.length; i++)
          for (let j = i + 1; j < hs.length; j++) {
            const a = hs[i]!;
            const b = hs[j]!;
            if (locOf(env.state, a) !== locOf(env.state, b) || recombineIllegal(env, side, [a.id, b.id], null)) continue;
            const leader = personnelAt(env, locOf(env.state, a)!, side)
              .filter((l) => !!smc(env, l))
              .sort(byId)
              .find((l) => !recombineIllegal(env, side, [a.id, b.id], l.id));
            if (leader) out.push({ type: 'rally.recombine', units: [a.id, b.id], leader: leader.id } as RecombineAction);
          }
        return out;
      },
      validate: (env, a, d) => recombineIllegal(env, rallySide(env, d), a.units, a.leader ?? null) ?? (a.leader ? null : 'Name the leader who permits the Recombination (A1.32)'),
      resolve(ctx, a, d) {
        const side = rallySide(ctx, d);
        for (const id of [...a.units, a.leader]) if (isHidden(pieceOf(ctx, id))) revealUnit(ctx, id, 'recombine');
        const [keep, gone] = [...a.units].sort() as [PieceId, PieceId];
        const k = pieceOf(ctx, keep);
        const g = pieceOf(ctx, gone);
        const squad = squadOf(ctx, k.defId)!;
        // What the squad keeps of the two HS: CX and Wall Advantage if either had it, the better Labor of one Task (B24.8).
        const merged: Record<string, string | number | boolean | null> = {};
        if (g.tags[T.cx] && !k.tags[T.cx]) merged[T.cx] = g.tags[T.cx] as never;
        if (g.tags[WA_TAG] !== undefined && k.tags[WA_TAG] === undefined) merged[WA_TAG] = g.tags[WA_TAG] as never;
        const lk = parseLabor(k.tags['labor']);
        const lg = parseLabor(g.tags['labor']);
        if (lg && (!lk || (lk.task === lg.task && lg.drm < lk.drm))) merged['labor'] = laborTag(lg.task, lg.drm);
        const hsDef = k.defId;
        mergeHalfSquads(ctx, keep, gone, squad);
        setTags(ctx, keep, { ...merged, [T.rphAction]: 'recombine', [DEPLOYED_FROM]: null });
        setTags(ctx, a.leader, { [T.rphAction]: 'recombine' });
        for (const l of Object.values(ctx.state.pieces).filter((x) => x.tags[T.stackedOn] === gone).sort(byId)) setTags(ctx, l.id, { [T.stackedOn]: keep });
        ctx.emit('asl.recombined', { squad: keep, removed: gone, leader: a.leader, from: hsDef, to: squad } satisfies AslRecombinedEvent);
        ctx.popDecision(d.id);
        askPhaseOwner(ctx, side, { side });
      },
    });
  },
};

export type { DeployAction as AslDeployAction, RecombineAction as AslRecombineAction };
