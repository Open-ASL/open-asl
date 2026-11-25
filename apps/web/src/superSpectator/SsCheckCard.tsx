import { killChance, type LosView, type OrdnanceView, type ShotView } from './checks';

const pct = (p: number) => (p <= 0 ? '0%' : p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const hexName = (h: string) => h.replace(/^[a-z]+/, '');

/** The card of a LOS check, over the board where the stream shows it. */
export function SsLosCard({ from, to, view }: { from: string; to: string; view: LosView }) {
  const { trace } = view;
  return (
    <div className="ss-card" role="status">
      <div className="ss-card-head">
        <span className="ss-card-kicker">Line of sight</span>
        <b>
          {hexName(from)} → {hexName(to)}
        </b>
      </div>
      <div className={`ss-verdict ${trace.clear ? 'ok' : 'bad'}`}>{trace.clear ? (trace.hindrance ? `Clear · +${trace.hindrance} hindrance` : 'Clear') : 'Blocked'}</div>
      {!trace.clear && trace.blockedBy && <p className="ss-card-line">{trace.blockedBy}</p>}
      {trace.clear &&
        trace.parts.map((p, i) => (
          <p key={i} className="ss-card-line">
            {signed(p.drm)} {p.label}
          </p>
        ))}
    </div>
  );
}

/** The card of a shot check: the attack, its DRM, the chance of any effect, and what it may do to each unit there. */
export function SsShotCard({ target, view, sideName }: { target: string; view: ShotView; sideName(side: string): string }) {
  const { odds } = view;
  const targets = view.targets.filter((t) => odds.units[t.id]);
  return (
    <div className="ss-card wide" role="status">
      <div className="ss-card-head">
        <span className="ss-card-kicker">
          {sideName(view.side)} · {view.modeLabel}
        </span>
        <b>At {hexName(target)}</b>
      </div>
      {view.error ? (
        <p className="ss-card-line bad">{view.error}</p>
      ) : (
        <>
          <div className="ss-stats">
            <div>
              <span>FP</span>
              <b>{view.fp}</b>
            </div>
            <div>
              <span>Column</span>
              <b>{view.column ?? '—'}</b>
            </div>
            <div>
              <span>DRM</span>
              <b>{signed(view.drm)}</b>
            </div>
            <div className="big">
              <span>PTC or better</span>
              <b>{pct(odds.effect)}</b>
            </div>
          </div>
          {(view.fpNotes.length > 0 || view.drmNotes.length > 0) && (
            <p className="ss-card-line">{[...view.fpNotes, ...view.drmNotes].join(' · ')}</p>
          )}
          {odds.results.length > 0 && (
            <div className="ss-results">
              {odds.results.map((r) => (
                <span key={r.label}>
                  {r.label} <b>{pct(r.p)}</b>
                </span>
              ))}
            </div>
          )}
          {targets.length > 0 && (
            <table className="ss-odds">
              <thead>
                <tr>
                  <th />
                  <th>Break</th>
                  <th>Pin</th>
                  <th>Reduce</th>
                  <th>Elim</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => {
                  const u = odds.units[t.id]!;
                  return (
                    <tr key={t.id}>
                      <td>
                        {t.label}
                        {t.unitDrm.length > 0 && <small> {t.unitDrm.join(', ')}</small>}
                      </td>
                      <td>{pct(u.broken)}</td>
                      <td>{pct(u.pinned)}</td>
                      <td>{pct(u.reduced)}</td>
                      <td>{pct(u.elim)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {view.leftOut.map((l) => (
            <p key={l} className="ss-card-line muted">
              {l}
            </p>
          ))}
          {view.illegal && <p className="ss-card-line muted">In play now: {view.illegal}</p>}
        </>
      )}
    </div>
  );
}

/** The card of an ordnance shot: the To Hit number and DRM, the chance to hit, and at a vehicle the chance to kill it. */
export function SsOrdnanceCard({ target, view, sideName }: { target: string; view: OrdnanceView; sideName(side: string): string }) {
  const TT: Record<string, string> = { ITT: 'Infantry Target', ATT: 'Area Target', VTT: 'Vehicle Target' };
  return (
    <div className="ss-card wide" role="status">
      <div className="ss-card-head">
        <span className="ss-card-kicker">
          {sideName(view.side)} · {view.modeLabel} · {TT[view.targetType] ?? view.targetType}
        </span>
        <b>
          {view.weapon} at {hexName(target)}
        </b>
      </div>
      {view.error ? (
        <p className="ss-card-line bad">{view.error}</p>
      ) : (
        <>
          <div className="ss-stats">
            <div>
              <span>To Hit</span>
              <b>{view.th}</b>
            </div>
            <div>
              <span>DRM</span>
              <b>{signed(view.drm)}</b>
            </div>
            <div className="big">
              <span>Hit</span>
              <b>{pct(view.hit)}</b>
            </div>
            <div>
              <span>Critical</span>
              <b>{pct(view.ch)}</b>
            </div>
          </div>
          {view.parts.length > 0 && <p className="ss-card-line">{view.parts.join(' · ')}</p>}
          {!view.los.clear && <p className="ss-card-line bad">No LOS: {view.los.blockedBy}</p>}
          {view.tk && view.tk.tk !== null && (
            <table className="ss-odds">
              <thead>
                <tr>
                  <th />
                  <th>Front</th>
                  <th>Side</th>
                  <th>Rear</th>
                </tr>
              </thead>
              <tbody>
                {(['hull', 'turret'] as const).map((loc) => (
                  <tr key={loc}>
                    <td>
                      Kill if hit, {loc} <small>TK {view.tk!.tk}</small>
                    </td>
                    {(['front', 'side', 'rear'] as const).map((f) => (
                      <td key={f}>{view.tk![loc][f] === undefined ? '—' : pct(killChance(view.tk!.tk!, view.tk![loc][f]!, f))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view.illegal && <p className="ss-card-line muted">In play now: {view.illegal}</p>}
        </>
      )}
    </div>
  );
}
