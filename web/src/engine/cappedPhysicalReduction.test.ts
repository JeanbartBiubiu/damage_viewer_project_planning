import { describe, expect, it } from 'vitest';
import { cappedPhysicalReductionSample, useOwnerBonusFormula } from '../../tests/fixtures/cappedPhysicalReduction';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { assembleNaturalSkillSources } from './simulation/sources/natural';
import { naturalRuleKeys } from './simulation/sources/description';
import { receivedCooldownDormancy, requireReceivedMaintenanceDormant } from './receivedCooldownDormancy';
import { permanentModifier } from './simulationPermanentResults';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { inspectSimulationSnapshot, assembleSimulation } from './simulationAdapter';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { simulationAutomaticCastCosts } from './simulationActiveSkills';

function compile(input: ReturnType<typeof cappedPhysicalReductionSample>) {
  for (const side of ['source', 'target'] as const) for (const source of input.snapshot[side].skillSources) {
    const config = input.snapshot.skillConfigurations.find(c => c.skill.skillKey === source.skillKey)!;
    if (source.inactiveReason === null) source.enabledRuleKeys = naturalRuleKeys(input.snapshot, config, side, source);
  }
  approveSnapshotFixture(input.snapshot);
  return assembleNaturalSkillSources(input.snapshot);
}
function lower(input: ReturnType<typeof cappedPhysicalReductionSample>) {
  return permanentModifier({ ...input, formulaNamespace: 'cap-test' }, input.result, 'cap');
}

