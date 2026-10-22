import { describe, expect, it } from 'vitest';
import { automaticSkillRequest, type AutomaticSkillInput } from '../../engine/automaticSkillRequest';
import { assembleActiveSkills } from '../../engine/simulationActiveSkills';
import { inspectSimulationSnapshot, prepareSimulation } from '../../engine/simulationAdapter';
import { simulationSkillSourceIdentity } from '../../services/simulationSkillSourceIdentity';
import type { SkillConfiguration } from '../../types/skillConfiguration';
import type { SimulationSkillSetting } from '../../types/simulationSnapshot';
import { simulationActiveSample } from '../../../tests/fixtures/simulationActiveSkill';
import { simulationSample } from '../../../tests/fixtures/simulationSnapshot';
import { finiteImmediatePeriodicSample } from '../../../tests/fixtures/finiteImmediatePeriodic';
import { approveSnapshotFixture } from '../../../tests/fixtures/nativeFormulaProof';
import { fixedValue } from '../../types/numericValue';
import { describeCombatSkill, reconcileCombatRules } from './combatSkillRoster';
import type { SimulationCharacterSkillOption } from './simulationSelectionOptions';

const characterKey = 'source_hero';
const origin = { kind: 'CHARACTER' as const, characterKey };

function active(healing = false) { return structuredClone(simulationActiveSample(healing).skillConfigurations[1]!); }
function option(configuration: SkillConfiguration, basicAttack = false): SimulationCharacterSkillOption {
  return { key: configuration.skill.skillKey, name: configuration.skill.name, kind: 'skill',
    maxLevel: configuration.skill.maxLevel, basicAttack, combat: describeCombatSkill(configuration, basicAttack) };
}
function activeOption(skillKey = 'spell'): SimulationCharacterSkillOption {
  const configuration = active();
  return { ...option(configuration), key: skillKey, name: skillKey, maxLevel: 5 };
}
function setting(skillKey: string, patch: Partial<SimulationSkillSetting> = {}): SimulationSkillSetting {
  return { origin, skillKey, enabled: true, ...patch };
}
function rule(skillKey: string, ruleKey: string, sortOrder: number): AutomaticSkillInput {
  return { origin, skillKey, ruleKey, sortOrder, skillLevel: 2, targetSide: 'target', hitPreset: 'MISS', waitForCooldowns: [], releaseAfterRuleKey: null };
}

