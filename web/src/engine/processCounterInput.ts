import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillProcess } from '../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { NumericValue } from '../types/numericValue';
import type { Expression } from '../types/formulaContract.generated';
import type { GenericFormulaExpr } from '../types/genericEngine';
import { skillFormulaParameterKeys, validateStoredSkillFormula } from '../services/skillFormulaContract';
import { compileParameter, constExpr, NumericAdaptationError, type NumericCompileState } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

/** 真实首次过程只读本技能计数；它是帧内读取，不伪装为静态能力参数。 */
export function processCounterReads(process: SkillProcess, rules: readonly SkillTriggerRuleDetail[],
  states: readonly SkillInternalState[], numeric: NumericCompileState): Record<string, GenericFormulaExpr> {
  const reads: Record<string, GenericFormulaExpr> = {};
  for (const rule of rules) for (const action of rule.actions) {
    for (const binding of action.runtimeInputBindings) {
      if (binding.sourceType !== 'INTERNAL_STATE') continue;
      const path = `skills.${numeric.skillKey}.triggerRules.${rule.ruleKey}.actions.${action.actionKey}.runtimeInputBindings.${binding.bindingKey}`;
      const detail = binding.detail;
      const state = states.find(row => row.stateKey === detail.stateKey);
      const matches = numeric.parameters?.filter(row => row.parameterKey === binding.parameterKey) ?? [];
      const parameter = matches[0];
      if (action.actionType !== 'START_PROCESS' || action.detail.processKey !== process.processKey
        || rule.eventSource.eventType !== 'SKILL_USED' || rule.eventSource.detail.sourceSkillKey !== numeric.skillKey
        || rule.eventSource.detail.useKind !== 'ACTIVE' || rule.eventSource.detail.castPhase !== 'INITIAL'
        || action.targetContext !== 'CURRENT_TARGET' || action.resultModifiers.length || detail.stateSkillKey !== numeric.skillKey
        || state?.stateType !== 'COUNTER' || state.scope !== 'SKILL' || detail.valueKind !== 'VALUE' || detail.optionKey !== null
        || matches.length !== 1 || !parameter || parameter.gameId !== numeric.gameId || parameter.skillKey !== numeric.skillKey
        || parameter.valueMode !== 'RUNTIME_INPUT' || parameter.valueType !== 'INTEGER' || parameter.fixedValue !== null || parameter.levelValues !== null) {
        fail(path, '首次过程状态输入只允许本技能自身整数计数的当前值与无默认整数参数');
      }
      if (Object.keys(binding).some(key => !['bindingKey', 'parameterKey', 'sourceType', 'detail'].includes(key))
        || Object.keys(detail).some(key => !['stateSkillKey', 'stateKey', 'valueKind', 'optionKey'].includes(key))
        || typeof binding.bindingKey !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(binding.bindingKey)
        || Object.prototype.hasOwnProperty.call(reads, binding.parameterKey)
        || Object.prototype.hasOwnProperty.call(numeric.runtimeInputReads ?? {}, binding.parameterKey)) fail(path, '状态输入形状或参数绑定重复');
      const consumed = process.stateOperations.some(operation => operation.operation === 'SET'
        && operation.moment.momentType === 'PROCESS_START' && operation.moment.stepKey === null && operation.moment.failureReason == null
        && operation.value && (operation.value.kind === 'PARAMETER' ? operation.value.parameterKey === binding.parameterKey
          : operation.value.kind === 'FORMULA' && (numeric.formulas ?? []).some(formula => formula.formulaKey === (operation.value as Extract<NumericValue, {kind: 'FORMULA'}>).formulaKey
            && skillFormulaParameterKeys(formula.expression).includes(binding.parameterKey))));
      if (!consumed) fail(path, '状态输入必须被真实过程开始的计数设置实际消费');
      reads[binding.parameterKey] = { op: 'read', path: `provider.state.${detail.stateKey}` };
    }
  }
  return reads;
}

/** 有界降低仅用于付款帧计数 SET；其它共同公式仍走原生具名公式。 */
export function compileProcessCounterValue(value: NumericValue, path: string, numeric: NumericCompileState): GenericFormulaExpr {
  const parameter = (key: string): GenericFormulaExpr => {
    const matches = numeric.parameters?.filter(row => row.parameterKey === key) ?? [];
    if (matches.length !== 1) fail(path, '计数公式参数缺失或重复');
    const row = matches[0]!;
    if (row.gameId !== numeric.gameId || row.skillKey !== numeric.skillKey) fail(path, '计数公式不允许跨技能参数');
    if (row.valueMode === 'RUNTIME_INPUT') {
      const read = numeric.runtimeInputReads?.[key];
      if (row.valueType !== 'INTEGER' || !read || read.op !== 'read' || !/^provider\.state\.[a-z][a-z0-9_]{0,63}$/.test(read.path ?? '')) fail(path, '计数公式只允许已绑定的本技能整数状态输入');
      return structuredClone(read);
    }
    const expression = compileParameter(key, path, { ...numeric, bindParameters: false, sceneParameterValues: undefined });
    if (expression.op !== 'const' || !Number.isSafeInteger(expression.value)) fail(path, '计数公式静态参数必须为安全整数');
    return expression;
  };
  if (value.kind === 'PARAMETER') return parameter(value.parameterKey);
  if (value.kind === 'FIXED') {
    if (!Number.isSafeInteger(value.value) || value.value < 0) fail(path, '计数设置需要非负安全整数');
    return constExpr(value.value);
  }
  const matches = numeric.formulas?.filter(row => row.formulaKey === value.formulaKey) ?? [];
  if (matches.length !== 1) fail(path, '计数公式缺失或重复');
  const formula = matches[0]!;
  if (formula.gameId !== numeric.gameId || formula.skillKey !== numeric.skillKey) fail(path, '计数公式必须属于本技能');
  const issue = validateStoredSkillFormula(formula.expression, numeric.skillKey);
  if (issue) fail(path + issue.path, issue.code);
  const inputs = new Map(formula.expression.inputs.map(input => {
    if (input.binding.kind !== 'parameter' || input.binding.skillKey !== numeric.skillKey) fail(path, '计数公式不允许属性或上下文读取');
    return [input.key, parameter(input.binding.parameterKey)];
  }));
  const stages = new Map(formula.expression.stages.map(stage => [stage.key, stage.expression]));
  let nodes = 0;
  const expand = (expression: Expression, depth: number): GenericFormulaExpr => {
    if (++nodes > 512 || depth > 32) fail(path, '计数公式展开超过限制');
    if (expression.op === 'const') {
      const number = Number(expression.value);
      if (!Number.isSafeInteger(number)) fail(path, '计数公式常量必须为安全整数');
      return constExpr(number);
    }
    if (expression.op === 'read') return structuredClone(inputs.get(expression.inputKey)!);
    if (expression.op === 'ref') return expand(stages.get(expression.stageKey)!, depth + 1);
    if (!['if', 'eq', 'add'].includes(expression.op) || !('args' in expression)) fail(path, '计数设置仅授权条件、等值与加法');
    return { op: expression.op, args: expression.args.map(child => expand(child, depth + 1)) };
  };
  // 未使用的阶段也不能藏入额外读取或算子。
  formula.expression.stages.forEach(stage => expand(stage.expression, 1));
  nodes = 0;
  return expand(stages.get(formula.expression.outputStageKey)!, 1);
}