describe('完整真实角色初始化的分支封顶平减', () => {
  it.each(['source', 'target'] as const)('%s只挂一个真实永久status，编译明确cap与单类型条件', side => {
    const input = cappedPhysicalReductionSample(side), original = structuredClone(input.configuration), out = compile(input);
    const cap = out.providers.find(p => p.modifiers?.some(m => m.maximumReductionRatio !== undefined))!;
    expect(cap).toMatchObject({ kind: 'status', skillKey: input.source.skillKey, modifiers: [{ kind: 'pipeline', command: 'damage',
      channel: 'all_damage', bucket: 'all_instances', stage: 'incoming_pre_mitigation', valuePolicy: 'subtract',
      maximumReductionRatio: 0.5, value: { op: 'const', value: 13 }, condition: { op: 'read', path: 'damage.type.physics' } }] });
    expect(cap).not.toHaveProperty('lifecycle');
    const origin = out.origins.find(o => o.side === side && o.skillKey === input.source.skillKey)!;
    const parent = out.providers.find(p => p.providerKey === origin.definitionRef)!;
    expect(parent.listeners![0]!.operations).toEqual([{ operation: 'apply_provider', target: 'self', providerRef: cap.providerKey, providerDefinitionRef: cap.providerKey }]);
    expect(input.configuration).toEqual(original);
  });
  it('目标拥有者的当前BONUS共同公式不改写为攻击者或target读', () => {
    const input = cappedPhysicalReductionSample(); useOwnerBonusFormula(input);
    const original = structuredClone(input.configuration.formulas[0]);
    const value = lower(input);
    expect(value.value).toMatchObject({ op: 'max', args: [{ op: 'ref' }, { op: 'const', value: 0 }] });
    expect(input.configuration.formulas[0]).toEqual(original);
    const out = compile(input); expect([...out.required.target]).toContain('armor');
  });
  it.each(['missing', 'null', 'negative', 'large', 'formula', 'wrong_owner', 'total', 'extra', 'scope', 'shield', 'nonzero_min', 'mixed'] as const)('拒绝%s而不部分执行', kind => {
    const input = cappedPhysicalReductionSample();
    if (kind === 'missing') delete input.result.detail.maximumReductionRatioValue;
    if (kind === 'null') Object.assign(input.result.detail, { maximumReductionRatioValue: null });
    if (kind === 'negative') input.result.detail.maximumReductionRatioValue = { kind: 'FIXED', value: -0.1 };
    if (kind === 'large') input.result.detail.maximumReductionRatioValue = { kind: 'FIXED', value: 1.1 };
    if (kind === 'formula') input.result.detail.maximumReductionRatioValue = { kind: 'FORMULA', formulaKey: 'points' };
    if (kind === 'extra') Object.assign(input.result.detail, { allowAnyType: true });
    if (kind === 'scope') input.result.detail.deliveryKind = 'SKILL';
    if (kind === 'shield') input.result.spellShieldBlockScope = 'RESULT';
    if (kind === 'nonzero_min') input.result.valueRule.fixedMinValue = 1;
    if (kind === 'mixed') input.effect.results.push(structuredClone(input.result));
    if (kind === 'wrong_owner' || kind === 'total') {
      useOwnerBonusFormula(input);
      const binding = input.configuration.formulas[0]!.expression.inputs.find(i => i.binding.kind === 'attribute')!.binding;
      if (binding.kind === 'attribute') { if (kind === 'wrong_owner') binding.object = 'target'; else binding.valueKind = 'TOTAL'; }
    }
    expect(() => lower(input)).toThrow();
  });
  it('原cap仅匹配真实physics，magic/real不进入此条件', () => {
    expect(lower(cappedPhysicalReductionSample())).toMatchObject({ condition: { op: 'read', path: 'damage.type.physics' } });
  });
  it.each([false, 0])('关闭/未学%s保留完整定义但不挂cap', state => {
    const input = cappedPhysicalReductionSample();
    const setting = input.snapshot.selection.targetSkillSettings.find(s => s.skillKey === input.source.skillKey)!;
    if (state === false) setting.enabled = false; else setting.skillLevel = 0;
    syncSimulationSkillSources(input.snapshot);
    expect(compile(input).providers.some(p => p.modifiers?.some(m => m.maximumReductionRatio !== undefined))).toBe(false);
  });
  it('重复完整来源的两个cap在装配时拒绝', () => {
    const input = cappedPhysicalReductionSample();
    const key = input.source.skillKey, other = 'lab_second_cap';
    const copy = JSON.parse(JSON.stringify(input.configuration).replaceAll(key, other));
    input.snapshot.skillConfigurations.push(copy);
    const actor = input.snapshot.target;
    actor.attachedSkills.push({ ...actor.attachedSkills.at(-1)!, skillKey: other });
    input.snapshot.selection.targetSkillSettings.push({ ...input.snapshot.selection.targetSkillSettings.at(-1)!, skillKey: other });
    syncSimulationSkillSources(input.snapshot);
    expect(() => compile(input)).toThrow('重复或重叠');
  });
  it('未用的非法属性声明也不能绕过BONUS抗性读域', () => {
    const input = cappedPhysicalReductionSample(); useOwnerBonusFormula(input);
    input.configuration.formulas[0]!.expression.inputs.push({ key: 'unused', binding: { kind: 'attribute', object: 'source',
      view: 'current_frame', attributeKey: 'hp', valueKind: 'BONUS' } });
    expect(() => lower(input)).toThrow('拥有者当前额外属性');
  });
  it('四份固定JSON经真实生产纯适配，未启动新cap战斗', () => {
    const cases = loadMechanismCases().filter(c => c.caseKey.startsWith('capped_physical_'));
    expect(cases).toHaveLength(4);
    for (const c of cases) {
      const snapshot = c.buildSnapshot();
      approveSnapshotFixture(snapshot);
      const ignoredCosts = simulationAutomaticCastCosts(snapshot);
      const inspect = inspectSimulationSnapshot(snapshot, ignoredCosts);
      const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
      for (const r of inspect.requirements) if (r.storedValue === undefined) inputs[r.side][r.attribute.attributeKey] = 0;
      const prepared = assembleSimulation(snapshot, inputs, c.scenario.initialHealth, [], [], ignoredCosts);
      const modifiers = prepared.compileRequest.sharedProviders?.flatMap(p => p.modifiers ?? []).filter(m => m.maximumReductionRatio !== undefined) ?? [];
      expect(modifiers).toHaveLength(c.caseKey.endsWith('off_unlearned') ? 0 : c.caseKey.endsWith('active_maintenance') ? 2 : 1);
      if (c.caseKey.endsWith('active_maintenance')) {
        expect(prepared.compileRequest.rules.skillActionBindings).toHaveLength(1);
        expect(prepared.skillOrigins.filter(o => o.skillKey === 'lab_magic_bolt').every(o => !o.enabledRuleKeys.includes('received'))).toBe(true);
        expect(prepared.skillOrigins.find(o => o.side === 'source' && o.skillKey === 'lab_magic_bolt')!.enabledRuleKeys).toEqual(['first_cast', 'initialize_cap', 'on_hit']);
        expect(JSON.stringify(prepared.compileRequest)).not.toContain('cooldown_change');
      }
      if (c.caseKey.endsWith('owner_bonus_packets')) expect(prepared.compileRequest.formulas?.some(f => f.expression.inputs
        .some(i => i.binding.kind === 'attribute' && i.binding.attributeKey === 'magic_resist' && i.binding.valueKind === 'BONUS'))).toBe(true);
    }
  });
});

