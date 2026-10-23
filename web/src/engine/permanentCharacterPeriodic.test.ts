import { describe, expect, it } from 'vitest';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { recurveBowConfiguration, triggeredEquipmentSimulationSample } from '../../tests/fixtures/simulationTriggeredEquipment';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectDamageResult } from '../types/skillEffect';
import { assembleNaturalSkillSources } from './simulationNaturalSkillSources';
import { assembleTriggeredSkillSources } from './simulationTriggeredEquipment';

function sample(side: 'source' | 'target' = 'source', background = true) {
  const snapshot = triggeredEquipmentSimulationSample([], []);
  if (!snapshot.catalogs.attributes.some(row => row.attributeKey === 'ability_power')) snapshot.catalogs.attributes.push({
    ...snapshot.catalogs.attributes[0]!, attributeKey: 'ability_power', name: '法术强度' });
  for (const actor of [snapshot.source, snapshot.target]) actor.selectedLevelValues.ability_power = 100;
  const key = 'authored_permanent_period';
  const configuration = JSON.parse(JSON.stringify(recurveBowConfiguration()).replaceAll('item_1043_passive', key)) as SkillConfiguration;
  configuration.skill.maxLevel = 5;
  configuration.parameters[0]!.fixedValue = 5;
  configuration.effects[0]!.lifecycle = {
    durationValue: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY',
    periodicIntervalValue: { kind: 'FIXED', value: 500 }, firstPeriodicExecution: 'AFTER_INTERVAL', endWhenShieldEndsResultKey: null
  };
  const result = configuration.effects[0]!.results[0] as SkillEffectDamageResult;
  result.detail.deliveryKind = 'SKILL'; result.detail.vampOverrides = [];
  result.lifecycleBehavior = { moment: 'PERIODIC', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: null,
    reapplicationValueMode: null, periodicExecutionMode: 'ONCE_PER_INSTANCE' };
  const rule = configuration.triggerRules[0]!;
  rule.eventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
  rule.actions[0]!.targetContext = 'EVENT_SOURCE';
  snapshot.skillConfigurations.push(configuration);
  snapshot[side].attachedSkills.push({ ...snapshot[side].attachedSkills[0]!, skillKey: key, skillName: '独立常驻周期', sortOrder: 20 });
  snapshot.selection[`${side}SkillSettings`].push({ origin: { kind: 'CHARACTER', characterKey: snapshot[side].character.characterKey },
    skillKey: key, enabled: true, skillLevel: 3 });
  if (!background) { snapshot.selection.basicAttackSkillKey = null; snapshot.selection.basicAttackLevel = null; }
  syncSimulationSkillSources(snapshot);
  return { snapshot, configuration, rule, effect: configuration.effects[0]!, result, side };
}
function assemble(input: ReturnType<typeof sample>) {
  syncSimulationSkillSources(input.snapshot);
  approveSnapshotFixture(input.snapshot);
  return assembleNaturalSkillSources(input.snapshot);
}

