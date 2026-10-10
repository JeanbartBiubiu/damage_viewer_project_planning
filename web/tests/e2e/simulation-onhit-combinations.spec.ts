import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CompileRequest, DamageRecord, DoneResult, RunRequest } from '../../src/types/genericEngine';
import type { NumericValue } from '../../src/types/numericValue';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { readIsolatedSimulationSnapshot, simulationComparisonSelection } from '../fixtures/simulationSnapshotRequests';

type CombinationScenario = {
  name: string; source: string[]; target: string[]; durationMs: number;
  meleeAttack?: 0 | 1; targetInitialHp?: number; verifyCooldownBoundary?: boolean;
};
const outputDirectory = resolve('output/phase4c-onhit-combinations-2026-10-04');
const scenarios: CombinationScenario[] = [
  { name: 'botrk_ghost_melee', source: ['item_3153', 'item_3124'], target: [], durationMs: 12000, meleeAttack: 1 },
  { name: 'wisdom_ghost', source: ['item_3091', 'item_3124'], target: [], durationMs: 12000 },
  { name: 'both_ghost_thorns', source: ['item_3153', 'item_3091', 'item_3124'], target: ['item_3075'], durationMs: 12000, meleeAttack: 1 },
  { name: 'botrk_ghost_ranged_zero', source: ['item_3153', 'item_3124'], target: [], durationMs: 12000, meleeAttack: 0 },
  { name: 'low_hp_kill', source: ['item_3153', 'item_3091', 'item_3124'], target: ['item_3075'], durationMs: 12000, meleeAttack: 1, targetInitialHp: 100 },
  { name: 'botrk_ghost_thorns_frozen_30s', source: ['item_3153', 'item_3124'], target: ['item_3075', 'item_3110'],
    durationMs: 30000, meleeAttack: 1, verifyCooldownBoundary: true }
];

type CooldownProbe = { timeMs: number; reasons: string[]; request: RunRequest; done: DoneResult };

function saveArtifact(name: string, value: unknown) {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, `${name}.json`), JSON.stringify(value, null, 2));
}
function configuration(snapshot: SimulationSnapshot, skillKey: string) {
  const matches = snapshot.skillConfigurations.filter(config => config.skill.skillKey === skillKey);
  expect(matches, skillKey).toHaveLength(1);
  return matches[0]!;
}
function fixedParameter(config: SkillConfiguration, key: string) {
  const parameter = config.parameters.find(row => row.parameterKey === key)!;
  expect(parameter, key).toBeDefined();
  expect(parameter.valueMode, key).toBe('FIXED');
  expect(typeof parameter.fixedValue, key).toBe('number');
  return parameter.fixedValue!;
}
function numericValue(config: SkillConfiguration, value: NumericValue | null): number {
  if (value?.kind === 'FIXED') return value.value;
  if (value?.kind === 'PARAMETER') return fixedParameter(config, value.parameterKey);
  throw new Error('本次独立期望要求明确固定值或真实固定参数，不能猜测动态值');
}
function object(value: unknown): Record<string, unknown> {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}
function damageDefinition(snapshot: SimulationSnapshot, row: DamageRecord) {
  for (const config of snapshot.skillConfigurations) for (const effect of config.effects) for (const result of effect.results) {
    if (result.resultType === 'DAMAGE' && row.operationRef === `skills.${config.skill.skillKey}.effects.${effect.effectKey}.results.${result.resultKey}`) {
      return { config, result };
    }
  }
  throw new Error(`真实伤害缺少作者结果：${row.operationRef}`);
}

async function readSnapshot(request: APIRequestContext, scenario: CombinationScenario) {
  const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL ?? 'http://127.0.0.1:8080';
  const { snapshot, response, path } = await readIsolatedSimulationSnapshot(request, apiBase,
    simulationComparisonSelection({ targetLevel: 18, sourceEquipmentKeys: scenario.source, targetEquipmentKeys: scenario.target }), process.env.SIMULATION_LIVE_ADMIN_TOKEN);
  const body = await response.body();
  saveArtifact(`${scenario.name}-snapshot`, { http: { method: 'POST', path, selection: snapshot.selection, status: response.status(),
    bodySha256: createHash('sha256').update(body).digest('hex') }, snapshot });
  expect(snapshot.selection.sourceEquipmentKeys).toEqual([...scenario.source].sort());
  expect(snapshot.selection.targetEquipmentKeys).toEqual([...scenario.target].sort());
  for (const side of ['source', 'target'] as const) {
    expect(snapshot[side].selectedEquipment.map(item => item.equipment.equipmentKey).sort()).toEqual(snapshot.selection[`${side}EquipmentKeys`]);
    for (const item of snapshot[side].selectedEquipment) for (const relation of item.attachedSkills) configuration(snapshot, relation.skillKey);
  }
  for (const key of scenario.source.filter(key => key === 'item_3153' || key === 'item_3091')) {
    const config = configuration(snapshot, `${key}_passive`);
    expect(config.triggerRules.some(rule => rule.eventSource.eventType === 'BASIC_ATTACK_HIT')).toBe(true);
    const linkedRules = config.triggerRules.filter(rule => rule.eventSource.eventType === 'HIT_LINK_APPLIED');
    expect(linkedRules.length).toBeGreaterThan(0);
    expect(linkedRules.every(rule => rule.actions.every(action => action.actionType === 'EXECUTE_EFFECT'))).toBe(true);
    for (const effect of config.effects) for (const result of effect.results) if (result.resultType === 'DAMAGE') {
      expect(result.detail.vampQualification).toBe('RESOLVED');
      expect(result.detail.vampOverrides).toEqual([{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE',
        basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiencyValue: { kind: 'FIXED', value: 1 } }]);
    }
  }
  if (scenario.source.includes('item_3153')) {
    expect(snapshot.catalogs.attributes.filter(attribute => attribute.attributeKey === 'melee_attack')).toEqual([
      expect.objectContaining({ gameId: snapshot.gameId, valueType: 'INTEGER', status: 'ENABLED', minValue: 0, maxValue: 1 })
    ]);
    expect(snapshot.source.selectedLevelValues.melee_attack, '本次必须实际补填身份，不覆盖角色固有值').toBeUndefined();
    const config = configuration(snapshot, 'item_3153_passive');
    expect(fixedParameter(config, 'on_hit_damage_ratio_melee')).toBeCloseTo(.09, 7);
    expect(fixedParameter(config, 'on_hit_damage_ratio_ranged')).toBeCloseTo(.06, 7);
    expect(fixedParameter(config, 'slow_cooldown_ms')).toBe(15000);
    expect(fixedParameter(config, 'slow_duration_ms')).toBe(1000);
    expect(fixedParameter(config, 'slow_ratio')).toBeCloseTo(.3, 7);
  }
  if (scenario.source.includes('item_3091')) expect(fixedParameter(configuration(snapshot, 'item_3091_passive'), 'on_hit_damage')).toBe(45);
  return snapshot;
}

