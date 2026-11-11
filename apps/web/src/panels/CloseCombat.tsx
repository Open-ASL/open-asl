import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Action, Decision, HexId, LoggedEvent, Piece, PieceId, QueryEnv, SideId } from '@asl/engine';
import {
  ccAttackPreview,
  ccDefensiveGroup,
  ccStateOf,
  ccUnits,
  declarationOptions,
  isBroken,
  mmc,
  otherSide,
  personnelAt,
  smc,
  stackedOn,
  type CcAttack,
  type CcAttackPreview,
} from '@asl/rules';
import { playSfx } from '../audio/engine';
import { Die, displayDice } from '../fx/DiceTray';
import { counterImage } from '../game/assets';
import { hexLabel, pieceLabel } from '../game/describe';

/*
 * The Close Combat overlay (SK1 3.8): both players watch one hex's Close Combat here, from the
 * leaders being arranged, through the ambush dice, each side dragging its units into attack
 * groups and locking them in, to the dice and their results on the counters. Everything shown is
 * read from the presented state and log (the game as far as the dice have been revealed), so the
 * two players, and a replay, see the same thing; the only local state is the draft of the
 * declaring player's groups and the drag in hand.
 */

type Order = Omit<Action, 'side' | 'decisionId'>;

interface Props {
  env: QueryEnv;
  log: LoggedEvent[];
  resolving: boolean;
  decision: Decision | undefined;
  /** The side this browser may act for now (undefined: someone else's move, or results still showing). */
  owner: SideId | undefined;
  waitingOn: SideId | undefined;
  sideName(s?: string): string;
  run(a: Order): string | null;
  check(a: Order): string | null;
  plain(m: string | null | undefined): string | null;
  animate: boolean;
  /** How long (ms) the results stay up once the hex's Close Combat is over; longer at the Slow pace. */
  linger?: number;
  /** Told whether the overlay is up (open, or lingering over its results), so the screen can hold back what would cover it. */
  onShown?(shown: boolean): void;
  /** Told while the overlay lingers over its results, so a computer opponent waits before playing on over them. */
  onLinger?(lingering: boolean): void;
}

interface UnitSnap {
  id: PieceId;
  side: SideId;
  defId: string;
  label: string;
}

interface CcSession {
  hex: HexId;
  /** The seq of the state event that began this hex's Close Combat: its dice come after it. */
  openedSeq: number;
  attacker: SideId;
  units: Record<SideId, UnitSnap[]>;
  /** open → linger (results readable) → out (fading) → gone. */
  phase: 'open' | 'linger' | 'out';
}

interface UnitView extends UnitSnap {
  img: string | null;
  dead: boolean;
  reduced: boolean;
  broken: boolean;
  leader: boolean;
  stackedOn: PieceId | null;
  /** Sequential CC: this unit has made its attack already. */
  spent: boolean;
}

interface Card {
  key: string;
  side: SideId;
  attackers: PieceId[];
  targets: PieceId[];
  preview: CcAttackPreview | null;
  dice?: number[];
  result?: { odds: string; drm: number; dr: number; kill: number; result: string };
  note?: string;
}

interface AmbushView {
  rolls: Partial<Record<SideId, { dr: number; drm: number }>>;
  /** null: no ambush; undefined: the second die has not shown yet. */
  ambusher: SideId | null | undefined;
}

type Step = 'arrange' | 'ambush' | 'declare' | 'resolving';

interface View {
  hex: HexId;
  attacker: SideId;
  defender: SideId;
  step: Step;
  /** Whose decision it is (arrange / declare), when there is one for this hex. */
  acting?: SideId;
  sequential: boolean;
  ambush: AmbushView | null;
  roster: Record<SideId, UnitView[]>;
  /** Declared and resolved attacks, the side that goes first listed first. */
  cards: Card[];
  order: SideId[];
  melee: boolean;
}

const LINGER = 2600;
const FADE = 450;

/** The odds column as the QRDC prints it: "3-2". */
const oddsLabel = (odds: string | null) => (odds ? odds.replace(':', '-') : '—');
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const shortLabel = (env: QueryEnv, p: Piece | undefined) => pieceLabel(env, p).replace(/^\S+ /, '');

const RESULT_TEXT: Record<string, string> = { eliminated: 'Eliminated', 'casualty reduction': 'Casualty Reduction', 'no effect': 'No effect' };

