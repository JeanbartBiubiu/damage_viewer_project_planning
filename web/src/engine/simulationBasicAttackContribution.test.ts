import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { simulationBasicAttackContribution } from '../../tests/fixtures/simulationBasicAttackContribution';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { assembleSimulation, inspectSimulationSnapshot, singleAttackRequest } from './simulationAdapter';
import { continuousAttackRequest } from './continuousAttackRequest';
import { assessContinuousAttackResult } from './continuousAttackResult';
import { TinyGoV2Bridge } from '../../tests/fixtures/authorizedBridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { basicAttackContributionAuthorMatches } from './basicAttackContributionContract';
import type { CompileRequest, RunRequest } from '../types/genericEngine';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { automaticSkillRequest } from './automaticSkillRequest';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { assessSingleAttackResult } from './singleAttackResult';

let bridge: TinyGoV2Bridge;
beforeAll(async () => { bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,'
  + readFileSync(new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url)).toString('base64') }); });
function prepare(snapshot: ReturnType<typeof simulationBasicAttackContribution>['snapshot']) {
  approveSnapshotFixture(snapshot);
  const drafts = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) drafts[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, drafts, { source: 300, target: 590 });
}
function run(input: CompileRequest, request: RunRequest) {
  const compiled = parseCompileResult(bridge.compile(input));
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true); expect(compiled.sessionId).toBeTruthy();
  request.sessionId = compiled.sessionId!;
  try { return parseDoneResult(bridge.run(request)); }
  finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId!, input.rulesHash)).released).toBe(true); }
}
const parent = (input: CompileRequest) => input.sharedProviders![0]!;
const candidates = (input: CompileRequest) => parent(input).abilities![2]!.operations![0]!.skillHit!.candidates;

