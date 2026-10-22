import { describe, expect, it } from 'vitest';
import { finiteImmediatePeriodicSample } from '../../tests/fixtures/finiteImmediatePeriodic';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { prepareSimulation } from './simulationAdapter';
import { finiteImmediatePeriodicBinding, finiteImmediatePeriodicDamageSource, finitePeriodicTargetsOpponent } from './finiteImmediatePeriodicContract';
import type { ProcessInstanceSnapshot } from '../types/genericEngine';
import { skillActionRequest, type SkillActionInput } from './skillActionRequest';
import { automaticSkillRequest } from './automaticSkillRequest';

describe('有限纯周期立即首跳与独立总冷却比例返还', () => {
  it('PROCESS_START只施加一次有限实例，明确序列化0首延迟，250毫秒占用与区域独立', async () => {
    const { snapshot, configuration, spell } = finiteImmediatePeriodicSample();
    configuration.effects.pop(); configuration.triggerRules.pop(); syncSimulationSkillSources(snapshot);
    const value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    const binding = value.compileRequest.rules.skillActionBindings!.find(row => row.skillKey === spell.skill.skillKey)!;
    const parent = value.compileRequest.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
    const apply = parent.processes![0]!.momentOperations.flatMap(row => row.operations).find(row => row.operation === 'apply_provider')!;
    const area = value.compileRequest.sharedProviders!.find(row => row.providerKey === apply.providerDefinitionRef)!;
    expect(apply.target).toBe('self');
    expect(area).toMatchObject({ stableId: parent.stableId, skillKey: spell.skill.skillKey, kind: 'status',
      lifecycle: { durationMs: { op: 'const', value: 5000 }, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' } });
    expect(area.abilities).toHaveLength(1);
    expect(area.abilities![0]!.tickSpec).toMatchObject({ intervalMs: 500, startDelayMs: 0, onTick: [{ operation: 'damage', target: 'target' }] });
    expect(JSON.parse(JSON.stringify(area)).abilities[0].tickSpec.startDelayMs).toBe(0);
    expect(area.abilities![0]!.tickSpec).not.toHaveProperty('phasePolicy');
    expect(parent.processes![0]!.steps).toMatchObject([{ stepType: 'DELAY', delayMs: { op: 'const', value: 250 }, occupiesAction: true }]);
  });
  it('独立监听按实际同拥有者INITIAL引用绑定总时长比例，不猜能力名', async () => {
    const { snapshot, spell } = finiteImmediatePeriodicSample();
    const value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    const binding = value.compileRequest.rules.skillActionBindings!.find(row => row.skillKey === spell.skill.skillKey)!;
    const refund = value.compileRequest.sharedProviders!.flatMap(row => row.abilities ?? []).flatMap(row => row.listenerSpec?.operations ?? []).find(row => row.valuePolicy === 'reduce_total_ratio')!;
    expect(refund).toMatchObject({ operation: 'cooldown_change', target: 'self', valuePolicy: 'reduce_total_ratio', amount: { op: 'const', value: .05 },
      abilityRef: binding.controls.find(row => row.action === 'INITIAL')!.abilityRef });
  });
  it('W关闭时只排除退款，实际其它技能仍保留P自疗，不生成空退款能力', async () => {
    const { snapshot, spell, configuration } = finiteImmediatePeriodicSample();
    snapshot.selection.sourceSkillSettings.find(row => row.skillKey === spell.skill.skillKey)!.enabled = false;
    snapshot.selection.plannedSkills = snapshot.selection.plannedSkills.filter(row => row.skillKey !== spell.skill.skillKey);
    syncSimulationSkillSources(snapshot);
    const value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    const listeners = value.compileRequest.sharedProviders!.flatMap(row => row.abilities ?? []).filter(row => row.skillKey === configuration.skill.skillKey && row.listenerSpec);
    expect(listeners).toHaveLength(1); expect(listeners[0]!.listenerSpec!.operations).toMatchObject([{ operation: 'heal' }]);
    expect(value.coverage.some(row => row.authorPath.includes('on_settled_refund') && row.note?.includes('关闭'))).toBe(true);
  });
  it.each(['zero', 'unplanned'] as const)('W%s仅排除退款且P正常保留', async kind => {
    const { snapshot, spell, configuration } = finiteImmediatePeriodicSample();
    snapshot.selection.plannedSkills = snapshot.selection.plannedSkills.filter(row => row.skillKey !== spell.skill.skillKey);
    if (kind === 'zero') snapshot.selection.sourceSkillSettings.find(row => row.skillKey === spell.skill.skillKey)!.skillLevel = 0;
    syncSimulationSkillSources(snapshot);
    const value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    const abilities = value.compileRequest.sharedProviders!.flatMap(row => row.abilities ?? []).filter(row => row.skillKey === configuration.skill.skillKey);
    expect(abilities.filter(row => row.listenerSpec)).toHaveLength(1);
    expect(abilities.flatMap(row => row.listenerSpec?.operations ?? []).map(row => row.operation)).toEqual(['heal']);
  });
  it.each(['off', 'zero'] as const)('P%s不生成治疗或退款，但完整区域仍可编译', async kind => {
    const { snapshot, configuration } = finiteImmediatePeriodicSample();
    const setting = snapshot.selection.sourceSkillSettings.find(row => row.skillKey === configuration.skill.skillKey)!;
    if (kind === 'off') setting.enabled = false; else setting.skillLevel = 0;
    syncSimulationSkillSources(snapshot);
    const value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    expect(value.compileRequest.sharedProviders!.flatMap(row => row.abilities ?? []).some(row => row.skillKey === configuration.skill.skillKey)).toBe(false);
    expect(value.compileRequest.sharedProviders!.some(row => row.abilities?.some(ability => ability.tickSpec?.startDelayMs === 0))).toBe(true);
  });
  it.each(['off', 'zero', 'unplanned'] as const)('六条作者规则、真实只Q双入口清单在W%s时保留清单但只抑制退款', async kind => {
    const { snapshot, configuration, spell, auxiliary, rule, refundRule } = finiteImmediatePeriodicSample();
    const thirdKey = 'unplanned_third_spell', third = JSON.parse(JSON.stringify(auxiliary).replaceAll(auxiliary.skill.skillKey, thirdKey));
    snapshot.skillConfigurations.push(third);
    snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills.find(row => row.skillKey === auxiliary.skill.skillKey)!, skillKey: thirdKey });
    snapshot.selection.sourceSkillSettings.push({ ...snapshot.selection.sourceSkillSettings.find(row => row.skillKey === auxiliary.skill.skillKey)!, skillKey: thirdKey });
    configuration.triggerRules = [];
    for (const [index, sourceSkillKey] of [auxiliary.skill.skillKey, spell.skill.skillKey, thirdKey].entries()) for (const [effectIndex, template] of [rule, refundRule].entries()) {
      const item = structuredClone(template); item.ruleKey = `skill_${index}_${effectIndex}`; item.sortOrder = index * 2 + effectIndex;
      if (item.eventSource.eventType !== 'DAMAGE_DEALT') throw new Error('需要真实自身伤害筛选');
      item.eventSource.detail.sourceSkillKey = sourceSkillKey; configuration.triggerRules.push(item);
    }
    snapshot.selection.plannedSkills = snapshot.selection.plannedSkills.filter(row => row.skillKey === auxiliary.skill.skillKey);
    const areaSetting = snapshot.selection.sourceSkillSettings.find(row => row.skillKey === spell.skill.skillKey)!;
    if (kind === 'off') areaSetting.enabled = false; if (kind === 'zero') areaSetting.skillLevel = 0;
    syncSimulationSkillSources(snapshot);
    const source = snapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!;
    // 旧通用夹具把所有DAMAGE规则当根；本例显式写入新后台真实producer闭包的只Q双入口清单。
    source.enabledRuleKeys = ['skill_0_0', 'skill_0_1'];
    const before = structuredClone(configuration), value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    expect(configuration).toEqual(before); expect(configuration.triggerRules).toHaveLength(6);
    const trace = value.skillOrigins.find(row => row.side === 'source' && row.skillKey === configuration.skill.skillKey)!;
    expect(trace.enabledRuleKeys).toEqual(source.enabledRuleKeys);
    const listeners = value.compileRequest.sharedProviders!.flatMap(row => row.abilities ?? []).filter(row => row.skillKey === configuration.skill.skillKey && row.listenerSpec);
    expect(listeners).toHaveLength(1); expect(listeners[0]!.listenerSpec!.operations).toMatchObject([{ operation: 'heal' }]);
    expect(value.coverage.some(row => row.authorPath.endsWith('triggerRules.skill_0_1') && row.note?.includes('仅排除本退款监听'))).toBe(true);
  });
  it('完整共同公式保留逐跳法强/目标当前生命依赖，不预先快照', async () => {
    const { snapshot, spell } = finiteImmediatePeriodicSample();
    const value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    const formula = value.compileRequest.formulas!.find(row => row.skillKey === spell.skill.skillKey && row.key.includes('current_periodic_damage'))!;
    expect(formula.expression).toEqual(spell.formulas[0]!.expression);
    expect(formula.expression.inputs.map(row => row.binding)).toEqual([
      { kind: 'attribute', view: 'current_frame', object: 'source', valueKind: 'TOTAL', attributeKey: 'ability_power' },
      { kind: 'attribute', view: 'current_frame', object: 'target', valueKind: 'CURRENT', attributeKey: 'hp' },
      { kind: 'attribute', view: 'current_frame', object: 'target', valueKind: 'MAX', attributeKey: 'hp' }
    ]);
    expect(JSON.stringify(value.compileRequest.sharedProviders!.find(row => row.kind === 'status')!.abilities![0]!.tickSpec!.onTick[0]!.amount)).toContain(formula.key);
    expect(value.operationOrigins.some(row => row.effectKey === 'finite_area' && row.compiledPaths.some(path => path.includes('tickSpec.onTick[0]')))).toBe(true);
  });
  it.each(['infinite', 'multiple_layers', 'wrong_scope', 'snapshot', 'mixed_result', 'spellshield', 'nonperiodic', 'shared', 'bad_interval', 'wrong_apply_moment'] as const)('拒绝借立即首跳扩大其它图：%s', async kind => {
    const { snapshot, area, damage, spell } = finiteImmediatePeriodicSample();
    if (kind === 'infinite') area.lifecycle!.durationValue = null;
    if (kind === 'multiple_layers') area.lifecycle!.maxStacksValue = { kind: 'FIXED', value: 2 };
    if (kind === 'wrong_scope') area.lifecycle!.instanceScope = 'SOURCE';
    if (kind === 'snapshot') damage.lifecycleBehavior!.valueReadMode = 'APPLICATION_SNAPSHOT';
    if (kind === 'mixed_result') area.results.push({ ...structuredClone(damage), resultKey: 'heal', resultType: 'DIRECT_HEAL', target: 'SOURCE', detail: {} } as never);
    if (kind === 'spellshield') damage.spellShieldBlockScope = 'SKILL';
    if (kind === 'nonperiodic') damage.lifecycleBehavior!.moment = 'APPLICATION';
    if (kind === 'shared') damage.lifecycleBehavior!.stackValueMode = 'SHARED';
    if (kind === 'bad_interval') area.lifecycle!.periodicIntervalValue = { kind: 'FIXED', value: 0 };
    if (kind === 'wrong_apply_moment') spell.processes[0]!.effectBindings[0]!.moment = { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null };
    syncSimulationSkillSources(snapshot);
    await expect(prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 })).rejects.toThrow();
  });
  it('手动和自动都沿实际区域选择对手且保持空命中预设与后台普攻', async () => {
    const { snapshot, spell } = finiteImmediatePeriodicSample();
    snapshot.selection.plannedSkills = snapshot.selection.plannedSkills.filter(row => row.skillKey === spell.skill.skillKey); syncSimulationSkillSources(snapshot);
    const value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    const action: SkillActionInput = { ...snapshot.selection.plannedSkills[0]!, instructionKey: 'area', atMs: 0, sortOrder: 0,
      phaseKind: 'INITIAL', parentInstructionKey: null, targetSide: 'target', hitPreset: null };
    const manual = { actions: [action], durationMs: 5000, attackSpeedInputMax: .1, recordTimeSeries: false, maxSkillActionRecords: 100, maxSkillUseRecords: 100, maxHealingRecords: 100 };
    const automatic = { rules: [{ origin: action.origin, skillKey: action.skillKey, skillLevel: 1, ruleKey: 'area', sortOrder: 0, targetSide: 'target' as const,
      hitPreset: null, waitForCooldowns: [], releaseAfterRuleKey: null }], durationMs: 5000, attackSpeedInputMax: .1, recordTimeSeries: false, maxAutomaticSkillRecords: 100, maxHealingRecords: 100, outputMode: 'detailed' as const };
    const request = await skillActionRequest(value, snapshot, manual), auto = await automaticSkillRequest(value, snapshot, automatic);
    expect(request.runRequest.driverPlan.skillActions![0]).toMatchObject({ target: 'target', hitBindings: [] });
    expect(auto.runRequest.driverPlan.automaticSkills!.rules[0]).toMatchObject({ target: 'target', hitBindings: [] });
    expect(request.runRequest.driverPlan.basicAttack).toBeDefined(); expect(auto.runRequest.driverPlan.basicAttack).toBeDefined();
    for (const patch of [{ targetSide: 'source' as const }, { hitPreset: 'TARGET_HIT' as const }]) {
      await expect(skillActionRequest(value, snapshot, { ...manual, actions: [{ ...action, ...patch }] })).rejects.toThrow(/hitPreset/);
      await expect(automaticSkillRequest(value, snapshot, { ...automatic, rules: [{ ...automatic.rules[0]!, ...patch }] })).rejects.toThrow(/hitPreset/);
    }
  });
  it.each(['no_initial', 'wrong_stable_id', 'wrong_skill', 'no_parent_mount', 'extra_parent_mount', 'initial_area', 'no_zero', 'anchored', 'wrong_application', 'lifecycle_tick', 'linked_shield', 'target_expiry'] as const)('编译区域读取者必须闭合真实身份：%s', async kind => {
    const { snapshot, spell } = finiteImmediatePeriodicSample();
    const value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    const input = value.compileRequest, binding = input.rules.skillActionBindings!.find(row => row.skillKey === spell.skill.skillKey)!;
    const provider = input.sharedProviders!.find(row => row.kind === 'status')!, ability = provider.abilities![0]!;
    expect(finiteImmediatePeriodicBinding(input, provider, ability)).toBe(binding); expect(finitePeriodicTargetsOpponent(input, binding)).toBe(true);
    const parent = input.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!, actor = input.combatants.find(row => row.key === 'source')!;
    if (kind === 'no_initial') binding.controls = [];
    if (kind === 'wrong_stable_id') provider.stableId = 'other';
    if (kind === 'wrong_skill') ability.skillKey = 'other';
    if (kind === 'no_parent_mount') actor.providers = actor.providers.filter(row => row.definitionRef !== parent.providerKey);
    if (kind === 'extra_parent_mount') actor.providers.push({ providerRef: 'duplicate', definitionRef: parent.providerKey });
    if (kind === 'initial_area') actor.providers.push({ providerRef: 'forged_area', definitionRef: provider.providerKey });
    if (kind === 'no_zero') delete ability.tickSpec!.startDelayMs;
    if (kind === 'anchored') ability.tickSpec!.anchorStateKey = 'forged_anchor';
    if (kind === 'wrong_application') parent.processes![0]!.momentOperations[0]!.operations[0]!.target = 'target';
    if (kind === 'lifecycle_tick') provider.lifecycle!.tickIntervalMs = 500;
    if (kind === 'linked_shield') provider.linkedShieldDefinitionRef = 'not_this_contract';
    if (kind === 'target_expiry') ability.targetExpirySpec = { anchorScope: 'state_scope/provider_target', anchorStateKey: 'foreign', onExpire: [] };
    expect(finiteImmediatePeriodicBinding(input, provider, ability)).toBeUndefined(); expect(finitePeriodicTargetsOpponent(input, binding)).toBe(false);
  });
  it('动态来源核真实首次/实例/原相位，刷新不重建首跳且严格排除到期', async () => {
    const { snapshot, spell } = finiteImmediatePeriodicSample();
    const value = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
    const input = value.compileRequest, binding = input.rules.skillActionBindings!.find(row => row.skillKey === spell.skill.skillKey)!;
    const provider = input.sharedProviders!.find(row => row.kind === 'status')!, ability = provider.abilities![0]!, operation = ability.tickSpec!.onTick[0]!;
    const process: ProcessInstanceSnapshot = { owner: 'source', target: 'target', providerRef: binding.providerRef, skillKey: binding.skillKey,
      processKey: binding.controls[0]!.processKey, useKey: 'skill:area', startedAtMs: 0, stepStartedAtMs: 0, stepKey: 'cast_time', stepVersion: 1,
      stepExecutionIndex: 1, lastExecutionAtMs: 250, stepCompletedAtMs: 250, advanceAtMs: 250, expiresAtMs: null,
      actualCosts: {}, cooldownStarted: true, status: 'complete', failureReason: null, finishedAtMs: 250, repeat: null, actionOccupancies: [] };
    const summary = { owner: 'source', source: 'source', target: 'target', providerDefinitionRef: provider.providerKey,
      abilityRef: `source.provider[${provider.providerKey}#1].ability[${ability.abilityKey}]`, operationRef: operation.ref, damageType: operation.damageType };
    const row = { ...summary, attackIndex: null, useRef: '', timeMs: 4500, providerActivatedAtMs: 0,
      operationPath: `sharedProviders[${input.sharedProviders!.indexOf(provider)}].abilities[0].tickSpec.onTick[0]` };
    expect(finiteImmediatePeriodicDamageSource(input, summary, [process])).toBe(true);
    expect(finiteImmediatePeriodicDamageSource(input, row, [process])).toBe(true);
    expect(finiteImmediatePeriodicDamageSource(input, { ...row, timeMs: 5000 }, [process])).toBe(false);
    const refreshed = [process, { ...process, useKey: 'skill:area_second', startedAtMs: 3600, stepStartedAtMs: 3600, finishedAtMs: 3850 }];
    expect(finiteImmediatePeriodicDamageSource(input, { ...row, timeMs: 5000 }, refreshed)).toBe(true);
    expect(finiteImmediatePeriodicDamageSource(input, { ...row, timeMs: 3600, providerActivatedAtMs: 3600 }, refreshed)).toBe(false);
    expect(finiteImmediatePeriodicDamageSource(input, { ...row, timeMs: 8600 }, refreshed)).toBe(false);
    for (const mutation of [{ owner: 'target' }, { source: 'target' }, { target: 'source' }, { providerDefinitionRef: 'other' },
      { abilityRef: `source.provider[${provider.providerKey}#0].ability[${ability.abilityKey}]` }, { operationRef: 'other' }, { damageType: 'other' },
      { operationPath: 'sharedProviders[0].abilities[0].operations[0]' }, { providerActivatedAtMs: 1 }, { timeMs: 4501 }, { useRef: 'skill:area' },
      { attackIndex: 0 }, { instructionKey: 'area' }, { hitRef: 'fake' }]) expect(finiteImmediatePeriodicDamageSource(input, { ...row, ...mutation }, [process]), JSON.stringify(mutation)).toBe(false);
    expect(finiteImmediatePeriodicDamageSource(input, row, [])).toBe(false);
    expect(finiteImmediatePeriodicDamageSource(input, row, [{ ...process, stepVersion: 0, status: 'failed' }])).toBe(false);
  });
});
