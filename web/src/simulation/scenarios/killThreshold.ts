/**
 * 斩杀线场景（实验性）
 *
 * 通过二分敌方生命值，寻找某动作模型可击杀的最高血量。
 * 首期只允许在当前 Wasm 已支持的动作模型内使用。
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

/**
 * 斩杀线使用枚举策略：在指定 HP 范围内均匀取样。
 * 前端根据结果找到击杀/未击杀的边界。
 */
function generateHpSweepVariants(range: { minHp: number; maxHp: number }, steps = 10): VariantSpec[] {
  const variants: VariantSpec[] = [];
  const step = (range.maxHp - range.minHp) / steps;
  for (let i = 0; i <= steps; i++) {
    const hp = Math.round(range.minHp + step * i);
    variants.push({
      key: `hp_${hp}`,
      label: `HP=${hp}`,
      xValue: hp,
    });
  }
  return variants;
}

export const killThresholdModule: ScenarioModule = {
  template: {
    id: 'kill-threshold',
    title: '斩杀线',
    description: '通过枚举敌方生命值，寻找某动作模型可击杀的最高血量。实验性功能。',
    status: 'experimental',
    requiredCapabilities: ['basic_attack', 'cast_skill'],
    resultViews: ['summary-cards', 'comparison-chart', 'damage-breakdown', 'input-snapshot'],
  },

  buildVariants(draft: SimulationDraft): VariantSpec[] {
    const range = draft.killThresholdRange ?? { minHp: 500, maxHp: 3000 };
    return generateHpSweepVariants(range, 10);
  },

  buildRunInput(draft: SimulationDraft, variant: VariantSpec, bundle: GameDataBundle): EngineRunInput {
    const base = buildBaseRunInput(draft, bundle);

    // 设置敌方 HP 覆盖
    if (variant.xValue != null) {
      if (!base.overrides) base.overrides = {};
      if (!base.overrides.enemy) base.overrides.enemy = {};
      base.overrides.enemy.baseStats = {
        ...base.overrides.enemy.baseStats,
        hp: variant.xValue,
      };
    }

    return base;
  },

  interpretResults(results: VariantResult[]): InterpretedResult {
    if (results.length === 0) {
      return { summaryCards: [], chartSeries: [], comparisonRows: [] };
    }

    // 找到击杀边界
    const sortedByHp = [...results].sort(
      (a, b) => (a.variant.xValue ?? 0) - (b.variant.xValue ?? 0)
    );

    const killable = sortedByHp.filter((vr) => vr.output.result.stopReason === 'enemyDead');
    const notKillable = sortedByHp.filter((vr) => vr.output.result.stopReason !== 'enemyDead');

    const maxKillableHp = killable.length > 0
      ? Math.max(...killable.map((vr) => vr.variant.xValue ?? 0))
      : 0;
    const minNotKillableHp = notKillable.length > 0
      ? Math.min(...notKillable.map((vr) => vr.variant.xValue ?? 0))
      : 0;

    const summaryCards = [
      { label: '采样点数', value: results.length },
      {
        label: '斩杀线（估计）',
        value: maxKillableHp > 0 ? maxKillableHp : '未找到',
        unit: maxKillableHp > 0 ? 'HP' : undefined,
        highlight: 'positive' as const,
      },
      { label: '可击杀数', value: killable.length, highlight: 'positive' as const },
      { label: '不可击杀数', value: notKillable.length, highlight: 'negative' as const },
    ];

    // 伤害 vs 敌方HP曲线
    const damageSeries: ChartSeries = {
      name: '总伤害',
      data: sortedByHp.map((vr) => ({
        x: vr.variant.xValue ?? 0,
        y: Math.round(vr.output.result.totalDamageToEnemy),
      })),
      color: '#165dff',
    };

    const hpLine: ChartSeries = {
      name: '敌方HP（对角线）',
      data: sortedByHp.map((vr) => ({
        x: vr.variant.xValue ?? 0,
        y: vr.variant.xValue ?? 0,
      })),
      color: '#f53f3f',
    };

    return {
      summaryCards,
      chartSeries: [damageSeries, hpLine],
      comparisonRows: buildComparisonRows(results),
    };
  },
};
