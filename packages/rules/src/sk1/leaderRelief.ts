import type { Ctx, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { P as MP, type UnitFn } from './morale';
import { T, drmNotes, isBroken, isPinned, setTags, smc, type DrmNote } from './status';

/*
 * A leader relieved of command by SSR (LMA5 SSR 4: "At each American RPh, from the second turn, the American 6+1
 * leader (Lt Dike) takes a MC; if he fails it he is Pinned for the rest of the game and a 10-2 leader (Lt Speirs)
 * appears as a reinforcement the following turn on X0-CC3; this event also happens if the 6+1 leader fails a MC
 * during combat"). From `fromTurn`, as each Rally Phase of the leader's side starts, he takes a Morale Check (2d6
 * against his morale, with any MC DRM rules add; no leadership of his own). Failing it does not break him: he is
 * relieved, Pinned for the rest of the game, and the replacement force is due to enter the next Game Turn. Failing
 * any other MC (combat, Leader Loss) relieves him too, with its own result (broken, Casualty Reduced or eliminated)
 * standing; once he rallies he is Pinned again. It happens once: a relieved leader takes no further check.
 * Rolling exactly his morale passes with the usual Pin for the turn (SK1 3.2.1), as any MC.
 */

export const LEADER_RELIEF_MODULE = 'leader-relief';
export interface LeaderReliefParams {
  side: SideId;
  /** The force the leader is created with and his counter (the first such counter of the force is the one). */
  force: string;
  leader: string;
  /** His name on the card ("Lt Dike") and the replacement's ("Lt Speirs"). */
  name: string;
  /** The first Game Turn the Rally Phase check is taken. */
  fromTurn: number;
  /** The replacement force (setup `{ kind: 'enter', provisional: 'ssr' }`): due the Game Turn after the failure. */
  replacement: { force: string; name: string };
  /** The card's name for the rule, e.g. 'SSR 4'. */
  rule?: string;
}

const STATE = 'ssr.leaderRelief';
/** The tag a relieved leader wears: the board and the inspector show it. */
export const RELIEVED_TAG = 'relieved';

export interface LeaderReliefEvent {
  unit: PieceId;
  /** The leader's force (the rule's key). */
  force: string;
  side: SideId;
  name: string;
  rule: string;
  /** 'check': the Rally Phase MC (SSR); 'combat': another failed MC. */
  why: 'check' | 'combat';
  replacement: { name: string; turn: number; units: PieceId[] };
}

export const leaderReliefParams = (env: QueryEnv): LeaderReliefParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === LEADER_RELIEF_MODULE && s.params)
    .map((s) => s.params as unknown as LeaderReliefParams);

const ruleName = (q: LeaderReliefParams) => q.rule ?? 'SSR';
/** The reason the Rally Phase check is recorded with (the combat trigger leaves it alone). */
const checkReason = (q: LeaderReliefParams) => `${ruleName(q)}: ${q.name}'s Morale Check`;

/** Whether the rule's leader has been relieved. */
export const isRelieved = (env: QueryEnv, q: LeaderReliefParams): boolean =>
  !!((env.state.ext[STATE] as Record<string, boolean> | undefined) ?? {})[q.force];

/** The leader the rule names: the first counter of his def created with his force (whatever it has become since). */
export function namedLeader(env: QueryEnv, q: LeaderReliefParams): Piece | undefined {
  const fi = statics(env).scenario.forces.findIndex((f) => f.id === q.force);
  if (fi < 0) return undefined;
  return Object.values(env.state.pieces)
    .filter(
      (p) =>
        p.side === q.side && p.id.startsWith(`${q.side}.${fi}.`) && p.id.includes(`.${q.leader}.`),
    )
    .sort(byId)[0];
}

function relieve(ctx: Ctx, q: LeaderReliefParams, unit: PieceId, why: 'check' | 'combat') {
  const sc = statics(ctx).scenario;
  const fi = sc.forces.findIndex((f) => f.id === q.replacement.force);
  const turn = ctx.state.turn + 1;
  const units = Object.values(ctx.state.pieces)
    .filter(
      (p) => p.tags['force'] === fi && p.tags['entryRoll'] === 'ssr' && p.tags['entryTurn'] === 0,
    )
    .sort(byId);
  ctx.emit('ssr.leaderRelief', {
    unit,
    force: q.force,
    side: q.side,
    name: q.name,
    rule: ruleName(q),
    why,
    replacement: { name: q.replacement.name, turn, units: units.map((p) => p.id) },
  } satisfies LeaderReliefEvent);
  for (const p of units) setTags(ctx, p.id, { entryTurn: turn });
  const p = ctx.state.pieces[unit];
  if (p && p.loc.kind !== 'eliminated') {
    setTags(ctx, unit, {
      [RELIEVED_TAG]: `relieved (${ruleName(q)}): pinned for the rest of the game`,
    });
    pinForGood(ctx, p.id);
  }
}

