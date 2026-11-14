import type { GenericFormulaExpr, SkillHitComparator } from '../types/genericEngine';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillTriggerInternalStateCheckCondition } from '../types/skillTriggerRule';
import { compileNumericValue, tryFoldConstant, type NumericCompileState } from './numericAdapter';

const COMPARATORS: Record<string, SkillHitComparator> = {
  LT: 'lt', LTE: 'lte', EQ: 'eq', NE: 'ne', GTE: 'gte', GT: 'gt'
};

/** 首次施放和真实命中共用本技能自身计数的当前值比较，静态门槛不借用事件输入。 */
export function compileSelfCounterCondition(
  condition: SkillTriggerInternalStateCheckCondition,
  definitions: readonly SkillInternalState[],
  state: NumericCompileState,
  path: string,
  fail: (path: string, message: string) => never
): GenericFormulaExpr {
  const detail = condition.detail;
  const matches = definitions.filter(row => row.stateKey === detail.stateKey);
  const definition = matches[0];
  if (matches.length !== 1 || !definition || definition.gameId !== state.gameId || definition.skillKey !== state.skillKey
    || detail.stateSkillKey !== state.skillKey || definition.stateType !== 'COUNTER' || definition.scope !== 'SKILL'
    || detail.valueKind !== 'VALUE' || detail.optionKey !== null || detail.expectedBoolean !== null
    || !detail.comparator || !COMPARATORS[detail.comparator] || !detail.comparisonValue
    || Object.keys(detail).some(key => !['stateSkillKey', 'stateKey', 'valueKind', 'optionKey', 'expectedBoolean', 'comparator', 'comparisonValue'].includes(key))) {
    fail(path, '状态比较仅允许本技能自身整数计数当前值');
  }
  const right = compileNumericValue(detail.comparisonValue!, `${path}.comparisonValue`,
    { ...state, bindParameters: false, allowAttributeReads: false, runtimeInputReads: undefined, sceneParameterValues: undefined }, fail);
  const threshold = tryFoldConstant(right);
  if (threshold === null || !Number.isSafeInteger(threshold) || threshold < 0) fail(path, '状态门槛必须为明确非负整数');
  return { op: COMPARATORS[detail.comparator!]!, args: [{ op: 'read', path: `provider.state.${detail.stateKey}` }, right] };
}
