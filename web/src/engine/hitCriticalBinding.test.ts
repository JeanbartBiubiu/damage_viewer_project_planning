import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { simulationComplexSample } from '../../tests/fixtures/simulationComplexSkills';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { fixedValue, formulaValue } from '../types/numericValue';
import { adaptHitProgram, type AuthoredHitProgram } from './hitAdapter';
import { simulationCriticalBinding } from './simulationCalculationRules';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { automaticSkillRequest } from './automaticSkillRequest';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import { TinyGoV2Bridge } from './tinygoV2Bridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';

let bridge: TinyGoV2Bridge;
beforeAll(async () => {
  const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('8eebbefbd2491490e2e8ded34a1f920ed8c6a79cdeab9eeadbda5fdd68309ffe');
  bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
});

function sample(suffix = 'alpha', forced = false, multiplier = 1.39) {
  const original = simulationComplexSample('CHANNEL', false);
  const oldSkill = original.selection.plannedSkills[0]!.skillKey;
  const skillKey = `critical_channel_${suffix}`, chanceKey = `authored_odds_${suffix}`;
  const snapshot = JSON.parse(JSON.stringify(original).replaceAll(oldSkill, skillKey)) as SimulationSnapshot;
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === skillKey)!;
  const process = configuration.processes[0]!;
  process.steps = [{ ...process.steps[1]!, sortOrder: 0 }];
  configuration.triggerRules = configuration.triggerRules.filter(rule => rule.eventSource.eventType !== 'PROCESS_CANCEL_REQUESTED');
  snapshot.selection.plannedSkills[0]!.phaseKinds = ['INITIAL'];
  snapshot.catalogs.attributes.find(attribute => attribute.attributeKey === 'critical_strike_chance')!.attributeKey = chanceKey;
  snapshot.catalogs.calculationRules.configuration!.criticalChanceAttributeKey = chanceKey;
  for (const side of ['source', 'target'] as const) {
    snapshot[side].selectedLevelValues[chanceKey] = side === 'source' ? .4 : 0;
    snapshot[side].attributes.levelValues['1'] = { ...snapshot[side].selectedLevelValues };
  }
  configuration.parameters = [{ gameId: snapshot.gameId, skillKey, parameterKey: 'authored_multiplier', name: '原作者倍率', description: null,
    valueMode: 'FIXED', valueType: 'DECIMAL', fixedValue: multiplier, levelValues: null, sortOrder: 0, createdAt: '', updatedAt: '' }];
  configuration.formulas = [{ gameId: snapshot.gameId, skillKey, formulaKey: 'skill_multiplier_formula', name: '原作者倍率公式', description: null,
    sortOrder: 0, createdAt: '', updatedAt: '', expression: {
      inputs: [{ key: 'multiplier', binding: { kind: 'parameter', skillKey, parameterKey: 'authored_multiplier' } }],
      stages: [{ key: 'multiplier', name: '本技能倍率', expression: { op: 'read', inputKey: 'multiplier' } }], outputStageKey: 'multiplier'
    } }];
  const damage = configuration.effects[0]!.results[0]!;
  if (damage.resultType !== 'DAMAGE') throw new Error('需要独立技能伤害');
  damage.detail.critical = { mode: forced ? 'FORCED' : 'SOURCE_CRIT_CHANCE', multiplierValue: formulaValue('skill_multiplier_formula') };
  syncSimulationSkillSources(snapshot);
  return { snapshot, configuration, process, damage, skillKey, chanceKey };
}

function authoredOf(context: ReturnType<typeof sample>): AuthoredHitProgram {
  return { gameId: context.snapshot.gameId, skillKey: context.skillKey, skillLevel: 1, characterLevel: 1,
    effects: context.configuration.effects, rules: context.configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT'),
    parameters: context.configuration.parameters, formulas: context.configuration.formulas, statuses: context.snapshot.catalogs.statuses,
    modifierZones: context.snapshot.catalogs.modifierZones, skillCategoryKeys: context.configuration.skill.skillCategoryKeys,
    vampRules: context.snapshot.catalogs.vampRules.rules,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    criticalBinding: (forced, path) => simulationCriticalBinding(context.snapshot, forced, path) };
}

