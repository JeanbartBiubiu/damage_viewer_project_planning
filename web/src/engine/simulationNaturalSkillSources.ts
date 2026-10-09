import type { ModifierDefinition, ProviderDefinition } from '../types/genericEngine';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectResult } from '../types/skillEffect';
import type { SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { validateSimulationSkillSourceManifest, type TriggeredSkillSourceDescription } from './simulationSkillSourceDescription';
import { assembleTriggeredSkillSources } from './simulationTriggeredEquipment';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';
import { naturalRuleKeys, sourceIsPlanned } from './simulationSkillSourceDescription';
export { executableEquipmentRelations, validateSimulationSkillSourceManifest, equipmentSourceEnabled } from './simulationSkillSourceDescription';
import { compileNumericValue, constExpr, createNumericCompileState, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression } from './numericAdapter';
import type { SimulationCoverage } from './simulationAdapter';
import { permanentAttributeConversion, type SimulationAttributeDerivation } from './simulationAttributeConversion';

type Side = 'source' | 'target';
export type SimulationSkillOriginTrace = SimulationSkillSource & {
  side: Side; providerRef?: string; definitionRef?: string;
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

function validatePermanentEffect(effect: SkillConfiguration['effects'][number], effectPath: string, snapshot: SimulationSnapshot, configuration: SkillConfiguration, source: SimulationSkillSource, side: Side) {
  const life = effect.lifecycle;
  if (!life || life.instanceScope !== 'SOURCE' || life.expiryMode !== 'EXPLICIT_ONLY' || life.durationValue !== null
    || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null || life.endWhenShieldEndsResultKey != null
    || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== null
    || effect.results.length === 0) {
    fail(`${effectPath}.lifecycle`, '5A需要来源范围、永久单层、无周期的完整效果');
  }
  const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey: source.skillKey, skillLevel: source.skillLevel!, characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters, formulas: configuration.formulas, formulaNamespace: `${side}/${source.skillKey}`, bindParameters: false, allowAttributeReads: false, runtimeInputMessage: '常驻层数不能读取计算时输入' });
  for (const field of ['maxStacksValue', 'applicationStacksValue'] as const) if (tryFoldConstant(compileNumericValue(life![field], effectPath + '.lifecycle.' + field, numeric, fail)) !== 1) fail(effectPath, '常驻层数须由原生核定恒1');

}

