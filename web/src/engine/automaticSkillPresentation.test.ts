import { describe, expect, it } from 'vitest';
import type { AutomaticSkillRecord, DamageRecord, DoneResult, HealingRecord, ProcessInstanceSnapshot } from '../types/genericEngine';
import { automaticAttackKey, automaticOrigin, automaticUseOrigin, filterAutomaticPresentation, indexAutomaticPresentation,
  initialAutomaticSkillView, resolveAutomaticSelection } from './automaticSkillPresentation';
import { continuousContributions, continuousSourceKey } from './continuousAttackPresentation';
import { buildAutomaticSkillArchive } from './continuousAttackArchive';
import type { OperationOrigin } from './simulationAdapter';
import { preparedActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { automaticSkillRequest } from './automaticSkillRequest';

function damage(damageId: number, useRef: string, abilityRef = 'source.provider[p].ability[hit]'): DamageRecord {
  return { damageId, attackIndex: null, useRef, timeMs: 100, castInstanceId: damageId, owner: 'source', source: 'source', target: 'target',
    abilityRef, operationRef: 'skills.same.effects.damage.results.hit', operationPath: 'sharedProviders[0].abilities[0].operations[0]', damageType: 'magic',
    rawAmount: 100, postDefenseDamage: 100, actualHpLoss: 90, shieldAbsorbed: 10, overkillDamage: 0,
    hpBefore: 500, hpAfter: 410, sourceHpBefore: null, sourceHpAfter: null };
}
function fact(sequence: number, useRef: string | null, kind: AutomaticSkillRecord['kind'] = 'STARTED'): AutomaticSkillRecord {
  return { sequence, timeMs: 100, kind, ruleKey: sequence === 1 ? 'a' : 'b', useRef,
    relatedRuleKey: null, relatedUseRef: null, reason: null, nextCheckAtMs: null };
}
function healing(useRef: string | null, timeMs: number): HealingRecord {
  return { useRef, timeMs, source: 'source', target: 'source', abilityRef: 'source.provider[p].ability[heal]', operationRef: 'heal', instructionKey: null,
    rawAmount: 10, healingAfterDone: 10, healingAfterModifiers: 10, actualHealing: 10, overheal: 0, hpBefore: 400, hpAfter: 410 };
}
function result(): DoneResult {
  const rows = [damage(1, 'use_a'), damage(2, 'use_b'), damage(3, '')];
  return { ok: true, summary: { durationMs: 200, stopReason: 'duration_reached', sourceFinalHp: 410, targetFinalHp: 230,
    sourceDamageDealt: 300, targetDamageDealt: 0, sourceDamageTaken: 0, targetDamageTaken: 300,
    abilityAttemptCount: 2, abilityCastCount: 2, attemptSkippedCount: 0, warningCount: 0, evidenceTruncated: false, seriesDownsampled: false,
    damageBreakdown: rows.map(({ damageId: _id, ...row }) => ({ ...row, damageCount: 1 })), abilityStats: [] },
    finalSnapshot: { schemaHash: 's', rulesHash: 'r', timeMs: 200, combatants: [] }, automaticSkillRecords: [fact(1, 'use_a'), fact(2, 'use_b'), fact(3, null, 'WAIT_CHANGED')],
    attackRecords: [], damageRecords: rows, healingRecords: [healing('use_a', 0), healing(null, 100), healing('use_b', 200)],
    series: [], warnings: [], evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
    seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'disabled' } };
}

