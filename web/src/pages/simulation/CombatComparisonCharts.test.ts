import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SeriesPoint } from '../../types/genericEngine';
import { CombatComparisonCharts, combatComparisonChartOption, combatComparisonTooltip } from './CombatComparisonCharts';

type ComparisonRun = Parameters<typeof combatComparisonChartOption>[0];
const point = (timeMs: number, targetHp: number, sourceDamageDealt: number, sourceCumulativeDps: number): SeriesPoint => ({
  timeMs, sourceHp: 1_000, targetHp, sourceDamageDealt, targetDamageDealt: 0,
  sourceCumulativeDps, targetCumulativeDps: 0, sourceWindowDps: 0, targetWindowDps: 0
});

const a: ComparisonRun = {
  summary: { durationMs: 1_200, stopReason: 'target_dead', targetFinalHp: 0, sourceDamageDealt: 500 },
  series: [point(0, 500, 0, 0), point(1_000, 300, 200, 200), point(1_200, 0, 500, 417)],
  seriesSamplingEvidence: { method: 'uniform_time', requestedSampleEveryMs: 400, effectiveSampleEveryMs: 1_000,
    requestedPointCount: 4, finalPointCount: 3, maxSeriesPoints: 3, downsampled: true }
};
const b: ComparisonRun = {
  summary: { durationMs: 2_000, stopReason: 'duration_reached', targetFinalHp: 100, sourceDamageDealt: 400 },
  series: [point(0, 500, 0, 0), point(800, 420, 80, 100), point(1_600, 260, 240, 150), point(2_000, 100, 400, 200)],
  seriesSamplingEvidence: { method: 'uniform_time', requestedSampleEveryMs: 800, effectiveSampleEveryMs: 800,
    requestedPointCount: 4, finalPointCount: 4, maxSeriesPoints: 5, downsampled: false }
};

describe('双方案采样图', () => {
  it('三组曲线共用时间窗，各自保留真实末点且 0 毫秒伤害率为空', () => {
    const option = combatComparisonChartOption(a, b);
    expect(option?.xAxis).toMatchObject([{ min: 0, max: 2_000 }, { min: 0, max: 2_000 }, { min: 0, max: 2_000 }]);
    expect(option?.series.map(({ id, xAxisIndex, data, connectNulls }) => [id, xAxisIndex, data, connectNulls])).toEqual([
      ['a-targetHp', 0, [[0, 500], [1_000, 300], [1_200, 0]], false],
      ['b-targetHp', 0, [[0, 500], [800, 420], [1_600, 260], [2_000, 100]], false],
      ['a-sourceDamageDealt', 1, [[0, 0], [1_000, 200], [1_200, 500]], false],
      ['b-sourceDamageDealt', 1, [[0, 0], [800, 80], [1_600, 240], [2_000, 400]], false],
      ['a-sourceCumulativeDps', 2, [[0, null], [1_000, 200], [1_200, 417]], false],
      ['b-sourceCumulativeDps', 2, [[0, null], [800, 100], [1_600, 150], [2_000, 200]], false]
    ]);
  });

  it('合法关闭采样时隐藏三组曲线并说明汇总与来源比较仍有效', () => {
    const disabled: ComparisonRun = { ...a, series: [],
      seriesSamplingEvidence: { ...a.seriesSamplingEvidence, method: 'disabled', effectiveSampleEveryMs: 0,
        requestedPointCount: 0, finalPointCount: 0, downsampled: false } };
    expect(combatComparisonChartOption(disabled, disabled)).toBeNull();
    expect(combatComparisonChartOption(a, disabled)).toBeNull();
    const html = renderToStaticMarkup(createElement(CombatComparisonCharts, { a: disabled, b: disabled }));
    expect(html).toContain('完整汇总指标与来源贡献对比仍有效');
    expect(html).not.toContain('role="img"');
  });

  it('分别展示请求间隔、有效间隔、返回点数、候选点数和降采样状态', () => {
    const html = renderToStaticMarkup(createElement(CombatComparisonCharts, { a, b }));
    expect(html).toContain('方案 A');
    expect(html).toContain('请求间隔 400 毫秒，有效间隔 1,000 毫秒，返回 3 / 4 点，已降采样');
    expect(html).toContain('方案 B');
    expect(html).toContain('请求间隔 800 毫秒，有效间隔 800 毫秒，返回 4 / 4 点，未降采样');
  });

  it('采样网格不对齐时分别显示最近的真实时刻和数值', () => {
    expect(combatComparisonTooltip(a, b, 1_100)).toBe(
      '方案 A（采样 1,000 毫秒）\n目标生命 300 / 累计造成伤害 200\n累计平均伤害率 200\n\n'
      + '方案 B（采样 800 毫秒）\n目标生命 420 / 累计造成伤害 80\n累计平均伤害率 100');
  });

  it('停止时刻保留真实末点，越过停止时刻后提示原因和最终数值', () => {
    expect(combatComparisonTooltip(a, b, 1_200)).toContain('方案 A（采样 1,200 毫秒）');
    const tip = combatComparisonTooltip(a, b, 1_201);
    expect(tip).toContain('方案 A 已于 1,200 毫秒停止（目标生命归零）\n最终生命 0 / 累计造成伤害 500');
    expect(tip).not.toContain('方案 A（采样');
    expect(tip).toContain('方案 B（采样 1,600 毫秒）');
  });

  it('0 毫秒即停止时显示真实原点，伤害率不适用且没有虚构的后续点', () => {
    const instant: ComparisonRun = { ...a, summary: { ...a.summary, durationMs: 0 }, series: [point(0, 0, 500, 0)] };
    const option = combatComparisonChartOption(instant, instant);
    expect(option?.series[0]).toMatchObject({ data: [[0, 0]], showSymbol: true });
    expect(option?.series[4]).toMatchObject({ data: [[0, null]] });
    expect(combatComparisonTooltip(instant, b, 0)).toContain('方案 A（采样 0 毫秒）\n目标生命 0 / 累计造成伤害 500\n累计平均伤害率 不适用');
    expect(combatComparisonTooltip(instant, b, 1)).toContain('方案 A 已于 0 毫秒停止');
  });
});
