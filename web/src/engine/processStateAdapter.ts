import type { ProviderDefinition, OperationDefinition } from '../types/genericEngine';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillProcessStateOperation } from '../types/skillProcess';
import type { NumericValue } from '../types/numericValue';
import { compileNumericValue, constExpr, NumericAdaptationError, staticNumericField, tryFoldConstant, type NumericCompileState } from './numericAdapter';
import { validateStateInitialBinding } from './stateInitialParameterBinding';
import { compileProcessCounterValue } from './processCounterInput';
import { skillFormulaParameterKeys } from '../services/skillFormulaContract';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: object, keys: string[], path: string) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, '未接入的内部状态字段');
}
function integer(value: NumericValue, path: string, state: NumericCompileState, minimum = 0): number {
  const expression = compileNumericValue(value, path, { ...state, bindParameters: false, allowAttributeReads: false }, fail);
  const result = tryFoldConstant(expression);
  if (result === null || !Number.isSafeInteger(result) || result < minimum) fail(path, '内部状态需要明确的合法非负整数');
  return result;
}

export function compileStateFieldSchema(row: SkillInternalState, state: NumericCompileState, path: string,
  sceneValues: Readonly<Record<string, number>> = {}): NonNullable<ProviderDefinition['initialStateSchema']>[string] {
  if (row.stateType !== 'COUNTER' && row.stateType !== 'AMMO') fail(path, '这里只编译计数或弹药字段');
  const initialState = (field: 'initialValue' | 'initialRemainingValue') => {
    const bindingField = field === 'initialValue' ? 'initialValueBinding' : 'initialRemainingMsBinding';
    const binding = validateStateInitialBinding(row, field, state.parameters ?? [], state.gameId, state.skillKey, `${path}.detail.${bindingField}`);
    if (!binding) return { ...state, sceneParameterValues: undefined };
    const value = sceneValues[binding.parameterKey];
    if (!Object.prototype.hasOwnProperty.call(sceneValues, binding.parameterKey) || !Number.isSafeInteger(value)
      || value! < binding.detail.minValue || value! > binding.detail.maxValue) fail(`${path}.detail.${field}`, '场景状态初值缺失或不满足声明范围，不能补零');
    return { ...state, sceneParameterValues: { [binding.parameterKey]: value! } };
  };
  const initialNumeric = initialState('initialValue');
  const initial = integer(row.detail.initialValue, `${path}.detail.initialValue`, initialNumeric);
  const staticState = { ...state, sceneParameterValues: undefined };
  const maximum = integer(row.detail.maxValue, `${path}.detail.maxValue`, staticState);
  if (initial > maximum) fail(path, '状态初值不能超过上限');
  if (row.stateType === 'COUNTER') {
    exact(row.detail, ['initialValue', 'initialValueBinding', 'maxValue', 'durationValue'], `${path}.detail`);
    const duration = row.detail.durationValue == null ? 0 : integer(row.detail.durationValue, `${path}.detail.durationValue`, staticState);
    return { valueType: 'integer', defaultValue: staticNumericField(row.detail.initialValue, `${path}.detail.initialValue`, initialNumeric),
      maxValue: staticNumericField(row.detail.maxValue, `${path}.detail.maxValue`, staticState),
      durationMs: row.detail.durationValue == null ? 0 : staticNumericField(row.detail.durationValue, `${path}.detail.durationValue`, staticState),
      ...(duration > 0 ? { refreshPolicy: 'refresh_on_write' } : {}) };
  }
  exact(row.detail, ['initialValue', 'initialValueBinding', 'initialRemainingValue', 'initialRemainingMsBinding', 'maxValue',
    'recoveryIntervalValue', 'recoveryMode', 'recoveryStartCondition'], `${path}.detail`);
  if (row.scope !== 'SKILL' || maximum < 1) fail(path, '弹药必须是技能自身状态且容量为正整数');
  const interval = integer(row.detail.recoveryIntervalValue, `${path}.detail.recoveryIntervalValue`, staticState, 1);
  const one = row.detail.recoveryMode === 'ONE_BY_ONE' && row.detail.recoveryStartCondition === 'AFTER_CONSUME';
  const all = row.detail.recoveryMode === 'ALL_AT_ONCE' && row.detail.recoveryStartCondition === 'WHEN_EMPTY';
  if (!one && !all) fail(path, '弹药只接入逐枚消耗后恢复或整匣耗尽恢复');
  if (!one && (row.detail.initialRemainingValue !== undefined || row.detail.initialRemainingMsBinding !== undefined)) fail(path, '整匣弹药不能声明逐枚初充余时');
  const remainingState = initialState('initialRemainingValue');
  const remaining = row.detail.initialRemainingValue === undefined ? undefined
    : integer(row.detail.initialRemainingValue, `${path}.detail.initialRemainingValue`, remainingState);
  if (one && initial < maximum && remaining === undefined) fail(path, '欠弹必须明确初充余时，零也须自行声明');
  if (remaining !== undefined && (remaining > interval || initial === maximum && remaining !== 0)) fail(path, '初充余时不得超过完整间隔，满弹只能为零或不声明');
  // 用相同的核定整数保证主动与自然分支共享同一库存定义，不携带分支专属公式引用。
  return { valueType: 'integer', stateKind: 'ammo', defaultValue: initial, maxValue: maximum,
    ammoRecovery: { intervalMs: constExpr(interval), mode: one ? 'one_by_one' : 'all_at_once', startCondition: one ? 'after_consume' : 'when_empty',
      ...(one && initial < maximum ? { initialRemainingMs: remaining! } : {}) } };
}

