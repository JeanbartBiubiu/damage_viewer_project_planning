import type { AuthoredProcessProgram } from './processAdapter';
import type { SkillEffect } from '../types/skillEffect';
import type { GenericFormulaExpr, GenericVampRule, OperationDefinition, ProviderDefinition, TypeCatalog } from '../types/genericEngine';
import { compileNumericValue, constExpr, finiteNumber, NumericAdaptationError, wrapValueRuleExpression, type NumericCompileState } from './numericAdapter';
import { staticEffectValue } from './staticEffectValue';
import { adaptDamageVamp } from './vampAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
export type FinitePeriodicCompilation = { provider: ProviderDefinition; operation: OperationDefinition; vampRules: GenericVampRule[];
  typeEntries: TypeCatalog['types']; effectKey: string };

/** 只降低完整有限单层的显式立即首跳；原延迟周期和状态锚入口不经过此分支。 */
export function compileFiniteImmediatePeriodic(effect: SkillEffect, state: NumericCompileState, authored: AuthoredProcessProgram): FinitePeriodicCompilation {
  const root = `skills.${state.skillKey}.effects.${effect.effectKey}`, life = effect.lifecycle, context = authored.hitContext;
  if (!life || effect.gameId !== state.gameId || effect.skillKey !== state.skillKey || (authored.owner ?? 'source') !== 'source'
    || !authored.providerDefinitionRef || !context?.vampRules || !context.skillCategoryKeys?.length
    || life.instanceScope !== 'SOURCE_TARGET' || life.firstPeriodicExecution !== 'IMMEDIATE'
    || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== 'REFRESH_ALL'
    || life.expiryMode !== 'ALL_AT_ONCE' || life.endWhenShieldEndsResultKey != null || !effect.results.length) {
    return fail(root, '立即首跳只接完整有限单层、同实际来源与对手的纯周期伤害');
  }
  const integer = (value: typeof life.durationValue, path: string) => {
    if (!value) return fail(path, '有限周期时长、间隔和层数必须完整');
    const number = staticEffectValue(value, path, state);
    if (!Number.isSafeInteger(number) || number <= 0) return fail(path, '有限周期需要静态正安全整数');
    return number;
  };
  const duration = integer(life.durationValue, root + '.lifecycle.durationValue');
  const interval = integer(life.periodicIntervalValue, root + '.lifecycle.periodicIntervalValue');
  if (integer(life.maxStacksValue, root + '.lifecycle.maxStacksValue') !== 1
    || integer(life.applicationStacksValue, root + '.lifecycle.applicationStacksValue') !== 1) fail(root, '立即周期必须单层且每次施加一层');
  const parent = authored.providerDefinitionRef, providerKey = `${parent}_${effect.effectKey}_periodic`;
  const operations: OperationDefinition[] = [], typeEntries: TypeCatalog['types'] = [];
  let vampRules: GenericVampRule[] | undefined;
  const abilityTypes = new Set<string>([`ability/skill/${state.skillKey}`]);
  const rename = (expression: GenericFormulaExpr, names: Map<string, string>): GenericFormulaExpr => ({ ...expression,
    ...(expression.ref && names.has(expression.ref) ? { ref: names.get(expression.ref)! } : {}),
    ...(expression.args ? { args: expression.args.map(row => rename(row, names)) } : {}) });
  for (const result of [...effect.results].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const path = `${root}.results.${result.resultKey}`, behavior = result.lifecycleBehavior;
    if (result.resultType !== 'DAMAGE' || result.target !== 'TARGET' || result.spellShieldBlockScope !== null || !result.valueRule
      || !behavior || behavior.moment !== 'PERIODIC' || behavior.valueReadMode !== 'MOMENT_EVALUATION'
      || behavior.stackValueMode !== null || behavior.reapplicationValueMode !== null || behavior.periodicExecutionMode !== 'ONCE_PER_INSTANCE'
      || result.detail.deliveryKind !== 'SKILL' || result.detail.originKind !== 'DIRECT') {
      fail(path, '立即周期只接完整每跳当前求值的单层直接技能伤害，不借用法盾、混合结果或快照');
    }
    const detail = result.detail;
    finiteNumber(result.valueRule.fixedMultiplier, path + '.valueRule.fixedMultiplier', fail);
    for (const key of ['fixedMinValue', 'fixedMaxValue'] as const) if (result.valueRule[key] !== null) finiteNumber(result.valueRule[key], path + '.valueRule.' + key, fail);
    if (result.valueRule.fixedMinValue !== null && result.valueRule.fixedMaxValue !== null && result.valueRule.fixedMinValue > result.valueRule.fixedMaxValue) fail(path, '周期金额下界不能超过上界');
    if (Object.keys(detail).some(key => !['damageTypeKey', 'deliveryKind', 'originKind', 'critical', 'vampQualification', 'vampOverrides'].includes(key))) fail(path, '周期伤害明细存在未接入字段');
    const vamp = adaptDamageVamp(context.vampRules, { gameId: state.gameId, skillKey: state.skillKey, skillCategoryKeys: [...context.skillCategoryKeys],
      skillLevel: state.skillLevel, characterLevel: state.characterLevel, detail, parameters: [...(state.parameters ?? [])], formulas: [...(state.formulas ?? [])] });
    if (vampRules && JSON.stringify(vampRules) !== JSON.stringify(vamp.rules)) fail(path, '同区域周期必须共享真实游戏吸血规则');
    vampRules = vamp.rules; typeEntries.push(...vamp.typeEntries, { key: detail.damageTypeKey, domain: 'damage' });
    for (const type of vamp.abilityTypes) abilityTypes.add(type);
    const names = new Map(vamp.formulas.map(formula => [formula.key, `${state.formulaNamespace}/vamp/${formula.key}`]));
    for (const formula of vamp.formulas) state.namedFormulas.set(names.get(formula.key)!, { ...formula, key: names.get(formula.key)! });
    for (const [key, value] of Object.entries(vamp.params)) {
      if (key in state.params && state.params[key] !== value) fail(path, '周期吸血参数与原作者冲突');
      state.params[key] = value;
    }
    for (const key of vamp.requiredAttributes) state.requiredAttributes.add(key);
    const operation: OperationDefinition = { operation: 'damage', target: 'target', damageType: detail.damageTypeKey,
      amount: wrapValueRuleExpression(compileNumericValue(result.valueRule.value, path + '.valueRule.value', state, fail), result.valueRule),
      ref: path, ...vamp.operation, vampOverrides: vamp.operation.vampOverrides?.map(row => row.mode === 'OVERRIDE'
        ? { ...row, efficiency: rename(row.efficiency!, names) } : row) };
    if (detail.critical.mode === 'DISALLOWED') {
      if (detail.critical.multiplierValue !== null) fail(path, '禁止暴击不能携带倍率');
      operation.critEligible = false;
    } else if (['FORCED', 'SOURCE_CRIT_CHANCE'].includes(detail.critical.mode) && detail.critical.multiplierValue && context.criticalBinding) {
      operation.critEligible = true;
      Object.assign(operation, context.criticalBinding(detail.critical.mode === 'FORCED', path));
      operation.critMultiplier = compileNumericValue(detail.critical.multiplierValue, path + '.detail.critical.multiplierValue', state, fail);
    } else fail(path, '周期暴击依据不完整');
    operations.push(operation);
  }
  return { effectKey: effect.effectKey, provider: { providerKey, stableId: parent, skillKey: state.skillKey, kind: 'status',
    lifecycle: { durationMs: constExpr(duration), maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' },
    abilities: [{ abilityKey: 'tick', kind: 'tick', skillKey: state.skillKey, types: [...abilityTypes], params: { ...state.params },
      tickSpec: { intervalMs: interval, startDelayMs: 0, onTick: operations } }] },
    operation: { operation: 'apply_provider', target: 'self', providerDefinitionRef: providerKey, ref: root },
    vampRules: vampRules!, typeEntries };
}
