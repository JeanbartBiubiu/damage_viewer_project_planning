import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { simulationActiveAmmo } from '../../tests/fixtures/simulationActiveAmmo';
import { TinyGoV2Bridge } from './tinygoV2Bridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { skillFormulaPreflightRequest, snapshotFormulaProofIdentity } from './skillFormulaPreflight';
import { rememberApprovedFormulaValues, selectFormulaProofScope } from './approvedFormulaValues';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { skillActionRequest } from './skillActionRequest';
import { automaticSkillRequest } from './automaticSkillRequest';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import { assessSkillActionResult } from './skillActionResult';
import type { DoneResult, RunRequest } from '../types/genericEngine';

function validResult(prepared: ReturnType<typeof assembleSimulation>, request: RunRequest, done: DoneResult) {
  const assess = request.driverPlan.automaticSkills ? assessAutomaticSkillResult : assessSkillActionResult;
  const result = assess(prepared.compileRequest, request, done, prepared.operationOrigins);
  expect(result.issues).toEqual([]);
  expect(result.factsValid).toBe(true);
}

let bridge: TinyGoV2Bridge;
beforeAll(async () => {
  const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
  bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
});
function prepare(fixture: ReturnType<typeof simulationActiveAmmo>, stock: number, remaining: number, phase: number) {
  fixture.snapshot.target.selectedLevelValues.hp = 10000;
  fixture.snapshot.target.attributes.levelValues['1'] = { ...fixture.snapshot.target.selectedLevelValues };
  const scene = fixture.inputs(stock, remaining, phase);
  selectFormulaProofScope(snapshotFormulaProofIdentity(fixture.snapshot, scene), true);
  const preflight = skillFormulaPreflightRequest(fixture.snapshot, scene);
  const checked = parseCompileResult(bridge.compile(preflight));
  expect(checked.ok, JSON.stringify(checked.errors)).toBe(true);
  if (!checked.sessionId) throw new Error('缺少预检会话');
  rememberApprovedFormulaValues(preflight.formulas ?? [], checked.metadata?.approvedStaticValues ?? {});
  expect(parseReleaseResult(bridge.releaseSession(checked.sessionId, preflight.rulesHash)).released).toBe(true);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(fixture.snapshot, [], scene).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(fixture.snapshot, attributes, { source: 500, target: 5000 }, [], [], [], scene);
}

