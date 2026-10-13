import { describe, expect, it } from 'vitest';
import type { AttackRecord, DamageBreakdown, DamageRecord, SeriesPoint } from '../types/genericEngine';
import type { ContinuousAttackAssessment } from './continuousAttackResult';
import { continuousBreakdownKey, continuousContributions, continuousSourceKey, filterContinuousPresentation, initialContinuousView, nearestContinuousPoint } from './continuousAttackPresentation';

const category: DamageBreakdown = { owner: 'source', source: 'source', target: 'target', abilityRef: 'ability', operationRef: 'operation',
  damageType: 'physical', damageCount: 3, postDefenseDamage: 300, actualHpLoss: 250, shieldAbsorbed: 0, overkillDamage: 50 };
function sample() {
  const damage = { ...category, damageId: 1, attackIndex: 1, useRef: 'actual-use', timeMs: 0 } as DamageRecord;
  return { durationMs: 2000, damageBreakdown: [{ ...category }],
    attackRecords: [{ startAtMs: 0, attackIndex: 1, useRef: 'actual-use' } as AttackRecord],
    damageRecords: [damage], series: [{ timeMs: 0 } as SeriesPoint, { timeMs: 2000 } as SeriesPoint] } as ContinuousAttackAssessment;
}
describe('完整累计与有限展示范围', () => {
  it('时间区间不拆完整分类，不能从有限明细恢复区间总额', () => {
    const facts = sample(); const before = structuredClone(facts); const view = initialContinuousView(2000);
    view.timeRangeMs = [1000, 2000];
    const result = filterContinuousPresentation(facts, view);
    expect(result.breakdownSubtotal).toBe(300);
    expect(result.damageSubtotal).toBe(0);
    expect(result.attackRows).toEqual([]);
    expect(result.seriesRows.map(point => point.timeMs)).toEqual([2000]);
    expect(facts).toEqual(before);
  });
  it('来源筛选只影响分类和伤害，不反推攻击归属或改采样', () => {
    const facts = sample(); const view = initialContinuousView(2000); view.sourceKeys = ['not-retained'];
    const result = filterContinuousPresentation(facts, view);
    expect(result.breakdownRows).toEqual([]); expect(result.damageRows).toEqual([]);
    expect(result.attackRows).toHaveLength(1); expect(result.seriesRows).toHaveLength(2);
  });
  it('同名作者结果按身份区分，金额占比始终用同方向全场分母', () => {
    const other = { ...category, operationRef: 'another', postDefenseDamage: 100, actualHpLoss: 100, overkillDamage: 0 };
    const reverse = { ...category, owner: 'target', source: 'target', target: 'source', postDefenseDamage: 1000 };
    const rows = continuousContributions([category, other, reverse], [category], 'source', 'postDefenseDamage');
    expect(rows[0]?.proportion).toBe(0.75);
    expect(continuousSourceKey(category)).not.toBe(continuousSourceKey(other));
    expect(continuousBreakdownKey(category)).not.toBe(continuousBreakdownKey({ ...category, damageType: 'magic' }));
  });
  it('同来源不同类型可合并来源图，但类型图分开；0分母不做除零', () => {
    const rows = [category, { ...category, damageType: 'magic', postDefenseDamage: 100 }];
    expect(continuousContributions(rows, rows, 'source', 'postDefenseDamage')).toHaveLength(1);
    expect(continuousContributions(rows, rows, 'type', 'postDefenseDamage')).toHaveLength(2);
    expect(continuousContributions(rows, rows, 'source', 'shieldAbsorbed')[0]?.proportion).toBeNull();
  });
  it('悬停只吸附真实点，等距取较早点，不生成插值', () => {
    const points = [{ timeMs: 0, targetHp: 150 }, { timeMs: 2000, targetHp: 0 }] as SeriesPoint[];
    expect(nearestContinuousPoint(points, 1000)).toBe(points[0]);
    expect(nearestContinuousPoint(points, 1999)).toBe(points[1]);
    expect(nearestContinuousPoint([], 1)).toBeNull();
  });
});
