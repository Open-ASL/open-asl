import type { Piece, QueryEnv, SideId } from '@asl/engine';
import { afvLeadTally, areaVp, mmcLost, victoryLeaves, vpTally, type VpTallyItem, type AreaVpUnit, casualties, losFirepower, type LosFirepowerUnit, cvpThresholds, exitVp, vehicleExitVp, exitVpCondition, exitedPieces, type Casualty, type ScenarioDef, type Statics, type VictoryCondition, clearAreasTally, squadEquivalentsLost, type ClearAreaState } from '@asl/rules';
import { counterImage } from '../game/assets';
import { defLabel, NATION } from '../game/describe';
import { Modal } from '../ui/Modal';

interface Props {
  env: QueryEnv;
  scenario: ScenarioDef;
  /** The side whose tally was clicked: shown first. */
  first: SideId;
  sideName(s: SideId): string;
  onClose(): void;
}

/** A side's victory point tally: exited VP, or casualty VP, with the goal its conditions set. */
export type SideTally =
  /** `armor`: the part of the exit VP the card wants from AFV (S30), scored and required. */
  | { kind: 'vp'; points: number; goal?: number; effect?: 'wins' | 'denies'; armor?: { points: number; goal: number } }
  | { kind: 'cvp'; points: number; goal?: number; effect?: 'wins' | 'denies' }
  /** The AFV race of an `afvLead` condition (S21): enemy AFV eliminated plus own AFV exited, against own AFV lost. */
  | { kind: 'afv'; points: number; eliminated: number; exited: number; lost: number; countsExits: boolean }
  /** The FP a `losFirepower` condition (S22) counts now: Good Order units seeing the hexes, against its goal. */
  | { kind: 'fp'; points: number; goal: number; units: LosFirepowerUnit[]; label: string }
  /** The VP of a `goodOrderVp` condition (S17): Good Order Infantry in the area now, against its goal. */
  | { kind: 'area'; points: number; goal: number; units: AreaVpUnit[]; label: string }
  /**
   * MMC a side has lost, where a condition compares them (LMA5: "having lost fewer MMC than the German player"):
   * `other` is the other side's count; `wins` marks the side that needs fewer.
   */
  | { kind: 'mmc'; points: number; other: number; wins: boolean }
  /** VP summed from the card's sources (S32: Controlled building hexes, eliminated ART Guns), against its game-end goal. */
  | { kind: 'points'; points: number; goal: number; items: VpTallyItem[] }
  /**
   * Areas to clear of Good Order enemy units, condition by condition (LMA7: 3 of the 4 hills of each board), and the
   * squad equivalents each side has lost when the side must also lose fewer.
   */
  | { kind: 'areas'; groups: { label: string; clear: number; need: number; areas: ClearAreaState[] }[]; lost?: { mine: number; theirs: number } };

/** A goal as shown: '?' while a roll still has to set it (S20's Chart 1). */
export const goalText = (goal: number): string => (Number.isFinite(goal) ? String(goal) : '?');

/** A side's casualty victory points: the enemy losses it has amassed, as a total and goal. */
export function cvpTally(env: QueryEnv, scenario: ScenarioDef, side: SideId): { points: number; goal?: number; effect?: 'wins' | 'denies' } {
  const enemy = scenario.sides.find((s) => s.side !== side)?.side ?? side;
  const points = casualties(env, enemy).reduce((a, c) => a + c.vp, 0);
  // The lowest threshold is the one that matters first.
  const goal = cvpThresholds(scenario, env)
    .filter((t) => t.side === side)
    .sort((a, b) => a.cvp - b.cvp)[0];
  return goal ? { points, goal: goal.cvp, effect: goal.effect } : { points };
}

/**
 * The tally a side's victory conditions turn on, or null when they turn on neither: exit VP for
 * a side that wins by exiting victory points, casualty VP where a CVP condition names the side.
 */