async function runCombination(page: Page, snapshot: SimulationSnapshot, scenario: CombinationScenario) {
  return page.evaluate(async ({ snapshot, scenario }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const continuousPath = '/src/engine/continuousAttackRequest.ts';
    const assessmentPath = '/src/engine/continuousAttackResult.ts';
    const singlePath = '/src/engine/singleAttackResult.ts';
    const equipmentPath = '/src/engine/simulationEquipment.ts';
    const passivePath = '/src/engine/simulationEquipmentPassives.ts';
    const { inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const { assessContinuousAttackResult } = await import(assessmentPath) as typeof import('../../src/engine/continuousAttackResult');
    const { assessSingleAttackResult } = await import(singlePath) as typeof import('../../src/engine/singleAttackResult');
    const { simulationHealthLimit } = await import(equipmentPath) as typeof import('../../src/engine/simulationEquipment');
    const { equipmentRangeRequirements } = await import(passivePath) as typeof import('../../src/engine/simulationEquipmentPassives');
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    const inspection = inspectSimulationSnapshot(snapshot);
    for (const row of inspection.requirements) if (row.storedValue === undefined) {
      const key = row.attribute.attributeKey;
      if (key === 'melee_attack') {
        if (row.side !== 'source' || scenario.meleeAttack === undefined) throw new Error('melee_attack必须由本次场景明确提供');
        inputs.source[key] = scenario.meleeAttack;
      } else inputs[row.side][key] = key === 'attack_speed_ratio' ? .651
        : key === 'life_steal_percent' && row.side === 'source' ? .1
          : key === 'omnivamp_percent' && row.side === 'source' ? .05 : 0;
    }
    const health = { source: simulationHealthLimit(snapshot, 'source')! - 100,
      target: scenario.targetInitialHp ?? simulationHealthLimit(snapshot, 'target')! };
    const assumptions = equipmentRangeRequirements(snapshot).map(({ owner, equipmentKey }) => ({ owner, equipmentKey,
      target: owner === 'source' ? 'target' as const : 'source' as const, inRange: true }));
    const prepared = await prepareSimulation(snapshot, inputs, health, assumptions);
    const client = new GenericEngineClient();
    let sessionId: string | undefined;
    let phase = 'compile';
    const completed: Record<string, unknown> = {};
    const runTrace: Array<{ phase: string; sessionId: string; durationMs: number;
      sampling: RunRequest['sampling']; recordBudget: RunRequest['recordBudget'] }> = [];
    completed.runTrace = runTrace;
    const runSameSession = async (request: RunRequest, runPhase: string) => {
      phase = runPhase;
      if (!client.hasLiveWorker || request.sessionId !== sessionId) throw new Error('运行必须保留同一真实Worker和编译会话');
      const result = await client.run(request);
      runTrace.push({ phase, sessionId: request.sessionId, durationMs: request.stopPolicy.durationMs,
        sampling: request.sampling, recordBudget: request.recordBudget });
      return result;
    };
    try {
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(`compile: ${JSON.stringify(compiled.errors)}`);
      sessionId = compiled.sessionId;
      completed.compiled = compiled;
      const singleRequest = singleAttackRequest(prepared.compileRequest, sessionId);
      const single = await runSameSession(singleRequest, 'single');
      completed.single = single;
      const singleAssessment = assessSingleAttackResult(prepared.compileRequest, singleRequest, single);
      const preparedRun = await continuousAttackRequest(prepared, snapshot, { durationMs: scenario.durationMs, attackSpeedInputMax: 10, recordTimeSeries: true }, sessionId);
      completed.request = preparedRun.runRequest;
      const done = await runSameSession(preparedRun.runRequest, 'continuous');
      completed.done = done;
      const assessment = assessContinuousAttackResult(prepared.compileRequest, preparedRun.runRequest, done, prepared.operationOrigins);
      const cooldownProbes: CooldownProbe[] = [];
      completed.cooldownProbes = cooldownProbes;
      if (scenario.verifyCooldownBoundary) {
        const slowDefinition = prepared.compileRequest.sharedProviders!.find(provider => provider.statusContributions
          ?.some(contribution => contribution.statusKey === 'movement_slow'))!;
        const firstProc = done.evidence.items.find(item => item.kind === 'provider_apply' && item.data?.definitionRef === slowDefinition.providerKey);
        if (firstProc) {
          const config = snapshot.skillConfigurations.find(config => config.skill.skillKey === 'item_3153_passive')!;
          const cooldownMs = config.parameters.find(parameter => parameter.parameterKey === 'slow_cooldown_ms')!.fixedValue!;
          const readyAtMs = firstProc.timeMs + cooldownMs;
          const times = new Map<number, string[]>();
          const addProbe = (timeMs: number, reason: string) => {
            if (timeMs > done.summary.durationMs) return;
            times.set(timeMs, [...(times.get(timeMs) ?? []), reason]);
          };
          for (const attack of done.attackRecords!.filter(attack => attack.hitAtMs !== null)) {
            if (attack.hitAtMs! > firstProc.timeMs && attack.hitAtMs! < readyAtMs) addProbe(attack.hitAtMs!, 'cooldown_hit');
          }
          addProbe(readyAtMs - 1, 'before_ready');
          addProbe(readyAtMs, 'ready');
          for (const attack of done.attackRecords!.filter(attack => attack.hitAtMs !== null && attack.hitAtMs >= readyAtMs).slice(0, 3)) {
            addProbe(attack.hitAtMs!, 'ready_hit');
          }
          for (const [timeMs, reasons] of [...times].sort(([leftTime], [rightTime]) => leftTime - rightTime)) {
            const request = { ...preparedRun.runRequest, stopPolicy: { ...preparedRun.runRequest.stopPolicy, durationMs: timeMs } };
            cooldownProbes.push({ timeMs, reasons, request, done: await runSameSession(request, `cooldown_probe_${timeMs}`) });
          }
        }
      }
      const thirdHitAtMs = done.attackRecords?.find(attack => attack.attackIndex === 3)?.hitAtMs;
      let slowBoundary = null;
      if (scenario.source.includes('item_3153') && thirdHitAtMs !== undefined && thirdHitAtMs !== null) {
        const beforeExpiryRequest = { ...preparedRun.runRequest,
          stopPolicy: { ...preparedRun.runRequest.stopPolicy, durationMs: thirdHitAtMs + 999 } };
        const atExpiryRequest = { ...preparedRun.runRequest,
          stopPolicy: { ...preparedRun.runRequest.stopPolicy, durationMs: thirdHitAtMs + 1000 } };
        const beforeExpiry = await runSameSession(beforeExpiryRequest, 'slow_before_expiry');
        const atExpiry = await runSameSession(atExpiryRequest, 'slow_at_expiry');
        slowBoundary = { thirdHitAtMs, beforeExpiryRequest, atExpiryRequest, beforeExpiry, atExpiry };
      }
      const repeated = await runSameSession(preparedRun.runRequest, 'repeated');
      const truncatedRequest = { ...preparedRun.runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0 } };
      const truncated = await runSameSession(truncatedRequest, 'truncated');
      const truncatedAssessment = assessContinuousAttackResult(prepared.compileRequest, truncatedRequest, truncated, prepared.operationOrigins);
      phase = 'release';
      const release = await client.release(sessionId, prepared.compileRequest.rulesHash);
      sessionId = undefined;
      client.terminate();
      return { prepared, request: preparedRun.runRequest, compiled, singleRequest, single, singleAssessment,
        done, assessment, slowBoundary, cooldownProbes, runTrace, repeated, truncatedRequest, truncated, truncatedAssessment, release, liveWorker: client.hasLiveWorker };
    } catch (error) {
      return { failure: { phase, message: error instanceof Error ? error.message : String(error), prepared, completed },
        liveWorker: client.hasLiveWorker };
    } finally {
      try {
        if (sessionId && client.hasLiveWorker) await client.release(sessionId, prepared.compileRequest.rulesHash);
      } finally { client.terminate(); }
    }
  }, { snapshot, scenario });
}

