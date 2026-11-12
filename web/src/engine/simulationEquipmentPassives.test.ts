import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { describe, expect, it } from 'vitest';
import { addPermanentEquipmentSibling, permanentEquipmentSimulationSample, renamedPermanentEquipmentSimulationSample } from '../../tests/fixtures/simulationPermanentEquipment';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { continuousAttackRequest } from './continuousAttackRequest';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { equipmentRangeRequirements } from './simulationEquipmentRange';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { compileFixtureWithNative } from '../../tests/fixtures/nativeFormulaProof';
import { readFileSync } from 'node:fs';
import { TinyGoV2Bridge } from '../../tests/fixtures/authorizedBridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { assessContinuousAttackResult } from './continuousAttackResult';

function inputsFor(snapshot: ReturnType<typeof permanentEquipmentSimulationSample>) {
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  return inputs;
}
const health = { source: 650, target: 590 };
const aura = [{ owner: 'target' as const, equipmentKey: 'item_3110', target: 'source' as const, inRange: true }];

async function runNativeProbe(prepared: ReturnType<typeof assembleSimulation>) {
  const input = prepared.compileRequest;
  input.sharedProviders!.push({ providerKey: 'explicit_probe', stableId: 'explicit_probe', kind: 'character', abilities: [{
    abilityKey: 'shield_both', kind: 'active', operations: [
      { operation: 'shield', target: 'self', shieldRef: 'source_probe_shield', amount: { op: 'const', value: 100 }, shieldDurationMs: { op: 'const', value: 1000 } },
      { operation: 'shield', target: 'target', shieldRef: 'target_probe_shield', amount: { op: 'const', value: 100 }, shieldDurationMs: { op: 'const', value: 1000 } }
    ] }] });
  input.combatants[0]!.providers.push({ providerRef: 'explicit_probe', definitionRef: 'explicit_probe' });
  const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
  const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
  const compiled = parseCompileResult(bridge.compile(input));
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
  if (!compiled.sessionId) throw new Error('原生编译缺少会话');
  try {
    return parseDoneResult(bridge.run({ sessionId: compiled.sessionId, expectedRulesHash: input.rulesHash,
      schemaVersion: input.schemaVersion, schemaHash: input.schemaHash, rulesHash: input.rulesHash,
      initialSnapshot: simulationInitialSnapshot(input), driverPlan: { conditionRecheckIntervalMs: 100, entries: [{
        entryKey: 'explicit_shields', abilityRef: 'source.provider[explicit_probe].ability[shield_both]', source: 'source', target: 'target', firstAtMs: 0
      }] }, stopPolicy: { durationMs: 1, stopOnTargetDeath: false, stopWhenNoEvents: true },
      sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 10 } }));
  } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, input.rulesHash)).released).toBe(true); }
}

