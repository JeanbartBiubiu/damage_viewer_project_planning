import type { ProviderDefinition } from '../types/genericEngine';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSkillOrigin, SimulationSkillPhase, SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { NumericAdaptationError } from './numericAdapter';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';
import { isOwnCooldownMaintenanceAction } from './basicAttackCooldownReduction';
import { receivedCooldownDormancy } from './receivedCooldownDormancy';
import { isOwnProviderDurationMaintenanceAction } from './providerDurationAdapter';
import type { PermanentNumericConsumer } from './simulationPermanentResults';
import { calculationConfiguration } from './simulationCalculationRules';
import { finiteTargetCounterContract, isFiniteTargetCounterPostHitRule } from './finiteTargetCounterContract';
import { targetMarkAuthoringContract, isTargetMarkPostHitRule } from './targetMarkAuthoringContract';
import { isUndrivenTargetTimingSource } from './targetTimingAuthoring';
import { skillHitChainContract, isSkillHitChainPostRule } from './skillHitChainContract';
import { validateStoredSkillFormula } from '../services/skillFormulaContract';
import { validateMarkedRawDamageContract } from './markedRawDamageContract';

export type SimulationSourceSide = 'source' | 'target';
type Side = SimulationSourceSide;
export type TriggeredSkillSourceDescription = {
  side: Side;
  kind: 'item' | 'character' | 'build';
  stableId: string;
  providerRef: string;
  definitionRef: string;
  path: string;
  equipmentKey?: string;
  skills: Array<{
    skillKey: string;
    skillLevel: number;
    path: string;
    configuration: SkillConfiguration;
    allowedRootKeys?: readonly string[];
    sceneInitialValues?: Readonly<Record<string, number>>;
    permanentModifier?: (result: SkillConfiguration['effects'][number]['results'][number], path: string, onNumericConsumed?: PermanentNumericConsumer) =>
      NonNullable<ProviderDefinition['modifiers']>[number];
  }>;
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

const OWN_ATTACK_EVENTS = new Set(['BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED']);
const DEFERRED_SKILL_EVENTS = new Set(['SKILL_USED', 'SKILL_HIT', 'PROCESS_RESOLVED']);
const DAMAGE_EVENTS = new Set(['DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN']);

export function plannedSkillRuleKeys(configuration: SkillConfiguration, phases: readonly SimulationSkillPhase[] = ['INITIAL']) {
  const processes = new Set(configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_USED'
    && rule.eventSource.detail.sourceSkillKey === configuration.skill.skillKey && rule.eventSource.detail.castPhase === 'INITIAL')
    .flatMap(rule => rule.actions.filter(action => action.actionType === 'START_PROCESS').map(action => action.detail.processKey)));
  return configuration.triggerRules.filter(rule => {
    const event = rule.eventSource;
    return rule.actions.length && (event.eventType === 'SKILL_USED' && event.detail.castPhase !== null && phases.includes(event.detail.castPhase)
      && event.detail.sourceSkillKey === configuration.skill.skillKey
      || event.eventType === 'PROCESS_CANCEL_REQUESTED' && phases.includes('CANCEL') && processes.has(event.detail.processKey)
      || event.eventType === 'SKILL_HIT' && event.detail.sourceSkillKey === configuration.skill.skillKey
        && !isFiniteTargetCounterPostHitRule(configuration, rule) && !isTargetMarkPostHitRule(configuration, rule)
        && !isSkillHitChainPostRule(configuration, rule));
  }).map(rule => rule.ruleKey).sort();
}

export function sourceIsPlanned(snapshot: SimulationSnapshot, side: Side, source: SimulationSkillSource) {
  return side === 'source' && snapshot.selection.plannedSkills.some(plan =>
    simulationSkillSourceIdentity(plan.origin, plan.skillKey) === simulationSkillSourceIdentity(source.origin, source.skillKey));
}