/** 状态留在作者技能的父供值器；动态效果实例不能接管作者状态。 */
export function compileProcessStates(states: readonly SkillInternalState[], state: NumericCompileState, root: string,
  sceneValues: Readonly<Record<string, number>> = {}, dynamicState?: NumericCompileState) {
  const schema: NonNullable<ProviderDefinition['initialStateSchema']> = {};
  const byKey = new Map<string, SkillInternalState>();
  for (const row of states) {
    const path = `${root}.${row.stateKey}`;
    exact(row, ['gameId', 'skillKey', 'stateKey', 'stateType', 'scope', 'detail', 'name', 'description', 'sortOrder', 'createdAt', 'updatedAt'], path);
    if (row.gameId !== state.gameId || row.skillKey !== state.skillKey || !/^[a-z][a-z0-9_]{0,63}$/.test(row.stateKey)
      || !['SKILL', 'TARGET'].includes(row.scope) || byKey.has(row.stateKey)) fail(path, '内部状态必须有唯一的同技能身份及明确范围');
    byKey.set(row.stateKey, row);
    if (row.stateType === 'COUNTER' || row.stateType === 'AMMO') {
      schema[row.stateKey] = compileStateFieldSchema(row, state, path, sceneValues);
    } else if (row.stateType === 'FLAG') {
      exact(row.detail, ['initialEnabled'], `${path}.detail`);
      if (typeof row.detail.initialEnabled !== 'boolean') fail(path, '标志必须有明确初值');
      schema[row.stateKey] = { valueType: 'number', defaultValue: row.detail.initialEnabled ? 1 : 0, maxValue: 1, durationMs: 0 };
    } else if (row.stateType === 'INTERNAL_COOLDOWN') {
      exact(row.detail, ['durationValue'], `${path}.detail`);
      integer(row.detail.durationValue, `${path}.detail.durationValue`, state, 1);
      schema[row.stateKey] = { valueType: 'number', defaultValue: 0, maxValue: 1, stateKind: 'cooldown',
        durationMs: staticNumericField(row.detail.durationValue, `${path}.detail.durationValue`, state), refreshPolicy: 'start_on_first_write' };
    } else fail(path, '主动过程尚未接入该内部状态种类');
  }
  const scopes = new Set<string>();
  return { schema, scopes, operation(row: SkillProcessStateOperation, path: string): OperationDefinition {
    exact(row, ['operationKey', 'stateSkillKey', 'stateKey', 'moment', 'operation', 'value', 'optionKey', 'name', 'sortOrder'], path);
    const definition = byKey.get(row.stateKey);
    if (!definition || row.stateSkillKey !== state.skillKey || row.optionKey !== null) fail(path, '内部状态操作必须引用本技能已声明状态，不能跨技能写入');
    let policy = 'set';
    let amount;
    if (definition.stateType === 'COUNTER' && ['INCREASE', 'DECREASE', 'CONSUME', 'SET'].includes(row.operation) && row.value) {
      const value = row.value;
      const keys = value.kind === 'PARAMETER' ? [value.parameterKey] : value.kind === 'FORMULA'
        ? (state.formulas ?? []).filter(formula => formula.formulaKey === value.formulaKey).flatMap(formula => skillFormulaParameterKeys(formula.expression)) : [];
      const dynamic = dynamicState && keys.some(key => Object.prototype.hasOwnProperty.call(dynamicState.runtimeInputReads, key));
      if (dynamic) {
        if (row.operation !== 'SET' || definition.scope !== 'SKILL' || row.moment.momentType !== 'PROCESS_START'
          || row.moment.stepKey !== null || row.moment.failureReason != null) fail(path, '动态计数输入只允许真实过程开始的自身计数设置');
        amount = compileProcessCounterValue(value, `${path}.value`, dynamicState);
      } else {
        integer(value, `${path}.value`, state);
        amount = compileNumericValue(value, `${path}.value`, state, fail);
      }
      if (row.operation !== 'SET') policy = 'add';
      if (row.operation === 'DECREASE' || row.operation === 'CONSUME') amount = { op: 'mul', args: [constExpr(-1), amount] };
    } else if (definition.stateType === 'AMMO' && row.operation === 'CONSUME' && row.value
      && row.moment.momentType === 'PROCESS_START' && row.moment.stepKey === null && row.moment.failureReason == null
      && integer(row.value, `${path}.value`, state) === 1) {
      policy = 'add'; amount = constExpr(-1);
    } else if (definition.stateType === 'FLAG' && ['ENABLE', 'DISABLE'].includes(row.operation) && row.value === null) {
      amount = constExpr(row.operation === 'ENABLE' ? 1 : 0);
    } else if (definition.stateType === 'INTERNAL_COOLDOWN' && ['START', 'RESET'].includes(row.operation) && row.value === null) {
      amount = constExpr(row.operation === 'START' ? 1 : 0);
    } else return fail(path, '状态操作与已声明种类不一致');
    const scope = definition.scope === 'TARGET' ? 'state_scope/provider_target' : 'state_scope/provider';
    scopes.add(scope);
    return { operation: 'state_change', target: 'self', ref: row.stateKey, valuePolicy: policy, amount, types: [scope] };
  } };
}
