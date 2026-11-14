import { COUNTERS, newGame } from '@asl/content';
import type { Action, GameEvent, GameState, Piece, QueryEnv } from '@asl/engine';
import { PHASE_NAME, achieved, casualtyVp, controlState, defLabel, defOf, exitVp, hexLabel, hexOfLoc, humanize, isWeaponDef, pieceLabel, statics, vpTally, type Casualty, type ScenarioDef, type VictoryCondition } from '@asl/rules';
import { AAR_VERSION, type AarCasualty, type AarControl, type AarDice, type AarDoc, type AarHighlight, type AarLuck, type AarPlayer, type AarRace, type AarStrength, type AarVictory, type Competition, type MatchMode, type Timestamp } from '@asl/platform';
import { buildingLabel, conditionText, leaves, list, plural, sideName, victoryStandings, winningClause } from './vc';

/** What the recording cannot tell: who played, how the match was classified, and a server-side ending. */
export interface AarMeta {
  matchId: string;
  mode: MatchMode;
  competition: Competition;
  /** Side id -> the player in that seat. */
  players: Record<string, AarPlayer>;
  /**
   * The result the match document records. The engine's own result is used when the recording
   * reaches one; a concession or timeout decided on the server has none, so this fills in.
   */
  result: { winner: string | null; reason: string };
  playedAt: Timestamp;
  createdAt: Timestamp;
  durationMin: number | null;
}

type Ev = GameEvent<Record<string, any>>;
const ID_RE = /\b[a-z]{2}\.[A-Za-z0-9.]+/;

const short = (name: string) => name.slice(0, 2).replace(/^./, (c) => c.toUpperCase());

/** Squad-equivalents of a side on the board: squads 1, half-squads and crews ½, vehicles 1 unless wrecked; leaders and weapons 0. */
function strengthOf(env: QueryEnv, side: string): number {
  let n = 0;
  for (const p of Object.values(env.state.pieces)) {
    if (p.side !== side) continue;
    // On the map, or set up beside its entry edge; reinforcements still waiting (and exited units) do not count.
    if (!(p.loc.kind === 'hex' || (p.loc.kind === 'offboard' && p.loc.edge !== 'exited' && !!p.loc.hex))) continue;
    const d = defOf(env, p);
    if (d.kind === 'squad') n += 1;
    else if (d.kind === 'hs' || d.kind === 'crew') n += 0.5;
    else if (d.kind === 'vehicle' && p.tags['wreck'] !== true) n += 1;
  }
  return n;
}

/** The counters a unit is carrying, named ("LMG + DC"), or undefined. */
function carried(env: QueryEnv, unit: string): string | undefined {
  const names = Object.values(env.state.pieces)
    .filter((p) => p.loc.kind === 'held' && p.loc.by === unit)
    .map((p) => defOf(env, p))
    .filter(isWeaponDef)
    .map(defLabel);
  return names.length ? names.join(' + ') : undefined;
}

function hexOfUnit(state: GameState, unit: string): string | null {
  const p = state.pieces[unit];
  if (!p) return null;
  if (p.loc.kind === 'hex') return hexLabel(p.loc.hex);
  if (p.loc.kind === 'held') return hexOfUnit(state, p.loc.by);
  const last = p.tags['lastHex'];
  // The Location it died in (a LocId: the hex id at ground level).
  return typeof last === 'string' ? hexLabel(hexOfLoc(last)) : null;
}

const tidy = (s: string) => s.replace(/\bIFT\s+/g, '').replace(/\s+/g, ' ').trim();

/** A result or check name with its article: "a K/2 result", "a 2MC", "an NMC", "a Leader Loss MC". */
function phrase(s: string): string {
  if (/^K(\/\d)?$/.test(s)) return `a ${s} result`;
  if (/^\dMC$/.test(s)) return `a ${s}`;
  if (s === 'NMC') return 'an NMC';
  if (s === 'LLMC') return 'a Leader Loss MC';
  if (s === 'LLTC') return 'a Leader Loss TC';
  if (s === 'PTC') return 'a PTC';
  return s;
}

