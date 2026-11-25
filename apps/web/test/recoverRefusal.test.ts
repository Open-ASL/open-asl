import { describe, expect, it } from 'vitest';
import { recoverRefusal } from '../src/game/recoverRefusal';

/**
 * A loose weapon none of the units here may recover keeps a greyed Recover entry with the engine's reasons (a SMC may
 * never carry more than 2 PP, SK4 4.0), rather than vanishing from the wheel; one a unit may take is offered.
 */
describe('the greyed Recover entry', () => {
  it('names the reason when every unit is refused, each reason once', () => {
    expect(recoverRefusal(['A SMC may never carry more than 2 PP'])).toBe('A SMC may never carry more than 2 PP');
    expect(recoverRefusal(['A SMC may never carry more than 2 PP', 'A SMC may never carry more than 2 PP', 'Not enough MF left'])).toBe(
      'A SMC may never carry more than 2 PP; Not enough MF left',
    );
  });

  it('is no refusal when a unit may take it, or when there is no unit to ask', () => {
    expect(recoverRefusal(['A SMC may never carry more than 2 PP', null])).toBeNull();
    expect(recoverRefusal([])).toBeNull();
  });
});
