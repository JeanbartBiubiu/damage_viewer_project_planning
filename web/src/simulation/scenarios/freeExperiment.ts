/**
 * 自由实验场景
 *
 * 允许用户自由设置不常见的敌我条件（低等级神装、极端抗性等），
 * 本质上与单次模拟相同，但不限制输入校验，鼓励极端测试。
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

export const freeExperimentModule: ScenarioModule = {
  template: {
    id: 'free-experiment',
    title: '自由实验',
    description: '允许自由设置不常见的敌我条件，用于极端输入验证和特殊问题排查。',
    status: 'stable',
    requiredCapabilities: ['basic_attack', 'cast_skill'],
    resultViews: ['summary-cards', 'timeline-chart', 'event-table', 'damage-breakdown', 'input-snapshot'],
  },

  buildVariants(_draft: SimulationDraft): VariantSpec[] {
    return [{ key: 'experiment', label: '实验运行' }];
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

    const chartSeries: ChartSeries[] = [];
    if (vr.output.samples.length > 0) {
      chartSeries.push({
        name: '敌方HP',
        data: vr.output.samples.map((s) => ({ x: s.tMs, y: s.enemyHp })),
        color: '#f53f3f',
      });
      chartSeries.push({
        name: '我方HP',
        data: vr.output.samples.map((s) => ({ x: s.tMs, y: s.selfHp })),
        color: '#00b42a',
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
