// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PhaseWheel, resetWheel } from '../src/fx/PhaseWheel';
import type { WheelCue } from '../src/fx/useGameFx';

const PHASES = ['RPh', 'PFPh', 'MPh', 'DFPh', 'AFPh', 'RtPh', 'APh', 'CCPh'] as const;
const NAMES: Record<string, string> = { ru: 'Russian', ge: 'German' };

const banner = (cue: Pick<WheelCue, 'kind' | 'phase'>) => {
  resetWheel();
  const host = document.createElement('div');
  const full = { id: 1, turn: 4, side: 'ru', defender: 'ge', ...cue } as WheelCue;
  host.innerHTML = renderToStaticMarkup(createElement(PhaseWheel, { cue: full, phases: PHASES, sideName: (s: string) => NAMES[s] ?? s, level: 'full', onDone: () => {} }));
  const who = host.querySelector('.pw-banner .who')!;
  return { who: who.textContent, whoClass: who.className, what: host.querySelector('.pw-banner .what')!.textContent, sub: host.querySelector('.pw-banner .sub')?.textContent ?? null };
};

describe('phase wheel banner', () => {
  it('names the DEFENDER for the Defensive Fire Phase, his fire in the ATTACKER’s player turn (SK1 3.4)', () => {
    const b = banner({ kind: 'phase', phase: 'DFPh' });
    expect(b.who).toBe('German');
    expect(b.whoClass).toContain('side-ge');
    expect(b.what).toBe('Defensive Fire');
    expect(b.sub).toBe('Russian player turn');
  });

  it('names the ATTACKER for his own phases', () => {
    for (const phase of ['PFPh', 'MPh', 'AFPh', 'CCPh']) {
      const b = banner({ kind: 'phase', phase });
      expect(b.who, phase).toBe('Russian');
      expect(b.sub, phase).toBeNull();
    }
  });
});
