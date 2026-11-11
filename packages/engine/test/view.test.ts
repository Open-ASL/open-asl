import { describe, expect, it } from 'vitest';
import { Engine, applyPatch, buildRuleset, deepEqual, diffStates, seedRng, type Action, type GameEvent, type GameState, type RuleModule } from '../src';
import { produce } from 'immer';

/**
 * A toy game with hidden information: each side may hold pieces tagged `hidden` (the other side must not see
 * them) and a secret number in `ext['toy.secret']`. One action, `act`, rolls once and then emits whatever
 * events the test asks for, so transitions of every shape are easy to build.
 */
const toy: RuleModule = {
  id: 'toy.hidden',
  install(r) {
    r.event<{ id: string; side: string; hex: string; hidden?: boolean }>({
      type: 'toy.place',
      apply(d, p) {
        d.pieces[p.id] = { id: p.id, defId: 'sq', side: p.side, loc: { kind: 'hex', hex: p.hex }, tags: p.hidden ? { hidden: true } : {} };
      },
    });
    r.event<{ id: string; key: string; value: string | number | boolean }>({
      type: 'toy.tag',
      apply(d, p) {
        d.pieces[p.id]!.tags[p.key] = p.value;
      },
    });
    r.event<{ id: string; hex: string }>({
      type: 'toy.move',
      apply(d, p) {
        d.pieces[p.id]!.loc = { kind: 'hex', hex: p.hex };
      },
    });
    r.event<{ side: string; value: number }>({
      type: 'toy.secret',
      apply(d, p) {
        d.ext['toy.secret'] = { side: p.side, value: p.value };
      },
    });
    r.event<{ hex: string; smoke: number }>({
      type: 'toy.marker',
      apply(d, p) {
        d.hexMarkers[p.hex] = { smoke: p.smoke };
      },
    });
    r.redact({
      id: 'toy.secret',
      ext: 'toy.secret',
      redactExt: (slice, viewer) => {
        const s = slice as { side: string; value: number };
        return s.side === viewer ? s : { side: s.side };
      },
      events: ['toy.secret'],
      redactEvent: (ev, viewer) => ((ev.payload as { side: string }).side === viewer ? ev : null),
    });
    r.action<Action & { events: GameEvent[]; roll?: boolean }>({
      type: 'act',
      decisionKinds: ['main'],
      resolve(ctx, a) {
        if (a.roll) ctx.roll('toy');
        for (const ev of a.events) ctx.emit(ev.type, ev.payload);
        ctx.popDecision();
        const other = ctx.state.sides.find((s) => s !== a.side)!;
        ctx.pushDecision({ kind: 'main', owner: other, deadlineClass: 'turn', data: { last: a.events.map((e) => e.type) } });
      },
    });
    r.setup({
      id: 'toy.start',
      run(ctx) {
        ctx.emit('toy.place', { id: 'a1', side: 'A', hex: 'h1' });
        ctx.emit('toy.place', { id: 'a2', side: 'A', hex: 'h2', hidden: true });
        ctx.emit('toy.place', { id: 'b1', side: 'B', hex: 'h5' });
        ctx.emit('toy.secret', { side: 'A', value: 7 });
        ctx.pushDecision({ kind: 'main', owner: 'A', deadlineClass: 'turn' });
      },
    });
  },
};

const engine = new Engine(buildRuleset('toy', [toy]), {});
const DUMMY_RNG = seedRng('view');

/** What `viewer` may see: no enemy hidden pieces, the secret only when it is theirs, and never the dice generator. */
function redactFor(viewer: string | null) {
  return (state: GameState): GameState => {
    const pieces = Object.fromEntries(Object.entries(state.pieces).filter(([, p]) => !(p.tags['hidden'] && p.side !== viewer)));
    const ext = { ...state.ext };
    for (const r of engine.ruleset.redactors) {
      if (r.ext && r.redactExt && ext[r.ext] !== undefined) ext[r.ext] = r.redactExt(ext[r.ext], viewer, engine.env(state));
    }
    return { ...state, pieces, ext, rng: DUMMY_RNG };
  };
}

const start = () => engine.createGame({ scenarioId: 'toy', sides: ['A', 'B'], attacker: 'A', seed: 'seed-1' }).state;
const act = (state: GameState, events: GameEvent[], roll = false) => {
  const d = engine.currentDecision(state)!;
  return engine.submit(state, { type: 'act', side: d.owner, decisionId: d.id, events, roll } as Action);
};

/** The invariant every viewer's stream must satisfy. */
function checkViewer(viewer: string | null, before: GameState, t: { state: GameState; events: GameEvent[] }) {
  const redact = redactFor(viewer);
  const redacted = engine.redactTransition(viewer, redact, before, t.events as never);
  expect(redacted.length).toBe(t.events.length);
  redacted.forEach((ev, i) => expect(ev.seq).toBe((t.events[i] as unknown as { seq: number }).seq));
  // Folding the redacted events over the redacted start gives the redacted end, at every prefix.
  let view = redact(before);
  for (let i = 0; i < redacted.length; i++) {
    view = engine.applyEvents(view, [redacted[i]!]);
    expect(deepEqual(view, redact(engine.applyEvents(before, t.events.slice(0, i + 1))))).toBe(true);
  }
  return redacted;
}