async function runCompleteRepeats(page: Page, snapshot: SimulationSnapshot, scenario: CombinationScenario) {
  return page.evaluate(async ({ snapshot, scenario }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const continuousPath = '/src/engine/continuousAttackRequest.ts';
    const equipmentPath = '/src/engine/simulationEquipment.ts';
    const passivePath = '/src/engine/simulationEquipmentPassives.ts';
    const { inspectSimulationSnapshot, prepareSimulation } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const { simulationHealthLimit } = await import(equipmentPath) as typeof import('../../src/engine/simulationEquipment');
    const { equipmentRangeRequirements } = await import(passivePath) as typeof import('../../src/engine/simulationEquipmentPassives');
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) {
      const key = row.attribute.attributeKey;
      if (key === 'melee_attack') {
        if (row.side !== 'source' || scenario.meleeAttack === undefined) throw new Error('melee_attack必须由本次场景明确提供');
        inputs.source[key] = scenario.meleeAttack;
      } else inputs[row.side][key] = key === 'attack_speed_ratio' ? .651
        : key === 'life_steal_percent' && row.side === 'source' ? .1
          : key === 'omnivamp_percent' && row.side === 'source' ? .05 : 0;
    }
    const assumptions = equipmentRangeRequirements(snapshot).map(({ owner, equipmentKey }) => ({ owner, equipmentKey,
      target: owner === 'source' ? 'target' as const : 'source' as const, inRange: true }));
    const health = { source: simulationHealthLimit(snapshot, 'source')! - 100, target: simulationHealthLimit(snapshot, 'target')! };
    const prepared = await prepareSimulation(snapshot, inputs, health, assumptions);
    const client = new GenericEngineClient();
    let sessionId: string | undefined;
    let phase = 'compile';
    const completed: Record<string, unknown> = {};
    const repeatChecks: Array<{ runIndex: number; sessionId: string; identical: boolean; elapsedMs: number }> = [];
    completed.repeatChecks = repeatChecks;
    try {
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(`compile: ${JSON.stringify(compiled.errors)}`);
      sessionId = compiled.sessionId;
      completed.compiled = compiled;
      const preparedRun = await continuousAttackRequest(prepared, snapshot,
        { durationMs: scenario.durationMs, attackSpeedInputMax: 10, recordTimeSeries: true }, sessionId);
      completed.request = preparedRun.runRequest;
      let baseline: DoneResult | undefined;
      let last: DoneResult | undefined;
      let baselineJson = '';
      const repeatsStartedAt = performance.now();
      for (let runIndex = 1; runIndex <= 100; runIndex++) {
        phase = `complete_run_${runIndex}`;
        if (!client.hasLiveWorker || preparedRun.runRequest.sessionId !== sessionId) throw new Error('100次运行不能重建Worker或编译会话');
        const startedAt = performance.now();
        const done = await client.run(preparedRun.runRequest);
        const doneJson = JSON.stringify(done);
        if (!baseline) {
          baseline = done;
          baselineJson = doneJson;
          completed.baseline = baseline;
        }
        const identical = doneJson === baselineJson;
        repeatChecks.push({ runIndex, sessionId, identical, elapsedMs: performance.now() - startedAt });
        completed.last = done;
        if (!identical) throw new Error(`第${runIndex}次完整done与首次运行不同`);
        last = done;
      }
      const repeatsElapsedMs = performance.now() - repeatsStartedAt;
      phase = 'release_first_session';
      const firstRelease = await client.release(sessionId, prepared.compileRequest.rulesHash);
      sessionId = undefined;
      completed.firstRelease = firstRelease;
      const liveWorkerAfterFirstRelease = client.hasLiveWorker;
      if (!liveWorkerAfterFirstRelease) throw new Error('释放会话后不能用新的Worker完成重新编译');
      phase = 'recompile_same_worker';
      const recompiled = await client.compile(prepared.compileRequest);
      if (!recompiled.ok || !recompiled.sessionId) throw new Error(`recompile: ${JSON.stringify(recompiled.errors)}`);
      sessionId = recompiled.sessionId;
      completed.recompiled = recompiled;
      const recompiledRequest = { ...preparedRun.runRequest, sessionId };
      phase = 'run_recompiled_session';
      const afterRecompile = await client.run(recompiledRequest);
      completed.afterRecompile = afterRecompile;
      if (JSON.stringify(afterRecompile) !== baselineJson) throw new Error('释放后同Worker重新编译运行的完整done不同');
      phase = 'release_recompiled_session';
      const finalRelease = await client.release(sessionId, prepared.compileRequest.rulesHash);
      sessionId = undefined;
      client.terminate();
      return { prepared, request: preparedRun.runRequest, compiled, baseline: baseline!, last: last!, repeatChecks,
        repeatsElapsedMs, firstRelease, liveWorkerAfterFirstRelease, recompiled, recompiledRequest, afterRecompile,
        finalRelease, runCount: repeatChecks.length + 1, liveWorker: client.hasLiveWorker };
    } catch (error) {
      return { failure: { phase, message: error instanceof Error ? error.message : String(error), prepared, completed },
        liveWorker: client.hasLiveWorker };
    } finally {
      try {
        if (sessionId && client.hasLiveWorker) await client.release(sessionId, prepared.compileRequest.rulesHash);
      } finally { client.terminate(); }
    }
  }, { snapshot, scenario });
}