/** The relieved leader is Pinned whenever he is not broken (a broken unit cannot be pinned). */
function pinForGood(ctx: Ctx, unit: PieceId) {
  const p = ctx.state.pieces[unit];
  if (!p || p.loc.kind === 'eliminated' || !p.tags[RELIEVED_TAG] || isBroken(p) || isPinned(p))
    return;
  setTags(ctx, unit, { [T.pinned]: true });
}

export const leaderReliefModule: RuleModule = {
  id: 'ssr.leader-relief',
  summary:
    'A named leader takes a MC each Rally Phase of his side; failing it (or any MC) he is pinned for good and a replacement leader enters the next turn (SSR).',
  requires: ['sk1.morale', 'sk1.scenario', 'common.turn'],
  install(r) {
    r.event<LeaderReliefEvent>({
      type: 'ssr.leaderRelief',
      apply(d, p) {
        // Keyed by the leader's force (one named leader per force).
        d.ext[STATE] = {
          ...((d.ext[STATE] as Record<string, boolean> | undefined) ?? {}),
          [p.force]: true,
        };
      },
    });

    // The Rally Phase check, as the leader's side's RPh starts.
    r.on<{ phase: string }>({
      id: 'ssr.leader-relief.check',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh' || ctx.state.result) return;
        for (const q of leaderReliefParams(ctx)) {
          if (ctx.state.attacker !== q.side || ctx.state.turn < q.fromTurn || isRelieved(ctx, q))
            continue;
          const p = namedLeader(ctx, q);
          if (!p || p.loc.kind !== 'hex' || isBroken(p) || !smc(ctx, p)) continue;
          const reason = checkReason(q);
          const morale = ctx.query('unit.morale', { unit: p.id }, smc(ctx, p)!.morale);
          const extra = ctx.explain('mc.drm', { unit: p.id, kind: 'MC', reason }, 0);
          const roll = ctx.roll(`${reason}: MC for ${p.id}`);
          const final = roll.total + extra.value;
          const explain: DrmNote[] = drmNotes(extra);
          const outcome = final >= morale ? 'pinned' : 'passed';
          ctx.emit('sk1.check', {
            unit: p.id,
            kind: 'MC',
            dr: roll.total,
            final,
            target: morale,
            outcome,
            reason,
            drm: final - roll.total,
            explain,
          });
          if (final > morale) relieve(ctx, q, p.id, 'check');
          else if (final === morale) ctx.proc<UnitFn>(MP.pin)(ctx, p.id);
        }
      },
    });

    // Any other failed MC relieves him too (its own result stands).
    r.on<{ unit: PieceId; kind: string; final: number; target: number; reason: string }>({
      id: 'ssr.leader-relief.combat',
      event: 'sk1.check',
      handler(ctx, ev) {
        const e = ev.payload;
        if (e.kind !== 'MC' || e.final <= e.target) return;
        for (const q of leaderReliefParams(ctx)) {
          if (e.reason === checkReason(q) || isRelieved(ctx, q)) continue;
          if (namedLeader(ctx, q)?.id !== e.unit) continue;
          relieve(ctx, q, e.unit, 'combat');
        }
      },
    });

    // Pinned for the rest of the game: back on whenever the Pin comes off or he rallies.
    r.on<{ id: PieceId }>({
      id: 'ssr.leader-relief.pinned',
      event: 'piece.tagged',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.id];
        if (p?.tags[RELIEVED_TAG]) pinForGood(ctx, p.id);
      },
    });
  },
};

/** What the board says of a relieved leader ("relieved (SSR 4): pinned for the rest of the game"), or null. */
export const relievedNote = (p: Piece): string | null =>
  typeof p.tags[RELIEVED_TAG] === 'string' ? (p.tags[RELIEVED_TAG] as string) : null;