describe('混合战斗真实绑定技能描述', () => {
  it('按真实普攻绑定、同源首次主动入口区分普攻／主动／被动，不按分类名或孤立命中推断主动', () => {
    const basic = simulationSample().skillConfigurations[0]!;
    const spell = active();
    const passive = structuredClone(spell);
    passive.triggerRules = passive.triggerRules.filter(row => row.eventSource.eventType === 'SKILL_HIT');
    expect(describeCombatSkill(basic, true).kind).toBe('basic');
    expect(describeCombatSkill(spell, false)).toMatchObject({ kind: 'active', targetSide: 'target', hitPreset: 'TARGET_HIT', issue: null });
    expect(describeCombatSkill(passive, false).kind).toBe('passive');
    passive.triggerRules = structuredClone(spell.triggerRules);
    const event = passive.triggerRules[0]!.eventSource;
    if (event.eventType !== 'SKILL_USED') throw new Error('测试需要技能使用入口');
    event.detail.sourceSkillKey = 'different_author_skill';
    expect(describeCombatSkill(passive, false).kind).toBe('passive');
    event.detail.sourceSkillKey = passive.skill.skillKey;
    event.detail.useKind = 'ANY';
    expect(describeCombatSkill(passive, false).kind).toBe('passive');
    event.detail.useKind = 'ACTIVE'; event.detail.castPhase = 'RECAST';
    expect(describeCombatSkill(passive, false).kind).toBe('passive');
  });

  it('自身直接治疗使用自身和空命中，复杂主动保留显示并说明当前限制', () => {
    expect(describeCombatSkill(active(true), false)).toMatchObject({ kind: 'active', targetSide: 'source', hitPreset: null, issue: null });
    const complex = active();
    complex.processes[0]!.steps.push({ ...structuredClone(complex.processes[0]!.steps[0]!), stepKey: 'second_step' });
    expect(describeCombatSkill(complex, false)).toMatchObject({ kind: 'active', issue: null });
    complex.processes[0]!.steps[1] = { ...complex.processes[0]!.steps[1]!, stepType: 'MULTI_HIT',
      detail: { repeatCountValue: { kind: 'FIXED', value: 2 }, intervalValue: { kind: 'FIXED', value: 10 } } };
    expect(describeCombatSkill(complex, false)).toMatchObject({ kind: 'active', issue: expect.stringContaining('复杂过程') });
  });

  it('有限立即周期区域使用真实对手和空命中预设，自动草稿保留这一目标', async () => {
    const { snapshot, spell } = finiteImmediatePeriodicSample();
    const description = describeCombatSkill(spell,false);
    expect(description).toMatchObject({kind:'active',targetSide:'target',hitPreset:null,issue:null});
    const basic = snapshot.skillConfigurations.find(row => row.skill.skillKey === snapshot.selection.basicAttackSkillKey)!;
    const options = snapshot.skillConfigurations.filter(configuration => snapshot.source.attachedSkills.some(relation => relation.skillKey === configuration.skill.skillKey))
      .map(configuration => option(configuration,configuration.skill.skillKey === basic.skill.skillKey));
    const reconciled = reconcileCombatRules(options,snapshot.selection.sourceCharacterKey,[],snapshot.selection.sourceSkillSettings,{});
    expect(reconciled.enabledRules).toHaveLength(snapshot.selection.plannedSkills.length);
    expect(reconciled.enabledRules.find(rule => rule.skillKey === spell.skill.skillKey)).toMatchObject({targetSide:'target',hitPreset:null});
    const prepared = await prepareSimulation(snapshot,{source:{},target:{}},{source:500,target:1000});
    const request = await automaticSkillRequest(prepared,snapshot,{durationMs:1000,recordTimeSeries:true,attackSpeedInputMax:10,
      rules:reconciled.enabledRules,outputMode:'detailed',maxAutomaticSkillRecords:1000,maxHealingRecords:1000},'ROSTER_PREPARE_ONLY');
    const areaRule = reconciled.enabledRules.find(rule => rule.skillKey === spell.skill.skillKey)!;
    expect(request.runRequest.driverPlan.automaticSkills?.rules.find(rule => rule.ruleKey === areaRule.ruleKey)).toMatchObject({target:'target',hitBindings:[]});
  });

  it.each(['late_start','self_target','non_periodic'] as const)('不把%s的不完整目标效果冒充区域入口', kind => {
    const { spell } = finiteImmediatePeriodicSample();
    const area = spell.effects.find(effect => effect.lifecycle?.firstPeriodicExecution === 'IMMEDIATE')!;
    if (kind === 'late_start') area.lifecycle!.firstPeriodicExecution = 'AFTER_INTERVAL';
    if (kind === 'non_periodic') area.results[0]!.lifecycleBehavior!.moment = 'APPLICATION';
    if (kind === 'self_target') spell.triggerRules.find(rule => rule.eventSource.eventType === 'SKILL_USED')!.conditionGroups.push({
      groupKey:'self',name:'自身目标',sortOrder:0,conditions:[{conditionKey:'self',conditionType:'EXPLICIT_TARGET_IS_SOURCE',detail:{},sortOrder:0}]});
    expect(describeCombatSkill(spell,false).issue).toContain('没有真实命中入口');
  });

  it('缺失或歧义首次过程、缺占用声明及目标矛盾只给问题，不改写配置或冒充可执行', () => {
    const missing = active(); missing.processes = [];
    expect(describeCombatSkill(missing, false).issue).toContain('必要闭包引用缺失');
    const duplicate = active(); duplicate.triggerRules[0]!.actions.push(structuredClone(duplicate.triggerRules[0]!.actions[0]!));
    expect(describeCombatSkill(duplicate, false).issue).toContain('唯一');
    const noOccupancy = active(); delete noOccupancy.processes[0]!.steps[0]!.occupiesAction;
    expect(describeCombatSkill(noOccupancy, false).issue).toContain('占用行动');
    const ambiguous = active(true);
    ambiguous.effects[0]!.results[0]!.target = 'TARGET';
    const frozen = structuredClone(ambiguous);
    expect(describeCombatSkill(ambiguous, false).issue).toContain('高级设置核对');
    expect(ambiguous).toEqual(frozen);
    const redirected = active();
    redirected.triggerRules.find(row => row.eventSource.eventType === 'SKILL_HIT')!.actions[0]!.targetContext = 'EVENT_SOURCE';
    expect(describeCombatSkill(redirected, false).issue).toContain('高级设置核对');
  });

  it.each(['self_cooldown', 'own_counter', 'empty_process'] as const)('现有适配器支持的%s保留自身默认目标并通过真实准备，不由展示猜测拦截', async kind => {
    const snapshot = simulationActiveSample(true);
    const configuration = snapshot.skillConfigurations[1]!;
    if (kind === 'self_cooldown') {
      configuration.effects.push({ ...structuredClone(configuration.effects[0]!), effectKey: 'self_cooldown', results: [{
        resultKey: 'set_cd', name: '完成后自身冷却', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
        lifecycleBehavior: null, spellShieldBlockScope: null,
        valueRule: { value: fixedValue(300), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { operation: 'SET_REMAINING', affectedSkillScope: { mode: 'SKILLS', skillKeys: [configuration.skill.skillKey], skillCategoryKeys: [] } }
      }] });
      configuration.processes[0]!.effectBindings.push({ bindingKey: 'self_cooldown', effectKey: 'self_cooldown', sortOrder: 0,
        moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } });
    } else if (kind === 'own_counter') {
      configuration.internalStates.push({ gameId: configuration.skill.gameId, skillKey: configuration.skill.skillKey,
        stateKey: 'quota', name: '本技能额度', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
        stateType: 'COUNTER', scope: 'TARGET', detail: { initialValue: fixedValue(0), maxValue: fixedValue(1), durationValue: null } });
      configuration.processes[0]!.stateOperations.push({ operationKey: 'reset_quota', name: '成功使用重置',
        stateSkillKey: configuration.skill.skillKey, stateKey: 'quota', operation: 'SET', value: fixedValue(0), optionKey: null,
        moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, sortOrder: 0 });
    } else {
      configuration.effects = [];
      configuration.triggerRules = configuration.triggerRules.filter(rule => rule.actions.some(action => action.actionType === 'START_PROCESS'));
      snapshot.source.skillSources[1]!.enabledRuleKeys = configuration.triggerRules.map(rule => rule.ruleKey);
    }
    const description = option(configuration);
    const reconciled = reconcileCombatRules([description], snapshot.selection.sourceCharacterKey, [], snapshot.selection.sourceSkillSettings, {});
    expect(description.combat).toMatchObject({ kind: 'active', targetSide: 'source', hitPreset: null, issue: null });
    expect(reconciled.issues).toEqual([]);
    expect(reconciled.enabledRules).toHaveLength(1);
    approveSnapshotFixture(snapshot);
    expect(assembleActiveSkills(snapshot).bindings).toHaveLength(1);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const requirement of inspectSimulationSnapshot(snapshot).requirements) {
      if (requirement.storedValue === undefined) inputs[requirement.side][requirement.attribute.attributeKey] = 0;
    }
    const prepared = await prepareSimulation(snapshot, inputs, { source: 250, target: 500 });
    const result = await automaticSkillRequest(prepared, snapshot, { rules: reconciled.enabledRules, durationMs: 1000, recordTimeSeries: false,
      maxAutomaticSkillRecords: 10, maxHealingRecords: 10, outputMode: 'detailed' });
    expect(result.runRequest.driverPlan.automaticSkills!.rules).toHaveLength(1);
    expect(result.runRequest.driverPlan.automaticSkills!.rules[0]).toMatchObject({ target: 'source', hitBindings: [] });
  });

  it('结构提示保持可见但不充当新的硬门禁；不支持的自动过程仍由正式请求路径拒绝', async () => {
    const snapshot = simulationActiveSample(true);
    const configuration = snapshot.skillConfigurations[1]!;
    configuration.processes[0]!.steps.push({ ...structuredClone(configuration.processes[0]!.steps[0]!), stepKey: 'second_step',
      stepType: 'MULTI_HIT', detail: { repeatCountValue: { kind: 'FIXED', value: 2 }, intervalValue: { kind: 'FIXED', value: 10 } } });
    const description = option(configuration);
    const reconciled = reconcileCombatRules([description], snapshot.selection.sourceCharacterKey, [], snapshot.selection.sourceSkillSettings, {});
    expect(description.combat!.issue).toContain('复杂过程');
    expect(reconciled.issues).toEqual([]);
    approveSnapshotFixture(snapshot);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const requirement of inspectSimulationSnapshot(snapshot).requirements) {
      if (requirement.storedValue === undefined) inputs[requirement.side][requirement.attribute.attributeKey] = 0;
    }
    const prepared = await prepareSimulation(snapshot, inputs, { source: 250, target: 500 });
    await expect(automaticSkillRequest(prepared, snapshot, { rules: reconciled.enabledRules, durationMs: 1000, recordTimeSeries: false,
      maxAutomaticSkillRecords: 10, maxHealingRecords: 10, outputMode: 'detailed' })).rejects.toThrow(/步骤|复杂/);
  });
});

