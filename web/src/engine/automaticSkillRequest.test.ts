import { describe, expect, it } from 'vitest';
import { preparedActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { automaticSkillRequest, plannedSkillsFromAutomaticRules, validateAutomaticSkillRelations, type AutomaticSkillInput, type AutomaticSkillInputs } from './automaticSkillRequest';

const rules: AutomaticSkillInput[] = [{ origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_active', skillLevel: 1,
  ruleKey: 'a', sortOrder: 0, targetSide: 'target', hitPreset: 'TARGET_HIT', waitForCooldowns: [], releaseAfterRuleKey: null }];
const inputs: AutomaticSkillInputs = { rules, durationMs: 200, recordTimeSeries: false, maxAutomaticSkillRecords: 1000, maxHealingRecords: 256, outputMode: 'detailed' };

describe('自动规则的真实首次闭包与独立运行装配', () => {
  it('没有手动动作也能运输完整首次，未命中只改变预设，不裁剪作者闭包', async () => {
    const { snapshot, prepared } = preparedActiveSample();
    const original = structuredClone(snapshot);
    const run = await automaticSkillRequest(prepared, snapshot, inputs);
    expect(snapshot).toEqual(original);
    expect(run.runRequest.driverPlan).toMatchObject({ entries: [], skillActions: [], automaticSkills: { rules: [{ ruleKey: 'a',
      bindingKey: prepared.compileRequest.rules.skillActionBindings![0]!.bindingKey, sortOrder: 0, target: 'target', waitForCooldowns: [], releaseAfterRuleKey: null }] } });
    expect(run.runRequest.driverPlan.basicAttack).toBeUndefined();
    for (const field of ['skillUses', 'skillHitFacts', 'attackStartFacts', 'processCommandFacts'] as const) expect(run.runRequest[field]).toEqual([]);
    const missed = await automaticSkillRequest(prepared, snapshot, { ...inputs, rules: [{ ...rules[0]!, hitPreset: 'MISS' }] });
    expect(missed.runRequest.driverPlan.automaticSkills!.rules[0]!.hitBindings).toHaveLength(1);
    expect(missed.runInputHash).not.toBe(run.runInputHash);
  });
  it('自身治疗使用空命中预设；记录0与汇总独立于采样并进入冻结摘要', async () => {
    const { snapshot, prepared } = preparedActiveSample(true);
    const input = { ...inputs, rules: [{ ...rules[0]!, targetSide: 'source' as const, hitPreset: null }], maxAutomaticSkillRecords: 0 };
    const detailed = await automaticSkillRequest(prepared, snapshot, input);
    const summary = await automaticSkillRequest(prepared, snapshot, { ...input, outputMode: 'summary' });
    expect(detailed.runRequest.recordBudget?.maxAutomaticSkillRecords).toBe(0);
    expect(summary.runRequest.outputMode).toBe('summary');
    expect(summary.runRequest.sampling.disabled).toBe(true);
    expect(summary.runInputHash).not.toBe(detailed.runInputHash);
    await expect(automaticSkillRequest(prepared, snapshot, inputs)).rejects.toThrow(/hitPreset/);
  });
  it.each(['disabled', 'unlearned', 'wrong_level', 'wrong_origin', 'complex_step'] as const)('拒绝实际来源或过程失效：%s', async kind => {
    const { snapshot, prepared } = preparedActiveSample();
    const input = structuredClone(inputs);
    if (kind === 'disabled') snapshot.source.skillSources[1]!.enabled = false;
    if (kind === 'unlearned') snapshot.source.skillSources[1]!.skillLevel = 0;
    if (kind === 'wrong_level') input.rules[0]!.skillLevel = 2;
    if (kind === 'wrong_origin') input.rules[0]!.origin.characterKey = 'actor_b';
    if (kind === 'complex_step') prepared.compileRequest.sharedProviders!.find(provider => provider.processes?.some(process => process.processKey === 'cast'))!.processes![0]!.steps[0]!.stepType = 'MULTI_HIT';
    await expect(automaticSkillRequest(prepared, snapshot, input)).rejects.toThrow(/真实来源|绑定|过程/);
  });
  it('允许有限普通延时链，混入复杂步骤或重复步骤仍拒绝', async () => {
    const { snapshot, prepared } = preparedActiveSample();
    const process = prepared.compileRequest.sharedProviders!.find(provider => provider.processes?.some(process => process.processKey === 'cast'))!.processes![0]!;
    process.steps.push({ ...structuredClone(process.steps[0]!), stepKey: 'second_delay' });
    const request = await automaticSkillRequest(prepared, snapshot, inputs);
    expect(request.runRequest.driverPlan.automaticSkills?.rules).toHaveLength(1);
    process.steps[1]!.stepType = 'CHANNEL';
    await expect(automaticSkillRequest(prepared, snapshot, inputs)).rejects.toThrow(/过程/);
    process.steps[1] = { ...structuredClone(process.steps[0]!) };
    await expect(automaticSkillRequest(prepared, snapshot, inputs)).rejects.toThrow(/过程/);
  });
  it('最多16项使用同一链算法，闭包按真实来源稳定排序，与用户优先级无关', () => {
    const chain = Array.from({ length: 16 }, (_, index) => ({ ...rules[0]!, ruleKey: `r_${index}`, skillKey: `skill_${index.toString().padStart(2, '0')}`,
      sortOrder: index, releaseAfterRuleKey: index === 0 ? null : `r_${index - 1}`, waitForCooldowns: index === 0 ? ['r_15', 'r_1'] : [] }));
    expect(() => validateAutomaticSkillRelations(chain)).not.toThrow();
    const template = preparedActiveSample().snapshot.skillConfigurations.find(c => c.skill.skillKey === 'sample_active')!;
    const configurations = chain.map(rule => JSON.parse(JSON.stringify(template).replaceAll('sample_active', rule.skillKey)));
    expect(plannedSkillsFromAutomaticRules([...chain].reverse(), configurations)).toEqual(plannedSkillsFromAutomaticRules(chain, configurations));
    expect(plannedSkillsFromAutomaticRules(chain, configurations)).toHaveLength(16);
    expect(plannedSkillsFromAutomaticRules(chain, configurations).every(plan => JSON.stringify(plan.phaseKinds) === '["INITIAL"]')).toBe(true);
    expect(() => validateAutomaticSkillRelations([...chain, { ...chain[0]!, ruleKey: 'too_many', sortOrder: 16 }])).toThrow(/16/);
  });
  it('A等B冷却与B依赖A资格合法；分叉、自引用、重复及资格环拒绝', () => {
    const pair = [{ ...rules[0]!, waitForCooldowns: ['b'] }, { ...rules[0]!, skillKey: 'second', ruleKey: 'b', sortOrder: 1, releaseAfterRuleKey: 'a' }];
    expect(() => validateAutomaticSkillRelations(pair)).not.toThrow();
    expect(() => validateAutomaticSkillRelations([{ ...pair[0]!, releaseAfterRuleKey: 'b' }, pair[1]!])).toThrow(/资格环/);
    expect(() => validateAutomaticSkillRelations([...pair, { ...pair[1]!, ruleKey: 'c', sortOrder: 2 }])).toThrow(/后继/);
    expect(() => validateAutomaticSkillRelations([{ ...pair[0]!, waitForCooldowns: ['a'] }, pair[1]!])).toThrow(/自己/);
    expect(() => validateAutomaticSkillRelations([{ ...pair[0]!, waitForCooldowns: ['b', 'b'] }, pair[1]!])).toThrow(/重复/);
    expect(() => validateAutomaticSkillRelations([{ ...pair[0]!, waitForCooldowns: ['missing'] }, pair[1]!])).toThrow(/未选/);
  });
});
