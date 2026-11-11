/**
 * Redacted views of a game.
 *
 * A viewer (one side, or a spectator) must not learn what the rules hide from it (hidden Guns, concealed
 * stacks, secret designations). The full state and the recording stay on the server; each viewer gets a
 * redacted snapshot after every action, plus that action's events made safe for it. Most events are safe
 * as they are; one that would not apply cleanly to the redacted state (it names a hidden piece, or carries a
 * whole secret `ext` slice) is replaced by a `view.patch` event holding the difference between the two
 * redacted snapshots. Events therefore stay one-to-one with the real ones (same `seq`), so decision ids
 * (`d<seq+1>`) and the clients' event-folding animations keep working on the redacted stream.
 */
import type { Draft } from 'immer';
import type { Decision, GameResult, GameState, HexId, Piece, PieceId, RngState, Scalar } from './types';

/** The difference between two redacted snapshots, applied as one event. */
export interface ViewPatch {
  turn?: number;
  phase?: string;
  attacker?: string;
  result?: GameResult | null;
  rng?: RngState;
  /** The whole stack when it changed. */
  decisions?: Decision[];
  pieces?: { set?: Record<PieceId, Piece>; del?: PieceId[] };
  hexMarkers?: { set?: Record<HexId, Record<string, Scalar>>; del?: HexId[] };
  ext?: { set?: Record<string, unknown>; del?: string[] };
}

/** Structural equality: object keys in any order, arrays in order, `undefined` properties as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

function diffRecord<T>(a: Record<string, T>, b: Record<string, T>): { set?: Record<string, T>; del?: string[] } | undefined {
  const set: Record<string, T> = {};
  const del: string[] = [];
  for (const [k, v] of Object.entries(b)) if (!deepEqual(a[k], v)) set[k] = v;
  for (const k of Object.keys(a)) if (!(k in b)) del.push(k);
  if (Object.keys(set).length === 0 && del.length === 0) return undefined;
  return { ...(Object.keys(set).length ? { set } : {}), ...(del.length ? { del } : {}) };
}

/** What changes `a` into `b`, apart from `seq` (the event that carries the patch bumps it). */
export function diffStates(a: GameState, b: GameState): ViewPatch {
  const patch: ViewPatch = {};
  if (a.turn !== b.turn) patch.turn = b.turn;
  if (a.phase !== b.phase) patch.phase = b.phase;
  if (a.attacker !== b.attacker) patch.attacker = b.attacker;
  if (!deepEqual(a.result, b.result)) patch.result = b.result;
  if (!deepEqual(a.rng, b.rng)) patch.rng = b.rng;
  if (!deepEqual(a.decisions, b.decisions)) patch.decisions = b.decisions;
  const pieces = diffRecord(a.pieces, b.pieces);
  if (pieces) patch.pieces = pieces;
  const hexMarkers = diffRecord(a.hexMarkers, b.hexMarkers);
  if (hexMarkers) patch.hexMarkers = hexMarkers;
  const ext = diffRecord(a.ext, b.ext);
  if (ext) patch.ext = ext;
  return patch;
}

export function applyPatch(d: Draft<GameState>, p: ViewPatch): void {
  if (p.turn !== undefined) d.turn = p.turn;
  if (p.phase !== undefined) d.phase = p.phase;
  if (p.attacker !== undefined) d.attacker = p.attacker;
  if (p.result !== undefined) d.result = p.result;
  if (p.rng !== undefined) d.rng = p.rng;
  if (p.decisions !== undefined) d.decisions = p.decisions as Draft<Decision>[];
  for (const id of p.pieces?.del ?? []) delete d.pieces[id];
  for (const [id, piece] of Object.entries(p.pieces?.set ?? {})) d.pieces[id] = piece as Draft<Piece>;
  for (const h of p.hexMarkers?.del ?? []) delete d.hexMarkers[h];
  for (const [h, m] of Object.entries(p.hexMarkers?.set ?? {})) d.hexMarkers[h] = m;
  for (const k of p.ext?.del ?? []) delete d.ext[k];
  for (const [k, v] of Object.entries(p.ext?.set ?? {})) d.ext[k] = v;
}

/** Does `payload` mention any of these ids as a whole JSON string value or key? */
export function mentionsAny(payload: unknown, ids: Iterable<string>): boolean {
  const list = [...ids];
  if (list.length === 0) return false;
  const json = JSON.stringify(payload);
  if (json === undefined) return false;
  return list.some((id) => json.includes(JSON.stringify(id)));
}
