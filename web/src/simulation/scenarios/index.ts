/**
 * 场景注册表
 *
 * 集中管理所有场景模块，按 ScenarioId 索引。
 * 新增场景只需在此文件注册即可。
 */

import type { ScenarioId, ScenarioModule, ScenarioTemplate } from '../types';
import { singleRunModule } from './singleRun';
import { itemCompareModule } from './itemCompare';
import { freeExperimentModule } from './freeExperiment';
import { growthCurveModule } from './growthCurve';
import { killThresholdModule } from './killThreshold';

const modules: Record<ScenarioId, ScenarioModule> = {
  'single-run': singleRunModule,
  'item-compare': itemCompareModule,
  'free-experiment': freeExperimentModule,
  'growth-curve': growthCurveModule,
  'kill-threshold': killThresholdModule,
};

export function getScenarioModule(id: ScenarioId): ScenarioModule {
  return modules[id];
}

export function getAllTemplates(): ScenarioTemplate[] {
  return Object.values(modules).map((m) => m.template);
}

export function getAllModules(): ScenarioModule[] {
  return Object.values(modules);
}