export function sideTally(env: QueryEnv, scenario: ScenarioDef, side: SideId): SideTally | null {
  const exit = exitVpCondition(scenario, side);
  if (exit)
    return { kind: 'vp', points: exitVp(env, side), goal: exit.vp, effect: 'wins', ...(exit.afvVpAtLeast !== undefined ? { armor: { points: vehicleExitVp(env, side), goal: exit.afvVpAtLeast } } : {}) };
  const afv = scenario.victory.find((v): v is Extract<VictoryCondition, { kind: 'afvLead' }> => v.kind === 'afvLead' && v.side === side);
  if (afv) {
    const t = afvLeadTally(env, afv);
    return { kind: 'afv', points: t.eliminated + t.exited, ...t, countsExits: !!afv.exitedCountAsEliminated };
  }
  const fp = scenario.victory.find((v): v is Extract<VictoryCondition, { kind: 'losFirepower' }> => v.kind === 'losFirepower' && v.side === side);
  if (fp) {
    const t = losFirepower(env, fp);
    return { kind: 'fp', points: t.total, goal: fp.fp, units: t.units, label: fp.hexesLabel ?? 'hexes' };
  }
  const area = scenario.victory.find((v): v is Extract<VictoryCondition, { kind: 'goodOrderVp' }> => v.kind === 'goodOrderVp' && v.side === side);
  if (area) {
    const t = areaVp(env, area);
    return { kind: 'area', points: t.total, goal: area.vp, units: t.units, label: area.hexesLabel ?? 'area' };
  }
  const sum = scenario.victory.find((v): v is Extract<VictoryCondition, { kind: 'vpTally' }> => v.kind === 'vpTally' && v.side === side);
  if (sum) {
    const t = vpTally(env, sum);
    return { kind: 'points', points: t.total, goal: sum.vp, items: t.items };
  }
  const fewer = victoryLeaves(scenario).find((v): v is Extract<VictoryCondition, { kind: 'fewerMmcLost' }> => v.kind === 'fewerMmcLost');
  if (fewer) {
    const other = scenario.sides.find((s) => s.side !== side)?.side ?? side;
    return { kind: 'mmc', points: mmcLost(env, side).length, other: mmcLost(env, other).length, wins: fewer.side === side };
  }
  const clear = victoryLeaves(scenario).filter((v): v is Extract<VictoryCondition, { kind: 'clearAreas' }> => v.kind === 'clearAreas' && v.side === side);
  if (clear.length) {
    const enemy = scenario.sides.find((s) => s.side !== side)?.side ?? side;
    const losses = victoryLeaves(scenario).some((v) => v.kind === 'fewerLosses' && v.side === side);
    return {
      kind: 'areas',
      groups: clear.map((vc) => {
        const t = clearAreasTally(env, vc);
        return { label: vc.areasLabel ?? 'areas', clear: t.clear, need: vc.atLeast, areas: t.areas };
      }),
      ...(losses ? { lost: { mine: squadEquivalentsLost(env, side), theirs: squadEquivalentsLost(env, enemy) } } : {}),
    };
  }
  const cvp = cvpTally(env, scenario, side);
  return cvp.goal !== undefined ? { kind: 'cvp', ...cvp } : null;
}

const pieceName = (p: Piece) => p.defId.replace(/^[a-z]+\./, '');

/** Squad equivalents as a mixed number: 1½, ½, 2. */
export const fmtSe = (n: number): string => (n % 1 ? `${Math.floor(n) || ''}½` : String(n));

