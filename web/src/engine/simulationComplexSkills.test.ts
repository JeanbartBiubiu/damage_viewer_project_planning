import { approveSnapshotFixture, approveAuthoredFixture } from '../../tests/fixtures/nativeFormulaProof';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { describe, expect, it } from 'vitest';
import { complexAction, complexHitRules, complexInputs, simulationComplexSample, simulationComplexNaturalSample } from '../../tests/fixtures/simulationComplexSkills';
import { assembleActiveSkills as raw_assembleActiveSkills } from './simulationActiveSkills';
import { inspectSimulationSnapshot as raw_inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { skillActionRequest } from './skillActionRequest';
import { adaptHitProgram as raw_adaptHitProgram } from './hitAdapter';
import { normalizeSimulationSelection } from '../services/simulationSnapshotClient';
import { plannedSkillsFromActions, removeSkillActionDraft, skillActionParentCandidates, skillActionPhases } from '../pages/simulation/simulationSkillActionDrafts';
import { fixedValue, parameterValue, formulaValue } from '../types/numericValue';

async function prepared(snapshot = simulationComplexSample()) {
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  return prepareSimulation(snapshot, attributes, { source: 1000, target: 5000 });
}

describe('6C有限步骤和真实阶段', () => {
  it('保留即时开始加末尾蓄力，执行起算普通冷却，取消和到期失败尾部设置本技能剩余冷却', () => {
    const snapshot = simulationComplexSample('CHARGE');
    const configuration = snapshot.skillConfigurations[1]!;
    const process = configuration.processes[0]!;
    process.steps[0] = { ...process.steps[0]!, stepType: 'IMMEDIATE', detail: {} };
    const terminal = process.steps[1]!;
    if (terminal.stepType !== 'CHARGE') throw new Error('样例步骤不符');
    terminal.detail = { minimumChargeValue: fixedValue(0), maximumChargeValue: fixedValue(6000), releaseAtMaximum: false };
    process.cooldown = { durationValue: fixedValue(8000), startMoment: { momentType: 'STEP_EXECUTION', stepKey: terminal.stepKey, failureReason: null } };
    const result = { resultKey: 'set_cancel_cd', name: '取消剩余冷却', resultType: 'COOLDOWN_CHANGE' as const, target: 'SOURCE' as const,
      description: null, sortOrder: 0, lifecycleBehavior: null, spellShieldBlockScope: null,
      valueRule: { value: fixedValue(3000), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { operation: 'SET_REMAINING' as const, affectedSkillScope: { mode: 'SKILLS' as const, skillKeys: [configuration.skill.skillKey], skillCategoryKeys: [] } } };
    configuration.effects.push({ ...structuredClone(configuration.effects[0]!), effectKey: 'cancel_cd', results: [result] });
    for (const failureReason of ['ACTIVE_CANCELLED', 'EVENT_ABORTED'] as const) process.effectBindings.push({
      bindingKey: `failure_${failureReason.toLowerCase()}`, effectKey: 'cancel_cd', sortOrder: process.effectBindings.length,
      moment: { momentType: 'PROCESS_FAILURE', stepKey: null, failureReason } });
    const assembly = assembleActiveSkills(snapshot);
    const provider = assembly.providers[0]!;
    const compiled = provider.processes![0]!;
    expect(compiled.steps.map(step => step.stepType)).toEqual(['IMMEDIATE', 'CHARGE']);
    expect(compiled.cooldown).toMatchObject({ startMoment: { momentType: 'STEP_EXECUTION', stepKey: terminal.stepKey }, durationMs: { op: 'const', value: 8000 } });
    for (const failureReason of ['ACTIVE_CANCELLED', 'EVENT_ABORTED']) expect(compiled.momentOperations.find(group => group.moment.failureReason === failureReason)?.operations)
      .toEqual([expect.objectContaining({ operation: 'cooldown_change', valuePolicy: 'set_remaining', target: 'source',
        amount: { op: 'const', value: 3000 }, abilityRef: expect.stringContaining('self.provider[') })]);
    expect(compiled.momentOperations.every(group => group.operations.every(operation => !operation.abilityRef?.includes('@mount')))).toBe(true);
    result.detail.affectedSkillScope.skillKeys = ['another_skill'];
    expect(() => assembleActiveSkills(snapshot)).toThrow(/明确的本技能/);
  });
  it('指定窗口保留原生表达式、不展平，1毫秒两段合法', () => {
    const snapshot = simulationComplexSample('CHANNEL');
    const channel = snapshot.skillConfigurations[1]!.processes[0]!.steps[1]!;
    if (channel.stepType !== 'CHANNEL') throw new Error('样例步骤不符');
    channel.detail = { durationValue: fixedValue(1), executionCountValue: fixedValue(2), firstExecution: 'CUSTOM_WINDOW',
      firstExecutionOffsetValue: fixedValue(0), lastExecutionOffsetValue: fixedValue(1) };
    const original = structuredClone(snapshot);
    const assembly = assembleActiveSkills(snapshot);
    const step = assembly.providers[0]!.processes![0]!.steps[1]!;
    expect(step).toMatchObject({ stepType: 'CHANNEL', durationMs: { op: 'const', value: 1 }, executionCount: { op: 'const', value: 2 },
      firstExecution: 'CUSTOM_WINDOW', firstExecutionOffsetMs: { op: 'const', value: 0 }, lastExecutionOffsetMs: { op: 'const', value: 1 } });
    expect(snapshot).toEqual(original);
  });
  it('首末窗口支持真实参数与具名公式，静态公式同样检查范围', () => {
    const snapshot = simulationComplexSample('CHANNEL');
    const configuration = snapshot.skillConfigurations[1]!;
    configuration.parameters = ['first', 'last'].map((parameterKey, index) => ({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey,
      parameterKey, name: parameterKey, description: null, sortOrder: index, valueType: 'INTEGER', valueMode: 'FIXED',
      fixedValue: index === 0 ? 5 : 105, levelValues: null, createdAt: '', updatedAt: '' }));
    configuration.formulas = [{ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, formulaKey: 'last_formula', name: '末段',
      description: null, sortOrder: 0, expression: skillFormulaDefinition(configuration.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'last' }), createdAt: '', updatedAt: '' }];
    const channel = configuration.processes[0]!.steps[1]!;
    if (channel.stepType !== 'CHANNEL') throw new Error('样例步骤不符');
    channel.detail.firstExecution = 'CUSTOM_WINDOW';
    channel.detail.firstExecutionOffsetValue = parameterValue('first');
    channel.detail.lastExecutionOffsetValue = formulaValue('last_formula');
    expect(assembleActiveSkills(snapshot).providers[0]!.processes![0]!.steps[1]).toMatchObject({
      firstExecutionOffsetMs: { op: 'const', value: 5 }, lastExecutionOffsetMs: { op: 'ref', ref: 'process/sample_active/levels/1/1/last_formula' } });
    configuration.parameters[1]!.fixedValue = 601;
    expect(() => assembleActiveSkills(snapshot)).toThrow(/末段偏移不能超过/);
  });
  it.each([
    { first: -1, last: 100, count: 3, duration: 600 }, { first: 0.5, last: 100, count: 3, duration: 600 },
    { first: 101, last: 100, count: 3, duration: 600 }, { first: 0, last: 601, count: 3, duration: 600 },
    { first: 5, last: 6, count: 3, duration: 600 }, { first: 5, last: 6, count: 1, duration: 600 },
    { first: 0, last: 1, count: 2, duration: 0 }, { first: 0, last: 1, count: 2, duration: 1.5 },
    { first: 0, last: Number.MAX_SAFE_INTEGER + 1, count: 2, duration: Number.MAX_SAFE_INTEGER },
    { first: undefined, last: 100, count: 3, duration: 600 }, { first: 0, last: undefined, count: 3, duration: 600 }
  ])('指定窗口拒绝非法范围或缺端点：$first/$last/$count/$duration', ({ first, last, count, duration }) => {
    const snapshot = simulationComplexSample('CHANNEL');
    const channel = snapshot.skillConfigurations[1]!.processes[0]!.steps[1]!;
    if (channel.stepType !== 'CHANNEL') throw new Error('样例步骤不符');
    channel.detail = { durationValue: fixedValue(duration), executionCountValue: fixedValue(count), firstExecution: 'CUSTOM_WINDOW',
      ...(first === undefined ? {} : { firstExecutionOffsetValue: fixedValue(first) }),
      ...(last === undefined ? {} : { lastExecutionOffsetValue: fixedValue(last) }) };
    expect(() => assembleActiveSkills(snapshot)).toThrow();
  });
  it.each(['IMMEDIATE', 'AFTER_INTERVAL'] as const)('等分口径%s不接受夹带端点，包括空值', firstExecution => {
    const snapshot = simulationComplexSample('CHANNEL');
    const channel = snapshot.skillConfigurations[1]!.processes[0]!.steps[1]!;
    if (channel.stepType !== 'CHANNEL') throw new Error('样例步骤不符');
    channel.detail.firstExecution = firstExecution;
    for (const value of [fixedValue(0), null]) {
      Object.assign(channel.detail, { firstExecutionOffsetValue: value });
      expect(() => assembleActiveSkills(snapshot)).toThrow(/firstExecutionOffsetValue/);
    }
  });
  it('不同真实同角色来源可监听指定技能命中并写自己的计数，不泛化为普通攻击命中', async () => {
    const snapshot = simulationComplexNaturalSample();
    const assembly = await prepared(snapshot);
    const listener = assembly.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? [])
      .find(ability => ability.abilityKey === 'count_active_hit')!.listenerSpec!;
    expect(listener.eventMatcher.all).toEqual(['event/skill_hit', 'event/source_owner', 'ability/skill/sample_active']);
    expect(listener.operations!.some(operation => operation.operation === 'state_change')).toBe(true);
    expect(listener.operations!.some(operation => operation.operation === 'damage')).toBe(true);
    const equipment = assembly.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? [])
      .find(ability => ability.abilityKey === 'resolve_on_basic_attack_hit')!.listenerSpec!;
    expect(equipment.eventMatcher.all).toContain('event/basic_attack_hit');
    expect(equipment.eventMatcher.all).not.toContain('event/skill_hit');
  });
  it.each(['MULTI_HIT', 'CHANNEL', 'CHARGE', 'RECAST'] as const)('完整原过程%s不静态展平，命中绑定唯一末尾真实步骤执行', kind => {
    const snapshot = simulationComplexSample(kind);
    const original = structuredClone(snapshot);
    const assembly = assembleActiveSkills(snapshot);
    const binding = assembly.bindings[0]!;
    const process = assembly.providers.find(provider => provider.providerKey === binding.providerDefinitionRef)!.processes![0]!;
    expect(process.steps.map(step => step.stepType)).toEqual(['DELAY', kind]);
    expect(process.steps.every(step => step.occupiesAction === true)).toBe(true);
    expect(binding.hitBindings).toHaveLength(1);
    expect(binding.hitBindings[0]!.moment).toEqual({ momentType: 'STEP_EXECUTION', stepKey: 'complex', failureReason: null });
    expect(binding.controls.map(control => control.action).sort()).toEqual([...snapshot.selection.plannedSkills[0]!.phaseKinds].sort());
    expect(skillActionPhases(snapshot.skillConfigurations[1])).toEqual([...snapshot.selection.plannedSkills[0]!.phaseKinds].sort());
    expect(snapshot).toEqual(original);
  });

  it('纯即时与延时多步骤仍只有唯一过程完成命中', () => {
    const snapshot = simulationComplexSample();
    snapshot.skillConfigurations[1]!.processes[0]!.steps[1] = { stepKey: 'last', name: '普通即时', description: null, sortOrder: 1,
      occupiesAction: false, stepType: 'IMMEDIATE', detail: {} };
    expect(assembleActiveSkills(snapshot).bindings[0]!.hitBindings[0]!.moment).toEqual({ momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null });
  });

  it.each([0, 65, 1.5, NaN])('拒绝非法有限段数%s', count => {
    const snapshot = simulationComplexSample();
    const step = snapshot.skillConfigurations[1]!.processes[0]!.steps[1]!;
    if (step.stepType !== 'MULTI_HIT') throw new Error('样例步骤不符');
    step.detail.repeatCountValue = fixedValue(count);
    expect(() => assembleActiveSkills(snapshot)).toThrow();
  });

  it('单段可空间隔，多段及任何步骤的空占用不得补默认值；复杂步骤只准唯一末尾', () => {
    const snapshot = simulationComplexSample();
    const step = snapshot.skillConfigurations[1]!.processes[0]!.steps[1]!;
    if (step.stepType !== 'MULTI_HIT') throw new Error('样例步骤不符');
    step.detail.intervalValue = null;
    expect(() => assembleActiveSkills(snapshot)).toThrow(/间隔/);
    step.detail.repeatCountValue = fixedValue(1);
    expect(assembleActiveSkills(snapshot).providers[0]!.processes![0]!.steps[1]!.intervalMs).toBeNull();
    step.occupiesAction = null;
    expect(() => assembleActiveSkills(snapshot)).toThrow(/occupiesAction/);
    step.occupiesAction = true;
    snapshot.skillConfigurations[1]!.processes[0]!.steps.push({ ...snapshot.skillConfigurations[1]!.processes[0]!.steps[0]!, stepKey: 'after', sortOrder: 2 });
    expect(() => assembleActiveSkills(snapshot)).toThrow(/唯一|末尾/);
  });

  it('阶段集合四种可选且至少首次，重复或外来阶段拒绝', () => {
    const snapshot = simulationComplexSample('CHARGE');
    expect(normalizeSimulationSelection(snapshot.selection).plannedSkills[0]!.phaseKinds).toEqual(['CANCEL', 'CHARGE_RELEASE', 'INITIAL']);
    for (const phases of [['RECAST'], ['INITIAL', 'INITIAL'], ['INITIAL', 'INTERRUPT']]) {
      const selection = structuredClone(snapshot.selection);
      Object.assign(selection.plannedSkills[0]!, { phaseKinds: phases });
      expect(() => normalizeSimulationSelection(selection)).toThrow(/phaseKinds/);
    }
  });

  it('取消阶段只能绑定真实取消请求与主动取消失败，不能伪装SKILL_USED阶段', () => {
    const snapshot = simulationComplexSample('CHARGE');
    const configuration = snapshot.skillConfigurations[1]!;
    const cancel = configuration.triggerRules.find(rule => rule.ruleKey === 'cancel_cast')!;
    cancel.eventSource = { eventType: 'SKILL_USED', detail: { sourceSkillKey: configuration.skill.skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } };
    expect(() => assembleActiveSkills(snapshot)).toThrow(/取消/);
  });

  it('引导完整时长和段数不合法或多于64原步骤都拒绝，不生成静态段指令', () => {
    const snapshot = simulationComplexSample('CHANNEL');
    const process = snapshot.skillConfigurations[1]!.processes[0]!;
    const channel = process.steps[1]!;
    if (channel.stepType !== 'CHANNEL') throw new Error('样例步骤不符');
    channel.detail.durationValue = fixedValue(2);
    expect(() => assembleActiveSkills(snapshot)).toThrow(/时长不得小于次数/);
    process.steps = Array.from({ length: 65 }, (_, index) => ({ ...process.steps[0]!, stepKey: `step_${index}`, sortOrder: index }));
    expect(() => assembleActiveSkills(snapshot)).toThrow(/1～64/);
  });

  it('按完整排序关联原首次，原数组可以逆序；控制不造使用、不改父预设', async () => {
    const snapshot = simulationComplexSample('CHARGE');
    const assembly = await prepared(snapshot);
    const initial = complexAction(snapshot, 'z_first', 0);
    const release = complexAction(snapshot, 'a_release', 400, 'CHARGE_RELEASE', 'z_first');
    const inputs = complexInputs([release, initial]);
    const run = await skillActionRequest(assembly, snapshot, inputs);
    expect(run.runRequest.driverPlan.skillActions!.map(action => action.instructionKey)).toEqual(['z_first', 'a_release']);
    expect(run.runRequest.driverPlan.skillActions![1]).toMatchObject({ parentInstructionKey: 'z_first', hitBindings: [] });
    expect(plannedSkillsFromActions(inputs.actions)).toHaveLength(1);
    expect(skillActionParentCandidates(inputs.actions, release)).toEqual([initial]);
    for (const invalid of [
      { ...release, atMs: 0 }, { ...release, targetSide: 'source' as const }, { ...release, skillLevel: 2 },
      { ...release, parentInstructionKey: 'missing' }, { ...release, hitPreset: 'MISS' as const }, { ...release, atMs: NaN }
    ]) await expect(skillActionRequest(assembly, snapshot, complexInputs([initial, invalid]))).rejects.toThrow();
    const sameTime = { ...release, atMs: 0, sortOrder: 1 };
    expect((await skillActionRequest(assembly, snapshot, complexInputs([sameTime, initial]))).runRequest.driverPlan.skillActions).toHaveLength(2);
    const cancel = complexAction(snapshot, 'later_cancel', 500, 'CANCEL', 'a_release');
    await expect(skillActionRequest(assembly, snapshot, complexInputs([initial, release, cancel]))).rejects.toThrow(/原首次|首次/);
  });

  it('删除父首次只清空相关控制的无效父，不删除控制草稿或暗选另一个首次', () => {
    const snapshot = simulationComplexSample('CHARGE');
    const first = complexAction(snapshot, 'first', 0);
    const other = complexAction(snapshot, 'other', 100);
    const release = complexAction(snapshot, 'release', 400, 'CHARGE_RELEASE', 'first');
    const actions = removeSkillActionDraft([first, other, release], 'first');
    expect(actions).toEqual([other, { ...release, parentInstructionKey: null }]);
    expect(skillActionParentCandidates(actions, actions[1]!)).toEqual([other]);
    expect(actions[1]!.parentInstructionKey).toBeNull();
    expect(release.parentInstructionKey).toBe('first');
  });

  it('蓄力毫秒只绑定实际同源释放的该命中动作；不对其它动态输入或动作补零', () => {
    const snapshot = simulationComplexSample('CHARGE');
    const configuration = snapshot.skillConfigurations[1]!;
    const authored = { gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, skillLevel: 1, characterLevel: 1,
      rules: complexHitRules(snapshot), effects: configuration.effects, parameters: configuration.parameters, formulas: configuration.formulas,
      statuses: snapshot.catalogs.statuses, skillCategoryKeys: configuration.skill.skillCategoryKeys, vampRules: snapshot.catalogs.vampRules.rules,
      identity: { source: { category: 'CHAMPION' as const, hostility: 'SELF' as const }, target: { category: 'CHAMPION' as const, hostility: 'ENEMY' as const } },
      chargeReleaseContext: { process: configuration.processes[0]!, rules: configuration.triggerRules } };
    const hit = adaptHitProgram(authored);
    expect(JSON.stringify(hit.formulas)).toContain('use_charge_duration');
    expect(hit.params).not.toHaveProperty('charged_ms');
    expect(() => adaptHitProgram({ ...authored, chargeReleaseContext: undefined })).toThrow(/同源蓄力/);
    const wrong = structuredClone(authored);
    wrong.chargeReleaseContext.process.skillKey = 'another_skill';
    expect(() => adaptHitProgram(wrong)).toThrow(/同源蓄力/);
    const onlyInitial = structuredClone(authored);
    onlyInitial.chargeReleaseContext.rules = onlyInitial.chargeReleaseContext.rules.filter(rule => rule.ruleKey !== 'release_cast');
    for (const policy of [false, null, 'true', 1]) {
      Object.assign(onlyInitial.chargeReleaseContext.process.steps[1]!.detail, { releaseAtMaximum: policy });
      expect(() => adaptHitProgram(onlyInitial)).toThrow(/同源蓄力/);
    }
    const binding = authored.rules[0]!.actions[0]!.runtimeInputBindings[0]!;
    Object.assign(binding, { detail: { eventValueKey: 'SKILL_HIT_FIRST_CONTACT' } });
    expect(() => adaptHitProgram(authored)).toThrow(/同源蓄力/);
  });

  it('未选中释放根不能授予本次命中充能输入，作者明确最大自动释放才可仅选首次', () => {
    const snapshot = simulationComplexSample('CHARGE');
    snapshot.selection.plannedSkills[0]!.phaseKinds = ['INITIAL'];
    expect(snapshot.skillConfigurations[1]!.triggerRules.some(rule => rule.ruleKey === 'release_cast')).toBe(true);
    expect(() => assembleActiveSkills(snapshot)).toThrow(/同源蓄力/);
    const step = snapshot.skillConfigurations[1]!.processes[0]!.steps[1]!;
    if (step.stepType !== 'CHARGE') throw new Error('样例步骤不符');
    step.detail.releaseAtMaximum = true;
    const assembly = assembleActiveSkills(snapshot);
    expect(assembly.bindings[0]!.controls.map(control => control.action)).toEqual(['INITIAL']);
    expect(JSON.stringify(assembly.formulas)).toContain('use_charge_duration');
  });
});

const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };
const adaptHitProgram = (...args: Parameters<typeof raw_adaptHitProgram>): ReturnType<typeof raw_adaptHitProgram> => { approveAuthoredFixture(args[0]); return raw_adaptHitProgram(...args); };

const assembleActiveSkills = (...args: Parameters<typeof raw_assembleActiveSkills>): ReturnType<typeof raw_assembleActiveSkills> => { approveSnapshotFixture(args[0]); return raw_assembleActiveSkills(...args); };
