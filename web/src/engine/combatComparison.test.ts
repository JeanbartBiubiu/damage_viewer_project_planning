import { describe, expect, it } from 'vitest';
import { simulationDefaultSourcesSample } from '../../tests/fixtures/simulationSnapshot';
import { triggeredEquipmentSimulationSample } from '../../tests/fixtures/simulationTriggeredEquipment';
import type { DamageBreakdown, DoneResult, ExecutionSummary, RunRequest, RunSummary } from '../types/genericEngine';
import type { SimulationSkillOrigin, SimulationSkillSetting } from '../types/simulationSnapshot';
import {
  assessCombatComparison, buildCombatComparisonArchive, matchesFrozenPlanInput,
  mergePlanEquipment, transferEquipmentSettingsOnChange, validateEquipmentComparisonDiff, verifyCommonComparisonBaseline,
  type CombatComparisonArchive, type CombatComparisonMetric, type CombatEquipmentPlan
} from './combatComparison';
import { inspectContinuousAttackSeries } from './continuousAttackSeries';

const equipmentOrigin = (equipmentKey: string): SimulationSkillOrigin => ({ kind: 'EQUIPMENT', equipmentKey });
const setting = (key: string, enabled: boolean): SimulationSkillSetting => ({ origin: equipmentOrigin(key), skillKey: `${key}_passive`, enabled });
const blankPlan = (...keys: string[]): CombatEquipmentPlan => ({ keys, settings: [], aura: {} });

describe('单件装备与设置归属', () => {
  it.each([
    [['bow', 'sword'], ['sword', 'bow'], [], [], true],
    [['bow'], ['sword'], ['bow'], ['sword'], true],
    [[], ['bow'], [], ['bow'], true],
    [['bow'], [], ['bow'], [], true],
    [['bow', 'sword'], ['wand'], ['bow', 'sword'], ['wand'], false],
    [['bow'], ['sword', 'wand'], ['bow'], ['sword', 'wand'], false]
  ])('比较装备 %j 与 %j 的单件差异', (a, b, onlyInA, onlyInB, valid) => {
    expect(validateEquipmentComparisonDiff(a, b)).toEqual({ onlyInA, onlyInB, valid });
  });

  it('共有装备只取 A 设置，B 同步装备时清理原有独有槽', () => {
    const a = { ...blankPlan('bow', 'sword'), settings: [setting('bow', false)], aura: { bow: true } };
    const b = { ...blankPlan('bow', 'wand'), settings: [setting('bow', true), setting('wand', false), setting('stray', false)],
      aura: { bow: false, sword: true, wand: false, stray: true } };
    expect(mergePlanEquipment(a, b)).toEqual({ keys: ['bow', 'wand'], settings: [setting('bow', false), setting('wand', false)],
      aura: { bow: true, wand: false } });
    const synced = transferEquipmentSettingsOnChange(a, b, 'B', a.keys);
    expect(synced.a).toEqual(a);
    expect(synced.b).toEqual(blankPlan('bow', 'sword'));
    expect(mergePlanEquipment(synced.a, synced.b)).toEqual(a);
    expect(b.settings).toHaveLength(3);
  });

  it('B 卸下、装回共有装备始终保留 A 的冻结有效设置', () => {
    const a = { ...blankPlan('bow', 'sword'), settings: [setting('sword', true), setting('bow', false)], aura: { bow: true } };
    const frozenA = structuredClone(a);
    const removed = transferEquipmentSettingsOnChange(a, blankPlan('bow'), 'B', []);
    expect(removed.b).toEqual(blankPlan());
    expect(matchesFrozenPlanInput(removed.a, frozenA)).toBe(true);
    const restored = transferEquipmentSettingsOnChange(removed.a, removed.b, 'B', ['bow']);
    expect(mergePlanEquipment(restored.a, restored.b)).toEqual({ keys: ['bow'], settings: [setting('bow', false)], aura: { bow: true } });
    expect(matchesFrozenPlanInput(restored.a, frozenA)).toBe(true);
  });

  it.each([true, false])('A 卸下和装回时双向移交被动设置和光环确认 %s，B 的有效输入一致', inRange => {
    const a = { ...blankPlan('bow'), settings: [setting('bow', false)], aura: { bow: inRange } };
    const b = { ...blankPlan('bow', 'wand'), settings: [setting('wand', true)], aura: { wand: false } };
    const frozenB = mergePlanEquipment(a, b);
    const removed = transferEquipmentSettingsOnChange(a, b, 'A', []);
    expect(removed.a).toEqual(blankPlan());
    expect(removed.b.aura).toEqual({ bow: inRange, wand: false });
    expect(removed.b.settings).toContainEqual(setting('bow', false));
    expect(matchesFrozenPlanInput(mergePlanEquipment(removed.a, removed.b), frozenB)).toBe(true);
    const restored = transferEquipmentSettingsOnChange(removed.a, removed.b, 'A', ['bow']);
    expect(restored).toEqual({ a, b });
    expect(matchesFrozenPlanInput(mergePlanEquipment(restored.a, restored.b), frozenB)).toBe(true);
  });

  it('移除独有装备后丢弃设置，再增补时从空槽开始', () => {
    const b = { ...blankPlan('bow'), settings: [setting('bow', false)], aura: { bow: false } };
    const removed = transferEquipmentSettingsOnChange(blankPlan(), b, 'B', []);
    const restored = transferEquipmentSettingsOnChange(removed.a, removed.b, 'B', ['bow']);
    expect(restored.b).toEqual(blankPlan('bow'));
  });
});