function assertDamageAndHealth(snapshot: SimulationSnapshot, input: CompileRequest, done: DoneResult, primaryAbilityRef: string,
  scenario: CombinationScenario, single = false) {
  const rows = done.damageRecords!;
  const hits = done.attackRecords?.filter(attack => attack.hitAtMs !== null) ?? [];
  const hitCount = single ? 1 : hits.length;
  const expectedLinkedAttacks = hits.filter(attack => attack.attackIndex >= 7 && (attack.attackIndex - 7) % 3 === 0).map(attack => attack.attackIndex);
  if (!single) expect(hits).toHaveLength(done.summary.basicAttack!.hitCount);
  expect(rows.length).toBeGreaterThan(0);
  if (done.recording) expect(done.recording.damageRecordsTruncated).toBe(false);
  const ghost = configuration(snapshot, 'item_3124_passive');
  const ghostLinkedRules = ghost.triggerRules.filter(rule => rule.eventSource.eventType === 'HIT_LINK_APPLIED').map(rule => rule.ruleKey);
  const linkedGhost = rows.filter(row => ghostLinkedRules.some(key => row.abilityRef.endsWith(`.ability[${key}]`)) && row.operationRef.includes('item_3124_passive'));
  expect(linkedGhost.map(row => row.attackIndex)).toEqual(expectedLinkedAttacks);
  if (!single && scenario.targetInitialHp === undefined) expect(expectedLinkedAttacks.length, '普通组合必须实际越过第7击').toBeGreaterThan(0);
  const botrkRows = rows.filter(row => row.operationRef.includes('skills.item_3153_passive.effects.on_hit_damage_'));
  const wisdomRows = rows.filter(row => row.operationRef.includes('skills.item_3091_passive.effects.on_hit_damage.'));
  for (const item of ['item_3153', 'item_3091']) if (scenario.source.includes(item)) {
    const itemRows = item === 'item_3153' ? botrkRows : wisdomRows;
    const config = configuration(snapshot, `${item}_passive`);
    const linkedKeys = config.triggerRules.filter(rule => rule.eventSource.eventType === 'HIT_LINK_APPLIED').map(rule => rule.ruleKey);
    expect(itemRows).toHaveLength(hitCount + expectedLinkedAttacks.length);
    expect(itemRows.filter(row => linkedKeys.some(key => row.abilityRef.endsWith(`.ability[${key}]`))).map(row => row.attackIndex)).toEqual(expectedLinkedAttacks);
    for (const attack of hits) expect(itemRows.filter(row => row.attackIndex === attack.attackIndex)).toHaveLength(expectedLinkedAttacks.includes(attack.attackIndex) ? 2 : 1);
  }
  const reflected = rows.filter(row => row.operationRef.includes('skills.item_3075_passive.effects.thorn_damage.'));
  expect(reflected).toHaveLength(scenario.target.includes('item_3075') ? hitCount : 0);
  expect(rows.filter(row => row.abilityRef === primaryAbilityRef)).toHaveLength(hitCount);
  const source = input.combatants.find(combatant => combatant.key === 'source')!;
  const target = input.combatants.find(combatant => combatant.key === 'target')!;
  const current = { source: source.attributes.hp!.current!, target: target.attributes.hp!.current! };
  const maxima = { source: source.attributes.hp!.max!, target: target.attributes.hp!.max! };
  const healing = { source: 0, target: 0 };
  const losses = { source: 0, target: 0 };
  const reduction = scenario.target.includes('item_3075') ? fixedParameter(configuration(snapshot, 'item_3075_passive'), 'grievous_amount') : 0;
  const vampRows = done.evidence.items.filter(item => item.kind === 'vamp');
  const damageOrder: Array<{ attackIndex: number; damageId: number; timeMs: number; operationRef: string; abilityRef: string; rawAmount: number; hpBefore: number; hpAfter: number }> = [];
  for (const [index, row] of rows.entries()) {
    expect(row.damageId).toBeGreaterThan(index ? rows[index - 1]!.damageId : 0);
    expect(row.timeMs).toBeGreaterThanOrEqual(index ? rows[index - 1]!.timeMs : 0);
    expect(row.source === 'source' && row.target === 'target' || row.source === 'target' && row.target === 'source').toBe(true);
    const sourceSide = row.source as 'source' | 'target';
    const targetSide = row.target as 'source' | 'target';
    expect(row.hpBefore).toBeCloseTo(current[targetSide], 8);
    expect(row.sourceHpBefore).toBeCloseTo(current[sourceSide], 8);
    expect(row.shieldAbsorbed).toBe(0);
    const hpLoss = Math.min(row.hpBefore, row.postDefenseDamage);
    expect(row.actualHpLoss).toBeCloseTo(hpLoss, 8);
    expect(row.hpAfter).toBeCloseTo(row.hpBefore - hpLoss, 8);
    expect(row.overkillDamage).toBeCloseTo(Math.max(0, row.postDefenseDamage - row.hpBefore), 8);
    if (botrkRows.includes(row)) {
      const branch = scenario.meleeAttack === 1 ? 'melee' : 'ranged';
      expect(row.operationRef).toContain(`on_hit_damage_${branch}`);
      expect(row.rawAmount).toBeCloseTo(row.hpBefore * fixedParameter(configuration(snapshot, 'item_3153_passive'), `on_hit_damage_ratio_${branch}`), 8);
    }
    if (wisdomRows.includes(row)) expect(row.rawAmount).toBe(45);
    current[targetSide] = row.hpAfter;
    losses[targetSide] += hpLoss;
    const { config, result } = damageDefinition(snapshot, row);
    let vampBefore = 0;
    if (row.hpBefore > 0 && current[sourceSide] > 0 && hpLoss > 0) for (const rule of snapshot.catalogs.vampRules.rules) {
      const override = result.detail.vampOverrides.find(item => item.vampType === rule.vampType);
      if (override?.mode === 'DISABLED') continue;
      if (!override && !(rule.deliveryKinds.includes(result.detail.deliveryKind) && rule.originKinds.includes(result.detail.originKind)
        && rule.skillCategoryKeys.some(category => config.skill.skillCategoryKeys.includes(category)))) continue;
      const basisKind = override?.basisOutputKind ?? rule.basisOutputKind;
      const efficiency = override ? numericValue(config, override.efficiencyValue) : rule.defaultEfficiency;
      const ratio = (sourceSide === 'source' ? source : target).attributes[rule.sourceAttributeKey]!.resolved!;
      vampBefore += (basisKind === 'POST_DEFENSE_DAMAGE' ? row.postDefenseDamage : hpLoss) * ratio * efficiency;
    }
    const vampAfter = vampBefore * (sourceSide === 'source' ? 1 - reduction : 1);
    const actualHealing = Math.min(maxima[sourceSide] - current[sourceSide], vampAfter);
    current[sourceSide] += actualHealing;
    healing[sourceSide] += actualHealing;
    expect(row.sourceHpAfter).toBeCloseTo(current[sourceSide], 8);
    const vampEvidence = vampRows.filter(item => item.data?.damageId === row.damageId);
    expect(vampEvidence).toHaveLength(1);
    expect(vampEvidence[0]!.data!.healingBeforeModifiers).toBeCloseTo(vampBefore, 8);
    expect(vampEvidence[0]!.data!.healingAfterModifiers).toBeCloseTo(vampAfter, 8);
    expect(vampEvidence[0]!.data!.actualHealing).toBeCloseTo(actualHealing, 8);
    damageOrder.push({ attackIndex: row.attackIndex, damageId: row.damageId, timeMs: row.timeMs,
      operationRef: row.operationRef, abilityRef: row.abilityRef, rawAmount: row.rawAmount, hpBefore: row.hpBefore, hpAfter: row.hpAfter });
  }
  for (const attack of hits) {
    const damage = rows.filter(row => row.attackIndex === attack.attackIndex);
    const primary = damage.filter(row => row.abilityRef === primaryAbilityRef);
    expect(primary).toHaveLength(1);
    if (scenario.target.includes('item_3075')) {
      expect(damage[0]!.operationRef).toContain('item_3075_passive.effects.thorn_damage');
      expect(damage[0]!.source).toBe('target');
      expect(damage[0]!.target).toBe('source');
      expect(damage[1]!).toBe(primary[0]);
    } else expect(damage[0]!).toBe(primary[0]);
    expect(attack.sourceHpAfter).toBeCloseTo(damage[damage.length - 1]!.source === 'source'
      ? damage[damage.length - 1]!.sourceHpAfter! : damage[damage.length - 1]!.hpAfter, 8);
  }
  expect(done.summary.sourceFinalHp).toBeCloseTo(current.source, 8);
  expect(done.summary.targetFinalHp).toBeCloseTo(current.target, 8);
  if (!single || done.summary.sourceHpLoss !== undefined) expect(done.summary.sourceHpLoss).toBeCloseTo(losses.source, 8);
  if (!single || done.summary.targetHpLoss !== undefined) expect(done.summary.targetHpLoss).toBeCloseTo(losses.target, 8);
  if (!single || done.summary.sourceVampHealing !== undefined) expect(done.summary.sourceVampHealing).toBeCloseTo(healing.source, 8);
  if (!single || done.summary.targetVampHealing !== undefined) expect(done.summary.targetVampHealing).toBeCloseTo(healing.target, 8);
  return { recordFields: { raw: 'rawAmount', targetHpPre: 'hpBefore' }, expectedLinkedAttacks,
    botrkCount: botrkRows.length, wisdomCount: wisdomRows.length, reflectedCount: reflected.length,
    current, healing, losses, firstReactionReduction: reduction, damageOrder };
}

