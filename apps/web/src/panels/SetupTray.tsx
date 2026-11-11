import type { DragEvent } from 'react';
import type { HexId, Piece, PieceId, QueryEnv } from '@asl/engine';
import { defOf } from '@asl/rules';
import { counterImage } from '../game/assets';
import { pieceLabel } from '../game/describe';
import { DRAG_TYPE } from '../board/BoardView';

/** One card-style group of counters: the force's heading, its setup instruction and its pieces. */
export interface TrayGroup {
  key: string;
  /** The card's heading for the group, e.g. "Elements of 919th Grenadier Regiment". */
  label: string;
  /** Where these counters may go, e.g. "Enter on Turn 1 along the west edge". */
  rule: string;
  pieces: Piece[];
}

interface Props {
  env: QueryEnv;
  title: string;
  hint: string;
  /** Everything to place: units and their support weapons alike, each a counter of its own. */
  todo: Piece[];
  /**
   * Scenario-provided layout: counters grouped the way the card groups them. When absent the
   * tray shows one flat list (unplaced, then placed).
   */
  groups?: TrayGroup[] | null;
  /** Where each placed counter sits (a weapon: the hex of the unit it was given to). */
  pending: Record<PieceId, HexId>;
  picked: PieceId | null;
  onPick(id: PieceId | null): void;
  onUnplace(id: PieceId): void;
  /** Extra words for a placed counter's tooltip, e.g. which unit carries a placed weapon. */
  note?(id: PieceId): string | null;
  /** The other player's tray, watched as they set up: nothing can be picked up, dragged or taken back. */
  readOnly?: boolean;
}

/** Drop target for counters dragged back from the board or the Placed list. */
const acceptDrag = (e: DragEvent) => {
  if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
};

/**
 * "Units to place": counters the player drags (or clicks, then clicks a hex) onto the board.
 * Placed counters stay listed with their hex so they can be taken back. Support weapons are
 * counters like any other: dropped in a hex, they are carried by a unit of their group there.
 */
export function SetupTray({ env, title, hint, todo, groups, pending, picked, onPick, onUnplace, note, readOnly }: Props) {
  const left = todo.filter((p) => !pending[p.id]);
  const placed = todo.filter((p) => pending[p.id]);
  const counter = (p: Piece) => {
    // A weapon that begins the scenario malfunctioned (an SSR) shows its flipped side, as on the map.
    const img = counterImage(p.defId, p.tags['malf'] === true);
    const extra = pending[p.id] ? (note?.(p.id) ?? null) : null;
    return (
      <button
        key={p.id}
        className={`tray-counter ${picked === p.id ? 'picked' : ''} ${pending[p.id] ? 'placed' : ''}`}
        title={`${pieceLabel(env, p)}${p.tags['malf'] === true ? ' (malfunctioned)' : ''}${pending[p.id] ? ` — in ${pending[p.id]}${extra ? ` ${extra}` : ''}${readOnly ? '' : '; drag to move, or click the hex label to take back'}` : readOnly ? ' — not placed yet' : ''}`}
        draggable={!readOnly}
        onDragStart={(e) => {
          if (readOnly) return;
          e.dataTransfer.setData(DRAG_TYPE, p.id);
          e.dataTransfer.effectAllowed = 'move';
          onPick(p.id);
        }}
        onClick={() => !readOnly && onPick(picked === p.id ? null : p.id)}
      >
        {img ? <img src={img} alt={pieceLabel(env, p)} draggable={false} /> : <span className="noimg">{defOf(env, p).kind}</span>}
        {pending[p.id] && readOnly && <span className="tray-hex static">{pending[p.id]}</span>}
        {pending[p.id] && !readOnly && (
          <span
            className="tray-hex"
            role="button"
            title="Take back"
            onClick={(e) => {
              e.stopPropagation();
              onUnplace(p.id);
            }}
          >
            {pending[p.id]} ×
          </span>
        )}
      </button>
    );
  };
  return (
    <div
      className={`tray ${readOnly ? 'readonly' : ''}`}
      data-setup-tray={readOnly ? undefined : true}
      onDragOver={readOnly ? undefined : acceptDrag}
      onDrop={
        readOnly
          ? undefined
          : (e) => {
              const id = e.dataTransfer.getData(DRAG_TYPE);
              if (id && pending[id]) {
                e.preventDefault();
                onUnplace(id);
              }
            }
      }
    >
      <h4>
        {title} <span className="muted">({placed.length}/{todo.length} placed)</span>
      </h4>
      <p className="muted small">{hint}</p>
      {groups && groups.length > 0 ? (
        // Card layout: each group under its own heading and instruction; placed counters stay
        // in their group (dimmed, with their hex) so the group reads like the card throughout.
        groups.map((g) => {
          const done = g.pieces.filter((p) => pending[p.id]).length;
          return (
            <section key={g.key} className={`tray-group ${done === g.pieces.length ? 'done' : ''}`}>
              <div className="tray-group-head">
                <span className="tray-group-label">{g.label}</span>
                <span className="tray-group-count">
                  {done}/{g.pieces.length}
                </span>
              </div>
              <div className="tray-group-rule small">{g.rule}</div>
              <div className="tray-grid">{g.pieces.map(counter)}</div>
            </section>
          );
        })
      ) : (
        <>
          {left.length === 0 && <div className="tray-empty small muted">{readOnly ? 'All placed' : 'All placed — drag a counter here to take it back'}</div>}
          {left.length > 0 && <div className="tray-grid">{left.map(counter)}</div>}
          {placed.length > 0 && (
            <>
              <div className="small muted">Placed</div>
              <div className="tray-grid">{placed.map(counter)}</div>
            </>
          )}
        </>
      )}
      {groups && groups.length > 0 && left.length === 0 && (
        <div className="tray-empty small muted">{readOnly ? 'All placed' : 'All placed — drag a counter here to take it back'}</div>
      )}
    </div>
  );
}
