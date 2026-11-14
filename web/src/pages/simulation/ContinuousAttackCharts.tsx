import { useEffect, useRef } from 'react';
import { init, use, type EChartsType, type EChartsCoreOption } from 'echarts/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, TitleComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { AttackRecord, SeriesPoint } from '../../types/genericEngine';
import { formatContinuousAmount, nearestContinuousPoint, type ContinuousAttackView } from '../../engine/continuousAttackPresentation';

use([LineChart, ScatterChart, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, TitleComponent, AriaComponent, SVGRenderer]);

export type ContinuousChartMarker = { key: string; timeMs: number; label: string; color: string; selected: boolean };
type ChartProps = {
  points: SeriesPoint[]; attacks: AttackRecord[];
  view: Pick<ContinuousAttackView, 'timeRangeMs' | 'dpsMode' | 'visibleCurves'> & { selectedAttack?: ContinuousAttackView['selectedAttack'] }; durationMs: number;
  killedAtMs: number | null; dpsWindowMs: number;
  onSelectAttack: (row: AttackRecord) => void; onRangeChange: (range: [number, number]) => void;
  onHover: (point: SeriesPoint) => void;
  markers?: ContinuousChartMarker[]; onSelectMarker?: (key: string) => void;
};
const curveLabels: Record<string, string> = { sourceHp: 'A剩余生命', targetHp: 'B剩余生命',
  sourceDamageDealt: 'A累计造成伤害', targetDamageDealt: 'B累计造成伤害', sourceDps: 'A伤害率', targetDps: 'B伤害率' };

export function continuousAttackChartOption(props: ChartProps): EChartsCoreOption {
  const { points, attacks, view, durationMs, killedAtMs } = props;
  const rateLabel = view.dpsMode === 'cumulative' ? '累计平均伤害率' : '滚动窗口伤害率（' + props.dpsWindowMs + '毫秒）';
  const selected = view.selectedAttack;
  const curves = [
    ['sourceHp', 'sourceHp', 0, '#165DFF'], ['targetHp', 'targetHp', 0, '#F53F3F'],
    ['sourceDamageDealt', 'sourceDamageDealt', 1, '#165DFF'], ['targetDamageDealt', 'targetDamageDealt', 1, '#F53F3F'],
    ['sourceDps', view.dpsMode === 'cumulative' ? 'sourceCumulativeDps' : 'sourceWindowDps', 2, '#165DFF'],
    ['targetDps', view.dpsMode === 'cumulative' ? 'targetCumulativeDps' : 'targetWindowDps', 2, '#F53F3F']
  ] as const;
  const series: Record<string, unknown>[] = curves.map(([key, field, gridIndex, color]) => ({
    id: key, name: curveLabels[key], type: 'line', xAxisIndex: gridIndex, yAxisIndex: gridIndex,
    step: gridIndex === 2 ? false : 'end', smooth: false, showSymbol: false, connectNulls: false,
    lineStyle: { width: 2, color }, itemStyle: { color },
    data: view.visibleCurves.includes(key) ? points.map(point => [point.timeMs, gridIndex === 2 && point.timeMs === 0 ? null : point[field]]) : []
  }));
  for (const [kind, field, symbol, color] of [['开始', 'startAtMs', 'triangle', '#86909C'], ['命中', 'hitAtMs', 'circle', '#00B42A']] as const) {
    series.push({ id: 'attacks-' + field, name: '攻击' + kind, type: 'scatter', xAxisIndex: 0, yAxisIndex: 0,
      symbol, symbolOffset: [0, kind === '开始' ? -6 : 6], itemStyle: { color }, z: 4,
      data: attacks.filter(row => row[field] !== null).map(row => ({ value: [row[field], 0], attackIndex: row.attackIndex,
        planKey: row.planKey, useRef: row.useRef, kind, timeMs: row[field],
        symbolSize: selected?.planKey === row.planKey && selected.attackIndex === row.attackIndex && selected.useRef === row.useRef ? 16 : 7 })),
      tooltip: { trigger: 'item', renderMode: 'richText', formatter: (event: unknown) => {
        const data = (event as { data?: { attackIndex?: number; kind?: string; timeMs?: number; useRef?: string } }).data;
        return data ? '第' + data.attackIndex + '刀' + data.kind + '：' + data.timeMs + '毫秒\n' + data.useRef : '';
      } }
    });
  }
  if (props.markers?.length) series.push({ id: 'combat-facts', name: '真实技能与结算事实', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0,
    symbol: 'diamond', symbolOffset: [0, -16], z: 5,
    data: props.markers.map(marker => ({ value: [marker.timeMs, 0], markerKey: marker.key,
      name: marker.label, symbolSize: marker.selected ? 16 : 8, itemStyle: { color: marker.color } })),
    tooltip: { trigger: 'item', renderMode: 'richText', formatter: (event: unknown) => {
      const data = (event as { data?: { name?: string; value?: number[] } }).data;
      return data ? `${data.name}\n真实时刻：${data.value?.[0]}毫秒` : '';
    } }
  });
  if (killedAtMs !== null) {
    series.push({ id: 'target-killed', type: 'line', data: [], xAxisIndex: 0, yAxisIndex: 0,
      markLine: { silent: true, symbol: 'none', lineStyle: { color: '#F53F3F', type: 'dashed' },
        label: { formatter: '首次击杀 ' + killedAtMs + '毫秒', position: 'insideEndTop' }, data: [{ xAxis: killedAtMs }] } });
  }
  return {
    animation: false, aria: { enabled: true, description: '只读采样图：双方生命、累计造成伤害和伤害率。精确逐刀信息可通过下方表格选择。' },
    title: [{ text: '双方剩余生命（采样观察）', top: 5, left: 10 }, { text: '累计造成伤害（采样观察）', top: 190, left: 10 },
      { text: rateLabel, top: 375, left: 10 }],
    grid: [{ top: 40, height: 125, left: 70, right: 30 }, { top: 225, height: 125, left: 70, right: 30 }, { top: 410, height: 125, left: 70, right: 30 }],
    xAxis: [0, 1, 2].map(gridIndex => ({ type: 'value', gridIndex, min: 0, max: Math.max(1, durationMs),
      axisLabel: { formatter: (value: number) => formatContinuousAmount(value / 1000) + '秒' }, axisPointer: { show: true } })),
    yAxis: [0, 1, 2].map(gridIndex => ({ type: 'value', gridIndex, min: 0,
      axisLabel: { formatter: (value: number) => formatContinuousAmount(value) }, splitLine: { lineStyle: { color: '#E5E6EB' } } })),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, formatter: (events: unknown) => {
      const event = Array.isArray(events) ? events[0] as { axisValue?: number } : null;
      const point = nearestContinuousPoint(points, Number(event?.axisValue ?? 0));
      if (!point) return '未记录采样';
      return '真实采样：' + point.timeMs + '毫秒\nA生命：' + formatContinuousAmount(point.sourceHp)
        + '；B生命：' + formatContinuousAmount(point.targetHp) + '\nA累计造成伤害：' + formatContinuousAmount(point.sourceDamageDealt)
        + '；B累计造成伤害：' + formatContinuousAmount(point.targetDamageDealt) + '\n伤害率：'
        + (point.timeMs === 0 ? '起点，不适用' : 'A ' + formatContinuousAmount(view.dpsMode === 'cumulative' ? point.sourceCumulativeDps : point.sourceWindowDps)
          + '；B ' + formatContinuousAmount(view.dpsMode === 'cumulative' ? point.targetCumulativeDps : point.targetWindowDps));
    } },
    dataZoom: [{ type: 'slider', xAxisIndex: [0, 1, 2], filterMode: 'none', top: 565, height: 20,
      startValue: view.timeRangeMs[0], endValue: durationMs === 0 ? 1 : view.timeRangeMs[1] },
      { type: 'inside', xAxisIndex: [0, 1, 2], filterMode: 'none', startValue: view.timeRangeMs[0], endValue: durationMs === 0 ? 1 : view.timeRangeMs[1] }],
    series
  };
}

