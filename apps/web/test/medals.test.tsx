// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Medals } from '../src/profile/Medals';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(el: ReturnType<typeof createElement>): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  reactAct(() => root!.render(el));
  return host;
}
afterEach(() => {
  reactAct(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const awarded = (id: string, day: string) => ({ id, awardedAt: new Date(day) }) as { id: 'moh'; awardedAt: Date };

describe('the ribbon rack', () => {
  it('wears only the ribbons earned, highest precedence on top, the short row first', () => {
    const el = mount(createElement(Medals, { profile: { medals: [awarded('cib', '2026-09-01'), awarded('puc', '2026-10-01'), awarded('silver-star', '2026-10-10'), awarded('moh', '2026-10-28')] } }));
    const rows = [...el.querySelectorAll('.rack-row')].map((row) => [...row.querySelectorAll('.ribbon-btn')].map((b) => b.getAttribute('title')));
    expect(rows).toEqual([['Medal of Honor'], ['Silver Star', 'Presidential Unit Citation', 'Combat Infantryman Badge']]);
    expect(el.textContent).not.toContain('Purple Heart');
    expect(el.textContent).not.toContain('Reach a rating');
  });
  it('opens the citation with the award date when a ribbon is clicked', () => {
    const el = mount(createElement(Medals, { profile: { medals: [awarded('silver-star', '2026-10-28T12:00:00')] } }));
    reactAct(() => (el.querySelector('.ribbon-btn') as HTMLButtonElement).click());
    const text = document.body.textContent ?? '';
    expect(text).toContain('Silver Star');
    expect(text).toContain('Win three matches against other players in a row.');
    expect(text).toContain('Awarded October 28, 2026');
  });
  it('says so when nothing has been earned yet', () => {
    const el = mount(createElement(Medals, { profile: { medals: [] } }));
    expect(el.textContent).toContain('No decorations yet');
    expect(el.querySelector('.rack')).toBeNull();
  });
});
