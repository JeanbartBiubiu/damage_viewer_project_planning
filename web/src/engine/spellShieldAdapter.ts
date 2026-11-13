import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { NumericValue } from '../types/numericValue';
import type { GenericFormulaExpr, OperationDefinition, ProviderDefinition } from '../types/genericEngine';
import type { TypeCatalogEntries } from './typeCatalogEntries';

type Reject = (path: string, message: string) => never;

/** 法盾没有数值负载；有限期限和显式移除共用原生单层实例。调用者拥有数值编译及来源身份。 */
export function compileSpellShieldDefinition(effect: SkillEffect, options: {
  providerKey: string;
  effectPath: string;
  stackValue: (value: NumericValue, path: string) => number;
  duration?: GenericFormulaExpr;
}, types: TypeCatalogEntries, fail: Reject): ProviderDefinition {
  const result = effect.results[0];
  if (effect.results.length !== 1 || result?.resultType !== 'SPELL_SHIELD') fail(options.effectPath, '法术护盾效果必须仅含一个 SPELL_SHIELD 结果');
  const path = `${options.effectPath}.results.${result.resultKey}`;
  const behavior = result.lifecycleBehavior;
  // 已有有限法盾由父效果持有期限，允许原声明的空结果行为；显式常驻仍要求完整持久声明。
  const parentTimedBehavior = behavior === null && effect.lifecycle?.expiryMode === 'ALL_AT_ONCE';
  const persistentBehavior = behavior && behavior.moment === 'PERSISTENT' && behavior.valueReadMode === null
    && behavior.stackValueMode === null && behavior.reapplicationValueMode === null && behavior.periodicExecutionMode === null;
  if (result.target !== 'SOURCE' || result.spellShieldBlockScope !== null || result.valueRule !== null
    || Object.keys(result.detail).length || !parentTimedBehavior && !persistentBehavior) {
    fail(path, '自身法术护盾必须保留无数值、无阻挡粒度及完整持久结果声明');
  }
  const life = effect.lifecycle;
  const lifePath = `${options.effectPath}.lifecycle`;
  if (!life || life.instanceScope !== 'SOURCE' || life.reapplicationStackMode !== 'KEEP'
    || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null || life.endWhenShieldEndsResultKey != null) {
    fail(lifePath, '法术护盾只接完整自身单层、无周期及无关联盾结束的生命周期');
  }
  if (options.stackValue(life.maxStacksValue, `${lifePath}.maxStacksValue`) !== 1
    || options.stackValue(life.applicationStacksValue, `${lifePath}.applicationStacksValue`) !== 1) {
    fail(lifePath, '本期只支持单层和每次施加一层，不能丢弃层数配置');
  }
  if (life.expiryMode === 'EXPLICIT_ONLY') {
    if (life.durationValue !== null || life.reapplicationDurationMode !== null || options.duration !== undefined) {
      fail(lifePath, '显式移除法盾不能夹带时长或重施期限策略');
    }
  } else if (life.expiryMode !== 'ALL_AT_ONCE' || life.reapplicationDurationMode !== 'REFRESH_ALL'
    || life.durationValue === null || options.duration === undefined) {
    fail(lifePath, '有限法盾必须保留真实期限与整层刷新策略');
  }
  types.set('provider/spell_shield', 'provider');
  types.set('event/spell_shield_blocked', 'event');
  return { providerKey: options.providerKey, stableId: options.providerKey, skillKey: effect.skillKey,
    kind: 'status', types: ['provider/spell_shield'],
    lifecycle: { ...(options.duration ? { durationMs: options.duration } : {}), maxStacks: 1, refreshPolicy: 'replace' }, listeners: [] };
}

/** 消费操作只能由冻结盾自己的 provider-owned 监听执行，不提供按名称寻找或移除其它盾的能力。 */
export function compileSpellShieldConsumption(rule: SkillTriggerRuleDetail, shieldEffectKey: string, options: {
  rulePath: string;
  effect: (key: string, path: string) => SkillEffect;
  resultPath: (effect: SkillEffect, result: SkillEffectResult) => string;
  immediate?: (result: SkillEffectResult, path: string) => OperationDefinition;
}, fail: Reject): OperationDefinition[] {
  const root = options.rulePath;
  if (rule.eventSource.eventType !== 'SPELL_SHIELD_BLOCKED' || rule.eventSource.detail.shieldEffectKey !== shieldEffectKey) {
    fail(`${root}.eventSource`, '消费监听器必须对应真实 SPELL_SHIELD_BLOCKED 及本盾 shieldEffectKey');
  }
  if (rule.conditionGroups.length) fail(`${root}.conditionGroups`, '本期消费监听器不支持额外条件');
  if (rule.perTargetCooldown || rule.maxTriggersPerProcess || rule.oncePerUse) fail(`${root}.limits`, '本期消费监听器不支持触发限制');
  const operations: OperationDefinition[] = [];
  for (const action of [...rule.actions].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const actionPath = `${root}.actions.${action.actionKey}`;
    if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
      || action.runtimeInputBindings.length || action.resultModifiers.length) {
      fail(actionPath, '法盾消费必须完整执行当前被冻结盾的即时效果，不能忽略其它动作依赖');
    }
    const effect = options.effect(action.detail.effectKey, `${actionPath}.detail.effectKey`);
    if (effect.lifecycle !== null) fail(actionPath, '法盾消费效果必须为即时效果');
    for (const result of [...effect.results].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const path = options.resultPath(effect, result);
      if (result.target !== 'SOURCE' || result.spellShieldBlockScope !== null || result.lifecycleBehavior !== null) {
        fail(path, '消费动作只支持自身无阻挡粒度的即时结果');
      }
      if (result.resultType === 'LIFECYCLE_OPERATION' && result.detail.operation === 'REMOVE') {
        if (result.valueRule !== null || result.detail.targetEffectKey !== shieldEffectKey) fail(path, 'LIFECYCLE REMOVE 必须无数值且指向本盾');
        operations.push({ operation: 'expire_provider', target: 'self', providerRefFromEvent: true });
      } else if (options.immediate) operations.push(options.immediate(result, path));
      else fail(path, '本初始化法盾消费尚未接入该即时副作用，不能丢弃后成功');
    }
  }
  if (!operations.length) fail(root, '消费监听器没有可执行动作');
  return operations;
}
