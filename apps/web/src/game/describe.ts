import type { GameState, LoggedEvent, QueryEnv, SideId } from '@asl/engine';
import { SKY_NAME, chartLabel, defOf, entryAfterFireParams, entryGroupsParams, secretLengthParams, fortifiedParams, hexOf, scatterParams, isVisibleTo, isWeaponDef, statics, weatherLabel, type CounterDef, type IftResult, type VariableReinforcementsEvent, type EntryOrderDrEvent, type EntryLossesEvent, entryOrderDrParams, entryOrderLabel, type ForceChartEvent, type ScatterState, type ScatterLanding, type EntryGroupsState, type Weather, NATION, PHASE_NAME, defLabel, hexLabel, humanize, nameIds, nationName, pieceLabel, sideNameOf, entryStretchParams, type LeaderReliefEvent, type OnceDrEvent, type OnceDrNmcEvent, type OnceDrRallyEvent, type LeaderPtcEvent, type RoutStep } from '@asl/rules';

// The naming helpers live in @asl/rules (labels.ts) so the server can name units too; re-exported for the many callers here.
export { NATION, PHASE_NAME, defLabel, hexLabel, humanize, nameIds, nationName, pieceLabel, sideNameOf };

/** Ammunition names for the log (SK4 6.2). */
const AMMO_LABEL: Record<string, string> = { HE: 'HE', AP: 'AP', HEAT: 'HEAT', APCR: 'APCR', APDS: 'APDS', SMOKE: 'Smoke', WP: 'WP' };

const resultText = (r: IftResult) =>
  r.kind === 'none' ? 'no effect' : r.kind === 'KIA' ? `${r.n}KIA` : r.kind === 'K' ? `K/${r.n}` : r.kind === 'MC' ? `${r.n}MC` : r.kind;

/** Why a SW did not keep its Rate of Fire (SK1 1.2.4, 3.2). */
const ROF_LOSS: Record<string, string> = {
  exceeded: 'colored dr above the ROF',
  cowered: 'the attack cowered (original doubles, no leader directing), so every firer is marked',
  pinned: 'a pinned unit\'s SW cannot retain ROF',
  fpf: 'Final Protective Fire never retains ROF',
};

export interface LogLine {
  seq: number;
  kind: 'phase' | 'fire' | 'check' | 'move' | 'info' | 'cc' | 'end';
  text: string;
  detail?: string;
  /** A shot's LOS, firing hexes to target, so the player can have it drawn on the map again. */
  /** `at`: the corner each firing hex traced to, firing at a stack in Bypass (full ASL, ASLRB A4.34). */
  los?: { from: string[]; to: string; at?: Record<string, [string, string]> };
  /** Set by `phaseSections` on the line that opens an entry (a shot, a check, a move), not its results. */
  opens?: boolean;
  /** On a `phase` line: the Player Turn and phase it opens, for the log's section headings. */
  phase?: { turn: number; side: string; name: string };
}

/** One phase of the log: its heading (none for what came before the first phase) and its lines. */
export interface LogSection {
  head?: LogLine;
  lines: LogLine[];
}

/**
 * The log one section per phase, oldest first like the dice log, so each phase can be shown under its own heading.
 * An entry is a line and the indented lines after it (a shot, then its results and the checks it caused, which
 * `describeEvents` indents); its first line is marked `opens`.
 */
export function phaseSections(lines: LogLine[]): LogSection[] {
  const sections: { head?: LogLine; entries: LogLine[][] }[] = [{ entries: [] }];
  for (const l of lines) {
    const sec = sections[sections.length - 1]!;
    if (l.kind === 'phase') sections.push({ head: l, entries: [] });
    else if (l.text.startsWith(' ') && sec.entries.length) sec.entries[sec.entries.length - 1]!.push(l);
    else sec.entries.push([{ ...l, opens: true }]);
  }
  return sections
    .filter((sec) => sec.head || sec.entries.length)
    .map((sec) => ({ ...(sec.head ? { head: sec.head } : {}), lines: sec.entries.flat() }));
}

/**
 * A provisional reinforcement's entry dr ("enter on a dr < the current Turn number", or a chart of circled numbers):
 * the force, what it needed and whether it enters this Player Turn. The rules record only the roll, labelled
 * "<force>: entry dr (needs < 3)" or "(needs ≤ 2)".
 */
export function entryRoll(label: string, dr: number): { force: string; need: string; enters: boolean } | null {
  const m = /^(.*): entry dr \(needs (<|≤) (\d+)\)$/.exec(label);
  if (!m) return null;
  const n = Number(m[3]);
  return { force: m[1]!, need: `${m[2]} ${n}`, enters: m[2] === '<' ? dr < n : dr <= n };
}

/** What the log calls each kind of fire attack. */
const FIRE_MODE_NAME: Record<string, string> = {
  prep: 'Prep Fire',
  first: 'Defensive First Fire',
  subsequentFirst: 'Subsequent First Fire',
  fpf: 'FPF',
  final: 'Final Fire',
  advancing: 'Advancing Fire',
  bounding: 'Bounding Fire',
};

/** The labels of a list of explain notes (`{ id, label? }`) as the events carry them. */
/**
 * A DR written out colored die first, as ASL reads it: "5+3=8" for white 3, colored 5. The log
 * draws every "c+w=t" as the two dice, so each two-dice roll is written this way.
 */
const drText = (dr: readonly number[]) => `${dr[1]}+${dr[0]}=${dr[0]! + dr[1]!}`;
const noteLabels = (xs: unknown) => ((xs as { label?: string }[] | undefined) ?? []).map((x) => x.label).filter((l): l is string => !!l);

/**
 * Turn engine events into human-readable log lines. `viewer` (a side, or null for a spectator)
 * never reads of a piece still hidden from them (SK2 HIP): such lines are left out.
 */
