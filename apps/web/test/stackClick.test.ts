import { describe, expect, it } from 'vitest';
import { keepsTicks } from '../src/game/stackClick';

describe('a click on an own stack and the units ticked in its Stack card', () => {
  const stack = ['squadA', 'squadB', 'leader'];

  it('a second click on the stack shown keeps a partial selection, so an order goes to the units still ticked', () => {
    expect(keepsTicks(new Set(['squadB']), stack, { shift: false, sameHex: true })).toBe(true);
  });

  it('a click on another stack, a shift-click, or a stack with nothing ticked picks the whole stack up', () => {
    expect(keepsTicks(new Set(['squadB']), stack, { shift: false, sameHex: false })).toBe(false);
    expect(keepsTicks(new Set(['squadB']), stack, { shift: true, sameHex: true })).toBe(false);
    expect(keepsTicks(new Set(), stack, { shift: false, sameHex: true })).toBe(false);
    expect(keepsTicks(new Set(['elsewhere']), stack, { shift: false, sameHex: true })).toBe(false);
  });
});
