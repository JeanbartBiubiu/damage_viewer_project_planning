import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import type { CompileResult } from '../types/genericEngine';
import { TinyGoV2Bridge } from './tinygoV2Bridge';
import { GenericEngineClient, parseCompileResult, parseReleaseResult } from './genericEngineClient';
import { preflightSkillFormulas, skillFormulaPreflightRequest, snapshotFormulaProofIdentity } from './skillFormulaPreflight';
import { approvedFormulaValue, clearFormulaProofScope, collectedCommonFormulaDefinitions, consumedApprovedFormulaValues,
  matchesFormulaProofScope, registerFormulaForApprovedReads, selectFormulaProofScope } from './approvedFormulaValues';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import { fixedValue, parameterValue } from '../types/numericValue';
import { compileNumericValue, compileParameter, createNumericCompileState, NumericAdaptationError } from './numericAdapter';

function parameter(overrides: Partial<SkillParameter> = {}): SkillParameter {
  return {
    gameId: 'lol', skillKey: 'cast_skill', parameterKey: 'mana_cost', name: '法力', valueType: 'INTEGER',
    valueMode: 'FIXED', fixedValue: 50, levelValues: null, description: null, sortOrder: 10, createdAt: '', updatedAt: '',
    ...overrides
  };
}

function state(parameters: SkillParameter[] = [parameter()]) {
  return createNumericCompileState({
    gameId: 'lol', skillKey: 'cast_skill', skillLevel: 1, characterLevel: 1, parameters,
    formulaNamespace: 'numeric/test', bindParameters: true, allowAttributeReads: false,
    runtimeInputMessage: '未知动态：未供值的计算时输入不能运行'
  });
}

