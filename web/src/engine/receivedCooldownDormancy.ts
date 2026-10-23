import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSnapshot, SimulationSkillSource } from '../types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { parseSkillEffect } from '../services/skillEffectClient';
import { parseSkillTriggerRuleDetail } from '../services/skillTriggerRuleClient';
import { compileNumericValue, createNumericCompileState, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

/** 不存在的条件须被明确证明；unknown不等于false，未来双真不授予运行权限。 */
export function requireReceivedMaintenanceDormant(received: boolean | undefined, ownInitial: boolean | undefined, path: string): void {
  if (received !== false && ownInitial !== false) fail(path, 'UNSUPPORTED_RECEIVED_COOLDOWN_MAINTENANCE：未证明无作用或真实接收与INITIAL同时可达');
}

export type ReceivedCooldownDormancy = { ruleKey: string; authorPath: string; note: string };

/** 只运输完整纯本技能维护的定义。原snapshot不变，返回值只用于真实执行闭包投影。 */
export function receivedCooldownDormancy(snapshot: SimulationSnapshot, configuration: SkillConfiguration,
  side: 'source' | 'target', source: SimulationSkillSource): ReceivedCooldownDormancy[] {
  if (!source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel === 0) return [];
  const rules = configuration.triggerRules.filter(r => r.eventSource.eventType === 'BASIC_ATTACK_RECEIVED');
  // 其它接收机制不能因此休眠；只有明确REDUCE声明进入本窄合同，损坏声明仍失败。
  const declared = rules.some(r => r.actions.some(a => a.actionType === 'EXECUTE_EFFECT'
    && configuration.effects.some(e => e.effectKey === a.detail.effectKey
      && e.results.some(result => result.resultType === 'COOLDOWN_CHANGE' && result.detail.operation === 'REDUCE'))));
  if (!declared) return [];
  for (const rule of rules) for (const action of rule.actions) if (action.actionType === 'EXECUTE_EFFECT') {
    const rows = configuration.effects.filter(e => e.effectKey === action.detail.effectKey);
    if (rows.length !== 1 || rows[0]!.gameId !== snapshot.gameId || rows[0]!.skillKey !== source.skillKey) {
      fail(`skills.${source.skillKey}.triggerRules.${rule.ruleKey}.actions.${action.actionKey}`, '接收规则的完整同来源效果引用缺失或重复');
    }
  }
  const root = `skills.${source.skillKey}.triggerRules`;
  if (configuration.skill.skillKey !== source.skillKey || configuration.skill.gameId !== snapshot.gameId
    || configuration.skill.status !== 'ENABLED' || source.origin.kind !== 'CHARACTER'
    || source.inactiveReason !== null || !Number.isSafeInteger(source.skillLevel) || source.skillLevel === null
    || source.skillLevel < 1 || source.skillLevel > configuration.skill.maxLevel || rules.length !== 1) fail(root, '接收维护休眠必须为唯一完整已学角色来源');
  const own = snapshot[side].skillSources.filter(row => simulationSkillSourceIdentity(row.origin, row.skillKey)
    === simulationSkillSourceIdentity(source.origin, source.skillKey));
  if (own.length !== 1 || own[0]!.skillLevel !== source.skillLevel || !own[0]!.enabled) fail(root, '接收维护缺少唯一实际拥有者关系');
  const rule = rules[0]!, path = `${root}.${rule.ruleKey}`;
  parseSkillTriggerRuleDetail(rule);
  if (Object.keys(rule.eventSource.detail).length || rule.conditionGroups.length || rule.actions.length !== 1
    || rule.oncePerUse !== null || rule.maxTriggersPerProcess !== null || rule.perTargetCooldown !== null) fail(path, '纯接收维护不得隐藏条件、额外动作或额度');
  const action = rule.actions[0]!;
  if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
    || action.runtimeInputBindings.length || action.resultModifiers.length) fail(`${path}.actions.${action.actionKey}`, '纯接收维护只执行自身即时效果，无运行绑定或动作修正');
  const effects = configuration.effects.filter(e => e.effectKey === action.detail.effectKey);
  const effect = effects[0];
  if (effects.length !== 1 || !effect || effect.gameId !== snapshot.gameId || effect.skillKey !== source.skillKey
    || effect.lifecycle !== null || effect.results.length !== 1) fail(path, '纯接收维护需要完整同技能即时单结果效果');
  parseSkillEffect(effect);
  const result = effect.results[0]!, resultPath = `skills.${source.skillKey}.effects.${effect.effectKey}.results.${result.resultKey}`;
  if (result.resultType !== 'COOLDOWN_CHANGE' || result.detail.operation !== 'REDUCE' || result.target !== 'SOURCE'
    || result.valueRule === null
    || result.spellShieldBlockScope !== null || result.lifecycleBehavior !== null
    || result.detail.affectedSkillScope.mode !== 'SKILLS' || result.detail.affectedSkillScope.skillKeys.length !== 1
    || result.detail.affectedSkillScope.skillKeys[0] !== source.skillKey || result.detail.affectedSkillScope.skillCategoryKeys.length) fail(resultPath, '纯接收维护仅限本技能自身REDUCE范围');
  const value = result.valueRule.value;
  if (value.kind !== 'FIXED' && value.kind !== 'PARAMETER') fail(`${resultPath}.valueRule`, '纯接收维护只接受明确固定值或本技能静态参数');
  const rows = value.kind === 'PARAMETER' ? configuration.parameters.filter(p => p.parameterKey === value.parameterKey) : [];
  const row = rows[0];
  if (value.kind === 'PARAMETER' && (rows.length !== 1 || !row || row.gameId !== snapshot.gameId || row.skillKey !== source.skillKey
    || !['INTEGER', 'DECIMAL'].includes(row.valueType) || !['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL'].includes(row.valueMode))) fail(`${resultPath}.valueRule`, '纯接收维护缺少唯一同技能静态参数');
  if (row && (row.valueMode === 'FIXED' ? row.levelValues !== null : row.fixedValue !== null || !row.levelValues
    || !Object.keys(row.levelValues).length || Object.keys(row.levelValues).some((_, i) => !Object.prototype.hasOwnProperty.call(row.levelValues!, String(i + 1)))
    || row.valueMode === 'SKILL_LEVEL' && Object.keys(row.levelValues).length !== configuration.skill.maxLevel)) fail(`${resultPath}.valueRule`, '纯维护参数等级表必须完整且不夹带默认值');
  const levels = row?.levelValues ? Object.keys(row.levelValues).map(Number) : [source.skillLevel];
  for (const level of levels) {
    const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey: source.skillKey,
      skillLevel: row?.valueMode === 'SKILL_LEVEL' ? level : source.skillLevel,
      characterLevel: row?.valueMode === 'CHARACTER_LEVEL' ? level : snapshot.selection[`${side}Level`],
      parameters: configuration.parameters, formulas: [], formulaNamespace: 'received-maintenance-definition', bindParameters: false,
      allowAttributeReads: false, runtimeInputMessage: '纯接收维护不接运行输入' });
    const amount = tryFoldConstant(wrapValueRuleExpression(compileNumericValue(value, resultPath, numeric, fail), result.valueRule));
    if (amount !== 750) fail(`${resultPath}.valueRule`, '纯接收维护所有声明等级的最终金额必须明确为750毫秒');
  }
  // 当前生产入口的源/目标身份是明确有限集合；不用技能名推断主动或预填冷却。
  const received = side === 'source' ? false : snapshot.selection.basicAttackSkillKey !== null;
  const ownInitial = side === 'target' ? false : snapshot.selection.plannedSkills.some(plan =>
    simulationSkillSourceIdentity(plan.origin, plan.skillKey) === simulationSkillSourceIdentity(source.origin, source.skillKey));
  requireReceivedMaintenanceDormant(received, ownInitial, path);
  return [{ ruleKey: rule.ruleKey, authorPath: path,
    note: '完整750接收维护保留定义与引用；当前单向场景同拥有者接收普攻与INITIAL交集为空，不生成监听或冷却操作；通用接收消费者仍未实现' }];
}