function activeReachableRoots(snapshot: SimulationSnapshot) {
  const sources = (['source', 'target'] as const).flatMap(side => snapshot[side].skillSources
    .filter(source => source.enabled && source.skillStatus === 'ENABLED' && source.skillLevel !== 0)
    .map(source => ({ source, side, configuration: snapshot.skillConfigurations.find(row => row.skill.skillKey === source.skillKey) })));
  const canProduce = (entry: typeof sources[number]) => entry.source.inactiveReason === null
    && entry.source.skillLevel !== null && Number.isSafeInteger(entry.source.skillLevel) && entry.source.skillLevel > 0
    && entry.configuration?.skill.gameId === snapshot.gameId && entry.configuration.skill.status === 'ENABLED'
    && entry.source.skillLevel <= entry.configuration.skill.maxLevel;
  const plans = snapshot.selection.plannedSkills.filter(plan => sources.filter(entry => entry.side === 'source' && canProduce(entry)
    && entry.source.skillLevel === plan.skillLevel
    && simulationSkillSourceIdentity(entry.source.origin, entry.source.skillKey) === simulationSkillSourceIdentity(plan.origin, plan.skillKey)).length === 1);
  const basicAttackDriven = snapshot.selection.basicAttackSkillKey !== null && sources.filter(entry => entry.side === 'source'
    && canProduce(entry) && entry.source.origin.kind === 'CHARACTER'
    && entry.source.origin.characterKey === snapshot.selection.sourceCharacterKey
    && entry.source.skillKey === snapshot.selection.basicAttackSkillKey
    && entry.source.skillLevel === snapshot.selection.basicAttackLevel).length === 1;
  const roots = new Map<string, Set<string>>();
  const identity = (side: Side, source: SimulationSkillSource) => `${side}:${simulationSkillSourceIdentity(source.origin, source.skillKey)}`;
  for (const entry of sources) {
    const dormantReceived = new Set(entry.configuration ? receivedCooldownDormancy(snapshot, entry.configuration, entry.side, entry.source).map(r => r.ruleKey) : []);
    const selected = new Set<string>();
    for (const rule of entry.configuration?.triggerRules ?? []) {
      if (dormantReceived.has(rule.ruleKey)) continue;
      const event = rule.eventSource;
      if (!rule.actions.length) continue;
      if (entry.side === 'source' && ['BASIC_ATTACK_HIT', 'SKILL_USED'].includes(event.eventType)
        && rule.actions.every(action => isOwnProviderDurationMaintenanceAction(entry.configuration!, action))
        && !plans.some(plan => plan.skillKey === entry.source.skillKey)) continue;
      if (event.eventType === 'SOURCE_INITIALIZED' || entry.side === 'source'
        && (event.eventType === 'SKILL_HIT' || event.eventType === 'SKILL_USED' && event.detail.castPhase !== null
          && plans.some(plan => plan.phaseKinds.includes(event.detail.castPhase!)
            && (event.detail.sourceSkillKey === null || event.detail.sourceSkillKey === plan.skillKey)))
        && (event.detail.sourceSkillKey === null ? plans.length > 0 : plans.some(plan => plan.skillKey === event.detail.sourceSkillKey))) selected.add(rule.ruleKey);
      // 后台普攻提供真实开始、接触和受击；链接事件仍由可达结果继续展开。
      if (basicAttackDriven && (event.eventType === 'BASIC_ATTACK_RECEIVED' && entry.side === 'target'
        || entry.side === 'source' && ['BASIC_ATTACK_START', 'BASIC_ATTACK_HIT'].includes(event.eventType)
          && !(rule.actions.every(action => action.actionType === 'MODIFY_INTERNAL_STATE'
            || event.eventType === 'BASIC_ATTACK_HIT' && isOwnCooldownMaintenanceAction(entry.configuration!, action))
            && !plans.some(plan => plan.skillKey === entry.source.skillKey)))) selected.add(rule.ruleKey);
      if (basicAttackDriven && entry.side === 'source' && (event.eventType === 'SKILL_HIT'
        || event.eventType === 'SKILL_USED' && event.detail.castPhase === 'INITIAL')
        && (event.detail.sourceSkillKey === null || event.detail.sourceSkillKey === snapshot.selection.basicAttackSkillKey)) selected.add(rule.ruleKey);
      if (event.eventType === 'PROCESS_RESOLVED' && entry.side === 'source'
        && plans.some(plan => plan.skillKey === event.detail.sourceSkillKey)
        && snapshot.skillConfigurations.some(configuration => configuration.skill.skillKey === event.detail.sourceSkillKey
          && configuration.processes.some(process => process.processKey === event.detail.processKey))) selected.add(rule.ruleKey);
    }
    roots.set(identity(entry.side, entry.source), selected);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const producer of sources) {
      const selected = roots.get(identity(producer.side, producer.source))!;
      if (!producer.configuration || !selected.size || !canProduce(producer)) continue;
      const closure = selectSimulationSkillSourceClosure(producer.configuration, [...selected]).configuration;
      for (const subscriber of sources) for (const rule of subscriber.configuration?.triggerRules ?? []) {
        const subscribed = roots.get(identity(subscriber.side, subscriber.source))!;
        if (subscribed.has(rule.ruleKey) || !rule.actions.length) continue;
        const event = rule.eventSource;
        if (!['DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'ATTACK_LINK_APPLIED', 'HIT_LINK_APPLIED'].includes(event.eventType)) continue;
        const detail = event.detail as Record<string, unknown>;
        if (detail.sourceSkillKey != null && detail.sourceSkillKey !== producer.source.skillKey) continue;
        const possible = closure.effects.some(effect => effect.results.some(result => {
          if (event.eventType === 'ATTACK_LINK_APPLIED' || event.eventType === 'HIT_LINK_APPLIED') return subscriber.side === producer.side
            && result.resultType === (event.eventType === 'ATTACK_LINK_APPLIED' ? 'ATTACK_LINK_APPLICATION' : 'HIT_LINK_APPLICATION');
          if (result.resultType !== 'DAMAGE') return false;
          if (event.eventType === 'DAMAGE_DEALT' && subscriber.side !== producer.side) return false;
          const recipient = result.target === 'SOURCE' ? producer.side : producer.side === 'source' ? 'target' : 'source';
          if (event.eventType !== 'DAMAGE_DEALT' && subscriber.side !== recipient) return false;
          return (['damageTypeKey', 'deliveryKind', 'originKind'] as const).every(field =>
            detail[field] == null || detail[field] === 'ANY' || detail[field] === result.detail[field]);
        }));
        if (possible) { subscribed.add(rule.ruleKey); changed = true; }
      }
    }
  }
  return roots;
}

export function naturalRuleKeys(snapshot: SimulationSnapshot, configuration: SkillConfiguration, side: Side, actualSource?: SimulationSkillSource) {
  const dormantReceived = new Set((actualSource ? [actualSource] : snapshot[side].skillSources.filter(s => s.skillKey === configuration.skill.skillKey))
    .flatMap(source => receivedCooldownDormancy(snapshot, configuration, side, source).map(r => r.ruleKey)));
  if (isUndrivenTargetTimingSource(snapshot, configuration, side, actualSource)) return [];
  const finiteCounter = finiteTargetCounterContract(configuration);
  const targetMark = targetMarkAuthoringContract(configuration);
  const hitChain = skillHitChainContract(configuration);
  if (finiteCounter || targetMark || hitChain) {
    const matches = actualSource ? [actualSource] : snapshot[side].skillSources.filter(source => source.skillKey === configuration.skill.skillKey);
    if (matches.length > 1) fail(`${side}.skillSources.${configuration.skill.skillKey}`, '有限目标窗口必须按当前真实来源分别核对计划');
    if (!matches[0] || !sourceIsPlanned(snapshot, side, matches[0])) return [];
  }
  if (hitChain) return [hitChain.postRule.ruleKey];
  if (snapshot.selection.basicAttackSkillKey === null) {
    const reachable = activeReachableRoots(snapshot);
    const keys = new Set(snapshot[side].skillSources.filter(source => source.skillKey === configuration.skill.skillKey)
      .flatMap(source => [...(reachable.get(`${side}:${simulationSkillSourceIdentity(source.origin, source.skillKey)}`) ?? [])]));
    const plan = snapshot.selection.plannedSkills.find(plan => plan.skillKey === configuration.skill.skillKey);
    return configuration.triggerRules.filter(rule => keys.has(rule.ruleKey)
      && !(plan && plannedSkillRuleKeys(configuration, plan.phaseKinds).includes(rule.ruleKey))).map(rule => rule.ruleKey).sort();
  }
  const reachable = configuration.triggerRules.some(rule => DAMAGE_EVENTS.has(rule.eventSource.eventType) && rule.actions.length)
    ? activeReachableRoots(snapshot) : null;
  const damageRoots = new Set((actualSource ? [actualSource] : snapshot[side].skillSources.filter(source => source.skillKey === configuration.skill.skillKey))
    .flatMap(source => [...(reachable?.get(`${side}:${simulationSkillSourceIdentity(source.origin, source.skillKey)}`) ?? [])]));
  return configuration.triggerRules.filter(rule => {
    if (!rule.actions.length || dormantReceived.has(rule.ruleKey)) return false;
    const event = rule.eventSource;
    if (side === 'source' && ['BASIC_ATTACK_HIT', 'SKILL_USED'].includes(event.eventType)
      && rule.actions.every(action => isOwnProviderDurationMaintenanceAction(configuration, action))
      && !snapshot.selection.plannedSkills.some(plan => plan.skillKey === configuration.skill.skillKey)) return false;
    if (event.eventType === 'SOURCE_INITIALIZED') return true;
    if (DAMAGE_EVENTS.has(event.eventType)) return damageRoots.has(rule.ruleKey);
    if (event.eventType === 'PROCESS_RESOLVED') return side === 'source'
      && snapshot.selection.plannedSkills.some(plan => plan.skillKey === event.detail.sourceSkillKey)
      && snapshot.skillConfigurations.some(configuration => configuration.skill.skillKey === event.detail.sourceSkillKey
        && configuration.processes.some(process => process.processKey === event.detail.processKey));
    if (OWN_ATTACK_EVENTS.has(event.eventType)) {
      if (side !== 'source') return false;
      if (rule.actions.every(action => action.actionType === 'MODIFY_INTERNAL_STATE'
        || event.eventType === 'BASIC_ATTACK_HIT' && isOwnCooldownMaintenanceAction(configuration, action))
        && !snapshot.selection.plannedSkills.some(plan => plan.skillKey === configuration.skill.skillKey)) return false;
      return true;
    }
    if (event.eventType === 'BASIC_ATTACK_RECEIVED') return side === 'target' && snapshot.selection.basicAttackSkillKey !== null;
    if (event.eventType === 'SKILL_USED' || event.eventType === 'SKILL_HIT') {
      if (snapshot.selection.plannedSkills.some(plan => plan.skillKey === configuration.skill.skillKey)
        && event.detail.sourceSkillKey === configuration.skill.skillKey && !isFiniteTargetCounterPostHitRule(configuration, rule)
        && !isTargetMarkPostHitRule(configuration, rule) && !isSkillHitChainPostRule(configuration, rule)) return false;
      return side === 'source' && (event.detail.sourceSkillKey === null || event.detail.sourceSkillKey === snapshot.selection.basicAttackSkillKey
        || snapshot.selection.plannedSkills.some(plan => plan.skillKey === event.detail.sourceSkillKey))
        && (event.eventType !== 'SKILL_USED' || event.detail.castPhase === 'INITIAL' || event.detail.castPhase !== null
          && snapshot.selection.plannedSkills.some(plan => plan.phaseKinds.includes(event.detail.castPhase!)
            && (event.detail.sourceSkillKey === null || event.detail.sourceSkillKey === plan.skillKey)));
    }
    return false;
  }).map(rule => rule.ruleKey).sort();
}

function onlyUndrivenAttackRoots(configuration: SkillConfiguration, basicAttackCategoryKey: string | null, allowDeferredSkills = false) {
  const roots = configuration.triggerRules.filter(rule => (OWN_ATTACK_EVENTS.has(rule.eventSource.eventType)
    || allowDeferredSkills && DEFERRED_SKILL_EVENTS.has(rule.eventSource.eventType)
    || basicAttackCategoryKey !== null && configuration.skill.skillCategoryKeys.includes(basicAttackCategoryKey) && rule.eventSource.eventType === 'SKILL_HIT'
      && (rule.eventSource.detail.sourceSkillKey === null || rule.eventSource.detail.sourceSkillKey === configuration.skill.skillKey))
    && rule.actions.length > 0).map(rule => rule.ruleKey);
  if (!roots.length) return false;
  return selectSimulationSkillSourceClosure(configuration, roots).excludedRuleKeys.length === 0;
}

function validateUnreachableDamageSource(snapshot: SimulationSnapshot, configuration: SkillConfiguration | undefined, side: Side, source: SimulationSkillSource) {
  const root=`${side}.skillSources.${source.skillKey}`;
  if(!source.enabled || source.skillStatus!=='ENABLED' || !configuration || configuration.skill.status!=='ENABLED'
    || configuration.skill.gameId!==snapshot.gameId || typeof source.skillLevel!=='number' || !Number.isSafeInteger(source.skillLevel) || source.skillLevel<1
    || !Number.isSafeInteger(configuration.skill.maxLevel) || source.skillLevel>configuration.skill.maxLevel
    || source.enabledRuleKeys.length || sourceIsPlanned(snapshot,side,source)
    || side==='source' && source.origin.kind==='CHARACTER' && source.skillKey===snapshot.selection.basicAttackSkillKey) {
    fail(root,'本场无事件原因只允许真实启用、有效等级、非计划且非所选普攻的空入口来源');
  }
  const markedRaw = validateMarkedRawDamageContract(snapshot,configuration,root);
  if(markedRaw){
    for(const key of [markedRaw.primarySkillKey,markedRaw.rSkillKey,markedRaw.wSkillKey]){
      const relations=snapshot[side].skillSources.filter(row=>row.skillKey===key
        && simulationSkillSourceIdentity(row.origin,key)===simulationSkillSourceIdentity(source.origin,key));
      if(relations.length!==1 || relations[0]!.skillStatus!=='ENABLED')fail(root,'休眠标记图的外部技能必须保留唯一同拥有者启用定义关系');
    }
    if(naturalRuleKeys(snapshot,configuration,side,source).length)fail(root,'本场无事件原因不能隐藏真实可达的挂标或原额入口');
    return;
  }
  if(!configuration.triggerRules.length || configuration.triggerRules.some(rule=>!DAMAGE_EVENTS.has(rule.eventSource.eventType)
    || !rule.actions.length || rule.actions.some(action=>action.actionType!=='EXECUTE_EFFECT'))) {
    fail(root,'本场无事件来源必须完整且仅含非空伤害监听与执行效果动作');
  }
  const closure=selectSimulationSkillSourceClosure(configuration,configuration.triggerRules.map(rule=>rule.ruleKey)).configuration;
  for(const rule of configuration.triggerRules)for(const action of rule.actions){
    if(action.actionType!=='EXECUTE_EFFECT')fail(root,'本场无事件来源不能隐藏过程操作');
    const effects=closure.effects.filter(effect=>effect.effectKey===action.detail.effectKey);
    if(effects.length!==1 || effects[0]!.gameId!==snapshot.gameId || effects[0]!.skillKey!==source.skillKey
      || !effects[0]!.results.length)fail(root,'本场无事件来源必要效果及并列结果必须完整');
  }
  for(const formula of closure.formulas)if(formula.gameId!==snapshot.gameId || formula.skillKey!==source.skillKey
    || validateStoredSkillFormula(formula.expression,source.skillKey))fail(root,'本场无事件来源的必要共同公式声明必须完整');
  for(const parameter of closure.parameters){
    const path=`skills.${source.skillKey}.parameters.${parameter.parameterKey}`;
    if(parameter.gameId!==snapshot.gameId || parameter.skillKey!==source.skillKey
      || !['INTEGER','DECIMAL'].includes(parameter.valueType))fail(path,'必要参数声明不属于当前来源');
    if(parameter.valueMode==='RUNTIME_INPUT'){
      if(parameter.fixedValue!==null || parameter.levelValues!==null)fail(path,'未驱动的运行输入不能夹带默认值');
      continue;
    }
    const level=parameter.valueMode==='SKILL_LEVEL'?source.skillLevel:snapshot.selection[`${side}Level`];
    const value=parameter.valueMode==='FIXED'?parameter.fixedValue:parameter.levelValues?.[String(level)];
    if(!['FIXED','SKILL_LEVEL','CHARACTER_LEVEL'].includes(parameter.valueMode) || typeof value!=='number' || !Number.isFinite(value)
      || parameter.valueType==='INTEGER' && !Number.isSafeInteger(value))fail(path,'必要参数缺少当前实际等级下的明确数值');
  }
  const knownSkill=(key:unknown)=>{
    if(key==null)return;
    if(typeof key!=='string' || snapshot.skillConfigurations.filter(row=>row.skill.skillKey===key&&row.skill.gameId===snapshot.gameId&&row.skill.status==='ENABLED').length!==1) {
      fail(root,'本场无事件来源引用的技能必须已包含唯一只读定义');
    }
  };
  for(const rule of configuration.triggerRules)knownSkill((rule.eventSource.detail as {sourceSkillKey?:string|null}).sourceSkillKey);
  for(const effect of closure.effects)for(const result of effect.results)if(result.resultType==='COOLDOWN_CHANGE'){
    if(result.detail.affectedSkillScope.mode==='SKILLS')result.detail.affectedSkillScope.skillKeys.forEach(knownSkill);
  }
  if(naturalRuleKeys(snapshot,configuration,side,source).length)fail(root,'本场无事件原因不能隐藏实际可达自然入口');
}

export function executableEquipmentRelations(snapshot: SimulationSnapshot, side: Side, equipmentKey: string) {
  const item = snapshot[side].selectedEquipment.find(row => row.equipment.equipmentKey === equipmentKey);
  if (!item) fail(`${side}.selectedEquipment`, '缺少实际所选装备');
  return item.attachedSkills.filter(relation => {
    const matches = snapshot[side].skillSources.filter(source => source.origin.kind === 'EQUIPMENT'
      && source.origin.equipmentKey === equipmentKey && source.skillKey === relation.skillKey);
    if (matches.length !== 1) fail(`${side}.skillSources`, '装备绑定技能的默认来源缺失或重复');
    const source = matches[0]!;
    if (!source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel === 0) return false;
    if (source.inactiveReason === 'NO_REACHABLE_EVENT') {
      validateUnreachableDamageSource(snapshot,snapshot.skillConfigurations.find(row=>row.skill.skillKey===source.skillKey),side,source);
      return false;
    }
    if (source.inactiveReason === 'NO_AUTONOMOUS_ATTACK' || source.inactiveReason === 'ACTIVE_DEFERRED') return false;
    if (source.inactiveReason !== null || source.skillLevel === null) {
      fail(`${side}.skillSources.${source.skillKey}`, '开启装备来源缺少完整程序或明确等级，不能只取直接属性');
    }
    return true;
  });
}

function sourceRelations(snapshot: SimulationSnapshot, side: Side) {
  const expected = new Map<string, { skillStatus: SimulationSkillSource['skillStatus']; skillLevel?: number }>();
  for (const relation of snapshot[side].attachedSkills) {
    expected.set(simulationSkillSourceIdentity({ kind: 'CHARACTER', characterKey: snapshot[side].character.characterKey }, relation.skillKey),
      { skillStatus: relation.skillStatus });
  }
  for (const item of snapshot[side].selectedEquipment) for (const relation of item.attachedSkills) {
    expected.set(simulationSkillSourceIdentity({ kind: 'EQUIPMENT', equipmentKey: item.equipment.equipmentKey }, relation.skillKey),
      { skillStatus: relation.skillStatus, skillLevel: 1 });
  }
  for (const selected of snapshot[side].selectedBuilds) for (const choice of selected.configuration.selections) {
    for (const relation of selected.definition.skillRelations.filter(row => row.optionKey === choice.optionKey && row.activationRank <= choice.rank)) {
      expected.set(simulationSkillSourceIdentity({ kind: 'BUILD_OPTION', systemKey: selected.definition.system.systemKey,
        roleKey: choice.roleKey, groupKey: choice.groupKey, slotKey: choice.slotKey, optionKey: choice.optionKey }, relation.skillKey),
        { skillStatus: relation.skillStatus, skillLevel: relation.skillLevelMode === 'FIXED' ? relation.fixedSkillLevel! : choice.rank });
    }
  }
  return expected;
}

export function validateSimulationSkillSourceManifest(snapshot: SimulationSnapshot) {
  const basicAttackCategoryKey = calculationConfiguration(snapshot)?.basicAttackCategoryKey ?? null;
  const configurations = new Map(snapshot.skillConfigurations.map(row => [row.skill.skillKey, row]));
  if (configurations.size !== snapshot.skillConfigurations.length) fail('skillConfigurations', '完整作者配置不能重复');
  const allowedConfigurations = new Set([snapshot.selection.basicAttackSkillKey, ...snapshot.selection.plannedSkills.map(plan => plan.skillKey),
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
      const relation = expected.get(identity)!;
      if (source.skillStatus !== relation.skillStatus || relation.skillLevel !== undefined && source.skillLevel !== relation.skillLevel) {
        fail(`${side}.skillSources.${source.skillKey}`, '实际来源全局状态或等级与真实绑定授予不一致');
      }
      actual.add(identity);
      allowedConfigurations.add(source.skillKey);
      if (typeof source.enabled !== 'boolean' || !Array.isArray(source.enabledRuleKeys)
        || new Set(source.enabledRuleKeys).size !== source.enabledRuleKeys.length) fail(`${side}.skillSources`, '来源开关或自然入口缺失或重复');
      const overrides = settings.filter(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
      if (overrides.length > 1 || source.enabled !== (overrides[0]?.enabled ?? true)) fail(`${side}.skillSources`, '来源开关与明确场景设置不一致');
      if (source.origin.kind === 'CHARACTER' && overrides[0]?.skillLevel !== undefined
        && source.skillLevel !== overrides[0].skillLevel) fail(`${side}.skillSources.${source.skillKey}.skillLevel`, '实际来源等级与明确场景设置不一致');
      const configuration = configurations.get(source.skillKey);
      if (source.skillStatus === 'ENABLED' && (!configuration || configuration.skill.status !== 'ENABLED')) {
        fail(`${side}.skillSources.${source.skillKey}`, '完整启用作者配置缺失或全局状态不一致');
      }
      if(source.inactiveReason==='NO_REACHABLE_EVENT')validateUnreachableDamageSource(snapshot,configuration,side,source);
      if (source.enabled && source.skillStatus === 'ENABLED' && source.skillLevel !== 0 && configuration) {
        const selectedPrimary = side === 'source' && source.origin.kind === 'CHARACTER'
          && source.skillKey === snapshot.selection.basicAttackSkillKey;
        const planned = sourceIsPlanned(snapshot, side, source);
        const plan = snapshot.selection.plannedSkills.find(plan => simulationSkillSourceIdentity(plan.origin, plan.skillKey) === identity);
        const undrivenTiming = isUndrivenTargetTimingSource(snapshot, configuration, side, source);
        const roots = [...naturalRuleKeys(snapshot, configuration, side, source), ...(planned && plan ? plannedSkillRuleKeys(configuration, plan.phaseKinds) : [])];
        if (planned && (source.inactiveReason !== null || !roots.length)) fail(`${side}.skillSources.${source.skillKey}`, '计划来源必须具备真实已启用首次入口');
        if (source.inactiveReason === 'NO_AUTONOMOUS_ATTACK') {
          const undrivenPrimary = source.origin.kind === 'CHARACTER' && !selectedPrimary
            && basicAttackCategoryKey !== null && configuration.skill.skillCategoryKeys.includes(basicAttackCategoryKey)
            && roots.every(key => OWN_ATTACK_EVENTS.has(configuration.triggerRules.find(rule => rule.ruleKey === key)!.eventSource.eventType))
            && onlyUndrivenAttackRoots(configuration, basicAttackCategoryKey);
          const undrivenNatural = (side === 'target' || snapshot.selection.basicAttackSkillKey === null)
            && roots.length === 0 && configuration.triggerRules.some(rule => OWN_ATTACK_EVENTS.has(rule.eventSource.eventType) && rule.actions.length > 0)
            && onlyUndrivenAttackRoots(configuration, basicAttackCategoryKey, true);
          if (selectedPrimary || source.enabledRuleKeys.length || !undrivenPrimary && !undrivenNatural && !undrivenTiming) {
            fail(`${side}.skillSources.${source.skillKey}`, '无自主普攻排除原因不能隐藏真实自然入口或所选主体，必须是本场不驱动的真实攻击来源');
          }
        }
        if (source.inactiveReason === 'ACTIVE_DEFERRED' && (roots.length
          || !configuration.triggerRules.some(rule => DEFERRED_SKILL_EVENTS.has(rule.eventSource.eventType))
          || !undrivenTiming && !onlyUndrivenAttackRoots(configuration, basicAttackCategoryKey, true))) {
          fail(`${side}.skillSources.${source.skillKey}`, '主动后置原因不能隐藏真实自然入口');
        }
        if (source.inactiveReason === null
          && (roots.some(key => !source.enabledRuleKeys.includes(key))
            || source.origin.kind !== 'EQUIPMENT' && (source.enabledRuleKeys.length !== roots.length || source.enabledRuleKeys.some(key => !roots.includes(key))))) {
          fail(`${side}.skillSources.${source.skillKey}`, '开启来源必须完整保留真实自然入口');
        }
      }
    }
    if (actual.size !== expected.size) fail(`${side}.skillSources`, '默认来源不能被过滤为部分绑定');
    if (settings.some(row => !expected.has(simulationSkillSourceIdentity(row.origin, row.skillKey)))) fail(`selection.${side}SkillSettings`, '覆盖设置不能授予额外未绑定技能');
  }
  for (const plan of snapshot.selection.plannedSkills) {
    const source = snapshot.source.skillSources.find(row => sourceIsPlanned(snapshot, 'source', row)
      && simulationSkillSourceIdentity(row.origin, row.skillKey) === simulationSkillSourceIdentity(plan.origin, plan.skillKey));
    if (!source || !source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel !== plan.skillLevel
      || plan.origin.characterKey !== snapshot.source.character.characterKey || plan.skillLevel < 1) {
      fail('selection.plannedSkills', '主动计划只能使用攻击方真实绑定、已开启且已学的同等级来源');
    }
  }
  for (const configuration of snapshot.skillConfigurations) if (!allowedConfigurations.has(configuration.skill.skillKey)
    || configuration.skill.gameId !== snapshot.gameId) fail('skillConfigurations', '配置集合只能包含默认来源及实际只读依赖');
}

export function equipmentSourceEnabled(snapshot: SimulationSnapshot, side: Side, origin: SimulationSkillOrigin, skillKey: string) {
  const identity = simulationSkillSourceIdentity(origin, skillKey);
  const sources = snapshot[side].skillSources.filter(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
  if (sources.length !== 1) fail(`${side}.skillSources`, '来源开关缺失或重复');
  return sources[0]!.enabled && sources[0]!.skillStatus === 'ENABLED' && sources[0]!.skillLevel !== 0;
}
