import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadMechanismCases, MECHANISM_ROOT } from './mechanismCase';
import { mechanismEngine } from './mechanismRunner';
import { projectRestorations } from './restorationProjection';
import { prepareSimulation } from '../../src/engine/simulationAdapter';
import { simulationAutomaticCastCosts } from '../../src/engine/simulationActiveSkills';
import { preflightSkillFormulas } from '../../src/engine/skillFormulaPreflight';
import { skillActionRequest } from '../../src/engine/skillActionRequest';
import { simulationHash } from '../../src/engine/simulationHash';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import type { GenericEngineClient } from '../../src/engine/genericEngineClient';
import type { CompileRequest, RunRequest } from '../../src/types/genericEngine';

// 首次运行前固定；初始法盾只属于Generic协议，不声明生产作者初始法盾能力。
const EXPECTED = {
  durationMs: 751, sourceInitialHp: 1000, targetInitialHp: 500, sourceFinalHp: 1000, targetFinalHp: 670,
  damage: [[250, 'physics', 10, 500, 490], [250, 'magic', 10, 590, 580], [750, 'physics', 10, 580, 570]],
  healing: [[250, 100, 490, 590], [750, 100, 570, 670]],
  shieldBlockedAtMs: 500, sourceDamage: 30, targetDirectHealing: 200, attackStarts: [250]
} as const;
const SHIELD = 'hit_healing_protocol_shield';
const OUT = fileURLToPath(new URL('../../../output/skill-adaptation-20261023-varus/e-shield-protocol-draft/', import.meta.url));
const operationAt = (value: unknown, path: string): Record<string, unknown> | undefined => {
  let current = value;
  for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as Record<string, unknown> | undefined;
};

