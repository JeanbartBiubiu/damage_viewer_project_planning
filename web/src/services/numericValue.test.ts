import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import { assertNumericUses } from './numericValue';

type Root = Record<string, unknown>;
const v = () => fixedValue(2);
const roots: Array<{ domain: Parameters<typeof assertNumericUses>[1]; root: Root }> = [
  { domain: 'effect', root: {
    lifecycle: { durationValue: v(), maxStacksValue: v(), applicationStacksValue: v(), periodicIntervalValue: v() },
    results: [{ resultType: 'DAMAGE', valueRule: { value: v() }, detail: { critical: { multiplierValue: v() }, vampRules: [{ efficiencyValue: v() }] } }]
  } },
  { domain: 'process', root: {
    cooldown: { durationValue: v() }, stateOperations: [{ operation: 'CONSUME', value: v() }],
    steps: [
      { stepType: 'DELAY', detail: { delayValue: v() } },
      { stepType: 'MULTI_HIT', detail: { repeatCountValue: v(), intervalValue: v() } },
      { stepType: 'PERIODIC', detail: { repeatCountValue: v(), intervalValue: v() } },
      { stepType: 'CHANNEL', detail: { durationValue: v(), executionCountValue: v() } },
      { stepType: 'CHARGE', detail: { minimumChargeValue: v(), maximumChargeValue: v() } },
      { stepType: 'RECAST', detail: { windowValue: v(), maximumRecastCountValue: v() } },
      { stepType: 'EMPOWERED_BASIC_ATTACK', detail: { windowValue: v() } }
    ]
  } },
  { domain: 'state', root: { stateType: 'COUNTER', detail: { initialValue: v(), maxValue: v() } } },
  { domain: 'state', root: { stateType: 'AMMO', detail: { initialValue: v(), maxValue: v(), recoveryIntervalValue: v() } } },
  { domain: 'state', root: { stateType: 'INTERNAL_COOLDOWN', detail: { durationValue: v() } } },
  { domain: 'trigger', root: {
    eventSource: { eventType: 'HEALTH_THRESHOLD_CROSSED', detail: { thresholdValue: v() } },
    conditionGroups: [{ conditions: [
      { conditionType: 'ATTRIBUTE_COMPARE', detail: { comparisonValue: v() } },
      { conditionType: 'STATUS_CHECK', detail: { checkKind: 'STACKS_COMPARE', comparisonValue: v() } },
      { conditionType: 'INTERNAL_STATE_CHECK', detail: { valueKind: 'VALUE', comparisonValue: v() } },
      { conditionType: 'EVENT_VALUE_COMPARE', detail: { comparisonValue: v() } },
      { conditionType: 'TARGET_CATEGORY_CHECK', detail: { categories: ['CHAMPION'] } },
      { conditionType: 'EXPLICIT_TARGET_IS_SOURCE', detail: {} }
    ] }], perTargetCooldown: { durationValue: v() }, maxTriggersPerProcess: { limitValue: v() }
  } }
];

function paths(value: unknown, prefix: Array<string | number> = []): Array<Array<string | number>> {
  if (!value || typeof value !== 'object') return [];
  if ('kind' in value) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => paths(child, [...prefix, Array.isArray(value) ? Number(key) : key]));
}
const slots = roots.flatMap(({ root, domain }) => paths(root).map((path) => ({ root, domain, path, label: `${domain}.${path.join('.')}` })));
const fail = (path: string): never => { throw new Error(`协议不符：${path}`); };

describe('34处数值响应统一契约', () => {
  it('覆盖全部使用位置', () => expect(slots).toHaveLength(34));
  it.each(slots)('$label 接收三种形状并拒绝旧字符串、混合与缺失字段', ({ root, domain, path }) => {
    const copy = structuredClone(root);
    let owner = copy;
    for (const key of path.slice(0, -1)) owner = owner[key] as Root;
    const key = path[path.length - 1];
    for (const value of [fixedValue(0), parameterValue('amount'), formulaValue('damage')]) {
      owner[key] = value;
      expect(() => assertNumericUses(copy, domain, fail)).not.toThrow();
    }
    for (const value of ['damage', { kind: 'FIXED', value: '0' }, { kind: 'FIXED', value: 1, formulaKey: 'damage' }]) {
      owner[key] = value;
      expect(() => assertNumericUses(copy, domain, fail)).toThrow('协议不符');
    }
    delete owner[key];
    expect(() => assertNumericUses(copy, domain, fail)).toThrow('协议不符');
  });

  it('可选字段明确null，固定0仍保留；已删除旧字段不能偷偷并存', () => {
    const root = { stateType: 'COUNTER', detail: { initialValue: v(), maxValue: v(), maxValueFormulaKey: 'old' } };
    expect(() => assertNumericUses(root, 'state', fail)).toThrow('maxValueFormulaKey');
    const process = { cooldown: null, steps: [{ stepType: 'MULTI_HIT', detail: { repeatCountValue: v(), intervalValue: null } }], stateOperations: [{ operation: 'RESET', value: null }] };
    expect(() => assertNumericUses(process, 'process', fail)).not.toThrow();
    expect(() => assertNumericUses({ ...process, steps: null }, 'process', fail)).toThrow('协议不符');
  });
});