describe('冻结输入和共同数据基线', () => {
  it('比较嵌套对象时忽略键顺序，区分数组顺序、缺项、空值和 0', () => {
    const frozen = { initialHealth: { source: 620, target: 0 }, inputs: [{ enabled: false, value: 0 }, { value: null }] };
    expect(matchesFrozenPlanInput({ inputs: [{ value: 0, enabled: false }, { value: null }], initialHealth: { target: 0, source: 620 } }, frozen)).toBe(true);
    expect(matchesFrozenPlanInput({ ...frozen, initialHealth: { source: 630, target: 0 } }, frozen)).toBe(false);
    expect(matchesFrozenPlanInput({ ...frozen, inputs: [...frozen.inputs].reverse() }, frozen)).toBe(false);
    expect(matchesFrozenPlanInput({ value: null }, {})).toBe(false);
    expect(matchesFrozenPlanInput({ value: 0 }, { value: null })).toBe(false);
  });

  it('容许独有装备及其配置、目录交集之外的定义和全档摘要不同', () => {
    const a = triggeredEquipmentSimulationSample(['item_1036']);
    const b = triggeredEquipmentSimulationSample(['item_1043']);
    b.selection.sourceSkillSettings.push(setting('item_1043', false));
    b.snapshotDigest = 'b'.repeat(64);
    b.readAt = '2026-11-23T00:00:00Z';
    const attribute = b.catalogs.attributes[0]!;
    b.catalogs.attributes.push({ ...attribute, attributeKey: 'only_in_b' });
    expect(verifyCommonComparisonBaseline(a, b)).toBe(true);
  });

  it('装备引入事件时允许共有来源的可达入口变化', () => {
    const a = triggeredEquipmentSimulationSample(['item_1036']);
    const b = triggeredEquipmentSimulationSample(['item_1043']);
    const targetSource = b.target.skillSources[0]!;
    targetSource.enabledRuleKeys = ['received_damage'];
    targetSource.inactiveReason = null;
    expect(verifyCommonComparisonBaseline(a, b)).toBe(true);
  });

  it('拒绝共有装备的显式设置、生效技能或直接属性漂移', () => {
    const a = triggeredEquipmentSimulationSample(['item_1043']);
    const changedSetting = structuredClone(a);
    changedSetting.selection.sourceSkillSettings.push(setting('item_1043', false));
    expect(verifyCommonComparisonBaseline(a, changedSetting)).toBe(false);
    const changedSource = structuredClone(a);
    changedSource.source.skillSources.find(row => row.origin.kind === 'EQUIPMENT')!.enabled = false;
    expect(verifyCommonComparisonBaseline(a, changedSource)).toBe(false);
    const changedAttributes = structuredClone(a);
    changedAttributes.source.selectedEquipment[0]!.attributes.attributeValues.bonus_attack_speed_percent = 0.3;
    expect(verifyCommonComparisonBaseline(a, changedAttributes)).toBe(false);
  });

  it('拒绝双方构筑生效定义、目标配置、共同目录及共有技能摘要漂移', () => {
    const a = simulationDefaultSourcesSample();
    a.target.selectedBuilds = structuredClone(a.source.selectedBuilds);
    a.selection.targetBuildConfigurations = structuredClone(a.selection.sourceBuildConfigurations);
    for (const side of ['source', 'target'] as const) {
      const changedBuild = structuredClone(a);
      changedBuild[side].selectedBuilds[0]!.definition.options[0]!.rankCosts = [1];
      expect(verifyCommonComparisonBaseline(a, changedBuild)).toBe(false);
    }
    const changedTarget = structuredClone(a);
    changedTarget.target.selectedLevelValues.hp = 600;
    expect(verifyCommonComparisonBaseline(a, changedTarget)).toBe(false);
    const changedCatalog = structuredClone(a);
    changedCatalog.catalogs.attributes[0]!.maxValue = 700;
    expect(verifyCommonComparisonBaseline(a, changedCatalog)).toBe(false);
    const changedSkill = structuredClone(a);
    changedSkill.skillConfigurations[0]!.baseDigest = 'edited';
    expect(verifyCommonComparisonBaseline(a, changedSkill)).toBe(false);
  });
});

