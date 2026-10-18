import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { simulationTargetAttributeHit } from '../../tests/fixtures/simulationTargetAttributeHit';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { skillActionRequest } from './skillActionRequest';
import { assessSkillActionResult } from './skillActionResult';
import { TinyGoV2Bridge } from './tinygoV2Bridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import type { CompileRequest, RunRequest } from '../types/genericEngine';

let bridge: TinyGoV2Bridge;
beforeAll(async () => { bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,'
  + readFileSync(new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url)).toString('base64') }); });
function prepare(snapshot: ReturnType<typeof simulationTargetAttributeHit>['snapshot']) {
  approveSnapshotFixture(snapshot);
  const values = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) values[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, values, { source: 300, target: 500 });
}
function run(input: CompileRequest, request: RunRequest) {
  const compiled = parseCompileResult(bridge.compile(input));
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true); expect(compiled.sessionId).toBeTruthy();
  request.sessionId = compiled.sessionId!;
  try { return parseDoneResult(bridge.run(request)); }
  finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId!, input.rulesHash)).released).toBe(true); }
}
async function requestFor(snapshot: ReturnType<typeof simulationTargetAttributeHit>['snapshot'], prepared: ReturnType<typeof prepare>,
  durationMs = 1, missed = false, recast = false) {
  const plan = snapshot.selection.plannedSkills[0]!;
  return (await skillActionRequest(prepared, snapshot, { durationMs, recordTimeSeries: false, maxSkillActionRecords: 64,
    maxSkillUseRecords: 64, maxHealingRecords: 64, actions: (recast ? [0, 1500] : [0]).map((atMs, index) => ({ ...plan,
      instructionKey: `cast_${index}`, atMs, sortOrder: index, targetSide: 'target', phaseKind: 'INITIAL', parentInstructionKey: null,
      hitPreset: missed ? 'MISS' : 'TARGET_HIT' })) })).runRequest;
}

