/**
 * 装备对比场景
 *
 * 固定敌我条件，只改变装备方案，批量运行后输出多条结果曲线与对比卡片。
 */

import type {
  ScenarioModule,
  SimulationDraft,
  VariantSpec,
  VariantResult,
  InterpretedResult,
  ChartSeries,
} from '../types';
import type { GameDataBundle } from '../../types/api';
import type { EngineRunInput } from '../../engine/types';
import { buildBaseRunInput, buildComparisonRows } from './helpers';
import { ItemComparePanel } from '../components/ItemComparePanel';

export const itemCompareModule: ScenarioModule = {
  template: {
    id: 'item-compare',
    title: '装备对比',
    description: '固定敌我条件，只改变装备方案，批量运行后输出多条结果曲线与对比。',
    status: 'stable',
    requiredCapabilities: ['basic_attack', 'cast_skill'],
    resultViews: ['summary-cards', 'comparison-chart', 'damage-breakdown', 'input-snapshot'],
  },

  buildVariants(draft: SimulationDraft): VariantSpec[] {
    const variants = draft.itemVariants ?? [];
    if (variants.length === 0) {
      // 至少保留当前装备作为基线
      return [{ key: 'baseline', label: '当前装备' }];
    }
    return variants.map((v) => ({
      key: v.key,
      label: v.label,
    }));
  },

  buildRunInput(draft: SimulationDraft, variant: VariantSpec, bundle: GameDataBundle): EngineRunInput {
    const base = buildBaseRunInput(draft, bundle);

    // 查找对应变体的装备
    const itemVariant = draft.itemVariants?.find((v) => v.key === variant.key);
    if (itemVariant) {
      base.initial.self.itemIds = itemVariant.itemIds;
    }

    return base;
  },

  ExtraConfigPanel: ItemComparePanel,

  interpretResults(results: VariantResult[]): InterpretedResult {
    if (results.length === 0) {
      return { summaryCards: [], chartSeries: [], comparisonRows: [] };
    }

    // 找出最优
    const best = results.reduce((a, b) =>
      b.output.result.totalDamageToEnemy > a.output.result.totalDamageToEnemy ? b : a
    );

    const summaryCards = [
      { label: '对比方案数', value: results.length },
      { label: '最高伤害方案', value: best.variant.label, highlight: 'positive' as const },
      { label: '最高伤害', value: Math.round(best.output.result.totalDamageToEnemy), unit: 'dmg' },
    ];

    // 每个变体一条曲线
    const chartSeries: ChartSeries[] = results.map((vr) => ({
      name: vr.variant.label,
      data: vr.output.samples.map((s) => ({ x: s.tMs, y: s.cumulativeDamageToEnemy })),
    }));

    return {
      summaryCards,
      chartSeries,
      comparisonRows: buildComparisonRows(results),
    };
  },
};