describe('自动结果按冻结真实身份展示', () => {
  it('资源事实独立筛选和定位，贡献仅按明确use关联，不变为治疗或伤害', () => {
    const done = result();
    done.resourceChangeRecords = [{ healthOrder: 7, timeMs: 100, target: 'source', resourceKey: 'hp', currentBefore: 400, currentAfter: 700, currentDelta: 300,
      maxBefore: 650, maxAfter: 950, maxDelta: 300, contributors: [{ source: 'source', providerRef: 'opaque', definitionRef: 'finite', modifierKey: 'health', reason: 'apply', useRef: 'use_a' }] }];
    const index = indexAutomaticPresentation(done), view = initialAutomaticSkillView(200);
    expect(index.healing).toHaveLength(done.healingRecords!.length); expect(index.damage).toHaveLength(done.damageRecords!.length);
    expect(index.byUse.get('use_a')!.resources).toEqual(done.resourceChangeRecords);
    expect(index.byUse.get('use_b')!.resources).toEqual([]);
    view.timeRangeMs = [150, 200]; expect(filterAutomaticPresentation(done, index, view).resources).toEqual([]);
    expect(resolveAutomaticSelection(index, { kind: 'resource', healthOrder: 7 })).toMatchObject({ resource: done.resourceChangeRecords[0], useRef: null });
  });
  it('同毫秒、同作者名称的不同使用不串联，无使用结算继续独立', () => {
    const done = result(); const index = indexAutomaticPresentation(done);
    const selected = resolveAutomaticSelection(index, { kind: 'automatic', sequence: 1 });
    expect(selected.context?.damage).toEqual([done.damageRecords![0]]);
    expect(selected.context?.healing.map(row => row.recordIndex)).toEqual([0]);
    expect(resolveAutomaticSelection(index, { kind: 'damage', damageId: 3 })).toMatchObject({ useRef: null, context: null, attack: undefined });
    expect(index.byUse.has('')).toBe(false);
    expect(resolveAutomaticSelection(index, { kind: 'automatic', sequence: 3 })).toMatchObject({ useRef: null, context: null });
  });
  it('开始和完成定位同次上下文，资格消费的相关授予者单独保留', () => {
    const done = result();
    done.automaticSkillRecords!.push({ ...fact(4, 'use_a', 'COMPLETED'), ruleKey: 'a' },
      { ...fact(5, 'use_b', 'QUALIFICATION_CONSUMED'), relatedRuleKey: 'a', relatedUseRef: 'use_a' });
    const index = indexAutomaticPresentation(done);
    expect(resolveAutomaticSelection(index, { kind: 'automatic', sequence: 1 }).context)
      .toBe(resolveAutomaticSelection(index, { kind: 'automatic', sequence: 4 }).context);
    const selected = resolveAutomaticSelection(index, { kind: 'automatic', sequence: 5 });
    expect(selected.useRef).toBe('use_b'); expect(selected.automatic?.relatedUseRef).toBe('use_a');
    expect(selected.context?.damage.map(row => row.damageId)).toEqual([2]);
    expect(resolveAutomaticSelection(index, { kind: 'use', useRef: 'use_a' }).context?.damage.map(row => row.damageId)).toEqual([1]);
  });
  it('治疗筛选保留原数组位置，选择详情不受当前范围删减', () => {
    const done = result(); const index = indexAutomaticPresentation(done); const view = initialAutomaticSkillView(200);
    view.timeRangeMs = [150, 200];
    expect(filterAutomaticPresentation(done, index, view).healing.map(row => row.recordIndex)).toEqual([2]);
    expect(resolveAutomaticSelection(index, { kind: 'healing', recordIndex: 0 }).healing?.row).toBe(done.healingRecords![0]);
  });
  it('普攻按计划、刀号、使用组合选择，主动伤害无刀号也能独立选', () => {
    const done = result();
    const first = { planKey: 'one', attackIndex: 1, useRef: 'attack', source: 'source', target: 'target', skillKey: 'basic', startAtMs: 100,
      hitAtMs: 100, readyAtMs: 1100, finalReadyAtMs: 1100, mechanicReadyAtMs: null, actionReadyAtMs: null, nextStartAtMs: 1100,
      attackSpeed: 1, postDefenseDamage: 1, actualHpLoss: 1, sourceHpAfter: 400, targetHpAfter: 499, completed: true };
    done.attackRecords = [first, { ...first, planKey: 'two' }];
    const index = indexAutomaticPresentation(done);
    expect(automaticAttackKey(first)).not.toBe(automaticAttackKey(done.attackRecords[1]!));
    expect(resolveAutomaticSelection(index, { ...first, kind: 'attack' }).attack).toBe(first);
    expect(resolveAutomaticSelection(index, { kind: 'damage', damageId: 1 }).damage?.attackIndex).toBeNull();
  });
  it('筛选只改已返回明细与完整分类，全场累计和同方向分母保持', () => {
    const done = result(); done.summary.damageBreakdown![1]!.operationRef = 'second';
    done.damageRecords![1]!.operationRef = 'second';
    const original = structuredClone(done); const view = initialAutomaticSkillView(200); view.timeRangeMs = [150, 200];
    view.sourceKeys = [continuousSourceKey(done.summary.damageBreakdown![1]!)]; view.amountMetric = 'actualHpLoss';
    const filtered = filterAutomaticPresentation(done, indexAutomaticPresentation(done), view);
    expect(filtered.damage).toHaveLength(0); expect(filtered.breakdownSubtotal).toBe(90); expect(filtered.breakdown).toHaveLength(1);
    expect(continuousContributions(done.summary.damageBreakdown!, filtered.breakdown, 'source', 'actualHpLoss')[0]?.proportion).toBeCloseTo(1 / 3);
    expect(done).toEqual(original); expect(done.summary.sourceDamageDealt).toBe(300);
  });
  it('纯主动与汇总采样不要求普攻字段，也不补事实行', () => {
    const done = result(); done.outputMode = 'summary'; done.attackRecords = []; done.damageRecords = []; done.healingRecords = []; done.automaticSkillRecords = [];
    done.series = [{ timeMs: 0, sourceHp: 400, targetHp: 500, sourceDamageDealt: 0, targetDamageDealt: 0,
      sourceCumulativeDps: 0, targetCumulativeDps: 0, sourceWindowDps: 0, targetWindowDps: 0 }];
    const filtered = filterAutomaticPresentation(done, indexAutomaticPresentation(done), initialAutomaticSkillView(200));
    expect(filtered.attacks).toEqual([]); expect(filtered.damage).toEqual([]); expect(filtered.breakdownSubtotal).toBe(300); expect(done.series).toHaveLength(1);
  });
  it('冻结来源核对包括真实能力和编译路径，歧义时不猜', () => {
    const row = damage(1, 'a'); const origin: OperationOrigin = { abilityRef: row.abilityRef, operationRef: row.operationRef,
      skillKey: 'same', effectKey: 'damage', resultKey: 'hit', compiledPaths: [row.operationPath] };
    expect(automaticOrigin([origin], row)).toMatchObject({ origin, issue: null });
    expect(automaticOrigin([origin, { ...origin, skillKey: 'other' }], row).origin).toBeNull();
    expect(automaticOrigin([{ ...origin, abilityRef: 'target.provider[p].ability[hit]' }], row).origin).toBeNull();
    expect(automaticOrigin([origin], { ...row, operationPath: 'other.path' }).origin).toBeNull();
    expect(automaticOrigin([{ ...origin, providerDefinitionRef: 'dynamic' }], { ...row,
      abilityRef: 'source.provider[dynamic#2].ability[hit]', providerDefinitionRef: 'dynamic' }).origin).toMatchObject({ skillKey: 'same' });
  });
});

