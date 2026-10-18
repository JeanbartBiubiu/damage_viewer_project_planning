import type { CompileRequest, DoneResult, DriverPlan, MechanicRecord, ProcessInstanceSnapshot, ProviderStateFieldSchema, RunRequest } from '../types/genericEngine';
import { tryFoldConstant } from './numericAdapter';
import { simulationAbility } from './simulationAdapter';

type ActiveAmmo = {
  owner: 'source'; providerRef: string; providerDefinitionRef: string; skillKey: string; stateKey: string;
  processKey: string; initial: number; maximum: number; oneByOne: boolean; initialRemainingMs: number | null;
  recoveryPath: string; consumptionPath: string;
};
const finiteInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const staticValue = (value: ProviderStateFieldSchema['defaultValue'] | undefined) => typeof value === 'number' ? value : value ? tryFoldConstant(value) : null;
const identity = (row: Pick<MechanicRecord, 'owner' | 'providerRef' | 'providerDefinitionRef' | 'skillKey' | 'stateKey'>) =>
  JSON.stringify([row.owner, row.providerRef, row.providerDefinitionRef, row.skillKey, row.stateKey]);

/** 只登记本次首次指令或自动规则实际驱动的主动弹药，不从全部供值器推定执行资格。 */
export function drivenActiveAmmo(compile: CompileRequest, driver: DriverPlan): ActiveAmmo[] {
  const keys = new Set([...(driver.skillActions ?? []).filter(row => row.action === 'INITIAL').map(row => row.bindingKey),
    ...(driver.automaticSkills?.rules ?? []).map(row => row.bindingKey)]);
  const contexts = new Map<string, ActiveAmmo>();
  for (const key of keys) {
    const binding = compile.rules.skillActionBindings?.find(row => row.bindingKey === key);
    const control = binding?.controls.find(row => row.action === 'INITIAL');
    const actual = control && simulationAbility(compile, control.abilityRef);
    if (!binding || !control || !actual) throw new Error('mechanicRecords.binding: 实际首次绑定不存在');
    const fields = Object.entries(actual.provider.initialStateSchema ?? {}).filter((row): row is [string, ProviderStateFieldSchema] =>
      typeof row[1] === 'object' && row[1].stateKind === 'ammo');
    if (!fields.length) continue;
    if (fields.length !== 1 || binding.source !== 'source' || actual.mount.providerRef !== binding.providerRef
      || actual.mount.definitionRef !== binding.providerDefinitionRef || actual.ability.skillKey !== binding.skillKey
      || actual.ability.kind !== 'active' || actual.ability.processControl?.action !== 'INITIAL'
      || actual.ability.processControl.processKey !== control.processKey || actual.ability.processControl.useRefFromEvent) {
      throw new Error('mechanicRecords.binding: 弹药必须属于同一真实主动首次、供值实例和过程');
    }
    const [stateKey, field] = fields[0]!;
    const initial = staticValue(field.defaultValue); const maximum = staticValue(field.maxValue);
    const recovery = field.ammoRecovery;
    const initialRemainingMs = recovery?.initialRemainingMs === undefined ? null : staticValue(recovery.initialRemainingMs);
    const oneByOne = recovery?.mode === 'one_by_one' && recovery.startCondition === 'after_consume';
    if (!finiteInteger(initial) || !finiteInteger(maximum) || maximum < 1 || initial > maximum
      || !recovery || recovery.initialRemainingMs !== undefined && !finiteInteger(initialRemainingMs)
      || !oneByOne && !(recovery.mode === 'all_at_once' && recovery.startCondition === 'when_empty')) {
      throw new Error('mechanicRecords.declaration: 弹药容量、初值或恢复模式不合法');
    }
    const providerIndex = compile.sharedProviders!.indexOf(actual.provider);
    const consumption: string[] = [];
    actual.provider.processes?.forEach((process, processIndex) => process.momentOperations.forEach((group, groupIndex) =>
      group.operations.forEach((operation, operationIndex) => {
        if (operation.operation !== 'state_change' || operation.ref !== stateKey) return;
        if (process.processKey !== control.processKey || process.skillKey !== binding.skillKey || group.moment.momentType !== 'PROCESS_START'
          || group.moment.stepKey !== null || group.moment.failureReason != null || operation.condition
          || !['source', 'self'].includes(operation.target) || !operation.types?.includes('state_scope/provider')
          || operation.valuePolicy !== 'add' || !operation.amount || tryFoldConstant(operation.amount) !== -1) {
          throw new Error('mechanicRecords.consumption: 弹药必须由自身首次过程开始无条件消费一枚');
        }
        consumption.push(`sharedProviders[${providerIndex}].processes[${processIndex}].momentOperations[${groupIndex}].operations[${operationIndex}]`);
      })));
    if (consumption.length !== 1) throw new Error('mechanicRecords.consumption: 缺少唯一的真实过程开始消费');
    const context: ActiveAmmo = { owner: binding.source, providerRef: binding.providerRef, providerDefinitionRef: binding.providerDefinitionRef,
      skillKey: binding.skillKey, stateKey, processKey: control.processKey, initial, maximum, oneByOne, initialRemainingMs,
      consumptionPath: consumption[0]!, recoveryPath: `sharedProviders[${providerIndex}].initialStateSchema.${stateKey}.ammoRecovery` };
    contexts.set(identity(context), context);
  }
  return [...contexts.values()];
}

