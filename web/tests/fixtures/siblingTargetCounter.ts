import { simulationSample } from './simulationSnapshot';
import { fixedValue, parameterValue } from '../../src/types/numericValue';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SkillInternalStateCounter } from '../../src/types/skillInternalState';
import type { ProviderDefinition, ProviderStateFieldSchema } from '../../src/types/genericEngine';
import type { SimulationSkillSource } from '../../src/types/simulationSnapshot';
import type { SimulationSkillOriginTrace } from '../../src/engine/simulation/model';
import type { SkillTriggerInternalStateCheckCondition, SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';

/** 完全合成的只读挂载夹具，不复制英雄配置。 */
export function siblingTargetCounterSample() {
  const snapshot = simulationSample();
  const basic=snapshot.skillConfigurations[0]!;
  const requesterKey='sample_active';
  const requester:SkillConfiguration={...structuredClone(basic),
    skill:{...basic.skill,skillKey:requesterKey,name:'合成主动命中来源',skillCategoryKeys:['active']},
    parameters:[],formulas:[],effects:[],internalStates:[],
    processes:[{gameId:snapshot.gameId,skillKey:requesterKey,processKey:'cast',name:'真实主动过程',description:null,
      sortOrder:0,createdAt:'',updatedAt:'',activationType:'ACTIVE',cooldown:null,effectBindings:[],stateOperations:[],
      steps:[{stepKey:'now',name:'即时',description:null,sortOrder:0,stepType:'IMMEDIATE',occupiesAction:false,detail:{}}]}],
    triggerRules:[{ruleKey:'on_used',name:'真实首次主动入口',description:null,sortOrder:0,
      eventSource:{eventType:'SKILL_USED',detail:{sourceSkillKey:requesterKey,useKind:'ACTIVE',castPhase:'INITIAL'}},
      conditionGroups:[],actions:[{actionKey:'start',name:'开始',actionType:'START_PROCESS',detail:{processKey:'cast'},
        sortOrder:0,targetContext:'CURRENT_TARGET',runtimeInputBindings:[],resultModifiers:[]}],
      perTargetCooldown:null,maxTriggersPerProcess:null,oncePerUse:null}],baseDigest:'synthetic_active_reader'};
  snapshot.skillConfigurations.push(requester);
  const requesterOrigin={kind:'CHARACTER' as const,characterKey:snapshot.selection.sourceCharacterKey};
  snapshot.selection.plannedSkills=[{origin:requesterOrigin,skillKey:requesterKey,skillLevel:1,phaseKinds:['INITIAL']}];
  snapshot.selection.sourceSkillSettings.push({origin:requesterOrigin,skillKey:requesterKey,skillLevel:1,enabled:true});
  snapshot.source.attachedSkills.push({...snapshot.source.attachedSkills[0]!,skillKey:requesterKey,skillName:requester.skill.name});
  snapshot.source.skillSources.push({origin:requesterOrigin,skillKey:requesterKey,skillName:requester.skill.name,
    skillStatus:'ENABLED',enabled:true,skillLevel:1,enabledRuleKeys:['on_used'],inactiveReason:null});
  const skillKey = 'sample_window', stateKey = 'window_count';
  const common = { gameId: snapshot.gameId, skillKey, createdAt: '', updatedAt: '' };
  const counter: SkillInternalStateCounter = { ...common, stateKey, stateType: 'COUNTER', scope: 'TARGET',
    name: '目标窗口计数', description: null, sortOrder: 0,
    detail: { initialValue: fixedValue(0), maxValue: parameterValue('capacity'), durationValue: parameterValue('duration_ms') } };
  const configuration: SkillConfiguration = { ...structuredClone(requester),
    skill: { ...requester.skill, skillKey, name: '合成窗口来源', maxLevel: 3, skillCategoryKeys: ['passive'] },
    parameters: [ ['capacity', 3], ['duration_ms', 4000] ].map(([key, value]) => ({ ...common,
      parameterKey: String(key), name: String(key), valueMode: 'FIXED', valueType: 'INTEGER', fixedValue: Number(value),
      levelValues: null, sortOrder: 0, description: null })),
    formulas: [], effects: [], internalStates: [counter], processes: [], triggerRules: [], baseDigest: 'synthetic_sibling_counter' };
  snapshot.skillConfigurations.push(configuration);
  const origin = { kind: 'CHARACTER' as const, characterKey: snapshot.selection.sourceCharacterKey };
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey, skillName: configuration.skill.name });
  const source: SimulationSkillSource & { origin: typeof origin } = { origin, skillKey, skillName: configuration.skill.name, skillStatus: 'ENABLED',
    enabled: true, skillLevel: 2, enabledRuleKeys: ['synthetic_window_root'], inactiveReason: null };
  snapshot.source.skillSources.push(source);
  snapshot.selection.sourceSkillSettings.push({ origin, skillKey, enabled: true, skillLevel: 2 });
  const providerRef = 'actual_window_mount_z', definitionRef = 'actual_window_definition_z';
  const provider: ProviderDefinition & { initialStateSchema: Record<string, ProviderStateFieldSchema> } = { providerKey: definitionRef, skillKey, stableId: definitionRef, kind: 'character',
    initialStateSchema: { [stateKey]: { valueType: 'integer', defaultValue: 0, maxValue: 3, durationMs: 4000,
      refreshPolicy: 'refresh_on_write' } } };
  const natural: { origins: SimulationSkillOriginTrace[]; providers: ProviderDefinition[];
    mounts: Array<{ side: 'source' | 'target'; providerRef: string; definitionRef: string }> } = { origins: [{ ...structuredClone(source), side: 'source', providerRef, definitionRef }],
    providers: [provider], mounts: [{ side: 'source', providerRef, definitionRef }] };
  return { snapshot, requester, configuration, counter, source, natural, provider, skillKey, stateKey, providerRef, definitionRef };
}

