import type { SkillConfiguration } from '../../../types/skillConfiguration';
import { NumericAdaptationError } from '../../numericAdapter';

export function selectSimulationSkillSourceClosure(configuration: SkillConfiguration, rootKeys: readonly string[]) {
  const root = `skills.${configuration.skill.skillKey}`;
  const skillKey = configuration.skill.skillKey;
  const selected = {
    parameters: new Set<string>(), formulas: new Set<string>(), effects: new Set<string>(),
    processes: new Set<string>(), internalStates: new Set<string>(), triggerRules: new Set<string>()
  };
  const pending: Array<{ value: unknown; path: string; collection: Collection }> = [];
  const producedEffects = new Set<string>();
  const producedStates = new Set<string>();
  const producedStatuses = new Set<string>();
  const fail = (path: string, message: string): never => { throw new NumericAdaptationError(path, message); };
  const keys = { parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey',
    processes: 'processKey', internalStates: 'stateKey', triggerRules: 'ruleKey' } as const;
  type Collection = keyof typeof selected;
  const include = (collection: Collection, key: unknown, path: string) => {
    if (typeof key !== 'string') return fail(path, '必要闭包引用缺少稳定标识');
    const matches = configuration[collection].filter(row => (row as unknown as Record<string, unknown>)[keys[collection]] === key);
    if (matches.length !== 1) fail(path, '必要闭包引用缺失或重复，不能只执行其余结果');
    if (selected[collection].has(key)) return;
    selected[collection].add(key);
    pending.push({ value: matches[0], path: `${root}.${collection}.${key}`, collection });
  };
  const ownSkill = (owner: unknown, path: string) => {
    if (owner != null && owner !== skillKey) fail(path, '必要闭包需要跨技能执行，必须由主负责人核定真实开启来源，不能借只读定义授予执行');
  };
  const visit = (value: unknown, path: string, ownActiveHit = false): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`, ownActiveHit));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (row.conditionType === 'INTERNAL_STATE_CHECK' && /\.conditionGroups\[\d+\]\.conditions\[\d+\]$/.test(path)) {
      const detail = row.detail as Record<string, unknown> | undefined;
      if (detail && detail.stateSkillKey !== undefined && detail.stateSkillKey !== skillKey) {
        if (!ownActiveHit || typeof detail.stateSkillKey !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.stateSkillKey)
          || typeof detail.stateKey !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.stateKey) || detail.valueKind !== 'VALUE'
          || detail.optionKey !== null || detail.expectedBoolean !== null
          || !['LT', 'LTE', 'EQ', 'NE', 'GTE', 'GT'].includes(String(detail.comparator)) || !detail.comparisonValue
          || Object.keys(row).some(key => !['conditionKey', 'conditionType', 'sortOrder', 'detail'].includes(key))
          || Object.keys(detail).some(key => !['stateSkillKey', 'stateKey', 'valueKind', 'optionKey', 'expectedBoolean', 'comparator', 'comparisonValue'].includes(key))) {
          fail(path, '跨技能状态闭包只接受实际自身技能命中的明确普通目标计数只读条件');
        }
        // 定义由同拥有者只读解析器验证；这里不加入外部状态、过程或监听执行集合。
        visit(detail.comparisonValue, `${path}.detail.comparisonValue`, false);
        return;
      }
    }
    if (row.stateType === 'COUNTER') {
      const detail = row.detail as Record<string, unknown> | undefined;
      const timing = detail?.targetTiming as Record<string, unknown> | undefined;
      if (timing && typeof timing === 'object' && ['PHASED_TICK', 'EXPIRY_PAYLOAD'].includes(String(timing.kind))) {
        include('processes', timing.processKey, `${path}.detail.targetTiming.processKey`);
      }
    }
    if (row.eventType === 'SKILL_HIT') {
      const detail = row.detail as Record<string, unknown> | undefined;
      const moment = detail?.processMoment as Record<string, unknown> | undefined;
      if (moment) include('processes', moment.processKey, `${path}.detail.processMoment.processKey`);
    }
    if (row.kind === 'PARAMETER' || row.kind === 'parameter') { ownSkill(row.skillKey, path); include('parameters', row.parameterKey, path); }
    if (row.kind === 'FORMULA') include('formulas', row.formulaKey, path);
    if (row.actionType === 'EXECUTE_EFFECT') {
      const detail = row.detail as Record<string, unknown> | undefined;
      include('effects', detail?.effectKey, `${path}.detail.effectKey`);
      producedEffects.add(String(detail?.effectKey));
    }
    if (['START_PROCESS', 'FAIL_PROCESS', 'ADVANCE_PROCESS'].includes(String(row.actionType))) {
      const detail = row.detail as Record<string, unknown> | undefined;
      include('processes', detail?.processKey, `${path}.detail.processKey`);
    }
    if (typeof row.stateKey === 'string' && row.stateSkillKey !== undefined) {
      ownSkill(row.stateSkillKey, `${path}.stateSkillKey`);
      include('internalStates', row.stateKey, `${path}.stateKey`);
      if (typeof row.operation === 'string') producedStates.add(row.stateKey);
    }
    if (typeof row.effectKey === 'string' && row.effectSkillKey !== undefined) {
      ownSkill(row.effectSkillKey, `${path}.effectSkillKey`);
      include('effects', row.effectKey, `${path}.effectKey`);
    }
    if (typeof row.sourceEffectKey === 'string') {
      ownSkill(row.effectSkillKey, `${path}.effectSkillKey`);
      include('effects', row.sourceEffectKey, `${path}.sourceEffectKey`);
    }
    if (typeof row.bindingKey === 'string' && typeof row.effectKey === 'string') {
      include('effects', row.effectKey, `${path}.effectKey`);
      producedEffects.add(row.effectKey);
    }
    if (row.resultType === 'STATUS_OPERATION') {
      const detail = row.detail as Record<string, unknown> | undefined;
      if (typeof detail?.statusKey === 'string') producedStatuses.add(detail.statusKey);
    }
    if (row.resultType === 'LIFECYCLE_OPERATION') {
      const detail = row.detail as Record<string, unknown> | undefined;
      if (detail?.operation === 'ENSURE_REMAINING') include('effects', detail.targetEffectKey, `${path}.detail.targetEffectKey`);
    }
    Object.entries(row).forEach(([field, child]) => {
      if (field !== 'eventSource' || (child as { eventType?: string } | null)?.eventType === 'SKILL_HIT') visit(child, `${path}.${field}`, ownActiveHit);
    });
  };
  if (!rootKeys.length || new Set(rootKeys).size !== rootKeys.length) fail(root, '自然根集合缺失或重复');
  rootKeys.forEach(key => include('triggerRules', key, `${root}.enabledRuleKeys`));
  let expanded = true;
  while (expanded) {
    while (pending.length) {
      const next = pending.shift()!;
      const rule = next.collection === 'triggerRules' ? next.value as SkillConfiguration['triggerRules'][number] : null;
      const ownActiveHit = rule?.eventSource.eventType === 'SKILL_HIT' && rule.eventSource.detail.sourceSkillKey === skillKey;
      visit(next.value, next.path, ownActiveHit);
    }
    expanded = false;
    for (const rule of configuration.triggerRules) {
      if (selected.triggerRules.has(rule.ruleKey)) continue;
      const event = rule.eventSource;
      if (event.eventType === 'RESULT_AVAILABLE' && producedEffects.has(event.detail.effectKey)
        && !configuration.effects.some(effect => effect.effectKey === event.detail.effectKey
          && effect.results.some(result => result.resultKey === event.detail.resultKey))) {
        fail(`${root}.triggerRules.${rule.ruleKey}.eventSource`, '必要结果尾规则引用缺失的并列结果，不能静默跳过');
      }
      const subscribed = event.eventType === 'PROCESS_MOMENT' && selected.processes.has(event.detail.processKey)
        || event.eventType === 'LIFECYCLE_MOMENT' && producedEffects.has(event.detail.effectKey)
        || event.eventType === 'RESULT_AVAILABLE' && producedEffects.has(event.detail.effectKey)
          && configuration.effects.some(effect => effect.effectKey === event.detail.effectKey
            && effect.results.some(result => result.resultKey === event.detail.resultKey))
        || event.eventType === 'SPELL_SHIELD_BLOCKED' && producedEffects.has(event.detail.shieldEffectKey)
          && configuration.effects.some(effect => effect.effectKey === event.detail.shieldEffectKey
            && effect.results.some(result => result.resultType === 'SPELL_SHIELD'))
        || event.eventType === 'INTERNAL_STATE_CHANGED' && producedStates.has(event.detail.stateKey)
          && event.detail.stateSkillKey === skillKey
        || event.eventType === 'STATUS_CHANGED' && producedStatuses.has(event.detail.statusKey);
      if (subscribed) {
        include('triggerRules', rule.ruleKey, `${root}.triggerRules.${rule.ruleKey}`);
        expanded = true;
      }
    }
  }
  const closure: SkillConfiguration = { ...configuration,
    parameters: configuration.parameters.filter(row => selected.parameters.has(row.parameterKey)),
    formulas: configuration.formulas.filter(row => selected.formulas.has(row.formulaKey)),
    effects: configuration.effects.filter(row => selected.effects.has(row.effectKey)),
    processes: configuration.processes.filter(row => selected.processes.has(row.processKey)),
    internalStates: configuration.internalStates.filter(row => selected.internalStates.has(row.stateKey)),
    triggerRules: configuration.triggerRules.filter(row => selected.triggerRules.has(row.ruleKey)) };
  return { configuration: closure, excludedRuleKeys: configuration.triggerRules.filter(row => !selected.triggerRules.has(row.ruleKey)).map(row => row.ruleKey) };
}