/** 主动库存记录保留原提交顺序；截断时仅核对保留前缀，不补造尾部事实。 */
export function inspectActiveAmmoMechanics(compile: CompileRequest, request: RunRequest, done: DoneResult,
  processes: ProcessInstanceSnapshot[], records: MechanicRecord[] = done.mechanicRecords ?? []): string[] {
  const issues: string[] = [];
  const check = (valid: boolean, path: string, message: string) => { if (!valid) issues.push(`${path}: ${message}`); };
  try {
    const contexts = drivenActiveAmmo(compile, request.driverPlan);
    const states = new Map(contexts.map(context => {
      const mount = request.initialSnapshot.combatants.find(row => row.key === context.owner)?.providers.find(row =>
        row.providerRef === context.providerRef && row.definitionRef === context.providerDefinitionRef);
      const initial = mount && Object.prototype.hasOwnProperty.call(mount.state, context.stateKey) ? mount.state[context.stateKey] : context.initial;
      if (!mount || !finiteInteger(initial) || initial > context.maximum) throw new Error('mechanicRecords.initial: 真实初态库存或实例不合法');
      if (context.oneByOne && initial < context.maximum && context.initialRemainingMs === null) throw new Error('mechanicRecords.initial: 初始欠弹必须声明明确的初充余时');
      const state = { context, inventory: initial, waiting: false, waitReadyAt: null as number | null, pendingRecovery: null as MechanicRecord | null,
        initialWaitRemaining: context.oneByOne && initial < context.maximum ? context.initialRemainingMs : null,
        expectedStartAt: initial < context.maximum && (context.oneByOne || initial === 0) ? 0 as number | null : null,
        consumedUses: new Set<string>() };
      return [identity(context), state] as const;
    }));
    let previousAt = 0;
    for (const [index, row] of records.entries()) {
      const path = `mechanicRecords[${index}]`;
      if (!row || typeof row !== 'object') { check(false, path, '缺少机制记录对象'); continue; }
      const state = states.get(identity(row));
      check(finiteInteger(row.timeMs) && row.timeMs >= previousAt && row.timeMs <= done.summary.durationMs, path, '机制时刻不合法或逆序');
      previousAt = row.timeMs;
      if (!state) { check(false, path, '机制身份不属于本次实际驱动的主动弹药实例'); continue; }
      const { context } = state;
      const before = row.beforeValue; const after = row.afterValue;
      check(finiteInteger(before) && finiteInteger(after) && before <= context.maximum && after <= context.maximum, path, '库存必须为容量内非负整数');
      check(row.useRef === null || typeof row.useRef === 'string' && !!row.useRef, path, '使用身份必须明确为空或真实标识');
      if (state.pendingRecovery && row.kind !== 'WAIT_ENDED') check(false, path, '同一实例的恢复变化后缺少配对完成记录');
      if (state.expectedStartAt !== null && row.kind !== 'WAIT_STARTED') check(false, path, '同一实例缺少已提交的回充启动');
      if (row.kind === 'WAIT_STARTED') {
        check(row.operationRef === context.recoveryPath && row.useRef === null && before === after && before === state.inventory
          && before < context.maximum && (context.oneByOne || before === 0) && !state.waiting
          && state.expectedStartAt === row.timeMs && finiteInteger(row.readyAtMs)
          && (state.initialWaitRemaining === null || row.readyAtMs === row.timeMs + state.initialWaitRemaining)
          && (context.oneByOne ? row.readyAtMs >= row.timeMs : row.readyAtMs > row.timeMs), path, '等待必须来自真实恢复声明及当前欠弹库存');
        state.waiting = true; state.waitReadyAt = row.readyAtMs; state.expectedStartAt = null; state.initialWaitRemaining = null;
      } else if (row.kind === 'STATE_CHANGED' && row.useRef !== null) {
        const process = processes.find(process => process.useKey === row.useRef && process.owner === context.owner
          && process.providerRef === context.providerRef && process.skillKey === context.skillKey && process.processKey === context.processKey
          && process.startedAtMs === row.timeMs);
        check(!!process && !state.consumedUses.has(row.useRef) && row.operationRef === context.consumptionPath && row.readyAtMs === null
          && before === state.inventory && before > 0 && after === before - 1, path, '消费必须对应同刻真实首次过程及唯一消费路径');
        state.consumedUses.add(row.useRef); state.inventory = after;
        if (!state.waiting && (context.oneByOne || after === 0)) state.expectedStartAt = row.timeMs;
      } else if (row.kind === 'STATE_CHANGED' && row.useRef === null) {
        check(row.operationRef === context.recoveryPath && row.readyAtMs === row.timeMs && before === state.inventory && state.waiting
          && before < context.maximum && (context.oneByOne ? after === before + 1 && state.waitReadyAt !== null && row.timeMs <= state.waitReadyAt
            : before === 0 && after === context.maximum && state.waitReadyAt === row.timeMs),
        path, '恢复变化必须来自实际等待，逐枚加一或整匣补满');
        state.inventory = after; state.waiting = false; state.waitReadyAt = null; state.pendingRecovery = row;
      } else if (row.kind === 'WAIT_ENDED') {
        const recovery = state.pendingRecovery;
        check(!!recovery && row.useRef === null && row.operationRef === context.recoveryPath && row.readyAtMs === row.timeMs
          && row.timeMs === recovery.timeMs && before === recovery.beforeValue && after === recovery.afterValue,
        path, '恢复完成必须与同一实例刚提交的库存恢复配对');
        state.pendingRecovery = null;
        if (context.oneByOne && after < context.maximum) state.expectedStartAt = row.timeMs;
      } else check(false, path, '未知主动弹药机制记录种类');
    }
    if (done.recording?.mechanicRecordsTruncated === false) for (const state of states.values()) {
      const { context } = state;
      check(!state.pendingRecovery && state.expectedStartAt === null, 'mechanicRecords', '完整记录缺少恢复完成或回充启动');
      const actualUses = processes.filter(process => process.owner === context.owner && process.providerRef === context.providerRef
        && process.skillKey === context.skillKey && process.processKey === context.processKey);
      check(actualUses.length === state.consumedUses.size && actualUses.every(process => state.consumedUses.has(process.useKey)),
        'mechanicRecords.useRef', '完整记录必须保留每次真实首次过程的弹药消费');
      const finalActor = done.finalSnapshot.combatants.find(row => row.key === context.owner);
      const mounted = finalActor?.providers.some(row => row.providerRef === context.providerRef && row.definitionRef === context.providerDefinitionRef);
      const actorsLive = (['source', 'target'] as const).every(side => {
        const hp = done.finalSnapshot.combatants.find(row => row.key === side)?.attributes.hp?.current;
        return typeof hp === 'number' && hp > 0;
      });
      if (done.summary.execution?.complete === true && actorsLive && mounted) check(!state.waiting
        || finiteInteger(state.waitReadyAt) && state.waitReadyAt > done.summary.durationMs,
      'mechanicRecords.waiting', '完整观察终点包含到期事件，存活且仍挂载的实例不能遗漏到期恢复');
      const bag = finalActor?.providerState[context.providerRef] as { state?: Record<string, unknown> } | undefined;
      check(bag?.state?.[context.stateKey] === state.inventory, 'mechanicRecords.inventory', '完整库存变化与最终真实状态不一致');
    }
  } catch (cause) { issues.push(cause instanceof Error ? cause.message : String(cause)); }
  return issues;
}
