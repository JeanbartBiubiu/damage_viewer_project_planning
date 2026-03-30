/**
 * 受限成长曲线场景
 *
 * 固定动作模型，沿某一维度做 sweep（等级、装备数量、属性值），
 * 输出伤害随该维度变化的曲线。
 */

import type {
  ScenarioModule,
  SimulationDraft,
  VariantSpec,
  VariantResult,
  InterpretedResult,
  ChartSeries,
  SweepDimension,
} from '../types';
import type { GameDataBundle } from '../../types/api';
import type { EngineRunInput } from '../../engine/types';
import { buildBaseRunInput, buildComparisonRows } from './helpers';
import { GrowthCurvePanel } from '../components/GrowthCurvePanel';

function generateSweepVariants(dim: SweepDimension): VariantSpec[] {
  const variants: VariantSpec[] = [];
  for (let v = dim.from; v <= dim.to; v += dim.step) {
    const rounded = Math.round(v * 100) / 100;
    let label: string;
    switch (dim.axis) {
      case 'level':
        label = `Lv.${rounded}`;
        break;
      case 'item-count':
        label = `${rounded} 件装备`;
        break;
      case 'attribute':
        label = `${dim.attrKey ?? 'attr'}=${rounded}`;
        break;
      default:
        label = `${rounded}`;
    }
    variants.push({ key: `sweep_${rounded}`, label, xValue: rounded });
  }
  return variants;
}

export const growthCurveModule: ScenarioModule = {
  template: {
    id: 'growth-curve',
    title: '受限成长曲线',
    description: '固定动作模型，沿等级/装备/属性维度扫点，输出伤害变化曲线。',
    status: 'stable',
    requiredCapabilities: ['basic_attack', 'cast_skill'],
    resultViews: ['summary-cards', 'comparison-chart', 'input-snapshot'],
  },

  ExtraConfigPanel: GrowthCurvePanel,

  buildVariants(draft: SimulationDraft): VariantSpec[] {
    const dim = draft.sweepDimension;
    if (!dim) {
      return [{ key: 'default', label: '默认', xValue: draft.self.level }];
    }
    return generateSweepVariants(dim);
  },

  buildRunInput(draft: SimulationDraft, variant: VariantSpec, bundle: GameDataBundle): EngineRunInput {
    const base = buildBaseRunInput(draft, bundle);
    const dim = draft.sweepDimension;

    if (dim && variant.xValue != null) {
      switch (dim.axis) {
        case 'level':
          base.initial.self.level = variant.xValue;
          break;
        case 'item-count': {
          // 取前 N 件装备
          const count = Math.min(variant.xValue, draft.self.itemIds.length);
          base.initial.self.itemIds = draft.self.itemIds.slice(0, count);
          break;
        }
        case 'attribute': {
          if (dim.attrKey) {
            if (!base.overrides) base.overrides = {};
            if (!base.overrides.self) base.overrides.self = {};
            base.overrides.self.baseStats = {
              ...base.overrides.self.baseStats,
              [dim.attrKey]: variant.xValue,
            };
          }
          break;
        }
      }
    }

    return base;
  },

  interpretResults(results: VariantResult[]): InterpretedResult {
    if (results.length === 0) {
      return { summaryCards: [], chartSeries: [], comparisonRows: [] };
    }

    // 最高/最低
    const sorted = [...results].sort(
      (a, b) => b.output.result.totalDamageToEnemy - a.output.result.totalDamageToEnemy
    );
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    const summaryCards = [
      { label: '扫描点数', value: results.length },
      { label: '最高伤害', value: Math.round(best.output.result.totalDamageToEnemy), unit: 'dmg' },
      { label: '最高伤害点', value: best.variant.label, highlight: 'positive' as const },
      { label: '最低伤害', value: Math.round(worst.output.result.totalDamageToEnemy), unit: 'dmg' },
    ];

    // 伤害曲线、DPS曲线
    const damageSeries: ChartSeries = {
      name: '总伤害',
      data: results.map((vr) => ({
        x: vr.variant.xValue ?? 0,
        y: Math.round(vr.output.result.totalDamageToEnemy),
      })),
      color: '#165dff',
    };

    const dpsSeries: ChartSeries = {
      name: 'DPS',
      data: results.map((vr) => ({
        x: vr.variant.xValue ?? 0,
        y: vr.output.result.actionDurationMs > 0
          ? Math.round(vr.output.result.totalDamageToEnemy / (vr.output.result.actionDurationMs / 1000))
          : 0,
      })),
      color: '#f77234',
    };

    return {
      summaryCards,
      chartSeries: [damageSeries, dpsSeries],
      comparisonRows: buildComparisonRows(results),
    };
  },
};