async function execute(context: ReturnType<typeof sample>, preset: 'TARGET_HIT' | 'MISS' = 'TARGET_HIT') {
  approveSnapshotFixture(context.snapshot);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(context.snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  const prepared = assembleSimulation(context.snapshot, attributes, { source: 1000, target: 5000 });
  const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
  if (!compiled.sessionId) throw new Error('缺少正式Wasm会话');
  try {
    const request = (await automaticSkillRequest(prepared, context.snapshot, { rules: [{ ...context.snapshot.selection.plannedSkills[0]!, ruleKey: 'critical_channel',
      sortOrder: 0, targetSide: 'target', hitPreset: preset, waitForCooldowns: [], releaseAfterRuleKey: null }], durationMs: 600,
    recordTimeSeries: false, maxAutomaticSkillRecords: 1000, maxHealingRecords: 0, outputMode: 'detailed' }, compiled.sessionId)).runRequest;
    const done = parseDoneResult(bridge.run(request));
    const assessment = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
    expect(assessment.factsValid, assessment.issues.join(';')).toBe(true);
    return { done, prepared };
  } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
}

describe('技能命中的真实游戏概率绑定与原作者倍率', () => {
  it.each(['alpha', 'beta'])('%s异名技能／概率属性透传作者倍率公式，不使用全局默认倍率', async suffix => {
    const context = sample(suffix);
    approveSnapshotFixture(context.snapshot);
    const adapted = adaptHitProgram(authoredOf(context));
    expect(adapted.requiredAttributes).toContain(context.chanceKey);
    const operation = adapted.skillHit.candidates.flatMap(candidate => candidate.operations).find(operation => operation.operation === 'damage')!;
    expect(operation).toMatchObject({ critEligible: true, critChance: { op: 'read', path: `source.attr.${context.chanceKey}.resolved` },
      critMultiplier: { op: 'ref', ref: expect.stringContaining('/skill_multiplier_formula') }, critMultiplierMin: 1 });
    expect(Object.prototype.hasOwnProperty.call(adapted, 'criticalBinding')).toBe(false);
    const { done } = await execute(context);
    expect(done.damageRecords).toHaveLength(3);
    for (const row of done.damageRecords!) {
      expect(row).toMatchObject({ eligible: true, policy: 'expected', originalCritChance: .4, effectiveCritChance: .4, multiplier: 1.39, baseRawAmount: 100 });
      expect(row.critAdjustedRawAmount).toBeCloseTo(115.6, 9);
      expect(row.rawAmount / row.baseRawAmount!).toBeCloseTo(1.156, 12);
    }
  });

  it('强制暴击使用作者1.39，无概率属性绑定仍使用明确概率1', async () => {
    const context = sample('forced', true);
    context.snapshot.catalogs.calculationRules.configuration!.criticalChanceAttributeKey = null;
    const { done } = await execute(context);
    for (const row of done.damageRecords!) {
      expect(row.originalCritChance).toBe(1);
      expect(row.multiplier).toBe(1.39);
      expect(row.critAdjustedRawAmount).toBeCloseTo(139, 9);
    }
  });

  it.each([
    { multiplier: .5, minimum: 1, expected: 1, factor: 1 },
    { multiplier: 1.1, minimum: 1.2, expected: 1.2, factor: 1.08 },
    { multiplier: .5, minimum: null, expected: .5, factor: .8 }
  ])('作者倍率$multiplier与游戏下限$minimum分别保留，不暗补1或通用倍率', async ({ multiplier, minimum, expected, factor }) => {
    const context = sample('minimum', false, multiplier);
    context.snapshot.catalogs.calculationRules.configuration!.criticalMultiplierMin = minimum;
    const { done } = await execute(context);
    for (const row of done.damageRecords!) {
      expect(row.multiplier).toBe(expected);
      expect(row.rawAmount / row.baseRawAmount!).toBeCloseTo(factor, 12);
    }
  });

  it('MISS仍执行3圈释放但不产生伤害或暴击记录', async () => {
    const { done } = await execute(sample(), 'MISS');
    expect(done.summary.skillUses).toMatchObject({ releasedCount: 3, hitCount: 0, completedCount: 1 });
    expect(done.damageRecords).toEqual([]);
    expect(done.summary.sourceDamageDealt).toBe(0);
  });

  it.each(['no_callback', 'no_game_binding', 'no_authored_multiplier', 'missing_chance', 'foreign_chance'] as const)('拒绝缺失或伪造的%s，不补全局概率或倍率', kind => {
    const context = sample();
    approveSnapshotFixture(context.snapshot);
    const authored = authoredOf(context);
    if (kind === 'no_callback') authored.criticalBinding = undefined;
    if (kind === 'no_game_binding') context.snapshot.catalogs.calculationRules.configuration!.criticalChanceAttributeKey = null;
    if (kind === 'no_authored_multiplier') context.damage.detail.critical.multiplierValue = null;
    if (kind === 'missing_chance') authored.criticalBinding = () => ({});
    if (kind === 'foreign_chance') authored.criticalBinding = () => ({ critChance: { op: 'read', path: `target.attr.${context.chanceKey}.resolved` } });
    expect(() => adaptHitProgram(authored)).toThrow(/暴击|概率|来源/);
  });

  it('DISALLOWED拒绝残留作者倍率；明确清空后不要求暴击回调', () => {
    const context = sample();
    context.damage.detail.critical.mode = 'DISALLOWED';
    const authored = authoredOf(context);
    authored.criticalBinding = undefined;
    expect(() => adaptHitProgram(authored)).toThrow(/禁止暴击不得保留倍率/);
    context.damage.detail.critical.multiplierValue = null;
    const adapted = adaptHitProgram(authored);
    expect(adapted.skillHit.candidates.flatMap(candidate => candidate.operations).find(operation => operation.operation === 'damage'))
      .toMatchObject({ critEligible: false });
  });

  it('临时概率增益到期后后续圈实时读取概率，作者倍率始终保持1.39', async () => {
    const context = sample('live_odds');
    context.snapshot.catalogs.modifierZones.push({ gameId: context.snapshot.gameId, modifierZoneKey: 'temporary_chance_flat', name: '临时概率平加',
      domain: 'ATTRIBUTE', calculationMode: 'FLAT_ADD', applicationStage: 'ATTRIBUTE_FLAT', status: 'ENABLED', description: null,
      sortOrder: 0, createdAt: '', updatedAt: '' });
    context.configuration.effects.push({ gameId: context.snapshot.gameId, skillKey: context.skillKey, effectKey: 'temporary_chance', name: '真实有期概率增益',
      description: null, sortOrder: 1, createdAt: '', updatedAt: '',
      lifecycle: { instanceScope: 'SOURCE', durationValue: fixedValue(100), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
        reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null,
        firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
      results: [{ resultKey: 'temporary_chance', name: '临时概率值', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
        spellShieldBlockScope: null, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
          reapplicationValueMode: 'REPLACE', periodicExecutionMode: null },
        valueRule: { value: fixedValue(.3), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { attributeKey: context.chanceKey, operation: 'INCREASE', modifierZoneKey: 'temporary_chance_flat' } }] });
    context.process.effectBindings.push({ bindingKey: 'temporary_chance', effectKey: 'temporary_chance', sortOrder: 0,
      moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } });
    syncSimulationSkillSources(context.snapshot);
    const { done } = await execute(context);
    expect(done.damageRecords!.map(row => row.timeMs)).toEqual([0, 200, 400]);
    for (const [index, row] of done.damageRecords!.entries()) {
      expect(row.effectiveCritChance).toBeCloseTo(index === 0 ? .7 : .4, 12);
      expect(row.multiplier).toBe(1.39);
      expect(row.critAdjustedRawAmount).toBeCloseTo(index === 0 ? 127.3 : 115.6, 9);
    }
    expect(done.finalSnapshot.combatants.find(row => row.key === 'source')!.attributes[context.chanceKey]!.resolved).toBe(.4);
  });
});