export function describeEvents(env: QueryEnv, events: LoggedEvent[], viewer: SideId | null = null): LogLine[] {
  const out: LogLine[] = [];
  const hiddenFrom = (id: string) => {
    const pc = env.state.pieces[id];
    return !!pc && !isVisibleTo(env, pc, viewer);
  };
  // Units are named as they stood at each event. The state in hand is the one after the whole
  // batch, so the counter replacements in it (ELR, Casualty Reduction) are replayed backwards:
  // a line before a replacement names the old counter, a line after it the new one.
  const defAfter: Map<string, string>[] = new Array<Map<string, string>>(events.length);
  let cur = new Map<string, string>();
  for (let i = events.length - 1; i >= 0; i--) {
    defAfter[i] = cur;
    const e = events[i]!;
    if (e.type === 'piece.replaced') {
      const p = e.payload as { id: string; from?: string };
      if (p.from) cur = new Map(cur).set(p.id, p.from);
    }
  }
  const counters = (env.statics as { counters: Record<string, CounterDef> }).counters;
  const asDef = (id: string, defId: string | undefined) => {
    const pc = env.state.pieces[id];
    return pieceLabel(env, pc && defId ? { ...pc, defId } : pc);
  };
  let at = 0;
  const name = (id: string) => asDef(id, defAfter[at]?.get(id));
  // Where a piece stands now (a held Gun or SW: where its holder stands), for recordings made before
  // the fire events named the hex fired from.
  const hexOfNow = (id: string): string | undefined => {
    const pc = env.state.pieces[id];
    return pc ? (hexOf(env.state, pc) ?? undefined) : undefined;
  };
  // The LOS of a shot from one hex, for the map, when it was fired from somewhere else than the target.
  const losOf = (from: string | undefined, to: string): Pick<LogLine, 'los'> => (from && from !== to ? { los: { from: [from], to } } : {});
  // A DR an event records only as its total (a MC, a CC attack, the weather): the dice come from the
  // roll that made it, the nearest earlier two-dice roll with that total, preferring one whose label
  // names `mention` (the unit that checked). An Original DR reused (FPF, depletion) finds the roll it
  // came from the same way. No such roll in sight: the total alone.
  const dr2 = (total: unknown, mention?: string): string => {
    let any: number[] | undefined;
    for (let j = at - 1; j >= Math.max(0, at - 80); j--) {
      const f = events[j]!;
      if (f.type !== 'dice.rolled') continue;
      const q = f.payload as { label: string; dice: number[] };
      if (q.dice.length !== 2 || q.dice[0]! + q.dice[1]! !== total) continue;
      if (!mention || q.label.includes(mention)) return drText(q.dice);
      any ??= q.dice;
    }
    return any ? drText(any) : String(total);
  };
  /** The rout step a unit's move at event `i` was, from the rout state event that closes it (a few events on at most). */
  const routStepAfter = (i: number, id: string): RoutStep | null => {
    for (let j = i + 1; j < Math.min(events.length, i + 40); j++) {
      const f = events[j]!;
      if (f.type === 'sk1.rout.state') {
        const step = (f.payload as { step?: RoutStep }).step;
        return step?.unit === id ? step : null;
      }
      if (f.type === 'piece.moved' && (f.payload as { id: string }).id === id) return null;
    }
    return null;
  };
  for (const [i, e] of events.entries()) {
    at = i;
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case 'turn.phaseStarted':
        out.push({
          seq: e.seq,
          kind: 'phase',
          text: `Turn ${p['turn']} — ${sideNameOf(env, p['attacker'] as string)} ${PHASE_NAME[p['phase'] as string] ?? p['phase']}`,
          phase: { turn: p['turn'] as number, side: p['attacker'] as string, name: PHASE_NAME[p['phase'] as string] ?? String(p['phase']) },
        });
        break;
      case 'sk1.fire.attack': {
        const dr = p['dr'] as [number, number];
        // How the FP came about (½ Advancing Fire, +1 Assault Fire ...) and every DRM on the attack.
        const fp = noteLabels(p['fpExplain']).join(', ');
        const drm = noteLabels(p['explain']).join(', ');
        const detail = [fp ? `FP: ${fp}` : '', drm ? `DRM: ${drm}` : ''].filter(Boolean).join(' · ');
        const a = p['attack'] as { target: string; parts: string[]; mode?: string; at?: Record<string, [string, string]> };
        // The hexes fired from: on the event since 2026-10-26, else where the firers (or whoever holds
        // them, for a Gun or SW) stand now.
        const from = (p['from'] as string[] | undefined) ?? [...new Set(a.parts.map(hexOfNow).filter((h): h is string => !!h))];
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${a.parts.length ? (FIRE_MODE_NAME[a.mode ?? ''] ?? 'Fire') : 'Residual FP'} on ${hexLabel(a.target)}: ${p['fp']} FP → ${p['column'] ?? '—'} column, DR ${drText(dr)} ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']}${p['cowered'] ? ' (cowers)' : ''}`,
          ...(detail ? { detail } : {}),
          ...(from.length && from.some((h) => h !== a.target) ? { los: { from: from.filter((h) => h !== a.target), to: a.target, ...(a.at ? { at: a.at } : {}) } } : {}),
        });
        break;
      }
      case 'sk1.fire.noLos': {
        const a = p['attack'] as { target: string; parts: string[]; mode?: string; at?: Record<string, [string, string]> };
        const from = (p['from'] as string[]).map(hexLabel).join(', ');
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${FIRE_MODE_NAME[a.mode ?? ''] ?? 'Fire'} on ${hexLabel(a.target)} from ${from}: no LOS (${(p['blockedBy'] as string[]).join('; ')}) — ${a.parts.map(name).join(', ')} fired for nothing${p['dr'] ? ` (DR ${drText(p['dr'] as number[])} for breakdown and ROF${p['cowered'] ? ', cowers' : ''})` : ''}`,
          los: { from: p['from'] as string[], to: a.target, ...(a.at ? { at: a.at } : {}) },
        });
        break;
      }
      case 'sk1.fire.result': {
        if (hiddenFrom(p['unit'] as string)) break;
        // A unit's own modifier to the attack's DR (-1 vs a FT possessor) is why its final DR differs.
        const own = noteLabels(p['explain']).join(', ');
        if (p['critical']) {
          out.push({ seq: e.seq, kind: 'fire', text: `  ${name(p['unit'] as string)}: eliminated with its Gun (Critical Hit)` });
          break;
        }
        // A PTC rolls nothing for a unit already pinned or broken (SK1 3.2.2: it affects unbroken, unpinned units), so no
        // check line follows; say so, or the pins of an earlier attack read as this PTC's.
        const noCheck =
          (p['result'] as IftResult).kind === 'PTC' &&
          !events.slice(at + 1).some((x, k, rest) => x.type === 'sk1.check' && (x.payload as { unit: string }).unit === p['unit'] && !rest.slice(0, k).some((y) => y.type === 'sk1.fire.attack'));
        out.push({ seq: e.seq, kind: 'fire', text: `  ${name(p['unit'] as string)}: ${resultText(p['result'] as IftResult)} (final DR ${p['finalDr']}${own ? `: ${own}` : ''})${noCheck ? ' — no effect: already pinned or broken (a PTC affects only unbroken, unpinned units)' : ''}` });
        break;
      }
      case 'sk1.fire.dm': {
        const units = (p['units'] as string[]).filter((u) => !hiddenFrom(u));
        if (units.length) out.push({ seq: e.seq, kind: 'fire', text: `  ${units.map(name).join(', ')}: placed under DM (the attack could inflict a NMC)` });
        break;
      }
      case 'sk1.fire.rof': {
        const colored = p['colored'] as number;
        for (const k of p['kept'] as { sw: string; rof: number }[]) {
          out.push({ seq: e.seq, kind: 'fire', text: `  ${name(k.sw)} keeps ROF (colored dr ${colored} ≤ ${k.rof}): it may fire again this phase` });
        }
        for (const l of p['lost'] as { sw: string; rof: number; why: string }[]) {
          out.push({ seq: e.seq, kind: 'fire', text: `  ${name(l.sw)} loses ROF: ${ROF_LOSS[l.why] ?? l.why}` });
        }
        break;
      }
      case 'sk1.fire.rofDeclined':
        out.push({ seq: e.seq, kind: 'fire', text: `  ${name(p['sw'] as string)} gives up its ROF: ${p['residual']} Residual FP left in ${hexLabel(p['hex'] as string)}` });
        break;
      case 'sk1.check':
        if (hiddenFrom(p['unit'] as string)) break;
        out.push({
          seq: e.seq,
          kind: 'check',
          // An FPF NMC rolls nothing: it is the attack's Original DR, on the units that fired (SK1 3.3.1).
          text: `  ${p['reason'] === 'FPF' ? 'FPF NMC on firer' : p['kind']} ${name(p['unit'] as string)}: ${p['reason'] === 'FPF' ? 'Original DR' : 'DR'} ${dr2(p['dr'], p['unit'] as string)} → ${p['final']} vs ${p['target']} — ${p['outcome'] === 'stepReduced' ? 'Step Reduced' : p['outcome']}`,
          detail: [p['reason'] as string, ...((p['explain'] as { label?: string }[] | undefined) ?? []).map((n) => n.label).filter(Boolean)].join(', '),
        });
        break;
      case 'piece.moved': {
        // Support weapons changing hands or being dropped (units moving is covered by the move log).
        const pc = env.state.pieces[p['id'] as string];
        const loc = p['loc'] as { kind: string; by?: string; hex?: string };
        // A hex of a rout: its state event, after any Interdiction it drew, tells whether it was a Low Crawl and why
        // it was or was not open to Interdiction (SK1 3.6).
        const step = pc && !isWeaponDef(defOf(env, pc)) ? routStepAfter(i, pc.id) : null;
        if (step && !hiddenFrom(step.unit)) {
          const where = hexLabel(step.to);
          const why =
            step.interdiction === 'checked'
              ? `Interdiction${step.by!.some(hiddenFrom) ? '' : ` by ${step.by!.map(name).join(', ')}`}`
              : step.interdiction === 'lowCrawl'
                ? 'no Interdiction (Low Crawl)'
                : step.interdiction === 'notOpen'
                  ? 'no Interdiction (not Open Ground)'
                  : 'no Interdiction (no enemy able to interdict)';
          out.push({ seq: e.seq, kind: 'info', text: `${step.lowCrawl ? 'Low Crawl' : 'Rout'}: ${name(step.unit)} to ${where} · ${why}` });
          break;
        }
        if (pc && isWeaponDef(defOf(env, pc))) {
          const gun = defOf(env, pc).kind === 'gun';
          if (loc.kind === 'held' && loc.by) out.push({ seq: e.seq, kind: 'info', text: `  ⇄ ${name(pc.id)} now ${gun ? 'manned' : 'carried'} by ${name(loc.by)}` });
          else if (loc.kind === 'hex' && loc.hex) out.push({ seq: e.seq, kind: 'info', text: `  ⤓ ${name(pc.id)} left in ${loc.hex.replace(/^[a-z]/, '')}` });
        }
        break;
      }
      case 'piece.eliminated': {
        const pc = env.state.pieces[p['id'] as string];
        out.push({ seq: e.seq, kind: 'info', text: `  ✖ ${pc ? pieceLabel(env, pc) : p['id']} eliminated (${p['reason']})` });
        break;
      }
      case 'piece.tagged': {
        // A weapon breaking down (SK1 1.2.4, SK4 7.8): the counter flips, or for a vehicular MG the
        // vehicle wears the marker, so the log says so. Guns have their own line (sk2.gun.malf).
        const tags = p['tags'] as Record<string, unknown>;
        if (tags['malf'] !== true) break;
        const pc = env.state.pieces[p['id'] as string];
        const d = pc && defOf(env, pc);
        if (!pc || !d || d.kind !== 'sw') break;
        const holder = pc.loc.kind === 'held' ? env.state.pieces[pc.loc.by] : undefined;
        const who = d.fixed && holder ? `${pieceLabel(env, holder)}'s ${d.type}` : name(pc.id);
        out.push({ seq: e.seq, kind: 'info', text: `  ✖ ${who} malfunctions` });
        break;
      }
      case 'sk3.vehicle.repair': {
        const v = env.state.pieces[p['vehicle'] as string];
        const w = p['weapon'] as string;
        const wp = w !== 'ma' ? env.state.pieces[w] : undefined;
        const wd = wp ? defOf(env, wp) : undefined;
        const what = w === 'ma' ? 'MA' : wd && wd.kind === 'sw' ? wd.type : 'MG';
        const RESULT: Record<string, string> = { repaired: 'is repaired', disabled: `is disabled for good${w === 'ma' ? ' (Recalled)' : ''}`, none: 'stays malfunctioned' };
        out.push({ seq: e.seq, kind: 'info', text: `  ${p['result'] === 'repaired' ? '✔' : '✖'} ${v ? pieceLabel(env, v) : p['vehicle']}'s ${what} ${RESULT[p['result'] as string] ?? p['result']} (repair dr ${p['dr']})` });
        break;
      }
      case 'piece.replaced': {
        // An ELR replacement (and a Japanese Step Reduction) has its own line below, with the reason; losses before entry (SSR) are summed up above.
        if (p['reason'] === 'elr' || p['reason'] === 'ssr' || p['reason'] === 'deploy' || p['reason'] === 'step') break;
        const to = counters[p['defId'] as string];
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `  ${p['reason'] === 'recombine' ? '↑' : '↓'} ${p['reason'] === 'cr' ? 'Casualty Reduction: ' : p['reason'] === 'commissar' ? 'Failed to rally under the Commissar: ' : p['reason'] === 'rally' ? 'Failed to rally under a Japanese leader (SK4 8.1.7): ' : ''}${asDef(p['id'] as string, p['from'] as string | undefined)} becomes ${to ? defLabel(to) : p['defId']}`,
        });
        break;
      }
      case 'ssr.setup-deploy': {
        // A squad split into two half-squads at setup (SSR).
        const from = counters[p['from'] as string];
        const to = counters[p['to'] as string];
        out.push({ seq: e.seq, kind: 'info', text: `  ⇉ ${p['rule'] ? `${p['rule']}: ` : ''}${from ? defLabel(from) : p['from']} deployed as two ${to ? defLabel(to) : p['to']}` });
        break;
      }
      case 'sk1.elr': {
        const to = counters[p['to'] as string];
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `  ↓ ELR: ${asDef(p['unit'] as string, p['from'] as string)} becomes ${to ? defLabel(to) : p['to']} (failed by ${p['failedBy']}, ELR ${p['elr']})`,
        });
        break;
      }
      case 'sk1.leaderCreation': {
        const leader = p['leader'] as string | null;
        const made = leader && env.state.pieces[leader] ? pieceLabel(env, env.state.pieces[leader]) : null;
        out.push({ seq: e.seq, kind: 'info', text: `  ★ Leader Creation for ${name(p['unit'] as string)}: dr ${p['dr']} — ${made ? `${made} created` : 'no leader'}` });
        break;
      }
      case 'sk1.fortified': {
        // The buildings themselves stay out of the log: the designation is secret (SSR), unless the card makes it open.
        const st = p['state'] as { side: string; buildings: string[] };
        if (st.buildings.length && fortifiedParams(env)?.open) {
          const named = st.buildings.map((b) => [...statics(env).map.hexes()].filter((h) => h.buildingId === b).map((h) => hexLabel(h.id)).join('/')).join(', ');
          out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, st.side)} fortified building ${named} (SSR)` });
        } else if (st.buildings.length) out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, st.side)} secretly designated ${st.buildings.length} fortified building${st.buildings.length === 1 ? '' : 's'} (SSR)` });
        break;
      }
      case 'ssr.variableReinforcements': {
        // The reinforcement dr: what it was for, what it rolled and what it brought.
        const v = p as unknown as VariableReinforcementsEvent;
        const d = counters[v.def];
        const what = d ? defLabel(d) : v.def;
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${v.rule}: ${sideNameOf(env, v.side)} reinforcement dr ${v.dr} → ${v.count}× ${what} enter this turn`,
          detail: `Chart for Turn ${v.turn}: ${chartLabel(v.table)}`,
        });
        break;
      }
      case 'ssr.entryOrderDr': {
        // The order-of-entry dr (SSR): the turn it gives each group.
        const v = p as unknown as EntryOrderDrEvent;
        const forces = statics(env).scenario.forces;
        const turns = Object.entries(v.turns)
          .map(([f, t]) => `${forces.find((x) => x.id === f)?.group ?? f} enters on Turn ${t}`)
          .join('; ');
        const params = entryOrderDrParams(env);
        out.push({ seq: e.seq, kind: 'info', text: `${v.rule}: ${sideNameOf(env, v.side)} order of entry dr ${v.dr} → ${turns}`, ...(params ? { detail: entryOrderLabel(env, params) } : {}) });
        break;
      }
      case 'ssr.entryLosses': {
        // Losses before entry (SSR): the dr and the counters it replaced.
        const v = p as unknown as EntryLossesEvent;
        const group = statics(env).scenario.forces.find((x) => x.id === v.force)?.group ?? v.force;
        const from = counters[v.from] ? defLabel(counters[v.from]!) : v.from;
        const to = counters[v.to] ? defLabel(counters[v.to]!) : v.to;
        out.push({ seq: e.seq, kind: 'info', text: `${v.rule}: ${group} losses dr ${v.dr} → ${v.count}× ${from} become${v.count === 1 ? 's' : ''} ${to}` });
        break;
      }
      case 'ssr.forceChart': {
        // The order-of-battle roll: what it was, what it brought, and the VP it sets.
        const v = p as unknown as ForceChartEvent;
        const got = Object.entries(v.counts)
          .map(([def, n]) => `${n}× ${counters[def] ? defLabel(counters[def]!) : def}`)
          .join(', ');
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${v.rule}: ${sideNameOf(env, v.side)} ${v.chart} dr ${v.dr} → ${got}${v.vp !== null ? `; ${v.vp} VP to win` : ''}`,
        });
        break;
      }
      case 'ssr.scatter': {
        // The plan (SSR 1): the first group's rendezvous hex is open, the later groups' secret until they land.
        const st = p['state'] as ScatterState;
        const sp = scatterParams(env);
        if (st.rolled.length || !sp) break;
        const open = sp.groups.map((g, gi) => (g.later ? `${g.label} secretly` : `${g.label} at ${hexLabel(st.rendezvous[gi]!)}`)).join('; ');
        const stacks = st.groups.map((g, gi) => `${sp.groups[gi]!.label} ${g.length} stack${g.length === 1 ? '' : 's'}`).join(', ');
        out.push({ seq: e.seq, kind: 'info', text: `${sp.rule ?? 'SSR'}: ${sideNameOf(env, st.side)} rendezvous hexes picked: ${open} (${stacks})` });
        break;
      }
      case 'ssr.scatter.landed': {
        const l = p as unknown as ScatterLanding;
        const DIR = ['north', 'northeast', 'southeast', 'south', 'southwest', 'northwest'];
        const who = l.stack.map((id) => name(id)).join(', ');
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${l.rule}: ${l.label} stack (${who}) — colored ${l.dice[1]} (${DIR[l.direction - 1]}), white ${l.dice[0]} → ${hexLabel(l.to)}${l.offMap ? ' (off the map: on the nearest edge hex, pinned and CX)' : ''}`,
        });
        break;
      }
      case 'ssr.length.recorded': {
        // Secret (S36 SSR 1): the choosing side reads its own choice; everyone else only that it was made.
        const lp = secretLengthParams(env);
        const opt = lp?.options[p['option'] as number];
        out.push({ seq: e.seq, kind: 'info', text: viewer === p['side'] && opt ? `${lp?.rule ?? 'SSR'}: ${sideNameOf(env, p['side'] as string)} game length (secret): ${opt.label} turns` : `${lp?.rule ?? 'SSR'}: ${sideNameOf(env, p['side'] as string)} secretly recorded the game length` });
        break;
      }
      case 'ssr.entryStretch': {
        const sp = entryStretchParams(env);
        const opt = sp?.options[p['option'] as number];
        // A force the card gives no name (S68's "Enter on Turn 3 ...") is the side's reinforcements.
        const forces = statics(env).scenario.forces.filter((f) => !!f.id && !!sp?.forces.includes(f.id)).map((f) => f.group ?? 'the reinforcements');
        const span = (opt?.hexes.length ?? 0) > 1 ? ` (${hexLabel(opt!.hexes[0]!)}–${hexLabel(opt!.hexes[opt!.hexes.length - 1]!)})` : '';
        out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, p['side'] as string)} entry ${span ? 'stretch' : 'hex'}: ${forces.join(', ')} enter ${p['label']}${span}` });
        break;
      }
      case 'ssr.length.revealed': {
        const lp = secretLengthParams(env);
        const opt = lp?.options[p['option'] as number];
        const removed = (p['removed'] as string[]).map((id) => name(id));
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${lp?.rule ?? 'SSR'}: the game is ${opt?.label ?? '?'} turns long — boards in play: ${opt?.boards ?? '?'}${removed.length ? ` · removed from the ${sideNameOf(env, p['side'] as string)} OB: ${removed.join(', ')}` : ''}`,
        });
        break;
      }
      case 'ssr.reinforcementTable': {
        const units = (p['units'] as { def: string; count: number }[]).map((u) => `${u.count > 1 ? `${u.count} × ` : ''}${statics(env).counters[u.def] ? defLabel(statics(env).counters[u.def]!) : u.def}`);
        out.push({ seq: e.seq, kind: 'info', text: `${p['rule']}: ${sideNameOf(env, p['side'] as string)} Reinforcement Table dr ${p['dr']} → ${units.join(', ') || 'nothing'}` });
        break;
      }
      case 'ssr.entryGroups': {
        // Secret (SSR 2): the choosing side reads its own picks online; everyone else only that they were made.
        const st = p['state'] as EntryGroupsState;
        const ep = entryGroupsParams(env);
        if (viewer === st.side) {
          const forces = statics(env).scenario.forces;
          const picks = st.picks.map((x) => `${forces.find((f) => f.id === x.force)?.group?.replace(/^.*: /, '') ?? x.force} on Turn ${x.turn} at ${hexLabel(x.hex)}`).join('; ');
          out.push({ seq: e.seq, kind: 'info', text: `${ep?.rule ?? 'SSR'}: ${sideNameOf(env, st.side)} entry groups (secret): ${picks}` });
        } else out.push({ seq: e.seq, kind: 'info', text: `${ep?.rule ?? 'SSR'}: ${sideNameOf(env, st.side)} secretly picked their entry groups, turns and hexes` });
        break;
      }
      case 'ssr.leaderPtc': {
        const v = p as unknown as LeaderPtcEvent;
        out.push({ seq: e.seq, kind: 'check', text: `${v.rule}: 1PTC ${name(v.unit)}: DR ${drText(v.dr)} ${v.drm >= 0 ? '+' : ''}${v.drm} → ${v.final} vs ${v.morale} — ${v.pinned ? 'pinned for this Player Turn' : 'passed'}` });
        break;
      }
      case 'ssr.sw.assembled':
        out.push({ seq: e.seq, kind: 'info', text: `${p['rule']}: ${name(p['by'] as string)} assembles the ${name(p['sw'] as string)}` });
        break;
      case 'ssr.onceDr': {
        // A card's once-per-game dr (S64 SSR 2, 3).
        const v = p as unknown as OnceDrEvent;
        const what = v.effect === 'nmcConcealment' ? 'each Good Order MMC not stacked with a Good Order leader takes a NMC' : 'the leader’s stack is halted this Game Turn';
        out.push({ seq: e.seq, kind: 'info', text: `${v.rule}: dr ${v.dr} (needs < ${v.turn}) — ${v.success ? what : 'no effect; the dr is spent'}` });
        break;
      }
      case 'ssr.onceDr.nmc': {
        const v = p as unknown as OnceDrNmcEvent;
        if (hiddenFrom(v.unit)) break;
        out.push({
          seq: e.seq,
          kind: 'check',
          text: `  NMC ${name(v.unit)}: DR ${dr2(v.dr, v.unit)} → ${v.final} vs ${v.morale} — ${v.failed ? (v.concealmentLost ? 'failed: loses its concealment' : 'failed (no effect)') : 'passed'}`,
          detail: v.rule,
        });
        break;
      }
      case 'ssr.onceDr.rallied': {
        const v = p as unknown as OnceDrRallyEvent;
        out.push({ seq: e.seq, kind: 'info', text: `  ${v.rule}: ${v.units.map(name).join(', ')} rall${v.units.length === 1 ? 'ies' : 'y'} automatically beside ${name(v.leader)}` });
        break;
      }
      case 'ssr.leaderRelief': {
        // A named leader relieved of command (LMA5 SSR 4): pinned for good, and who replaces him when.
        const v = p as unknown as LeaderReliefEvent;
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${v.rule}: ${v.name} (${name(v.unit)}) ${v.why === 'check' ? 'failed his Morale Check' : 'failed a MC'} and is relieved: Pinned for the rest of the game; ${v.replacement.name} enters on Turn ${v.replacement.turn}`,
        });
        break;
      }
      case 'ssr.entryAfterFire': {
        // The first fire attack of the named side sets the reinforcements' turn (SSR).
        const r = p as { force: string; side: string; turn: number; firedOn: number; firer: string };
        const ap = entryAfterFireParams(env);
        const force = statics(env).scenario.forces.find((f) => f.id === r.force);
        const edge = force?.setup.kind === 'enter' ? (({ N: 'north', E: 'east', S: 'south', W: 'west' }) as Record<string, string>)[force.setup.edge] ?? force.setup.edge : null;
        const firer = ap ? sideNameOf(env, ap.firedBy) : 'their';
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${ap?.rule ?? 'SSR'}: first ${firer} fire attack (Turn ${r.firedOn}): the ${sideNameOf(env, r.side)} ${force?.group ?? 'reinforcements'} enter on Turn ${r.turn}${edge ? ` along the ${edge} edge` : ''}`,
        });
        break;
      }
      case 'sk1.reserve': {
        const r = p as { side: string; pieces: string[]; turn: number; edges: string[]; label: string | null };
        const edges = r.edges.map((e) => ({ N: 'north', E: 'east', S: 'south', W: 'west' })[e] ?? e).join(' or ');
        out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, r.side)} kept ${r.pieces.length} unit${r.pieces.length === 1 ? '' : 's'} back${r.label ? ` (${r.label})` : ''}: they enter on Turn ${r.turn} along the ${edges} edge` });
        break;
      }
      case 'weather.dr': {
        const sky = SKY_NAME[p['sky'] as keyof typeof SKY_NAME] ?? String(p['sky']);
        const change = p['change'] as 'begins' | 'ends' | null;
        out.push({ seq: e.seq, kind: 'info', text: `Weather DR ${dr2(p['dr'], 'Weather DR')}: ${change === 'begins' ? `${sky} begins` : change === 'ends' ? `${sky} ends` : 'no change'}` });
        break;
      }
      case 'weather.changed': {
        if (p['reason'] === 'start') break;
        out.push({ seq: e.seq, kind: 'info', text: `  ☁ Weather now: ${weatherLabel(p['weather'] as Weather)}` });
        break;
      }
      case 'sk1.fortified.revealed':
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `  ▣ Building ${hexLabel(p['hex'] as string)} is fortified (+1 TEM): revealed by ${p['reason'] === 'fire' ? 'fire on' : 'a unit entering'} ${hexLabel(p['hex'] as string)}`,
        });
        break;
      case 'sk1.cc.attack':
        out.push({ seq: e.seq, kind: 'cc', text: `CC in ${p['hex']} (${sideNameOf(env, p['side'] as string)}): ${p['odds']}, DR ${dr2(p['dr'], `CC ${p['side']} in`)}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''} vs kill ${p['kill']} — ${p['result']}` });
        break;
      case 'dice.rolled': {
        const label = p['label'] as string;
        // Interdiction (SK1 3.6): the rules record only the dice, so the outcome is read from what
        // followed (Casualty Reduction, elimination) or else from the roll against broken morale.
        const intd = /^Interdiction NMC for (.+)$/.exec(label);
        if (intd) {
          const id = intd[1]!;
          const dice = p['dice'] as number[];
          const total = dice.reduce((a, b) => a + b, 0);
          let outcome: string | null = null;
          for (let j = i + 1; j < events.length && !outcome; j++) {
            const f = events[j]!;
            const q = f.payload as Record<string, unknown>;
            if (f.type === 'dice.rolled' || (f.type === 'piece.moved' && q['id'] === id)) break;
            if (f.type === 'piece.eliminated' && q['id'] === id) outcome = 'eliminated';
            else if (f.type === 'sk1.casualtyReduced' && q['unit'] === id) outcome = 'Casualty Reduction';
          }
          const defId = defAfter[i]?.get(id) ?? env.state.pieces[id]?.defId;
          const d = defId ? (counters[defId] as { brokenMorale?: number } | undefined) : undefined;
          const morale = d?.brokenMorale;
          if (!outcome) outcome = total === 12 ? 'eliminated' : morale !== undefined && total === morale ? 'pinned: the rout ends here' : 'passed';
          let where: string | undefined;
          for (let j = i - 1; j >= 0 && !where; j--) {
            const f = events[j]!;
            if (f.type === 'piece.moved' && (f.payload as { id: string }).id === id) where = ((f.payload as { loc: { hex?: string } }).loc.hex ?? undefined);
          }
          out.push({
            seq: e.seq,
            kind: 'info',
            text: `  Interdiction: ${name(id)}${where ? ` entering ${hexLabel(where)}` : ''} — NMC, DR ${drText(dice)}${morale !== undefined ? ` vs broken morale ${morale}` : ''} → ${outcome}`,
          });
          break;
        }
        const entry = entryRoll(label, (p['dice'] as number[])[0]!);
        if (entry) {
          out.push({ seq: e.seq, kind: 'info', text: `${entry.force}: entry dr ${(p['dice'] as number[])[0]} (needs ${entry.need}) → ${entry.enters ? 'enters this turn' : 'does not enter this turn'}` });
          break;
        }
        // Leader Creation has its own line with the outcome.
        if (/Smoke|Recover|Repair|Ambush|wound/i.test(label)) {
          const dice = p['dice'] as number[];
          out.push({ seq: e.seq, kind: 'info', text: `  ${label}: ${dice.length === 2 ? `DR ${drText(dice)}` : `dr ${dice.join(', ')}`}` });
        }
        break;
      }
      case 'game.ended': {
        const r = p['result'] as { winner: string | null; reason: string };
        out.push({ seq: e.seq, kind: 'end', text: `Game over — ${r.winner ? `${sideNameOf(env, r.winner)} win` : 'draw'} (${r.reason})` });
        break;
      }
      // ---------------------------------------------------------------- SK2: Guns and ordnance
      case 'sk2.ordnance.shot': {
        const dr = p['dr'] as [number, number];
        const drm = p['drm'] as number;
        const outcome = p['outcome'] as string;
        const ammo = p['ammo'] as string | undefined;
        const notes = noteLabels(p['explain']).join(', ');
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${p['intensive'] ? 'Intensive Fire: ' : ''}${name(p['weapon'] as string)} at ${hexLabel(p['target'] as string)} (${p['targetType']}${ammo && ammo !== 'HE' ? `, ${AMMO_LABEL[ammo] ?? ammo}` : ''}, range ${p['range']}): TH ${p['th']}${p['red'] ? ' (red)' : ''}, DR ${drText(dr)} ${drm >= 0 ? '+' : ''}${drm} → ${dr[0] + dr[1] + drm}: ${outcome === 'noAmmo' ? `no ${AMMO_LABEL[ammo ?? ''] ?? ammo}` : outcome === 'ch' ? 'CRITICAL HIT' : outcome === 'hit' ? 'HIT' : 'miss'}`,
          ...(notes ? { detail: `TH DRM: ${notes}` } : {}),
          ...losOf((p['from'] as string | undefined) ?? hexOfNow(p['weapon'] as string), p['target'] as string),
        });
        break;
      }
      case 'sk2.ordnance.ammo': {
        // Depletion (SK4 6.2): the original TH DR against the Depletion Number.
        const what = AMMO_LABEL[p['ammo'] as string] ?? String(p['ammo']);
        const n = p['depletion'] as number;
        const RESULT: Record<string, string> = {
          kept: `the Gun has ${what} and may try for it again`,
          last: `the Gun has ${what} for this shot only and is now out of it`,
          never: `the Gun never had ${what} and has not fired`,
          malf: `the Gun malfunctions and is out of ${what}`,
        };
        out.push({ seq: e.seq, kind: 'fire', text: `  ${what} depletion ${n}, original DR ${dr2(p['dr'], 'To Hit')}: ${RESULT[p['result'] as string] ?? p['result']}` });
        break;
      }
      case 'sk2.smoke.placed':
        out.push({ seq: e.seq, kind: 'fire', text: `  ☁ ${p['dispersed'] ? 'Dispersed ' : ''}${p['kind'] === 'wp' ? 'WP' : 'Smoke'} placed in ${hexLabel(p['hex'] as string)} (+${p['kind'] === 'wp' ? (p['dispersed'] ? 1 : 2) : p['dispersed'] ? 2 : 3} Hindrance)` });
        break;
      case 'sk2.ordnance.wp': {
        const mod = p['mod'] as number;
        out.push({ seq: e.seq, kind: 'fire', text: `  WP hit: ${(p['units'] as string[]).map(name).join(', ')} take a NMC${mod ? ` (${mod > 0 ? '+' : ''}${mod}${p['airBurst'] ? ', Air Burst' : p['ch'] ? ', Critical Hit: TEM added' : ': TEM subtracted'})` : ''}` });
        break;
      }
      case 'sk2.ordnance.noLos':
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${name(p['weapon'] as string)} at ${hexLabel(p['target'] as string)}${p['ammo'] ? ` (${p['ammo']})` : ''}: no LOS (${p['blockedBy']}) — ${p['noAmmo'] ? 'and no ammo: it has not fired' : `the Gun has fired for nothing${p['dr'] ? ` (TH DR ${drText(p['dr'] as number[])} for breakdown, depletion and ROF)` : ''}`}`,
          ...losOf((p['from'] as string | undefined) ?? hexOfNow(p['weapon'] as string), p['target'] as string),
        });
        break;
      case 'sk2.ordnance.rof': {
        const kept = p['kept'] as boolean;
        const why = p['why'] as string | null;
        const ROF_WHY: Record<string, string> = { exceeded: 'colored dr above the ROF', intensive: 'Intensive Fire never retains ROF', malfunction: 'the Gun malfunctioned', pinned: 'a pinned crew\'s Gun cannot retain ROF' };
        out.push({ seq: e.seq, kind: 'fire', text: `  ${name(p['weapon'] as string)} ${kept ? `keeps ROF (colored dr ${p['colored']} ≤ ${p['rof']}): it may fire again this phase` : `loses ROF${why ? `: ${ROF_WHY[why] ?? why}` : ''}`}` });
        break;
      }
      case 'sk2.acquired': {
        const units = (p['units'] as string[] | undefined) ?? [];
        const what = p['type'] === 'ATT' || units.length === 0 ? `hex ${hexLabel(p['hex'] as string)}` : `${units.map(name).join(', ')} in ${hexLabel(p['hex'] as string)}`;
        out.push({ seq: e.seq, kind: 'fire', text: `  ◎ ${name(p['weapon'] as string)} acquires ${what}: -${p['level']} Acquired Target counter placed${p['level'] === 2 ? ' (flipped)' : ''}` });
        break;
      }
      case 'sk2.gun.malf':
        out.push({ seq: e.seq, kind: 'info', text: `  ✖ ${name(p['gun'] as string)} ${p['removed'] ? 'is permanently removed' : 'malfunctions'} (original DR ${dr2(p['dr'], 'To Hit')})` });
        break;
      case 'sk3.toKill': {
        const dr = p['dr'] as [number, number] | null;
        const r = p['result'] as string;
        const text = p['tk'] === null
          ? `${name(p['weapon'] as string)} hits ${name(p['target'] as string)} (${p['location']} ${p['facing']}): ${p['ammo']} has no To Kill number`
          : p['ammo'] === 'FT'
            ? `Flamethrower To Kill ${name(p['target'] as string)}: TK ${p['finalTk']} (${noteLabels(p['explain']).join(', ')}), DR ${drText(dr!)} → ${r === 'kill' ? 'burns' : r === 'shock' ? 'Shock' : r === 'dud' ? 'dud' : 'no effect'}`
          : `To Kill ${name(p['target'] as string)}: ${p['location']} ${p['facing']} AF ${p['af']}, ${p['ammo']}${p['ch'] ? ' CH ×2' : ''} TK ${p['modifiedTk']} − ${p['af']} = ${p['finalTk']}, DR ${drText(dr!)} → ${
              r === 'kill' ? 'destroyed' : r === 'immobilized' ? 'Immobilized' : r === 'shock' ? 'Shock' : r === 'stun' ? 'Stun' : r === 'possibleShock' ? `Possible Shock (${p['shocked'] ? 'Shocked' : 'crew holds'})` : r === 'dud' ? 'dud' : 'no effect'
            }`;
        out.push({ seq: e.seq, kind: 'fire', text });
        break;
      }
      case 'sk3.vehicle.wrecked':
        out.push({ seq: e.seq, kind: 'fire', text: `${name(p['vehicle'] as string)} is knocked out (${p['by']})` });
        break;
      case 'sk3.paatc': {
        const dr = p['dr'] as [number, number];
        const reason = p['reason'] as string;
        out.push({ seq: e.seq, kind: 'check', text: `${name(p['unit'] as string)} PAATC vs ${name(p['vehicle'] as string)} (${reason === 'advance' ? 'to advance in' : reason === 'dc' ? 'to place the DC' : 'CC Reaction Fire'}; morale ${p['morale']}): DR ${drText(dr)}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''} → ${p['passed'] ? 'passes' : 'fails: pinned'}`, detail: noteLabels(p['explain']).join(', ') });
        break;
      }
      case 'sk3.cc.vsVehicle': {
        const dr = p['dr'] as [number, number];
        const r = p['result'] as string;
        const who = (p['attackers'] as string[]).map(name).join(' + ');
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${p['reaction'] ? 'CC Reaction Fire: ' : 'CC: '}${who} vs ${name(p['vehicle'] as string)}: CCV ${p['ccv']}, DR ${drText(dr)}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''}${p['third'] !== undefined ? `, third die ${p['third']}` : ''} → ${r === 'eliminated' ? 'DESTROYED' : r === 'immobilized' ? 'Immobilized' : r === 'casualtyReduction' ? 'original 12: Casualty Reduction for the attacker' : 'no effect'}`,
          detail: [...noteLabels(p['explain']), ...noteLabels(p['drmExplain'])].join(', '),
        });
        break;
      }
      case 'sk3.dcPlacement': {
        const dr = p['dr'] as [number, number];
        const r = p['result'] as string;
        out.push({ seq: e.seq, kind: 'fire', text: `DC placement vs ${name(p['vehicle'] as string)}: DR ${drText(dr)}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''} = ${p['final']} → ${r === 'armor' ? 'against the armor (TK 16)' : r === 'crew' ? 'a full-strength attack on the CE crew only' : 'an area attack: the AFV is spared'}`, detail: noteLabels(p['explain']).join(', ') });
        break;
      }
      case 'sk3.vehicle.status': {
        const st = p['status'] as string;
        out.push({ seq: e.seq, kind: 'fire', text: `${name(p['vehicle'] as string)} ${st === 'immobilized' ? 'is Immobilized' : st === 'shock' ? 'is Shocked' : st === 'stun' ? 'is Stunned' : st === 'STUN' ? 'is Stunned and Recalled' : st === 'bu' ? 'Buttons Up' : st} (${p['by']})` });
        break;
      }
      case 'sk3.vehicle.check': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'check', text: `${name(p['vehicle'] as string)} crew ${p['kind']} (morale ${p['morale']}${p['mod'] ? `, +${p['mod']}` : ''}): DR ${drText(dr)} → ${p['passed'] ? 'passes' : 'fails'}` });
        break;
      }
      case 'sk3.collateral': {
        const dr = p['dr'] as [number, number];
        const res = p['result'] as IftResult;
        out.push({ seq: e.seq, kind: 'fire', text: `Collateral Attack on the crew of ${name(p['target'] as string)}: ${p['column']} column, DR ${drText(dr)} +${p['drm']} CE → ${res.kind === 'none' ? 'no effect' : res.kind === 'MC' ? `${res.n}MC` : res.kind === 'K' ? `K/${res.n}` : res.kind === 'KIA' ? `${res.n ?? ''}KIA` : res.kind}` });
        break;
      }
      case 'sk3.areaHit': {
        const eff = p['effect'] as string;
        out.push({ seq: e.seq, kind: 'fire', text: `${name(p['vehicle'] as string)} takes an Area Target Type ${p['location']} hit: ${eff === 'kill' ? 'destroyed' : eff === 'shock' ? 'Shock' : eff === 'immobilized' ? 'Immobilized' : 'no effect on the AFV'}` });
        break;
      }
      case 'sk3.vehicle.recuperation': {
        const r = p['result'] as string;
        out.push({ seq: e.seq, kind: 'check', text: `${name(p['vehicle'] as string)} ${p['from'] === 'uk' ? 'Unconfirmed Kill' : 'Shock'} recuperation dr ${p['dr']}: ${r === 'recovered' ? 'recovers' : r === 'uk' ? 'flips to Unconfirmed Kill' : 'is a wreck'}` });
        break;
      }
      case 'sk3.vehicle.smoke': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} ${p['kind']}${p['n']} smoke: DR ${drText(dr)}${(p['drm'] as number) ? ` +${p['drm']}` : ''} → ${p['placed'] ? `Dispersed Smoke in ${hexLabel(p['hex'] as string)}` : 'no smoke'}` });
        break;
      }
      case 'sk3.vehicle.motionAttempt':
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} Motion attempt: dr ${p['dr']} vs ${p['mp']} MP in its LOS → ${p['success'] ? 'in Motion' : 'fails'}` });
        break;
      case 'sk3.vehicle.move': {
        const v = name(p['vehicle'] as string);
        const kind = p['kind'] as string;
        const text =
          kind === 'start' ? (p['mp'] === 0 ? `${v} moves on in Motion (no start MP)` : `${v} starts (${p['mp']} MP)`) :
          kind === 'restart' ? `${v} starts again (1 MP)` :
          kind === 'stop' ? `${v} stops${(p['mp'] as number) > 0 ? ' (1 MP)' : ''}` :
          kind === 'delay' ? `${v} delays ${p['mp']} MP` :
          kind === 'turn' ? `${v} turns its hull ${p['spines']} hexspine${(p['spines'] as number) === 1 ? '' : 's'} (${p['mp']} MP)` :
          kind === 'turret' ? `${v} points its turret` :
          kind === 'motion' ? `${v} ends its move in Motion` : `${v} ends its move`;
        out.push({ seq: e.seq, kind: 'move', text });
        break;
      }
      case 'sk3.vehicle.motionTurn': {
        const v = name(p['vehicle'] as string);
        const n = p['spines'] as number;
        out.push({ seq: e.seq, kind: 'move', text: p['kind'] === 'hull' ? `${v} turns its hull ${n} hexspine${n === 1 ? '' : 's'} in Motion (free)` : `${v} points its turret (in Motion)` });
        break;
      }
      case 'sk3.vehicle.reliability': {
        const dr = p['dr'] as [number, number];
        const r = p['result'] as string;
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} Mechanical Reliability DR ${drText(dr)}: ${r === 'ok' ? 'runs' : r === 'stall' ? `stalls, ${p['wasted']} MP wasted (Russian Vehicle Note M)` : 'breaks down: Immobilized'}` });
        break;
      }
      case 'sk3.pf.check': {
        const r = p['result'] as string;
        const notes = (p['notes'] as string[]).join(', ');
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${name(p['unit'] as string)} Panzerfaust check: dr ${p['dr']}${p['drm'] ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''} → ${r === 'pf' ? 'has a PF and fires it' : r === 'none' ? 'no PF' : r === 'pinned' ? 'no PF, pinned (original 6)' : 'no PF, broken (original 6 while pinned)'}`,
          ...(notes ? { detail: notes } : {}),
        });
        break;
      }
      case 'ssr.radioless': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} radioless${p['rule'] ? ` (${p['rule']})` : ''}: DR ${drText(dr)} vs ≤ ${p['need']} → ${p['ok'] ? 'may leave its hex this MPh' : 'may not leave its hex this MPh'}` });
        break;
      }
      case 'ssr.immobilization.dr': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} enters ${hexLabel(p['hex'] as string)}${p['rule'] ? ` (${p['rule']})` : ''}: DR ${drText(dr)} vs ≥ ${p['atLeast']} → ${p['immobilized'] ? 'Immobilized' : 'carries on'}` });
        break;
      }
      case 'ssr.sniper.attack': {
        out.push({ seq: e.seq, kind: 'fire', text: `Sniper attack${p['rule'] ? ` (${p['rule']})` : ''} on ${hexLabel(p['hex'] as string)}: dr ${p['dr']}${p['target'] ? ` → ${name(p['target'] as string)}: ${p['effect']}` : ' → no effect'}` });
        break;
      }
      case 'ssr.oba.contact': {
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${p['label']} (${p['rule']}): ${name(p['observer'] as string)} calls a fire mission on ${hexLabel(p['hex'] as string)}: dr ${p['dr']} vs ≤ ${p['need']} → ${p['contact'] ? `contact, it lands at the start of the AFPh (${p['left']} left)` : 'no contact'}`,
        });
        break;
      }
      case 'ssr.oba.landed': {
        const dirs = ['north', 'north-east', 'south-east', 'south', 'south-west', 'north-west'];
        const dist = p['distance'] as number;
        const where = dist === 0 ? `on target in ${hexLabel(p['target'] as string)}` : `${dist} hex${dist === 1 ? '' : 'es'} ${dirs[(p['direction'] as number) - 1] ?? ''} of ${hexLabel(p['target'] as string)}, ${p['landing'] ? `in ${hexLabel(p['landing'] as string)}` : 'off the map'}`;
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${p['label']} (${p['rule']}) lands: dr ${p['dr']} ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']}${p['direction'] ? `, direction dr ${p['direction']}` : ''} → ${where}; every unit in it and the six hexes around is attacked`,
        });
        break;
      }
      case 'ssr.stuka.attack': {
        const dr = p['dr'] as [number, number];
        const afv = (p['afv'] as { vehicle: string; final: number; result: string; tk?: number; tkDr?: [number, number] }[]).map((v) => `${name(v.vehicle)} (Final ${v.final}${v.tkDr ? `, To Kill ${drText(v.tkDr)} vs ${v.tk}` : ''}): ${v.result}`);
        out.push({ seq: e.seq, kind: 'fire', text: `Stuka attack${p['rule'] ? ` (${p['rule']})` : ''} on ${hexLabel(p['hex'] as string)}: To Hit DR ${drText(dr)}${p['infantry'] ? ' → hits the Infantry' : ''}${afv.length ? ` · ${afv.join(' · ')}` : ''}` });
        break;
      }
      case 'ssr.secret-sw.revealed': {
        const why = { fired: 'fires it', broken: 'is broken', enemy: 'is found by an enemy unit', unpossessed: 'no longer holds it' }[p['reason'] as string] ?? '';
        out.push({ seq: e.seq, kind: 'move', text: `${p['holder'] ? name(p['holder'] as string) : 'A unit'} revealed to possess ${name(p['weapon'] as string)}${why ? ` (${why})` : ''}` });
        break;
      }
      case 'ssr.dig-in.hullHit':
        out.push({ seq: e.seq, kind: 'fire', text: `  hull hit on the dug-in ${name(p['target'] as string)}${p['rule'] ? ` (${p['rule']})` : ''}: a miss` });
        break;
      case 'sk3.vehicle.bog': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} Bog Check in ${hexLabel(p['hex'] as string)}: DR ${drText(dr)} ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']} → ${p['bogged'] ? 'bogged' : 'passes'}`, detail: noteLabels(p['explain']).join(', ') });
        break;
      }
      case 'sk3.vehicle.unbog': {
        const r = p['result'] as string;
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} Bog removal: colored ${p['colored']} × white ${p['white']} → ${r === 'freed' ? `freed (${p['mp']} MP to start)` : r === 'mired' ? 'Mired' : 'Immobilized'}` });
        break;
      }
      case 'sk3.vehicle.ce':
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} ${p['ce'] ? 'goes Crew Exposed' : 'Buttons Up'}` });
        break;
      case 'sk2.gun.ca': {
        const reason = p['reason'] as string;
        if (reason === 'setup') break;
        out.push({ seq: e.seq, kind: 'info', text: `  ↻ ${name(p['gun'] as string)} turns ${p['spines']} hexspine${p['spines'] === 1 ? '' : 's'}${reason === 'fire' ? ' to fire' : reason === 'noAmmo' ? ' back: no ammo, so it never turned' : reason === 'manhandle' ? ' as it is pushed' : ' (end of the fire phase: it cannot move this Player Turn)'}` });
        break;
      }
      case 'sk2.gun.captured':
        out.push({ seq: e.seq, kind: 'info', text: `  ⚑ ${name(p['gun'] as string)} captured by ${name(p['by'] as string)}` });
        break;
      case 'sk2.gun.destroyed':
        out.push({ seq: e.seq, kind: 'info', text: `  ✖ ${name(p['gun'] as string)} destroyed (${p['reason']})` });
        break;
      case 'sk2.gun.manhandle': {
        const ok = p['outcome'] as string;
        out.push({
          seq: e.seq,
          kind: 'move',
          text: `${name(p['gun'] as string)} manhandled toward ${hexLabel(p['to'] as string)}: DR ${dr2(p['dr'], `Manhandle ${p['gun']}`)} ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']} vs M${p['m']} — ${ok === 'moved' ? 'moved on' : ok === 'stopped' ? 'moved and stopped' : 'did not move'}`,
          detail: noteLabels(p['explain']).join(', '),
        });
        break;
      }
      case 'sk1.exited':
        out.push({ seq: e.seq, kind: 'move', text: `  ⇥ ${name(p['unit'] as string)} exits the map${(p['vp'] as number) > 0 ? ` (${p['vp']} VP)` : ''}` });
        break;
      case 'sk4.usmc.deploy': {
        const halves = p['halves'] as string[] | undefined;
        out.push({ seq: e.seq, kind: 'check', text: `  NTC ${asDef(p['unit'] as string, p['from'] as string | undefined)} to deploy: DR ${drText(p['dr'] as number[])}${p['drm'] ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''} vs ${p['morale']} — ${p['passed'] ? `passed: two ${halves ? name(halves[0]!) : 'half-squads'}` : 'failed (SK4 8.4)'}` });
        break;
      }
      case 'sk4.usmc.recombined':
        out.push({ seq: e.seq, kind: 'info', text: `  ⇇ ${name(p['squad'] as string)}: two half-squads recombine under ${name(p['leader'] as string)} (SK4 8.4.1)` });
        break;
      case 'sk4.banzai.declared':
        if (p['vehicle']) {
          out.push({ seq: e.seq, kind: 'move', text: `  ! Banzai! ${name(p['leader'] as string)} charges alone at ${name(p['vehicle'] as string)} in ${hexLabel(p['target'] as string)} with its DC (SSR 2: in its hex after Defensive First Fire, a CC attack at CCV 5, -3)` });
          break;
        }
        out.push({ seq: e.seq, kind: 'move', text: `  ! Banzai! ${name(p['leader'] as string)} leads ${(p['units'] as string[]).filter((u) => u !== p['leader']).map(name).join(', ')} at ${hexLabel(p['target'] as string)} (SK4 8.1.8.6: 8 MF, +1 morale, one hex per Impulse)` });
        break;
      case 'sk4.banzai.step':
        out.push({ seq: e.seq, kind: 'move', text: `  ➜ ${name(p['unit'] as string)} charges ${hexLabel(p['from'] as string)} → ${hexLabel(p['to'] as string)} (${p['cost']} MF, Impulse ${p['impulse']})` });
        break;
      case 'sk4.banzai.impulse':
        if ((p['mf'] as number) > 0) out.push({ seq: e.seq, kind: 'info', text: `  Impulse ${p['impulse']} over: every Banzai unit is charged ${p['mf']} MF; the defender may fire at each Banzai hex` });
        break;
      case 'sk4.banzai.out':
        out.push({ seq: e.seq, kind: 'info', text: `  ${name(p['unit'] as string)} leaves the Banzai Charge: ${p['why']}` });
        break;
      case 'sk4.banzai.tpbf':
        out.push({ seq: e.seq, kind: 'fire', text: `  ✹ ${(p['firers'] as string[]).map(name).join(', ')} must fire Triple Point Blank at ${name(p['unit'] as string)} entering ${hexLabel(p['hex'] as string)} (SK4 8.1.8.7)` });
        break;
      case 'sk4.banzai.ended':
        out.push({ seq: e.seq, kind: 'info', text: `  The Banzai Charge is over` });
        break;
      case 'sk4.ja.stepReduced': {
        const to = counters[p['to'] as string];
        out.push({ seq: e.seq, kind: 'info', text: `  ↓ Step Reduction (SK4 8.1.2): ${asDef(p['unit'] as string, p['from'] as string)} becomes ${to ? defLabel(to) : p['to']}${p['broken'] ? ', broken' : ''}` });
        break;
      }
      case 'sk4.ja.leaderPtc':
        out.push({ seq: e.seq, kind: 'check', text: `  PTC ${name(p['unit'] as string)}: a Japanese leader takes no PTC (SK4 8.1.7)` });
        break;
      case 'sk4.ja.leaderWounded':
        out.push({ seq: e.seq, kind: 'info', text: `  ${p['outcome'] === 'eliminated' ? '✖' : '✚'} ${name(p['unit'] as string)} ${p['outcome'] === 'eliminated' ? 'dies of his wound' : 'is wounded'} instead of breaking (SK4 8.1.7)` });
        break;
      case 'sk4.ja.handToHand':
        out.push({ seq: e.seq, kind: 'info', text: `  ⚔ Hand-to-Hand Close Combat in ${hexLabel(p['hex'] as string)} (SK4 8.1.8.4): kill numbers two higher, -1 for each Japanese attack` });
        break;
      case 'sk4.concealment.gained': {
        const why: Record<string, string> = { setup: 'an OB concealment counter', 'setup-unseen': 'no enemy unit can see it', reinforcement: 'entering reinforcements set up concealed', endOfTurn: 'out of every unbroken enemy\'s LOS in Concealment Terrain at the end of the Player Turn', hip: 'a hidden unit placed on the board concealed' };
        // The enemy reads only of the "?" counter going down: the units under it are its secret (SK4 8.3.2).
        const seen = (p['units'] as string[]).filter((u) => !hiddenFrom(u));
        const where = p['hex'] ? ` in ${hexLabel(p['hex'] as string)}` : '';
        out.push({ seq: e.seq, kind: 'info', text: seen.length ? `  ? ${seen.map(name).join(', ')} concealed${where}: ${why[p['reason'] as string] ?? p['reason']}` : `  ? A ${sideNameOf(env, p['side'] as string)} concealment counter${where}` });
        break;
      }
      case 'sk4.concealment.lost': {
        const why: Record<string, string> = { fire: 'fired in the LOS of a Good Order enemy', hit: 'an attack had a result on it', smoke: 'attempted Smoke', dc: 'attempted a DC placement', moved: 'moved without Assault Movement in enemy LOS', open: 'in Open Ground in enemy LOS', entered: 'an enemy unit tried to enter its hex', entering: 'tried to enter a hex with an enemy "?"', ca: 'changed its Gun\'s Covered Arc', transfer: 'took a weapon', deploy: 'deployed', recombine: 'recombined', leadership: 'used its leadership modifier', broken: 'broke', wounded: 'was wounded', voluntary: 'dropped it', cc: 'engaged in Close Combat', melee: 'ended the CCPh with an unbroken enemy in its hex' };
        out.push({ seq: e.seq, kind: 'info', text: `  ? Concealment lost: ${(p['units'] as string[]).map(name).join(', ')}${p['hex'] ? ` in ${hexLabel(p['hex'] as string)}` : ''} (${why[p['reason'] as string] ?? p['reason']})` });
        break;
      }
      case 'sk4.concealment.bounce':
        out.push({ seq: e.seq, kind: 'move', text: `  ${(p['units'] as string[]).map(name).join(', ')} stopped short of ${hexLabel(p['hex'] as string)}: it held only a concealed stack (SK4 8.3.2), the MF are spent where they stand` });
        break;
      case 'sk4.hut.collapsed': {
        const why: Record<string, string> = { kia: 'a KIA result inside it', 'afv-entered': `${name(p['afv'] as string)} drove in`, 'afv-left': `${name(p['afv'] as string)} drove out`, 'afv-turned': `${name(p['afv'] as string)} turned inside it` };
        const ptc = p['ptc'] as { unit: string; dr: [number, number]; pinned: boolean }[];
        out.push({ seq: e.seq, kind: 'info', text: `  ▣ The hut in ${hexLabel(p['hex'] as string)} collapses (${why[p['why'] as string] ?? p['why']}): no TEM from now on`, detail: ptc.map((x) => `${name(x.unit)} PTC vs 8: DR ${drText(x.dr)} → ${x.pinned ? 'pinned' : 'passes'}`).join('; ') });
        break;
      }
      case 'sk4.bamboo.entered':
        out.push({ seq: e.seq, kind: 'move', text: `  ${(p['units'] as string[]).map(name).join(', ')} into the bamboo of ${hexLabel(p['hex'] as string)}: all MF spent (+1 for Defensive First Fire); CX and pinned once the fire is over` });
        break;
      case 'sk2.hip.revealed':
      case 'sk2.hip.unitRevealed': {
        const why: Record<string, string> = { fire: 'it fired', ca: 'it changed its Covered Arc', moved: 'it moved', seen: 'a Good Order enemy within 16 hexes has a LOS to it in Open Ground', entered: 'an enemy unit tried to enter its hex', hit: 'an attack affected it', advanced: 'an enemy unit advanced into its hex', manhandle: 'it was manhandled' };
        const who = (e.type === 'sk2.hip.revealed' ? p['gun'] : p['unit']) as string;
        out.push({ seq: e.seq, kind: 'info', text: `  ▣ Hidden ${name(who)} revealed in ${hexLabel(p['hex'] as string)}: ${why[p['reason'] as string] ?? p['reason']}` });
        break;
      }
    }
  }
  // No line ever shows a raw piece id: anything that slipped through is named here.
  return out.map((l) => ({ ...l, text: nameIds(env, l.text), ...(l.detail ? { detail: nameIds(env, l.detail) } : {}) }));
}
