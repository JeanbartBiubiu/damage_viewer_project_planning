import { isNumericValue } from '../types/numericValue';

type Item = Record<string, unknown>;
type Failure = (path: string) => never;
const object = (value: unknown): value is Item => typeof value === 'object' && value !== null && !Array.isArray(value);

export function assertNumericUses(root: unknown, domain: 'effect' | 'process' | 'state' | 'trigger', fail: Failure): void {
  const record = (value: unknown, path: string): Item => object(value) ? value : fail(path);
  const list = (value: unknown, path: string): Item[] => Array.isArray(value) ? value.map((item, index) => record(item, `${path}[${index}]`)) : fail(path);
  const slot = (owner: unknown, key: string, path: string, nullable = false) => {
    if (!object(owner) || !(key in owner) || !(nullable && owner[key] === null) && !isNumericValue(owner[key])) fail(`${path}.${key}`);
  };
  const rejectOld = (value: unknown, path: string) => {
    if (Array.isArray(value)) { value.forEach((item, index) => rejectOld(item, `${path}[${index}]`)); return; }
    if (!object(value) || isNumericValue(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('FormulaKey') || key === 'formulaKey') fail(`${path}.${key}`);
      rejectOld(child, `${path}.${key}`);
    }
  };
  rejectOld(root, domain);
  if (!object(root)) fail(domain);
  if (domain === 'effect') {
    if (root.lifecycle !== null) {
      for (const key of ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'periodicIntervalValue']) {
        slot(root.lifecycle, key, 'lifecycle', key === 'durationValue' || key === 'periodicIntervalValue');
      }
    }
    for (const [index, value] of list(root.results, 'results').entries()) {
      const path = `results[${index}]`;
      if (value.valueRule !== null) slot(value.valueRule, 'value', `${path}.valueRule`);
      if (value.resultType === 'DAMAGE') {
        const detail = record(value.detail, `${path}.detail`);
        slot(detail.critical, 'multiplierValue', `${path}.detail.critical`, true);
        for (const [i, rule] of list(detail.vampOverrides, `${path}.detail.vampOverrides`).entries()) {
          if (rule.mode === 'OVERRIDE') slot(rule, 'efficiencyValue', `${path}.detail.vampOverrides[${i}]`);
        }
      }
    }
  } else if (domain === 'state') {
    if (root.stateType === 'COUNTER' || root.stateType === 'AMMO') {
      slot(root.detail, 'initialValue', 'detail'); slot(root.detail, 'maxValue', 'detail');
    }
    if (root.stateType === 'AMMO') slot(root.detail, 'recoveryIntervalValue', 'detail');
    if (root.stateType === 'INTERNAL_COOLDOWN') slot(root.detail, 'durationValue', 'detail');
  } else if (domain === 'process') {
    if (root.cooldown !== null) slot(root.cooldown, 'durationValue', 'cooldown');
    const keys: Record<string, string[]> = {
      IMMEDIATE: [], DELAY: ['delayValue'], MULTI_HIT: ['repeatCountValue', 'intervalValue'],
      PERIODIC: ['repeatCountValue', 'intervalValue'], CHANNEL: ['durationValue', 'executionCountValue'],
      CHARGE: ['minimumChargeValue', 'maximumChargeValue'], RECAST: ['windowValue', 'maximumRecastCountValue'],
      EMPOWERED_BASIC_ATTACK: ['windowValue']
    };
    for (const [index, step] of list(root.steps, 'steps').entries()) {
      for (const key of keys[String(step.stepType)] ?? []) slot(step.detail, key, `steps[${index}].detail`, step.stepType === 'MULTI_HIT' && key === 'intervalValue');
    }
    for (const [index, operation] of list(root.stateOperations, 'stateOperations').entries()) {
      slot(operation, 'value', `stateOperations[${index}]`, !['INCREASE', 'DECREASE', 'CONSUME', 'SET'].includes(String(operation.operation)));
    }
  } else {
    const event = record(root.eventSource, 'eventSource');
    if (event.eventType === 'HEALTH_THRESHOLD_CROSSED') slot(event.detail, 'thresholdValue', 'eventSource.detail');
    for (const [gi, group] of list(root.conditionGroups, 'conditionGroups').entries()) {
      for (const [ci, condition] of list(group.conditions, `conditionGroups[${gi}].conditions`).entries()) {
        const detail = record(condition.detail, `conditionGroups[${gi}].conditions[${ci}].detail`);
        if (condition.conditionType === 'TARGET_CATEGORY_CHECK' || condition.conditionType === 'EXPLICIT_TARGET_IS_SOURCE'
          || condition.conditionType === 'SKILL_HIT_TARGET_IS_ENEMY') continue;
        const nullable = (condition.conditionType === 'STATUS_CHECK' || condition.conditionType === 'LIFECYCLE_CHECK') && ['PRESENT', 'ABSENT'].includes(String(detail.checkKind))
          || condition.conditionType === 'INTERNAL_STATE_CHECK' && ['OPTION_SELECTED', 'ENABLED'].includes(String(detail.valueKind));
        slot(detail, 'comparisonValue', `conditionGroups[${gi}].conditions[${ci}].detail`, nullable);
      }
    }
    if (root.perTargetCooldown !== null) slot(root.perTargetCooldown, 'durationValue', 'perTargetCooldown');
    if (root.maxTriggersPerProcess !== null) slot(root.maxTriggersPerProcess, 'limitValue', 'maxTriggersPerProcess');
  }
}
