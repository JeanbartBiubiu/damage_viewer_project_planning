import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import { assertNumericUses } from './numericValue';

type Root = Record<string, unknown>;
const v = () => fixedValue(2);
it('重施可选间隔只接明确数值对象或null，不把缺省改成零', () => {
  const root = { cooldown: null, stateOperations: [], steps: [{ stepType: 'RECAST', detail: { windowValue: v(), maximumRecastCountValue: v() } as Record<string, unknown> }] };
  const fail = (path: string): never => { throw Error(path); };
  expect(() => assertNumericUses(root, 'process', fail)).not.toThrow();
  root.steps[0]!.detail.intervalValue = null; expect(() => assertNumericUses(root, 'process', fail)).not.toThrow();
  root.steps[0]!.detail.intervalValue = v(); expect(() => assertNumericUses(root, 'process', fail)).not.toThrow();
  root.steps[0]!.detail.intervalValue = 1000; expect(() => assertNumericUses(root, 'process', fail)).toThrow('intervalValue');
});
const roots: Array<{ domain: Parameters<typeof assertNumericUses>[1]; root: Root }> = [
  { domain: 'effect', root: {
    lifecycle: { durationValue: v(), maxStacksValue: v(), applicationStacksValue: v(), periodicIntervalValue: v() },
    results: [{ resultType: 'DAMAGE', valueRule: { value: v() }, detail: { critical: { multiplierValue: v() }, vampOverrides: [{ mode: 'OVERRIDE', efficiencyValue: v() }] } }]
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
  it('指定窗口响应必须完整且严格解析三种NumericValue，旧口径不能夹带端点', () => {
    const process = { cooldown: null, stateOperations: [], steps: [{ stepType: 'CHANNEL', detail: {
      durationValue: fixedValue(20), executionCountValue: fixedValue(4), firstExecution: 'CUSTOM_WINDOW',
      firstExecutionOffsetValue: parameterValue('first'), lastExecutionOffsetValue: formulaValue('last') } }] };
    expect(() => assertNumericUses(process, 'process', fail)).not.toThrow();
    for (const field of ['firstExecutionOffsetValue', 'lastExecutionOffsetValue']) {
      for (const value of [undefined, null, 'old_formula', { kind: 'FIXED', value: 0, parameterKey: 'first' }]) {
        const copy = structuredClone(process);
        Object.assign(copy.steps[0]!.detail, { [field]: value });
        expect(() => assertNumericUses(copy, 'process', fail)).toThrow(field);
      }
    }
    process.steps[0]!.detail.firstExecution = 'IMMEDIATE';
    expect(() => assertNumericUses(process, 'process', fail)).toThrow('firstExecutionOffsetValue');
  });
  it('覆盖既有34处使用位置', () => expect(slots).toHaveLength(34));
  it('新增可选初充余时与必需减时金额严格解析，缺省余时不补零', () => {
    const ammo = { stateType: 'AMMO', detail: { initialValue: v(), maxValue: v(), recoveryIntervalValue: v() } };
    expect(() => assertNumericUses(ammo, 'state', fail)).not.toThrow();
    const trigger = { eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [], perTargetCooldown: null,
      maxTriggersPerProcess: null, actions: [{ actionType: 'MODIFY_INTERNAL_STATE', detail: { value: v() } }] };
    for (const value of [fixedValue(0), parameterValue('amount'), formulaValue('amount')]) {
      expect(() => assertNumericUses({ ...ammo, detail: { ...ammo.detail, initialRemainingValue: value } }, 'state', fail)).not.toThrow();
      trigger.actions[0]!.detail.value = value;
      expect(() => assertNumericUses(trigger, 'trigger', fail)).not.toThrow();
    }
    for (const value of [null, 'legacy', {}, { kind: 'FIXED', value: 0, formulaKey: 'extra' }]) {
      expect(() => assertNumericUses({ ...ammo, detail: { ...ammo.detail, initialRemainingValue: value } }, 'state', fail)).toThrow(/initialRemainingValue/);
      expect(() => assertNumericUses({ ...trigger, actions: [{ actionType: 'MODIFY_INTERNAL_STATE', detail: { value } }] }, 'trigger', fail)).toThrow(/value/);
    }
    expect(() => assertNumericUses({ ...trigger, actions: [{ actionType: 'MODIFY_INTERNAL_STATE', detail: {} }] }, 'trigger', fail)).toThrow(/value/);
  });
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