function permanentModifier(snapshot: SimulationSnapshot, configuration: SkillConfiguration, source: SimulationSkillSource,
  side: Side, result: SkillEffectResult, path: string): ModifierDefinition | SimulationAttributeDerivation {
  const behavior = result.lifecycleBehavior;
  if (!['ATTRIBUTE_CHANGE', 'HEALING_MODIFIER', 'SHIELD_RECEIVED_MODIFIER'].includes(result.resultType)
    || result.valueRule === null) fail(path, '该完整常驻结果尚未进入5A，不能只执行其它结果');
  if (result.target !== 'SOURCE' || result.spellShieldBlockScope !== null || !behavior || behavior.moment !== 'PERSISTENT'
    || behavior.valueReadMode === null || !['APPLICATION_SNAPSHOT', 'MOMENT_EVALUATION'].includes(behavior.valueReadMode)
    || behavior.stackValueMode !== 'SHARED' || ![null, 'REPLACE'].includes(behavior.reapplicationValueMode)
    || behavior.periodicExecutionMode !== null) fail(path, '5A只接入完整永久自身常驻结果');
  const conversion = permanentAttributeConversion(snapshot, configuration, source, side, result, path);
  if (conversion) return conversion;
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
  const derivations: SimulationAttributeDerivation[] = [];
  const descriptions: TriggeredSkillSourceDescription[] = [];
  for (const side of ['source', 'target'] as const) {
    const sources = structuredClone(snapshot[side].skillSources).sort((left, right) => {
      const leftKey = simulationSkillSourceIdentity(left.origin, left.skillKey);
      const rightKey = simulationSkillSourceIdentity(right.origin, right.skillKey);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    for (const [sourceIndex, storedSource] of sources.entries()) {
      const source = structuredClone(storedSource);
      const root = `${side}.skillSources[${sourceIndex}]`;
      const trace: SimulationSkillOriginTrace = { ...structuredClone(source), side };
      origins.push(trace);
      if (sourceIsPlanned(snapshot, side, source)) {
        trace.providerRef = `${side}_natural_skill_${sourceIndex}`;
        trace.definitionRef = `${trace.providerRef}_definition`;
        const roots = naturalRuleKeys(snapshot, snapshot.skillConfigurations.find(row => row.skill.skillKey === source.skillKey)!, side);
        if (!roots.length) continue;
        source.enabledRuleKeys = roots;
      }
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
      if (source.inactiveReason === 'NO_AUTONOMOUS_ATTACK') {
        coverage.push({ authorPath: root, compiledPath: 'runtimeOptions.skillOrigins', note: '保留真实绑定，本场不驱动该来源的攻击开始、命中或原生联动，不生成挂载、状态或监听' });
        continue;
      }
      if (source.inactiveReason === 'ACTIVE_DEFERRED') {
        coverage.push({ authorPath: root, compiledPath: 'runtimeOptions.skillOrigins', note: '保留绑定，本期没有该来源主动施放' });
        continue;
      }
      if (source.origin.kind === 'EQUIPMENT') continue;
      if (source.inactiveReason === 'LEVEL_REQUIRED' || source.skillLevel === null) fail(`${root}.skillLevel`, '默认来源已启用，必须明确本次已学等级');
      if (source.inactiveReason === 'CONFIGURATION_INCOMPLETE' || source.enabledRuleKeys.length === 0) fail(root, '默认自然技能只有资料或参数，需补完整程序或显式关闭该来源');
      const configurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey === source.skillKey);
      if (configurations.length !== 1) fail(root, '自然来源缺少完整作者配置');
      const completeConfiguration = configurations[0]!;
      const { configuration, excludedRuleKeys } = selectSimulationSkillSourceClosure(completeConfiguration, source.enabledRuleKeys);
      for (const ruleKey of excludedRuleKeys) coverage.push({ authorPath: `skills.${source.skillKey}.triggerRules.${ruleKey}`,
        compiledPath: 'runtimeOptions.skillOrigins', note: '独立主动兄弟暂缓或所需事件未产生，不加入自然执行闭包；完整作者配置保留' });
      if (!Number.isInteger(source.skillLevel) || source.skillLevel < 1 || source.skillLevel > configuration.skill.maxLevel) fail(`${root}.skillLevel`, '已学等级超出真实定义');
      const providerRef = `${side}_natural_skill_${sourceIndex}`;
      const definitionRef = `${providerRef}_definition`;
      const initializer: ProviderDefinition = { providerKey: definitionRef, skillKey: source.skillKey, stableId: definitionRef,
        kind: source.origin.kind === 'CHARACTER' ? 'character' : 'build', listeners: [] };
      trace.providerRef = providerRef;
      trace.definitionRef = definitionRef;
      const permanentInitialization = source.enabledRuleKeys.every(key => {
        const rule = configuration.triggerRules.find(row => row.ruleKey === key)!;
        return rule.actions.every(action => action.actionType === 'EXECUTE_EFFECT')
          && rule.eventSource.eventType === 'SOURCE_INITIALIZED' && rule.conditionGroups.length === 0
          && rule.oncePerUse === null && rule.perTargetCooldown === null && rule.maxTriggersPerProcess === null;
      }) && configuration.effects.length > 0 && configuration.effects.every(effect => effect.lifecycle?.expiryMode === 'EXPLICIT_ONLY');
      if (!permanentInitialization) {
        descriptions.push({ side, kind: source.origin.kind === 'CHARACTER' ? 'character' : 'build',
          stableId: definitionRef, providerRef, definitionRef, path: root, skills: [{
            skillKey: source.skillKey, skillLevel: source.skillLevel, path: root, configuration,
            allowedRootKeys: source.enabledRuleKeys, permanentModifier: (result, resultPath) => {
              const effect = configuration.effects.find(row => row.results.includes(result))!;
              validatePermanentEffect(effect, `skills.${source.skillKey}.effects.${effect.effectKey}`, snapshot, configuration, source, side);
              const modifier = permanentModifier(snapshot, configuration, source, side, result, resultPath);
              if ('combatantKey' in modifier) fail(resultPath, '属性转换只允许完整无条件初始化，不能改为动态触发');
              return modifier;
            }
          }] });
        continue;
      }
      const necessaryTail = configuration.triggerRules.find(rule => !source.enabledRuleKeys.includes(rule.ruleKey));
      if (necessaryTail) fail(`skills.${source.skillKey}.triggerRules.${necessaryTail.ruleKey}`,
        '完整初始化必要事件尾规则尚未接入5A，不能只执行属性部分');
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
          validatePermanentEffect(effect, effectPath, snapshot, configuration, source, side);
          for (const result of [...effect.results].sort((left, right) => left.sortOrder - right.sortOrder)) {
            const resultPath = `${effectPath}.results.${result.resultKey}`;
            const modifier = permanentModifier(snapshot, configuration, source, side, result, resultPath);
            if ('combatantKey' in modifier) {
              const index = derivations.length;
              derivations.push(modifier);
              required[side].add(modifier.attributeKey);
              const collect = (expression: typeof modifier.value) => {
                const read = /^(source|target)\.attr\.([a-z][a-z0-9_]*)\./.exec(expression.path ?? '');
                if (read) required[read[1] as Side].add(read[2]!);
                expression.args?.forEach(collect);
              };
              collect(modifier.value);
              coverage.push({ authorPath: resultPath, compiledPath: `rules.attributeDerivations[conversion_${index}]` });
              continue;
            }
            const effectRef = `${providerRef}_effect_${providers.length}`;
            providers.push({ providerKey: effectRef, skillKey: source.skillKey, stableId: effectRef, kind: 'status', modifiers: [modifier] });
            operations.push({ operation: 'apply_provider', target: 'self', providerDefinitionRef: effectRef, providerRef: effectRef });
            coverage.push({ authorPath: resultPath, compiledPath: `sharedProviders[${effectRef}].modifiers[0]` });
            if (result.resultType === 'ATTRIBUTE_CHANGE') {
              const attributeKey = String(result.detail.attributeKey);
              required[side].add(attributeKey);
              if (attributeKey === 'bonus_attack_speed_percent') derivationSides.add(side);
            }
          }
        }
        if (operations.length) initializer.listeners!.push({ listenerKey: rule.ruleKey, eventMatcher: { all: ['event/source_initialized', 'event/source_owner'] },
          operations, maxTriggersPerEvent: 1 });
        coverage.push({ authorPath: rulePath, compiledPath: `sharedProviders[${definitionRef}]` });
      }
      providers.push(initializer);
      mounts.push({ side, providerRef, definitionRef });
    }
  }
  const triggered = assembleTriggeredSkillSources(snapshot, descriptions);
  providers.push(...triggered.providers);
  mounts.push(...triggered.mounts);
  coverage.push(...triggered.coverage);
  for (const side of ['source', 'target'] as const) {
    for (const key of triggered.required[side]) required[side].add(key);
    if (triggered.derivationSides.has(side)) derivationSides.add(side);
  }
  return { providers, mounts, origins, coverage, required, derivationSides, derivations, triggered };
}