/** The engine's elimination reason in the report's words. */
function causeText(env: QueryEnv, c: Casualty, ctx: { fire?: Ev; cc?: Ev }): string {
  const r = c.reason;
  const h = (s: string) => tidy(humanize(env, s));
  let m: RegExpMatchArray | null;
  let text: string;
  const fire = ctx.fire?.payload;
  const fireContext = fire ? ` · ${fire['fp']} FP${fire['from']?.length ? ` from ${(fire['from'] as string[]).map(hexLabel).join(', ')}` : ''}, DR ${(fire['dr'] as number[])[0]! + (fire['dr'] as number[])[1]!}` : '';
  const cc = ctx.cc?.payload;
  const ccContext = cc ? ` · ${cc['odds']}, DR ${cc['dr']}` : '';
  if (r === 'IFT KIA') text = `KIA${fireContext}`;
  else if (/^IFT K(\/\d)?$/.test(r)) text = `Casualty Reduction · ${phrase(tidy(r))}${fireContext}`;
  else if (r === 'destroyed by KIA') text = `Destroyed by the KIA${fireContext}`;
  else if ((m = r.match(/^(.*): original 12 on MC while broken$/))) text = `Original 12 on ${phrase(h(m[1]!))} while broken`;
  else if ((m = r.match(/^(.*): failed MC while broken$/))) text = `Failed ${phrase(h(m[1]!))} while already broken`;
  else if ((m = r.match(/^(.*): original 12 on MC$/))) text = `Casualty Reduction · original 12 on ${phrase(h(m[1]!))}`;
  else if (r === 'original 12 on rally') text = 'Casualty Reduction · original 12 on the rally DR';
  else if ((m = r.match(/^(.*): wound severity$/))) text = `Killed · wounded by ${phrase(h(m[1]!))}, the severity dr finished it`;
  else if (r === 'Close Combat') text = `${c.kind === 'reduced' ? 'Casualty Reduction in' : 'Lost'} Close Combat${ccContext}`;
  else if (r.startsWith('Close Combat vs a vehicle')) text = `Lost Close Combat with a vehicle${ccContext}`;
  else if (r === 'failed to enter') text = 'Never entered the map · due this turn, left offboard (SK1 3.3)';
  else if (r === 'failure to rout') text = 'Failure to rout';
  else if (r === 'failure to rout: no legal rout path') text = 'Failure to rout · no rout path';
  else if (r.startsWith('failure to rout (ended adjacent')) text = 'Failure to rout · ended adjacent to the enemy';
  else if (r === 'routing leader: interdiction MC failed') text = 'Interdiction while routing · failed the MC';
  else if (r.startsWith('Interdiction: original 12')) text = 'Interdiction · original 12 while broken';
  else if (r === 'Interdiction') text = 'Casualty Reduction · Interdiction';
  else if (r === 'FPF') text = 'Casualty Reduction · Final Protective Fire';
  else if (r === 'Sniper') text = 'Sniper';
  else if (r.startsWith('Direct Hit')) text = h(r);
  else if (r === 'failed to rally under a Commissar') text = 'Failed to rally under the Commissar';
  else if (c.vp > 0 && COUNTERS[c.defId]?.kind === 'vehicle') text = `Wrecked by ${h(r)}`;
  else text = h(r).replace(/^./, (ch) => ch.toUpperCase());
  return text;
}

/** Everything the fold needs to remember about one event's moment in the game. */
interface Moment {
  turn: number;
  phase: string;
  attacker: string;
  /** Index into the per-player-turn series (0 = setup). */
  pt: number;
}

