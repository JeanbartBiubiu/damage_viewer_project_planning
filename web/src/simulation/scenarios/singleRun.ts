/**
 * 单次模拟场景
 *
 * 固定敌我配置下执行一次动作模拟，用于快速查看结果。
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
import { buildBaseRunInput, buildSummaryCardsFromSingle, buildComparisonRows } from './helpers';

export const singleRunModule: ScenarioModule = {
  template: {
    id: 'single-run',
    title: '单次模拟',
    description: '在固定敌我配置下执行一次动作模拟，用于快速查看技能或平A的结果。',
    status: 'stable',
    requiredCapabilities: ['basic_attack', 'cast_skill'],
    resultViews: ['summary-cards', 'timeline-chart', 'event-table', 'damage-breakdown', 'input-snapshot'],
  },

  buildVariants(_draft: SimulationDraft): VariantSpec[] {
    return [{ key: 'default', label: '默认运行' }];
  },

  buildRunInput(draft: SimulationDraft, _variant: VariantSpec, bundle: GameDataBundle) {
    return buildBaseRunInput(draft, bundle);
  },

  interpretResults(results: VariantResult[]): InterpretedResult {
    if (results.length === 0) {
      return { summaryCards: [], chartSeries: [], comparisonRows: [] };
    }

    const vr = results[0];
    const summaryCards = buildSummaryCardsFromSingle(vr);

    // 构建时间线图表
    const chartSeries: ChartSeries[] = [];
    if (vr.output.samples.length > 0) {
      chartSeries.push({
        name: '敌方HP',
        data: vr.output.samples.map((s) => ({ x: s.tMs, y: s.enemyHp })),
        color: '#f53f3f',
      });
      chartSeries.push({
        name: '累计伤害',
        data: vr.output.samples.map((s) => ({ x: s.tMs, y: s.cumulativeDamageToEnemy })),
        color: '#165dff',
      });
    }

    return {
      summaryCards,
      chartSeries,
      comparisonRows: buildComparisonRows(results),
    };
  },
};
