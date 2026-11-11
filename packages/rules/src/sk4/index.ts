import type { RuleModule } from '@asl/engine';
import { concealmentModule } from './concealment';
import { hiddenUnitsModule } from '../sk2/hiddenUnits';
import { japaneseModule } from './japanese';
import { banzaiModule } from './banzai';
import { usmcModule } from './usmc';
import { setupDeployModule } from '../sk1/setupDeploy';

/**
 * Starter Kit #4, chapter 8 (the Pacific): PTO Terrain, Concealment, the Japanese, the U.S. Marine Corps. Installed
 * on top of the SK1–SK3 modules as the 'asl-sk4' ruleset (packages/content `rulesetFor`), so the earlier rulesets
 * keep their version hashes. Modules land here step by step (plan: Complete the Starter Kits, 2026-11-08).
 */
// Hidden units are core in SK4 (the Japanese 10%, SK4 8.1.8.5): a card's `hidden-units` SSR then only adds its parameters.
export const sk4CoreModules: RuleModule[] = [concealmentModule, hiddenUnitsModule, setupDeployModule, japaneseModule, banzaiModule, usmcModule];
export * from './data/ptoTerrain';
export * from './pto';
export * from './status';
export * from './concealment';
export * from './japanese';
export * from './banzai';
export * from './usmc';
export * from './onceDr';
export * from './caves';