/** 通过正式命中与主动适配器的两分支合成输入；挂载仍由上面的结构夹具明确提供。 */
export function siblingTargetCounterHitSample() {
  const sample = siblingTargetCounterSample(), { snapshot, requester } = sample;
  const template = snapshot.skillConfigurations[0]!.effects[1]!;
  const rules: SkillTriggerRuleDetail[] = [];
  for (const [effectKey, comparator, amount] of [['plain_hit', 'EQ', 100], ['boost_hit', 'GT', 125]] as const) {
    const damage = structuredClone(template.results[0]!);
    if (damage.resultType !== 'DAMAGE') throw new Error('合成命中夹具需要伤害结果');
    damage.detail.deliveryKind = 'SKILL'; damage.detail.critical = { mode: 'DISALLOWED', multiplierValue: null };
    damage.spellShieldBlockScope = 'SKILL'; damage.valueRule!.value = fixedValue(amount);
    requester.effects.push({ ...structuredClone(template), skillKey: requester.skill.skillKey, effectKey, results: [damage] });
    const condition: SkillTriggerInternalStateCheckCondition = { conditionKey: 'before_hit_count',
      conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0, detail: { stateSkillKey: sample.skillKey, stateKey: sample.stateKey,
        valueKind: 'VALUE', optionKey: null, expectedBoolean: null, comparator, comparisonValue: fixedValue(0) } };
    rules.push({ ruleKey: effectKey, name: '命中前计数分支', description: null, sortOrder: rules.length + 1,
      eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: requester.skill.skillKey } },
      conditionGroups: [{ groupKey: 'count', name: '计数条件', sortOrder: 0, conditions: [condition] }],
      actions: [{ actionKey: 'deal', name: '伤害', sortOrder: 0, actionType: 'EXECUTE_EFFECT', detail: { effectKey },
        targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null });
  }
  requester.triggerRules.push(...rules);
  snapshot.source.skillSources.find(source => source.skillKey === requester.skill.skillKey)!.enabledRuleKeys = requester.triggerRules.map(rule => rule.ruleKey).sort();
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'active', name: '主动' });
  return { ...sample, rules };
}
