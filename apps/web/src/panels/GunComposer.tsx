import type { ThPreview } from '../game/ordnance';

interface Props {
  /** The Gun's name and the manning unit's. */
  gunLabel: string;
  mannedBy: string | null;
  targetType: string;
  /** The ammunition announced ("HE", "Smoke"…) and its Depletion Number when limited (SK4 6.2). */
  ammo: string | null;
  depletion?: number;
  intensive: boolean;
  /** A Light Mortar (SK4 4.5): possessed rather than manned, no Covered Arc. */
  light?: boolean;
  /** A LATW: its Critical Hit is an original 2 that hits, as on the Area Target Type (SK4 6.1). */
  chOnOriginal2?: boolean;
  target: string | null;
  preview: ThPreview | null;
  /** The "fire group" preview when the Gun fires IFE (shown by the ordinary preview). */
  onCancel(): void;
  /** Fire at the previewed target (the Area Target Type may fire at any hex, SK4 6.11). */
  onFire?(): void;
  /** Leaders in the weapon's hex, each with why he may not modify its To Hit DR (null: he may). */
  leaders?: { id: string; label: string; why: string | null }[];
  /** The leader directing the shot, if any. */
  director?: string;
  onDirector?(id: string | null): void;
}

/** The side panel while a Gun is lined up: its target type, the To Hit number and the DRM a shot would take. */
export function GunComposer({ gunLabel, mannedBy, targetType, ammo, depletion, intensive, light, chOnOriginal2, target, preview, onCancel, onFire, leaders, director, onDirector }: Props) {
  return (
    <div className="composer gun-composer">
      <div className="row">
        <span>Firing</span>
        <b>{gunLabel}{mannedBy ? <span className="muted"> · {light ? 'possessed' : 'manned'} by {mannedBy}</span> : null}</b>
      </div>
      <div className="row">
        <span>Target type</span>
        <b>{targetType}{intensive ? ' · Intensive Fire' : ''}</b>
      </div>
      {ammo && (
        <div className="row">
          <span>Ammunition</span>
          <b>
            {ammo}
            {depletion !== undefined && <span className="muted"> · depletion {depletion}: the Gun has it on an original TH DR below {depletion}, this shot only on {depletion}, never above</span>}
          </b>
        </div>
      )}
      {onDirector && <DirectorPicker leaders={leaders ?? []} {...(director ? { director } : {})} onDirector={onDirector} />}
      {target && (
        <div className="row">
          <span>Target</span>
          <b>{target}</b>
        </div>
      )}
      {preview && targetType !== 'IFE' && (
        <div className="preview">
          <div className="big">
            TH <b>{preview.th ?? '—'}</b>{preview.red ? <span className="muted"> (red)</span> : null} · DRM {preview.drm >= 0 ? '+' : ''}
            {preview.drm}
            {preview.hitOn !== null && (
              <span className="muted">
                {' '}
                · hits on a DR ≤ {preview.hitOn}
                {/* On the Area Target Type a Critical Hit is an original 2 that hits (SK4 6.1). */}
                {targetType === 'ATT' || chOnOriginal2 ? (preview.hitOn >= 2 ? ', Critical Hit on an original 2' : '') : preview.ch !== null ? `, Critical Hit ≤ ${preview.ch - preview.drm}` : ''}
              </span>
            )}
          </div>
          {preview.caChange > 0 && <div className="muted">The Gun turns {preview.caChange} hexspine{preview.caChange === 1 ? '' : 's'} to bear first</div>}
          {targetType === 'VTT' && preview.tk === null && !preview.illegal && <div className="error">No enemy vehicle there to aim at</div>}
          {preview.tk && (
            <div className="tk">
              <div>
                <b>{preview.tk.target}</b> · To Kill {preview.tk.tk ?? '—'}{preview.tk.tk !== null ? ' (rear +1, Critical Hit ×2) less the Armor Factor hit' : ''}
              </div>
              <div className="muted">
                Hull AF front {preview.tk.hull.front} · side {preview.tk.hull.side} · rear {preview.tk.hull.rear}
                {preview.tk.turretType !== 'NT' ? ` · Turret AF front ${preview.tk.turret.front} · side ${preview.tk.turret.side} · rear ${preview.tk.turret.rear}` : ''}
              </div>
              {preview.tk.tk !== null && (
                <div className="muted">
                  Final TK vs hull front {preview.tk.tk - preview.tk.hull.front} / side {preview.tk.tk - preview.tk.hull.side}
                  {preview.tk.turretType !== 'NT' ? ` · turret front ${preview.tk.tk - preview.tk.turret.front} / side ${preview.tk.tk - preview.tk.turret.side}` : ''}: a TK DR below kills, equal Immobilizes (hull) or Shocks (turret)
                </div>
              )}
            </div>
          )}
          <div className="muted">{[...preview.parts, 'LOS and hindrances are checked when you fire'].join(' · ')}</div>
          {preview.illegal && <div className="error">{preview.illegal}</div>}
        </div>
      )}
      {preview && targetType === 'IFE' && preview.illegal && <div className="error">{preview.illegal}</div>}
      {onFire && target && preview && !preview.illegal && (
        <button className="primary" onClick={onFire}>
          Fire at {target}
        </button>
      )}
      <p className="hint wheel-hint">
        {targetType === 'ATT'
          ? 'Click the target hex (any hex: the Area Target Type needs no enemy there), then Fire, or right-click it: '
          : targetType === 'VTT'
            ? 'Click the hex of the enemy vehicle to fire (or right-click it: '
            : 'Click the enemy hex to fire (or right-click it: '}
        <b>Fire at this hex</b>).{chOnOriginal2 && targetType !== 'VTT' ? ' Only Infantry in a building, or a Gun, may be targeted. ' : chOnOriginal2 ? ' ' : light ? ' ' : ' A target outside the Covered Arc turns the Gun first, at a To Hit cost. '}
        <a onClick={onCancel}>Cancel</a>
      </p>
    </div>
  );
}

/**
 * "Directed by": the leaders in the firer's hex who may modify an ordnance SW's To Hit DR (ASL A7.531), and those
 * who may not, greyed out with the reason, so a missing option explains itself. Nothing for a Gun, which no leader
 * directs.
 */
export function DirectorPicker({ leaders, director, onDirector }: { leaders: { id: string; label: string; why: string | null }[]; director?: string; onDirector(id: string | null): void }) {
  const shown = leaders.filter((l) => !l.why || !/never a Gun/.test(l.why));
  if (!shown.length) return null;
  return (
    <div className="row">
      <span>Directed by</span>
      <b className="delay-ctl">
        <button className={`ghost small ${!director ? 'active' : ''}`} onClick={() => onDirector(null)}>
          no leader
        </button>
        {shown.map((l) => (
          <button
            key={l.id}
            className={`ghost small ${director === l.id ? 'active' : ''}`}
            disabled={!!l.why}
            onClick={() => onDirector(l.id)}
            title={l.why ?? 'His leadership DRM modifies the To Hit DR; he directs no other fire this phase'}
          >
            {l.label}
          </button>
        ))}
      </b>
    </div>
  );
}