describe('view patches', () => {
  it('diffStates/applyPatch round-trips pieces, markers, ext, decisions and the result', () => {
    const a = start();
    const b = produce(a, (d) => {
      d.pieces['a1']!.tags['pinned'] = true;
      delete d.pieces['a2'];
      d.pieces['c9'] = { id: 'c9', defId: 'sq', side: 'B', loc: { kind: 'hex', hex: 'h9' }, tags: {} };
      d.hexMarkers['h3'] = { smoke: 1 };
      d.ext['toy.secret'] = { side: 'A' };
      d.ext['other'] = [1, 2];
      d.decisions = [{ id: 'd99', kind: 'main', owner: 'B', deadlineClass: 'turn' }];
      d.turn = 3;
      d.phase = 'late';
      d.attacker = 'B';
      d.result = { winner: 'B', reason: 'test' };
      d.seq++;
    });
    const patch = diffStates(a, b);
    expect(patch.pieces?.del).toEqual(['a2']);
    expect(Object.keys(patch.pieces?.set ?? {}).sort()).toEqual(['a1', 'c9']);
    expect(patch.hexMarkers?.set?.['h3']).toEqual({ smoke: 1 });
    expect(Object.keys(patch.ext?.set ?? {}).sort()).toEqual(['other', 'toy.secret']);
    expect(patch.decisions?.[0]?.id).toBe('d99');
    const folded = produce(a, (d) => {
      applyPatch(d, patch);
      d.seq++;
    });
    expect(deepEqual(folded, b)).toBe(true);
    expect(diffStates(b, b)).toEqual({});
  });

  it('deepEqual ignores key order and undefined properties', () => {
    expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('redactTransition', () => {
  it('passes safe events through, dice without the generator state, and the rest as view.patch', () => {
    const s0 = start();
    const t = act(
      s0,
      [
        { type: 'toy.tag', payload: { id: 'a1', key: 'moved', value: true } },
        { type: 'toy.tag', payload: { id: 'a2', key: 'moved', value: true } },
        { type: 'toy.move', payload: { id: 'a2', hex: 'h3' } },
        { type: 'toy.secret', payload: { side: 'A', value: 9 } },
        { type: 'toy.marker', payload: { hex: 'h4', smoke: 2 } },
      ],
      true,
    );
    const forB = checkViewer('B', s0, t);
    const types = forB.map((e) => e.type);
    expect(types).toEqual(['dice.rolled', 'toy.tag', 'view.patch', 'view.patch', 'view.patch', 'toy.marker', 'decision.popped', 'decision.pushed']);
    expect((forB[0]!.payload as { rng?: unknown }).rng).toBeUndefined();
    expect((forB[0]!.payload as { dice: number[] }).dice).toHaveLength(2);
    // The hidden piece's events and A's new secret value became empty patches: nothing B may see changed.
    expect(forB[2]!.payload).toEqual({});
    expect(forB[3]!.payload).toEqual({});
    expect(forB[4]!.payload).toEqual({});
    expect(JSON.stringify(forB)).not.toContain('"a2"');
    expect(JSON.stringify(forB)).not.toContain('"value":9');

    const forA = checkViewer('A', s0, t);
    expect(forA.map((e) => e.type)).toEqual(['dice.rolled', 'toy.tag', 'toy.tag', 'toy.move', 'toy.secret', 'toy.marker', 'decision.popped', 'decision.pushed']);

    const forSpectator = checkViewer(null, s0, t);
    expect(forSpectator.filter((e) => e.type === 'view.patch')).toHaveLength(3);
  });

  it('replaces an event with a patch when the viewer cannot see a piece it names, even if it would apply', () => {
    const s0 = start();
    // An event on a visible piece whose payload quotes the hidden piece's id: it would fold cleanly into B's view,
    // but the raw event is still withheld (the patch carries only what B's snapshot shows anyway).
    const t = act(s0, [{ type: 'toy.tag', payload: { id: 'b1', key: 'seen', value: 'a2' } }]);
    const forB = checkViewer('B', s0, t);
    expect(forB[0]!.type).toBe('view.patch');
    expect(checkViewer('A', s0, t)[0]!.type).toBe('toy.tag');
  });

  it('keeps the fold property over a sequence of transitions for every viewer', () => {
    let state = start();
    const script: GameEvent[][] = [
      [{ type: 'toy.move', payload: { id: 'a1', hex: 'h2' } }],
      [{ type: 'toy.place', payload: { id: 'b2', side: 'B', hex: 'h6', hidden: true } }],
      [{ type: 'toy.tag', payload: { id: 'b2', key: 'cx', value: true } }, { type: 'toy.secret', payload: { side: 'B', value: 3 } }],
      [{ type: 'toy.tag', payload: { id: 'a2', key: 'hidden', value: false } }],
      [{ type: 'toy.marker', payload: { hex: 'h2', smoke: 1 } }],
    ];
    for (const events of script) {
      const t = act(state, events, true);
      for (const viewer of ['A', 'B', null]) checkViewer(viewer, state, t);
      state = t.state;
    }
    // a2 dropped its hidden tag in the fourth step: from then on B sees it (the patch created it in B's view).
    const redactedB = redactFor('B')(state);
    expect(redactedB.pieces['a2']).toBeDefined();
    expect(redactedB.pieces['b2']).toBeDefined();
    expect(redactFor('A')(state).pieces['b2']).toBeUndefined();
  });
});
