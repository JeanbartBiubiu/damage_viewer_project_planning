import type { ProviderDefinition, ModifierDefinition } from '../types/genericEngine';
import type { SimulationEquipmentAssumption, SimulationSnapshot } from '../types/simulationSnapshot';
import {
  compileNumericValue, constExpr, createNumericCompileState, NumericAdaptationError,
  tryFoldConstant, wrapValueRuleExpression
} from './numericAdapter';

export const PERMANENT_EQUIPMENT_SKILLS: Record<string, string> = {
  item_3065: 'item_3065_passive', item_3110: 'item_3110_passive'
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

export function equipmentRangeRequirements(snapshot: SimulationSnapshot) {
  return (['source', 'target'] as const).flatMap(owner => snapshot[owner].selectedEquipment.filter(item =>
    item.equipment.equipmentKey === 'item_3110' || item.attachedSkills.some(relation => snapshot.skillConfigurations
      .find(configuration => configuration.skill.skillKey === relation.skillKey)?.effects.some(effect =>
        effect.lifecycle?.instanceScope === 'SOURCE' && effect.lifecycle.periodicIntervalValue !== null
        && effect.results.some(result => result.resultType === 'DAMAGE' && result.target === 'TARGET'))))
    .map(item => ({ owner, equipmentKey: item.equipment.equipmentKey, equipmentName: item.equipment.name })));
}

export function validateEquipmentAssumptions(snapshot: SimulationSnapshot, assumptions: readonly SimulationEquipmentAssumption[]) {
  const expected = equipmentRangeRequirements(snapshot);
  if (assumptions.length !== expected.length) fail('equipmentAssumptions', '每个静态光环或来源周期都必须明确确认唯一对手全程在范围内');
  for (const { owner, equipmentKey } of expected) {
    const rows = assumptions.filter(row => row.owner === owner && row.equipmentKey === equipmentKey);
    if (rows.length !== 1 || rows[0]!.target !== (owner === 'source' ? 'target' : 'source') || rows[0]!.inRange !== true) {
      fail(`equipmentAssumptions.${owner}.${equipmentKey}`, '范围目标必须为另一方，且必须明确确认全程在范围内');
    }
  }
  return structuredClone([...assumptions].sort((left, right) => left.owner.localeCompare(right.owner)));
}

export function assembleEquipmentPassives(snapshot: SimulationSnapshot) {
  const providers: ProviderDefinition[] = [];
  const mounts: Array<{ side: 'source' | 'target'; providerRef: string; definitionRef: string }> = [];
  const coverage: Array<{ authorPath: string; compiledPath: string }> = [];
  const required = { source: new Set<string>(), target: new Set<string>() };
  const selectedSkills = new Set([snapshot.selection.basicAttackSkillKey,
    ...snapshot.source.selectedEquipment.flatMap(item => item.attachedSkills.map(relation => relation.skillKey)),
    ...snapshot.target.selectedEquipment.flatMap(item => item.attachedSkills.map(relation => relation.skillKey))]);
  for (const side of ['source', 'target'] as const) {
    for (const item of snapshot[side].selectedEquipment) {
      const equipmentKey = item.equipment.equipmentKey;
      const expectedSkill = PERMANENT_EQUIPMENT_SKILLS[equipmentKey];
      if (!expectedSkill) continue;
      const path = `${side}.selectedEquipment[${equipmentKey}]`;
      if (item.attachedSkills.length !== 1 || item.attachedSkills[0]!.skillKey !== expectedSkill) {
        fail(`${path}.attachedSkills`, '常驻装备必须保留核定的完整被动关系，不能删掉被动仅取直接属性');
      }
      const configurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey === expectedSkill);
      if (configurations.length !== 1) fail(`${path}.attachedSkills`, '装备被动配置缺失或重复');
      const configuration = configurations[0]!;
      const root = `skills.${expectedSkill}`;
      selectedSkills.add(expectedSkill);
      if (configuration.skill.gameId !== snapshot.gameId || configuration.skill.status !== 'ENABLED'
        || configuration.skill.maxLevel !== 1 || !configuration.skill.skillCategoryKeys.includes('passive')
        || configuration.processes.length || configuration.internalStates.length || configuration.formulas.length) {
        fail(root, '4B仅接入完整单级、无过程、无内部状态的核定常驻被动');
      }
      const expectedTypes = equipmentKey === 'item_3065' ? ['HEALING_MODIFIER', 'SHIELD_RECEIVED_MODIFIER'] : ['ATTRIBUTE_CHANGE'];
      if (configuration.effects.length !== expectedTypes.length || configuration.triggerRules.length !== configuration.effects.length) {
        fail(`${root}.effects`, '常驻效果与初始化规则必须完整；未配置的光环不能作为已接入装备');
      }
      const sourceRef = `${side}_${equipmentKey}_passive`;
      const sourceDefinition = `${sourceRef}_definition`;
      const initializer: ProviderDefinition = { providerKey: sourceDefinition, stableId: `${side}_equipment_${equipmentKey}_definition`, kind: 'item', listeners: [] };
      mounts.push({ side, providerRef: sourceRef, definitionRef: sourceDefinition });
      const seenTypes = new Set<string>();
      const seenRules = new Set<string>();
      const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey: expectedSkill,
        skillLevel: 1, characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters,
        formulas: configuration.formulas, formulaNamespace: sourceRef, bindParameters: false,
        allowAttributeReads: false, runtimeInputMessage: '常驻初始化不允许未填写的运行时参数' });
      for (const [effectIndex, effect] of configuration.effects.entries()) {
        const effectPath = `${root}.effects.${effect.effectKey}`;
        const life = effect.lifecycle;
        if (!life || life.instanceScope !== 'SOURCE' || life.expiryMode !== 'EXPLICIT_ONLY' || life.durationValue !== null
          || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== null || life.periodicIntervalValue !== null
          || life.firstPeriodicExecution !== null || life.endWhenShieldEndsResultKey != null
          || life.maxStacksValue.kind !== 'FIXED' || life.maxStacksValue.value !== 1
          || life.applicationStacksValue.kind !== 'FIXED' || life.applicationStacksValue.value !== 1 || effect.results.length !== 1) {
          fail(`${effectPath}.lifecycle`, '4B常驻效果必须为来源范围、永久单层、无周期的完整效果');
        }
        const result = effect.results[0]!;
        const resultPath = `${effectPath}.results.${result.resultKey}`;
        const behavior = result.lifecycleBehavior;
        if (!expectedTypes.includes(result.resultType) || seenTypes.has(result.resultType) || result.spellShieldBlockScope !== null
          || !behavior || behavior.moment !== 'PERSISTENT' || behavior.valueReadMode !== 'APPLICATION_SNAPSHOT'
          || behavior.stackValueMode !== 'SHARED' || behavior.reapplicationValueMode !== 'REPLACE' || behavior.periodicExecutionMode !== null) {
          fail(resultPath, '常驻结果组成或生命周期行为未核定，整件装备拒绝');
        }
        seenTypes.add(result.resultType);
        if (result.resultType !== 'HEALING_MODIFIER' && result.resultType !== 'SHIELD_RECEIVED_MODIFIER' && result.resultType !== 'ATTRIBUTE_CHANGE') {
          fail(resultPath, '未接入的装备结果类型');
        }
        const ratio = tryFoldConstant(wrapValueRuleExpression(compileNumericValue(result.valueRule.value, `${resultPath}.valueRule.value`, numeric, fail), result.valueRule));
        if (ratio === null || !Number.isFinite(ratio) || ratio < 0) fail(`${resultPath}.valueRule`, '常驻比例必须来自明确的有限非负作者数值');
        const zone = snapshot.catalogs.modifierZones.find(row => row.modifierZoneKey === result.detail.modifierZoneKey && row.status === 'ENABLED');
        if (!zone || zone.calculationMode !== 'RATIO_ADD') fail(`${resultPath}.detail.modifierZoneKey`, '需要真实已启用的比例加算修正区');
        const definitionRef = `${sourceRef}_effect_${effectIndex}`;
        let modifier: ModifierDefinition;
        if (result.resultType === 'HEALING_MODIFIER') {
          if (result.target !== 'SOURCE' || result.detail.direction !== 'RECEIVED' || result.detail.healingKind !== 'ANY'
            || result.detail.operation !== 'INCREASE' || zone.domain !== 'HEALING' || zone.applicationStage !== 'HEALING_RESULT') fail(resultPath, '振奋必须完整接入拥有方收到的全部治疗增幅');
          modifier = { modifierKey: result.resultKey, kind: 'pipeline', command: 'heal', healDirection: 'RECEIVED',
            healCategory: 'ANY', healGroupKey: zone.modifierZoneKey, healGroupCalculationMode: 'ratio_add', valuePolicy: 'add_percent', value: constExpr(ratio) };
        } else if (result.resultType === 'SHIELD_RECEIVED_MODIFIER') {
          if (result.target !== 'SOURCE' || result.detail.operation !== 'INCREASE' || zone.domain !== 'SHIELD'
            || zone.applicationStage !== 'SHIELD_RESULT') fail(resultPath, '振奋必须完整接入拥有方收到的普通护盾增幅');
          modifier = { modifierKey: result.resultKey, kind: 'pipeline', command: 'shield', channel: 'normal_shield',
            stage: 'received', bucket: zone.modifierZoneKey, valuePolicy: 'add_percent', value: constExpr(ratio) };
        } else {
          if (result.target !== 'TARGET' || result.detail.attributeKey !== 'attack_speed' || result.detail.operation !== 'DECREASE'
            || ratio >= 1 || zone.domain !== 'ATTRIBUTE' || zone.applicationStage !== 'ATTRIBUTE_PERCENT') fail(resultPath, '冰心必须为独立的对手总攻速比例削减，不是额外攻速加值');
          const opponent = side === 'source' ? 'target' : 'source';
          required[opponent].add('attack_speed');
          modifier = { modifierKey: result.resultKey, kind: 'attribute', target: 'opponent.attr.attack_speed',
            bucket: zone.modifierZoneKey, stage: 'total', valuePolicy: 'multiply', value: constExpr(1 - ratio) };
          coverage.push({ authorPath: `equipmentAssumptions.${side}.${equipmentKey}.target`, compiledPath: `sharedProviders.${definitionRef}.modifiers[0].target` });
        }
        providers.push({ providerKey: definitionRef, stableId: definitionRef, kind: 'status', modifiers: [modifier] });
        const rules = configuration.triggerRules.filter(rule => rule.actions.some(action => action.actionType === 'EXECUTE_EFFECT' && action.detail.effectKey === effect.effectKey));
        if (rules.length !== 1) fail(effectPath, '每项常驻效果必须由唯一初始化规则执行');
        const rule = rules[0]!;
        if (seenRules.has(rule.ruleKey) || rule.eventSource.eventType !== 'SOURCE_INITIALIZED' || Object.keys(rule.eventSource.detail).length
          || rule.conditionGroups.length || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null || rule.oncePerUse !== null
          || rule.actions.length !== 1) fail(`${root}.triggerRules.${rule.ruleKey}`, '4B只接受拥有方一次初始化，不开放命中、周期或条件触发');
        seenRules.add(rule.ruleKey);
        const action = rule.actions[0]!;
        if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'EVENT_SOURCE'
          || action.runtimeInputBindings.length || action.resultModifiers.length) fail(`${root}.triggerRules.${rule.ruleKey}`, '初始化动作必须作用于事件来源自身且无额外动作修饰');
        initializer.listeners!.push({ listenerKey: rule.ruleKey, maxTriggersPerEvent: 1,
          eventMatcher: { all: ['event/source_initialized', 'event/source_owner'] },
          operations: [{ operation: 'apply_provider', target: 'self', providerDefinitionRef: definitionRef, providerRef: definitionRef }] });
        coverage.push({ authorPath: resultPath, compiledPath: `sharedProviders.${definitionRef}.modifiers[0]` },
          { authorPath: `${resultPath}.target`, compiledPath: result.resultType === 'ATTRIBUTE_CHANGE' ? `sharedProviders.${definitionRef}.modifiers[0].target` : `sharedProviders.${sourceDefinition}.listeners[${initializer.listeners!.length - 1}].operations[0].target` },
          { authorPath: `${effectPath}.lifecycle`, compiledPath: `sharedProviders.${definitionRef}` },
          { authorPath: `${root}.triggerRules.${rule.ruleKey}`, compiledPath: `sharedProviders.${sourceDefinition}.listeners[${initializer.listeners!.length - 1}]` });
      }
      providers.push(initializer);
    }
  }
  if (snapshot.skillConfigurations.length !== selectedSkills.size || new Set(snapshot.skillConfigurations.map(row => row.skill.skillKey)).size !== selectedSkills.size
    || snapshot.skillConfigurations.some(row => !selectedSkills.has(row.skill.skillKey))) fail('skillConfigurations', '配置集必须恰好包含所选普攻与全部所选装备被动');
  return { providers, mounts, coverage, required };
}