describe('自然技能的同次普攻组成', () => {
  it.each([['extra_alpha', 'attack_alpha'], ['damage_beta', 'strike_beta']])('%s保留真实父身份、原作者路径与独立参数', async (author, attack) => {
    const { snapshot } = simulationBasicAttackContribution(author, attack);
    const prepared = prepare(snapshot), input = prepared.compileRequest;
    const contribution = candidates(input).at(-1)!;
    expect(contribution.participationCondition).toEqual({ op: 'const', value: 1 });
    expect(contribution.operations[0]!.ref).toBe(`skills.${author}.effects.extra.results.damage`);
    expect(JSON.stringify(contribution.operations)).not.toContain('ability.param.');
    expect(JSON.stringify(contribution.operations)).not.toContain('"op":"ref"');
    expect(parent(input).abilities![2]!.params!.base_multiplier).not.toBe(3);
    const parentParameters = input.formulas!.filter(row => row.scope === 'skill' && row.skillKey === attack)
      .flatMap(row => row.scope === 'skill' ? row.parameters : []);
    expect(parentParameters).toContainEqual({ parameterKey: 'base_multiplier', valueMode: 'FIXED', valueType: 'DECIMAL', value: 2 });
    const participant = input.sharedProviders!.find(row => row.skillKey === author)!;
    expect(participant.abilities).toEqual([]);
    const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 1, attackSpeedInputMax: 5, recordTimeSeries: false });
    const done = run(input, runRequest);
    const assessment = assessContinuousAttackResult(input, runRequest, done, prepared.operationOrigins);
    expect(assessment.issues).toEqual([]);
    expect(done.summary.basicAttack).toMatchObject({ startedCount: 1, hitCount: 1, completedCount: 1 });
    expect(done.damageRecords).toHaveLength(2);
    const rows = done.damageRecords!;
    expect(typeof rows[0]!.useRef).toBe('string'); expect(rows[0]!.useRef.length).toBeGreaterThan(0);
    expect(rows[0]!.useRef).toBe(rows[1]!.useRef);
    expect(rows[0]!.castInstanceId).toBeGreaterThan(0); expect(Number.isInteger(rows[0]!.castInstanceId)).toBe(true);
    expect(rows[0]!.castInstanceId).toBe(rows[1]!.castInstanceId);
    expect(rows[0]!.attackIndex).toBe(1); expect(rows[1]!.attackIndex).toBe(1);
    expect(rows[1]!.rawAmount).toBeCloseTo(12, 12);
    expect(rows[1]!.abilityRef).toBe(rows[0]!.abilityRef);
    expect(done.summary.sourceDamageDealt).toBeCloseTo(60 * 100 / 121 + 12, 10);
  });

  it.each([0, .5, 1])('概率%s沿作者独立倍率，不重复乘暴击或借父同名参数', async chance => {
    const { snapshot } = simulationBasicAttackContribution('critical_part', 'critical_parent', chance);
    const prepared = prepare(snapshot);
    const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 1, attackSpeedInputMax: 5, recordTimeSeries: false });
    const done = run(prepared.compileRequest, runRequest);
    expect(done.damageRecords![0]!.rawAmount).toBeCloseTo(60 * (1 + chance * 1.25), 10);
    expect(done.damageRecords![1]!.rawAmount).toBeCloseTo(12 * (1 + chance * 2.25), 10);
    expect(assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins).issues).toEqual([]);
  });

  it('生命偷取基于父攻击分类，作者效率参数不落进父能力', async () => {
    const { snapshot, configuration } = simulationBasicAttackContribution('vamp_part');
    snapshot.source.selectedLevelValues.life_steal_percent = .1;
    const damage = configuration.effects[0]!.results[0]!;
    if (damage.resultType !== 'DAMAGE') throw new Error('fixture');
    damage.detail.vampOverrides = [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'POST_DEFENSE_DAMAGE',
      efficiencyValue: { kind: 'PARAMETER', parameterKey: 'base_multiplier' } }];
    const prepared = prepare(snapshot);
    const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 1, attackSpeedInputMax: 5, recordTimeSeries: false });
    const done = run(prepared.compileRequest, runRequest);
    expect(done.summary.sourceVampHealing).toBeCloseTo((60 * 100 / 121) * .1 + 12 * .1 * 3, 10);
    expect(assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins).issues).toEqual([]);
  });

  it.each([false, 0])('关闭或0级%s不生成贡献，也不改父候选', enabledOrLevel => {
    const { snapshot } = simulationBasicAttackContribution();
    const setting = snapshot.selection.sourceSkillSettings[0]!;
    if (enabledOrLevel === false) setting.enabled = false; else setting.skillLevel = 0;
    syncSimulationSkillSources(snapshot);
    expect(candidates(prepare(snapshot).compileRequest)).toHaveLength(2);
  });

  it('不能把其它必要事件尾规则留在未接入来源后仍成功', () => {
    const { snapshot, configuration } = simulationBasicAttackContribution();
    configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'other',
      eventSource: { eventType: 'DAMAGE_DEALT', detail: { sourceSkillKey: configuration.skill.skillKey, damageTypeKey: null,
        deliveryKind: 'ANY', originKind: 'ANY' } } });
    syncSimulationSkillSources(snapshot);
    expect(() => prepare(snapshot)).toThrow(/不能遗漏/);
  });

  it('必需总属性仍须显式供值并生成完整四字段槽位', () => {
    const { snapshot } = simulationBasicAttackContribution();
    delete snapshot.source.selectedLevelValues.attack_damage;
    approveSnapshotFixture(snapshot);
    expect(() => assembleSimulation(snapshot, { source: {}, target: {} }, { source: 300, target: 590 })).toThrow(/有限数值/);
    const prepared = prepare(snapshot);
    const slot = prepared.compileRequest.combatants[0]!.attributes.attack_damage!;
    expect(Object.keys(slot).sort()).toEqual(['base', 'current', 'max', 'resolved']);
    expect(Object.values(slot).every(Number.isFinite)).toBe(true);
  });

  it('删除整笔贡献并同步伪造其它统计仍因每个父命中必需而拒绝', async () => {
    const { snapshot } = simulationBasicAttackContribution();
    const prepared = prepare(snapshot);
    const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 1, attackSpeedInputMax: 5, recordTimeSeries: false });
    const removed = structuredClone(prepared.compileRequest);
    candidates(removed).pop();
    const done = run(removed, runRequest);
    const assessment = assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins);
    expect(assessment.factsValid).toBe(false);
    expect(assessment.issues.some(issue => /缺少完整作者伤害结果/.test(issue)), JSON.stringify(assessment.issues)).toBe(true);
  });

  it('作者、挂载或参与条件篡改不得通过跨作者白名单', () => {
    const { snapshot } = simulationBasicAttackContribution();
    const prepared = prepare(snapshot), input = prepared.compileRequest;
    const origin = prepared.operationOrigins.find(row => row.skillKey === 'extra_alpha')!;
    const ability = parent(input).abilities![2]!;
    const check = () => basicAttackContributionAuthorMatches(input, origin, ability, 'sharedProviders[0].abilities[2]', 'source', prepared.basicAttackBinding!.hitAbilityRef);
    expect(check()).toBe(true);
    const candidate = candidates(input).at(-1)!;
    candidate.participationCondition = { op: 'const', value: 0 }; expect(check()).toBe(false);
    candidate.participationCondition = { op: 'const', value: 1 };
    candidate.participationProviderRef = 'other'; expect(check()).toBe(false);
  });

  it.each(['actions', 'rules'] as const)('两个%s执行同一结果仍保留两笔，作者映射只合路径', async where => {
    const { snapshot, configuration } = simulationBasicAttackContribution();
    if (where === 'actions') configuration.triggerRules[0]!.actions.push({ ...structuredClone(configuration.triggerRules[0]!.actions[0]!), actionKey: 'second', sortOrder: 1 });
    else configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'second', sortOrder: 1 });
    syncSimulationSkillSources(snapshot);
    const prepared = prepare(snapshot);
    expect(prepared.operationOrigins.filter(row => row.skillKey === configuration.skill.skillKey)).toHaveLength(1);
    expect(prepared.operationOrigins.find(row => row.skillKey === configuration.skill.skillKey)!.compiledPaths).toHaveLength(2);
    const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 1, attackSpeedInputMax: 5, recordTimeSeries: false });
    const done = run(prepared.compileRequest, runRequest);
    expect(done.damageRecords!.map(row => row.rawAmount)).toEqual([60, 12, 12]);
    expect(assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins).issues).toEqual([]);
    const singleRequest = singleAttackRequest(prepared.compileRequest, '');
    const single = run(prepared.compileRequest, singleRequest);
    expect(assessSingleAttackResult(prepared.compileRequest, singleRequest, single).issues).toEqual([]);
  });

  it('单次入口不能跳过缺失的必需贡献', () => {
    const { snapshot } = simulationBasicAttackContribution();
    const prepared = prepare(snapshot);
    const request = singleAttackRequest(prepared.compileRequest, '');
    const removed = structuredClone(prepared.compileRequest);
    candidates(removed).pop();
    const done = run(removed, request);
    const assessment = assessSingleAttackResult(prepared.compileRequest, request, done);
    expect(assessment.complete).toBe(false);
    expect(assessment.issues.some(issue => /缺少所选伤害结果/.test(issue))).toBe(true);
  });

  it.each(['zero', 'summary', 'duplicate'] as const)('%s模式仍按完整分类笔数拒绝缺失或多余贡献', async mode => {
    const { snapshot, configuration } = simulationBasicAttackContribution();
    configuration.triggerRules[0]!.actions.push({ ...structuredClone(configuration.triggerRules[0]!.actions[0]!), actionKey: 'second', sortOrder: 1 });
    syncSimulationSkillSources(snapshot);
    const prepared = prepare(snapshot);
    const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 3000, attackSpeedInputMax: 5, recordTimeSeries: false });
    runRequest.recordBudget = { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0 };
    if (mode === 'summary') runRequest.outputMode = 'summary';
    const full = run(prepared.compileRequest, runRequest);
    expect(assessContinuousAttackResult(prepared.compileRequest, runRequest, full, prepared.operationOrigins).issues).toEqual([]);
    const changed = structuredClone(prepared.compileRequest);
    if (mode === 'duplicate') {
      const extra = structuredClone(candidates(changed).at(-1)!);
      extra.candidateKey += '/duplicate'; extra.effectOccurrenceKey += '/duplicate';
      candidates(changed).push(extra);
    } else candidates(changed).pop();
    const done = run(changed, runRequest);
    const assessment = assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins);
    expect(assessment.factsValid).toBe(false);
    expect(assessment.issues.some(issue => /完整分类汇总缺少每刀必需组成或重复结算/.test(issue)), JSON.stringify(assessment.issues)).toBe(true);
  });

  it.each([10, 55] as const)('目标%s生命：父致死仍记录尾部，贡献致死保留同次身份', async health => {
    const { snapshot } = simulationBasicAttackContribution();
    snapshot.source.selectedLevelValues.life_steal_percent = .1;
    const prepared = prepare(snapshot);
    prepared.compileRequest.combatants[1]!.attributes.hp!.current = health;
    const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 1, attackSpeedInputMax: 5, recordTimeSeries: false });
    const done = run(prepared.compileRequest, runRequest);
    expect(done.damageRecords).toHaveLength(2);
    expect(done.damageRecords![1]!.actualHpLoss).toBeCloseTo(health === 10 ? 0 : health - 60 * 100 / 121, 10);
    expect(done.summary.execution).toMatchObject({ targetKilled: true, targetKilledAtMs: 0, complete: true });
    expect(assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins).issues).toEqual([]);
  });

  it('受控单次入口预先显式建盾，逐结果吸收而非合并两笔', () => {
    const { snapshot } = simulationBasicAttackContribution();
    const prepared = prepare(snapshot);
    const input = prepared.compileRequest;
    input.sharedProviders!.push({ providerKey: 'probe_shield', kind: 'character', stableId: 'probe_shield',
      abilities: [{ abilityKey: 'explicit_shield', kind: 'active',
        operations: [{ operation: 'shield', target: 'target', shieldRef: 'explicit_55', amount: { op: 'const', value: 55 }, shieldDurationMs: { op: 'const', value: 1000 } }] }] });
    input.combatants[0]!.providers.push({ providerRef: 'probe_shield', definitionRef: 'probe_shield' });
    const runRequest = singleAttackRequest(input, '');
    runRequest.driverPlan.entries.unshift({ entryKey: 'explicit_shield', abilityRef: 'source.provider[probe_shield].ability[explicit_shield]', source: 'source', target: 'target', firstAtMs: 0, priority: -1 });
    runRequest.initialSnapshot = simulationInitialSnapshot(input);
    const done = run(input, runRequest);
    const rows = done.evidence.items.filter(row => row.kind === 'damage').map(row => row.data!);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.actualHpLoss).toBe(0);
    expect(rows[0]!.shieldAbsorbed).toBeCloseTo(60 * 100 / 121, 10);
    expect(rows[1]!.shieldAbsorbed).toBeCloseTo(55 - 60 * 100 / 121, 10);
    expect(rows[1]!.actualHpLoss).toBeCloseTo(60 * 100 / 121 + 12 - 55, 10);
  });

  it('显式防御倍率0逐结果零伤，仍保留一次父命中及两条记录', async () => {
    const { snapshot } = simulationBasicAttackContribution();
    const prepared = prepare(snapshot);
    const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 1, attackSpeedInputMax: 5, recordTimeSeries: false });
    for (const type of prepared.compileRequest.rules.damageTypeFormulas!) type.formula = { inputs: [], stages: [{ key: 'zero', name: '明确测试防御因子0', expression: { op: 'const', value: '0' } }], outputStageKey: 'zero' };
    const done = run(prepared.compileRequest, runRequest);
    expect(done.damageRecords).toHaveLength(2);
    expect(done.damageRecords!.every(row => row.postDefenseDamage === 0 && row.actualHpLoss === 0)).toBe(true);
    expect(done.summary.basicAttack!.hitCount).toBe(1);
  });

  it('混合主动与背景普攻同样合入组成，不生成自然来源主动事件', async () => {
    const { snapshot } = simulationBasicAttackContribution();
    const activeSample = simulationActiveSample();
    const active = activeSample.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
    snapshot.skillConfigurations.push(active);
    snapshot.source.attachedSkills.push(activeSample.source.attachedSkills.find(row => row.skillKey === active.skill.skillKey)!);
    snapshot.catalogs.skillCategories.push(activeSample.catalogs.skillCategories.find(row => row.skillCategoryKey === 'active')!);
    snapshot.selection.plannedSkills = structuredClone(activeSample.selection.plannedSkills);
    snapshot.selection.sourceSkillSettings.push(structuredClone(activeSample.selection.sourceSkillSettings.find(row => row.skillKey === active.skill.skillKey)!));
    syncSimulationSkillSources(snapshot);
    const prepared = prepare(snapshot);
    const { runRequest } = await automaticSkillRequest(prepared, snapshot, { durationMs: 500, recordTimeSeries: false, attackSpeedInputMax: 5,
      rules: [{ ...snapshot.selection.plannedSkills[0]!, ruleKey: 'auto', sortOrder: 0, targetSide: 'target', hitPreset: 'TARGET_HIT', waitForCooldowns: [], releaseAfterRuleKey: null }],
      maxAutomaticSkillRecords: 64, maxHealingRecords: 64, outputMode: 'detailed' });
    const done = run(prepared.compileRequest, runRequest);
    expect(done.summary.basicAttack!.hitCount).toBeGreaterThan(0);
    expect(done.damageRecords!.filter(row => row.operationRef.startsWith('skills.extra_alpha.'))).toHaveLength(done.summary.basicAttack!.hitCount);
    expect(assessAutomaticSkillResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins).issues).toEqual([]);
  });

  it('零明细与汇总保留完整结果和释放，不把日志缺省当漏算', async () => {
    const { snapshot } = simulationBasicAttackContribution();
    const prepared = prepare(snapshot);
    const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 1, attackSpeedInputMax: 5, recordTimeSeries: false });
    const full = run(prepared.compileRequest, runRequest);
    const request = structuredClone(runRequest);
    request.recordBudget = { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0 };
    const sparse = run(prepared.compileRequest, request);
    expect(sparse.summary).toEqual(full.summary);
    expect(assessContinuousAttackResult(prepared.compileRequest, request, sparse, prepared.operationOrigins).factsValid).toBe(true);
  });
});