function assertBotrkCounter(snapshot: SimulationSnapshot, input: CompileRequest, done: DoneResult) {
  const config = configuration(snapshot, 'item_3153_passive');
  const cooldown = fixedParameter(config, 'slow_cooldown_ms');
  const duration = fixedParameter(config, 'slow_duration_ms');
  const threshold = fixedParameter(config, 'slow_attack_threshold');
  const root = input.sharedProviders!.find(provider => provider.providerKey === 'source_item_3153_passive_definition')!;
  expect(root.initialStateSchema!.champion_hits).toMatchObject({ defaultValue: 0, maxValue: threshold, durationMs: 0 });
  expect(root.initialStateSchema!.slow_cooldown).toMatchObject({ defaultValue: 0, maxValue: 1, durationMs: cooldown });
  expect(Object.values(root.initialStateSchema!).filter(field => typeof field === 'object' && field.durationMs === 6000)).toEqual([]);
  const slow = input.sharedProviders!.find(provider => provider.statusContributions?.some(contribution => contribution.statusKey === 'movement_slow'))!;
  expect(slow).toBeDefined();
  expect(slow.stableId).toBe(root.stableId);
  expect(slow.lifecycle).toMatchObject({ durationMs: { op: 'const', value: duration }, maxStacks: 1, instanceScope: 'source_target' });
  expect(slow.abilities).toBeUndefined();
  expect(slow.listeners).toBeUndefined();
  expect(slow.modifiers).toBeUndefined();
  let count = 0;
  let cooldownUntil = 0;
  const expectedProcs: number[] = [];
  for (const attack of done.attackRecords!.filter(row => row.hitAtMs !== null)) {
    if (attack.hitAtMs! < cooldownUntil) continue;
    count++;
    if (count >= threshold) {
      expectedProcs.push(attack.hitAtMs!);
      count = 0;
      cooldownUntil = attack.hitAtMs! + cooldown;
    }
  }
  const slowEvents = done.evidence.items.filter(item => item.data?.definitionRef === slow.providerKey);
  const applications = slowEvents.filter(item => item.kind === 'provider_apply' || item.kind === 'provider_refresh');
  expect(applications.map(item => item.timeMs)).toEqual(expectedProcs);
  for (const item of applications) {
    expect(item.data).toMatchObject({ source: 'source', owner: 'target', expireAt: item.timeMs + duration,
      statusContributions: [expect.objectContaining({ statusKind: 'movement_slow', strength: fixedParameter(config, 'slow_ratio') })] });
    if (item.timeMs + duration <= done.summary.durationMs) expect(slowEvents.some(event => event.kind === 'provider_expire' && event.timeMs === item.timeMs + duration)).toBe(true);
  }
  const actor = done.finalSnapshot.combatants.find(combatant => combatant.key === 'source')!;
  const stateBag = object(actor.providerState.source_item_3153_passive);
  const state = object(stateBag.state);
  expect(state.champion_hits).toBe(count);
  expect(state.slow_cooldown).toBe(cooldownUntil > done.summary.durationMs ? 1 : 0);
  if (cooldownUntil > done.summary.durationMs) expect(object(stateBag.expireAt).slow_cooldown).toBe(cooldownUntil);
  return { expectedProcs, duration, cooldown, cooldownUntil, finalCount: count, events: slowEvents };
}

