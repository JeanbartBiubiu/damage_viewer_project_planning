import { useEffect, useMemo, useRef } from 'react';
import { init } from 'echarts/core';
import type { TitleComponentOption } from 'echarts/components';
import { formatContinuousAmount as number, initialContinuousView, nearestContinuousPoint } from '../../engine/continuousAttackPresentation';
import type { DoneResult, RunSummary, SeriesSamplingEvidence, StopReason } from '../../types/genericEngine';
import { continuousAttackChartOption } from './ContinuousAttackCharts';
import './CombatComparison.css';

type ComparisonRun = Pick<DoneResult, 'series' | 'seriesSamplingEvidence'> & {
  summary: Pick<RunSummary, 'durationMs' | 'stopReason' | 'targetFinalHp' | 'sourceDamageDealt'>;
};

export const comparisonStopLabels: Record<StopReason, string> = {
  duration_reached: '到达观察终点',
  target_dead: '目标生命归零',
  source_dead: '攻击方死亡',
  both_dead: '双方死亡',
  no_events: '没有后续事件',
  budget_exceeded: '执行预算耗尽'
};

const panels = [
  { field: 'targetHp', label: '目标剩余生命' },
  { field: 'sourceDamageDealt', label: '攻击方累计造成伤害' },
  { field: 'sourceCumulativeDps', label: '攻击方累计平均伤害率' }
] as const;

const plans = [
  { key: 'a', label: '方案 A', color: '#165DFF', lineType: 'solid' },
  { key: 'b', label: '方案 B', color: '#C63256', lineType: 'dashed' }
] as const;

function combatComparisonSamplingLabel(evidence: SeriesSamplingEvidence) {
  if (evidence.method === 'disabled') return '未记录时间序列';
  return `请求间隔 ${number(evidence.requestedSampleEveryMs)} 毫秒，有效间隔 ${number(evidence.effectiveSampleEveryMs)} 毫秒，`
    + `返回 ${number(evidence.finalPointCount)} / ${number(evidence.requestedPointCount)} 点，${evidence.downsampled ? '已降采样' : '未降采样'}`;
}

export function combatComparisonTooltip(a: ComparisonRun, b: ComparisonRun, timeMs: number) {
  return [a, b].map(({ series, summary }, index) => {
    const { label } = plans[index];
    if (timeMs > summary.durationMs) {
      return `${label} 已于 ${number(summary.durationMs)} 毫秒停止（${comparisonStopLabels[summary.stopReason]}）\n`
        + `最终生命 ${number(summary.targetFinalHp)} / 累计造成伤害 ${number(summary.sourceDamageDealt)}`;
    }
    const point = nearestContinuousPoint(series, timeMs);
    if (!point) return `${label} 未记录采样`;
    const rate = point.timeMs === 0 ? '不适用' : number(point.sourceCumulativeDps);
    return `${label}（采样 ${number(point.timeMs)} 毫秒）\n`
      + `目标生命 ${number(point.targetHp)} / 累计造成伤害 ${number(point.sourceDamageDealt)}\n`
      + `累计平均伤害率 ${rate}`;
  }).join('\n\n');
}

export function combatComparisonChartOption(a: ComparisonRun, b: ComparisonRun) {
  if ([a, b].some(run => run.seriesSamplingEvidence.method === 'disabled')) return null;
  const durationMs = Math.max(a.summary.durationMs, b.summary.durationMs);
  const base = continuousAttackChartOption({
    points: [], attacks: [], view: initialContinuousView(durationMs), durationMs, killedAtMs: null,
    dpsWindowMs: 0, onSelectAttack: () => {}, onRangeChange: () => {}, onHover: () => {}
  });
  // 单方案封装按同样顺序提供三个标题的布局。
  const titleLayout = base.title as TitleComponentOption[];
  return {
    ...base,
    aria: { enabled: true, description: '方案 A 与方案 B 的目标剩余生命、攻击方累计造成伤害和累计平均伤害率采样图。' },
    title: panels.map(({ label }, index) => ({ ...titleLayout[index], text: label })),
    axisPointer: { triggerOn: 'none' },
    // ECharts 的轴提示会吸附到最近数据点。悬停提示由下方按原始横坐标触发。
    tooltip: { trigger: 'item', triggerOn: 'none', renderMode: 'richText', confine: true, textStyle: { fontSize: 12 } },
    series: panels.flatMap(({ field }, gridIndex) => [a, b].map(({ series: points }, index) => {
      const { key, label, color, lineType } = plans[index];
      return {
        id: `${key}-${field}`, name: label, type: 'line', xAxisIndex: gridIndex, yAxisIndex: gridIndex,
        step: field === 'sourceCumulativeDps' ? false : 'end', smooth: false, connectNulls: false,
        showSymbol: points.length <= 2, symbol: index === 0 ? 'circle' : 'diamond', symbolSize: 6,
        lineStyle: { width: 2, color, type: lineType }, itemStyle: { color },
        data: points.map(point => [point.timeMs, field === 'sourceCumulativeDps' && point.timeMs === 0 ? null : point[field]])
      };
    }))
  };
}

export function CombatComparisonCharts({ a, b }: { a: ComparisonRun; b: ComparisonRun }) {
  const container = useRef<HTMLDivElement>(null);
  const option = useMemo(() => combatComparisonChartOption(a, b), [a, b]);
  useEffect(() => {
    const element = container.current;
    if (!element || !option) return;
    const chart = init(element, undefined, { renderer: 'svg' });
    chart.setOption(option);
    const hideTip = () => chart.dispatchAction({ type: 'hideTip' });
    const showTip = ({ offsetX, offsetY }: { offsetX: number; offsetY: number }) => {
      const pixel = [offsetX, offsetY];
      const gridIndex = panels.findIndex((_, index) => chart.containPixel({ gridIndex: index }, pixel));
      if (gridIndex === -1) { hideTip(); return; }
      const timeMs = chart.convertFromPixel({ xAxisIndex: gridIndex }, offsetX);
      if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return;
      const text = combatComparisonTooltip(a, b, timeMs);
      chart.dispatchAction({ type: 'showTip', x: offsetX, y: offsetY, tooltip: { formatter: () => text } });
    };
    const renderer = chart.getZr();
    renderer.on('mousemove', showTip);
    renderer.on('click', showTip);
    renderer.on('globalout', hideTip);
    chart.on('datazoom', hideTip);
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => chart.resize());
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      chart.dispose();
    };
  }, [a, b, option]);

  return <>
    <ul className="combat-comparison-sampling" aria-label="采样说明">
      {[a, b].map((run, index) => <li key={plans[index].key}>
        <span className={`combat-comparison-line combat-comparison-line-${plans[index].key}`} aria-hidden="true" />
        <strong>{plans[index].label}</strong> {combatComparisonSamplingLabel(run.seriesSamplingEvidence)}
      </li>)}
    </ul>
    {!option ? <p>本次未记录双方案时间序列。完整汇总指标与来源贡献对比仍有效。</p> :
      <div ref={container} className="combat-comparison-chart" role="img" aria-label="两方案采样曲线" />}
  </>;
}
