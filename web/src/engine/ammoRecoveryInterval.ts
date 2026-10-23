import type { Attribute } from '../types/attribute';
import type { GenericFormulaExpr } from '../types/genericEngine';
import type { SkillInternalState } from '../types/skillInternalState';
import { skillFormulaReachableInputs, validateStoredSkillFormula } from '../services/skillFormulaContract';
import { compileNumericValue, compileParameter, NumericAdaptationError, type NumericCompileState } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

/** 只补实际读取本拥有者当前总属性的弹药回充；静态值返回undefined并沿原整数门。 */
export function compileDynamicAmmoRecoveryInterval(row: SkillInternalState, state: NumericCompileState, path: string,
  attributes?: readonly Attribute[]): GenericFormulaExpr | undefined {
  if (row.stateType !== 'AMMO') return undefined;
  const value = row.detail.recoveryIntervalValue;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '弹药回充必须保留明确数值声明');
  if (value.kind !== 'FORMULA') return undefined;
  const matches = state.formulas?.filter(formula => formula.formulaKey === value.formulaKey) ?? [];
  if (matches.length !== 1) fail(path, '弹药回充公式缺失或重复');
  const formula = matches[0]!;
  const issue = validateStoredSkillFormula(formula.expression, state.skillKey);
  if (issue) fail(path + '.expression' + issue.path, issue.code);
  // 没有真实可达属性读取的表达式继续原静态核定路径，不借闲置声明开启动态权限。
  if (!skillFormulaReachableInputs(formula.expression).some(input => input.binding.kind === 'attribute')) return undefined;
  if (Object.keys(value).some(key => key !== 'kind' && key !== 'formulaKey')) fail(path, '弹药回充公式引用含未授权字段');
  if (typeof state.gameId !== 'string' || !state.gameId || typeof state.skillKey !== 'string' || !state.skillKey
    || row.gameId !== state.gameId || row.skillKey !== state.skillKey || row.scope !== 'SKILL'
    || formula.gameId !== state.gameId || formula.skillKey !== state.skillKey
    || typeof row.stateKey !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(row.stateKey)
    || !Number.isSafeInteger(state.skillLevel) || state.skillLevel < 1
    || !Number.isSafeInteger(state.characterLevel) || state.characterLevel < 1) fail(path, '弹药回充需要真实本技能身份和实际等级');
  const scoped: NumericCompileState = { ...state,
    formulaNamespace: `ammo-recovery/${encodeURIComponent(state.gameId)}/${encodeURIComponent(state.skillKey)}/levels/${state.skillLevel}/${state.characterLevel}/state/${row.stateKey}`,
    bindParameters: false, allowAttributeReads: true,
    sceneParameterValues: undefined, runtimeInputReads: undefined, processStartStateBindings: undefined, allowedContextKeys: undefined };
  // 核对全部声明，包括条件两支及非输出阶段；不让隐藏运行输入或其它对象借公式透传。
  for (const input of formula.expression.inputs) {
    const binding = input.binding;
    if (binding.kind === 'attribute') {
      if (binding.object !== 'source' || binding.view !== 'current_frame' || binding.valueKind !== 'TOTAL') {
        fail(path, '动态弹药回充只读取本拥有者当前总属性');
      }
      const entries = attributes?.filter(attribute => attribute.attributeKey === binding.attributeKey) ?? [];
      if (entries.length !== 1 || entries[0]!.gameId !== state.gameId || entries[0]!.status !== 'ENABLED'
        || !['INTEGER', 'DECIMAL'].includes(entries[0]!.valueType)) fail(path, '动态回充缺少同游戏唯一已启用的真实数值属性目录');
    } else if (binding.kind === 'parameter') {
      const parameters = state.parameters?.filter(parameter => parameter.parameterKey === binding.parameterKey) ?? [];
      if (binding.skillKey !== state.skillKey || parameters.length !== 1 || parameters[0]!.gameId !== state.gameId
        || parameters[0]!.skillKey !== state.skillKey || !['INTEGER', 'DECIMAL'].includes(parameters[0]!.valueType)
        || !['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL'].includes(parameters[0]!.valueMode)) {
        fail(path, '动态回充只接受本技能已供值的固定或实际等级参数');
      }
      compileParameter(binding.parameterKey, path + '.parameters.' + binding.parameterKey, scoped, fail);
    } else fail(path, '动态回充不能读取事件、状态、过程或其它运行上下文');
  }
  // 共享原公式表及同键冲突检查。只登记完整公式，不预算AH、不添加默认值或修改已预约等待。
  return compileNumericValue(value, path, scoped, fail);
}