describe('4B完整常驻装备', () => {
  it('双方振奋各自完整建立治疗和护盾，所有来源、效果及初始化不串', async () => {
    const snapshot = permanentEquipmentSimulationSample(['item_3065'], ['item_3065']);
    const prepared = await prepareSimulation(snapshot, inputsFor(snapshot), health);
    const providers = prepared.compileRequest.sharedProviders!;
    expect(providers.filter(row => row.modifiers?.some(modifier => modifier.command === 'heal'))).toHaveLength(2);
    expect(providers.filter(row => row.modifiers?.some(modifier => modifier.command === 'shield'))).toHaveLength(2);
    expect(new Set(providers.map(row => row.providerKey)).size).toBe(providers.length);
    const initializers = providers.filter(row => row.abilities?.some(ability => ability.listenerSpec?.eventMatcher.all?.includes('event/source_initialized')));
    expect(initializers).toHaveLength(2);
    for (const initializer of initializers) {
      expect(initializer.abilities).toHaveLength(2);
      expect(initializer.abilities).toMatchObject([{ kind: 'passive_listener', listenerSpec: { maxTriggersPerEvent: 1, operations: [{ target: 'self' }] } },
        { kind: 'passive_listener', listenerSpec: { maxTriggersPerEvent: 1, operations: [{ target: 'self' }] } }]);
    }
    await expect(continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 })).resolves.toBeDefined();
  });

  it('冰心缺范围确认拒绝，显式假设进入摘要、覆盖及运行冻结输入', async () => {
    const snapshot = permanentEquipmentSimulationSample([], ['item_3110']);
    const inputs = inputsFor(snapshot);
    expect(() => assembleSimulation(snapshot, inputs, health)).toThrow(/equipmentAssumptions/);
    for (const assumptions of [[{ ...aura[0]!, inRange: false }], [{ ...aura[0]!, target: 'target' as const }], [...aura, ...aura]]) {
      expect(() => assembleSimulation(snapshot, inputs, health, assumptions)).toThrow(/equipmentAssumptions/);
    }
    const prepared = await prepareSimulation(snapshot, inputs, health, aura);
    expect(prepared.compileRequest.sharedProviders!.flatMap(row => row.modifiers ?? [])).toContainEqual(expect.objectContaining({ target: 'opponent.attr.attack_speed', value: { op: 'const', value: .8 } }));
    expect(prepared.coverage.some(row => row.authorPath.startsWith('equipmentAssumptions.target'))).toBe(true);
    const continuous = await continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 });
    expect(continuous.runRequest.runtimeOptions!.equipmentAssumptions).toEqual(aura);
    expect(prepared.equipmentAssumptions).not.toBe(aura);
  });

  it('拒绝缺护盾、夹带命中触发或额外配置，不静默过滤', () => {
    const missing = permanentEquipmentSimulationSample(['item_3065']);
    missing.skillConfigurations[1]!.effects.pop();
    expect(() => inspectSimulationSnapshot(missing)).toThrow(/必要闭包引用缺失/);
    const trigger = permanentEquipmentSimulationSample(['item_3065']);
    trigger.skillConfigurations[1]!.triggerRules[0]!.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
    expect(() => inspectSimulationSnapshot(trigger)).toThrow(/初始化/);
    const extra = permanentEquipmentSimulationSample(['item_3065']);
    extra.skillConfigurations.push(structuredClone(extra.skillConfigurations[1]!));
    expect(() => inspectSimulationSnapshot(extra)).toThrow(/重复/);
  });

  it('装备、技能、效果、结果、参数、规则及修正区域全部重命名，仍按实际原键同数值装配', () => {
    const snapshot = renamedPermanentEquipmentSimulationSample();
    const assumptions = [{ owner: 'target' as const, equipmentKey: 'authored_aura_item', target: 'source' as const, inRange: true }];
    expect(equipmentRangeRequirements(snapshot)).toEqual([{ owner: 'target', equipmentKey: 'authored_aura_item', equipmentName: snapshot.target.selectedEquipment[0]!.equipment.name }]);
    const prepared = assembleSimulation(snapshot, inputsFor(snapshot), health, assumptions);
    const modifiers = prepared.compileRequest.sharedProviders!.flatMap(row => row.modifiers ?? []);
    expect(modifiers.filter(row => row.command === 'heal').map(row => row.value)).toEqual([{ op: 'const', value: .25 }]);
    expect(modifiers.filter(row => row.command === 'shield').map(row => row.value)).toEqual([{ op: 'const', value: .25 }]);
    expect(modifiers).toContainEqual(expect.objectContaining({ target: 'opponent.attr.attack_speed', stage: 'total', valuePolicy: 'multiply', value: { op: 'const', value: .8 } }));
    expect(prepared.skillOrigins.filter(row => row.origin.kind === 'EQUIPMENT').map(row => [row.side, row.skillKey, row.definitionRef]))
      .toEqual([['source', 'authored_recovery_skill', 'source_authored_recovery_item_passive_definition'], ['target', 'authored_aura_skill', 'target_authored_aura_item_passive_definition']]);
    expect(compileFixtureWithNative(prepared.compileRequest).ok).toBe(true);
  });

  it('同装备两个技能保留同名效果、结果和规则，数值及完整实编来源互不覆盖', () => {
    const snapshot = addPermanentEquipmentSibling(permanentEquipmentSimulationSample(['item_3065']), 'source', 'item_3065', 'item_3065_passive', 'sibling_recovery', .1);
    const prepared = assembleSimulation(snapshot, inputsFor(snapshot), health);
    const healingProviders = prepared.compileRequest.sharedProviders!.filter(row => row.modifiers?.some(modifier => modifier.command === 'heal'));
    expect(healingProviders.map(row => row.modifiers![0]!.value)).toEqual([{ op: 'const', value: .25 }, { op: 'const', value: .1 }]);
    expect(healingProviders.every(row => row.providerKey.includes(row.skillKey!))).toBe(true);
    expect(new Set(healingProviders.map(row => row.providerKey)).size).toBe(2);
    expect(prepared.skillOrigins.filter(row => row.origin.kind === 'EQUIPMENT' && row.providerRef)).toHaveLength(2);
    expect(compileFixtureWithNative(prepared.compileRequest).ok).toBe(true);
  });

  it('关闭原被动仍执行同装备开启的兄弟，直接装备属性只贡献一次', async () => {
    const snapshot = addPermanentEquipmentSibling(permanentEquipmentSimulationSample(['item_3065']), 'source', 'item_3065', 'item_3065_passive', 'sibling_recovery', .1);
    snapshot.selection.sourceSkillSettings.push({ origin: { kind: 'EQUIPMENT', equipmentKey: 'item_3065' }, skillKey: 'item_3065_passive', enabled: false });
    syncSimulationSkillSources(snapshot);
    const prepared = assembleSimulation(snapshot, inputsFor(snapshot), health);
    const modifiers = prepared.compileRequest.sharedProviders!.flatMap(row => row.modifiers ?? []);
    expect(modifiers.filter(row => row.command === 'heal').map(row => row.value)).toEqual([{ op: 'const', value: .1 }]);
    expect(modifiers.filter(row => row.command === 'shield').map(row => row.value)).toEqual([{ op: 'const', value: .1 }]);
    expect(prepared.compileRequest.combatants[0]!.attributes.hp!.max).toBe(1050);
    expect(prepared.equipmentOrigins).toHaveLength(1);
    expect(prepared.skillOrigins.find(row => row.skillKey === 'item_3065_passive')!.providerRef).toBeUndefined();
    expect(prepared.skillOrigins.find(row => row.skillKey === 'sibling_recovery')!.providerRef).toBeDefined();
    await expect(continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 })).resolves.toBeDefined();
  });

  it('范围只取当前开启来源的真实闭包，不扫描关闭或不可达光环', () => {
    const snapshot = permanentEquipmentSimulationSample(['item_3065']);
    const unused = structuredClone(permanentEquipmentSimulationSample([], ['item_3110']).skillConfigurations[1]!.effects[0]!);
    unused.skillKey = 'item_3065_passive';
    unused.results[0]!.valueRule!.value = { kind: 'FIXED', value: .2 };
    snapshot.skillConfigurations[1]!.effects.push(unused);
    expect(equipmentRangeRequirements(snapshot)).toEqual([]);
    const disabled = permanentEquipmentSimulationSample([], ['item_3110']);
    disabled.selection.targetSkillSettings.push({ origin: { kind: 'EQUIPMENT', equipmentKey: 'item_3110' }, skillKey: 'item_3110_passive', enabled: false });
    syncSimulationSkillSources(disabled);
    expect(equipmentRangeRequirements(disabled)).toEqual([]);
  });

  it('装备对手任意非生命属性使用声明乘算；RATIO_ADD及过量减少明确拒绝', () => {
    const snapshot = permanentEquipmentSimulationSample([], ['item_3110']);
    const result = snapshot.skillConfigurations[1]!.effects[0]!.results[0]!;
    if (result.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('结构结果缺失');
    result.detail.attributeKey = 'armor';
    const prepared = assembleSimulation(snapshot, inputsFor(snapshot), health, aura);
    expect(prepared.compileRequest.sharedProviders!.flatMap(row => row.modifiers ?? []))
      .toContainEqual(expect.objectContaining({ target: 'opponent.attr.armor', stage: 'total', valuePolicy: 'multiply', value: { op: 'const', value: .8 } }));
    snapshot.catalogs.modifierZones.find(row => row.modifierZoneKey === 'aura')!.calculationMode = 'RATIO_ADD';
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/不能把比例加算解释为总值乘算/);
    snapshot.catalogs.modifierZones.find(row => row.modifierZoneKey === 'aura')!.calculationMode = 'RATIO_MULTIPLY';
    snapshot.skillConfigurations[1]!.parameters[0]!.fixedValue = 1.01;
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/减少不超过1/);
  });

  it('自身施加快照静态乘算不误入仅攻击力的实时转换，多个并列结果全部保留', () => {
    const snapshot = permanentEquipmentSimulationSample([], ['item_3110']);
    const configuration = snapshot.skillConfigurations[1]!;
    const result = configuration.effects[0]!.results[0]!;
    result.target = 'SOURCE';
    if (result.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('结构结果缺失');
    result.detail.attributeKey = 'armor';
    const second = structuredClone(result);
    second.resultKey = 'second_static'; second.sortOrder = 1;
    configuration.effects[0]!.results.push(second);
    const prepared = assembleSimulation(snapshot, inputsFor(snapshot), health);
    expect(prepared.compileRequest.rules.attributeDerivations).toBeUndefined();
    expect(prepared.compileRequest.sharedProviders!.filter(row => row.kind === 'status' && row.modifiers?.some(modifier => modifier.target === 'self.attr.armor'))).toHaveLength(2);
    const unsupported = structuredClone(result); unsupported.resultKey = 'unsupported'; unsupported.resultType = 'DAMAGE' as never;
    configuration.effects[0]!.results.push(unsupported);
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/完整常驻结果/);
  });

  it('共同公式仍消费原生核定静态值，参数、层数及必要尾规则不能裁剪', () => {
    const snapshot = permanentEquipmentSimulationSample(['item_3065']);
    const configuration = snapshot.skillConfigurations[1]!;
    configuration.formulas.push({ ...snapshot.skillConfigurations[0]!.formulas[0]!, skillKey: configuration.skill.skillKey, formulaKey: 'authored_ratio',
      expression: skillFormulaDefinition(configuration.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'ratio' }) });
    configuration.parameters.push({ ...configuration.parameters[0]!, parameterKey: 'authored_layers', fixedValue: 1 });
    configuration.formulas.push({ ...configuration.formulas[0]!, formulaKey: 'authored_stacks',
      expression: skillFormulaDefinition(configuration.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'authored_layers' }) });
    configuration.effects[0]!.lifecycle!.maxStacksValue = { kind: 'FORMULA', formulaKey: 'authored_stacks' };
    configuration.effects[0]!.lifecycle!.applicationStacksValue = { kind: 'PARAMETER', parameterKey: 'authored_layers' };
    configuration.effects[0]!.results[0]!.valueRule!.value = { kind: 'FORMULA', formulaKey: 'authored_ratio' };
    const prepared = assembleSimulation(snapshot, inputsFor(snapshot), health);
    expect(prepared.compileRequest.sharedProviders!.flatMap(row => row.modifiers ?? []).find(row => row.command === 'heal')!.value).toEqual({ op: 'const', value: .25 });
    expect(prepared.compileRequest.formulas!.some(row => row.key.endsWith('/authored_ratio'))).toBe(true);
    for (const formulaKey of ['authored_ratio', 'authored_stacks']) {
      const rows = prepared.coverage.filter(row => row.authorPath === `skills.item_3065_passive.formulas.${formulaKey}.expression`);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(row => row.note === undefined)).toBe(true);
      for (const row of rows) {
        const programKey = /^formulas\[([^\]]+)\]\.expression$/.exec(row.compiledPath)?.[1];
        expect(prepared.compileRequest.formulas!.some(formula => formula.key === programKey)).toBe(true);
      }
    }
    expect(prepared.coverage.some(row => row.authorPath === 'skills.item_3065_passive.parameters.ratio' && row.compiledPath.endsWith('.modifiers[0].value') && row.note === undefined)).toBe(true);
    expect(prepared.coverage.some(row => row.authorPath === 'skills.item_3065_passive.parameters.authored_layers' && row.compiledPath.endsWith('.operations[0]') && row.note === undefined)).toBe(true);
    expect(compileFixtureWithNative(prepared.compileRequest).ok).toBe(true);
    configuration.effects[0]!.lifecycle!.applicationStacksValue = { kind: 'PARAMETER', parameterKey: 'missing_parameter' };
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/必要闭包引用缺失/);
    configuration.effects[0]!.lifecycle!.applicationStacksValue = { kind: 'PARAMETER', parameterKey: 'authored_layers' };
    configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'required_tail',
      eventSource: { eventType: 'RESULT_AVAILABLE', detail: { effectKey: 'received_heal', resultKey: 'received_heal' } } });
    syncSimulationSkillSources(snapshot);
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/事件节点|尾规则|作者规则/);
  });

  it('原生实际结算总攻速1.2乘20%减少为0.96，双方同技能护盾各收到125', async () => {
    const snapshot = permanentEquipmentSimulationSample(['item_3065'], ['item_3065', 'item_3110']);
    snapshot.source.selectedLevelValues.attack_speed = 1.2;
    const prepared = await prepareSimulation(snapshot, inputsFor(snapshot), health, aura);
    const done = await runNativeProbe(prepared);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'source')!.attributes.attack_speed!.resolved).toBeCloseTo(.96, 12);
    for (const actor of done.finalSnapshot.combatants) expect(actor.shields).toEqual([expect.objectContaining({ remaining: 125 })]);
  });

  it('原生实际护盾并列兄弟加成135；关闭原被动后仍由兄弟得到110', async () => {
    const snapshot = addPermanentEquipmentSibling(permanentEquipmentSimulationSample(['item_3065']), 'source', 'item_3065', 'item_3065_passive', 'sibling_recovery', .1);
    const both = await runNativeProbe(await prepareSimulation(snapshot, inputsFor(snapshot), health));
    expect(both.finalSnapshot.combatants.find(row => row.key === 'source')!.shields).toEqual([expect.objectContaining({ remaining: 135 })]);
    snapshot.selection.sourceSkillSettings.push({ origin: { kind: 'EQUIPMENT', equipmentKey: 'item_3065' }, skillKey: 'item_3065_passive', enabled: false });
    syncSimulationSkillSources(snapshot);
    const sibling = await runNativeProbe(await prepareSimulation(snapshot, inputsFor(snapshot), health));
    const sourceShields = sibling.finalSnapshot.combatants.find(row => row.key === 'source')!.shields as Array<{ remaining: number }>;
    expect(sourceShields).toHaveLength(1);
    expect(sourceShields[0]!.remaining).toBeCloseTo(110, 12);
    expect(sibling.finalSnapshot.combatants.find(row => row.key === 'target')!.shields).toEqual([expect.objectContaining({ remaining: 100 })]);
  });

  it('永久来源定位到真实初始化能力和作者操作，连续结果完整校验且拥有方与两次初始化不改变', async () => {
    const snapshot = permanentEquipmentSimulationSample(['item_3065'], ['item_3110']);
    const prepared = await prepareSimulation(snapshot, inputsFor(snapshot), health, aura);
    const permanentOrigins = prepared.operationOrigins.filter(row => row.skillKey !== snapshot.selection.basicAttackSkillKey);
    expect(permanentOrigins).toHaveLength(3);
    for (const origin of permanentOrigins) {
      const ability = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(origin.abilityRef)!;
      expect(ability).not.toBeNull();
      expect(ability[1]).toBe(origin.skillKey === 'item_3065_passive' ? 'source' : 'target');
      const mounted = prepared.compileRequest.combatants.find(row => row.key === ability[1])!.providers.find(row => row.providerRef === ability[2])!;
      const provider = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === mounted.definitionRef)!;
      const initializer = provider.abilities!.find(row => row.abilityKey === ability[3])!;
      expect(initializer.skillKey).toBe(origin.skillKey);
      expect(initializer.listenerSpec!.eventMatcher.all).toEqual(['event/source_initialized', 'event/source_owner']);
      const operation = initializer.listenerSpec!.operations.find(row => row.ref === origin.operationRef)!;
      expect(operation).toMatchObject({ operation: 'apply_provider', target: 'self', ref: origin.operationRef });
      const applied = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === operation.providerDefinitionRef)!;
      expect(applied.skillKey).toBe(origin.skillKey);
      expect(applied.modifiers![0]!.modifierKey).toBe(origin.resultKey);
      expect(origin.compiledPaths.every(path => /\.abilities\[\d+\]\.listenerSpec\.operations\[\d+\]$/.test(path))).toBe(true);
    }
    const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
    const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
    const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw new Error('原生编译缺少会话');
    try {
      const { runRequest } = await continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 }, compiled.sessionId);
      const done = parseDoneResult(bridge.run(runRequest));
      expect(assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins).issues).toEqual([]);
      const initialized = done.evidence.items.filter(row => row.kind === 'source_initialized');
      expect(initialized).toHaveLength(2);
      expect(initialized.map(row => row.ref).sort()).toEqual(['source', 'target']);
      for (const actor of done.finalSnapshot.combatants) {
        for (const provider of actor.providers.filter(row => row.definitionRef.includes('/'))) {
          expect(provider.owner).toBe(actor.key);
          expect(provider.source).toBe(actor.key);
        }
      }
      const wrong = structuredClone(prepared.operationOrigins);
      wrong.find(row => row.skillKey === 'item_3110_passive')!.operationRef = 'skills.item_3110_passive.effects.wrong.results.wrong';
      expect(assessContinuousAttackResult(prepared.compileRequest, runRequest, done, wrong).issues.some(issue => issue.includes('operationOrigins'))).toBe(true);
    } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };
