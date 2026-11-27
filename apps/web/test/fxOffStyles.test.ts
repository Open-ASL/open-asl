import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
/** The declarations of the rule whose selector list starts with `selector`. */
const rule = (selector: string) => css.slice(css.indexOf(selector)).split('}')[0]!;

describe('FX off and reduced motion stop animations instead of speeding them up', () => {
  it('cut every animation to one instant iteration, so an infinite pulse cannot cycle on every frame', () => {
    for (const sel of ['.fx-off *, .fx-off *::before', '*, *::before, *::after {']) {
      expect(rule(sel)).toMatch(/animation-duration: 0\.01ms !important/);
      expect(rule(sel)).toMatch(/animation-iteration-count: 1 !important/);
    }
  });

  it('switch the board glow and the attention pulses off', () => {
    expect(rule('.fx-off .your-call, .fx-off .board-glow, .fx-off .hud .end-btn.attention')).toMatch(/animation: none/);
  });
});