type Summary = RunSummary & { execution: ExecutionSummary; damageBreakdown: DamageBreakdown[] };
type FrozenRun = CombatComparisonArchive & { runRequest: RunRequest; runResult: DoneResult & { summary: Summary } };

function frozenRun(snapshot = simulationDefaultSourcesSample(), overrides: Partial<Summary> = {}): FrozenRun {
  const initialSnapshot = { schemaHash: 'schema', rulesHash: 'rules', timeMs: 0, combatants: [] };
  const durationMs = 2000;
  const summary: Summary = { durationMs, stopReason: 'duration_reached', sourceFinalHp: 650, targetFinalHp: 590,
    sourceDamageDealt: 0, targetDamageDealt: 0, sourceDamageTaken: 0, targetDamageTaken: 0,
    sourceHpLoss: 0, targetHpLoss: 0, sourceDirectHealing: 0, sourceVampHealing: 0,
    abilityAttemptCount: 0, abilityCastCount: 0, attemptSkippedCount: 0, warningCount: 0, evidenceTruncated: false, seriesDownsampled: false,
    execution: { requestedDurationMs: durationMs, complete: true, incompleteReason: null, budgetCause: null, targetKilled: false, targetKilledAtMs: null },
    damageBreakdown: [], abilityStats: [], ...overrides };
  const runRequest: RunRequest = { sessionId: 'run', schemaHash: 'schema', rulesHash: 'rules', expectedRulesHash: 'rules', schemaVersion: '2', initialSnapshot,
    driverPlan: { entries: [], conditionRecheckIntervalMs: 100 },
    stopPolicy: { durationMs, stopOnTargetDeath: true, stopWhenNoEvents: false },
    sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 } };
  return { taskKind: 'automatic_skill', outcome: 'passed', cleanup: 'released', wasm: { sha256: 'frozen-wasm' }, adapterVersion: 'frozen-adapter',
    snapshot, runRequest, assessment: { complete: true, factsValid: true, seriesIssues: [] }, operationOrigins: [], skillOrigins: [],
    runResult: { ok: true, summary, finalSnapshot: { ...initialSnapshot, timeMs: summary.durationMs }, series: [], warnings: [],
      evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
      seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 0, requestedPointCount: 0,
        finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'disabled' } } };
}

const basicSkill = 'sample_basic_attack';
const naturalSkill = 'sample_natural';
const characterOrigin: SimulationSkillOrigin = { kind: 'CHARACTER', characterKey: 'actor_a' };

