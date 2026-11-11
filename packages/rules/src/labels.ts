import type { GameState, Piece } from '@asl/engine';
import { defOf } from './common/pieces';
import type { CounterDef, ScenarioDef } from './common/statics';
import { gunIdents } from './sk2/status';

/*
 * Names for people: counters, pieces, sides, phases and hexes as the log, the ledger and the
 * after action report write them. Shared by the web app and the Cloud Functions.
 */

const SUPERSCRIPT: Record<number, string> = { 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵' };

export const NATION: Record<string, string> = { ge: 'German', ru: 'Russian', am: 'American', br: 'British', al: 'Allied Minor', it: 'Italian', ax: 'Axis Minor', ja: 'Japanese' };
const NAT_RE = Object.keys(NATION).join('|');

/** The name of a counter nationality the way the scenario card uses it (its Allied Minor counters may be "Greek"). */
export function nationName(env: { statics: unknown }, nationality: string): string {
  const sc = (env.statics as { scenario?: ScenarioDef } | undefined)?.scenario;
  return sc?.nationalityNames?.[nationality] ?? NATION[nationality] ?? nationality;
}

/** A side's name: the card's ("Allied"), else its nationality's. */
export function sideNameOf(env: { statics: unknown }, side: string): string {
  const sc = (env.statics as { scenario?: ScenarioDef } | undefined)?.scenario;
  return sc?.sides.find((s) => s.side === side)?.name ?? NATION[side] ?? side;
}

export const PHASE_NAME: Record<string, string> = {
  setup: 'Setup',
  RPh: 'Rally Phase',
  PFPh: 'Prep Fire Phase',
  MPh: 'Movement Phase',
  DFPh: 'Defensive Fire Phase',
  AFPh: 'Advancing Fire Phase',
  RtPh: 'Rout Phase',
  APh: 'Advance Phase',
  CCPh: 'Close Combat Phase',
};

export function defLabel(d: CounterDef): string {
  switch (d.kind) {
    case 'squad':
    case 'hs':
    case 'crew':
      return `${d.fp}${d.smoke ? SUPERSCRIPT[d.smoke] ?? `^${d.smoke}` : ''}-${d.range}-${d.morale}${d.kind === 'hs' ? ' HS' : d.kind === 'crew' ? ' crew' : ''}`;
    case 'leader':
      return `${d.morale}${d.leadership > 0 ? '+' : '-'}${Math.abs(d.leadership)} leader`;
    case 'sw':
      // A Light Mortar by its caliber, as the chart names it: "50* MTR".
      return d.type === 'MTR' && d.ordnance ? `${d.ordnance.caliber}${d.ordnance.barrel ?? ''} MTR` : d.type;
    case 'gun':
      return `${d.caliber}${d.barrel ?? ''} ${d.type} Gun`;
    case 'vehicle':
      return d.name;
    case 'unknown':
      return d.big ? 'concealed stack (5/8")' : 'concealed stack';
  }
}

export function pieceLabel(env: { statics: unknown; state: GameState }, p: Piece | undefined): string {
  if (!p) return '?';
  const d = defOf(env, p);
  const base = `${nationName(env, d.nationality)} ${defLabel(d)}`;
  // Guns (and vehicles) of one type on a side are told apart by their letter (as on the board), once there are two.
  if ((d.kind === 'gun' || d.kind === 'vehicle') && Object.values(env.state.pieces).filter((q) => q.side === p.side && q.defId === p.defId).length > 1) return `${base} ${gunIdents(env.state, env).get(p.id) ?? ''}`.trim();
  return base;
}

/** A hex id without its board letter, e.g. yN5 → N5; a full ASL Location id names its level, e.g. uK4:1 → K4 level 1. */
export const hexLabel = (hex: string) => {
  const i = hex.indexOf(':');
  if (i < 0) return hex.replace(/^[a-z]/, '');
  const rest = hex.slice(i + 1);
  return `${hex.slice(0, i).replace(/^[a-z]/, '')} ${/^\d+$/.test(rest) ? `level ${rest}` : rest === 'cave' ? 'Cave' : rest}`;
};

/** Where a piece is, for messages: its hex (a held SW: its holder's hex). */
function whereIs(state: GameState, p: Piece): string | null {
  if (p.loc.kind === 'hex' || p.loc.kind === 'offboard') return p.loc.hex ? hexLabel(p.loc.hex) : null;
  if (p.loc.kind === 'held') {
    const by = state.pieces[p.loc.by];
    return by ? whereIs(state, by) : null;
  }
  return null;
}

/** Any dotted token that might be a piece id, e.g. "ge.1.0.ge.467.1" or "ge.1.0.ge.467.1.sw1". */
const ID_RE = /\b[a-z]{2}\.[A-Za-z0-9.]+/g;
const HEX_RE = /\b[a-z]([A-Z]{1,2}\d{1,2})\b/g;

/**
 * Engine messages name pieces by id ("ge.1.0.ge.467.1") and hexes with their board letter
 * ("yN5"). Rewrite them for people: "German 4-6-7 in N5", "N5", nation names for side codes.
 */
export function humanize(env: { statics: unknown; state: GameState }, text: string): string {
  return text
    .replace(ID_RE, (tok) => {
      // A sentence's own full stop may trail the id.
      const id = tok.replace(/\.+$/, '');
      const rest = tok.slice(id.length);
      const p = env.state.pieces[id];
      if (!p) return tok;
      const at = whereIs(env.state, p);
      return (at ? `${pieceLabel(env, p)} in ${at}` : pieceLabel(env, p)) + rest;
    })
    .replace(HEX_RE, (_, h: string) => h)
    .replace(new RegExp(`\\((${NAT_RE})\\)`, 'g'), (_, s: string) => `(${sideNameOf(env, s)})`)
    .replace(new RegExp(`\\bCC (${NAT_RE})\\b`, 'g'), (_, s: string) => `CC: ${sideNameOf(env, s)}`);
}


/** Replace every piece id in a text with the counter's name (no location, unlike humanize). */
export function nameIds(env: { statics: unknown; state: GameState }, text: string): string {
  return text.replace(ID_RE, (tok) => {
    const id = tok.replace(/\.+$/, '');
    const p = env.state.pieces[id];
    return p ? pieceLabel(env, p) + tok.slice(id.length) : tok;
  });
}
