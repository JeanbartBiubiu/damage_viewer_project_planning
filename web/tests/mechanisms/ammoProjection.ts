import type { CompileRequest, DoneResult, RunRequest } from '../../src/types/genericEngine';
import { drivenActiveAmmo, inspectActiveAmmoMechanics } from '../../src/engine/simulationAmmoMechanics';

type AmmoIdentity = { owner: 'source'; source: 'source'; providerRef: string; providerDefinitionRef: string;
  bindingKey: string; skillKey: string; processKey: string; stateKey: string };
export type ProjectedAmmoMechanic = AmmoIdentity & { timeMs: number; kind: 'STATE_CHANGED' | 'WAIT_STARTED' | 'WAIT_ENDED';
  operationRole: 'consume' | 'recovery'; beforeValue: number; afterValue: number; useRef: string | null; readyAtMs: number | null };
export type ProjectedFinalAmmo = AmmoIdentity & { inventory: number; maximum: number; waiting: boolean; readyAtMs: number | null };

function fail(message: string): never { throw new Error(`ammoProjection: ${message}`); }
function one<T>(rows: T[], label: string): T {
  if (rows.length !== 1) fail(`${label}必须唯一`);
  return rows[0]!;
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const identityKey = (row: { owner: string; providerRef: string; providerDefinitionRef: string; skillKey: string; stateKey: string }) =>
  JSON.stringify([row.owner, row.providerRef, row.providerDefinitionRef, row.skillKey, row.stateKey]);

/** 仅供显式声明完整弹药期望的手动固定用例；原记录顺序不排序，不求值回充公式或推测截止。 */
export function projectActiveAmmo(compile: CompileRequest, request: RunRequest, done: DoneResult): {
  ammoMechanics: ProjectedAmmoMechanic[]; finalAmmo: ProjectedFinalAmmo[];
} {
  if (!Array.isArray(done.mechanicRecords) || !Array.isArray(done.skillActionRecords)
    || !Array.isArray(done.finalSnapshot.processInstances)) fail('缺少真实机制、接纳或过程明细');
  const records = done.mechanicRecords, actions = done.skillActionRecords, processes = done.finalSnapshot.processInstances;
  const recording = done.recording;
  if (!recording || recording.mechanicRecordsTruncated !== false || recording.droppedMechanicRecords !== 0
    || recording.mechanicRecordCount !== records.length || recording.returnedMechanicRecords !== records.length
    || recording.skillActionRecordsTruncated !== false || recording.droppedSkillActionRecords !== 0
    || recording.skillActionRecordCount !== actions.length || recording.returnedSkillActionRecords !== actions.length) fail('弹药和实际接纳记录必须完整且未截断');
  const contexts = drivenActiveAmmo(compile, request.driverPlan);
  if (!contexts.length) fail('显式弹药期望缺少实际驱动INITIAL绑定');
  const issues = inspectActiveAmmoMechanics(compile, request, done, processes, records);
  if (issues.length) fail(issues.join(';'));
  const trails = new Map(contexts.map(context => {
    const initialActor = one(request.initialSnapshot.combatants.filter(row => row.key === context.owner), '初始拥有者');
    const initial = one(initialActor.providers.filter(row => row.providerRef === context.providerRef && row.definitionRef === context.providerDefinitionRef), '初始真实挂载');
    const finalActor = one(done.finalSnapshot.combatants.filter(row => row.key === context.owner), '最终拥有者');
    const final = one(finalActor.providers.filter(row => row.providerRef === context.providerRef && row.definitionRef === context.providerDefinitionRef), '最终真实挂载');
    if (initial.owner !== context.owner || initial.source !== context.owner || initial.expireAt !== null
      || final.owner !== context.owner || final.source !== context.owner || final.expireAt !== null) fail('弹药必须留在真实同拥有者永久父来源');
    const definition = one((compile.sharedProviders ?? []).filter(row => row.providerKey === context.providerDefinitionRef), '真实弹药定义');
    if (definition.lifecycle || definition.kind === 'status') fail('动态或有限实例不能冒充永久弹药父来源');
    const keys = new Set((request.driverPlan.skillActions ?? []).filter(row => row.action === 'INITIAL').map(row => row.bindingKey));
    const binding = one((compile.rules.skillActionBindings ?? []).filter(row => keys.has(row.bindingKey) && row.source === context.owner
      && row.providerRef === context.providerRef && row.providerDefinitionRef === context.providerDefinitionRef && row.skillKey === context.skillKey
      && row.controls.some(control => control.action === 'INITIAL' && control.processKey === context.processKey)), '实际手动INITIAL绑定');
    const identity: AmmoIdentity = { owner: context.owner, source: initial.source, providerRef: context.providerRef,
      providerDefinitionRef: context.providerDefinitionRef, bindingKey: binding.bindingKey,
      skillKey: context.skillKey, processKey: context.processKey, stateKey: context.stateKey };
    const initialValue = Object.prototype.hasOwnProperty.call(initial.state, context.stateKey) ? initial.state[context.stateKey] : context.initial;
    if (!integer(initialValue)) fail('初始真实库存不合法');
    const trail = { context, identity, finalActor, inventory: initialValue, waiting: false, readyAtMs: null as number | null };
    return [identityKey(context), trail] as const;
  }));
  const ammoMechanics = records.map(row => {
    const trail = trails.get(identityKey(row));
    if (!trail) return fail('额外机制记录没有实际弹药归属');
    const { context, identity } = trail;
    let operationRole: ProjectedAmmoMechanic['operationRole'];
    if (row.operationRef === context.consumptionPath) {
      operationRole = 'consume';
      if (row.kind !== 'STATE_CHANGED' || typeof row.useRef !== 'string' || !row.useRef) fail('消费缺少真实使用');
      const accepted = one(actions.filter(action => action.action === 'INITIAL' && action.outcome === 'ACCEPTED' && action.useRef === row.useRef), '实际INITIAL接纳');
      const planned = one((request.driverPlan.skillActions ?? []).filter(action => action.instructionKey === accepted.instructionKey), '原始手动计划');
      const control = one(one((compile.rules.skillActionBindings ?? []).filter(binding => binding.bindingKey === identity.bindingKey), '消费控制绑定')
        .controls.filter(control => control.action === 'INITIAL' && control.processKey === context.processKey), '真实INITIAL控制');
      const process = one(processes.filter(process => process.useKey === row.useRef), '真实消费过程');
      if (accepted.reason !== null || accepted.bindingKey !== identity.bindingKey || accepted.skillKey !== context.skillKey
        || accepted.source !== context.owner || accepted.providerRef !== context.providerRef || accepted.providerDefinitionRef !== context.providerDefinitionRef
        || accepted.actualAtMs !== row.timeMs || planned.action !== 'INITIAL' || planned.bindingKey !== identity.bindingKey
        || planned.abilityRef !== control.abilityRef || planned.skillKey !== context.skillKey || planned.source !== context.owner
        || planned.firstAtMs !== accepted.requestedAtMs || planned.target !== accepted.target
        || planned.parentInstructionKey !== null || accepted.parentInstructionKey !== null || process.target !== accepted.target
        || process.owner !== context.owner || process.providerRef !== context.providerRef || process.skillKey !== context.skillKey
        || process.processKey !== context.processKey || process.startedAtMs !== row.timeMs) fail('消费不能借伪使用、其它计划或错误拥有者/控制');
    } else if (row.operationRef === context.recoveryPath) operationRole = 'recovery';
    else return fail('机制操作不是该实际编译消费或恢复路径');
    trail.inventory = row.afterValue;
    if (row.kind === 'WAIT_STARTED') { trail.waiting = true; trail.readyAtMs = row.readyAtMs; }
    if (row.kind === 'WAIT_ENDED') { trail.waiting = false; trail.readyAtMs = null; }
    return { ...identity, timeMs: row.timeMs, kind: row.kind, operationRole,
      beforeValue: row.beforeValue, afterValue: row.afterValue, useRef: row.useRef, readyAtMs: row.readyAtMs };
  });
  const finalAmmo = [...trails.values()].map(trail => {
    const bag = trail.finalActor.providerState[trail.context.providerRef] as { state?: Record<string, unknown> } | undefined;
    const inventory = bag?.state?.[trail.context.stateKey];
    if (!integer(inventory) || inventory !== trail.inventory || inventory > trail.context.maximum) fail('最终真实库存与完整记录不一致');
    return { ...trail.identity, inventory, maximum: trail.context.maximum, waiting: trail.waiting, readyAtMs: trail.readyAtMs };
  }).sort((a, b) => a.owner.localeCompare(b.owner) || a.providerRef.localeCompare(b.providerRef)
    || a.providerDefinitionRef.localeCompare(b.providerDefinitionRef) || a.skillKey.localeCompare(b.skillKey) || a.stateKey.localeCompare(b.stateKey));
  return { ammoMechanics, finalAmmo };
}
