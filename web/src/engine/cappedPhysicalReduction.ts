import type { ModifierDefinition } from '../types/genericEngine';
import type { SkillEffectResult } from '../types/skillEffect';
import type { PermanentResultContext } from './simulationPermanentResults';
import { cappedReductionRatioIssue, isCappedReductionResultShape } from '../services/cappedPhysicalReductionContract';
import { validateStoredSkillFormula } from '../services/skillFormulaContract';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import { parseDamageTypeFormulaDefinition } from '../services/damageTypeClient';
import { damageTypeFormulaAllowedBindings } from '../types/damageTypeFormula';
import { compileNumericValue, createNumericCompileState, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: object, keys: readonly string[], path: string) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, '封顶平减不忽略额外字段');
}

/** 作者source保持本拥有者；原生专用incoming求值上下文绑定真实modifier owner。 */
export function cappedPhysicalReduction(context: PermanentResultContext, result: SkillEffectResult, path: string): ModifierDefinition | undefined {
  if (result.resultType !== 'DAMAGE_MODIFIER') return undefined;
  const { source, configuration, snapshot, side } = context;
  const zones = snapshot.catalogs.modifierZones.filter(row => row.modifierZoneKey === result.detail.modifierZoneKey);
  const zone = zones[0];
  const hasCap = Object.prototype.hasOwnProperty.call(result.detail, 'maximumReductionRatioValue');
  const capZone = zone?.domain === 'DAMAGE' && zone.calculationMode === 'FLAT_ADD' && zone.applicationStage === 'DAMAGE_PRE_DEFENSE';
  if (!hasCap && !capZone) return undefined;
  if (!hasCap || !isCappedReductionResultShape(result) || source.origin.kind !== 'CHARACTER'
    || zones.length !== 1 || !zone || !capZone || zone.status !== 'ENABLED' || zone.gameId !== snapshot.gameId
    || context.sceneParameterValues && Object.keys(context.sceneParameterValues).length) fail(path, '封顶平减仅接完整真实角色无条件初始化的自身永久物理修正');
  exact(result.detail, ['modifierZoneKey', 'direction', 'operation', 'damageTypeKey', 'deliveryKind', 'originKind', 'criticalFilter', 'condition', 'maximumReductionRatioValue'], `${path}.detail`);
  exact(result.lifecycleBehavior!, ['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'], `${path}.lifecycleBehavior`);
  const effects = configuration.effects.filter(e => e.results.some(r => r.resultKey === result.resultKey && e.results.includes(result)));
  const effect = effects[0];
  if (effects.length !== 1 || !effect || effect.results.length !== 1) fail(path, '封顶平减效果必须是唯一完整单结果');
  exact(effect, ['gameId', 'skillKey', 'effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results', 'createdAt', 'updatedAt'], path);
  exact(result, ['resultKey', 'name', 'description', 'sortOrder', 'resultType', 'target', 'spellShieldBlockScope', 'valueRule', 'detail', 'lifecycleBehavior'], path);
  const complete = snapshot.skillConfigurations.find(c => c.skill.skillKey === source.skillKey) ?? configuration;
  const parents = complete.triggerRules.flatMap(rule => rule.actions.filter(a => a.actionType === 'EXECUTE_EFFECT'
    && a.detail.effectKey === effect.effectKey).map(action => ({ rule, action })));
  const parent = parents[0];
  if (parents.length !== 1 || !parent || parent.rule.eventSource.eventType !== 'SOURCE_INITIALIZED'
    || Object.keys(parent.rule.eventSource.detail).length || parent.rule.conditionGroups.length || parent.rule.actions.length !== 1
    || parent.rule.oncePerUse !== null || parent.rule.perTargetCooldown !== null || parent.rule.maxTriggersPerProcess !== null
    || parent.action.targetContext !== 'EVENT_SOURCE' || parent.action.runtimeInputBindings.length || parent.action.resultModifiers.length) {
    fail(path, '封顶平减必须由唯一真实无条件自身初始化单动作挂载');
  }
  exact(parent.rule, ['ruleKey', 'name', 'description', 'sortOrder', 'eventSource', 'conditionGroups', 'actions', 'perTargetCooldown', 'maxTriggersPerProcess', 'oncePerUse'], path);
  exact(parent.rule.eventSource, ['eventType', 'detail'], path);
  exact(parent.action, ['actionKey', 'name', 'sortOrder', 'actionType', 'detail', 'targetContext', 'runtimeInputBindings', 'resultModifiers'], path);
  exact(parent.action.detail, ['effectKey'], path);
  const types = snapshot.catalogs.damageTypes.filter(row => row.type.damageTypeKey === result.detail.damageTypeKey);
  if (types.length !== 1 || types[0]!.type.gameId !== snapshot.gameId || types[0]!.type.status !== 'ENABLED'
    || !types[0]!.type.formulaConfigured) fail(`${path}.detail.damageTypeKey`, '封顶平减需要唯一同游戏启用且完整的真实伤害类型');
  const issue = cappedReductionRatioIssue(result.detail.maximumReductionRatioValue, configuration.parameters,
    source.skillKey, configuration.skill.maxLevel, snapshot.gameId);
  if (issue) fail(`${path}.detail.maximumReductionRatioValue`, issue);
  const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey: source.skillKey, skillLevel: source.skillLevel!,
    characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters, formulas: configuration.formulas,
    formulaNamespace: context.formulaNamespace, bindParameters: false, allowAttributeReads: true, runtimeInputMessage: '封顶平减不接受未供值运行输入' });
  const value = result.valueRule.value;
  exact(result.valueRule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], `${path}.valueRule`);
  if (!Number.isFinite(result.valueRule.fixedMultiplier) || result.valueRule.fixedMultiplier < 0
    || result.valueRule.fixedMinValue !== 0 || result.valueRule.fixedMaxValue !== null) fail(`${path}.valueRule`, '封顶平减点数须明确下限0，不夹带绝对上限或负倍率');
  if (value.kind === 'FORMULA') {
    const defenseAttributes = new Set<string>();
    const allowed = damageTypeFormulaAllowedBindings(snapshot.catalogs.attributes.filter(a => a.gameId === snapshot.gameId));
    for (const entry of snapshot.catalogs.damageTypes) {
      if (entry.type.gameId !== snapshot.gameId || entry.type.status !== 'ENABLED' || !entry.type.formulaConfigured) continue;
      if (entry.formula.gameId !== snapshot.gameId || entry.formula.damageTypeKey !== entry.type.damageTypeKey) fail(path, '防御目录与完整公式归属不一致');
      const definition = parseDamageTypeFormulaDefinition(entry.formula.formula, allowed);
      for (const input of skillFormulaReachableInputs(definition)) {
        const binding = input.binding;
        if (binding.kind === 'attribute' && binding.object === 'target' && binding.view === 'current_frame' && binding.valueKind === 'TOTAL') defenseAttributes.add(binding.attributeKey);
      }
    }
    const formulas = configuration.formulas.filter(f => f.formulaKey === value.formulaKey);
    const formula = formulas[0];
    if (formulas.length !== 1 || !formula || formula.gameId !== snapshot.gameId || formula.skillKey !== source.skillKey
      || validateStoredSkillFormula(formula.expression, source.skillKey)) fail(path, '封顶平减需要完整本技能共同公式');
    // 所有声明输入均核验，包括未选条件分支；不补未供值输入。
    for (const input of formula.expression.inputs) {
      const b = input.binding;
      if (b.kind === 'attribute') {
        const rows = snapshot.catalogs.attributes.filter(a => a.attributeKey === b.attributeKey);
        if (b.object !== 'source' || b.view !== 'current_frame' || b.valueKind !== 'BONUS' || !defenseAttributes.has(b.attributeKey) || rows.length !== 1
          || rows[0]!.gameId !== snapshot.gameId || rows[0]!.status !== 'ENABLED') fail(path, '封顶平减公式只读取实际拥有者当前额外属性');
      } else if (b.kind === 'parameter') {
        const p = configuration.parameters.filter(p => p.parameterKey === b.parameterKey && p.skillKey === b.skillKey);
        if (b.skillKey !== source.skillKey || p.length !== 1 || p[0]!.valueMode === 'RUNTIME_INPUT') fail(path, '封顶平减公式只允许本技能明确静态参数');
      } else fail(path, '封顶平减公式不接受事件、状态或未供值运行输入');
    }
  }
  const ratio = compileNumericValue(result.detail.maximumReductionRatioValue!, `${path}.detail.maximumReductionRatioValue`, numeric, fail);
  const maximumReductionRatio = tryFoldConstant(ratio);
  if (maximumReductionRatio === null || maximumReductionRatio < 0 || maximumReductionRatio > 1) fail(path, '封顶比例必须静态可核定');
  const expression = compileNumericValue(value, `${path}.valueRule.value`, numeric, fail);
  context.onNumericConsumed?.(value, `${path}.valueRule.value`, expression);
  context.onNumericConsumed?.(result.detail.maximumReductionRatioValue!, `${path}.detail.maximumReductionRatioValue`, ratio);
  return { modifierKey: result.resultKey, kind: 'pipeline', command: 'damage', channel: 'all_damage', bucket: 'all_instances',
    stage: 'incoming_pre_mitigation', valuePolicy: 'subtract', maximumReductionRatio,
    value: wrapValueRuleExpression(expression, result.valueRule), condition: { op: 'read', path: `damage.type.${result.detail.damageTypeKey}` } };
}