/** The chits behind each side's CVP total: every enemy unit eliminated or Casualty Reduced, with when and how. */
export function CasualtyLedger({ env, scenario, first, sideName, onClose }: Props) {
  const counters = (env.statics as Statics).counters;
  const sides = [...scenario.sides].sort((a, b) => Number(b.side === first) - Number(a.side === first));
  const row = (c: Casualty, i: number) => {
    const d = counters[c.defId];
    const img = counterImage(c.defId, false);
    const what = c.kind === 'reduced' ? `${d ? defLabel(d) : c.defId} Casualty Reduced to a half-squad` : d ? defLabel(d) : c.defId;
    return (
      <li key={`${c.unit}-${i}`} className={`ledger-row side-${c.side}`}>
        {img ? <img src={img} alt="" width={36} height={36} draggable={false} /> : <span className="noimg" />}
        <span className="what">
          <span className={`nat nat-${d?.nationality ?? c.side}`}>{NATION[d?.nationality ?? c.side] ?? c.side}</span> {what}
          <span className="meta">
            Turn {c.turn} {c.phase} · {c.reason}
          </span>
        </span>
        <span className="vp">+{c.vp}</span>
      </li>
    );
  };
  /** An exited unit and the victory points it took off the map. */
  const exitRow = (p: Piece) => {
    const d = counters[p.defId];
    const img = counterImage(p.defId, false);
    const vp = env.query('vp.exit', { unit: p.id }, 0);
    return (
      <li key={p.id} className={`ledger-row side-${p.side}`}>
        {img ? <img src={img} alt="" width={36} height={36} draggable={false} /> : <span className="noimg" />}
        <span className="what">
          <span className={`nat nat-${d?.nationality ?? p.side}`}>{NATION[d?.nationality ?? p.side] ?? p.side}</span> {d ? defLabel(d) : p.defId}
          <span className="meta">exited</span>
        </span>
        <span className="vp">+{vp}</span>
      </li>
    );
  };
  const shown = sides.map((s) => ({ side: s.side, tally: sideTally(env, scenario, s.side) })).filter((x): x is { side: SideId; tally: SideTally } => !!x.tally);
  const anyVp = shown.some((x) => x.tally.kind === 'vp');
  const anyAfv = shown.some((x) => x.tally.kind === 'afv');
  const anyFp = shown.some((x) => x.tally.kind === 'fp');
  const anyArea = shown.some((x) => x.tally.kind === 'area' || x.tally.kind === 'points');
  const anyMmc = shown.some((x) => x.tally.kind === 'mmc');
  const anyClear = shown.some((x) => x.tally.kind === 'areas');
  return (
    <Modal title={anyClear ? 'Objectives and losses' : anyMmc ? 'MMC lost' : anyAfv ? 'AFV losses' : anyFp ? 'Firepower on the objective' : anyVp || anyArea ? 'Victory points' : 'Casualty victory points'} kicker="Ledger" onClose={onClose} wide>
      <div className="ledger">
        {shown.map(({ side, tally }) => {
          if (tally.kind === 'vp') {
            const out = exitedPieces(env, side);
            return (
              <section key={side} className={`ledger-side side-${side}`}>
                <h3>
                  <span className="sw" /> {sideName(side)}
                </h3>
                <div className="total">
                  <b>{tally.points}</b> VP
                  {tally.goal !== undefined && <span className={`goal ${tally.points >= tally.goal ? 'reached' : ''}`}>wins at {tally.goal}</span>}
                </div>
                <p className="muted small">Victory points exited off the map by the {sideName(side)} side.</p>
                {out.length === 0 ? <p className="ledger-empty">Nothing has exited yet.</p> : <ul className="ledger-rows">{out.map(exitRow)}</ul>}
              </section>
            );
          }
          if (tally.kind === 'mmc') {
            const lost = mmcLost(env, side);
            return (
              <section key={side} className={`ledger-side side-${side}`}>
                <h3>
                  <span className="sw" /> {sideName(side)}
                </h3>
                <div className="total">
                  <b>{tally.points}</b> MMC lost
                  {tally.wins && <span className={`goal ${tally.points < tally.other ? 'reached' : ''}`}>must stay under the other side's {tally.other}</span>}
                </div>
                <p className="muted small">{sideName(side)} squads, half-squads and crews eliminated (a Casualty Reduction to a half-squad is not an MMC lost).</p>
                {lost.length === 0 ? <p className="ledger-empty">No MMC lost yet.</p> : <ul className="ledger-rows">{lost.map(row)}</ul>}
              </section>
            );
          }
          if (tally.kind === 'points') {
            return (
              <section key={side} className={`ledger-side side-${side}`}>
                <h3>
                  <span className="sw" /> {sideName(side)}
                </h3>
                <div className="total">
                  <b>{tally.points}</b> VP
                  <span className={`goal ${tally.points >= tally.goal ? 'reached' : ''}`}>wins at game end with {tally.goal}</span>
                </div>
                <ul className="ledger-rows">
                  {tally.items.map((i) => (
                    <li key={i.label} className={`ledger-row side-${side}`}>
                      <span className="noimg" />
                      <span className="what">
                        {i.ids.length} × {i.label}
                        <span className="meta">{i.each} VP each{i.ids.length ? ` · ${i.ids.map((h) => (env.state.pieces[h] ? pieceName(env.state.pieces[h]!) : h.replace(/^[a-z]/, ''))).join(', ')}` : ''}</span>
                      </span>
                      <span className="vp">{i.vp}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          }
          if (tally.kind === 'area') {
            return (
              <section key={side} className={`ledger-side side-${side}`}>
                <h3>
                  <span className="sw" /> {sideName(side)}
                </h3>
                <div className="total">
                  <b>{tally.points}</b> VP
                  <span className={`goal ${tally.points >= tally.goal ? 'reached' : ''}`}>wins at game end with {tally.goal}</span>
                </div>
                <p className="muted small">Good Order infantry {tally.label}: a squad or crew 2 VP, a half-squad 1, a leader 1 plus 1 for each minus modifier.</p>
                {tally.units.length === 0 ? (
                  <p className="ledger-empty">No Good Order unit is there.</p>
                ) : (
                  <ul className="ledger-rows">
                    {tally.units.map((u) => {
                      const p = env.state.pieces[u.unit]!;
                      const d = counters[p.defId];
                      const img = counterImage(p.defId, false);
                      return (
                        <li key={u.unit} className={`ledger-row side-${side}`}>
                          {img ? <img src={img} alt="" width={36} height={36} draggable={false} /> : <span className="noimg" />}
                          <span className="what">
                            {d ? defLabel(d) : p.defId}
                            <span className="meta">in {u.hex.replace(/^[a-z]/, '')}</span>
                          </span>
                          <span className="vp">{u.vp}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          }
          if (tally.kind === 'fp') {
            return (
              <section key={side} className={`ledger-side side-${side}`}>
                <h3>
                  <span className="sw" /> {sideName(side)}
                </h3>
                <div className="total">
                  <b>{tally.points}</b> FP
                  <span className={`goal ${tally.points >= tally.goal ? 'reached' : ''}`}>wins at game end with {tally.goal}</span>
                </div>
                <p className="muted small">Good Order units with a LOS to the {tally.label}, each with the best attack it could make on one of them.</p>
                {tally.units.length === 0 ? (
                  <p className="ledger-empty">No unit sees the {tally.label}.</p>
                ) : (
                  <ul className="ledger-rows">
                    {tally.units.map((u) => {
                      const p = env.state.pieces[u.unit]!;
                      const d = counters[p.defId];
                      const img = counterImage(p.defId, false);
                      return (
                        <li key={u.unit} className={`ledger-row side-${side}`}>
                          {img ? <img src={img} alt="" width={36} height={36} draggable={false} /> : <span className="noimg" />}
                          <span className="what">
                            {d ? defLabel(d) : p.defId}
                            <span className="meta">vs {u.target.replace(/^[a-z]/, '')}</span>
                          </span>
                          <span className="vp">{u.fp}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          }
          if (tally.kind === 'areas') {
            const enemy = scenario.sides.find((x) => x.side !== side)?.side ?? side;
            return (
              <section key={side} className={`ledger-side side-${side}`}>
                <h3>
                  <span className="sw" /> {sideName(side)}
                </h3>
                {tally.groups.map((g) => (
                  <div key={g.label}>
                    <div className="total">
                      <b>{g.clear}</b> of {g.areas.length} {g.label} clear
                      <span className={`goal ${g.clear >= g.need ? 'reached' : ''}`}>needs {g.need} at game end</span>
                    </div>
                    <ul className="ledger-rows">
                      {g.areas.map((a) => (
                        <li key={a.label} className={`ledger-row side-${a.clear ? side : enemy}`}>
                          <span className="noimg" />
                          <span className="what">
                            {a.label}
                            <span className="meta">
                              {a.clear
                                ? `no Good Order ${sideName(enemy)} unit`
                                : `held by ${a.holders.map((id) => (env.state.pieces[id] ? `${pieceName(env.state.pieces[id]!)} in ${String((env.state.pieces[id]!.loc as { hex?: string }).hex ?? '').replace(/^[a-z]/, '')}` : id)).join(', ')}`}
                            </span>
                          </span>
                          <span className="vp">{a.clear ? '✔' : '✖'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {tally.lost && (
                  <>
                    <div className="total">
                      <b>{fmtSe(tally.lost.mine)}</b> squad equivalents lost
                      <span className={`goal ${tally.lost.mine < tally.lost.theirs ? 'reached' : ''}`}>must be fewer than the {sideName(enemy)}’s {fmtSe(tally.lost.theirs)}</span>
                    </div>
                    <p className="muted small">A squad counts 1, a half-squad or crew ½; a squad Casualty Reduced has lost ½. Leaders and weapons do not count.</p>
                    {(() => {
                      const lostRows = [...casualties(env, side), ...casualties(env, enemy)].filter((c) => ['squad', 'hs', 'crew'].includes(counters[c.defId]?.kind ?? ''));
                      return lostRows.length === 0 ? <p className="ledger-empty">No squad lost yet.</p> : <ul className="ledger-rows">{lostRows.map((c, i) => row({ ...c, vp: c.kind === 'reduced' || counters[c.defId]?.kind !== 'squad' ? 0.5 : 1 }, i))}</ul>;
                    })()}
                  </>
                )}
              </section>
            );
          }
          const s = { side };
          const enemy = scenario.sides.find((x) => x.side !== s.side)?.side ?? s.side;
          const lost = casualties(env, enemy);
          if (tally.kind === 'afv') {
            const out = tally.countsExits ? exitedPieces(env, side) : [];
            return (
              <section key={s.side} className={`ledger-side side-${s.side}`}>
                <h3>
                  <span className="sw" /> {sideName(s.side)}
                </h3>
                <div className="total">
                  <b>{tally.points}</b> AFV
                  <span className={`goal ${tally.points > tally.lost ? 'reached' : ''}`}>against {tally.lost} lost · wins with more</span>
                </div>
                <p className="muted small">
                  {sideName(enemy)} AFV eliminated by the {sideName(s.side)} side{tally.countsExits ? `, and ${sideName(s.side)} AFV exited (each counts as an eliminated enemy AFV)` : ''}.
                </p>
                {lost.length === 0 && out.length === 0 ? <p className="ledger-empty">No losses yet.</p> : <ul className="ledger-rows">{[...lost.map(row), ...out.map(exitRow)]}</ul>}
              </section>
            );
          }
          return (
            <section key={s.side} className={`ledger-side side-${s.side}`}>
              <h3>
                <span className="sw" /> {sideName(s.side)}
              </h3>
              <div className="total">
                <b>{tally.points}</b> CVP
                {tally.goal !== undefined && (
                  <span className={`goal ${tally.points >= tally.goal ? 'reached' : ''}`}>
                    {tally.effect === 'wins' ? `wins at ${goalText(tally.goal)}` : `denies the ${sideName(enemy)} win at ${goalText(tally.goal)}`}
                  </span>
                )}
              </div>
              <p className="muted small">{sideName(enemy)} losses, scored by the {sideName(s.side)} side.</p>
              {lost.length === 0 ? <p className="ledger-empty">No casualties yet.</p> : <ul className="ledger-rows">{lost.map(row)}</ul>}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
