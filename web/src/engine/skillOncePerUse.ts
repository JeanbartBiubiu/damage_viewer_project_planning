import type { OncePerUseLimit, ProviderDefinition, SkillHitCandidate, SkillHitRuleGroup } from '../types/genericEngine';

type Reject = (path: string, message: string) => never;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;

/** 命中组和自然监听沿同一实际父来源的命名规则使用额度。 */
export function compileSkillOncePerUse(value: unknown, path: string, fail: Reject,
  namedKey: (key: string) => string = key => key): OncePerUseLimit | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) fail(path, '同次使用额度必须为完整对象');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 2 || Object.keys(raw).some(key => !['groupKey', 'scope'].includes(key))) {
    fail(path, '同次使用额度只接受完整共享键和范围');
  }
  if (typeof raw.groupKey !== 'string' || !KEY.test(raw.groupKey)) fail(`${path}.groupKey`, '需要有效稳定标识');
  if (raw.scope !== 'SKILL' && raw.scope !== 'TARGET') fail(`${path}.scope`, '未知同次使用范围');
  const groupKey = namedKey(raw.groupKey as string);
  if (!KEY.test(groupKey)) fail(`${path}.groupKey`, '需要有效稳定标识');
  return { groupKey, scope: raw.scope === 'SKILL' ? 'provider' : 'provider_target' };
}

/** 检查宿主生成的完整组；原生仍独立核对实际挂载和使用身份。 */
export function validateHitRuleGroups(candidates: readonly SkillHitCandidate[], groups: readonly SkillHitRuleGroup[],
  path: string, fail: Reject): void {
  const consumed = new Set<string>(), rules = new Set<string>();
  const scopeByKey = new Map<string, string>();
  for (const [index, group] of groups.entries()) {
    const root = `${path}[${index}]`;
    if (!KEY.test(group.ruleKey) || rules.has(group.ruleKey)) fail(`${root}.ruleKey`, '规则标识非法或重复');
    rules.add(group.ruleKey);
    if (!group.candidateKeys.length) fail(`${root}.candidateKeys`, '同次使用组不能丢弃全部动作候选');
    const previousScope = scopeByKey.get(group.oncePerUse.groupKey);
    if (previousScope && previousScope !== group.oncePerUse.scope) fail(`${root}.oncePerUse.scope`, '同一共享键的同次使用范围冲突');
    scopeByKey.set(group.oncePerUse.groupKey, group.oncePerUse.scope);
    let previous = -1, first: SkillHitCandidate | undefined;
    for (const key of group.candidateKeys) {
      const candidateIndex = candidates.findIndex(candidate => candidate.candidateKey === key);
      if (candidateIndex < 0 || consumed.has(key) || previous >= 0 && candidateIndex !== previous + 1) {
        fail(`${root}.candidateKeys`, '规则组候选必须存在、连续、无重复且不属于其它组');
      }
      const candidate = candidates[candidateIndex]!;
      if (!key.startsWith(`${group.ruleKey}:`)) fail(`${root}.candidateKeys`, '候选必须属于完整真实作者规则');
      if (first && (JSON.stringify(first.participationCondition ?? null) !== JSON.stringify(candidate.participationCondition ?? null)
        || JSON.stringify(first.eventValueConditions ?? []) !== JSON.stringify(candidate.eventValueConditions ?? [])
        || first.participationProviderRef !== candidate.participationProviderRef)) {
        fail(root, '规则组的参与、事件条件和实际供值来源必须一致');
      }
      if (candidate.eventValueConditions?.some(condition => condition.key === 'first_contact')) {
        fail(`${root}.eventValueConditions`, '同次使用命中组不支持首次接触或缺失事件值比较');
      }
      for (const [operationIndex, operation] of candidate.operations.entries()) {
        if (operation.condition || operation.abilityRef || operation.operation === 'repeat' || operation.operation === 'resolve_skill_hit') {
          fail(`${root}.operations[${operationIndex}]`, '同次使用额度只支持同一暂存帧内的直接操作');
        }
      }
      first ??= candidate;
      previous = candidateIndex;
      consumed.add(key);
    }
    const complete = candidates.filter(candidate => candidate.candidateKey.startsWith(`${group.ruleKey}:`)).map(candidate => candidate.candidateKey);
    if (JSON.stringify(complete) !== JSON.stringify(group.candidateKeys)) fail(`${root}.candidateKeys`, '规则组必须包含该规则全部动作候选');
  }
}

/** 合并到唯一真实父定义后，跨阶段命中组与普通监听共用同一键的范围。 */
export function validateProviderOncePerUseScopes(provider: ProviderDefinition, path: string, fail: Reject): void {
  const hits = (provider.abilities ?? []).flatMap(ability => ability.operations ?? [])
    .filter(operation => (operation.skillHit?.ruleGroups?.length ?? 0) > 0);
  if (!hits.length) return;
  if (provider.kind === 'status' || provider.lifecycle) fail(path, '同次使用命中组需要静态父来源');
  const scopes = new Map<string, string>();
  const add = (limit: OncePerUseLimit) => {
    const previous = scopes.get(limit.groupKey);
    if (previous && previous !== limit.scope) fail(`${path}.oncePerUse.${limit.groupKey}`, '同一真实父来源共享键的同次使用范围冲突');
    scopes.set(limit.groupKey, limit.scope);
  };
  for (const listener of provider.listeners ?? []) if (listener.oncePerUse) add(listener.oncePerUse);
  for (const ability of provider.abilities ?? []) if (ability.listenerSpec?.oncePerUse) add(ability.listenerSpec.oncePerUse);
  for (const [index, operation] of hits.entries()) {
    if (operation.operation !== 'resolve_skill_hit') fail(path, '命中规则组只支持实际技能命中解析');
    const hit = operation.skillHit!;
    validateHitRuleGroups(hit.candidates, hit.ruleGroups!, `${path}.skillHit[${index}].ruleGroups`, fail);
    for (const group of hit.ruleGroups!) add(group.oncePerUse);
  }
}