describe('自动档案展示版本2', () => {
  it('白名单保存完整原结果，当前过滤和选择不裁剪输出或泄漏额外字段', () => {
    const done = result(); const before = structuredClone(done); const view = initialAutomaticSkillView(200);
    view.timeRangeMs = [150, 200]; view.visibleCurves = ['sourceHp']; view.sourceKeys = ['hidden']; view.damageTypes = ['magic'];
    view.amountMetric = 'actualHpLoss'; view.dpsMode = 'window'; view.selection = { kind: 'healing', recordIndex: 2 };
    const dirtyView = { ...view, adminToken: 'fake-secret', selection: { ...view.selection, authorization: 'fake-secret' } };
    const archive = buildAutomaticSkillArchive({ runResult: done, operationOrigins: [{ abilityRef: 'frozen', adminToken: 'fake-secret' }], adminToken: 'fake-secret' }, dirtyView);
    expect(archive.displayDefinitionVersion).toBe(2); expect(archive.view).toEqual(view); expect(archive.runResult).toEqual(done);
    expect(JSON.stringify(archive)).not.toContain('fake-secret'); expect(done).toEqual(before);
    done.damageRecords![0]!.postDefenseDamage = 99;
    expect(archive.runResult).toEqual(before);
  });
  it.each([
    { kind: 'automatic', sequence: 3 }, { kind: 'use', useRef: 'a' }, { kind: 'attack', planKey: 'basic', attackIndex: 1, useRef: 'basic1' },
    { kind: 'damage', damageId: 1 }, { kind: 'healing', recordIndex: 4 }
  ] as const)('仅保存当前选择的明确身份：$kind', selection => {
    const view = initialAutomaticSkillView(200); view.selection = selection;
    expect(buildAutomaticSkillArchive({}, { ...view, selection: { ...selection, extra: 'not-exported' } }).view.selection).toEqual(selection);
  });
});

