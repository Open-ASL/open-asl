import type { RuleModule } from '@asl/engine';
import { SK1_PHASES } from './status';

/** SK1 3.0: the eight phases of a Player Turn. */
export const phasesModule: RuleModule = {
  id: 'sk1.phases',
  ref: 'SK1 3.0',
  requires: ['common.turn'],
  install(r) {
    r.contribute({
      id: 'sk1.phases.list',
      query: 'turn.phases',
      layer: 0,
      apply: () => [...SK1_PHASES],
    });
  },
};
