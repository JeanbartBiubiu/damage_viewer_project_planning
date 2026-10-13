import { describe, expect, it } from 'vitest';
import type { DoneResult, RunRequest, SeriesPoint } from '../types/genericEngine';
import { inspectContinuousAttackSeries } from './continuousAttackSeries';

function sample(stopMs = 2000, maxPoints = 5000) {
  const interval = Math.max(100, Math.ceil(30000 / (maxPoints - 1)));
  const times: number[] = [];
  for (let timeMs = 0; timeMs <= stopMs; timeMs += interval) times.push(timeMs);
  if (times[times.length - 1] !== stopMs) times.push(stopMs);
  const series: SeriesPoint[] = times.map(timeMs => ({ timeMs, sourceHp: 650, targetHp: timeMs === stopMs ? 0 : 150,
    sourceDamageDealt: timeMs === stopMs ? 300 : 100, targetDamageDealt: 0,
    sourceCumulativeDps: timeMs === 0 ? 0 : 300 / (timeMs / 1000), targetCumulativeDps: 0,
    sourceWindowDps: timeMs === 0 ? 0 : 200, targetWindowDps: 0 }));
  const request = { sampling: { disabled: false, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: maxPoints },
    stopPolicy: { durationMs: 30000 } } as RunRequest;
  const result = { series, summary: { durationMs: stopMs, sourceFinalHp: 650, targetFinalHp: 0, sourceDamageDealt: 300,
    targetDamageDealt: 0, seriesDownsampled: interval > 100 }, seriesSamplingEvidence: { requestedSampleEveryMs: 100,
    effectiveSampleEveryMs: interval, requestedPointCount: Math.floor(stopMs / 100) + 1 + (stopMs % 100 ? 1 : 0),
    finalPointCount: series.length, maxSeriesPoints: maxPoints, downsampled: interval > 100, method: 'uniform_time' } } as DoneResult;
  return { request, result };
}
describe('连续运行只读采样校验', () => {
  it('保留首刀后0点和非网格终点，不重算伤害率', () => {
    const { request, result } = sample(2011);
    const parsed = inspectContinuousAttackSeries(request, result);
    expect(parsed.seriesIssues).toEqual([]);
    expect(parsed.series[0]?.targetHp).toBe(150);
    expect(parsed.series.at(-1)?.timeMs).toBe(2011);
    expect(parsed.series).toEqual(result.series);
  });
  it('按请求时长降采样，提前击杀只保留0和结束点', () => {
    const { request, result } = sample(2000, 10);
    expect(result.series.map(point => point.timeMs)).toEqual([0, 2000]);
    expect(inspectContinuousAttackSeries(request, result).seriesIssues).toEqual([]);
  });
  it('允许0毫秒结束只有一个点，原伤害率保留0', () => {
    const { request, result } = sample(0);
    expect(inspectContinuousAttackSeries(request, result).seriesIssues).toEqual([]);
    expect(result.series).toHaveLength(1);
  });
  it.each(['missing', 'nonfinite', 'negative', 'duplicate', 'backwards', 'endpoint', 'total', 'interval', 'count', 'method', 'downsampled'])('拒绝非法采样：%s', kind => {
    const { request, result } = sample();
    if (kind === 'missing') delete (result.series[1] as Partial<SeriesPoint>).sourceHp;
    if (kind === 'nonfinite') result.series[1]!.sourceHp = Infinity;
    if (kind === 'negative') result.series[1]!.sourceWindowDps = -1;
    if (kind === 'duplicate') result.series[1]!.timeMs = 0;
    if (kind === 'backwards') result.series[2]!.timeMs = 50;
    if (kind === 'endpoint') result.series.at(-1)!.timeMs = 2001;
    if (kind === 'total') result.series.at(-1)!.sourceDamageDealt = 299;
    if (kind === 'interval') result.seriesSamplingEvidence.effectiveSampleEveryMs = 200;
    if (kind === 'count') result.seriesSamplingEvidence.finalPointCount--;
    if (kind === 'method') result.seriesSamplingEvidence.method = 'unknown';
    if (kind === 'downsampled') result.summary.seriesDownsampled = true;
    const parsed = inspectContinuousAttackSeries(request, result);
    expect(parsed.seriesIssues.length).toBeGreaterThan(0);
    expect(parsed.series).toEqual([]);
    expect(parsed.seriesSamplingEvidence).toBeNull();
  });
  it('关闭采样必须返回明确空数组和禁用说明', () => {
    const { request, result } = sample();
    request.sampling.disabled = true;
    result.series = [];
    Object.assign(result.seriesSamplingEvidence, { effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0, downsampled: false, method: 'disabled' });
    expect(inspectContinuousAttackSeries(request, result).seriesIssues).toEqual([]);
    result.seriesSamplingEvidence.finalPointCount = 1;
    expect(inspectContinuousAttackSeries(request, result).seriesIssues.length).toBeGreaterThan(0);
  });
});