function addDamage(run: FrozenRun, skillKey: string, mount: string, amount: number, origin?: SimulationSkillOrigin,
  overrides: Partial<DamageBreakdown> = {}) {
  const owner = overrides.owner === 'target' ? 'target' : 'source';
  const row: DamageBreakdown = { owner, source: owner, target: owner === 'source' ? 'target' : 'source',
    abilityRef: `${owner}.provider[${mount}].ability[hit]`, operationRef: `skills.${skillKey}.effects.hit.results.damage`,
    damageType: 'physics', damageCount: 1, postDefenseDamage: amount, shieldAbsorbed: 0, actualHpLoss: amount, overkillDamage: 0, ...overrides };
  run.runResult.summary.damageBreakdown.push(row);
  run.operationOrigins.push({ skillKey, effectKey: 'hit', resultKey: 'damage', abilityRef: row.abilityRef,
    operationRef: row.operationRef, compiledPaths: [`${mount}.hit.${run.operationOrigins.length}`], providerDefinitionRef: row.providerDefinitionRef });
  if (origin) run.skillOrigins.push({ side: owner, origin, enabled: true, skillKey, skillName: skillKey, skillLevel: 1,
    skillStatus: 'ENABLED', enabledRuleKeys: [], inactiveReason: null, providerRef: mount, definitionRef: row.providerDefinitionRef });
  return row;
}

function values(a: FrozenRun, b: FrozenRun, key: CombatComparisonMetric['key']) {
  const metric = assessCombatComparison(a, b).metrics.find(metric => metric.key === key);
  if (!metric) throw new Error(`缺少比较指标 ${key}`);
  return { a: metric.a, b: metric.b, delta: metric.delta, relativeDelta: metric.relativeDelta };
}

function kill(run: FrozenRun, atMs: number) {
  Object.assign(run.runResult.summary, { durationMs: atMs, stopReason: 'target_dead', targetFinalHp: 0 });
  Object.assign(run.runResult.summary.execution, { targetKilled: true, targetKilledAtMs: atMs });
}