describe('numericAdapter 计算时读值', () => {
  it('原型属性名不是当前动作的已绑定输入', () => {
    const compiled = state([parameter({ parameterKey: 'constructor', valueMode: 'RUNTIME_INPUT', fixedValue: null })]);
    compiled.runtimeInputReads = {};
    expect(() => compileParameter('constructor', 'value.parameterKey', compiled)).toThrow(/计算时输入/);
    compiled.runtimeInputReads = { constructor: { op: 'read', path: 'process.actual_cost.mana' } };
    expect(compileParameter('constructor', 'value.parameterKey', compiled)).toEqual({ op: 'read', path: 'process.actual_cost.mana' });
  });

  it('未映射的 RUNTIME_INPUT 仍拒绝，且不写入参数帧', () => {
    const compiled = state([parameter({ valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null })]);
    expect(() => compileParameter('mana_cost', 'mana_cost', compiled)).toThrow(NumericAdaptationError);
    expect(() => compileParameter('mana_cost', 'mana_cost', compiled)).toThrow(/计算时输入/);
    expect(compiled.params).toEqual({});
  });

  it('只接受当前动作列出的参数，固定值不被映射改写', () => {
    const dynamic = parameter({ parameterKey: 'refund', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null });
    const compiled = state([parameter(), dynamic]);
    compiled.runtimeInputReads = { refund: { op: 'read', path: 'process.actual_cost.mana' } };
    expect(compileParameter('refund', 'refund', compiled)).toEqual({ op: 'read', path: 'process.actual_cost.mana' });
    expect(compiled.params).toEqual({});
    expect(() => compileParameter('mana_cost', 'mana_cost', { ...compiled, runtimeInputReads: { mana_cost: { op: 'read', path: 'process.actual_cost.mana' } } })).not.toThrow();
    expect(compileParameter('mana_cost', 'mana_cost', compiled)).toEqual({ op: 'read', path: 'ability.param.mana_cost' });
    expect(compiled.params.mana_cost).toBe(50);
    const missing = state([dynamic, parameter({ parameterKey: 'other', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null })]);
    missing.runtimeInputReads = { refund: { op: 'read', path: 'process.actual_cost.mana' } };
    expect(() => compileParameter('other', 'other', missing)).toThrow(/计算时输入/);
  });

  it('命名公式里的直接参数引用仍要验证', () => {
    const formula: SkillFormula = {
      gameId: 'lol', skillKey: 'cast_skill', formulaKey: 'refund_formula', name: '退款', description: null, sortOrder: 10,
      createdAt: '', updatedAt: '',
      expression: skillFormulaDefinition('cast_skill', { nodeType: 'PARAMETER', parameterKey: 'refund' })
    };
    const compiled = state([parameter({ parameterKey: 'refund', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null })]);
    compiled.formulas = [formula];
    compiled.runtimeInputReads = { refund: { op: 'read', path: 'process.actual_cost.mana' } };
    expect(compileNumericValue({ kind: 'FORMULA', formulaKey: 'refund_formula' }, 'value', compiled)).toEqual({
      op: 'ref', ref: 'numeric/test/levels/1/1/refund_formula'
    });
    expect(compiled.namedFormulas.get('numeric/test/levels/1/1/refund_formula')).toMatchObject({ skillKey: 'cast_skill', expression: formula.expression, parameters: [{ parameterKey: 'refund', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', runtimeSource: { kind: 'process_actual_cost', resourceKey: 'mana' } }] });
    delete compiled.runtimeInputReads;
    expect(() => compileNumericValue({ kind: 'FORMULA', formulaKey: 'missing' }, 'value', compiled)).toThrow(/公式缺失/);
    expect(fixedValue(1).kind).toBe('FIXED');
    expect(parameterValue('refund').parameterKey).toBe('refund');
  });
});

describe('共同公式预检缓存清理，核定值来自真实Wasm编译', () => {
  let bridge: TinyGoV2Bridge;
  const clients: GenericEngineClient[] = [];
  beforeAll(async () => {
    const bytes = readFileSync(new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
    bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
  });
  afterEach(() => {
    for (const client of clients.splice(0)) client.terminate();
    vi.restoreAllMocks();
    selectFormulaProofScope('numeric/preflight/cleanup', true);
    clearFormulaProofScope('numeric/preflight/cleanup');
  });
  function nativeClient() {
    const client = new GenericEngineClient();
    clients.push(client);
    const results: CompileResult[] = [];
    let live = false;
    const compile = vi.spyOn(client, 'compile').mockImplementation(async request => {
      live = true;
      const result = parseCompileResult(bridge.compile(request));
      results.push(result);
      if (result.ok) request.formulas?.forEach(registerFormulaForApprovedReads);
      return result;
    });
    const release = vi.spyOn(client, 'release').mockImplementation(async (sessionId, rulesHash) =>
      parseReleaseResult(bridge.releaseSession(sessionId, rulesHash)));
    const terminate = vi.spyOn(client, 'terminate').mockImplementation(() => { live = false; });
    vi.spyOn(client, 'hasLiveWorker', 'get').mockImplementation(() => live);
    return { client, compile, release, terminate, results };
  }
  function sample() {
    const snapshot = simulationSample('lol');
    const configuration = snapshot.skillConfigurations[0]!;
    configuration.formulas.push({ ...configuration.formulas[0]!, formulaKey: 'static_factor',
      expression: skillFormulaDefinition(configuration.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'base_multiplier' }) });
    return snapshot;
  }
  function program(snapshot: ReturnType<typeof sample>) {
    return skillFormulaPreflightRequest(snapshot).formulas!.find(row => row.key.endsWith('/static_factor'))!;
  }

  it('空公式和取消空请求不销毁借用客户端，仍清理所属预检缓存', async () => {
    const snapshot = sample(); snapshot.skillConfigurations[0]!.formulas = [];
    const native = nativeClient();
    expect(await preflightSkillFormulas(snapshot, native.client)).toEqual({ compileCount: 0, formulaCount: 0, released: true });
    expect(native.compile).not.toHaveBeenCalled();
    expect(native.terminate).not.toHaveBeenCalled();
    expect(matchesFormulaProofScope(snapshotFormulaProofIdentity(snapshot))).toBe(false);
    await expect(preflightSkillFormulas(snapshot, native.client, () => false)).rejects.toThrow(/取消/);
    expect(native.terminate).not.toHaveBeenCalled();
    expect(collectedCommonFormulaDefinitions()).toEqual([]);
  });

  it('请求构造到一半失败不留声明或旧核定值，原快照修复后重新原生预检', async () => {
    const snapshot = sample();
    const before = structuredClone(snapshot);
    const native = nativeClient();
    await preflightSkillFormulas(snapshot, native.client);
    const original = program(snapshot);
    const expected = native.results[0]!.metadata!.approvedStaticValues![original.key]!;
    expect(approvedFormulaValue(original.key)).toBe(expected);
    snapshot.source.skillSources.push({ ...snapshot.source.skillSources[0]!, skillKey: 'missing_skill' });
    await expect(preflightSkillFormulas(snapshot, native.client)).rejects.toThrow(/缺少真实来源/);
    expect(native.compile).toHaveBeenCalledOnce();
    expect(native.terminate).not.toHaveBeenCalled();
    expect(collectedCommonFormulaDefinitions()).toEqual([]);
    expect(consumedApprovedFormulaValues()).toEqual([]);
    expect(approvedFormulaValue(original.key)).toBeNull();
    snapshot.source.skillSources.pop();
    expect(snapshot).toEqual(before);
    await preflightSkillFormulas(snapshot, native.client);
    expect(native.compile).toHaveBeenCalledTimes(2);
    expect(approvedFormulaValue(original.key)).toBe(native.results[1]!.metadata!.approvedStaticValues![original.key]);
    expect(native.release).toHaveBeenCalledTimes(2);
  });

  it('成功预检后按完整身份清空，旧快照清理不抹掉另一场景的原生核定值', async () => {
    const snapshot = sample(), native = nativeClient();
    await preflightSkillFormulas(snapshot, native.client);
    const original = program(snapshot);
    expect(approvedFormulaValue(original.key)).toBe(native.results[0]!.metadata!.approvedStaticValues![original.key]);
    clearFormulaProofScope(snapshotFormulaProofIdentity(snapshot));
    expect(approvedFormulaValue(original.key)).toBeNull();
    expect(collectedCommonFormulaDefinitions()).toEqual([]);
    const next = structuredClone(snapshot); next.readAt = 'different_snapshot';
    await preflightSkillFormulas(next, native.client);
    clearFormulaProofScope(snapshotFormulaProofIdentity(snapshot));
    expect(matchesFormulaProofScope(snapshotFormulaProofIdentity(next))).toBe(true);
    expect(approvedFormulaValue(original.key)).toBe(native.results[1]!.metadata!.approvedStaticValues![original.key]);
  });

  it('同快照旧预检取消迟到，不能清掉后一次成功重试的缓存', async () => {
    const snapshot = sample(), old = nativeClient(), retry = nativeClient();
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const actualCompile = old.compile.getMockImplementation()!;
    old.compile.mockImplementation(async request => { const result = await actualCompile(request); await gate; return result; });
    const pending = preflightSkillFormulas(snapshot, old.client);
    const rejected = expect(pending).rejects.toThrow(/取消|改变/);
    await preflightSkillFormulas(snapshot, retry.client);
    const original = program(snapshot);
    const expected = retry.results[0]!.metadata!.approvedStaticValues![original.key]!;
    resume();
    await rejected;
    expect(matchesFormulaProofScope(snapshotFormulaProofIdentity(snapshot))).toBe(true);
    expect(approvedFormulaValue(original.key)).toBe(expected);
    expect(old.release).toHaveBeenCalledOnce();
    expect(old.client.hasLiveWorker).toBe(true);
    expect(retry.client.hasLiveWorker).toBe(true);
    expect(old.terminate).not.toHaveBeenCalled();
    expect(retry.terminate).not.toHaveBeenCalled();
  });

  it('共同公式预检只释放自己新编译的会话，借用者的其它会话仍有效', async () => {
    const snapshot = sample(), native = nativeClient();
    const borrowed = await native.client.compile(skillFormulaPreflightRequest(snapshot));
    expect(borrowed.ok).toBe(true);
    await preflightSkillFormulas(snapshot, native.client);
    expect(native.compile).toHaveBeenCalledTimes(2);
    expect(native.release).toHaveBeenCalledOnce();
    const ownSession = native.results[1]!.sessionId;
    expect(ownSession).not.toBe(borrowed.sessionId);
    expect(native.release.mock.calls[0][0]).toBe(ownSession);
    expect(native.terminate).not.toHaveBeenCalled();
    expect(native.client.hasLiveWorker).toBe(true);
    await expect(native.client.release(borrowed.sessionId!, 'skill-formula-preflight')).resolves.toMatchObject({
      ok: true, released: true, sessionId: borrowed.sessionId
    });
  });
});