describe('正式Wasm的主动弹药宿主闭环', () => {
  it('真实接口序列化省略空failureReason仍按同一付款顺序编译、运行和释放', async () => {
    const fixture = simulationActiveAmmo(false);
    const explicit = prepare(fixture, 4, 0, 1);
    const omitNullReason = (key: string, value: unknown) => key === 'failureReason' && value === null ? undefined : value;
    fixture.process.stateOperations = JSON.parse(JSON.stringify(fixture.process.stateOperations, omitNullReason));
    fixture.process.cooldown = JSON.parse(JSON.stringify(fixture.process.cooldown, omitNullReason));
    expect(fixture.process.stateOperations.every(operation => !Object.prototype.hasOwnProperty.call(operation.moment, 'failureReason'))).toBe(true);
    const prepared = prepare(fixture, 4, 0, 1);
    expect(prepared.compileRequest.sharedProviders).toEqual(explicit.compileRequest.sharedProviders);
    const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw new Error('缺少真实响应形状运行会话');
    try {
      const plan = fixture.snapshot.selection.plannedSkills[0]!;
      const request = (await skillActionRequest(prepared, fixture.snapshot, { actions: [0, 2000, 4000].map((atMs, index) => ({ ...plan,
        instructionKey: `wire_shot_${index}`, atMs, sortOrder: index, targetSide: 'target', phaseKind: 'INITIAL', parentInstructionKey: null,
        hitPreset: 'TARGET_HIT' })), durationMs: 4000, recordTimeSeries: false,
        maxSkillActionRecords: 100, maxSkillUseRecords: 100, maxHealingRecords: 0 }, compiled.sessionId)).runRequest;
      const done = parseDoneResult(bridge.run(request));
      validResult(prepared, request, done);
      expect(done.damageRecords!.map(row => row.rawAmount)).toEqual([100, 100, 200]);
      const source = done.finalSnapshot.combatants.find(row => row.key === 'source')!;
      const state = source.providerState[prepared.compileRequest.rules.skillActionBindings![0]!.providerRef] as { state: Record<string, number> };
      expect(state.state).toMatchObject({ stock: 1, next_phase: 1, frozen_phase: 3 });
      expect(fixture.process.stateOperations.every(operation => !Object.prototype.hasOwnProperty.call(operation.moment, 'failureReason'))).toBe(true);
    } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
  });
  it.each([1, 2, 3])('同一付款帧冻结循环 %s，MISS也扣弹并推进', async phase => {
    const fixture = simulationActiveAmmo(false);
    const prepared = prepare(fixture, 4, 0, phase);
    const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw new Error('缺少运行会话');
    try {
      const plan = fixture.snapshot.selection.plannedSkills[0]!;
      const request = (await skillActionRequest(prepared, fixture.snapshot, { actions: [0, 2000, 4000].map((atMs, index) => ({ ...plan,
        instructionKey: `shot_${index}`, atMs, sortOrder: index, targetSide: 'target', phaseKind: 'INITIAL', parentInstructionKey: null,
        hitPreset: index === 0 ? 'MISS' : 'TARGET_HIT' })), durationMs: 4000, recordTimeSeries: false,
        maxSkillActionRecords: 100, maxSkillUseRecords: 100, maxHealingRecords: 0 }, compiled.sessionId)).runRequest;
      for (let repetition = 0; repetition < 3; repetition++) {
        const done = parseDoneResult(bridge.run(request));
        validResult(prepared, request, done);
        const values = done.damageRecords!.map(row => row.rawAmount);
        const phaseAt = (offset: number) => (phase + offset - 1) % 3 + 1;
        expect(values).toEqual([phaseAt(1), phaseAt(2)].map(value => value === 3 ? 200 : 100));
        const source = done.finalSnapshot.combatants.find(row => row.key === 'source')!;
        const state = source.providerState[prepared.compileRequest.rules.skillActionBindings![0]!.providerRef] as { state: Record<string, number> };
        expect(state.state).toMatchObject({ stock: 1, next_phase: phase, frozen_phase: phaseAt(2) });
      }
    } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
  });
  it.each([0, 1])('欠弹库存%s与背景普攻共用同一库存，真实退款和自动等待不中断普攻', async stock => {
    const fixture = simulationActiveAmmo(true);
    const prepared = prepare(fixture, stock, 1000, 1);
    const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw new Error('缺少运行会话');
    try {
      const plan = fixture.snapshot.selection.plannedSkills[0]!;
      const request = (await automaticSkillRequest(prepared, fixture.snapshot, { rules: [{ ...plan, ruleKey: 'auto_ammo', sortOrder: 0,
        targetSide: 'target', hitPreset: 'TARGET_HIT', waitForCooldowns: [], releaseAfterRuleKey: null }], durationMs: 6000, attackSpeedInputMax: 2,
        recordTimeSeries: false, maxAutomaticSkillRecords: 1000, maxHealingRecords: 0, outputMode: 'detailed' }, compiled.sessionId)).runRequest;
      const detailed = parseDoneResult(bridge.run(request));
      validResult(prepared, request, detailed);
      expect(detailed.attackRecords!.length).toBeGreaterThan(2);
      expect(detailed.damageRecords!.filter(row => row.abilityRef === prepared.compileRequest.rules.skillActionBindings![0]!.hitBindings[0]!.hitAbilityRef).length).toBeGreaterThan(0);
      const source = detailed.finalSnapshot.combatants.find(row => row.key === 'source')!;
      expect(source.providers.filter(row => row.definitionRef === prepared.compileRequest.rules.skillActionBindings![0]!.providerDefinitionRef)).toHaveLength(1);
      const state = source.providerState[prepared.compileRequest.rules.skillActionBindings![0]!.providerRef] as { state: Record<string, number> };
      expect(state.state.stock).toBeGreaterThanOrEqual(0);
    } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
  });
  it.each([0, 1])('回充金额实时读取明确属性 %s，不向用户索取公式参数', async chance => {
    const fixture = simulationActiveAmmo(true);
    fixture.snapshot.source.selectedLevelValues.critical_strike_chance = chance;
    fixture.snapshot.source.attributes.levelValues['1'] = { ...fixture.snapshot.source.selectedLevelValues };
    fixture.configuration.formulas.push({ ...fixture.configuration.formulas[0]!, formulaKey: 'refund_amount', expression: {
      inputs: [{ key: 'chance', binding: { kind: 'attribute', object: 'source', attributeKey: 'critical_strike_chance', valueKind: 'TOTAL', view: 'current_frame' } }],
      stages: [{ key: 'amount', name: '明确数值模型', expression: { op: 'add', args: [
        { op: 'const', value: '2000' }, { op: 'mul', args: [{ op: 'const', value: '4000' }, { op: 'clamp', args: [
          { op: 'read', inputKey: 'chance' }, { op: 'const', value: '0' }, { op: 'const', value: '1' }
        ] }] }
      ] } }], outputStageKey: 'amount'
    } });
    const action = fixture.configuration.triggerRules.find(row => row.ruleKey === 'refund')!.actions[0]!;
    if (action.actionType !== 'MODIFY_INTERNAL_STATE') throw new Error('独立样例失效');
    action.detail.value = { kind: 'FORMULA', formulaKey: 'refund_amount' };
    const prepared = prepare(fixture, 1, 20000, 1);
    const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw new Error('缺少运行会话');
    try {
      const request = (await automaticSkillRequest(prepared, fixture.snapshot, { rules: [{ ...fixture.snapshot.selection.plannedSkills[0]!, ruleKey: 'auto_ammo', sortOrder: 0,
        targetSide: 'target', hitPreset: 'TARGET_HIT', waitForCooldowns: [], releaseAfterRuleKey: null }], durationMs: 6000, attackSpeedInputMax: 2,
        recordTimeSeries: false, maxAutomaticSkillRecords: 1000, maxHealingRecords: 0, outputMode: 'detailed' }, compiled.sessionId)).runRequest;
      const done = parseDoneResult(bridge.run(request));
      validResult(prepared, request, done);
      const skillDamage = done.damageRecords!.filter(row => row.abilityRef === prepared.compileRequest.rules.skillActionBindings![0]!.hitBindings[0]!.hitAbilityRef);
      expect(skillDamage.length).toBe(chance === 0 ? 1 : 2);
    } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
  });
  it.each(['one_auto', 'one_fixed', 'all_auto', 'all_fixed'].flatMap(mode => [false, true].map(background => ({ mode, background }))))(
    '产品结果接受 $mode、背景普攻$background 的真实恢复与消费', async ({ mode, background }) => {
      const fixture = simulationActiveAmmo(background);
      const one = mode.startsWith('one'); const automatic = mode.endsWith('auto');
      if (!one) {
        fixture.stock.detail.recoveryMode = 'ALL_AT_ONCE'; fixture.stock.detail.recoveryStartCondition = 'WHEN_EMPTY';
        delete fixture.stock.detail.initialRemainingValue; delete fixture.stock.detail.initialRemainingMsBinding;
        fixture.configuration.triggerRules = fixture.configuration.triggerRules.filter(row => row.ruleKey !== 'refund');
        fixture.snapshot.source.skillSources[1]!.enabledRuleKeys = fixture.snapshot.source.skillSources[1]!.enabledRuleKeys.filter(key => key !== 'refund');
      }
      const prepared = prepare(fixture, 0, 0, 1);
      const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
      expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
      if (!compiled.sessionId) throw new Error('缺少弹药结果校验运行会话');
      try {
        const plan = fixture.snapshot.selection.plannedSkills[0]!;
        const shared = { durationMs: one ? 6000 : 22000, attackSpeedInputMax: 2, recordTimeSeries: false, maxHealingRecords: 0 };
        const request = automatic ? (await automaticSkillRequest(prepared, fixture.snapshot, { ...shared, outputMode: 'detailed',
          maxAutomaticSkillRecords: 1000, rules: [{ ...plan, ruleKey: 'ammo_result', sortOrder: 0, targetSide: 'target',
            hitPreset: 'TARGET_HIT', waitForCooldowns: [], releaseAfterRuleKey: null }] }, compiled.sessionId)).runRequest
          : (await skillActionRequest(prepared, fixture.snapshot, { ...shared, maxSkillActionRecords: 100, maxSkillUseRecords: 100,
            actions: [{ ...plan, instructionKey: 'ammo_result', atMs: one ? 0 : 20000, sortOrder: 0, targetSide: 'target',
              phaseKind: 'INITIAL', parentInstructionKey: null, hitPreset: 'MISS' }] }, compiled.sessionId)).runRequest;
        expect(request.recordBudget!.maxMechanicRecords).toBe(2000);
        const done = parseDoneResult(bridge.run(request));
        expect(done.mechanicRecords!.length).toBeGreaterThan(0);
        expect(done.mechanicRecords!.some(row => row.useRef !== null)).toBe(true);
        if (one) expect(done.mechanicRecords![0]).toMatchObject({ kind: 'WAIT_STARTED', timeMs: 0, readyAtMs: 0 });
        validResult(prepared, request, done);
        if (!automatic) {
          const wrongIdentity = structuredClone(done);
          wrongIdentity.mechanicRecords!.find(row => row.useRef !== null)!.useRef = 'unrelated_use';
          expect(assessSkillActionResult(prepared.compileRequest, request, wrongIdentity, prepared.operationOrigins).factsValid).toBe(false);
          const wrongBudget = structuredClone(done); wrongBudget.recording!.mechanicRecordCount += 1;
          expect(assessSkillActionResult(prepared.compileRequest, request, wrongBudget, prepared.operationOrigins).factsValid).toBe(false);
        }
        const truncatedRequest = structuredClone(request); truncatedRequest.recordBudget!.maxMechanicRecords = 2;
        const truncated = parseDoneResult(bridge.run(truncatedRequest));
        expect(truncated.recording!.mechanicRecordsTruncated).toBe(true);
        validResult(prepared, truncatedRequest, truncated);
        if (automatic) {
          const summaryRequest = structuredClone(request); summaryRequest.outputMode = 'summary';
          if (!background) summaryRequest.recordBudget!.maxMechanicRecords = 0;
          const summary = parseDoneResult(bridge.run(summaryRequest));
          expect(summary.mechanicRecords).toEqual([]);
          validResult(prepared, summaryRequest, summary);
        }
      } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
    });
  it.each([false, true])('主动弹药的身份、状态、使用与预算篡改进入产品factsValid；背景普攻%s', async background => {
    const fixture = simulationActiveAmmo(background);
    const prepared = prepare(fixture, 0, 1000, 1);
    const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw new Error('缺少结果篡改验证会话');
    try {
      const request = (await automaticSkillRequest(prepared, fixture.snapshot, { rules: [{ ...fixture.snapshot.selection.plannedSkills[0]!,
        ruleKey: 'ammo_result', sortOrder: 0, targetSide: 'target', hitPreset: 'TARGET_HIT', waitForCooldowns: [], releaseAfterRuleKey: null }],
        durationMs: 6000, attackSpeedInputMax: 2, recordTimeSeries: false, maxHealingRecords: 0, maxAutomaticSkillRecords: 1000,
        outputMode: 'detailed' }, compiled.sessionId)).runRequest;
      const original = parseDoneResult(bridge.run(request));
      validResult(prepared, request, original);
      for (const kind of ['owner', 'providerRef', 'providerDefinitionRef', 'skillKey', 'stateKey', 'operationRef', 'useRef', 'beforeValue', 'afterValue',
        'readyAtMs', 'initial_deadline_early', 'initial_deadline_late', 'record_count', 'record_returned', 'record_dropped', 'record_truncated'] as const) {
        const done = structuredClone(original);
        const consume = done.mechanicRecords!.find(row => row.kind === 'STATE_CHANGED' && row.useRef !== null)!;
        if (['owner', 'providerRef', 'providerDefinitionRef', 'skillKey', 'stateKey', 'operationRef', 'useRef'].includes(kind)) {
          (consume as unknown as Record<string, unknown>)[kind] = kind === 'owner' ? 'target' : 'foreign_identity';
        }
        if (kind === 'beforeValue') consume.beforeValue += 1;
        if (kind === 'afterValue') consume.afterValue += 1;
        if (kind === 'readyAtMs') consume.readyAtMs = consume.timeMs;
        if (kind === 'initial_deadline_early') done.mechanicRecords![0]!.readyAtMs = 1;
        if (kind === 'initial_deadline_late') done.mechanicRecords![0]!.readyAtMs = 1001;
        if (kind === 'record_count') done.recording!.mechanicRecordCount += 1;
        if (kind === 'record_returned') done.recording!.returnedMechanicRecords -= 1;
        if (kind === 'record_dropped') done.recording!.droppedMechanicRecords += 1;
        if (kind === 'record_truncated') done.recording!.mechanicRecordsTruncated = true;
        const assessed = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
        expect(assessed.factsValid, kind).toBe(false);
      }
    } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
  });
});
