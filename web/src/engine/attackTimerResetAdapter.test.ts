import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { fixedValue } from '../types/numericValue';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { skillActionRequest } from './skillActionRequest';
import { assessContinuousAttackResult } from './continuousAttackResult';
import { TinyGoV2Bridge } from '../../tests/fixtures/authorizedBridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { adaptProcessProgram, type AuthoredProcessProgram, type ProcessBasicAttackContext } from './processAdapter';

function snapshotSample(skillKey = 'reset_alpha', basicAttack = true) {
  const snapshot = simulationActiveSample(true);
  const original = snapshot.selection.plannedSkills[0]!.skillKey;
  const renamed = JSON.parse(JSON.stringify(snapshot).replaceAll(original, skillKey)) as typeof snapshot;
  const configuration = renamed.skillConfigurations.find(row => row.skill.skillKey === skillKey)!;
  const effect = configuration.effects[0]!;
  effect.effectKey = 'attack_reset'; effect.lifecycle = null;
  effect.results = [{ resultKey: 'reset', name: '重置自身普攻等待', description: null, sortOrder: 0, resultType: 'ATTACK_TIMER_RESET', target: 'SOURCE',
    valueRule: null, detail: {}, lifecycleBehavior: null, spellShieldBlockScope: null }];
  configuration.effects = [effect];
  configuration.triggerRules = [configuration.triggerRules[0]!];
  const process = configuration.processes[0]!;
  process.steps = [{ stepKey: 'now', name: '即时', description: null, sortOrder: 0, stepType: 'IMMEDIATE', detail: {}, occupiesAction: false }];
  process.cooldown = { durationValue: fixedValue(1000), startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } };
  process.effectBindings = [{ bindingKey: 'reset', effectKey: effect.effectKey, sortOrder: 0,
    moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } }];
  if (basicAttack) {
    renamed.selection.basicAttackSkillKey = renamed.skillConfigurations[0]!.skill.skillKey;
    renamed.selection.basicAttackLevel = 1;
  }
  return syncSimulationSkillSources(renamed);
}
function prepare(snapshot: ReturnType<typeof snapshotSample>) {
  approveSnapshotFixture(snapshot);
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, inputs, { source: 650, target: 590 });
}

describe('通用主动结果重置真实所选普攻计时', () => {
  it.each(['reset_alpha', 'reset_beta'])('%s 只绑定已有普攻INITIAL，完整来源保留', skillKey => {
    const snapshot = snapshotSample(skillKey), prepared = prepare(snapshot);
    const origin = prepared.operationOrigins.find(row => row.skillKey === skillKey && row.effectKey === 'attack_reset')!;
    expect(origin).toBeDefined();
    const binding = prepared.compileRequest.rules.skillActionBindings!.find(row => row.skillKey === skillKey)!;
    const provider = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
    const operation = provider.processes![0]!.momentOperations[0]!.operations[0]!;
    expect(operation).toEqual({ operation: 'cooldown_change', target: 'self', valuePolicy: 'set_remaining', amount: { op: 'const', value: 0 },
      abilityRef: prepared.basicAttackBinding!.initialControlAbilityRef, ref: `skills.${skillKey}.effects.attack_reset.results.reset` });
    expect(operation.abilityRef).not.toBe(binding.controls[0]!.abilityRef);
    expect(origin.compiledPaths).toHaveLength(1);
  });

  it('缺真实普攻时拒绝必要重置，不把纯主动变为无操作', () => {
    expect(() => prepare(snapshotSample('reset_without_attack', false))).toThrow(/普攻/);
  });

  it('过程完成不是重置时点，不因与即时开始同刻而放行', () => {
    const snapshot = snapshotSample();
    snapshot.skillConfigurations[1]!.processes[0]!.effectBindings[0]!.moment = { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null };
    expect(() => prepare(snapshot)).toThrow(/PROCESS_START|过程开始/);
  });

  it.each(['unknown_initial', 'hit_as_initial', 'cross_owner', 'wrong_mount', 'wrong_definition', 'false_use_identity', 'missing_process', 'wrong_skill', 'same_start_hit'] as const)
    ('拒绝伪造私有普攻绑定 %s', variant => {
      const snapshot = snapshotSample(), prepared = prepare(snapshot);
      const binding = structuredClone(prepared.basicAttackBinding!);
      const match = /^source\.provider\[([^\]]+)\]/.exec(binding.initialControlAbilityRef)!;
      const mount = structuredClone(prepared.compileRequest.combatants[0]!.providers.find(row => row.providerRef === match[1])!);
      const provider = structuredClone(prepared.compileRequest.sharedProviders!.find(row => row.providerKey === mount.definitionRef)!);
      const context: ProcessBasicAttackContext = { binding, mount, provider };
      const configuration = snapshot.skillConfigurations[1]!;
      const authored: AuthoredProcessProgram = { gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, skillLevel: 1, characterLevel: 1,
        process: configuration.processes[0]!, effects: configuration.effects, rules: configuration.triggerRules, castCosts: [], basicAttackContext: context };
      if (variant === 'unknown_initial') binding.initialControlAbilityRef = binding.initialControlAbilityRef.replace(/ability\[[^\]]+\]/, 'ability[unknown]');
      if (variant === 'hit_as_initial') binding.initialControlAbilityRef = binding.hitAbilityRef;
      if (variant === 'cross_owner') authored.owner = 'target';
      if (variant === 'wrong_mount') mount.providerRef = 'different_mount';
      if (variant === 'wrong_definition') mount.definitionRef = 'different_definition';
      if (variant === 'false_use_identity') provider.abilities!.find(row => row.processControl)!.processControl!.useRefFromEvent = false;
      if (variant === 'missing_process') provider.processes = [];
      if (variant === 'wrong_skill') provider.skillKey = 'different_skill';
      if (variant === 'same_start_hit') binding.startAbilityRef = binding.hitAbilityRef;
      expect(() => adaptProcessProgram(authored)).toThrow(/普攻/);
    });

  it.each(['reset_alpha', 'reset_beta'])('%s 真实 Wasm 背景普攻等待被重置，原主动冷却仍拒第二次且结果核对通过', async skillKey => {
    const snapshot = snapshotSample(skillKey), prepared = prepare(snapshot);
    const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
    const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
    const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw new Error('缺少真实会话');
    const selected = snapshot.selection.plannedSkills[0]!;
    try {
      const plan = await skillActionRequest(prepared, snapshot, { actions: [100, 150].map((atMs, index) => ({ ...selected,
        instructionKey: `reset_${index}`, atMs, sortOrder: index, targetSide: 'source', phaseKind: 'INITIAL', parentInstructionKey: null, hitPreset: null })),
        durationMs: 200, attackSpeedInputMax: 5, recordTimeSeries: false, maxSkillActionRecords: 64, maxSkillUseRecords: 64, maxHealingRecords: 0 }, compiled.sessionId);
      for (const _repeat of [0, 1]) {
        const request = structuredClone(plan.runRequest);
        const done = parseDoneResult(bridge.run(request));
        expect(done.ok, JSON.stringify(done.errors)).toBe(true);
        expect(done.attackRecords!.map(row => row.startAtMs)).toEqual([0, 100]);
        const assessment = assessContinuousAttackResult(prepared.compileRequest, request, done, prepared.operationOrigins);
        expect(assessment.complete && assessment.factsValid, assessment.issues.join(';')).toBe(true);
        expect(done.skillActionRecords?.filter(row => row.outcome === 'ACCEPTED')).toHaveLength(1);
        expect(done.skillActionRecords?.filter(row => row.outcome === 'REJECTED')).toHaveLength(1);
      }
    } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
  });
});