describe('混合战斗主动规则协调', () => {
  it('唯一普攻自动匹配；无／多普攻单独报告，不阻断纯主动；被动不生成规则', () => {
    const basic = option(simulationSample().skillConfigurations[0]!, true);
    const passive = active(); passive.triggerRules = [];
    const options = [basic, activeOption(), option(passive)];
    const unique = reconcileCombatRules(options, characterKey, [], [], {});
    expect(unique.basicAttack).toBe(basic);
    expect(unique.basicAttackIssue).toBeNull();
    expect(unique.drafts.map(row => row.skillKey)).toEqual(['spell']);
    expect(unique.issues).toEqual([]);
    const missing = reconcileCombatRules([activeOption()], characterKey, [], [], {});
    expect(missing.basicAttack).toBeNull(); expect(missing.basicAttackIssue).toContain('没有真实'); expect(missing.issues).toEqual([]);
    const multiple = reconcileCombatRules([basic, { ...basic, key: 'another_actual_attack' }], characterKey, [], [], {});
    expect(multiple.basicAttack).toBeNull(); expect(multiple.basicAttackIssue).toContain('2份普通攻击');
  });

  it('全量主动首次生成稳定规则和真实最高等级，自身治疗沿作者目标；不改输入来源设置', () => {
    const settings: SimulationSkillSetting[] = [];
    const options = [activeOption('damage'), { ...option(active(true)), key: 'healing', maxLevel: 3 }];
    const result = reconcileCombatRules(options, characterKey, [], settings, {});
    expect(result.enabledRules).toMatchObject([
      { ruleKey: 'auto_rule_1', skillKey: 'damage', skillLevel: 5, targetSide: 'target', hitPreset: 'TARGET_HIT', sortOrder: 0 },
      { ruleKey: 'auto_rule_2', skillKey: 'healing', skillLevel: 3, targetSide: 'source', hitPreset: null, sortOrder: 1 }
    ]);
    expect(settings).toEqual([]);
    expect(reconcileCombatRules(options, characterKey, result.drafts, settings, {}).drafts).toEqual(result.drafts);
  });

  it('false、0级剔出本次执行但保留草稿，清空启用等级保持NaN并阻断，不偷偷补满', () => {
    const options = ['off', 'unlearned', 'cleared', 'learned'].map(activeOption);
    const settings = [setting('off', { enabled: false }), setting('unlearned', { skillLevel: 0 }), setting('learned', { skillLevel: 2 })];
    const cleared = { [`source:${simulationSkillSourceIdentity(origin, 'cleared')}`]: true };
    const result = reconcileCombatRules(options, characterKey, [], settings, cleared);
    expect(result.drafts).toHaveLength(4);
    expect(result.drafts.find(row => row.skillKey === 'unlearned')!.skillLevel).toBe(0);
    expect(result.enabledRules.map(row => row.skillKey)).toEqual(['cleared', 'learned']);
    expect(result.enabledRules[0]!.skillLevel).toBeNaN();
    expect(result.enabledRules[1]!.skillLevel).toBe(2);
    expect(result.enabledRules.map(row => row.sortOrder)).toEqual([0, 1]);
    expect(result.issues.join(';')).toContain('等级清空');
    expect(result.issues.join(';')).toContain('已学等级');
  });

  it('保留已配置顺序、命中、目标、稳定编号和关系，关闭后再开启恢复；失效引用不静默删除', () => {
    const options = [activeOption('a'), activeOption('b')];
    const previous = [rule('a', 'auto_rule_1', 9), rule('b', 'custom_rule', 2)];
    previous[0]!.waitForCooldowns = ['custom_rule']; previous[0]!.releaseAfterRuleKey = 'custom_rule';
    previous[1]!.targetSide = 'source'; previous[1]!.hitPreset = null;
    const original = structuredClone(previous);
    const disabled = reconcileCombatRules(options, characterKey, previous, [setting('b', { enabled: false })], {});
    expect(disabled.drafts.map(row => row.ruleKey)).toEqual(['custom_rule', 'auto_rule_1']);
    expect(disabled.drafts[1]).toMatchObject({ sortOrder: 9, hitPreset: 'MISS', waitForCooldowns: ['custom_rule'], releaseAfterRuleKey: 'custom_rule' });
    expect(disabled.enabledRules[0]!.sortOrder).toBe(0);
    expect(disabled.issues.join(';')).toContain('未选规则');
    const restored = reconcileCombatRules(options, characterKey, disabled.drafts, [setting('b', { enabled: true })], {});
    expect(restored.issues).toEqual([]);
    expect(restored.enabledRules.map(row => row.ruleKey)).toEqual(['custom_rule', 'auto_rule_1']);
    expect(restored.enabledRules[0]).toMatchObject({ targetSide: 'source', hitPreset: null });
    expect(restored.enabledRules[1]).toMatchObject({ waitForCooldowns: ['custom_rule'], releaseAfterRuleKey: 'custom_rule' });
    expect(previous).toEqual(original);
  });

  it('新编号避开旧编号；不同角色不继承旧规则和旧等级', () => {
    const previous = [rule('same_skill', 'auto_rule_1', 15)];
    previous[0]!.origin = { kind: 'CHARACTER', characterKey: 'previous_hero' };
    previous[0]!.waitForCooldowns = ['foreign'];
    const settings = [{ ...setting('same_skill', { enabled: false, skillLevel: 0 }), origin: previous[0]!.origin }];
    const result = reconcileCombatRules([activeOption('same_skill'), activeOption('new_skill')], characterKey, previous, settings, {});
    expect(result.enabledRules).toMatchObject([
      { ruleKey: 'auto_rule_2', sortOrder: 0, skillLevel: 5, waitForCooldowns: [], releaseAfterRuleKey: null },
      { ruleKey: 'auto_rule_3', sortOrder: 1, skillLevel: 5 }
    ]);
    expect(result.issues).toEqual([]);
  });

  it('17项不裁切，16项启用可执行；未支持主动关闭后不再阻断，全关允许普攻路径', () => {
    const options = Array.from({ length: 17 }, (_, index) => activeOption(`skill_${index}`));
    const all = reconcileCombatRules(options, characterKey, [], [], {});
    expect(all.drafts).toHaveLength(17); expect(all.enabledRules).toHaveLength(17); expect(all.issues.join(';')).toContain('1～16');
    options[16]!.combat!.issue = '未支持的多段';
    const reduced = reconcileCombatRules(options, characterKey, all.drafts, [setting('skill_16', { enabled: false })], {});
    expect(reduced.drafts).toHaveLength(17); expect(reduced.enabledRules).toHaveLength(16); expect(reduced.issues).toEqual([]);
    const allOff = reconcileCombatRules(options, characterKey, reduced.drafts, options.map(row => setting(row.key, { enabled: false })), {});
    expect(allOff.enabledRules).toEqual([]); expect(allOff.issues).toEqual([]); expect(allOff.drafts).toHaveLength(17);
  });
});
