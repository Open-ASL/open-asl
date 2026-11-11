import type { RuleModule } from '@asl/engine';

/*
 * Roads treated as Open Ground by SSR (LMA5 SSR 3: "The ground is covered with snow; roads are treated as Open
 * Ground"). A road hex is Open Ground already in every other respect (SK1 1.1.1), so what goes is the road movement
 * rate: no Infantry road bonus (`MoveState.roadOnly` starts false) and a vehicle moving along a road pays the Open
 * Ground rate (1 MP fully tracked, 3 an Armored Car), through a Woods-Road hex too. Infantry entering a Woods-Road hex
 * along the road still pay 1 MF there, the Open Ground rate.
 */

export const ROADS_OPEN_GROUND_MODULE = 'roads-open-ground';

export const roadsOpenGroundModule: RuleModule = {
  id: 'ssr.roads-open-ground',
  summary: 'Roads are treated as Open Ground (SSR): no road movement rate or Infantry road bonus.',
  requires: ['sk1.movement'],
  install(r) {
    r.contribute({
      id: 'ssr.roads-open-ground.rate',
      query: 'move.roadRate',
      label: 'roads are Open Ground (SSR)',
      apply: () => false,
    });
  },
};
