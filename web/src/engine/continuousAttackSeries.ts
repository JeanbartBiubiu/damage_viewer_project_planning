import type { DoneResult, RunRequest, SeriesPoint, SeriesSamplingEvidence } from '../types/genericEngine';

export type ContinuousAttackSeries = {
  series: SeriesPoint[];
  seriesSamplingEvidence: SeriesSamplingEvidence | null;
  seriesIssues: string[];
};
const seriesFields = ['sourceHp', 'targetHp', 'sourceDamageDealt', 'targetDamageDealt',
  'sourceCumulativeDps', 'targetCumulativeDps', 'sourceWindowDps', 'targetWindowDps'] as const;
const close = (left: number, right: number) => Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));

export function inspectContinuousAttackSeries(request: RunRequest, result: DoneResult): ContinuousAttackSeries {
  const seriesIssues: string[] = [];
  const check = (condition: boolean, path: string, message: string) => {
    if (!condition) seriesIssues.push(path + '：' + message);
  };
  const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const integer = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
  const raw = result.seriesSamplingEvidence;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { series: [], seriesSamplingEvidence: null, seriesIssues: ['seriesSamplingEvidence：缺少明确采样说明'] };
  }
  for (const key of ['requestedSampleEveryMs', 'effectiveSampleEveryMs', 'requestedPointCount', 'finalPointCount', 'maxSeriesPoints'] as const) {
    check(integer(raw[key]), 'seriesSamplingEvidence.' + key, '需要非负安全整数');
  }
  check(typeof raw.downsampled === 'boolean', 'seriesSamplingEvidence.downsampled', '需要布尔值');
  check(raw.maxSeriesPoints === request.sampling.maxSeriesPoints && raw.maxSeriesPoints >= 2 && raw.maxSeriesPoints <= 5000,
    'seriesSamplingEvidence.maxSeriesPoints', '点数上限与请求不一致');
  check(raw.requestedSampleEveryMs === request.sampling.sampleEveryMs && raw.requestedSampleEveryMs > 0,
    'seriesSamplingEvidence.requestedSampleEveryMs', '请求间隔不一致或非正');
  check(raw.downsampled === result.summary.seriesDownsampled, 'summary.seriesDownsampled', '降采样说明不一致');
  if (!Array.isArray(result.series)) {
    return { series: [], seriesSamplingEvidence: null, seriesIssues: [...seriesIssues, 'series：需要明确数组'] };
  }
  const points = result.series;
  check(raw.finalPointCount === points.length && points.length <= raw.maxSeriesPoints,
    'seriesSamplingEvidence.finalPointCount', '返回点数与说明或上限不一致');
  if (request.sampling.disabled) {
    check(points.length === 0 && raw.method === 'disabled' && raw.effectiveSampleEveryMs === 0
      && raw.requestedPointCount === 0 && !raw.downsampled, 'seriesSamplingEvidence', '关闭采样时仍输出采样结果');
  } else {
    check(raw.method === 'uniform_time', 'seriesSamplingEvidence.method', '需要均匀时间采样');
    const stopMs = result.summary.durationMs;
    const interval = Math.max(request.sampling.sampleEveryMs, Math.ceil(request.stopPolicy.durationMs / (request.sampling.maxSeriesPoints - 1)));
    check(integer(stopMs), 'summary.durationMs', '需要明确停止时刻');
    check(raw.effectiveSampleEveryMs === interval, 'seriesSamplingEvidence.effectiveSampleEveryMs', '有效间隔与请求观察范围不一致');
    check(raw.downsampled === (interval > request.sampling.sampleEveryMs), 'seriesSamplingEvidence.downsampled', '降采样标志与间隔不一致');
    const pointCount = (step: number) => Math.floor(stopMs / step) + 1 + (stopMs % step === 0 ? 0 : 1);
    check(raw.requestedPointCount === pointCount(request.sampling.sampleEveryMs),
      'seriesSamplingEvidence.requestedPointCount', '候选点数与实际终点不一致');
    check(points.length === pointCount(interval), 'series', '缺少实际采样点或终点');
    let previous: SeriesPoint | null = null;
    points.forEach((point, index) => {
      const path = 'series[' + index + ']';
      if (!point || typeof point !== 'object' || Array.isArray(point)) {
        check(false, path, '需要明确采样对象');
        return;
      }
      check(integer(point.timeMs) && point.timeMs <= stopMs && (!previous || point.timeMs > previous.timeMs),
        path + '.timeMs', '时刻非法、重复、倒序或超过终点');
      check(point.timeMs === (index === points.length - 1 ? stopMs : index * interval),
        path + '.timeMs', '时刻不符合有效采样网格或实际终点');
      for (const key of seriesFields) check(nonnegative(point[key]), path + '.' + key, '需要有限非负数值');
      if (previous) {
        check(point.sourceDamageDealt >= previous.sourceDamageDealt && point.targetDamageDealt >= previous.targetDamageDealt,
          path, '累计造成伤害不能下降');
      }
      if (point.timeMs === 0) {
        check(point.sourceCumulativeDps === 0 && point.targetCumulativeDps === 0 && point.sourceWindowDps === 0 && point.targetWindowDps === 0,
          path, '起点伤害率需要原生0占位');
      }
      previous = point;
    });
    const first = points[0];
    const last = points[points.length - 1];
    check(first?.timeMs === 0 && last?.timeMs === stopMs, 'series', '必须保留0及实际停止点');
    if (last) {
      for (const [key, total] of [['sourceHp', result.summary.sourceFinalHp], ['targetHp', result.summary.targetFinalHp],
        ['sourceDamageDealt', result.summary.sourceDamageDealt], ['targetDamageDealt', result.summary.targetDamageDealt]] as const) {
        check(nonnegative(last[key]) && nonnegative(total) && close(last[key], total), 'series.last.' + key, '末点与可靠汇总不一致');
      }
    }
  }
  return { series: seriesIssues.length ? [] : points.map(point => ({ ...point })),
    seriesSamplingEvidence: seriesIssues.length ? null : { ...raw }, seriesIssues };
}