describe('真实命中内的有限目标属性', () => {
  it('改变的目标属性必须存在或由本场显式提供，不能借用攻击方同名属性', () => {
    const { snapshot } = simulationTargetAttributeHit();
    delete snapshot.target.selectedLevelValues.magic_resistance;
    approveSnapshotFixture(snapshot);
    const requirement = inspectSimulationSnapshot(snapshot).requirements.find(row => row.side === 'target' && row.attribute.attributeKey === 'magic_resistance');
    expect(requirement).toBeTruthy(); expect(requirement!.storedValue).toBeUndefined();
    const values = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined
      && !(row.side === 'target' && row.attribute.attributeKey === 'magic_resistance')) values[row.side][row.attribute.attributeKey] = 0;
    expect(() => assembleSimulation(snapshot, values, { source: 300, target: 500 })).toThrow(/有限数值/);
  });
  it.each(['shred_alpha', 'debuff_beta'])('%s先提交双抗下降，再由原伤害读取新护甲', async skillKey => {
    const { snapshot } = simulationTargetAttributeHit(skillKey);
    const prepared = prepare(snapshot);
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    const definition = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
    const hit = definition.abilities!.find(row => row.abilityKey === 'selected_skill_hit')!.operations![0]!.skillHit!;
    expect(hit.candidates.map(row => row.semantic.resultType)).toEqual(['ATTRIBUTE_CHANGE', 'ATTRIBUTE_CHANGE', 'DAMAGE']);
    expect(hit.candidates.slice(0, 2).every(row => row.operations[0]!.operation === 'apply_provider' && row.operations[0]!.target === 'target')).toBe(true);
    const request = await requestFor(snapshot, prepared);
    const done = run(prepared.compileRequest, request);
    expect(done.damageRecords).toHaveLength(1);
    expect(done.damageRecords![0]!.postDefenseDamage).toBeCloseTo(100 * 100 / 118, 10);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.attributes.armor!.resolved).toBe(18);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.attributes.magic_resistance!.resolved).toBe(28);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'source')!.attributes.armor!.resolved)
      .toBe(prepared.compileRequest.combatants.find(row => row.key === 'source')!.attributes.armor!.resolved);
    expect(assessSkillActionResult(prepared.compileRequest, request, done, prepared.operationOrigins).issues).toEqual([]);
  });

  it('目标护甲可变负，并由本夹具作者防御公式真实读取', async () => {
    const { snapshot } = simulationTargetAttributeHit(); snapshot.target.selectedLevelValues.armor = 5;
    const prepared = prepare(snapshot), request = await requestFor(snapshot, prepared);
    const done = run(prepared.compileRequest, request);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.attributes.armor!.resolved).toBe(-7);
    expect(done.damageRecords![0]!.postDefenseDamage).toBeCloseTo(100 * 100 / (100 - 7), 10);
  });

  it.each([1999, 2000])('%sms按真实期限恢复双抗，不能把减防永久写入角色', async duration => {
    const { snapshot } = simulationTargetAttributeHit(); const prepared = prepare(snapshot);
    const done = run(prepared.compileRequest, await requestFor(snapshot, prepared, duration));
    const target = done.finalSnapshot.combatants.find(row => row.key === 'target')!;
    expect(target.attributes.armor!.base).toBe(30); expect(target.attributes.magic_resistance!.base).toBe(40);
    expect(target.attributes.armor!.resolved).toBe(duration < 2000 ? 18 : 30);
    expect(target.attributes.magic_resistance!.resolved).toBe(duration < 2000 ? 28 : 40);
  });

  it.each([3499, 3500])('重复命中刷新全部期限，%sms核对无额外叠层', async duration => {
    const { snapshot } = simulationTargetAttributeHit(); const prepared = prepare(snapshot);
    const done = run(prepared.compileRequest, await requestFor(snapshot, prepared, duration, false, true));
    expect(done.damageRecords).toHaveLength(2);
    expect(done.damageRecords!.every(row => Math.abs(row.postDefenseDamage - 100 * 100 / 118) < 1e-9)).toBe(true);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.attributes.armor!.resolved).toBe(duration < 3500 ? 18 : 30);
  });

  it('未命中既不减双抗，也不结算整段伤害', async () => {
    const { snapshot } = simulationTargetAttributeHit(); const prepared = prepare(snapshot);
    const request = await requestFor(snapshot, prepared, 1, true), done = run(prepared.compileRequest, request);
    expect(done.damageRecords).toHaveLength(0);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.attributes.armor!.resolved).toBe(30);
    expect(assessSkillActionResult(prepared.compileRequest, request, done, prepared.operationOrigins).issues).toEqual([]);
  });

  it.each(['ratio', 'stage', 'foreign', 'mixed', 'shield', 'hp', 'dynamic'] as const)('拒绝%s超出有期目标平加边界的配置', variant => {
    const { snapshot, configuration } = simulationTargetAttributeHit();
    const effect = configuration.effects.find(row => row.effectKey === 'reduce_armor')!;
    const zone = snapshot.catalogs.modifierZones.find(row => row.modifierZoneKey === 'target_flat')!;
    if (variant === 'ratio') zone.calculationMode = 'RATIO_ADD';
    if (variant === 'stage') zone.applicationStage = 'ATTRIBUTE_PERCENT';
    if (variant === 'foreign') zone.gameId = 'other';
    if (variant === 'mixed') effect.results.push({ ...structuredClone(effect.results[0]!), resultKey: 'other' });
    if (variant === 'shield') effect.lifecycle!.endWhenShieldEndsResultKey = 'other';
    if (variant === 'hp' && effect.results[0]!.resultType === 'ATTRIBUTE_CHANGE') effect.results[0]!.detail.attributeKey = 'hp';
    if (variant === 'dynamic') effect.lifecycle!.durationValue = { kind: 'ATTRIBUTE', subject: 'SOURCE', attributeKey: 'attack_damage', attributeValueKind: 'TOTAL' };
    expect(() => prepare(snapshot)).toThrow();
  });
});
