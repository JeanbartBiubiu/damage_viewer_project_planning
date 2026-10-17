import { GenericEngineClient } from '../../src/engine/genericEngineClient';
import { simulationHash } from '../../src/engine/simulationHash';
import type { CompileRequest, DriverEntry, GenericFormulaExpr, OperationDefinition, RunRequest } from '../../src/types/genericEngine';

type Side = 'source' | 'target';
export type FirstHeroProbeOptions = {
  durationMs: number;
  casts: Array<{ skillKey: string; atMs: number; target: Side }>;
  plannedCasts?: Array<{ skillKey: string; atMs: number; target: Side; preset: 'TARGET_HIT' | 'MISS' | null }>;
  incoming?: Array<{ atMs: number; amount: number; damageType: string }>;
  cooldownResets?: Array<{ atMs: number; skillKey: string }>;
  providerStates?: Array<{ side: Side; skillKey: string; stateKey: string; value: number }>;
  attributeOverrides?: Array<{ side: Side; attributeKey: string; value: number }>;
  initialHealthRatios?: { source: number; target: number };
  targetShieldAmount?: number;
  spellShieldTarget?: boolean;
  iterations?: number;
};
const constant = (value: number): GenericFormulaExpr => ({ op: 'const', value });
let lastFailure: Record<string, unknown> | null = null;
export function firstHeroProtocolFailure() { return lastFailure ? structuredClone(lastFailure) : null; }

/**
 * 以真实作者编译闭包为底，补入明确的受控入伤和冷却重置。
 * 这是通用协议专项：无背景普攻，不替代保留AA的真实混合矩阵。
 * 不改作者数据，不伪造HTTP，不重写任何原技能operation或过程。
 */
