import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { entryHexesOf } from '../src';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * A card that names a group's entry hexes ("along the north edge on or west of J10") leaves the hex just
 * beyond them looking like the obvious way in; an offboard hex can even touch it. The refusal quotes the card.
 */

type MapApi = { edge(e: string): string[]; offboard(e: string): { id: string }[]; offboardNeighbors(h: string): { onboard: string[]; offboard: string[] } };
const mapOf = (engine: ReturnType<typeof makeEngine>['engine'], state: GameState) => (engine.env(state) as unknown as { statics: { map: MapApi } }).statics.map;

describe('entering by the hexes the card names', () => {
  const build = (description?: string) => {
    const probe = makeEngine({ pieces: [], scenario: RU_VS_GE, startPhase: 'MPh' });
    const map = mapOf(probe.engine, probe.state);
    const edge = map.edge('N');
    const barred = edge[Math.floor(edge.length / 2)]!;
    const allowed = edge.filter((h) => h !== barred);
    // An offboard hex touching the barred hex and an allowed one beside it.
    const off = map.offboard('N').find((o) => map.offboardNeighbors(o.id).onboard.includes(barred) && map.offboardNeighbors(o.id).onboard.some((h) => allowed.includes(h)))!.id;
    const squad: PieceSpec = { id: 'a', def: 'ru.447', side: 'ru', tags: { force: 0, entryTurn: 1, entryEdge: 'N', entryHexes: allowed.join(',') } };
    const scenario = { ...RU_VS_GE, forces: [{ side: 'ru', units: [{ def: 'ru.447', count: 1 }], setup: { kind: 'enter' as const, turn: 1, edge: 'N', hexes: allowed, ...(description ? { description } : {}) } }] };
    const { engine, state } = makeEngine({ pieces: [squad], scenario, startPhase: 'MPh' });
    const pieces = { a: { ...state.pieces['a']!, loc: { kind: 'offboard' as const, edge: 'N', hex: off } } };
    const s = act(engine, { ...state, pieces }, { type: 'move.start', units: ['a'] }).state;
    return { engine, s, map, off, barred, allowed };
  };

  it('lists the entry hexes the card allows', () => {
    const { engine, s, allowed } = build();
    expect(entryHexesOf(engine.env(s), s.pieces['a']!)).toEqual(allowed);
  });

  it('refuses the hex beyond them in the words of the card', () => {
    const { engine, s, map, off, barred, allowed } = build('Enter on Turn 1 along the north edge on or west of J10 (see SSR 1)');
    expect(() => act(engine, s, { type: 'move.step', to: barred })).toThrow(`${barred} is not one of this group's entry hexes: enter on Turn 1 along the north edge on or west of J10 (see SSR 1)`);
    const inAt = map.offboardNeighbors(off).onboard.find((h) => allowed.includes(h))!;
    expect(act(engine, s, { type: 'move.step', to: inAt }).state.pieces['a']!.loc).toEqual({ kind: 'hex', hex: inAt });
  });

  it('names the edge when the card gives no words', () => {
    const { engine, s, barred } = build();
    expect(() => act(engine, s, { type: 'move.step', to: barred })).toThrow(`${barred} is not one of this group's entry hexes: it enters along the north edge`);
  });

  it('an allowed hex out of reach of the offboard position asks for a move along the edge first', () => {
    const { engine, s, map, off, allowed } = build();
    const far = allowed.find((h) => !map.offboardNeighbors(off).onboard.includes(h))!;
    expect(() => act(engine, s, { type: 'move.step', to: far })).toThrow(/move along the edge first/);
  });
});
