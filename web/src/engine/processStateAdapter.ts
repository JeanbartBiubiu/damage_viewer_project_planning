import type { ProviderDefinition, OperationDefinition } from '../types/genericEngine';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillProcessStateOperation } from '../types/skillProcess';
import type { NumericValue } from '../types/numericValue';
import { compileNumericValue, constExpr, NumericAdaptationError, staticNumericField, tryFoldConstant, type NumericCompileState } from './numericAdapter';

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

/** 状态留在作者技能的父供值器；动态效果实例不能接管作者状态。 */
export function compileProcessStates(states: readonly SkillInternalState[], state: NumericCompileState, root: string) {
  const schema: NonNullable<ProviderDefinition['initialStateSchema']> = {};
  const byKey = new Map<string, SkillInternalState>();
  for (const row of states) {
    const path = `${root}.${row.stateKey}`;
    exact(row, ['gameId', 'skillKey', 'stateKey', 'stateType', 'scope', 'detail', 'name', 'description', 'sortOrder', 'createdAt', 'updatedAt'], path);
    if (row.gameId !== state.gameId || row.skillKey !== state.skillKey || !/^[a-z][a-z0-9_]{0,63}$/.test(row.stateKey)
      || !['SKILL', 'TARGET'].includes(row.scope) || byKey.has(row.stateKey)) fail(path, '内部状态必须有唯一的同技能身份及明确范围');
    byKey.set(row.stateKey, row);
    if (row.stateType === 'COUNTER') {
      exact(row.detail, ['initialValue', 'maxValue', 'durationValue'], `${path}.detail`);
      const initial = integer(row.detail.initialValue, `${path}.detail.initialValue`, state);
      const maximum = integer(row.detail.maxValue, `${path}.detail.maxValue`, state);
      if (initial > maximum) fail(path, '计数初值不能超过上限');
      const duration = row.detail.durationValue == null ? 0 : integer(row.detail.durationValue, `${path}.detail.durationValue`, state);
      schema[row.stateKey] = { valueType: 'integer', defaultValue: staticNumericField(row.detail.initialValue, `${path}.detail.initialValue`, state),
        maxValue: staticNumericField(row.detail.maxValue, `${path}.detail.maxValue`, state),
        durationMs: row.detail.durationValue == null ? 0 : staticNumericField(row.detail.durationValue, `${path}.detail.durationValue`, state),
        ...(duration > 0 ? { refreshPolicy: 'refresh_on_write' } : {}) };
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
      integer(row.value, `${path}.value`, state);
      amount = compileNumericValue(row.value, `${path}.value`, state, fail);
      if (row.operation !== 'SET') policy = 'add';
      if (row.operation === 'DECREASE' || row.operation === 'CONSUME') amount = { op: 'mul', args: [constExpr(-1), amount] };
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
