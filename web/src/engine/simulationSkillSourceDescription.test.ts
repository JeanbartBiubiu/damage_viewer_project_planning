import { describe, expect, it } from 'vitest';
import { targetTimingSample } from '../../tests/fixtures/targetTiming';
import { fixedValue } from '../types/numericValue';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { naturalRuleKeys, validateSimulationSkillSourceManifest } from './simulationSkillSourceDescription';
import { assembleNaturalSkillSources } from './simulationNaturalSkillSources';

function attach(snapshot: SimulationSnapshot, configuration: SkillConfiguration, side: 'source' | 'target' = 'source') {
  snapshot.skillConfigurations.push(configuration);
  const actor = snapshot[side], origin = { kind: 'CHARACTER' as const, characterKey: actor.character.characterKey };
  actor.attachedSkills.push({ ...actor.attachedSkills[0]!, skillKey: configuration.skill.skillKey, skillName: configuration.skill.name });
  const source: SimulationSkillSource = { origin, skillKey: configuration.skill.skillKey, skillName: configuration.skill.name,
    skillStatus: 'ENABLED', enabled: true, skillLevel: 1, enabledRuleKeys: [], inactiveReason: null };
  actor.skillSources.push(source);
  snapshot.selection[`${side}SkillSettings`].push({ origin, skillKey: source.skillKey, enabled: true, skillLevel: 1 });
  return source;
}