async function useOriginSample(preset: 'MISS' | 'TARGET_HIT' = 'MISS') {
  const { prepared, snapshot } = preparedActiveSample();
  const request = (await automaticSkillRequest(prepared, snapshot, { rules: [{ ...snapshot.selection.plannedSkills[0]!, ruleKey: 'a', sortOrder: 0,
    targetSide: 'target', hitPreset: preset, waitForCooldowns: [], releaseAfterRuleKey: null }], durationMs: 200,
    recordTimeSeries: false, maxAutomaticSkillRecords: 1000, maxHealingRecords: 0, outputMode: 'detailed' })).runRequest;
  const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
  // 不含任何可推导规则或提供者的编码，来源解析必须使用真实过程而不是解析useKey。
  const useRef = 'opaque usage / 7';
  const instance: ProcessInstanceSnapshot = { owner: 'source', target: 'target', providerRef: binding.providerRef, processKey: binding.controls[0]!.processKey,
    skillKey: binding.skillKey, useKey: useRef, stepKey: 'delay', stepVersion: 1, stepExecutionIndex: 1,
    lastExecutionAtMs: 100, stepCompletedAtMs: 100, startedAtMs: 0, stepStartedAtMs: 0, advanceAtMs: 100, expiresAtMs: null,
    actualCosts: {}, cooldownStarted: true, status: 'complete', failureReason: null, finishedAtMs: 100, repeat: null, actionOccupancies: [] };
  const done = result(); done.damageRecords = []; done.healingRecords = [];
  done.automaticSkillRecords = [{ ...fact(1, useRef), ruleKey: 'a', timeMs: 0 }, { ...fact(2, useRef, 'COMPLETED'), ruleKey: 'a' }];
  done.finalSnapshot.processInstances = [instance];
  request.recordBudget!.maxDamageRecords = 0; request.recordBudget!.maxHealingRecords = 0;
  return { compile: prepared.compileRequest, request, done, instance, binding, useRef };
}