describe('停止分类与完整汇总指标', () => {
  it('同装同输入的可比较指标和已配对来源差值为 0，零基准没有百分比', () => {
    const a = frozenRun(undefined, { sourceDamageDealt: 80, targetHpLoss: 80, targetFinalHp: 510 });
    addDamage(a, basicSkill, 'selected_basic_attack', 80);
    const result = assessCombatComparison(a, structuredClone(a));
    expect(result.stopCategory).toBe('both_full_duration');
    expect(result.metrics.filter(metric => metric.key !== 'targetKilledAtMs').map(metric => metric.delta)).toEqual(Array(7).fill(0));
    expect(result.metrics.find(metric => metric.key === 'sourceDirectHealing')).toMatchObject({ delta: 0, relativeDelta: null });
    expect(result.sources).toMatchObject([{ kind: 'paired', amountA: 80, amountB: 80, delta: 0, relativeDelta: 0, countA: 1, countB: 1 }]);
  });

  it('共同终点按防御后伤害、实际扣血和各方向护盾分开计算', () => {
    const a = frozenRun(undefined, { sourceDamageDealt: 100, targetHpLoss: 70, targetFinalHp: 520, sourceDirectHealing: 5, sourceVampHealing: 2 });
    const b = frozenRun(undefined, { sourceDamageDealt: 140, targetHpLoss: 90, targetFinalHp: 500, sourceDirectHealing: 15, sourceVampHealing: 3 });
    addDamage(a, basicSkill, 'selected_basic_attack', 100, undefined, { shieldAbsorbed: 30, actualHpLoss: 70 });
    addDamage(b, basicSkill, 'selected_basic_attack', 140, undefined, { shieldAbsorbed: 50, actualHpLoss: 90 });
    addDamage(a, basicSkill, 'selected_basic_attack', 3, undefined, { owner: 'target', shieldAbsorbed: 3, actualHpLoss: 0 });
    addDamage(b, basicSkill, 'selected_basic_attack', 8, undefined, { owner: 'target', shieldAbsorbed: 8, actualHpLoss: 0 });
    expect(values(a, b, 'sourceDamageDealt')).toEqual({ a: 100, b: 140, delta: 40, relativeDelta: 0.4 });
    expect(values(a, b, 'targetHpLoss')).toMatchObject({ a: 70, b: 90, delta: 20 });
    expect(values(a, b, 'targetFinalHp')).toMatchObject({ a: 520, b: 500, delta: -20 });
    expect(values(a, b, 'targetShieldAbsorbed')).toMatchObject({ a: 30, b: 50, delta: 20 });
    expect(values(a, b, 'sourceShieldAbsorbed')).toMatchObject({ a: 3, b: 8, delta: 5 });
    expect(values(a, b, 'sourceDirectHealing')).toMatchObject({ a: 5, b: 15, delta: 10 });
    expect(values(a, b, 'sourceVampHealing')).toMatchObject({ a: 2, b: 3, delta: 1 });
    expect(values(a, b, 'averageDps')).toEqual({ a: 50, b: 70, delta: 20, relativeDelta: 0.4 });
  });

  it('单方未击杀保留空值，双方击杀按真实时刻相减，停时不同保留累计差', () => {
    const a = frozenRun(undefined, { sourceDamageDealt: 0 });
    const b = frozenRun(undefined, { sourceDamageDealt: 600 });
    kill(b, 1200);
    expect(assessCombatComparison(a, b).stopCategory).toBe('target_killed');
    expect(values(a, b, 'targetKilledAtMs')).toEqual({ a: null, b: 1200, delta: null, relativeDelta: null });
    expect(values(a, b, 'sourceDamageDealt')).toEqual({ a: 0, b: 600, delta: 600, relativeDelta: null });
    expect(values(a, b, 'averageDps')).toEqual({ a: 0, b: 500, delta: null, relativeDelta: null });
    kill(a, 1600);
    expect(values(a, b, 'targetKilledAtMs')).toEqual({ a: 1600, b: 1200, delta: -400, relativeDelta: null });
  });

  it('未击杀而因死亡或无事件提前同刻停止，仍比较正时长平均 DPS', () => {
    const a = frozenRun(undefined, { durationMs: 1000, stopReason: 'source_dead', sourceFinalHp: 0, sourceDamageDealt: 30 });
    const b = frozenRun(undefined, { durationMs: 1000, stopReason: 'no_events', sourceDamageDealt: 60 });
    expect(assessCombatComparison(a, b).stopCategory).toBe('early_stop_non_kill');
    expect(values(a, b, 'averageDps')).toEqual({ a: 30, b: 60, delta: 30, relativeDelta: 1 });
  });

  it('0 毫秒击杀是实际时刻，平均 DPS 保持空值', () => {
    const a = frozenRun(undefined, { durationMs: 0, stopReason: 'no_events' });
    const b = frozenRun(undefined, { sourceDamageDealt: 590 });
    kill(b, 0);
    expect(values(a, b, 'targetKilledAtMs')).toEqual({ a: null, b: 0, delta: null, relativeDelta: null });
    expect(values(a, b, 'averageDps')).toEqual({ a: null, b: null, delta: null, relativeDelta: null });
    expect(values(a, b, 'sourceDamageDealt').delta).toBe(590);
  });

  it.each(['budget', 'unfinished', 'cancelled', 'release', 'sampling', 'facts', 'identity'] as const)
    ('%s 导致不完整，所有跨方案差值都为空', problem => {
      const a = frozenRun(undefined, { sourceDamageDealt: 80 });
      const b = frozenRun(undefined, { sourceDamageDealt: 90 });
      addDamage(a, basicSkill, 'selected_basic_attack', 80);
      addDamage(b, basicSkill, 'selected_basic_attack', 90);
      if (problem === 'budget') b.runResult.summary.stopReason = 'budget_exceeded';
      if (problem === 'unfinished') b.runResult.summary.execution.complete = false;
      if (problem === 'cancelled') b.outcome = 'cancelled';
      if (problem === 'release') b.cleanup = 'release_failed';
      if (problem === 'identity') b.wasm.sha256 = 'different-wasm';
      if (problem === 'facts') b.assessment = { complete: true, factsValid: false };
      if (problem === 'sampling') {
        b.runRequest.sampling.disabled = false;
        const { seriesIssues } = inspectContinuousAttackSeries(b.runRequest, b.runResult);
        expect(seriesIssues.length).toBeGreaterThan(0);
        b.assessment = { complete: false, factsValid: true, seriesIssues };
      }
      const result = assessCombatComparison(a, b);
      expect(result.stopCategory).toBe('incomplete');
      expect(result.metrics.every(row => row.delta === null && row.relativeDelta === null)).toBe(true);
      expect(result.sources).toMatchObject([
        { kind: 'unpaired', amountA: 80, amountB: null, delta: null, relativeDelta: null },
        { kind: 'unpaired', amountA: null, amountB: 90, delta: null, relativeDelta: null }
      ]);
    });

  it.each(['disabled', 'summary', 'automatic', 'general'] as const)
    ('%s 的明细/采样状态与已通过的累计核对独立', mode => {
      const a = frozenRun(undefined, { sourceDamageDealt: 40 });
      const b = frozenRun(undefined, { sourceDamageDealt: 90 });
      addDamage(a, basicSkill, 'selected_basic_attack', 40);
      addDamage(b, basicSkill, 'selected_basic_attack', 90);
      if (mode === 'summary') b.runResult.outputMode = 'summary';
      if (mode === 'automatic') b.runResult.automaticSkillRecording = { totalCount: 1, returnedCount: 0, omittedCount: 0, droppedCount: 1, truncated: true };
      if (mode === 'general') {
        b.taskKind = 'continuous_attack';
        b.runResult.recording = { attackRecordCount: 0, returnedAttackRecords: 0, droppedAttackRecords: 0, attackRecordsTruncated: false,
          damageRecordCount: 1, returnedDamageRecords: 0, droppedDamageRecords: 1, damageRecordsTruncated: true,
          mechanicRecordCount: 0, returnedMechanicRecords: 0, droppedMechanicRecords: 0, mechanicRecordsTruncated: false };
      }
      expect(inspectContinuousAttackSeries(b.runRequest, b.runResult).seriesIssues).toEqual([]);
      const result = assessCombatComparison(a, b);
      expect(result).toMatchObject({ stopCategory: 'both_full_duration', detailsTruncated: mode !== 'disabled',
        sources: [{ kind: 'paired', amountA: 40, amountB: 90, delta: 50 }] });
      expect(values(a, b, 'sourceDamageDealt').delta).toBe(50);
    });
});