function damageRootSample() {
  const sample = targetTimingSample(), { snapshot, configuration } = sample;
  const active = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  const unused = JSON.parse(JSON.stringify(active).replaceAll('sample_active', 'unused_active')) as SkillConfiguration;
  const unusedSource = attach(snapshot, unused); unusedSource.inactiveReason = 'ACTIVE_DEFERRED';
  const disabled = JSON.parse(JSON.stringify(active).replaceAll('sample_active', 'disabled_active')) as SkillConfiguration;
  const disabledSource = attach(snapshot, disabled); disabledSource.enabled = false; disabledSource.inactiveReason = 'SCENE_DISABLED';
  snapshot.selection.sourceSkillSettings.find(row => row.skillKey === disabledSource.skillKey)!.enabled = false;
  const keys = [
    ['kill_actual', active.skill.skillKey], ['kill_self', configuration.skill.skillKey],
    ['kill_basic', snapshot.selection.basicAttackSkillKey!], ['kill_unused', unused.skill.skillKey],
    ['kill_disabled', disabled.skill.skillKey], ['kill_missing', 'missing_source']
  ] as const;
  const killed = keys.map(([ruleKey, sourceSkillKey], index): SkillTriggerRuleDetail => ({
    ...structuredClone(sample.killed), ruleKey, sortOrder: 100 + index,
    eventSource: { eventType: 'DAMAGE_DEALT', detail: { sourceSkillKey, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' } }
  }));
  configuration.triggerRules = [sample.onHit, sample.tail, ...killed];
  const owner = snapshot.source.skillSources.find(source => source.skillKey === configuration.skill.skillKey)!;
  owner.enabledRuleKeys = ['apply_on_hit', 'kill_actual', 'kill_basic', 'kill_self'];
  return { ...sample, owner, active, unused, unusedSource, disabled, disabledSource };
}

function observe(snapshot: SimulationSnapshot, side: 'source' | 'target', events: Array<[string, SkillTriggerRuleDetail['eventSource']]>) {
  const base = snapshot.skillConfigurations[0]!, skillKey = `observer_${side}`;
  const configuration: SkillConfiguration = { ...structuredClone(base),
    skill: { ...base.skill, skillKey, skillCategoryKeys: [] }, parameters: [], formulas: [], effects: [], internalStates: [],
    processes: [{ ...structuredClone(base.processes[0]!), skillKey, processKey: 'observe', activationType: 'PASSIVE',
      cooldown: null, effectBindings: [], stateOperations: [] }],
    triggerRules: events.map(([ruleKey, eventSource], index) => ({ ...structuredClone(base.triggerRules[0]!),
      ruleKey, eventSource, sortOrder: index,
      actions: [{ actionKey: 'observe', name: '观察事件', actionType: 'START_PROCESS', sortOrder: 0,
        detail: { processKey: 'observe' }, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }] })) };
  const source = attach(snapshot, configuration, side);
  return { configuration, source };
}

describe('自然伤害监听仅从实际事件产生源展开', () => {
  it('保留后台普攻、实际主动与被动自身周期/爆炸，拒绝未计划、关闭及缺失来源', () => {
    const sample = damageRootSample(), before = structuredClone(sample.snapshot);
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner))
      .toEqual(['apply_on_hit', 'kill_actual', 'kill_basic', 'kill_self']);
    expect(() => validateSimulationSkillSourceManifest(sample.snapshot)).not.toThrow();
    expect(sample.snapshot).toEqual(before);
  });

  it('第二个来源实际计划后才加入该来源监听，不开启其它主动入口', () => {
    const sample = damageRootSample();
    sample.snapshot.selection.plannedSkills.push({ origin: sample.unusedSource.origin as { kind: 'CHARACTER'; characterKey: string },
      skillKey: sample.unusedSource.skillKey, skillLevel: 1, phaseKinds: ['INITIAL'] });
    sample.unusedSource.inactiveReason = null;
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner))
      .toEqual(['apply_on_hit', 'kill_actual', 'kill_basic', 'kill_self', 'kill_unused']);
  });

  it('不选后台普攻时仍保留实际主动和被动自产伤害，不虚构普攻伤害', () => {
    const sample = damageRootSample();
    sample.snapshot.selection.basicAttackSkillKey = null; sample.snapshot.selection.basicAttackLevel = null;
    sample.snapshot.source.skillSources[0]!.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
    sample.snapshot.source.skillSources[0]!.enabledRuleKeys = [];
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner))
      .toEqual(['apply_on_hit', 'kill_actual', 'kill_self']);
  });

  it('未计划时序被动不被自伤监听循环唤醒，不装配状态或资源依赖', () => {
    const sample = damageRootSample();
    sample.snapshot.selection.plannedSkills = [];
    const active = sample.snapshot.source.skillSources.find(source => source.skillKey === sample.active.skill.skillKey)!;
    active.inactiveReason = 'ACTIVE_DEFERRED'; active.enabledRuleKeys = [];
    sample.owner.inactiveReason = 'ACTIVE_DEFERRED'; sample.owner.enabledRuleKeys = [];
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner)).toEqual([]);
    const natural = assembleNaturalSkillSources(sample.snapshot);
    expect(natural.providers).toEqual([]);
    expect([...natural.required.source]).toEqual([]);
    expect(natural.origins.find(row => row.skillKey === sample.configuration.skill.skillKey)?.providerRef).toBeUndefined();
  });

  for (const reason of ['SCENE_DISABLED', 'UNLEARNED', 'CONFIGURATION_INCOMPLETE', 'LEVEL_REQUIRED'] as const) {
    it(`${reason}来源即使有初始化伤害也不能借闭包变成实际产生源`, () => {
      const sample = damageRootSample();
      const initial = structuredClone(sample.unused.triggerRules[1]!);
      initial.ruleKey = 'source_init_damage'; initial.eventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
      sample.unused.triggerRules = [initial];
      sample.unusedSource.inactiveReason = reason;
      sample.unusedSource.enabled = reason !== 'SCENE_DISABLED';
      if (reason === 'UNLEARNED') sample.unusedSource.skillLevel = 0;
      if (reason === 'LEVEL_REQUIRED') sample.unusedSource.skillLevel = null;
      expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner)).not.toContain('kill_unused');
    });
  }

  it('被动周期和爆炸沿作者结果的真实伤害分类匹配自产伤害监听', () => {
    const sample = damageRootSample();
    const damage = sample.configuration.effects.flatMap(effect => effect.results).filter(result => result.resultType === 'DAMAGE');
    expect(damage).toHaveLength(2);
    const self = sample.configuration.triggerRules.find(rule => rule.ruleKey === 'kill_self')!;
    if (self.eventSource.eventType !== 'DAMAGE_DEALT') throw new Error('需要合成逐伤监听');
    self.eventSource.detail.originKind = 'REFLECTED';
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner)).not.toContain('kill_self');
    self.eventSource.detail.originKind = 'DIRECT';
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner)).toContain('kill_self');
  });

  it('后台普攻真实结果按伤害来源、种类及承受方匹配三类伤害事件', () => {
    const sample = damageRootSample(), key = sample.snapshot.selection.basicAttackSkillKey!;
    const filter = { sourceSkillKey: key, damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK' as const, originKind: 'DIRECT' as const };
    const events: Array<[string, SkillTriggerRuleDetail['eventSource']]> = [
      ['dealt', { eventType: 'DAMAGE_DEALT', detail: filter }],
      ['pending', { eventType: 'DAMAGE_PENDING', detail: filter }],
      ['taken', { eventType: 'DAMAGE_TAKEN', detail: filter }],
      ['wrong_skill', { eventType: 'DAMAGE_DEALT', detail: { ...filter, sourceSkillKey: sample.unused.skill.skillKey } }],
      ['wrong_type', { eventType: 'DAMAGE_DEALT', detail: { ...filter, damageTypeKey: 'unproduced_damage' } }],
      ['wrong_delivery', { eventType: 'DAMAGE_DEALT', detail: { ...filter, deliveryKind: 'SKILL' } }],
      ['wrong_origin', { eventType: 'DAMAGE_DEALT', detail: { ...filter, originKind: 'REFLECTED' } }]
    ];
    const source = observe(sample.snapshot, 'source', events), target = observe(sample.snapshot, 'target', events);
    expect(naturalRuleKeys(sample.snapshot, source.configuration, 'source', source.source)).toEqual(['dealt']);
    expect(naturalRuleKeys(sample.snapshot, target.configuration, 'target', target.source)).toEqual(['pending', 'taken']);
  });

  it('普攻开始和命中监听所产生的伤害也能继续展开结果监听', () => {
    const sample = damageRootSample();
    sample.unusedSource.inactiveReason = null;
    const damage = sample.unused.effects[0]!.results[0]!;
    if (damage.resultType !== 'DAMAGE') throw new Error('需要合成伤害');
    damage.valueRule!.value = fixedValue(7);
    damage.detail.critical = { mode: 'DISALLOWED', multiplierValue: null };
    for (const eventType of ['BASIC_ATTACK_START', 'BASIC_ATTACK_HIT'] as const) {
      sample.unused.triggerRules = [{ ...structuredClone(sample.unused.triggerRules[sample.unused.triggerRules.length - 1]!),
        eventSource: { eventType, detail: {} } }];
      expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner)).toContain('kill_unused');
    }
  });

  it('普攻受击方的真实反击会为原攻击方产生承受伤害事件', () => {
    const sample = damageRootSample();
    const receiver = observe(sample.snapshot, 'target', [['retaliate', { eventType: 'BASIC_ATTACK_RECEIVED', detail: {} }]]);
    const base = sample.snapshot.skillConfigurations[0]!, damage = structuredClone(base.effects[1]!.results[0]!);
    if (damage.resultType !== 'DAMAGE') throw new Error('需要合成伤害');
    damage.valueRule!.value = fixedValue(7);
    damage.detail.critical = { mode: 'DISALLOWED', multiplierValue: null };
    receiver.configuration.effects.push({ ...structuredClone(base.effects[1]!), skillKey: receiver.source.skillKey,
      effectKey: 'retaliate', results: [damage] });
    receiver.configuration.processes[0]!.effectBindings.push({ bindingKey: 'retaliate', effectKey: 'retaliate', sortOrder: 0,
      moment: { momentType: 'STEP_EXECUTION', stepKey: receiver.configuration.processes[0]!.steps[0]!.stepKey, failureReason: null } });
    const detail = { sourceSkillKey: receiver.source.skillKey, damageTypeKey: null, deliveryKind: 'ANY' as const, originKind: 'ANY' as const };
    const source = observe(sample.snapshot, 'source', [
      ['pending', { eventType: 'DAMAGE_PENDING', detail }], ['taken', { eventType: 'DAMAGE_TAKEN', detail }],
      ['dealt', { eventType: 'DAMAGE_DEALT', detail }]
    ]);
    expect(naturalRuleKeys(sample.snapshot, source.configuration, 'source', source.source)).toEqual(['pending', 'taken']);
  });

  it('只有可达普攻链接结果才允许链接监听继续产生伤害', () => {
    const sample = damageRootSample(), basic = sample.snapshot.skillConfigurations[0]!;
    sample.unusedSource.inactiveReason = null;
    sample.unused.triggerRules = [{ ...structuredClone(sample.unused.triggerRules[1]!),
      eventSource: { eventType: 'HIT_LINK_APPLIED', detail: { sourceSkillKey: basic.skill.skillKey } } }];
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner)).toContain('kill_unused');
    basic.effects[1]!.results = basic.effects[1]!.results.filter(result => result.resultType !== 'HIT_LINK_APPLICATION');
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner)).not.toContain('kill_unused');
  });

  it('选中普攻也不能为作者没有声明的伤害结果生成监听', () => {
    const sample = damageRootSample(), basic = sample.snapshot.skillConfigurations[0]!;
    basic.effects[1]!.results = basic.effects[1]!.results.filter(result => result.resultType !== 'DAMAGE');
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source', sample.owner)).not.toContain('kill_basic');
  });

  it('无普攻和主动计划时，泛技能命中监听不能自我创造事件入口', () => {
    const sample = damageRootSample();
    sample.snapshot.selection.basicAttackSkillKey = null; sample.snapshot.selection.basicAttackLevel = null;
    sample.snapshot.selection.plannedSkills = [];
    const observer = observe(sample.snapshot, 'source', [['unused_hit', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } }]]);
    expect(naturalRuleKeys(sample.snapshot, observer.configuration, 'source', observer.source)).toEqual([]);
  });
});