function assertCooldownProbes(done: DoneResult, probes: CooldownProbe[], cooldownMs: number, threshold: number, request: RunRequest) {
  const hits = done.attackRecords!.filter(attack => attack.hitAtMs !== null);
  const timeline = probes.map(probe => {
    let count = 0;
    let cooldownUntil = 0;
    const precedingHits = hits.filter(attack => attack.hitAtMs! <= probe.timeMs);
    for (const attack of precedingHits) {
      if (attack.hitAtMs! < cooldownUntil) continue;
      count++;
      if (count >= threshold) {
        count = 0;
        cooldownUntil = attack.hitAtMs! + cooldownMs;
      }
    }
    const actor = probe.done.finalSnapshot.combatants.find(combatant => combatant.key === 'source')!;
    const bag = object(actor.providerState.source_item_3153_passive);
    const state = object(bag.state);
    const active = probe.timeMs < cooldownUntil;
    expect(probe.done.summary.execution!.complete).toBe(true);
    expect(probe.request.sessionId).toBe(request.sessionId);
    expect(probe.request.initialSnapshot).toEqual(request.initialSnapshot);
    expect(probe.request.sampling).toEqual(request.sampling);
    expect(probe.request.recordBudget).toEqual(request.recordBudget);
    expect(probe.done.recording).toMatchObject({ attackRecordsTruncated: false, damageRecordsTruncated: false });
    expect(probe.done.summary.durationMs).toBe(probe.timeMs);
    expect(probe.done.summary.basicAttack!.hitCount).toBe(precedingHits.length);
    expect(state.champion_hits, `时刻${probe.timeMs}的真实来源计数`).toBe(count);
    expect(state.slow_cooldown, `时刻${probe.timeMs}的真实内部冷却`).toBe(active ? 1 : 0);
    if (active) expect(object(bag.expireAt).slow_cooldown).toBe(cooldownUntil);
    if (probe.reasons.includes('cooldown_hit')) expect(state.champion_hits).toBe(0);
    return { timeMs: probe.timeMs, reasons: probe.reasons, hitCount: precedingHits.length,
      actualCount: state.champion_hits, actualCooldown: state.slow_cooldown, expectedCount: count, cooldownUntil };
  });
  const beforeReady = timeline.find(probe => probe.reasons.includes('before_ready'))!;
  const ready = timeline.find(probe => probe.reasons.includes('ready'))!;
  expect(beforeReady).toBeDefined();
  expect(ready).toBeDefined();
  expect(beforeReady.actualCooldown).toBe(1);
  expect(ready.actualCooldown).toBe(0);
  expect(ready.timeMs).toBe(beforeReady.timeMs + 1);
  return timeline;
}