export function ContinuousAttackCharts(props: ChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const current = useRef(props);
  current.current = props;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = init(element, undefined, { renderer: 'svg' });
    chart.current = instance;
    instance.on('click', (event: unknown) => {
      const data = (event as { data?: { planKey?: unknown; attackIndex?: unknown; useRef?: unknown; markerKey?: string } }).data;
      if (data?.markerKey) { current.current.onSelectMarker?.(data.markerKey); return; }
      const row = current.current.attacks.find(attack => attack.planKey === data?.planKey && attack.attackIndex === data.attackIndex && attack.useRef === data.useRef);
      if (row) current.current.onSelectAttack(row);
    });
    instance.on('datazoom', (event: unknown) => {
      const payload = event as { batch?: { start?: number; end?: number }[]; start?: number; end?: number };
      const zoom = payload.batch?.[0] ?? payload;
      if (typeof zoom.start !== 'number' || typeof zoom.end !== 'number') return;
      const maximum = current.current.durationMs;
      current.current.onRangeChange([Math.max(0, Math.min(maximum, Math.round(maximum * zoom.start / 100))),
        Math.max(0, Math.min(maximum, Math.round(maximum * zoom.end / 100)))]);
    });
    instance.on('updateAxisPointer', (event: unknown) => {
      const payload = event as { axesInfo?: { value?: number }[] };
      const timeMs = payload.axesInfo?.[0]?.value;
      if (typeof timeMs !== 'number') return;
      const point = nearestContinuousPoint(current.current.points, timeMs);
      if (point) current.current.onHover(point);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => { observer.disconnect(); instance.dispose(); chart.current = null; };
  }, []);
  useEffect(() => { chart.current?.setOption(continuousAttackChartOption(props), { notMerge: true }); },
    [props.points, props.attacks, props.view, props.durationMs, props.killedAtMs, props.dpsWindowMs, props.markers]);
  return <div ref={container} data-testid="continuous-attack-charts" role="img" aria-label="生命、累计伤害和伤害率采样图"
    style={{ width: '100%', height: 610, minWidth: 0 }} />;
}
