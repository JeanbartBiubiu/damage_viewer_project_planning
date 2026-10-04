import type { ModifierDefinition, ProviderDefinition } from '../types/genericEngine';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectResult } from '../types/skillEffect';
import type { SimulationSkillOrigin, SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { compileNumericValue, constExpr, createNumericCompileState, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression } from './numericAdapter';
import type { SimulationCoverage } from './simulationAdapter';

type Side = 'source' | 'target';
export type SimulationSkillOriginTrace = SimulationSkillSource & {
  side: Side; providerRef?: string; definitionRef?: string;
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

function naturalRuleKeys(snapshot: SimulationSnapshot, configuration: SkillConfiguration, side: Side) {
  const allSides = new Set(['SOURCE_INITIALIZED', 'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN']);
  const attackSide = new Set(['BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED']);
  return configuration.triggerRules.filter(rule => {
    if (!rule.actions.length) return false;
    const event = rule.eventSource;
    if (allSides.has(event.eventType)) return true;
    if (attackSide.has(event.eventType)) return side === 'source';
    if (event.eventType === 'BASIC_ATTACK_RECEIVED') return side === 'target';
    if (event.eventType === 'SKILL_USED' || event.eventType === 'SKILL_HIT') {
      return side === 'source' && event.detail.sourceSkillKey === snapshot.selection.basicAttackSkillKey
        && (event.eventType !== 'SKILL_USED' || event.detail.castPhase === 'INITIAL');
    }
    return false;
  }).map(rule => rule.ruleKey).sort();
}

export function executableEquipmentRelations(snapshot: SimulationSnapshot, side: Side, equipmentKey: string) {
  const item = snapshot[side].selectedEquipment.find(row => row.equipment.equipmentKey === equipmentKey);
  if (!item) fail(`${side}.selectedEquipment`, '缺少实际所选装备');
  return item.attachedSkills.filter(relation => {
    const matches = snapshot[side].skillSources.filter(source => source.origin.kind === 'EQUIPMENT'
      && source.origin.equipmentKey === equipmentKey && source.skillKey === relation.skillKey);
    if (matches.length !== 1) fail(`${side}.skillSources`, '装备绑定技能的默认来源缺失或重复');
    return matches[0]!.enabled && matches[0]!.skillStatus === 'ENABLED' && matches[0]!.skillLevel !== 0;
  });
}

function sourceRelations(snapshot: SimulationSnapshot, side: Side) {
  const expected = new Set<string>();
  for (const relation of snapshot[side].attachedSkills) {
    expected.add(simulationSkillSourceIdentity({ kind: 'CHARACTER', characterKey: snapshot[side].character.characterKey }, relation.skillKey));
  }
  for (const item of snapshot[side].selectedEquipment) for (const relation of item.attachedSkills) {
    expected.add(simulationSkillSourceIdentity({ kind: 'EQUIPMENT', equipmentKey: item.equipment.equipmentKey }, relation.skillKey));
  }
  for (const selected of snapshot[side].selectedBuilds) for (const choice of selected.configuration.selections) {
    for (const relation of selected.definition.skillRelations.filter(row => row.optionKey === choice.optionKey && row.activationRank <= choice.rank)) {
      expected.add(simulationSkillSourceIdentity({ kind: 'BUILD_OPTION', systemKey: selected.definition.system.systemKey,
        roleKey: choice.roleKey, groupKey: choice.groupKey, slotKey: choice.slotKey, optionKey: choice.optionKey }, relation.skillKey));
    }
  }
  return expected;
}

export function validateSimulationSkillSourceManifest(snapshot: SimulationSnapshot) {
  const configurations = new Map(snapshot.skillConfigurations.map(row => [row.skill.skillKey, row]));
  if (configurations.size !== snapshot.skillConfigurations.length) fail('skillConfigurations', '完整作者配置不能重复');
  const allowedConfigurations = new Set([snapshot.selection.basicAttackSkillKey,
    ...snapshot.references.map(row => row.targetSkillKey).filter(Boolean)]);
  for (const side of ['source', 'target'] as const) {
    if (!Array.isArray(snapshot[side].skillSources) || !Array.isArray(snapshot[side].selectedBuilds)) {
      fail(side, '缺少阶段5默认来源及构筑清单');
    }
    const expected = sourceRelations(snapshot, side);
    const actual = new Set<string>();
    const settings = snapshot.selection[`${side}SkillSettings`];
    if (!Array.isArray(settings)) fail(`selection.${side}SkillSettings`, '来源覆盖设置必须明确提供数组');
    for (const source of snapshot[side].skillSources) {
      const identity = simulationSkillSourceIdentity(source.origin, source.skillKey);
      if (!expected.has(identity) || actual.has(identity)) fail(`${side}.skillSources`, '默认来源与原始绑定不一致或重复');
      actual.add(identity);
      allowedConfigurations.add(source.skillKey);
      if (typeof source.enabled !== 'boolean' || !Array.isArray(source.enabledRuleKeys)) fail(`${side}.skillSources`, '来源开关或自然入口缺失');
      const overrides = settings.filter(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
      if (overrides.length > 1 || source.enabled !== (overrides[0]?.enabled ?? true)) fail(`${side}.skillSources`, '来源开关与明确场景设置不一致');
      const configuration = configurations.get(source.skillKey);
      if (source.skillStatus === 'ENABLED' && (!configuration || configuration.skill.status !== 'ENABLED')) {
        fail(`${side}.skillSources.${source.skillKey}`, '完整启用作者配置缺失或全局状态不一致');
      }
      if (source.enabled && source.skillStatus === 'ENABLED' && source.skillLevel !== 0 && configuration) {
        const selectedPrimary = side === 'source' && source.origin.kind === 'CHARACTER'
          && source.skillKey === snapshot.selection.basicAttackSkillKey;
        if (source.inactiveReason === 'NO_AUTONOMOUS_ATTACK' && (source.origin.kind !== 'CHARACTER'
          || selectedPrimary || !configuration.skill.skillCategoryKeys.includes('basic_attack'))) {
          fail(`${side}.skillSources.${source.skillKey}`, '无自主普攻排除原因与真实主体不一致');
        }
        const roots = naturalRuleKeys(snapshot, configuration, side);
        if (source.inactiveReason === 'ACTIVE_DEFERRED' && (roots.length
          || !configuration.triggerRules.some(rule => ['SKILL_USED', 'SKILL_HIT'].includes(rule.eventSource.eventType)))) {
          fail(`${side}.skillSources.${source.skillKey}`, '主动后置原因不能隐藏真实自然入口');
        }
        if (source.origin.kind !== 'EQUIPMENT' && source.inactiveReason === null
          && (source.enabledRuleKeys.length !== roots.length || source.enabledRuleKeys.some(key => !roots.includes(key)))) {
          fail(`${side}.skillSources.${source.skillKey}`, '开启来源必须完整保留真实自然入口');
        }
      }
    }
    if (actual.size !== expected.size) fail(`${side}.skillSources`, '默认来源不能被过滤为部分绑定');
    if (settings.some(row => !expected.has(simulationSkillSourceIdentity(row.origin, row.skillKey)))) fail(`selection.${side}SkillSettings`, '覆盖设置不能授予额外未绑定技能');
  }
  for (const configuration of snapshot.skillConfigurations) if (!allowedConfigurations.has(configuration.skill.skillKey)
    || configuration.skill.gameId !== snapshot.gameId) fail('skillConfigurations', '配置集合只能包含默认来源及实际只读依赖');
}

function permanentModifier(snapshot: SimulationSnapshot, configuration: SkillConfiguration, source: SimulationSkillSource,
  side: Side, result: SkillEffectResult, path: string): ModifierDefinition {
  const behavior = result.lifecycleBehavior;
  if (!['ATTRIBUTE_CHANGE', 'HEALING_MODIFIER', 'SHIELD_RECEIVED_MODIFIER'].includes(result.resultType)
    || result.valueRule === null) fail(path, '该完整常驻结果尚未进入5A，不能只执行其它结果');
  if (result.target !== 'SOURCE' || result.spellShieldBlockScope !== null || !behavior || behavior.moment !== 'PERSISTENT'
    || behavior.valueReadMode === null || !['APPLICATION_SNAPSHOT', 'MOMENT_EVALUATION'].includes(behavior.valueReadMode)
    || behavior.stackValueMode !== 'SHARED' || ![null, 'REPLACE'].includes(behavior.reapplicationValueMode)
    || behavior.periodicExecutionMode !== null) fail(path, '5A只接入完整永久自身常驻结果');
  const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey: source.skillKey,
    skillLevel: source.skillLevel!, characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters,
    formulas: configuration.formulas, formulaNamespace: `${side}/${source.skillKey}`, bindParameters: false,
    allowAttributeReads: false, runtimeInputMessage: '5A常驻需要明确的等级或静态参数，不猜计算时输入' });
  const value = tryFoldConstant(wrapValueRuleExpression(compileNumericValue(result.valueRule.value, `${path}.valueRule.value`, numeric, fail), result.valueRule));
  if (value === null || !Number.isFinite(value)) fail(`${path}.valueRule`, '5A常驻数值必须可由明确等级和配置求为有限常量');
  if (result.resultType !== 'ATTRIBUTE_CHANGE' && result.resultType !== 'HEALING_MODIFIER'
    && result.resultType !== 'SHIELD_RECEIVED_MODIFIER') fail(path, '5A只接入自身属性、受到治疗或护盾修正');
  const zone = snapshot.catalogs.modifierZones.find(row => row.modifierZoneKey === result.detail.modifierZoneKey && row.status === 'ENABLED');
  if (!zone) fail(`${path}.detail.modifierZoneKey`, '缺少真实启用修正区域');
  if (result.resultType === 'ATTRIBUTE_CHANGE') {
    const attributeKey = result.detail.attributeKey;
    if (typeof attributeKey !== 'string' || !snapshot.catalogs.attributes.some(row => row.attributeKey === attributeKey && row.status === 'ENABLED')) {
      fail(`${path}.detail.attributeKey`, '缺少真实启用属性目录');
    }
    if (attributeKey === 'hp') fail(path, '5A首批尚未接入常驻生命上限修正，不能丢弃该结果');
    if (zone.domain !== 'ATTRIBUTE' || !['INCREASE', 'DECREASE'].includes(result.detail.operation)) fail(path, '自身属性修正声明不完整');
    const signed = result.detail.operation === 'DECREASE' ? -value : value;
    const policy = zone.calculationMode === 'FLAT_ADD' ? 'add' : zone.calculationMode === 'RATIO_ADD' ? 'add_percent' : undefined;
    if (!policy) fail(path, '5A只接入明确的加算或比例修正');
    return { modifierKey: result.resultKey, kind: 'attribute', target: `self.attr.${attributeKey}`,
      valuePolicy: policy, value: constExpr(signed), bucket: zone.modifierZoneKey };
  }
  if (result.resultType === 'HEALING_MODIFIER' && result.detail.direction === 'RECEIVED' && result.detail.healingKind === 'ANY'
    && result.detail.operation === 'INCREASE' && zone.domain === 'HEALING' && zone.calculationMode === 'RATIO_ADD') {
    return { modifierKey: result.resultKey, kind: 'pipeline', command: 'heal', healDirection: 'RECEIVED', healCategory: 'ANY',
      healGroupKey: zone.modifierZoneKey, healGroupCalculationMode: 'ratio_add', valuePolicy: 'add_percent', value: constExpr(value) };
  }
  if (result.resultType === 'SHIELD_RECEIVED_MODIFIER' && result.detail.operation === 'INCREASE'
    && zone.domain === 'SHIELD' && zone.calculationMode === 'RATIO_ADD') {
    return { modifierKey: result.resultKey, kind: 'pipeline', command: 'shield', channel: 'normal_shield', stage: 'received',
      bucket: zone.modifierZoneKey, valuePolicy: 'add_percent', value: constExpr(value) };
  }
  return fail(path, '该完整常驻结果尚未进入5A，不能只执行其它结果');
}

export function assembleNaturalSkillSources(snapshot: SimulationSnapshot) {
  validateSimulationSkillSourceManifest(snapshot);
  const providers: ProviderDefinition[] = [];
  const mounts: Array<{ side: Side; providerRef: string; definitionRef: string }> = [];
  const origins: SimulationSkillOriginTrace[] = [];
  const coverage: SimulationCoverage[] = [];
  const required: Record<Side, Set<string>> = { source: new Set(), target: new Set() };
  const derivationSides = new Set<Side>();
  for (const side of ['source', 'target'] as const) {
    const sources = [...snapshot[side].skillSources].sort((left, right) => {
      const leftKey = simulationSkillSourceIdentity(left.origin, left.skillKey);
      const rightKey = simulationSkillSourceIdentity(right.origin, right.skillKey);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    for (const [sourceIndex, source] of sources.entries()) {
      const root = `${side}.skillSources[${sourceIndex}]`;
      const trace: SimulationSkillOriginTrace = { ...structuredClone(source), side };
      origins.push(trace);
      const selectedPrimary = side === 'source' && source.origin.kind === 'CHARACTER'
        && source.skillKey === snapshot.selection.basicAttackSkillKey;
      if (selectedPrimary) {
        if (!source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel !== snapshot.selection.basicAttackLevel) {
          fail(root, '所选普通攻击来源被禁用或等级不一致，不能自动改用其它主体');
        }
        continue;
      }
      if (!source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel === 0) {
        coverage.push({ authorPath: root, compiledPath: 'runtimeOptions.skillOrigins', note: '真实绑定保留，本场关闭、全局禁用或未学，不生成执行程序' });
        continue;
      }
      if (source.inactiveReason === 'NO_AUTONOMOUS_ATTACK' || source.inactiveReason === 'ACTIVE_DEFERRED') {
        coverage.push({ authorPath: root, compiledPath: 'runtimeOptions.skillOrigins', note: '保留绑定，本期没有该来源自主攻击或主动施放' });
        continue;
      }
      if (source.origin.kind === 'EQUIPMENT') continue;
      if (source.inactiveReason === 'LEVEL_REQUIRED' || source.skillLevel === null) fail(`${root}.skillLevel`, '默认来源已启用，必须明确本次已学等级');
      if (source.inactiveReason === 'CONFIGURATION_INCOMPLETE' || source.enabledRuleKeys.length === 0) fail(root, '默认自然技能只有资料或参数，需补完整程序或显式关闭该来源');
      const configurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey === source.skillKey);
      if (configurations.length !== 1) fail(root, '自然来源缺少完整作者配置');
      const configuration = configurations[0]!;
      if (!Number.isInteger(source.skillLevel) || source.skillLevel < 1 || source.skillLevel > configuration.skill.maxLevel) fail(`${root}.skillLevel`, '已学等级超出真实定义');
      const providerRef = `${side}_natural_skill_${sourceIndex}`;
      const definitionRef = `${providerRef}_definition`;
      const initializer: ProviderDefinition = { providerKey: definitionRef, stableId: definitionRef,
        kind: source.origin.kind === 'CHARACTER' ? 'character' : 'build', listeners: [] };
      trace.providerRef = providerRef;
      trace.definitionRef = definitionRef;
      for (const ruleKey of source.enabledRuleKeys) {
        const rules = configuration.triggerRules.filter(row => row.ruleKey === ruleKey);
        if (rules.length !== 1) fail(`${root}.enabledRuleKeys`, '自然规则缺失或重复');
        const rule = rules[0]!;
        const rulePath = `skills.${source.skillKey}.triggerRules.${ruleKey}`;
        if (rule.eventSource.eventType !== 'SOURCE_INITIALIZED' || Object.keys(rule.eventSource.detail).length
          || rule.conditionGroups.length || rule.oncePerUse !== null || rule.perTargetCooldown !== null
          || rule.maxTriggersPerProcess !== null || rule.actions.length === 0) fail(rulePath, '5A只开放无条件自身初始化，其它自然触发留5B／5C');
        const operations = [];
        for (const action of [...rule.actions].sort((left, right) => left.sortOrder - right.sortOrder)) {
          if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'EVENT_SOURCE'
            || action.resultModifiers.length || action.runtimeInputBindings.length) fail(`${rulePath}.actions.${action.actionKey}`, '初始化动作必须完整作用于事件来源自身');
          const effects = configuration.effects.filter(row => row.effectKey === action.detail.effectKey);
          if (effects.length !== 1) fail(rulePath, '初始化引用效果缺失或重复');
          const effect = effects[0]!;
          const effectPath = `skills.${source.skillKey}.effects.${effect.effectKey}`;
          for (const subscriber of configuration.triggerRules) {
            const event = subscriber.eventSource;
            const resultTail = event.eventType === 'RESULT_AVAILABLE' && event.detail.effectKey === effect.effectKey
              && effect.results.some(result => result.resultKey === event.detail.resultKey);
            const lifecycleTail = event.eventType === 'LIFECYCLE_MOMENT' && event.detail.effectKey === effect.effectKey
              && ['APPLICATION', 'FULL_STACKS', 'EARLY_REMOVE'].includes(event.detail.moment);
            if (resultTail || lifecycleTail) fail(`${effectPath}.triggerRules.${subscriber.ruleKey}`,
              '完整初始化效果的结果或生命周期尾规则尚未接入5A，不能只执行属性部分');
          }
          const life = effect.lifecycle;
          if (!life || life.instanceScope !== 'SOURCE' || life.expiryMode !== 'EXPLICIT_ONLY' || life.durationValue !== null
            || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null || life.endWhenShieldEndsResultKey != null
            || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== null
            || life.maxStacksValue.kind !== 'FIXED' || life.maxStacksValue.value !== 1
            || life.applicationStacksValue.kind !== 'FIXED' || life.applicationStacksValue.value !== 1 || effect.results.length === 0) {
            fail(`${effectPath}.lifecycle`, '5A需要来源范围、永久单层、无周期的完整效果');
          }
          for (const result of [...effect.results].sort((left, right) => left.sortOrder - right.sortOrder)) {
            const resultPath = `${effectPath}.results.${result.resultKey}`;
            const modifier = permanentModifier(snapshot, configuration, source, side, result, resultPath);
            const effectRef = `${providerRef}_effect_${providers.length}`;
            providers.push({ providerKey: effectRef, stableId: effectRef, kind: 'status', modifiers: [modifier] });
            operations.push({ operation: 'apply_provider', target: 'self', providerDefinitionRef: effectRef, providerRef: effectRef });
            coverage.push({ authorPath: resultPath, compiledPath: `sharedProviders[${effectRef}].modifiers[0]` });
            if (result.resultType === 'ATTRIBUTE_CHANGE') {
              const attributeKey = String(result.detail.attributeKey);
              required[side].add(attributeKey);
              if (attributeKey === 'bonus_attack_speed_percent') derivationSides.add(side);
            }
          }
        }
        initializer.listeners!.push({ listenerKey: rule.ruleKey, eventMatcher: { all: ['event/source_initialized', 'event/source_owner'] },
          operations, maxTriggersPerEvent: 1 });
        coverage.push({ authorPath: rulePath, compiledPath: `sharedProviders[${definitionRef}].listeners[${initializer.listeners!.length - 1}]` });
      }
      providers.push(initializer);
      mounts.push({ side, providerRef, definitionRef });
    }
  }
  return { providers, mounts, origins, coverage, required, derivationSides };
}

export function equipmentSourceEnabled(snapshot: SimulationSnapshot, side: Side, origin: SimulationSkillOrigin, skillKey: string) {
  const identity = simulationSkillSourceIdentity(origin, skillKey);
  const sources = snapshot[side].skillSources.filter(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
  if (sources.length !== 1) fail(`${side}.skillSources`, '来源开关缺失或重复');
  return sources[0]!.enabled && sources[0]!.skillStatus === 'ENABLED' && sources[0]!.skillLevel !== 0;
}
