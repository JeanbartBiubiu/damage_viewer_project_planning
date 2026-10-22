import type { DoneResult, OperationDefinition, TargetMarkDefinition } from '../types/genericEngine';
import { NumericAdaptationError } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function object(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '目标标记结算需要完整对象');
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.prototype.hasOwnProperty.call(row, key))
    || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) fail(path, '目标标记结算字段缺失或含未支持字段');
  return row;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path, '目标标记结算缺少真实标识');
  return value;
}

/** 只核已有编译结果的窄运输形状；实际挂载、作者图及最终引用另行完整核验。 */
export function compiledTargetMark(operation: OperationDefinition, path: string): TargetMarkDefinition | null {
  if (operation.operation !== 'consume_target_mark') {
    if (Object.prototype.hasOwnProperty.call(operation, 'targetMark')) fail(path, '旧操作不能夹带目标标记字段');
    return null;
  }
  object(operation, path, ['operation', 'target', 'ref', 'targetMark']);
  if (operation.target !== 'target') fail(path, '目标标记只消费当前目标');
  text(operation.ref, `${path}.ref`);
  const raw = object(operation.targetMark, `${path}.targetMark`,
    ['stateKey', 'stateScope', 'triggerKind', 'triggerAbilityRef', 'damageBlockScope', 'damage'], ['restore']);
  if (!/^[a-z][a-z0-9_]*$/.test(text(raw.stateKey, `${path}.targetMark.stateKey`)) || raw.stateScope !== 'provider_target'
    || !['event/skill_hit', 'event/basic_attack_hit'].includes(String(raw.triggerKind)) || raw.damageBlockScope !== 'DAMAGE_INSTANCE'
    || !/^source\.provider\[[^\]]+\]\.ability\[[^\]]+\]$/.test(text(raw.triggerAbilityRef, `${path}.targetMark.triggerAbilityRef`))) {
    fail(path, '目标标记缺少明确字段范围或实际来源命中引用');
  }
  const damage = object(raw.damage, `${path}.targetMark.damage`,
    ['operation', 'target', 'ref', 'amount', 'damageType', 'types', 'critEligible', 'vampQualification'], ['vampOverrides']);
  if (damage.operation !== 'damage' || damage.target !== 'target' || damage.critEligible !== false || damage.vampQualification !== 'RESOLVED'
    || !Array.isArray(damage.types) || damage.types.length !== 2 || new Set(damage.types).size !== 2
    || !damage.types.includes('damage_trait/delivery_skill') || !damage.types.includes('damage_trait/origin_direct')) fail(path, '目标标记附伤必须是完整普通技能直接伤害');
  text(damage.ref, `${path}.targetMark.damage.ref`); text(damage.damageType, `${path}.targetMark.damage.damageType`);
  if (!damage.amount || typeof damage.amount !== 'object' || Array.isArray(damage.amount)) fail(path, '目标标记附伤缺少完整数值');
  if (Object.prototype.hasOwnProperty.call(raw, 'restore')) {
    const restore = object(raw.restore, `${path}.targetMark.restore`, ['operation', 'target', 'ref', 'resourceKey', 'amount']);
    if (raw.triggerKind !== 'event/skill_hit' || restore.operation !== 'resource_change' || restore.target !== 'self'
      || text(restore.resourceKey, `${path}.targetMark.restore.resourceKey`) === 'hp') fail(path, '仅技能接触结算可恢复明确自身非生命资源');
    text(restore.ref, `${path}.targetMark.restore.ref`);
    const amount = object(restore.amount, `${path}.targetMark.restore.amount`, ['op', 'value']);
    if (amount.op !== 'const' || typeof amount.value !== 'number' || !Number.isFinite(amount.value) || amount.value < 0) fail(path, '标记结算恢复金额必须明确为有限非负静态值');
  }
  return operation.targetMark!;
}

/** 可选新增输出在旧场景保持省略，存在时不默认补零或忽略未知计数。 */
export function assertTargetMarkOutputShape(done: DoneResult): void {
  if (!Object.prototype.hasOwnProperty.call(done, 'targetMarkSummary')) return;
  const path = 'runResult.targetMarkSummary';
  const row = object(done.targetMarkSummary, path, ['consumedCount', 'attackCount', 'skillCount', 'damageBlockedCount']);
  for (const [key, value] of Object.entries(row)) if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(`${path}.${key}`, '消费次数必须是非负安全整数');
  const summary = done.targetMarkSummary!;
  if (summary.consumedCount !== summary.attackCount + summary.skillCount || summary.damageBlockedCount > summary.consumedCount) fail(path, '消费组计数无法完整还原');
}