describe('完整纯750接收维护先验证再休眠', () => {
  it.each(['source', 'target'] as const)('%s保留定义覆盖但不发布接收监听或冷却操作', side => {
    const input = cappedPhysicalReductionSample(side, true), before = structuredClone(input.snapshot);
    const dormant = receivedCooldownDormancy(input.snapshot, input.configuration, side, input.source);
    expect(dormant.map(r => r.ruleKey)).toEqual(['received']);
    expect(input.snapshot).toEqual(before);
    const out = compile(input);
    expect(out.origins.find(o => o.side === side && o.skillKey === input.source.skillKey)!.enabledRuleKeys).not.toContain('received');
    expect(out.coverage.some(r => r.authorPath.endsWith('.received') && r.note?.includes('交集为空'))).toBe(true);
    expect(JSON.stringify(out.providers)).not.toContain('cooldown_change');
  });
  it.each(['both', 'unknown'] as const)('未来%s不以缺输入冒充false', kind => {
    expect(() => requireReceivedMaintenanceDormant(kind === 'both' ? true : undefined, true, 'probe')).toThrow('UNSUPPORTED_RECEIVED');
  });
  it('未声明REDUCE的缺效果不获休眠权限，真实可达时仍由原闭包拒绝', () => {
    const input = cappedPhysicalReductionSample('target', true);
    input.configuration.effects.pop();
    expect(receivedCooldownDormancy(input.snapshot, input.configuration, input.side, input.source)).toEqual([]);
    expect(naturalRuleKeys(input.snapshot, input.configuration, input.side, input.source)).toContain('received');
    expect(() => compile(input)).toThrow();
  });
  it.each(['extra_action', 'extra_result', 'external', 'runtime', 'amount', 'condition', 'once', 'modifier'] as const)('拒绝%s纯维护损坏', kind => {
    const input = cappedPhysicalReductionSample('target', true), rule = input.configuration.triggerRules[1]!, effect = input.configuration.effects[1]!;
    if (kind === 'extra_action') rule.actions.push(structuredClone(rule.actions[0]!));
    if (kind === 'extra_result') effect.results.push(structuredClone(effect.results[0]!));
    const result = effect.results[0]!;
    if (result.resultType !== 'COOLDOWN_CHANGE' || result.valueRule === null) throw new Error('fixture');
    if (kind === 'external') result.detail.affectedSkillScope.skillKeys = ['other'];
    if (kind === 'runtime') result.valueRule.value = { kind: 'PARAMETER', parameterKey: 'unprovided' };
    if (kind === 'amount') result.valueRule.value = { kind: 'FIXED', value: 751 };
    if (kind === 'condition') rule.conditionGroups.push({ conditions: [], sortOrder: 0, groupKey: 'hidden' });
    if (kind === 'once') rule.oncePerUse = { groupKey: 'quota', scope: 'SOURCE' };
    if (kind === 'modifier') rule.actions[0]!.resultModifiers.push({ resultKey: 'reduce', fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null });
    expect(() => receivedCooldownDormancy(input.snapshot, input.configuration, input.side, input.source)).toThrow();
  });
});