describe('真实HIT有限减疗的独立Generic初始法盾协议', () => {
  it('保留Generic盾只核E判盾，两个治疗保持100，后台普攻及重放释放完整；不声明一次消费', async () => {
    mkdirSync(OUT, { recursive: true });
    const folder = mkdtempSync(resolve(OUT, 'runtime-'));
    const archive: Record<string, unknown> = { expected: EXPECTED, boundary: 'Generic判盾及后台普攻；无消费listener，初始一次消费不在本场准入', consumptionVerified: false,
      calls: { formulaCompiles: 0, formulaReleases: 0, battleCompiles: 0, battleRuns: 0, battleReleases: 0 } };
    const calls = archive.calls as Record<string, number>;
    const { client, wasmSha256, wasmBytes } = await mechanismEngine();
    archive.wasm = { wasmSha256, wasmBytes };
    let sessionId: string | null = null, rulesHash: string | undefined;
    try {
      expect({ sha256: wasmSha256, bytes: wasmBytes }).toEqual(WASM_IDENTITY);
      const definition = loadMechanismCases().find(row => row.caseKey === 'hit_healing_modifier_present');
      if (!definition) throw Error('缺少冻结的有限命中减疗基础场景');
      const caseBytes = readFileSync(resolve(MECHANISM_ROOT, 'cases/hit_healing_modifier_present.json'));
      archive.definitionSha256 = createHash('sha256').update(caseBytes).digest('hex');
      const snapshot = definition.buildSnapshot(), scenario = definition.scenario;
      expect(scenario.durationMs).toBe(EXPECTED.durationMs);
      const formulaReceipts: unknown[] = [];
      const proofClient = {
        get hasLiveWorker() { return true; },
        async compile(request: CompileRequest) {
          calls.formulaCompiles++; const result = await client.compile(request);
          formulaReceipts.push({ kind: 'compile', request: structuredClone(request), result }); return result;
        },
        async release(id: string, hash?: string) {
          calls.formulaReleases++; const result = await client.release(id, hash);
          formulaReceipts.push({ kind: 'release', sessionId: id, expectedRulesHash: hash, result }); return result;
        }
      } as unknown as GenericEngineClient;
      archive.formulaReceipts = formulaReceipts;
      archive.formulaProof = await preflightSkillFormulas(snapshot, proofClient, () => true, scenario.sceneParameterInputs ?? []);
      const prepared = await prepareSimulation(snapshot, structuredClone(scenario.attributeInputs ?? { source: {}, target: {} }),
        scenario.initialHealth, scenario.equipmentAssumptions ?? [], scenario.mechanicStateInputs ?? [], simulationAutomaticCastCosts(snapshot),
        scenario.sceneParameterInputs ?? [], scenario.initialResourceInputs ?? []);
      const built = await skillActionRequest(prepared, snapshot, { durationMs: scenario.durationMs, recordTimeSeries: false,
        attackSpeedInputMax: scenario.attackSpeedInputMax ?? 10, actions: scenario.actions ?? [],
        maxSkillActionRecords: 1000, maxSkillUseRecords: 1000, maxHealingRecords: 1000, maxResourceChangeRecords: 1000 }, 'NOT_A_RUNTIME_SESSION');
      const input = structuredClone(prepared.compileRequest);
      const request: RunRequest = { ...built.runRequest, runtimeOptions: { ...built.runRequest.runtimeOptions,
        equipmentAssumptions: prepared.equipmentAssumptions, skillOrigins: prepared.skillOrigins, mechanicStateInputs: prepared.mechanicStateInputs } };
      archive.prepared = prepared;
      expect(request.driverPlan.entries).toEqual([]);
      for (const key of ['skillUses', 'skillHitFacts', 'attackStartFacts', 'processCommandFacts'] as const) expect(request[key] ?? []).toEqual([]);
      expect(request.driverPlan.basicAttack).toBeDefined();
      for (const [key, domain] of [['provider/spell_shield', 'provider'], ['event/spell_shield_blocked', 'event']]) {
        if (!input.typeCatalog.types.some(row => row.key === key && row.domain === domain)) input.typeCatalog.types.push({ key, domain });
      }
      input.sharedProviders!.push({ providerKey: SHIELD, stableId: SHIELD, kind: 'character', types: ['provider/spell_shield'] });
      input.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: SHIELD, definitionRef: SHIELD });
      request.initialSnapshot.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: SHIELD, definitionRef: SHIELD,
        owner: 'target', source: 'target', stacks: 1, expireAt: null, state: {} });
      input.rulesHash = await simulationHash({ boundary: 'finite-hit-healing-initial-shield-protocol', compile: { ...input, rulesHash: '' } });
      rulesHash = input.rulesHash;
      request.rulesHash = request.expectedRulesHash = request.initialSnapshot.rulesHash = rulesHash;
      archive.compileRequest = input; archive.runRequest = request;
      calls.battleCompiles++; const compiled = await client.compile(input); archive.compiled = compiled;
      if (!compiled.ok || !compiled.sessionId) throw Error('Generic法盾编译失败：' + JSON.stringify(compiled.errors));
      sessionId = request.sessionId = compiled.sessionId;
      calls.battleRuns++; const done = await client.run(request); archive.done = done;
      calls.battleRuns++; const repeated = await client.run(request); archive.repeated = repeated;
      expect(isDeepStrictEqual(repeated, done)).toBe(true);
      expect(done.ok).toBe(true); expect(done.summary.stopReason).toBe('duration_reached');
      expect(done.summary.durationMs).toBe(EXPECTED.durationMs);
      expect(done.summary.execution).toMatchObject({ complete: true, budgetCause: null, targetKilled: false });
      expect(done.evidence.truncated).toBe(false);
      if (done.summary.evidenceTruncated !== undefined) expect(done.summary.evidenceTruncated).toBe(false);
      for (const key of ['attackRecordsTruncated', 'damageRecordsTruncated', 'skillActionRecordsTruncated', 'skillUseRecordsTruncated',
        'healingRecordsTruncated', 'mechanicRecordsTruncated'] as const) expect(done.recording?.[key]).toBe(false);
      if (done.recording?.resourceChangeRecordsTruncated !== undefined) expect(done.recording.resourceChangeRecordsTruncated).toBe(false);
      expect(done.summary.sourceDamageDealt).toBe(EXPECTED.sourceDamage);
      expect(done.summary.targetHpLoss).toBe(EXPECTED.sourceDamage);
      expect(done.summary.sourceFinalHp).toBe(EXPECTED.sourceFinalHp); expect(done.summary.targetFinalHp).toBe(EXPECTED.targetFinalHp);
      expect([done.summary.sourceDirectHealing, done.summary.targetDirectHealing, done.summary.sourceVampHealing, done.summary.targetVampHealing]).toEqual([0, 200, 0, 0]);
      expect(done.summary.basicAttack).toMatchObject({ startedCount: 1, hitCount: 1, completedCount: 1 });
      expect(done.summary.skillUses).toMatchObject({ startedCount: 3, releasedCount: 3, hitCount: 3, completedCount: 3, failedCount: 0, inFlightCount: 0 });
      const actors = Object.fromEntries(done.finalSnapshot.combatants.map(row => [row.key, row]));
      for (const [side, hp] of [['source', 1000], ['target', 670]] as const) {
        expect(actors[side].resources).toEqual({}); expect(actors[side].shields).toEqual([]);
        expect(actors[side].attributes.hp).toMatchObject({ base: 1000, current: hp, max: 1000 });
      }
      expect(done.resourceChangeRecords ?? []).toEqual([]); expect(done.mechanicRecords ?? []).toEqual([]);
      const events = done.evidence.items;
      const starts = events.filter(row => row.kind === 'emitted_event' && row.ref === 'event/ability_started'
        && ['lab_transfer', 'lab_small_hit'].includes(String(row.data?.skillKey)));
      expect(starts.map(row => [row.timeMs, row.data?.skillKey, row.data?.useRef])).toEqual([
        [0, 'lab_transfer', 'skill:wound_0'], [250, 'lab_small_hit', 'skill:probe_0'], [750, 'lab_small_hit', 'skill:probe_1']]);
      expect(new Set(starts.map(row => row.data?.castInstanceId)).size).toBe(3);
      for (const row of starts) {
        expect([row.data?.source, row.data?.owner, row.data?.target, row.data?.phaseKind]).toEqual(['source', 'source', 'target', 'INITIAL']);
        expect(Number.isSafeInteger(row.data?.castInstanceId) && Number(row.data?.castInstanceId) > 0).toBe(true);
      }
      const damage = done.damageRecords ?? [];
      expect(new Set(damage.map(row => row.damageId)).size).toBe(3);
      expect(damage.map(row => [row.timeMs, row.damageType, row.rawAmount, row.hpBefore, row.hpAfter])).toEqual(EXPECTED.damage);
      for (const row of damage) {
        expect([row.owner, row.source, row.target, row.postDefenseDamage, row.actualHpLoss, row.shieldAbsorbed, row.overkillDamage])
          .toEqual(['source', 'source', 'target', 10, 10, 0, 0]);
        const origins = prepared.operationOrigins.filter(origin => origin.abilityRef === row.abilityRef && origin.operationRef === row.operationRef);
        expect(origins).toHaveLength(1); expect(origins[0].compiledPaths).toContain(row.operationPath);
        expect(origins[0].skillKey).toBe(row.damageType === 'magic' ? 'lab_basic_attack' : 'lab_small_hit');
        expect(row.useRef).toBe(row.damageType === 'magic' ? 'basic:selected_basic_attack_plan:1' : row.timeMs === 250 ? 'skill:probe_0' : 'skill:probe_1');
        expect(Number.isSafeInteger(row.damageId) && row.damageId > 0 && Number.isSafeInteger(row.castInstanceId) && row.castInstanceId! > 0).toBe(true);
        if (row.damageType === 'physics') expect(row.castInstanceId).toBe(starts.find(start => start.data?.useRef === row.useRef)!.data?.castInstanceId);
        const settled = events.filter(event => event.kind === 'emitted_event' && event.ref === 'event/damage_taken'
          && event.timeMs === row.timeMs && event.data?.operationRef === row.operationRef && event.data?.useRef === row.useRef);
        expect(settled).toHaveLength(1); expect(settled[0]).toMatchObject({ timeMs: row.timeMs,
          data: { source: 'source', target: 'target', operationRef: row.operationRef, useRef: row.useRef, postDefenseDamage: 10, actualHpLoss: 10, shieldAbsorbed: 0 } });
      }
      expect(done.attackRecords?.map(row => row.startAtMs)).toEqual(EXPECTED.attackStarts);
      expect(done.attackRecords![0]).toMatchObject({ source: 'source', target: 'target', skillKey: 'lab_basic_attack', startAtMs: 250, hitAtMs: 250, completed: true });
      const heals = done.healingRecords ?? [];
      expect(heals.map(row => [row.timeMs, row.rawAmount, row.hpBefore, row.hpAfter])).toEqual(EXPECTED.healing);
      for (const row of heals) {
        expect([row.source, row.target, row.healingAfterDone, row.healingAfterModifiers, row.actualHealing, row.overheal]).toEqual(['target', 'target', 100, 100, 100, 0]);
        const origins = prepared.operationOrigins.filter(origin => origin.skillKey === 'lab_target_restore' && origin.abilityRef === row.abilityRef && origin.operationRef === row.operationRef);
        expect(origins).toHaveLength(1);
        expect(origins[0].compiledPaths.some(path => operationAt(input, path)?.operation === 'heal')).toBe(true);
        expect(row.useRef).toBe(row.timeMs === 250 ? 'skill:probe_0' : 'skill:probe_1');
        expect(row.instructionKey).toBe(row.timeMs === 250 ? 'probe_0' : 'probe_1');
        const evidence = events.filter(event => event.kind === 'heal' && event.timeMs === row.timeMs && event.data?.abilityRef === row.abilityRef);
        expect(evidence).toHaveLength(1); expect(evidence[0].data).toMatchObject({ source: 'target', owner: 'target', target: 'target', modifiers: [], useRef: row.useRef });
      }
      const restorations = projectRestorations(prepared.operationOrigins, input, request, done);
      const restoreSource = prepared.skillOrigins.filter(origin => origin.side === 'target' && origin.skillKey === 'lab_target_restore');
      expect(restoreSource).toHaveLength(1);
      const restoreOrigin = prepared.operationOrigins.filter(origin => origin.skillKey === 'lab_target_restore');
      expect(restoreOrigin).toHaveLength(1); expect(restoreOrigin[0].compiledPaths).toHaveLength(1);
      expect(restorations).toEqual(EXPECTED.healing.map(([time, amount, before, after], index) => ({ timeMs: time, kind: 'heal',
        owner: 'target', source: 'target', target: 'target', providerRef: restoreSource[0].providerRef,
        providerDefinitionRef: restoreSource[0].definitionRef, abilityRef: restoreOrigin[0].abilityRef,
        operationRef: restoreOrigin[0].operationRef, operationPath: restoreOrigin[0].compiledPaths[0], useRef: `skill:probe_${index}`,
        resourceKey: 'hp', requestedAmount: amount, effectiveAmount: amount, currentBefore: before, currentAfter: after, actualDelta: amount, overflow: 0 })));
      const binding = input.rules.skillActionBindings!.find(row => row.skillKey === 'lab_transfer')!;
      const hitAbilityRef = binding.hitBindings[0].hitAbilityRef;
      const hit = events.filter(row => row.kind === 'skill_hit' && row.ref === hitAbilityRef);
      expect(hit).toHaveLength(1); expect(hit[0]).toMatchObject({ timeMs: 500,
        data: { skillKey: 'lab_transfer', source: 'source', target: 'target', useRef: 'skill:wound_0', firstContact: 1,
          blocked: 1, blockScope: 'SKILL', shieldProviderRef: SHIELD, shieldDefinitionRef: SHIELD, shieldOwner: 'target' } });
      const blocked = events.filter(row => row.kind === 'emitted_event' && row.ref === 'event/spell_shield_blocked');
      expect(blocked).toHaveLength(1); expect(blocked[0]).toMatchObject({ timeMs: 500, data: { useRef: 'skill:wound_0', blocked: 1,
        blockScope: 'SKILL', skillKey: 'lab_transfer', source: 'source', target: 'target', shieldProviderRef: SHIELD, shieldDefinitionRef: SHIELD, shieldOwner: 'target' } });
      const expired = events.filter(row => row.kind === 'provider_expire' && row.data?.providerRef === SHIELD);
      expect(expired).toEqual([]); // 当前带后台普攻的初始协议不准入消费listener，盾必须明确保留。
      const finite = input.sharedProviders!.filter(row => row.kind === 'status' && row.providerKey !== SHIELD);
      expect(finite).toHaveLength(2);
      expect(events.filter(row => row.kind === 'provider_apply' && finite.some(provider => provider.providerKey === row.data?.definitionRef))).toEqual([]);
      expect(actors.target.providers.map(row => [row.providerRef, row.definitionRef, row.owner, row.source, row.stacks, row.expireAt, row.state]))
        .toEqual(input.combatants.find(row => row.key === 'target')!.providers
          .map(row => [row.providerRef, row.definitionRef, 'target', 'target', 1, null, {}]));
      expect(actors.target.attributes.move_speed.resolved).toBe(400);
      expect(calls.battleCompiles).toBe(1); expect(calls.battleRuns).toBe(2);
      expect(calls.formulaCompiles).toBe(calls.formulaReleases);
      archive.assertionsPassed = true;
    } catch (error) {
      archive.error = error instanceof Error ? error.stack : String(error); throw error;
    } finally {
      try {
        if (sessionId) {
          calls.battleReleases++; const released = await client.release(sessionId, rulesHash); archive.release = released;
          expect(released.sessionId).toBe(sessionId); expect(released.released).toBe(true);
        }
      } catch (error) {
        archive.releaseError = error instanceof Error ? error.stack : String(error); throw error;
      } finally {
        archive.result = archive.assertionsPassed && (archive.release as { released?: boolean } | undefined)?.released ? 'PASS' : 'FAILED_PRESERVED';
        writeFileSync(resolve(folder, 'raw.json'), JSON.stringify(archive, null, 2) + '\n');
      }
    }
  }, 60000);
});