// ------------------------------------------------------------------ session: when the overlay is up and what it remembers

/** Where in the log this hex's Close Combat began (the first arrange step of `beginHex`). */
function openedSeqOf(log: LoggedEvent[], hex: HexId, fallback: number): number {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.type !== 'sk1.cc.state') continue;
    const st = (e.payload as { state: { hex?: HexId; step?: string; arranged?: SideId[] } | null }).state;
    if (st?.hex === hex && st.step === 'arrange' && (st.arranged?.length ?? 0) === 0) return e.seq;
  }
  return fallback;
}

function useCcSession(env: QueryEnv, log: LoggedEvent[], animate: boolean, linger: number): CcSession | null {
  const [session, setSession] = useState<CcSession | null>(null);
  // A game that ends (a concession, say) with a Close Combat still open lets the overlay go.
  const hex = env.state.result ? undefined : ccStateOf(env)?.hex;
  const seq = env.state.seq;
  useEffect(() => {
    // An undo (or an online rollback) to before the overlay opened: nothing to linger over.
    if (session && seq < session.openedSeq) {
      setSession(null);
      return;
    }
    if (session?.phase === 'open' && session.hex !== hex) {
      setSession({ ...session, phase: 'linger' });
      return;
    }
    if (!session && hex) {
      const sides = env.state.sides;
      const units = Object.fromEntries(
        sides.map((side) => [side, ccUnits(env, hex, side).map((p) => ({ id: p.id, side, defId: p.defId, label: shortLabel(env, p) }))]),
      ) as Record<SideId, UnitSnap[]>;
      setSession({ hex, openedSeq: openedSeqOf(log, hex, seq), attacker: env.state.attacker, units, phase: 'open' });
    }
  }, [session, hex, seq, env, log]);
  useEffect(() => {
    if (session?.phase === 'linger') {
      const t = setTimeout(() => setSession((s) => (s === session ? { ...s, phase: 'out' } : s)), animate ? linger : 0);
      return () => clearTimeout(t);
    }
    if (session?.phase === 'out') {
      const t = setTimeout(() => setSession((s) => (s === session ? null : s)), animate ? FADE : 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [session, animate, linger]);
  return session;
}

// ------------------------------------------------------------------ view: the hex's Close Combat as far as it has been revealed

type CcSlice = NonNullable<ReturnType<typeof ccStateOf>>;

function buildView(session: CcSession, here: CcSlice, env: QueryEnv, log: LoggedEvent[], decision: Decision | undefined): View {
  const { hex, attacker } = session;
  const defender = otherSide(env.state, attacker);
  const forHex = decision && decision.data?.['hex'] === hex ? decision : undefined;
  const sequential = here.step === 'sequential' || !!forHex?.data?.['sequential'];

  // Units: the snapshot, plus anyone who joined since (a field-promoted leader), as they stand now.
  const roster = {} as Record<SideId, UnitView[]>;
  for (const side of env.state.sides) {
    const known = new Set(session.units[side]?.map((u) => u.id));
    const extra = ccUnits(env, hex, side).filter((p) => !known.has(p.id)).map((p) => ({ id: p.id, side, defId: p.defId, label: shortLabel(env, p) }));
    roster[side] = [...(session.units[side] ?? []), ...extra].map((u) => {
      const p = env.state.pieces[u.id];
      const dead = !p || p.loc.kind !== 'hex' || p.loc.hex !== hex;
      const broken = !!p && isBroken(p);
      const defId = p?.defId ?? u.defId;
      return {
        ...u,
        label: p ? shortLabel(env, p) : u.label,
        img: counterImage(defId, broken),
        dead,
        reduced: !!p && p.defId !== u.defId,
        broken,
        leader: !!p && !!smc(env, p),
        stackedOn: p && !dead ? stackedOn(env, p) : null,
        spent: !!here.attacked?.includes(u.id),
      };
    });
  }

  // The ambush dice, one per side, as revealed; the verdict once the declarations have begun.
  const after = log.filter((e) => e.seq > session.openedSeq);
  const rolls: AmbushView['rolls'] = {};
  for (const e of after) {
    if (e.type !== 'dice.rolled') continue;
    const p = e.payload as { label: string; dice: number[] };
    for (const side of env.state.sides) {
      if (p.label !== `Ambush dr (${side}) in ${hex}`) continue;
      const units = personnelAt(env, hex, side).map((x) => x.id);
      rolls[side] = { dr: p.dice[0] ?? 0, drm: env.query('cc.ambushDrm', { hex, side, units }, 0) };
    }
  }
  const bothRolled = env.state.sides.every((s) => rolls[s]);
  // The verdict is known once the declarations are under way (the state slice keeps `ambusher`).
  const ambush: AmbushView | null = Object.keys(rolls).length ? { rolls, ambusher: bothRolled && here.step !== 'arrange' ? (here.ambusher ?? null) : undefined } : null;

  // Attacks: each CC roll of a side pairs with its i-th attack event; the declared groups not yet rolled follow.
  const cards: Card[] = [];
  const order: SideId[] = here.ambusher ? [here.ambusher, otherSide(env.state, here.ambusher)] : [attacker, defender];
  for (const side of order) {
    const rolled: { dice: number[]; seq: number }[] = [];
    const events: { attack: CcAttack; odds: string; drm: number; dr: number; kill: number; result: string }[] = [];
    const notes = new Map<number, string>();
    for (const e of after) {
      const p = e.payload as Record<string, unknown>;
      if (e.type === 'dice.rolled' && p['label'] === `CC ${side} in ${hex}`) rolled.push({ dice: p['dice'] as number[], seq: e.seq });
      else if (e.type === 'sk1.cc.attack' && p['side'] === side && p['hex'] === hex) events.push(p as unknown as (typeof events)[number]);
      else if (e.type === 'sk1.leaderCreation' && rolled.length > events.length) {
        const leader = p['leader'] as PieceId | null;
        notes.set(rolled.length - 1, leader ? `Field promotion: ${shortLabel(env, env.state.pieces[leader])}` : 'Field promotion fails');
      }
    }
    const declared = here.declared[side] ?? [];
    const overlaps = (a: PieceId[], b: PieceId[]) => a.some((x) => b.includes(x));
    const unresolved = declared.filter((g) => !events.some((ev) => overlaps(ev.attack.attackers, g.attackers)));
    let pendingIdx = 0;
    rolled.forEach((r, i) => {
      const ev = events[i];
      const group = ev?.attack ?? unresolved[pendingIdx++];
      if (!group) return;
      cards.push({
        key: `${side}:${r.seq}`,
        side,
        attackers: group.attackers,
        targets: group.targets,
        preview: null,
        dice: r.dice,
        ...(ev ? { result: { odds: ev.odds, drm: ev.drm, dr: ev.dr, kill: ev.kill, result: ev.result } } : {}),
        ...(notes.has(i) ? { note: notes.get(i)! } : {}),
      });
    });
    for (const g of unresolved.slice(pendingIdx)) {
      cards.push({ key: `${side}:${g.attackers.join('+')}`, side, attackers: g.attackers, targets: g.targets, preview: ccAttackPreview(env, hex, side, g) });
    }
  }

  let step: Step = 'resolving';
  let acting: SideId | undefined;
  if (forHex?.kind === 'ccArrange') {
    step = 'arrange';
    acting = forHex.owner;
  } else if (forHex?.kind === 'ccDeclare') {
    step = 'declare';
    acting = forHex.owner;
  } else if (ambush && ambush.ambusher === undefined) step = 'ambush';
  return { hex, attacker, defender, step, ...(acting ? { acting } : {}), sequential, ambush, roster, cards, order, melee: env.state.hexMarkers[hex]?.['melee'] === true };
}

// ------------------------------------------------------------------ drag: a counter picked up with the pointer and dropped on a zone

interface DragOpts {
  canDrag(id: PieceId): boolean;
  onDrop(id: PieceId, zone: string | null): void;
  onTap(id: PieceId): void;
}

const zoneAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-cc-zone]')?.getAttribute('data-cc-zone') ?? null;

function useCcDrag(opts: DragOpts) {
  const [ghost, setGhost] = useState<{ id: PieceId; x: number; y: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drag = useRef<{ id: PieceId; pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const clear = () => {
    drag.current = null;
    setGhost(null);
    setOver(null);
  };
  const handlers = (id: PieceId) => ({
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (e.button !== 0 || !latest.current.canDrag(id)) return;
      drag.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
        d.moved = true;
      }
      setGhost({ id, x: e.clientX, y: e.clientY });
      setOver(zoneAt(e.clientX, e.clientY));
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const moved = d.moved;
      clear();
      if (moved) latest.current.onDrop(id, zoneAt(e.clientX, e.clientY));
      else latest.current.onTap(id);
    },
    onPointerCancel: clear,
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return { handlers, ghost, over, dragging: ghost?.id };
}

// ------------------------------------------------------------------ the overlay

export function CloseCombat(props: Props) {
  const { env, log, decision, animate, linger = LINGER, onShown, onLinger } = props;
  const session = useCcSession(env, log, animate, linger);
  const shown = !!session;
  useEffect(() => onShown?.(shown), [shown, onShown]);
  const lingering = !!session && session.phase !== 'open';
  useEffect(() => onLinger?.(lingering), [lingering, onLinger]);
  // The hex's slice of the CC state, kept from the last moment it was current: the last roll's
  // result is revealed together with the slice moving on (to the next hex, or cleared), and the
  // overlay still has to show it while it lingers.
  const here = ccStateOf(env);
  const lastHere = useRef<CcSlice | undefined>(undefined);
  if (session && here?.hex === session.hex) lastHere.current = here;
  const slice = lastHere.current;
  const view = useMemo(() => (session && slice ? buildView(session, slice, env, log, decision) : null), [session, slice, env, log, decision]);
  if (!session || !view) return null;
  return <Panel key={session.hex} {...props} session={session} view={view} />;
}

interface PanelProps extends Props {
  session: CcSession;
  view: View;
}

function Panel({ env, resolving, decision, owner, waitingOn, sideName, run, check, plain, animate, session, view }: PanelProps) {
  const { hex, step, acting, sequential, roster, order } = view;
  const mine = !!owner && acting === owner && session.phase === 'open' && !resolving;
  const me = mine ? owner : undefined;
  const them = me ? otherSide(env.state, me) : undefined;
  const closing = session.phase !== 'open';
  const units = useMemo(() => new Map(env.state.sides.flatMap((s) => (roster[s] ?? []).map((u) => [u.id, u] as const))), [env.state.sides, roster]);
  const unitOf = (id: PieceId) => units.get(id);
  const [error, setError] = useState<string | null>(null);

  // --- the declaring player's groups, started afresh for each decision.
  const [draft, setDraft] = useState<{ decisionId: string; groups: CcAttack[]; current: number }>({ decisionId: '', groups: [{ attackers: [], targets: [] }], current: 0 });
  useEffect(() => {
    if (decision && draft.decisionId !== decision.id) setDraft({ decisionId: decision.id, groups: [{ attackers: [], targets: [] }], current: 0 });
  }, [decision, draft.decisionId]);
  const groups = draft.groups;
  const inGroup = (id: PieceId) => groups.findIndex((g) => g.attackers.includes(id) || g.targets.includes(id));
  const setGroups = (gs: CcAttack[], current = draft.current) => {
    // Empty groups go (the dashed card takes new ones); one stays when there is nothing else.
    const kept = gs.filter((g) => g.attackers.length + g.targets.length > 0);
    const list = kept.length ? kept : [{ attackers: [], targets: [] }];
    setDraft({ ...draft, groups: list, current: Math.min(current, list.length - 1) });
    setError(null);
  };
  /** The groups without `id` (a target leaves with the units that defend with it). */
  const without = (id: PieceId): CcAttack[] => {
    const u = unitOf(id);
    const mates = u && u.side === them ? ccDefensiveGroup(env, id) : [id];
    return groups.map((g) => ({ attackers: g.attackers.filter((x) => x !== id), targets: g.targets.filter((x) => !mates.includes(x)) }));
  };
  const addTo = (gs: CcAttack[], i: number, id: PieceId): CcAttack[] => {
    const u = unitOf(id);
    if (!u || u.dead) return gs;
    const out = gs.map((g) => ({ attackers: [...g.attackers], targets: [...g.targets] }));
    const g = out[i];
    if (!g) return gs;
    if (u.side === me) {
      g.attackers.push(id);
      // A leader joining MMC defends with the one he is stacked on, so that one attacks with him (SK1 3.8).
      const on = u.stackedOn;
      if (u.leader && on && g.attackers.some((x) => unitOf(x) && !unitOf(x)!.leader) && !g.attackers.includes(on) && !unitOf(on)?.dead && !unitOf(on)?.spent) {
        for (const o of out) o.attackers = o.attackers.filter((x) => x !== on);
        g.attackers.push(on);
      }
    } else if (u.side === them) {
      for (const t of ccDefensiveGroup(env, id)) {
        for (const o of out) o.targets = o.targets.filter((x) => x !== t);
        g.targets.push(t);
      }
    }
    for (const o of out) {
      o.attackers = [...new Set(o.attackers)].sort();
      o.targets = [...new Set(o.targets)].sort();
    }
    return out;
  };

  const canDrag = (id: PieceId) => {
    if (!mine || closing) return false;
    const u = unitOf(id);
    if (!u || u.dead) return false;
    if (step === 'arrange') return u.side === me && u.leader && !u.spent;
    if (step !== 'declare') return false;
    // A unit that has attacked (sequential CC with a vehicle, SK4 3.8) may not attack again, but may still be attacked.
    if (u.side === me) return !u.broken && !u.spent;
    return u.side === them;
  };
  const drop = (id: PieceId, zone: string | null) => {
    if (!zone) return;
    const u = unitOf(id);
    if (!u) return;
    if (step === 'arrange') {
      const m = /^stack:(.+)$/.exec(zone);
      if (m && m[1] !== id) {
        const err = run({ type: 'stack.leaderOn', leader: id, on: m[1]! });
        setError(err);
        if (!err) playSfx('ui.flip');
      }
      return;
    }
    const base = without(id);
    let m: RegExpExecArray | null;
    if (/^pool:/.test(zone)) setGroups(base);
    else if ((m = /^g:(\d+):([at])$/.exec(zone))) {
      const i = Number(m[1]);
      if ((m[2] === 'a') !== (u.side === me)) return;
      setGroups(addTo(base, i, id), i);
      playSfx('ui.place');
    } else if (zone === 'new' && !sequential) {
      const gs = [...base, { attackers: [], targets: [] }];
      setGroups(addTo(gs, gs.length - 1, id), gs.length - 1);
      playSfx('ui.place');
    }
  };
  const tap = (id: PieceId) => {
    if (step !== 'declare' || !mine) return;
    const i = inGroup(id);
    if (i >= 0) setGroups(without(id), i);
    else {
      setGroups(addTo(groups, draft.current, id));
      playSfx('ui.place');
    }
  };
  const { handlers, ghost, over, dragging } = useCcDrag({ canDrag, onDrop: drop, onTap: tap });

  const attacks = groups.filter((g) => g.attackers.length || g.targets.length);
  const lockErr = mine && step === 'declare' ? plain(check({ type: 'cc.declare', attacks })) : null;
  const lockIn = () => {
    const err = run({ type: 'cc.declare', attacks });
    setError(err);
  };
  const everyone = () => {
    const first = me ? declarationOptions(env, hex, me)[0] : undefined;
    if (first) setGroups([first], 0);
  };

  // --- what each column shows
  const sides = order;
  const unitsOf = (side: SideId) => roster[side] ?? [];
  const free = (u: UnitView) => inGroup(u.id) < 0;
  const unitCls = (u: UnitView) => `cc-unit side-${u.side}${u.dead ? ' dead' : ''}${u.reduced ? ' reduced' : ''}${u.spent && u.side === me ? ' spent' : ''}${canDrag(u.id) ? ' grab' : ''}${dragging === u.id ? ' lifted' : ''}`;
  const unit = (u: UnitView, small = false) => (
    <button key={u.id} type="button" className={`${unitCls(u)}${small ? ' small' : ''}`} data-cc-unit={u.id} title={u.label} {...handlers(u.id)}>
      {u.img ? <img src={u.img} alt={u.label} draggable={false} /> : <i>{u.label}</i>}
      <small>{u.label}</small>
    </button>
  );
  const chips = (ids: PieceId[], small = true) => ids.map((id) => unitOf(id)).filter((u): u is UnitView => !!u).map((u) => unit(u, small));
  /** A side's units not in a group: MMC with the leaders stacked on them, then the rest. */
  const pool = (side: SideId) => {
    const units = unitsOf(side);
    const shown = mine && step === 'declare' && (side === me || side === them) ? units.filter(free) : units;
    const mmcs = shown.filter((u) => !u.leader);
    const riders = (m: UnitView) => shown.filter((u) => u.leader && u.stackedOn === m.id);
    const loose = shown.filter((u) => u.leader && !mmcs.some((m) => m.id === u.stackedOn));
    const arranging = mine && step === 'arrange' && side === me;
    const zone = `pool:${side}`;
    return (
      <div key={side} className={`cc-pool side-${side}${over === zone ? ' over' : ''}`} data-cc-zone={zone}>
        <div className="cc-col-head">
          <span className="cw">{sideName(side)}</span>
          <span className="ct">{side === view.attacker ? 'Attacker' : 'Defender'}</span>
        </div>
        <div className="cc-stacks">
          {mmcs.map((m) => (
            <div key={m.id} className={`cc-stack${arranging ? ' target' : ''}${over === `stack:${m.id}` ? ' over' : ''}`} {...(arranging ? { 'data-cc-zone': `stack:${m.id}` } : {})}>
              {unit(m)}
              {riders(m).map((l) => unit(l))}
            </div>
          ))}
          {loose.length > 0 && (
            <div className="cc-stack">
              {loose.map((l) => unit(l))}
            </div>
          )}
          {shown.length === 0 && <div className="cc-empty">{units.length ? 'all committed' : 'no units'}</div>}
        </div>
      </div>
    );
  };

  const groupCard = (g: CcAttack, i: number) => {
    const pv = me ? ccAttackPreview(env, hex, me, g) : null;
    const ready = g.attackers.length > 0 && g.targets.length > 0;
    return (
      <div key={i} className={`cc-group mine side-${me}${i === draft.current ? ' current' : ''}`} onClick={() => setDraft({ ...draft, current: i })}>
        <div className={`cc-zone a${over === `g:${i}:a` ? ' over' : ''}`} data-cc-zone={`g:${i}:a`}>
          {chips(g.attackers)}
          {g.attackers.length === 0 && <span className="cc-hint">drag your attackers here</span>}
        </div>
        <Odds pv={pv} ready={ready} plain={plain} />
        <div className={`cc-zone t${over === `g:${i}:t` ? ' over' : ''}`} data-cc-zone={`g:${i}:t`}>
          {chips(g.targets)}
          {g.targets.length === 0 && <span className="cc-hint">drag the enemy to attack here</span>}
        </div>
      </div>
    );
  };

  const resultCard = (c: Card) => {
    const r = c.result;
    const final = r ? r.dr + r.drm : null;
    const tone = r?.result === 'eliminated' ? 'kill' : r?.result === 'casualty reduction' ? 'cr' : r ? 'miss' : '';
    return (
      <div key={c.key} className={`cc-group side-${c.side} ${tone}${r ? ' done' : c.dice ? ' rolling' : ' waiting'}`}>
        <div className="cc-zone a">{chips(c.attackers)}</div>
        <div className="cc-mid">
          {r ? (
            <>
              <div className="cc-odds">{oddsLabel(r.odds)}</div>
              <div className="cc-dice">
                {displayDice(c.dice ?? []).map((d, i) => (
                  <Die key={i} value={d.value} colored={d.colored} />
                ))}
              </div>
              <div className="cc-math">
                DR {r.dr}
                {r.drm ? ` ${signed(r.drm)} = ${final}` : ''} · kill ≤ {r.kill}
              </div>
              <div className="cc-result">{RESULT_TEXT[r.result] ?? r.result}</div>
              {c.note && <div className="cc-note">{c.note}</div>}
            </>
          ) : c.dice ? (
            <>
              <div className="cc-dice">
                {displayDice(c.dice).map((d, i) => (
                  <Die key={i} value={d.value} colored={d.colored} />
                ))}
              </div>
              {c.note && <div className="cc-note">{c.note}</div>}
              <div className="cc-math">…</div>
            </>
          ) : (
            <Odds pv={c.preview} ready plain={plain} />
          )}
        </div>
        <div className="cc-zone t">{chips(c.targets)}</div>
      </div>
    );
  };

  const title =
    step === 'arrange'
      ? `${sideName(acting)} arranges leaders`
      : step === 'ambush'
      ? 'Ambush?'
      : step === 'declare'
      ? `${sideName(acting)} declares${sequential ? ' an attack' : ' attacks'}`
      : closing
      ? view.melee
        ? 'Melee'
        : 'Close Combat resolved'
      : 'Rolling the dice';
  const waiting = !mine && acting && !closing && !resolving ? (waitingOn ? `Waiting for ${sideName(waitingOn)}` : `${sideName(acting)} to decide`) : null;
  const ambushLine = (side: SideId) => {
    const r = view.ambush?.rolls[side];
    if (!r) return null;
    return (
      <div key={side} className={`cc-ambush-side side-${side}`}>
        <span className="cw">{sideName(side)}</span>
        <Die value={r.dr} />
        <span className="ct">
          dr {r.dr}
          {r.drm ? ` ${signed(r.drm)} = ${r.dr + r.drm}` : ''}
        </span>
      </div>
    );
  };

  return (
    <div className={`cc-overlay${session.phase === 'out' ? ' out' : ''}${animate ? '' : ' still'}`} role="dialog" aria-label="Close Combat">
      <div className={`cc-panel side-${acting ?? view.attacker}`}>
        <div className="cc-head">
          <span className="kicker">Close Combat · {hexLabel(hex)}</span>
          <span className="cc-title">{title}</span>
          {waiting && <span className="cc-wait">{waiting}…</span>}
        </div>

        {view.ambush && (
          <div className={`cc-ambush${view.ambush.ambusher ? ` sprung side-${view.ambush.ambusher}` : ''}`}>
            {sides.map(ambushLine)}
            <span className="cc-verdict">{view.ambush.ambusher === undefined ? '' : view.ambush.ambusher ? `Ambush · ${sideName(view.ambush.ambusher)}` : 'No ambush'}</span>
          </div>
        )}

        <div className="cc-body">
          {pool(sides[0]!)}
          <div className="cc-arena">
            {view.cards.length > 0 && (
              <div className="cc-cards">
                {view.cards.map(resultCard)}
              </div>
            )}
            {mine && step === 'declare' && (
              <div className="cc-draft">
                {groups.map(groupCard)}
                {!sequential && (
                  <div className={`cc-group new${over === 'new' ? ' over' : ''}`} data-cc-zone="new">
                    <span className="cc-hint">+ drop a unit here for another attack</span>
                  </div>
                )}
              </div>
            )}
            {mine && step === 'arrange' && <p className="cc-hint">Drag a leader onto one of your squads: he attacks and defends with the unit he is stacked on (SK1 3.8).</p>}
            {step === 'ambush' && <p className="cc-hint">Each side rolls one die; three less than the other ambushes.</p>}
          </div>
          {pool(sides[1]!)}
        </div>

        <div className="cc-foot">
          {error && <span className="cc-error">{error}</span>}
          {!error && lockErr && attacks.length > 0 && <span className="cc-error">{lockErr}</span>}
          {mine && step === 'arrange' && (
            <button className="primary" onClick={() => setError(run({ type: 'cc.arranged' }))}>
              Leaders arranged
            </button>
          )}
          {mine && step === 'declare' && (
            <>
              {!sequential && (
                <button className="ghost" onClick={everyone}>
                  Everyone in
                </button>
              )}
              <button className={attacks.length ? 'primary' : 'ghost'} disabled={!!lockErr} onClick={lockIn}>
                {attacks.length ? (sequential ? 'Attack' : 'Lock in attacks') : sequential ? 'Pass' : 'No attack'}
              </button>
            </>
          )}
        </div>
      </div>
      {ghost && unitOf(ghost.id) && (
        <img className="cc-ghost" src={unitOf(ghost.id)!.img ?? undefined} alt="" style={{ left: ghost.x, top: ghost.y }} />
      )}
    </div>
  );
}

/** The odds of a prospective attack: "7 vs 4", the column, the DRM and why it could not be declared. */
function Odds({ pv, ready, plain }: { pv: CcAttackPreview | null; ready: boolean; plain(m: string | null): string | null }) {
  if (!pv || !ready) return <div className="cc-mid idle">vs</div>;
  const notes = pv.drmNotes.map((n) => n.label).filter(Boolean).join(', ');
  return (
    <div className="cc-mid">
      <div className="cc-fp">
        {pv.attackFp} vs {pv.defenseFp}
      </div>
      <div className="cc-odds">{oddsLabel(pv.odds)}</div>
      {pv.odds && (
        <div className="cc-math">
          DRM {signed(pv.drm)}
          {notes ? ` (${notes})` : ''}
        </div>
      )}
      {pv.illegal && <div className="cc-illegal">{plain(pv.illegal)}</div>}
    </div>
  );
}
