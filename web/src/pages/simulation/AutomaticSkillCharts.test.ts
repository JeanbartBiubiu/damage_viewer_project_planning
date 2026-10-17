import { describe, expect, it } from 'vitest';
import { continuousAttackChartOption } from './ContinuousAttackCharts';
import { initialAutomaticSkillView } from '../../engine/automaticSkillPresentation';
import type { SeriesPoint } from '../../types/genericEngine';

const point = (timeMs: number): SeriesPoint => ({ timeMs, sourceHp: 500, targetHp: 400, sourceDamageDealt: 100, targetDamageDealt: 0,
  sourceCumulativeDps: 1000, targetCumulativeDps: 0, sourceWindowDps: 100, targetWindowDps: 0 });
const base = { attacks: [], durationMs: 200, killedAtMs: null, dpsWindowMs: 1000,
  onSelectAttack: () => {}, onRangeChange: () => {}, onHover: () => {} };

describe('自动结果复用真实采样图', () => {
  it('三个面板共用真实区间，事实标记不吸附采样网格，起点伤害率不补值', () => {
    const view = initialAutomaticSkillView(200); view.timeRangeMs = [50, 150];
    const option = continuousAttackChartOption({ ...base, points: [point(0), point(100), point(200)], view,
      markers: [{ key: 'automatic:1', timeMs: 77, label: '技能开始', color: '#165dff', selected: true }] });
    const series = option.series as Array<{ id: string; data: unknown[] }>;
    expect(series.find(row => row.id === 'sourceDps')?.data).toEqual([[0, null], [100, 1000], [200, 1000]]);
    expect(series.find(row => row.id === 'sourceHp')?.data).toEqual([[0, 500], [100, 500], [200, 500]]);
    expect(series.find(row => row.id === 'combat-facts')?.data).toMatchObject([{ markerKey: 'automatic:1', value: [77, 0], symbolSize: 16 }]);
    expect(option.dataZoom).toMatchObject([{ xAxisIndex: [0, 1, 2], startValue: 50, endValue: 150 }, { startValue: 50, endValue: 150 }]);
  });
  it('纯主动零毫秒结束只保留一个原点；伤害率切换及图例不改原采样', () => {
    const points = [point(0)]; const view = initialAutomaticSkillView(0); view.dpsMode = 'window'; view.visibleCurves = ['sourceDps'];
    const option = continuousAttackChartOption({ ...base, durationMs: 0, points, view });
    const series = option.series as Array<{ id: string; data: unknown[] }>;
    expect(series.find(row => row.id === 'sourceDps')?.data).toEqual([[0, null]]);
    expect(series.find(row => row.id === 'sourceHp')?.data).toEqual([]);
    expect(series.find(row => row.id === 'combat-facts')).toBeUndefined();
    expect(points).toEqual([point(0)]);
  });
});
