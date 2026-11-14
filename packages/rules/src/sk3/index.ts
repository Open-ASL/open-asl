import type { RuleModule } from '@asl/engine';
import { vehiclesModule } from './vehicles';
import { vehicleScenarioModule } from './scenario';
import { vehicleMoveModule } from './vehicleMove';
import { vehicleStatusModule } from './vehicleStatus';
import { toKillModule } from './toKill';
import { vehicleFireModule } from './vehicleFire';
import { wrecksModule } from './wrecks';
import { vehicleMgModule } from './vehicleMg';
import { paatcModule } from './paatc';
import { vehicleCcModule } from './vehicleCc';
import { infantryVsAfvModule } from './infantryVsAfv';
import { openToppedModule } from './openTopped';

export * from './status';
export * from './vehicles';
export * from './scenario';
export * from './cvpValues';
export * from './vehicleMove';
export * from './vehicleStatus';
export * from './facing';
export * from './toKill';
export * from './shotOutlook';
export * from './vehicleFire';
export * from './wrecks';
export * from './vehicleMg';
export * from './paatc';
export * from './vehicleCc';
export * from './infantryVsAfv';
export * from './openTopped';
export * from './radioless';
export * from './panzerfaust';
export * from './noAfvBuildings';
export * from './immobilizationDr';
export * from './digIn';
export * from './mpLimit';
export * from './ssrAttacks';

/**
 * ASL Starter Kit #3 rules: vehicles. The Panzerfaust module (`panzerfaustModule`) is added only for
 * scenarios where a PF may be fired, so the other SK3 scenarios keep their ruleset version hash. Installed on top of the SK1 and SK2 modules for scenarios
 * that field them.
 */
export const sk3CoreModules: RuleModule[] = [vehiclesModule, vehicleMoveModule, vehicleStatusModule, toKillModule, vehicleFireModule, vehicleMgModule, wrecksModule, paatcModule, vehicleCcModule, infantryVsAfvModule, openToppedModule, vehicleScenarioModule];