for (const scenario of scenarios) test(`4C真实组合补验 ${scenario.name}`, async ({ page, request }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要主负责人确认最终Wasm后开启真实只读服务');
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  const snapshot = await readSnapshot(request, scenario);
  const browserConsoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') browserConsoleErrors.push(message.text()); });
  await page.goto('/');
  const servedResponse = await page.request.get('/src/engine/wasm/tinygo_engine_v2.wasm');
  expect(servedResponse.status()).toBe(200);
  const servedBytes = await servedResponse.body();
  expect(createHash('sha256').update(servedBytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  let workerCount = 0;
  page.on('worker', () => { workerCount++; });
  const result = await runCombination(page, snapshot, scenario);
  saveArtifact(scenario.name, { wasm: WASM_IDENTITY, servedBytes: servedBytes.length, workerCount, snapshot, result,
    browserConsoleErrors, consoleScope: '只记录实际页面console error；本例通过Worker运行，未渲染作者覆盖表格' });
  if ('failure' in result) {
    const failure = result.failure!;
    await testInfo.attach('真实工作线程失败阶段', { body: JSON.stringify(result), contentType: 'application/json' });
    throw new Error(`真实Worker ${failure.phase}失败：${failure.message}`);
  }
  expect(workerCount).toBe(1);
  await expect.poll(() => page.workers().length).toBe(0);
  expect(result.done.summary.execution!.complete).toBe(true);
  expect(result.repeated).toEqual(result.done);
  expect(result.truncated.summary).toEqual(result.done.summary);
  expect(result.truncated.finalSnapshot).toEqual(result.done.finalSnapshot);
  expect(result.truncated.series).toEqual(result.done.series);
  expect(result.truncated.attackRecords).toEqual([]);
  expect(result.truncated.damageRecords).toEqual([]);
  expect(result.truncated.recording).toMatchObject({ returnedAttackRecords: 0, returnedDamageRecords: 0,
    attackRecordsTruncated: true, damageRecordsTruncated: true });
  expect(result.release).toMatchObject({ ok: true, released: true });
  expect(result.liveWorker).toBe(false);
  const continuousOracle = assertDamageAndHealth(snapshot, result.prepared.compileRequest, result.done,
    result.prepared.basicAttackBinding.hitAbilityRef, scenario);
  const singleOracle = assertDamageAndHealth(snapshot, result.prepared.compileRequest, result.single,
    result.prepared.basicAttackBinding.hitAbilityRef, scenario, true);
  const counterOracle = scenario.source.includes('item_3153') ? assertBotrkCounter(snapshot, result.prepared.compileRequest, result.done) : null;
  const cooldownTimeline = scenario.verifyCooldownBoundary && counterOracle
    ? assertCooldownProbes(result.done, result.cooldownProbes, counterOracle.cooldown,
      fixedParameter(configuration(snapshot, 'item_3153_passive'), 'slow_attack_threshold'), result.request) : null;
  if (result.slowBoundary) {
    const { thirdHitAtMs, beforeExpiry, atExpiry } = result.slowBoundary;
    const beforeTarget = beforeExpiry.finalSnapshot.combatants.find(combatant => combatant.key === 'target')!;
    const afterTarget = atExpiry.finalSnapshot.combatants.find(combatant => combatant.key === 'target')!;
    const strength = fixedParameter(configuration(snapshot, 'item_3153_passive'), 'slow_ratio');
    expect(beforeExpiry.summary.durationMs).toBe(thirdHitAtMs + 999);
    expect(atExpiry.summary.durationMs).toBe(thirdHitAtMs + 1000);
    expect(beforeTarget.effectiveStatuses).toEqual([expect.objectContaining({ statusKind: 'movement_slow', strength,
      contributions: [expect.objectContaining({ source: 'source', expireAt: thirdHitAtMs + 1000, strength })] })]);
    expect(afterTarget.effectiveStatuses ?? []).toEqual([]);
    const initialTargetSpeed = result.prepared.compileRequest.combatants.find(combatant => combatant.key === 'target')!.attributes.attack_speed!.resolved;
    expect(beforeTarget.attributes.attack_speed!.resolved).toBe(initialTargetSpeed);
    expect(afterTarget.attributes.attack_speed!.resolved).toBe(initialTargetSpeed);
    for (const boundary of [beforeExpiry, atExpiry]) {
      const sourceState = object(object(boundary.finalSnapshot.combatants.find(combatant => combatant.key === 'source')!
        .providerState.source_item_3153_passive).state);
      expect(sourceState).toMatchObject({ champion_hits: 0, slow_cooldown: 1 });
      for (const attack of boundary.attackRecords!.filter(row => row.hitAtMs !== null)) {
        const fullAttack = result.done.attackRecords!.find(row => row.attackIndex === attack.attackIndex)!;
        expect({ start: attack.startAtMs, hit: attack.hitAtMs, speed: attack.attackSpeed })
          .toEqual({ start: fullAttack.startAtMs, hit: fullAttack.hitAtMs, speed: fullAttack.attackSpeed });
      }
    }
  }
  const oracle = { continuous: continuousOracle, single: singleOracle, counter: counterOracle, cooldownTimeline };
  saveArtifact(`${scenario.name}-oracle`, oracle);
  await testInfo.attach('真实逐笔独立数学与最终工作线程', { body: JSON.stringify({ wasm: WASM_IDENTITY, oracle, result }), contentType: 'application/json' });
  expect(result.singleAssessment.issues).toEqual([]);
  expect(result.assessment.issues).toEqual([]);
  expect(result.truncatedAssessment.issues).toEqual([]);
  if (scenario.verifyCooldownBoundary) {
    expect(result.cooldownProbes).toHaveLength(19);
    expect(result.runTrace.length).toBeGreaterThanOrEqual(25);
    expect([...new Set(result.runTrace.map(run => run.sessionId))]).toEqual([result.compiled.sessionId]);
    expect(result.prepared.equipmentAssumptions).toEqual([{ owner: 'target', equipmentKey: 'item_3110', target: 'source', inRange: true }]);
    expect(counterOracle!.expectedProcs.length, `真实停止原因${result.done.summary.stopReason}，不能伪造生命延长观察`).toBeGreaterThanOrEqual(2);
    expect(counterOracle!.expectedProcs[1]!).toBeGreaterThanOrEqual(counterOracle!.expectedProcs[0]! + counterOracle!.cooldown);
  }
  if (scenario.targetInitialHp !== undefined) {
    expect(result.done.summary.execution!.targetKilled).toBe(true);
    expect(result.done.summary.targetFinalHp).toBe(0);
    expect(result.done.summary.durationMs).toBeLessThan(scenario.durationMs);
    const killedAt = result.done.summary.execution!.targetKilledAtMs!;
    expect(result.done.damageRecords!.every(row => row.timeMs <= killedAt)).toBe(true);
    expect(result.done.attackRecords!.every(row => row.startAtMs <= killedAt)).toBe(true);
  }
});

test('4C真实组合补验 melee_attack缺值拒绝且不读取英雄名或距离', async ({ page, request }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要真实完整快照');
  const snapshot = await readSnapshot(request, { ...scenarios[0]!, name: 'missing_melee_attack' });
  await page.goto('/');
  const rejection = await page.evaluate(async snapshot => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const equipmentPath = '/src/engine/simulationEquipment.ts';
    const { inspectSimulationSnapshot, assembleSimulation } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { simulationHealthLimit } = await import(equipmentPath) as typeof import('../../src/engine/simulationEquipment');
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined && row.attribute.attributeKey !== 'melee_attack') {
      inputs[row.side][row.attribute.attributeKey] = row.attribute.attributeKey === 'attack_speed_ratio' ? .651 : 0;
    }
    try {
      assembleSimulation(snapshot, inputs, { source: simulationHealthLimit(snapshot, 'source')!, target: simulationHealthLimit(snapshot, 'target')! });
      return { rejected: false, message: '', inputs };
    } catch (error) { return { rejected: true, message: error instanceof Error ? error.message : String(error), inputs }; }
  }, snapshot);
  saveArtifact('missing_melee_attack-rejection', { snapshotDigest: snapshot.snapshotDigest, rejection });
  expect(rejection.rejected).toBe(true);
  expect(rejection.message).toContain('attributeInputs.source.melee_attack');
  expect(rejection.inputs.source.melee_attack).toBeUndefined();
});

