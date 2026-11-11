import type { RuleModule } from '@asl/engine';
import { gunsModule, revealBase } from './guns';
import { ordnanceModule } from './ordnance';
import { manhandleModule } from './manhandle';
import { hipModule } from './hip';
import { elevationModule } from './elevation';

export * from './status';
export * from './arc';
export * from './guns';
export * from './ordnance';
export * from './ammo';
export * from './manhandle';
export * from './hip';
export * from './hiddenUnits';
export * from './ssr';
export * from './elevation';
export * from './attackDrm';

/**
 * ASL Starter Kit #2 rules: Guns and the To Hit process, crews, emplacement, manhandling, Hidden
 * Initial Placement, hills. Installed on top of the SK1 modules for scenarios that need them.
 */
export const sk2CoreModules: RuleModule[] = [gunsModule, revealBase, ordnanceModule, manhandleModule, hipModule, elevationModule];