describe('以冻结作者来源配对伤害分类', () => {
  it('挂载、能力和编译路径变化后仍按作者身份配对，可确认的装备被动只在 B', () => {
    const a = frozenRun();
    const b = frozenRun();
    addDamage(a, naturalSkill, 'source_natural_skill_1', 30, characterOrigin, { damageCount: 2 });
    addDamage(b, naturalSkill, 'source_natural_skill_5', 48, characterOrigin, { damageCount: 3 });
    addDamage(b, 'item_1043_passive', 'source_item_1043_passive', 15, equipmentOrigin('item_1043'));
    expect(a.skillOrigins[0]!.providerRef).not.toBe(b.skillOrigins[0]!.providerRef);
    expect(a.operationOrigins[0]!.compiledPaths).not.toEqual(b.operationOrigins[0]!.compiledPaths);
    expect(assessCombatComparison(a, b).sources).toMatchObject([
      { kind: 'paired', amountA: 30, amountB: 48, delta: 18, relativeDelta: 0.6, countA: 2, countB: 3 },
      { kind: 'only_b', amountA: 0, amountB: 15, delta: 15, relativeDelta: null, countA: 0, countB: 1 }
    ]);
    expect(assessCombatComparison(b, a).sources).toContainEqual(expect.objectContaining({ kind: 'only_a', delta: -15, relativeDelta: -1 }));
  });

  it('按冻结定义引用唯一识别有期来源，不要求临时挂载标识相同', () => {
    const a = frozenRun();
    const b = frozenRun();
    addDamage(a, naturalSkill, 'source_natural_skill_1', 20, characterOrigin);
    addDamage(b, naturalSkill, 'dynamic_mount', 25, characterOrigin, { providerDefinitionRef: 'frozen_definition' });
    b.skillOrigins[0]!.providerRef = 'different_mount';
    b.operationOrigins[0]!.abilityRef = 'source.provider[original_mount].ability[hit]';
    expect(assessCombatComparison(a, b).sources).toMatchObject([{ kind: 'paired', amountA: 20, amountB: 25, delta: 5 }]);
  });

  it('另一侧作者映射无法确认但技能仍在冻结快照内，双方未知金额保留为空', () => {
    const a = frozenRun();
    const b = frozenRun();
    addDamage(a, naturalSkill, 'source_natural_skill_1', 80, characterOrigin);
    addDamage(b, naturalSkill, 'unknown_mount', 90, undefined, { operationRef: 'unresolved_author_reference' });
    b.operationOrigins = [];
    expect(assessCombatComparison(a, b).sources).toMatchObject([
      { kind: 'unpaired', amountA: 80, amountB: null, delta: null, countB: null, reason: expect.stringContaining('可能对应') },
      { kind: 'unpaired', amountA: null, amountB: 90, delta: null, countA: null }
    ]);
  });

  it('对侧无法还原的其他伤害类型不阻止已证明的单方来源', () => {
    const a = frozenRun();
    const b = frozenRun();
    addDamage(a, naturalSkill, 'source_natural_skill_1', 80, characterOrigin);
    addDamage(b, naturalSkill, 'unknown_mount', 90, undefined, { damageType: 'magic' });
    b.operationOrigins = [];
    expect(assessCombatComparison(a, b).sources).toMatchObject([
      { kind: 'only_a', amountA: 80, amountB: 0, delta: -80 },
      { kind: 'unpaired', amountA: null, amountB: 90, delta: null }
    ]);
  });

  it('普攻内同技能多构筑槽位只能保留合计，独立侧也不误判为单方', () => {
    const a = frozenRun();
    const b = frozenRun();
    const [first, second] = a.snapshot.source.skillSources.filter(row => row.origin.kind === 'BUILD_OPTION');
    if (!first || !second) throw new Error('需要两个同技能构筑槽位');
    addDamage(a, naturalSkill, 'selected_basic_attack', 30, first.origin);
    a.skillOrigins.push({ ...second, enabled: true, side: 'source' });
    addDamage(b, naturalSkill, 'selected_basic_attack', 15, first.origin);
    expect(assessCombatComparison(a, b).sources).toMatchObject([
      { kind: 'unpaired', amountA: 30, amountB: null, delta: null },
      { kind: 'unpaired', amountA: null, amountB: 15, delta: null }
    ]);
  });

  it('同一档案内两个原始分类落入同一规范身份，降级后保留各自金额', () => {
    const a = frozenRun();
    const b = frozenRun();
    addDamage(a, naturalSkill, 'earlier_mount', 20, characterOrigin);
    addDamage(a, naturalSkill, 'later_mount', 35, characterOrigin);
    addDamage(b, naturalSkill, 'other_mount', 55, characterOrigin);
    const { sources } = assessCombatComparison(a, b);
    expect(sources).toMatchObject([
      { kind: 'unpaired', amountA: 20, amountB: null, delta: null },
      { kind: 'unpaired', amountA: 35, amountB: null, delta: null },
      { kind: 'unpaired', amountA: null, amountB: 55, delta: null }
    ]);
    expect(new Set(sources.map(row => row.key)).size).toBe(3);
  });
});