describe('无结算的真实自动使用仍能定位冻结作者过程', () => {
  it('明确MISS的开始/完成定位同一实际过程，不要求伤害或治疗，也不构造结果操作', async () => {
    const { compile, request, done, useRef, binding, instance } = await useOriginSample();
    expect(request.driverPlan.automaticSkills!.rules[0]!.hitBindings.every(row => row.preset === 'MISS')).toBe(true);
    const index = indexAutomaticPresentation(done);
    for (const sequence of [1, 2]) {
      const selected = resolveAutomaticSelection(index, { kind: 'automatic', sequence });
      const actual = automaticUseOrigin(compile, request, index, selected.useRef);
      expect(actual.issue).toBeNull(); expect(actual.origin).toMatchObject({ binding, instance, rule: { ruleKey: 'a' }, control: { action: 'INITIAL' } });
      expect(actual.origin?.abilityPath).toMatch(/^sharedProviders\[\d+\]\.abilities\[\d+\]$/);
      expect(actual.origin?.processPath).toMatch(/^sharedProviders\[\d+\]\.processes\[\d+\]$/);
      expect(actual.origin).not.toHaveProperty('operationRef'); expect(selected.context?.damage).toEqual([]);
    }
    expect(automaticUseOrigin(compile, request, index, useRef).origin?.instance).toBe(instance);
  });
  it('所有明细预算为0、只保留真实过程时，相关使用仍按冻结请求唯一匹配', async () => {
    const { compile, request, done, useRef } = await useOriginSample('TARGET_HIT');
    request.recordBudget!.maxAutomaticSkillRecords = 0; done.automaticSkillRecords = [];
    const index = indexAutomaticPresentation(done);
    expect(resolveAutomaticSelection(index, { kind: 'use', useRef }).context?.damage).toEqual([]);
    expect(automaticUseOrigin(compile, request, index, useRef)).toMatchObject({ issue: null, origin: { rule: { ruleKey: 'a' } } });
  });
  it('相同过程名或同名标签不会关联另一提供者，按完整技能/提供者/目标匹配', async () => {
    const { compile, request, done, binding, useRef } = await useOriginSample();
    compile.rules.skillActionBindings!.push({ ...binding, bindingKey: 'other_binding', providerRef: 'another_provider', skillKey: 'other_skill' });
    request.driverPlan.automaticSkills!.rules.push({ ...request.driverPlan.automaticSkills!.rules[0]!, ruleKey: 'other', bindingKey: 'other_binding' });
    done.automaticSkillRecords = [];
    expect(automaticUseOrigin(compile, request, indexAutomaticPresentation(done), useRef).origin?.binding).toBe(binding);
  });
  it('两条规则均匹配同一真实使用时拒绝猜选，自动事实指明规则时保持精确关联', async () => {
    const { compile, request, done, useRef } = await useOriginSample();
    request.driverPlan.automaticSkills!.rules.push({ ...request.driverPlan.automaticSkills!.rules[0]!, ruleKey: 'other' });
    expect(automaticUseOrigin(compile, request, indexAutomaticPresentation(done), useRef).origin?.rule.ruleKey).toBe('a');
    done.automaticSkillRecords = [];
    expect(automaticUseOrigin(compile, request, indexAutomaticPresentation(done), useRef).origin).toBeNull();
  });
  it.each(['missing_process', 'duplicate_process', 'wrong_rule', 'duplicate_binding', 'duplicate_definition', 'wrong_definition', 'wrong_target'] as const)
    ('来源不唯一或矛盾时保留问题：%s', async kind => {
      const { compile, request, done, instance, binding, useRef } = await useOriginSample();
      if (kind === 'missing_process') done.finalSnapshot.processInstances = [];
      if (kind === 'duplicate_process') done.finalSnapshot.processInstances!.push({ ...instance });
      if (kind === 'wrong_rule') done.automaticSkillRecords![1]!.ruleKey = 'unrelated';
      if (kind === 'duplicate_binding') compile.rules.skillActionBindings!.push({ ...binding });
      const provider = compile.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
      if (kind === 'duplicate_definition') provider.processes!.push({ ...provider.processes![0]! });
      if (kind === 'wrong_definition') binding.providerDefinitionRef = 'wrong';
      if (kind === 'wrong_target') instance.target = 'source';
      const actual = automaticUseOrigin(compile, request, indexAutomaticPresentation(done), useRef);
      expect(actual.origin).toBeNull(); expect(actual.issue).toBeTruthy();
    });
});
