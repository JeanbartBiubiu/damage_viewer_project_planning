import type { SkillEffectLifecycle, SkillEffectResultRequest } from './skillEffect';

export type ShieldEndBindingIssue = { path: string; message: string };

/** 校验同一效果内的护盾结束引用；参数和公式的全等级数值由保存事务复核。 */
export function shieldEndBindingIssues(
  lifecycle: SkillEffectLifecycle | null,
  results: readonly SkillEffectResultRequest[]
): ShieldEndBindingIssue[] {
  const key = lifecycle?.endWhenShieldEndsResultKey;
  if (key == null) return [];
  const issues: ShieldEndBindingIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const field = 'lifecycle.endWhenShieldEndsResultKey';
  if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
    return [{ path: field, message: '请选择同一效果中的普通护盾结果。' }];
  }
  const matches = results.filter(result => result.resultKey === key);
  const shield = matches[0];
  if (matches.length !== 1 || !shield || shield.resultType !== 'NORMAL_SHIELD'
    || shield.lifecycleBehavior?.moment !== 'PERSISTENT') {
    return [{ path: field, message: '关联结果必须是同一效果中的持续普通护盾；原引用已失效，请重新选择。' }];
  }
  if (shield.lifecycleBehavior.stackValueMode !== 'SHARED') {
    add(field, '关联护盾必须由整个实例共享护盾值。');
  }
  const expectedTarget = lifecycle!.instanceScope === 'SOURCE' ? 'SOURCE'
    : ['TARGET', 'SOURCE_TARGET'].includes(lifecycle!.instanceScope) ? 'TARGET' : null;
  if (!expectedTarget || shield.target !== expectedTarget) {
    add(field, '关联护盾的作用对象必须与实例范围一致；技能范围不能关联护盾结束。');
  }
  if (results.some(result => result.lifecycleBehavior?.moment === 'PERSISTENT' && result.target !== shield.target)) {
    add(field, '随护盾结束的所有持续结果必须与该护盾作用于同一对象。');
  }
  if (lifecycle!.reapplicationStackMode !== 'KEEP'
    || !['ALL_AT_ONCE', 'EXPLICIT_ONLY'].includes(lifecycle!.expiryMode)
    || lifecycle!.reapplicationDurationMode === 'INDEPENDENT') {
    add(field, '随护盾结束仅支持保留单层、整体到期或仅显式移除，不支持独立计时。');
  }
  for (const name of ['maxStacksValue', 'applicationStacksValue'] as const) {
    const value = lifecycle![name];
    if (value?.kind === 'FIXED' && value.value !== 1) {
      add(`lifecycle.${name}`, '随护盾结束要求最大层数和每次施加层数在所有等级均为1。');
    }
  }
  return issues;
}