export function buildAar(scenario: ScenarioDef, seed: string, actions: Action[], meta: AarMeta, opts: { los?: 'pixel' | 'grid' } = {}): AarDoc {
  const { engine, state: s0, events: e0 } = newGame(scenario, seed, opts);
  const sides = scenario.sides.map((s) => s.side);
  const other = (s: string) => sides.find((x) => x !== s) ?? s;
  const name = (s: string) => sideName(scenario, s);
  const hasControl = leaves(scenario.victory).some((vc) => vc.kind === 'controlBuildings' || vc.kind === 'controlHexes');
  const controlVc = leaves(scenario.victory).find((vc): vc is VictoryCondition & ({ kind: 'controlBuildings' } | { kind: 'controlHexes' }) => vc.kind === 'controlBuildings' || vc.kind === 'controlHexes');
  const cvpVc = leaves(scenario.victory).find((vc) => vc.kind === 'eliminateCvp' || vc.kind === 'cvpBelow');
  const exitVc = leaves(scenario.victory).find((vc): vc is VictoryCondition & { kind: 'exitVp' } => vc.kind === 'exitVp');
  const tallyVc = leaves(scenario.victory).find((vc): vc is VictoryCondition & { kind: 'vpTally' } => vc.kind === 'vpTally');

  // Per-player-turn series. Index 0 is the setup; each turn.playerTurn opens a new index.
  const labels: string[] = ['Setup'];
  const strength: Record<string, number[]> = {};
  const lossAt: Record<string, Set<number>> = {};
  const luck: Record<string, number[]> = {};
  const race: Record<string, number[]> = {};
  const cum: Record<string, number> = {};
  const dice: Record<string, AarDice> = {};
  const marks: Record<string, { at: number; v: 2 | 12 }[]> = {};
  const streak: Record<string, number> = {};
  for (const s of sides) {
    strength[s] = [];
    lossAt[s] = new Set();
    luck[s] = [];
    race[s] = [];
    cum[s] = 0;
    dice[s] = { drs: 0, avg: 0, hist: Array(11).fill(0) as number[], twos: 0, twelves: 0, mc: { passed: 0, failed: 0 }, rally: { made: 0, failed: 0 }, elr: 0, hob: 0, streak: 0 };
    marks[s] = [];
    streak[s] = 0;
  }
  const controlByTurn: (string | null)[][] = [];
  const casualties: AarCasualty[] = [];
  const highlights: AarHighlight[] = [];
  const hl = (side: string | null, m: Moment, title: string, text: string, weight: number) => highlights.push({ side, turn: m.turn, phase: m.phase, title, text, weight });

  const raceValue = (env: QueryEnv, s: string): number =>
    cvpVc ? casualtyVp(env, other(s)) : exitVc ? (exitVc.side === s ? exitVp(env, s) : 0) : tallyVc ? (tallyVc.side === s ? vpTally(env, tallyVc).total : 0) : 0;
  const controlRow = (env: QueryEnv): (string | null)[] => {
    if (!controlVc) return [];
    const ctl = controlState(env);
    if (controlVc.kind === 'controlBuildings') return controlVc.buildings.map((b) => ctl.buildings[b] ?? null);
    const map = statics(env).map;
    return controlVc.hexes.map((h) => ctl.hexes[map.hex(h)?.id ?? h] ?? null);
  };
  /** Record the per-player-turn samples for index `i` from a state. */
  const sample = (env: QueryEnv, i: number) => {
    for (const s of sides) {
      strength[s]![i] = strengthOf(env, s);
      luck[s]![i] = cum[s]!;
      race[s]![i] = raceValue(env, s);
    }
  };

  let state = s0;
  const m: Moment = { turn: s0.turn, phase: s0.phase, attacker: s0.attacker, pt: 0 };
  sample(engine.env(s0), 0);

  /** Which side a two-dice roll belongs to: the unit in its label, the typed event that follows, else the phasing side. */
  const sideOf = (pre: GameState, label: string, rest: Ev[]): string => {
    const cc = label.match(/^CC (\w+) in /);
    if (cc && sides.includes(cc[1]!)) return cc[1]!;
    const amb = label.match(/^Ambush dr \((\w+)\)/);
    if (amb && sides.includes(amb[1]!)) return amb[1]!;
    const id = label.match(ID_RE)?.[0]?.replace(/\.+$/, '');
    const unit = id ? pre.pieces[id] : undefined;
    if (unit) return unit.side;
    for (const e of rest) {
      const p = e.payload;
      const of = (u: unknown) => (typeof u === 'string' ? pre.pieces[u]?.side : undefined);
      let s: string | undefined;
      switch (e.type) {
        case 'sk1.fire.attack':
        case 'sk1.fire.noLos':
          s = of(p['attack']?.parts?.[0]);
          break;
        case 'sk1.check':
        case 'sk1.fire.result':
        case 'sk1.leaderCreation':
          s = of(p['unit']);
          break;
        case 'sk1.cc.attack':
        case 'ssr.sniper.attack':
          s = typeof p['side'] === 'string' ? p['side'] : undefined;
          break;
        case 'sk2.ordnance.shot':
          s = of(p['firer']) ?? of(p['weapon']);
          break;
        case 'sk3.toKill':
          s = of(p['weapon']);
          break;
        case 'sk3.vehicle.check':
          s = of(p['vehicle']);
          break;
        case 'dice.rolled':
          // Another roll before anything typed: this one stays unattributed by look-ahead.
          return m.attacker;
      }
      if (s) return s;
    }
    return m.attacker;
  };

  const fold = (pre: GameState, events: Ev[], post: GameState) => {
    const preEnv = engine.env(pre);
    const postEnv = engine.env(post);
    let lastFire: Ev | undefined;
    let lastCc: Ev | undefined;
    const lastRoll = new Map<string, number>();
    const ccKills = new Map<Ev, string[]>();
    let ptChanged = false;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      const p = e.payload;
      switch (e.type) {
        case 'turn.phaseStarted':
          // The setup is over once the first real phase opens: that is when the "Setup" point closes
          // and the first player turn's index opens (its turn.playerTurn fired before anyone had placed a counter).
          if (m.phase === 'setup' && p['phase'] !== 'setup' && labels.length === 1) {
            // The action that ends the setup carries the last placements: the Setup point reads its result.
            sample(postEnv, 0);
            m.pt = labels.length;
            labels.push(`${p['turn']} ${short(name(p['attacker']))}`);
            ptChanged = true;
          }
          m.turn = p['turn'];
          m.phase = p['phase'];
          m.attacker = p['attacker'];
          break;
        case 'turn.playerTurn': {
          // The opening player turn is announced before the setup; the setup's own point stays open until it ends.
          if (labels.length === 1 && (pre.phase === 'setup' || m.phase === 'setup')) {
            m.turn = p['turn'];
            m.attacker = p['attacker'];
            break;
          }
          // The previous player turn is over: close its samples with the state this action produced.
          sample(postEnv, m.pt);
          if (p['attacker'] === scenario.firstSide && p['turn'] > 1) controlByTurn[p['turn'] - 2] = controlRow(postEnv);
          m.turn = p['turn'];
          m.attacker = p['attacker'];
          m.pt = labels.length;
          labels.push(`${p['turn']} ${short(name(p['attacker']))}`);
          ptChanged = true;
          break;
        }
        case 'dice.rolled': {
          const ds = p['dice'] as number[];
          const label = String(p['label']);
          const id = label.match(ID_RE)?.[0]?.replace(/\.+$/, '');
          if (ds.length !== 2) break;
          const total = ds[0]! + ds[1]!;
          if (id) lastRoll.set(id, total);
          const s = sideOf(pre, label, events.slice(i + 1));
          const d = dice[s]!;
          d.drs++;
          d.hist[total - 2]!++;
          if (total === 2) {
            d.twos++;
            marks[s]!.push({ at: m.pt, v: 2 });
          }
          if (total === 12) {
            d.twelves++;
            marks[s]!.push({ at: m.pt, v: 12 });
          }
          cum[s]! += 7 - total;
          break;
        }
        case 'sk1.fire.attack':
          lastFire = e;
          break;
        case 'sk1.fire.result':
          if (p['critical'] === true) {
            const u = pre.pieces[p['unit']];
            if (u) hl(other(u.side), m, 'Critical Hit', `A Critical Hit on ${pieceLabel(preEnv, u)} in ${hexOfUnit(pre, u.id) ?? '?'}.`, 8);
          }
          break;
        case 'sk2.ordnance.shot':
          if (p['outcome'] === 'ch') {
            const f = pre.pieces[p['firer']] ?? pre.pieces[p['weapon']];
            if (f) hl(f.side, m, 'Critical Hit', `${pieceLabel(preEnv, f)} scores a Critical Hit on ${hexLabel(String(p['target']))}.`, 8);
          }
          break;
        case 'sk1.cc.attack':
          lastCc = e;
          ccKills.set(e, []);
          break;
        case 'sk1.check': {
          const u = pre.pieces[p['unit']];
          const s = u?.side ?? m.attacker;
          const d = dice[s]!;
          const kind = String(p['kind']);
          const outcome = String(p['outcome']);
          const dr = Number(p['dr']);
          const reason = tidy(String(p['reason']));
          if (kind === 'rally') {
            if (outcome === 'rallied') d.rally.made++;
            else d.rally.failed++;
            if (outcome === 'reduced' && u) hl(other(s), m, 'Boxcars on the rally', `${pieceLabel(preEnv, u)} in ${hexOfUnit(pre, u.id) ?? '?'} rolls 12 on its rally and is Casualty Reduced.`, 5);
          } else {
            if (kind === 'MC') {
              if (outcome === 'passed') d.mc.passed++;
              else d.mc.failed++;
            }
            if (outcome === 'passed') {
              streak[s] = (streak[s] ?? 0) + 1;
              if (streak[s]! > d.streak) d.streak = streak[s]!;
              const sev = reason.match(/(\d)MC|K\/(\d)/);
              const n = sev ? Number(sev[1] ?? sev[2]) : 0;
              if (u && dr <= 3) hl(s, m, dr === 2 ? 'Snake eyes' : 'Nerves of steel', `${pieceLabel(preEnv, u)} in ${hexOfUnit(pre, u.id) ?? '?'} passes ${phrase(reason)} on an original ${dr}.`, dr === 2 ? 6 : 5);
              else if (u && n >= 3) hl(s, m, 'Held under fire', `${pieceLabel(preEnv, u)} in ${hexOfUnit(pre, u.id) ?? '?'} takes ${phrase(reason)} and passes it on a ${dr}.`, 7);
            } else {
              streak[s] = 0;
              if (u && dr === 12 && kind === 'MC') hl(other(s), m, 'Boxcars', `${pieceLabel(preEnv, u)} in ${hexOfUnit(pre, u.id) ?? '?'} rolls 12 on ${phrase(reason)} and is ${outcome}.`, 5);
            }
          }
          break;
        }
        case 'sk1.elr': {
          const u = pre.pieces[p['unit']];
          if (u) dice[u.side]!.elr++;
          break;
        }
        case 'sk1.leaderCreation': {
          const u = pre.pieces[p['unit']];
          if (u && p['leader']) {
            dice[u.side]!.hob++;
            const def = p['defId'] ? COUNTERS[p['defId']] : undefined;
            hl(u.side, m, 'Heat of Battle', `${pieceLabel(preEnv, u)} in ${hexOfUnit(pre, u.id) ?? '?'} rolls a 2 and creates ${def ? `${name(u.side)} ${defLabel(def)}` : 'a leader'}.`, 9);
          }
          break;
        }
        case 'piece.eliminated': {
          if (lastCc && lastCc.payload['attack']?.targets?.includes(p['id']) && p['reason'] === 'Close Combat') ccKills.get(lastCc)?.push(p['id']);
          break;
        }
        case 'sk1.casualty': {
          const c = p as Casualty;
          const u = pre.pieces[c.unit];
          const def = COUNTERS[c.defId];
          const fire = lastFire && u && lastFire.payload['attack']?.target && hexOfUnit(pre, u.id) === hexLabel(String(lastFire.payload['attack'].target)) ? lastFire : undefined;
          const cc = lastCc && (lastCc.payload['attack']?.targets?.includes(c.unit) || lastCc.payload['attack']?.attackers?.includes(c.unit)) ? lastCc : undefined;
          const row: AarCasualty = {
            side: c.side,
            turn: c.turn,
            phase: c.phase,
            def: c.defId,
            label: def ? defLabel(def) : c.defId,
            hex: u ? hexOfUnit(pre, u.id) : null,
            kind: c.kind,
            cause: causeText(preEnv, c, { ...(fire ? { fire } : {}), ...(cc ? { cc } : {}) }),
            cvp: c.vp,
          };
          const sw = u ? carried(preEnv, u.id) : undefined;
          if (sw) row.sw = sw;
          if (def?.kind === 'leader') row.leader = true;
          if (def?.kind === 'vehicle') row.vehicle = true;
          if (c.kind === 'reduced') {
            const after = post.pieces[c.unit]?.defId;
            if (after && after !== c.defId) row.to = after;
          }
          casualties.push(row);
          lossAt[c.side]!.add(m.pt);
          if (def?.kind === 'leader' && c.kind === 'eliminated') hl(other(c.side), m, 'Leader down', `${name(c.side)} ${defLabel(def)} killed in ${row.hex ?? '?'}: ${row.cause.replace(/^Killed · /, '')}.`, 6);
          const parts = fire?.payload['attack']?.parts as string[] | undefined;
          const weapon = parts?.map((id) => pre.pieces[id]).find((w) => w && isWeaponDef(defOf(preEnv, w)) && ['DC', 'FT'].includes((defOf(preEnv, w) as { type?: string }).type ?? ''));
          if (fire && weapon && c.kind === 'eliminated') {
            const wd = defOf(preEnv, weapon) as { type: string };
            hl(other(c.side), m, wd.type === 'DC' ? 'Demolition Charge' : 'Flamethrower', `A ${wd.type === 'DC' ? 'Demolition Charge' : 'Flamethrower'} attack on ${row.hex ?? '?'} (${fire.payload['fp']} FP, DR ${(fire.payload['dr'] as number[])[0]! + (fire.payload['dr'] as number[])[1]!}) kills ${name(c.side)} ${row.label}.`, 7);
          }
          break;
        }
      }
    }
    for (const [cc, ids] of ccKills) {
      const leader = ids.some((id) => COUNTERS[pre.pieces[id]?.defId ?? '']?.kind === 'leader');
      if (ids.length >= 2 || leader) {
        const side = String(cc.payload['side']);
        const names = ids.map((id) => pre.pieces[id]).filter((x): x is Piece => !!x).map((x) => pieceLabel(preEnv, x));
        hl(side, m, `Close Combat in ${hexLabel(String(cc.payload['hex']))}`, `${plural(name(side))} wipe out ${list(names)} at ${cc.payload['odds']}, DR ${cc.payload['dr']}.`, 8);
      }
    }
    if (ptChanged) sample(postEnv, m.pt);
    else sample(postEnv, m.pt);
  };

  fold(s0, e0 as Ev[], s0);
  for (const a of actions) {
    const t = engine.submit(state, a);
    fold(state, t.events as Ev[], t.state);
    state = t.state;
  }
  const env = engine.env(state);
  sample(env, m.pt);
  if (controlVc) controlByTurn[Math.max(0, state.turn - 1)] = controlRow(env);
  for (let i = 0; i < controlByTurn.length; i++) if (!controlByTurn[i]) controlByTurn[i] = controlRow(env);
  for (const s of sides) if (streak[s]! >= 6 || dice[s]!.streak >= 6) hl(s, m, 'Unshakeable', `${plural(name(s))} passed ${dice[s]!.streak} morale checks in a row.`, 4);

  // The result: the engine's when the recording reaches one, the match document's otherwise.
  const engineResult = state.result;
  const winner = engineResult ? engineResult.winner : meta.result.winner;
  const reason = engineResult ? engineResult.reason : meta.result.reason;
  const loser = winner ? other(winner) : null;
  const loserNick = loser ? (meta.players[loser]?.nickname ?? name(loser)) : '';
  const phaseName = PHASE_NAME[state.phase] ?? state.phase;
  const met = leaves(scenario.victory).filter((vc) => vc.side === winner && achieved(env, vc));
  const offensive = leaves(scenario.victory).filter((vc) => vc.side === loser);
  let how: string;
  switch (reason) {
    case 'scenario end':
      if (!winner) how = 'Neither side met its victory conditions';
      else if (met[0]) how = `${winningClause(env, scenario, met[0], true)}${met[0].kind === 'controlBuildings' || met[0].kind === 'controlHexes' ? ` at the end of Turn ${state.turn}` : ''}`;
      else if (offensive[0] && loser) how = `The ${plural(name(loser))} never ${winningClause(env, scenario, offensive[0], false)}`;
      else how = `${plural(name(winner))} held on to the end of Turn ${state.turn}`;
      break;
    case 'sudden death':
      how = `Won immediately in Turn ${state.turn} ${phaseName}${met[0] ? `: ${winningClause(env, scenario, met[0], true).replace(/^./, (c) => c.toLowerCase())}` : ''}`;
      if (met[0]) hl(winner, m, 'Sudden death', `${conditionText(env, scenario, met[0])}: the game ends at once.`, 10);
      break;
    case 'annihilation':
      how = loser ? `The last ${name(loser)} unit died in Turn ${state.turn}` : `Both sides were wiped out in Turn ${state.turn}`;
      if (casualties.length) {
        const last = casualties[casualties.length - 1]!;
        hl(winner, m, 'Annihilation', `${name(last.side)} ${last.label} in ${last.hex ?? '?'} was the last unit standing: ${last.cause}.`, 10);
      }
      break;
    case 'nothing left to play':
      // One side's units had all exited or died with the result settled (sk1.vc.nothing-left): the VC decided it there.
      how = `${winner ? (met[0] ? winningClause(env, scenario, met[0], true) : `${plural(name(winner))} held on`) : 'Neither side met its victory conditions'}; with nothing left to play, the game ended in Turn ${state.turn}`;
      break;
    case 'concession':
      how = `${loserNick} conceded in Turn ${state.turn} ${phaseName}`;
      break;
    case 'timeout':
      how = `${loserNick} ran out the clock in Turn ${state.turn}`;
      break;
    default:
      how = reason;
  }

  for (const s of sides) {
    const d = dice[s]!;
    d.avg = d.drs ? Math.round((d.hist.reduce((a, n, i) => a + n * (i + 2), 0) / d.drs) * 100) / 100 : 0;
  }
  const seriesOf = (rec: Record<string, number[]>): Record<string, number[]> => Object.fromEntries(sides.map((s) => [s, labels.map((_, i) => rec[s]![i] ?? rec[s]![i - 1] ?? 0)]));
  const strengthDoc: AarStrength = { labels, sides: seriesOf(strength), losses: Object.fromEntries(sides.map((s) => [s, [...lossAt[s]!].sort((a, b) => a - b)])) };
  const luckDoc: AarLuck = { labels, sides: seriesOf(luck), marks };

  let control: AarControl | null = null;
  let raceDoc: AarRace | null = null;
  if (controlVc) {
    const objLabels = controlVc.kind === 'controlBuildings' ? controlVc.buildings.map((b) => buildingLabel(env, scenario, b)) : controlVc.hexes.map(hexLabel);
    const rows: AarControl['byTurn'] = [];
    for (let t = 0; t < Math.max(state.turn, 1); t++) rows.push({ holders: controlByTurn[t] ?? controlByTurn[t - 1] ?? objLabels.map(() => null) });
    control = { kind: controlVc.kind === 'controlBuildings' ? 'buildings' : 'hexes', labels: objLabels, byTurn: rows };
  } else if (cvpVc || exitVc || tallyVc) {
    const vc = (cvpVc ?? exitVc ?? tallyVc)!;
    const goal: Record<string, number> = {};
    for (const v of leaves(scenario.victory)) {
      if (v.kind === 'eliminateCvp') goal[v.side] = victoryStandings(env, scenario).find((x) => x.text === conditionText(env, scenario, v))?.need ?? v.cvp;
      else if (v.kind === 'cvpBelow') goal[other(v.side)] = v.cvp;
      else if (v.kind === 'exitVp' || v.kind === 'vpTally') goal[v.side] = v.vp;
    }
    raceDoc = {
      kind: vc.kind === 'exitVp' ? 'exitVp' : vc.kind === 'vpTally' ? 'vp' : 'cvp',
      label: vc.kind === 'exitVp' ? 'Exit VP earned' : vc.kind === 'vpTally' ? 'Victory points' : 'Casualty VP inflicted',
      labels,
      sides: seriesOf(race),
      ...(Object.keys(goal).length ? { goal } : {}),
    };
  }
  void hasControl;

  // Control "since": the turn an objective's final holder last took it.
  const victory: AarVictory[] = victoryStandings(env, scenario).map((v) => ({
    ...v,
    items: v.items.map((it) => {
      if (!control || it.holder === undefined) return it;
      const col = control.labels.indexOf(it.label);
      if (col < 0) return it;
      let since = control.byTurn.length;
      for (let t = control.byTurn.length - 1; t >= 0 && control.byTurn[t]!.holders[col] === it.holder; t--) since = t + 1;
      return it.holder ? { ...it, since: `T${since}` } : it;
    }),
  }));

  const top = highlights
    .sort((a, b) => b.weight - a.weight || a.turn - b.turn)
    .slice(0, 8)
    .sort((a, b) => a.turn - b.turn || b.weight - a.weight);

  const title = scenario.title.replace(new RegExp(`^${scenario.number ?? ''}\\s+`), '');
  return {
    version: AAR_VERSION,
    matchId: meta.matchId,
    scenario: { id: scenario.id, number: scenario.number ?? '', title, place: scenario.place ?? '', date: scenario.date ?? '', turns: scenario.turns, victoryText: scenario.victoryText ?? '' },
    mode: meta.mode,
    competition: meta.competition,
    playedAt: meta.playedAt,
    durationMin: meta.durationMin,
    sides: scenario.sides.map((s) => ({ side: s.side, name: s.name, nationality: s.nationality, player: meta.players[s.side] ?? { uid: null, nickname: s.name }, attacker: s.side === scenario.firstSide })),
    result: { winner, reason, how, endedTurn: state.turn, endedPhase: state.phase, endedAttacker: state.attacker },
    victory,
    control,
    race: raceDoc,
    strength: strengthDoc,
    dice,
    luck: luckDoc,
    casualties,
    highlights: top,
    createdAt: meta.createdAt,
  };
}