export async function runFirstHeroProtocolProbe(baseCompile: CompileRequest, baseRun: RunRequest, options: FirstHeroProbeOptions) {
  lastFailure = null;
  const compile = structuredClone(baseCompile);
  const initial = structuredClone(baseRun.initialSnapshot);
  const client = new GenericEngineClient();
  const entries: DriverEntry[] = [];
  const uses: NonNullable<RunRequest['skillUses']> = [];
  const commands: NonNullable<RunRequest['processCommandFacts']> = [];
  const setup = { providerRef: 'first_hero_protocol_fixture', definitionRef: 'first_hero_protocol_fixture_definition' };
  const targetActor = compile.combatants.find(row => row.key === 'target')!;
  const sourceActor = compile.combatants.find(row => row.key === 'source')!;
  const fixture = { providerKey: setup.definitionRef, stableId: setup.definitionRef, kind: 'test_fixture',
    abilities: [] as NonNullable<CompileRequest['sharedProviders']>[number]['abilities'] };
  compile.sharedProviders ??= [];
  compile.sharedProviders.push(fixture);
  // 两侧用不同挂载，入伤实际归属于target，重置实际归属于source。
  for (const actor of [sourceActor, targetActor]) {
    actor.providers.push({ ...setup });
    initial.combatants.find(row => row.key === actor.key)!.providers.push({ ...setup, source: actor.key,
      owner: actor.key, stacks: 1, expireAt: null, state: {} });
  }
  function type(key: string, domain: string) {
    if (!compile.typeCatalog.types.some(row => row.key === key && row.domain === domain)) compile.typeCatalog.types.push({ key, domain });
  }
  type('ability/first_hero_fixture', 'ability'); type('damage_trait/origin_direct', 'damage_trait'); type('damage_trait/delivery_skill', 'damage_trait');
  function fixtureEntry(key: string, source: Side, target: Side, atMs: number, operation: OperationDefinition) {
    fixture.abilities!.push({ abilityKey: key, kind: 'active', types: ['ability/first_hero_fixture'], operations: [operation] });
    entries.push({ entryKey: key, abilityRef: `${source}.provider[${setup.providerRef}].ability[${key}]`, source, target, firstAtMs: atMs, priority: 10 });
  }
  for (const [index, cast] of options.casts.entries()) {
    const binding = compile.rules.skillActionBindings?.find(row => row.skillKey === cast.skillKey);
    const control = binding?.controls.find(row => row.action === 'INITIAL');
    if (!binding || !control || binding.hitBindings.length) throw new Error('通用过程条目只用于无终结命中绑定的真实自身技能；命中技能必须走正式skillActions');
    const entryKey = `real_cast_${index}`, useKey = `real_use_${index}`;
    entries.push({ entryKey, abilityRef: control.abilityRef, source: 'source', target: cast.target, firstAtMs: cast.atMs, priority: 0 });
    uses.push({ useKey, source: 'source', skillKey: cast.skillKey, historyState: 'complete', priorQualifiedContacts: [] });
    commands.push({ driverEntryKey: entryKey, useRef: useKey });
  }
  for (const [index, damage] of (options.incoming ?? []).entries()) fixtureEntry(`controlled_damage_${index}`, 'target', 'source', damage.atMs,
    { operation: 'damage', target: 'target', ref: `controlled_damage_${index}`, amount: constant(damage.amount), damageType: damage.damageType,
      types: ['damage_trait/origin_direct', 'damage_trait/delivery_skill'], vampQualification: 'RESOLVED', vampOverrides: [] });
  for (const [index, reset] of (options.cooldownResets ?? []).entries()) {
    const control = compile.rules.skillActionBindings?.find(row => row.skillKey === reset.skillKey)?.controls.find(row => row.action === 'INITIAL');
    if (!control) throw new Error('冷却重置缺少真实首次绑定');
    fixtureEntry(`controlled_reset_${index}`, 'source', 'source', reset.atMs,
      { operation: 'cooldown_change', target: 'self', abilityRef: control.abilityRef, valuePolicy: 'set_remaining', amount: constant(0) });
  }
  for (const override of options.providerStates ?? []) {
    const actor = compile.combatants.find(row => row.key === override.side)!;
    const mounts = actor.providers.filter(mount => compile.sharedProviders!.some(definition => definition.providerKey === mount.definitionRef
      && (definition.skillKey === override.skillKey || definition.processes?.some(process => process.skillKey === override.skillKey))
      && Object.prototype.hasOwnProperty.call(definition.initialStateSchema ?? {}, override.stateKey)));
    if (mounts.length !== 1) throw new Error('受控初值必须对应唯一真实同源状态');
    const provider = compile.sharedProviders!.find(row => row.providerKey === mounts[0]!.definitionRef)!;
    const field = provider.initialStateSchema![override.stateKey]!;
    provider.initialStateSchema![override.stateKey] = typeof field === 'number' ? override.value : { ...field, defaultValue: override.value };
  }
  for (const override of options.attributeOverrides ?? []) {
    const actor = initial.combatants.find(row => row.key === override.side)!;
    if (!actor.attributes[override.attributeKey]) throw new Error('受控属性必须已在真实编译输入中声明');
    actor.attributes[override.attributeKey] = { base: override.value, current: override.value, max: override.value, resolved: override.value };
    compile.combatants.find(row => row.key === override.side)!.attributes[override.attributeKey] = structuredClone(actor.attributes[override.attributeKey]!);
  }
  for (const side of ['source', 'target'] as const) {
    const hp = initial.combatants.find(row => row.key === side)!.attributes.hp!;
    hp.current = hp.max * (options.initialHealthRatios?.[side] ?? 1);
    compile.combatants.find(row => row.key === side)!.attributes.hp!.current = hp.current;
  }
  if (options.targetShieldAmount !== undefined) fixtureEntry('controlled_target_shield', 'target', 'target', 0,
    { operation: 'shield', target: 'self', shieldRef: 'controlled_target_shield', amount: constant(options.targetShieldAmount) });
  if (options.spellShieldTarget) {
    type('provider/spell_shield', 'provider'); type('event/spell_shield_blocked', 'event');
    const providerKey = 'controlled_spell_shield';
    compile.sharedProviders.push({ providerKey, kind: 'status', stableId: providerKey, types: ['provider/spell_shield'],
      listeners: [{ listenerKey: 'consume', eventMatcher: { all: ['event/spell_shield_blocked'] },
        operations: [{ operation: 'expire_provider', target: 'self', providerRefFromEvent: true }] }] });
    targetActor.providers.push({ providerRef: providerKey, definitionRef: providerKey });
    initial.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: providerKey, definitionRef: providerKey,
      source: 'target', owner: 'target', stacks: 1, expireAt: null, state: {} });
  }
  const plannedCasts = (options.plannedCasts ?? []).map((cast, index) => {
    const binding = compile.rules.skillActionBindings?.find(row => row.skillKey === cast.skillKey);
    const control = binding?.controls.find(row => row.action === 'INITIAL');
    if (!binding || !control || (binding.hitBindings.length ? cast.preset === null : cast.preset !== null)) throw new Error('受控固定指令必须对应真实首次绑定和预设');
    return { instructionKey: `controlled_cast_${index}`, firstAtMs: cast.atMs, sortOrder: index, source: 'source' as const, target: cast.target,
      skillKey: binding.skillKey, bindingKey: binding.bindingKey, action: 'INITIAL' as const, abilityRef: control.abilityRef,
      parentInstructionKey: null, hitBindings: binding.hitBindings.map(hit => ({ hitBindingKey: hit.hitBindingKey, preset: cast.preset! })) };
  });
  if (plannedCasts.length && entries.length) throw new Error('固定技能指令不能与外部条目混用；受控入伤与P命中用例分开');
  compile.rulesHash = await simulationHash({ boundary: 'controlled-protocol-probe', compile: { ...compile, rulesHash: '' }, options });
  initial.rulesHash = compile.rulesHash;
  const request: RunRequest = { ...baseRun, expectedRulesHash: compile.rulesHash, rulesHash: compile.rulesHash,
    initialSnapshot: initial, driverPlan: { entries, conditionRecheckIntervalMs: 100, ...(plannedCasts.length ? { skillActions: plannedCasts } : {}) }, skillUses: uses,
    skillHitFacts: [], attackStartFacts: [], processCommandFacts: commands, sessionId: '',
    stopPolicy: { durationMs: options.durationMs, stopOnTargetDeath: true, stopWhenNoEvents: false },
    recordBudget: { maxAttackRecords: 0, maxDamageRecords: 2000, maxMechanicRecords: 2000, maxSkillActionRecords: 0,
      maxSkillUseRecords: 2000, maxHealingRecords: 2000 } };
  let sessionId: string | null = null;
  const diagnostics: Record<string, unknown> = { compileRequest: compile, runRequest: request, options };
  try {
    const compiled = await client.compile(compile);
    diagnostics.compiled = compiled;
    if (!compiled.ok || !compiled.sessionId) throw new Error('受控协议编译失败：' + JSON.stringify(compiled));
    sessionId = request.sessionId = compiled.sessionId;
    const done = await client.run(request);
    diagnostics.done = done;
    if (!done.ok || done.summary.stopReason === 'budget_exceeded' || done.finalSnapshot.timeMs !== done.summary.durationMs
      || plannedCasts.length > 0 && (done.summary.execution?.complete !== true || done.summary.execution.budgetCause !== null)
      || !plannedCasts.length && (done.summary.stopReason !== 'duration_reached' || done.summary.durationMs !== options.durationMs
        || done.finalSnapshot.processInstances?.some(row => !['complete', 'failed'].includes(row.status)))) {
      throw new Error('受控协议运行未完整执行：' + JSON.stringify(done.summary));
    }
    const iterations = options.iterations ?? 2;
    if (iterations < 2) throw new Error('受控协议至少重复2次');
    for (let index = 1; index < iterations; index++) {
      if (JSON.stringify(done) !== JSON.stringify(await client.run(request))) throw new Error('受控协议同会话重复不一致');
    }
    const release = await client.release(sessionId, compile.rulesHash);
    if (!release.released) throw new Error('受控协议释放未确认'); sessionId = null;
    return { compileRequest: compile, runRequest: request, options, compiled, done, release, iterations,
      boundary: '真实作者编译闭包+明确受控协议构造；无背景普攻，不替代真实混合矩阵或目标方自主施法' };
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : String(error); lastFailure = diagnostics; throw error;
  } finally {
    if (sessionId && client.hasLiveWorker) diagnostics.failureRelease = await client.release(sessionId, compile.rulesHash);
    client.terminate();
  }
}
