import type { AttackRecord, DamageBreakdown, DamageRecord, SeriesPoint } from '../types/genericEngine';
import type { ContinuousAttackAssessment } from './continuousAttackResult';

export type AttackSelection = Pick<AttackRecord, 'planKey' | 'attackIndex' | 'useRef'>;
export type ContinuousAttackView = {
  breakdownMode: 'source' | 'type'; amountMetric: AmountMetric;
  timeRangeMs: [number, number]; dpsMode: 'cumulative' | 'window'; visibleCurves: string[];
  sourceKeys: string[]; damageTypes: string[]; attackIndex: number | null;
  selectedAttack: AttackSelection | null; selectedDamageId: number | null;
};
export const continuousCurves = ['sourceHp', 'targetHp', 'sourceDamageDealt', 'targetDamageDealt', 'sourceDps', 'targetDps'];
export const amountMetrics = ['postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss', 'overkillDamage'] as const;
export type AmountMetric = typeof amountMetrics[number];
export const amountLabels: Record<AmountMetric, string> = {
  postDefenseDamage: '造成伤害', shieldAbsorbed: '护盾吸收', actualHpLoss: '实际扣血', overkillDamage: '过量伤害'
};
export const formatContinuousAmount = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
export function initialContinuousView(durationMs: number): ContinuousAttackView {
  return { breakdownMode: 'source', amountMetric: 'postDefenseDamage', timeRangeMs: [0, durationMs], dpsMode: 'cumulative', visibleCurves: [...continuousCurves],
    sourceKeys: [], damageTypes: [], attackIndex: null, selectedAttack: null, selectedDamageId: null };
}
export function continuousSourceKey(row: Pick<DamageBreakdown, 'owner' | 'source' | 'target' | 'abilityRef' | 'operationRef'>) {
  return JSON.stringify([row.owner, row.source, row.target, row.abilityRef, row.operationRef]);
}
export function continuousBreakdownKey(row: DamageBreakdown) {
  return JSON.stringify([row.owner, row.source, row.target, row.abilityRef, row.operationRef, row.damageType]);
}
export function damageMatchesSource(row: DamageBreakdown | DamageRecord, view: ContinuousAttackView) {
  return (!view.sourceKeys.length || view.sourceKeys.includes(continuousSourceKey(row)))
    && (!view.damageTypes.length || view.damageTypes.includes(row.damageType));
}
export function filterContinuousPresentation(assessment: ContinuousAttackAssessment, view: ContinuousAttackView) {
  const within = (timeMs: number) => timeMs >= view.timeRangeMs[0] && timeMs <= view.timeRangeMs[1];
  const attackMatches = (attackIndex: number | null) => view.attackIndex === null || view.attackIndex === attackIndex;
  const attackRows = assessment.attackRecords.filter(row => within(row.startAtMs) && attackMatches(row.attackIndex));
  const damageRows = assessment.damageRecords.filter(row => within(row.timeMs) && attackMatches(row.attackIndex) && damageMatchesSource(row, view));
  const breakdownRows = assessment.damageBreakdown.filter(row => damageMatchesSource(row, view));
  const seriesRows = assessment.series.filter(row => within(row.timeMs));
  const sumAmount = (rows: (DamageBreakdown | DamageRecord)[], metric: AmountMetric) => rows.reduce((total, row) => total + row[metric], 0);
  return { attackRows, damageRows, breakdownRows, seriesRows,
    breakdownSubtotal: sumAmount(breakdownRows, 'postDefenseDamage'), damageSubtotal: sumAmount(damageRows, 'postDefenseDamage') };
}
export type ContinuousContribution = { key: string; labelKey: string; source: string; target: string; owner: string;
  sourceKey: string | null; damageType: string | null; amount: number; damageCount: number; proportion: number | null };
export function continuousContributions(allRows: DamageBreakdown[], filteredRows: DamageBreakdown[], mode: 'source' | 'type', metric: AmountMetric) {
  const directionKey = (row: DamageBreakdown) => JSON.stringify([row.source, row.target]);
  const denominators = new Map<string, number>();
  for (const row of allRows) denominators.set(directionKey(row), (denominators.get(directionKey(row)) ?? 0) + row[metric]);
  const grouped = new Map<string, ContinuousContribution>();
  for (const row of filteredRows) {
    const sourceKey = continuousSourceKey(row);
    const key = mode === 'source' ? sourceKey : JSON.stringify([row.owner, row.source, row.target, row.damageType]);
    const prior = grouped.get(key);
    if (prior) { prior.amount += row[metric]; prior.damageCount += row.damageCount; }
    else grouped.set(key, { key, labelKey: mode === 'source' ? row.operationRef : row.damageType,
      source: row.source, target: row.target, owner: row.owner, sourceKey: mode === 'source' ? sourceKey : null,
      damageType: mode === 'type' ? row.damageType : null, amount: row[metric], damageCount: row.damageCount, proportion: null });
  }
  for (const row of grouped.values()) {
    const denominator = denominators.get(JSON.stringify([row.source, row.target])) ?? 0;
    row.proportion = denominator > 0 ? row.amount / denominator : null;
  }
  return [...grouped.values()].sort((left, right) => right.amount - left.amount || left.key.localeCompare(right.key));
}
export function nearestContinuousPoint(points: SeriesPoint[], timeMs: number): SeriesPoint | null {
  if (!points.length) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle]!.timeMs < timeMs) low = middle + 1;
    else high = middle;
  }
  const later = points[low]!;
  const earlier = points[Math.max(0, low - 1)]!;
  return timeMs - earlier.timeMs <= later.timeMs - timeMs ? earlier : later;
}