it('比较档案保留双方案运行证据与评估，沿用既有业务白名单及鉴权脱敏', () => {
  const left = frozenRun(undefined, { sourceDamageDealt: 80 });
  const right = frozenRun(undefined, { sourceDamageDealt: 100 });
  addDamage(left, basicSkill, 'selected_basic_attack', 80);
  addDamage(right, basicSkill, 'selected_basic_attack', 100);
  const a = { ...left, runRequest: { ...left.runRequest, authorization: 'private-grant' },
    arbitraryNote: 'private-extra', error: 'Bearer private-bearer https://private-host.test/ Authorization: private-header' };
  const b = { ...right, runInputHash: 'input-b', attributeInputs: { source: { hp: 750 }, target: {} } };
  const assessment = assessCombatComparison(a, b);
  const exported = buildCombatComparisonArchive(a, b, assessment);
  expect(exported).toMatchObject({ taskKind: 'combat_comparison', displayDefinitionVersion: 1,
    a: { taskKind: 'automatic_skill', runResult: { summary: { sourceDamageDealt: 80 } }, snapshot: { snapshotDigest: a.snapshot.snapshotDigest } },
    b: { runInputHash: 'input-b', attributeInputs: b.attributeInputs, runResult: { summary: { sourceDamageDealt: 100 } } }, assessment });
  expect(JSON.stringify(exported)).not.toContain('private-');
  expect(a.runRequest.authorization).toBe('private-grant');
});
