import type { RuleModule } from '@asl/engine';
import { statics } from '../common/pieces';

/*
 * "AFV may not enter a building hex" (S27 SSR 6): a step into a building hex is refused to every
 * vehicle while the scenario lists the rule.
 */

export const NO_AFV_BUILDINGS_MODULE = 'no-afv-buildings';

export const noAfvBuildingsModule: RuleModule = {
  id: 'ssr.no-afv-buildings',
  summary: 'AFV may not enter a building hex (SSR).',
  requires: ['sk3.vehicleMove'],
  install(r) {
    r.contribute({
      id: 'ssr.no-afv-buildings.step',
      query: 'vehicle.stepIllegal',
      layer: 10,
      apply(v, { to }, env) {
        if (v) return v;
        const s = statics(env).scenario.ssr.find((x) => x.module === NO_AFV_BUILDINGS_MODULE);
        if (!s || !statics(env).map.hex(to)?.buildingId) return null;
        return `AFV may not enter a building hex${s?.params?.['rule'] ? ` (${String(s.params['rule'])})` : ' (SSR)'}`;
      },
    });
  },
};