describe('实际角色无期限纯周期初始化', () => {
  it.each(['source', 'target'] as const)('%s拥有者保留唯一真实挂载和首跳，不生成空监听或假使用', side => {
    const input = sample(side), original = structuredClone(input.configuration), value = assemble(input);
    const origin = value.origins.find(row => row.side === side && row.skillKey === input.configuration.skill.skillKey)!;
    const provider = value.providers.find(row => row.providerKey === origin.definitionRef)!;
    expect(provider).toMatchObject({ kind: 'character', skillKey: input.configuration.skill.skillKey, stableId: origin.definitionRef });
    expect(provider.abilities).toHaveLength(1);
    expect(provider.abilities![0]).toMatchObject({ kind: 'tick', skillKey: input.configuration.skill.skillKey,
      tickSpec: { intervalMs: 500, startDelayMs: 500, onTick: [{ operation: 'damage', target: 'target', damageType: 'physics',
        critEligible: false, types: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'] }] } });
    expect(provider.abilities![0]!.tickSpec!.onTick).toHaveLength(1);
    expect(provider).not.toHaveProperty('listeners'); expect(provider).not.toHaveProperty('lifecycle');
    expect(provider).not.toHaveProperty('processes'); expect(provider).not.toHaveProperty('initialStateSchema');
    expect(provider.abilities![0]).not.toHaveProperty('listenerSpec');
    expect(value.mounts).toContainEqual({ side, providerRef: origin.providerRef, definitionRef: origin.definitionRef });
    expect(value.triggered.operationOrigins).toEqual([expect.objectContaining({ skillKey: input.configuration.skill.skillKey,
      effectKey: input.effect.effectKey, resultKey: input.result.resultKey,
      compiledPaths: [expect.stringContaining('tickSpec.onTick[0]')] })]);
    for (const field of ['eventSource', 'actions']) expect(value.coverage.some(row => row.authorPath.endsWith(`${input.rule.ruleKey}.${field}`)
      || field === 'actions' && row.authorPath.includes(`${input.rule.ruleKey}.actions.${input.rule.actions[0]!.actionKey}`))).toBe(true);
    expect(input.configuration).toEqual(original);
  });
  it('无所选普攻仍完整降低唯一角色周期，不借入主动计划', () => {
    const input = sample('source', false), value = assemble(input);
    expect(input.snapshot.selection.plannedSkills).toEqual([]); expect(input.snapshot.selection.basicAttackSkillKey).toBeNull();
    expect(value.providers.filter(row => row.abilities?.some(ability => ability.kind === 'tick'))).toHaveLength(1);
    expect(value.triggered.rules.skillActionBindings).toBeUndefined();
  });
  it('完整公式保留实际拥有者当前AP和对手最大生命，不在初始化快照伤害', () => {
    const input = sample('target');
    input.configuration.formulas.push({ gameId: input.snapshot.gameId, skillKey: input.configuration.skill.skillKey,
      formulaKey: 'current_period_damage', name: '逐跳当前值', description: null, createdAt: '', updatedAt: '',
      expression: skillFormulaDefinition(input.configuration.skill.skillKey, { nodeType: 'OPERATION', operation: 'ADD', operands: [
        { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'ability_power', attributeValueKind: 'TOTAL' },
        { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'MAX' }
      ] }), sortOrder: 0 });
    input.result.valueRule!.value = { kind: 'FORMULA', formulaKey: 'current_period_damage' };
    const value = assemble(input), formula = value.triggered.formulas.find(row => row.key.endsWith('/current_period_damage'))!;
    expect(formula.expression).toEqual(input.configuration.formulas[0]!.expression);
    expect(formula.expression.inputs.map(row => row.binding)).toEqual([
      { kind: 'attribute', object: 'source', view: 'current_frame', attributeKey: 'ability_power', valueKind: 'TOTAL' },
      { kind: 'attribute', object: 'target', view: 'current_frame', attributeKey: 'hp', valueKind: 'MAX' }
    ]);
    expect(value.required.target.has('ability_power')).toBe(true); expect(value.required.source.has('hp')).toBe(true);
    const operation = value.providers.flatMap(row => row.abilities ?? []).find(row => row.kind === 'tick')!.tickSpec!.onTick[0]!;
    expect(JSON.stringify(operation.amount)).toContain(formula.key);
  });
  it.each(['off', 'zero'] as const)('%s保留真实来源且不生成周期或挂载', state => {
    const input = sample(), setting = input.snapshot.selection.sourceSkillSettings.find(row => row.skillKey === input.configuration.skill.skillKey)!;
    if (state === 'off') setting.enabled = false; else setting.skillLevel = 0;
    const value = assemble(input);
    expect(value.origins.some(row => row.skillKey === input.configuration.skill.skillKey)).toBe(true);
    expect(value.providers).toEqual([]); expect(value.mounts).toEqual([]);
  });
  it.each(['additional_action', 'condition', 'once', 'throttle', 'limit', 'runtime_binding', 'result_modifier', 'current_target',
    'second_rule', 'unreachable_rule', 'second_effect', 'hidden_state', 'hidden_process', 'two_results', 'finite', 'wrong_scope',
    'two_layers', 'reapplication', 'first_immediate', 'interval_zero', 'linked_shield', 'self_damage', 'snapshot', 'shared',
    'critical', 'vamp_override', 'basic_delivery', 'reflected', 'spell_shield', 'hidden_detail'] as const)('拒绝扩大角色纯周期图：%s', kind => {
    const input = sample(), { configuration, effect, result, rule } = input;
    if (kind === 'additional_action') rule.actions.push({ ...structuredClone(rule.actions[0]!), actionKey: 'second', sortOrder: 20 });
    if (kind === 'condition') rule.conditionGroups = [{ groupKey: 'conditional', name: '条件', sortOrder: 0, conditions: [] }];
    if (kind === 'once') rule.oncePerUse = { groupKey: 'first', scope: 'SKILL' };
    if (kind === 'throttle') rule.perTargetCooldown = { durationValue: { kind: 'FIXED', value: 100 }, targetContext: 'CURRENT_TARGET' };
    if (kind === 'limit') rule.maxTriggersPerProcess = { processKey: 'hidden', limitValue: { kind: 'FIXED', value: 1 } };
    if (kind === 'runtime_binding') rule.actions[0]!.runtimeInputBindings = [{ bindingKey: 'hidden', parameterKey: configuration.parameters[0]!.parameterKey,
      sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'RAW_DAMAGE' } }];
    if (kind === 'result_modifier') rule.actions[0]!.resultModifiers = [{}] as never;
    if (kind === 'current_target') rule.actions[0]!.targetContext = 'CURRENT_TARGET';
    if (kind === 'second_rule' || kind === 'unreachable_rule') {
      const extra = { ...structuredClone(rule), ruleKey: 'extra', sortOrder: 20 };
      if (kind === 'unreachable_rule') extra.eventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: configuration.skill.skillKey } };
      configuration.triggerRules.push(extra);
    }
    if (kind === 'second_effect') configuration.effects.push({ ...structuredClone(effect), effectKey: 'unselected_effect' });
    if (kind === 'hidden_state') configuration.internalStates.push({ gameId: 'lol', skillKey: configuration.skill.skillKey, stateKey: 'hidden', name: '隐藏',
      description: null, sortOrder: 0, createdAt: '', updatedAt: '', stateType: 'COUNTER', scope: 'SKILL',
      detail: { initialValue: { kind: 'FIXED', value: 0 }, maxValue: { kind: 'FIXED', value: 1 }, durationValue: null } });
    if (kind === 'hidden_process') configuration.processes.push({ gameId: input.snapshot.gameId, skillKey: configuration.skill.skillKey,
      name: '隐藏过程', description: null, createdAt: '', updatedAt: '', sortOrder: 0, processKey: 'hidden', activationType: 'PASSIVE', cooldown: null,
      steps: [{ stepKey: 'instant', name: '即时', description: null, sortOrder: 0, stepType: 'IMMEDIATE', detail: {} }], effectBindings: [], stateOperations: [] });
    if (kind === 'two_results') effect.results.push({ ...structuredClone(result), resultKey: 'second_damage', sortOrder: 20 });
    if (kind === 'finite') effect.lifecycle!.durationValue = { kind: 'FIXED', value: 5000 };
    if (kind === 'wrong_scope') effect.lifecycle!.instanceScope = 'SOURCE_TARGET';
    if (kind === 'two_layers') effect.lifecycle!.maxStacksValue = { kind: 'FIXED', value: 2 };
    if (kind === 'reapplication') effect.lifecycle!.reapplicationDurationMode = 'REFRESH_ALL';
    if (kind === 'first_immediate') effect.lifecycle!.firstPeriodicExecution = 'IMMEDIATE';
    if (kind === 'interval_zero') effect.lifecycle!.periodicIntervalValue = { kind: 'FIXED', value: 0 };
    if (kind === 'linked_shield') effect.lifecycle!.endWhenShieldEndsResultKey = result.resultKey;
    if (kind === 'self_damage') result.target = 'SOURCE';
    if (kind === 'snapshot') result.lifecycleBehavior!.valueReadMode = 'APPLICATION_SNAPSHOT';
    if (kind === 'shared') result.lifecycleBehavior!.stackValueMode = 'SHARED';
    if (kind === 'critical') result.detail.critical.mode = 'SOURCE_CRIT_CHANCE';
    if (kind === 'vamp_override') result.detail.vampOverrides = [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiencyValue: { kind: 'FIXED', value: 1 } }];
    if (kind === 'basic_delivery') result.detail.deliveryKind = 'BASIC_ATTACK';
    if (kind === 'reflected') result.detail.originKind = 'REFLECTED';
    if (kind === 'spell_shield') result.spellShieldBlockScope = 'SKILL';
    if (kind === 'hidden_detail') Object.assign(result.detail, { hidden: true });
    expect(() => assemble(input)).toThrow();
  });
  it('直接触发装配也不能借裁选图隐去额外原始规则', () => {
    const input = sample();
    input.configuration.triggerRules.push({ ...structuredClone(input.rule), ruleKey: 'extra', sortOrder: 20,
      eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: input.configuration.skill.skillKey } } });
    syncSimulationSkillSources(input.snapshot); approveSnapshotFixture(input.snapshot);
    const selected = structuredClone(input.configuration); selected.triggerRules = [selected.triggerRules[0]!];
    expect(() => assembleTriggeredSkillSources(input.snapshot, [{ side: 'source', kind: 'character', stableId: 'same',
      providerRef: 'same', definitionRef: 'same_definition', path: 'source.skillSources', skills: [{ skillKey: selected.skill.skillKey,
        skillLevel: 3, path: 'source.skillSources', configuration: selected, allowedRootKeys: [input.rule.ruleKey] }] }])).toThrow();
  });
  it('裁选来源不能替换完整作者中的伤害参数', () => {
    const input = sample(); syncSimulationSkillSources(input.snapshot); approveSnapshotFixture(input.snapshot);
    const selected = structuredClone(input.configuration); selected.parameters[0]!.fixedValue = 100;
    expect(() => assembleTriggeredSkillSources(input.snapshot, [{ side: 'source', kind: 'character', stableId: 'same',
      providerRef: 'same', definitionRef: 'same_definition', path: 'source.skillSources', skills: [{ skillKey: selected.skill.skillKey,
        skillLevel: 3, path: 'source.skillSources', configuration: selected, allowedRootKeys: [input.rule.ruleKey] }] }])).toThrow(/完整原作者/);
  });
});
