import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { simulationConditionalHitComposition } from '../../tests/fixtures/simulationConditionalHitComposition';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { TinyGoV2Bridge } from '../../tests/fixtures/authorizedBridge';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { skillActionRequest, type SkillActionInput } from './skillActionRequest';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { conditionalHitContributionAuthorMatches } from './basicAttackContributionContract';
import { assessSkillActionResult } from './skillActionResult';
import type { CompileRequest, RunRequest } from '../types/genericEngine';
import { formulaValue } from '../types/numericValue';

let bridge: TinyGoV2Bridge;
beforeAll(async () => { bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,'
  + readFileSync(new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url)).toString('base64') }); });
type Snapshot = ReturnType<typeof simulationConditionalHitComposition>['snapshot'];
function prepare(snapshot: Snapshot) {
  approveSnapshotFixture(snapshot);
  const drafts = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) drafts[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, drafts, { source: 300, target: 590 });
}
function cast(skillKey: 'armed_bonus' | 'contact_spell', atMs: number, instructionKey = skillKey): SkillActionInput {
  return { origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey, skillLevel: skillKey === 'armed_bonus' ? 2 : 1,
    instructionKey, atMs, sortOrder: 0, targetSide: skillKey === 'armed_bonus' ? 'source' : 'target',
    hitPreset: skillKey === 'armed_bonus' ? null : 'TARGET_HIT', phaseKind: 'INITIAL', parentInstructionKey: null };
}
async function request(prepared: ReturnType<typeof prepare>, snapshot: Snapshot, actions: SkillActionInput[], durationMs: number) {
  return (await skillActionRequest(prepared, snapshot, { actions, durationMs, recordTimeSeries: false, attackSpeedInputMax: 5,
    maxSkillActionRecords: 32, maxSkillUseRecords: 128, maxHealingRecords: 32 })).runRequest;
}
function run(input: CompileRequest, request: RunRequest) {
  const compiled = parseCompileResult(bridge.compile(input));
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
  expect(compiled.sessionId).toBeTruthy(); request.sessionId = compiled.sessionId!;
  try { return parseDoneResult(bridge.run(request)); }
  finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId!, input.rulesHash)).released).toBe(true); }
}
function resolvers(input: CompileRequest) {
  return input.sharedProviders!.flatMap(provider => provider.abilities?.flatMap(ability => ability.operations?.flatMap(operation =>
    operation.skillHit ? [{ provider, ability, hit: operation.skillHit }] : []) ?? []) ?? []);
}
describe('自身计数命中组成与结束冷却的生产接线', () => {
  it('无普攻且无接触时仍编译唯一到期尾，合法重置休眠且不吞掉非法重置', async () => {
    const { snapshot, window } = simulationConditionalHitComposition(false, false, false);
    const prepared = prepare(snapshot), input = prepared.compileRequest;
    const provider = input.sharedProviders!.find(row => row.skillKey === 'armed_bonus')!;
    expect(provider.initialStateSchema!.armed!.onExpire).toHaveLength(1);
    expect(JSON.stringify(provider.processes)).not.toContain('cooldown_change');
    expect(prepared.coverage.some(row => /未选择普攻/.test(row.note ?? ''))).toBe(true);
    const done = run(input, await request(prepared, snapshot, [cast('armed_bonus', 50), cast('armed_bonus', 200, 'during'),
      cast('armed_bonus', 550, 'exact'), cast('armed_bonus', 1250, 'ready')], 1251));
    expect(done.skillActionRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ instructionKey: 'during', outcome: 'REJECTED', reason: 'condition_false' }),
      expect.objectContaining({ instructionKey: 'exact', outcome: 'REJECTED', reason: 'cooldown_not_ready' }),
      expect.objectContaining({ instructionKey: 'ready', outcome: 'ACCEPTED' })
    ]));
    window.effects.find(row => row.effectKey === 'reset')!.results[0]!.target = 'TARGET';
    expect(() => prepare(snapshot)).toThrow(/普攻计时重置/);
  });

  it('明确技能与普攻共用真实武装，原作者参数不落入父技能，消费后不重复', async () => {
    const { snapshot } = simulationConditionalHitComposition(false, true, false);
    const prepared = prepare(snapshot), input = prepared.compileRequest;
    const plan = resolvers(input).find(row => row.hit.skillKey === 'contact_spell')!;
    const contribution = plan.hit.candidates.find(row => row.effectOccurrenceKey.startsWith('hit_component/'))!;
    expect(contribution.participationProviderRef).toBeTruthy();
    expect(contribution.operations[0]!.amount).toBeDefined();
    expect(JSON.stringify(contribution.operations)).not.toMatch(/ability\.param|"op":"ref"/);
    const done = run(input, await request(prepared, snapshot, [cast('armed_bonus', 50), cast('contact_spell', 100), cast('contact_spell', 1100, 'second')], 1300));
    const rows = done.damageRecords!.filter(row => row.operationRef === 'skills.armed_bonus.effects.extra.results.damage');
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ timeMs: 200, rawAmount: 12 });
    expect(done.summary.execution.complete).toBe(true);
  });

  it('自然到期在精确同刻技能接触前执行，期限上不再附伤', async () => {
    const { snapshot } = simulationConditionalHitComposition(false, true, false);
    const prepared = prepare(snapshot);
    const done = run(prepared.compileRequest, await request(prepared, snapshot, [cast('armed_bonus', 50), cast('contact_spell', 450)], 551));
    expect(done.damageRecords!.filter(row => row.operationRef === 'skills.armed_bonus.effects.extra.results.damage')).toEqual([]);
    expect(done.damageRecords).toEqual(expect.arrayContaining([expect.objectContaining({ timeMs: 550, rawAmount: 100 })]));
  });

  it('普攻先消费后明确技能不重复，两个入口保留各自真实接触', async () => {
    const { snapshot } = simulationConditionalHitComposition(true, true, false);
    // 只由附伤使用的共同防御读取也必须进入显式场景要求。
    snapshot.catalogs.attributes.push(...['magic_pen_percent', 'magic_pen_flat'].map(attributeKey => ({
      ...snapshot.catalogs.attributes[0]!, attributeKey, name: attributeKey
    })));
    snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === 'pure')!.formula!.formula = {
      inputs: ['magic_pen_percent', 'magic_pen_flat'].map(key => ({ key, binding: {
        kind: 'attribute', object: 'source', attributeKey: key, valueKind: 'TOTAL', view: 'current_frame'
      } })), stages: [{ key: 'factor', name: '独立防御读取', expression: { op: 'sub', args: [{ op: 'const', value: '1' },
        { op: 'add', args: [{ op: 'read', inputKey: 'magic_pen_percent' }, { op: 'read', inputKey: 'magic_pen_flat' }] }] } }], outputStageKey: 'factor'
    };
    const prepared = prepare(snapshot);
    expect(prepared.compileRequest.combatants[0]!.attributes.magic_pen_percent!.resolved).toBe(0);
    expect(prepared.compileRequest.combatants[0]!.attributes.magic_pen_flat!.resolved).toBe(0);
    const runRequest = await request(prepared, snapshot, [cast('armed_bonus', 50), cast('contact_spell', 100)], 250);
    const done = run(prepared.compileRequest, runRequest);
    const rows = done.damageRecords!.filter(row => row.operationRef === 'skills.armed_bonus.effects.extra.results.damage');
    expect(rows).toEqual([expect.objectContaining({ timeMs: 50, rawAmount: 12, attackIndex: 2 })]);
    expect(done.damageRecords).toEqual(expect.arrayContaining([expect.objectContaining({ timeMs: 200, rawAmount: 100, attackIndex: null })]));
    expect(assessSkillActionResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins).issues).toEqual([]);
  });

  it('明确技能主伤与武装附伤同击仅消费一个真实法盾，接触仍消费武装', async () => {
    const { snapshot } = simulationConditionalHitComposition(false, true, false, true);
    const prepared = prepare(snapshot);
    const runRequest = await request(prepared, snapshot, [cast('armed_bonus', 50), cast('contact_spell', 100), cast('armed_bonus', 201, 'cooldown')], 250);
    runRequest.recordBudget!.maxMechanicRecords = 32;
    const done = run(prepared.compileRequest, runRequest);
    expect(done.damageRecords).toEqual([]);
    expect(done.skillActionRecords).toEqual(expect.arrayContaining([expect.objectContaining({ instructionKey: 'cooldown', reason: 'cooldown_not_ready' })]));
    expect(done.evidence.items.filter(row => row.ref === 'event/spell_shield_blocked')).toHaveLength(1);
  });

  it.each([0, 100])('结束冷却按本技能参数和当前急速%s取整，不能读取父技能同名值', async haste => {
    const { snapshot, window } = simulationConditionalHitComposition(false, false, false);
    const metadata = window.parameters[0]!;
    window.parameters.push({ ...metadata, parameterKey: 'end_base', valueMode: 'FIXED', fixedValue: 700.49, levelValues: null });
    window.formulas.push({ ...window.formulas[0]!, formulaKey: 'end_cd', expression: {
      inputs: [{ key: 'base', binding: { kind: 'parameter', skillKey: 'armed_bonus', parameterKey: 'end_base' } },
        { key: 'haste', binding: { kind: 'attribute', object: 'source', attributeKey: 'haste', valueKind: 'TOTAL', view: 'current_frame' } }],
      stages: [{ key: 'duration', name: '实际结束冷却', expression: { op: 'div', args: [{ op: 'read', inputKey: 'base' },
        { op: 'add', args: [{ op: 'const', value: '1' }, { op: 'div', args: [{ op: 'read', inputKey: 'haste' }, { op: 'const', value: '100' }] }] }] } }],
      outputStageKey: 'duration' } });
    window.effects.find(row => row.effectKey === 'end_cooldown')!.results[0]!.valueRule!.value = formulaValue('end_cd');
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'haste', name: '当前急速' });
    snapshot.source.selectedLevelValues.haste = haste;
    const prepared = prepare(snapshot), readyAtMs = 550 + Math.max(1, Math.round(700.49 / (1 + haste / 100)));
    const done = run(prepared.compileRequest, await request(prepared, snapshot, [cast('armed_bonus', 50),
      cast('armed_bonus', readyAtMs - 1, 'before_ready'), cast('armed_bonus', readyAtMs, 'ready')], readyAtMs + 1));
    expect(done.skillActionRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ instructionKey: 'before_ready', reason: 'cooldown_not_ready' }),
      expect.objectContaining({ instructionKey: 'ready', outcome: 'ACCEPTED' })
    ]));
  });

  it('有条件跨作者归属保留真实挂载与父命中，伪造来源拒绝', () => {
    const { snapshot } = simulationConditionalHitComposition();
    const prepared = prepare(snapshot), input = prepared.compileRequest;
    const origin = prepared.operationOrigins.find(row => row.skillKey === 'armed_bonus' && row.resultKey === 'damage'
      && row.compiledPaths.some(path => path.includes('.skillHit.candidates[')))!;
    const path = origin.compiledPaths[0]!, abilityPath = path.slice(0, path.indexOf('.operations['));
    const indices = /^sharedProviders\[(\d+)\]\.abilities\[(\d+)\]$/.exec(abilityPath)!;
    const ability = input.sharedProviders![Number(indices[1])]!.abilities![Number(indices[2])]!;
    const check = () => conditionalHitContributionAuthorMatches(input, origin, ability, abilityPath, 'source', prepared.basicAttackBinding!.hitAbilityRef);
    expect(check()).toBe(true);
    const candidate = ability.operations!.flatMap(row => row.skillHit?.candidates ?? []).find(row => row.effectOccurrenceKey.startsWith('hit_component/'))!;
    candidate.participationProviderRef = 'forged'; expect(check()).toBe(false);
  });

  it('同次普攻的生产者和跟随者共享阻挡，未武装时跟随者不被其它盾事实误挡', async () => {
    const { snapshot } = simulationConditionalHitComposition(true, false, true, true);
    const prepared = prepare(snapshot), input = prepared.compileRequest;
    const parent = resolvers(input).find(row => row.hit.skillKey === 'parent_attack')!;
    const producer = parent.hit.candidates.find(row => row.effectOccurrenceKey.includes('/basic_damage/'))!;
    const follower = parent.hit.candidates.find(row => row.spellShieldFollowCandidateKey)!;
    expect(follower.spellShieldFollowCandidateKey).toBe(producer.candidateKey);
    const runRequest = await request(prepared, snapshot, [cast('armed_bonus', 50)], 100);
    const done = run(input, runRequest);
    const followRows = done.damageRecords!.filter(row => row.operationRef === 'skills.follow_bonus.effects.extra.results.damage');
    expect(followRows).toEqual([expect.objectContaining({ timeMs: 0, rawAmount: 12 })]);
    expect(done.damageRecords!.some(row => row.operationRef === 'skills.armed_bonus.effects.extra.results.damage')).toBe(false);
    const shield = input.sharedProviders!.find(row => row.types?.includes('provider/spell_shield'))!;
    expect(done.finalSnapshot.combatants[1]!.providers.some(row => row.definitionRef === shield.providerKey)).toBe(false);
  });

  it.each(['disabled', 'unplanned', 'zero'] as const)('生产者%s只省略跟随引用，不隐式启用来源', kind => {
    const { snapshot } = simulationConditionalHitComposition(true, false, true);
    const setting = snapshot.selection.sourceSkillSettings.find(row => row.skillKey === 'armed_bonus')!;
    snapshot.selection.plannedSkills = [];
    if (kind === 'disabled') setting.enabled = false;
    if (kind === 'zero') setting.skillLevel = 0;
    syncSimulationSkillSources(snapshot);
    const prepared = prepare(snapshot);
    const candidates = resolvers(prepared.compileRequest).flatMap(row => row.hit.candidates);
    expect(candidates.some(row => row.spellShieldFollowCandidateKey !== undefined)).toBe(false);
    expect(prepared.compileRequest.sharedProviders!.some(row => row.skillKey === 'armed_bonus')).toBe(false);
  });

  it.each(['missing', 'self', 'chain', 'owner'] as const)('跟随%s引用拒绝', kind => {
    const { snapshot, window } = simulationConditionalHitComposition();
    const follower = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'follow_bonus')!.effects[0]!.results[0]!;
    if (follower.resultType !== 'DAMAGE') throw new Error('fixture');
    if (kind === 'missing') follower.detail.spellShieldFollowResult!.resultKey = 'missing';
    if (kind === 'self') follower.detail.spellShieldFollowResult!.skillKey = 'follow_bonus';
    if (kind === 'chain') {
      const producer = window.effects[0]!.results[0]!;
      if (producer.resultType !== 'DAMAGE') throw new Error('fixture');
      producer.detail.spellShieldFollowResult = { skillKey: 'follow_bonus', effectKey: 'extra', resultKey: 'damage' };
    }
    if (kind === 'owner') snapshot.source.attachedSkills = snapshot.source.attachedSkills.filter(row => row.skillKey !== 'armed_bonus');
    expect(() => prepare(snapshot)).toThrow();
  });
});