test('4C真实组合补验 同Worker100次完整30秒运行与释放后重编译', async ({ page, request }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要主负责人确认最终Wasm后开启真实只读服务');
  const scenario: CombinationScenario = { name: 'same_worker_100_complete_runs', source: ['item_3153', 'item_3124'],
    target: ['item_3075', 'item_3110'], durationMs: 30000, meleeAttack: 1 };
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  const snapshot = await readSnapshot(request, scenario);
  const browserConsoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') browserConsoleErrors.push(message.text()); });
  await page.goto('/');
  const servedResponse = await page.request.get('/src/engine/wasm/tinygo_engine_v2.wasm');
  expect(servedResponse.status()).toBe(200);
  const servedBytes = await servedResponse.body();
  expect(servedBytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(servedBytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  let workerCount = 0;
  page.on('worker', () => { workerCount++; });
  const result = await runCompleteRepeats(page, snapshot, scenario);
  saveArtifact(scenario.name, { wasm: WASM_IDENTITY, servedBytes: servedBytes.length, workerCount, snapshot, result,
    browserConsoleErrors, consoleScope: '真实Worker压力运行，未渲染作者覆盖表格' });
  if ('failure' in result) {
    const failure = result.failure!;
    await testInfo.attach('同Worker100次运行失败阶段', { body: JSON.stringify(result), contentType: 'application/json' });
    throw new Error(`真实Worker ${failure.phase}失败：${failure.message}`);
  }
  expect(workerCount).toBe(1);
  await expect.poll(() => page.workers().length).toBe(0);
  expect(result.repeatChecks).toHaveLength(100);
  expect(result.repeatChecks.map(check => check.runIndex)).toEqual(Array.from({ length: 100 }, (_value, index) => index + 1));
  expect(result.repeatChecks.every(check => check.identical)).toBe(true);
  expect([...new Set(result.repeatChecks.map(check => check.sessionId))]).toEqual([result.compiled.sessionId]);
  expect(result.runCount).toBe(101);
  expect(result.request.stopPolicy.durationMs).toBe(30000);
  expect(result.request.sampling).toMatchObject({ disabled: false, sampleEveryMs: 100, maxSeriesPoints: 5000 });
  expect(result.request.recordBudget).toEqual({ maxAttackRecords: 1000, maxDamageRecords: 2000, maxMechanicRecords: 2000 });
  expect(result.baseline.recording).toMatchObject({ attackRecordsTruncated: false, damageRecordsTruncated: false });
  expect(result.baseline.summary.execution!.complete).toBe(true);
  expect(result.last).toEqual(result.baseline);
  expect(result.afterRecompile).toEqual(result.baseline);
  expect(result.firstRelease).toMatchObject({ ok: true, released: true, sessionId: result.compiled.sessionId });
  expect(result.liveWorkerAfterFirstRelease).toBe(true);
  expect(result.finalRelease).toMatchObject({ ok: true, released: true, sessionId: result.recompiled.sessionId });
  expect(result.liveWorker).toBe(false);
  expect(result.prepared.equipmentAssumptions).toEqual([{ owner: 'target', equipmentKey: 'item_3110', target: 'source', inRange: true }]);
  const damageOracle = assertDamageAndHealth(snapshot, result.prepared.compileRequest, result.baseline,
    result.prepared.basicAttackBinding.hitAbilityRef, scenario);
  const counterOracle = assertBotrkCounter(snapshot, result.prepared.compileRequest, result.baseline);
  expect(counterOracle.expectedProcs.length).toBeGreaterThanOrEqual(2);
  const oracle = { damage: damageOracle, counter: counterOracle, workerCount, runCount: result.runCount,
    repeatCount: result.repeatChecks.length, repeatsElapsedMs: result.repeatsElapsedMs };
  saveArtifact(`${scenario.name}-oracle`, oracle);
  await testInfo.attach('同Worker100次完整运行、释放与重编译', { body: JSON.stringify({ wasm: WASM_IDENTITY, oracle, result }), contentType: 'application/json' });
});
