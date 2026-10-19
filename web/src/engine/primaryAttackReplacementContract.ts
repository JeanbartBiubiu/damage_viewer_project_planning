import type {
  BasicAttackPlan, BasicAttackPrimaryIdentity, BasicAttackPrimaryReplacement, CompileRequest, DoneResult,
  OperationDefinition, RunRequest, SkillActionBinding, SkillHitCandidate
} from '../types/genericEngine';

const primaryKeys = ['owner', 'providerRef', 'definitionRef', 'startAbilityRef', 'initialControlAbilityRef',
  'hitAbilityRef', 'candidateKey', 'effectOccurrenceKey', 'effectKey', 'resultKey'] as const;
const replacementKeys = ['owner', 'providerRef', 'definitionRef', 'skillKey', 'processKey', 'hitAbilityRef'] as const;
const rowKeys = ['primary', 'replacement', 'target', 'count', 'blockedCount', 'postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss'];
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const stringIdentity = (value: unknown, keys: readonly string[]) => exact(value, keys)
  && keys.every(key => typeof value[key] === 'string' && !!(value[key] as string).trim());
export const validPrimaryIdentity = (value: unknown): value is BasicAttackPrimaryIdentity => stringIdentity(value, primaryKeys);
export const samePrimaryIdentity = (left: unknown, right: unknown): left is BasicAttackPrimaryIdentity => validPrimaryIdentity(left)
  && validPrimaryIdentity(right) && primaryKeys.every(key => left[key] === right[key]);
const sameReplacement = (left: unknown, right: unknown) => stringIdentity(left, replacementKeys) && stringIdentity(right, replacementKeys)
  && replacementKeys.every(key => (left as Record<string, unknown>)[key] === (right as Record<string, unknown>)[key]);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const single = (operation: OperationDefinition) => !operation.condition && !operation.repeatScope
  && (operation.repeatCount === undefined || operation.repeatCount === 1) && !operation.repeatDelayMs;
const damage = (candidate: SkillHitCandidate) => candidate.semantic.resultType === 'DAMAGE' && candidate.semantic.target === 'TARGET'
  && candidate.semantic.moment === 'INSTANT' && candidate.participationCondition == null && !candidate.participationProviderRef
  && !candidate.eventValueConditions?.length && candidate.operations.length === 1 && candidate.operations[0]?.operation === 'damage'
  && candidate.operations[0].target === 'target' && single(candidate.operations[0]);

function ability(compile: CompileRequest, ref: string) {
  const match = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(ref);
  const mount = compile.combatants.find(actor => actor.key === match?.[1])?.providers.find(row => row.providerRef === match?.[2]);
  const providerIndex = compile.sharedProviders?.findIndex(row => row.providerKey === mount?.definitionRef) ?? -1;
  const provider = compile.sharedProviders?.[providerIndex];
  const abilityIndex = provider?.abilities?.findIndex(row => row.abilityKey === match?.[3]) ?? -1;
  const value = provider?.abilities?.[abilityIndex];
  return match && mount && provider && value ? { owner: match[1]!, providerRef: match[2]!, provider, value,
    path: `sharedProviders[${providerIndex}].abilities[${abilityIndex}]` } : null;
}

/** 显式主体从本次真实普攻重建；无角色的旧输入继续省略。 */
export function basicAttackPrimaryBinding(compile: CompileRequest, plan: Pick<BasicAttackPlan,
  'source' | 'target' | 'skillKey' | 'startAbilityRef' | 'initialControlAbilityRef' | 'hitAbilityRef'>) {
  const hit = ability(compile, plan.hitAbilityRef), initial = ability(compile, plan.initialControlAbilityRef), start = ability(compile, plan.startAbilityRef);
  const candidates = hit?.value.operations?.flatMap((resolver, operationIndex) => (resolver.skillHit?.candidates ?? [])
    .map((candidate, candidateIndex) => ({ resolver, candidate, path: `${hit.path}.operations[${operationIndex}].skillHit.candidates[${candidateIndex}].operations[0]` }))) ?? [];
  const marked = candidates.filter(row => row.candidate.attackDamageRole === 'PRIMARY');
  if (!marked.length) return null;
  const selected = marked[0]!;
  const valid = marked.length === 1 && hit && initial && start && hit.owner === plan.source
    && [initial, start].every(row => row.owner === hit.owner && row.providerRef === hit.providerRef && row.provider.providerKey === hit.provider.providerKey)
    && hit.value.kind === 'active' && initial.value.kind === 'active' && start.value.kind === 'active'
    && [hit.value, initial.value, start.value].every(row => row.skillKey === plan.skillKey)
    && new Set([plan.startAbilityRef, plan.initialControlAbilityRef, plan.hitAbilityRef]).size === 3
    && !start.value.processControl && !hit.value.processControl && !hit.value.listenerSpec && !hit.value.tickSpec
    && !hit.value.castCondition && !hit.value.cooldown && !hit.value.cost
    && initial.value.processControl?.action === 'INITIAL' && initial.value.processControl.useRefFromEvent === true
    && hit.provider.processes?.some(process => process.processKey === initial.value.processControl!.processKey && process.skillKey === plan.skillKey)
    && selected.resolver.operation === 'resolve_skill_hit' && selected.resolver.skillHit?.skillKey === plan.skillKey
    && single(selected.resolver) && damage(selected.candidate) && candidates.every(row => row.candidate.spellShieldBlockScope === null);
  if (!valid) throw new Error('basicAttack.primary: 显式主体必须唯一绑定真实普攻首次过程及无条件即时目标伤害');
  const candidate = selected.candidate;
  const identity: BasicAttackPrimaryIdentity = { owner: plan.source, providerRef: hit.providerRef, definitionRef: hit.provider.providerKey,
    startAbilityRef: plan.startAbilityRef, initialControlAbilityRef: plan.initialControlAbilityRef, hitAbilityRef: plan.hitAbilityRef,
    candidateKey: candidate.candidateKey, effectOccurrenceKey: candidate.effectOccurrenceKey, effectKey: candidate.effectKey, resultKey: candidate.resultKey };
  return { identity, candidate, operation: candidate.operations[0]!, operationPath: selected.path };
}

/** 这里只识别和约束显式替换，普通附加待击仍沿既有校验。 */
export function replacementPayloadBinding(compile: CompileRequest, binding: SkillActionBinding) {
  const hits = binding.hitBindings.map(row => ability(compile, row.hitAbilityRef));
  const marked = hits.flatMap(hit => hit?.value.operations?.flatMap(resolver => resolver.skillHit?.candidates.filter(candidate => candidate.attackDamageRole !== undefined) ?? []) ?? []);
  if (!marked.length) return null;
  const hit = hits[0], control = binding.controls[0];
  const process = hit?.provider.processes?.find(row => row.processKey === control?.processKey);
  const resolver = hit?.value.operations?.[0], candidate = resolver?.skillHit?.candidates[0];
  if (marked.length !== 1 || binding.source !== hit?.owner || binding.providerRef !== hit.providerRef
    || binding.providerDefinitionRef !== hit.provider.providerKey || binding.controls.length !== 1 || control?.action !== 'INITIAL'
    || process?.steps.length !== 1 || process.steps[0]?.stepType !== 'EMPOWERED_BASIC_ATTACK'
    || process.steps[0].consumeMoment !== 'ATTACK_HIT' || process.steps[0].occupiesAction !== false
    || hits.length !== 1 || hit.value.operations?.length !== 1 || resolver?.operation !== 'resolve_skill_hit'
    || resolver.skillHit?.candidates.length !== 1 || candidate?.attackDamageRole !== 'REPLACE_PRIMARY'
    || !single(resolver) || !damage(candidate) || hit.value.castCondition || hit.value.cooldown || hit.value.cost) {
    throw new Error(`skillActionBindings.${binding.bindingKey}.attackDamageRole: 替换必须是本方首次单步骤待击的唯一无条件目标伤害`);
  }
  return { identity: { owner: binding.source, providerRef: binding.providerRef, definitionRef: binding.providerDefinitionRef,
    skillKey: binding.skillKey, processKey: process.processKey, hitAbilityRef: binding.hitBindings[0]!.hitAbilityRef }, candidate,
    operation: candidate.operations[0]!, operationPath: `${hit.path}.operations[0].skillHit.candidates[0].operations[0]` };
}

/** 可靠累计独立于明细预算；完整过程证明消费，分类汇总证明负载金额。 */
export function inspectPrimaryReplacements(compile: CompileRequest, request: RunRequest, done: DoneResult): string[] {
  const issues: string[] = [], raw: unknown = done.summary?.basicAttack?.primaryReplacements;
  const consumed = (done.finalSnapshot.processInstances ?? []).filter(process => process.empoweredAttack?.replacedPrimary !== undefined);
  const check = (condition: unknown, message: string) => { if (!condition) issues.push(`summary.basicAttack.primaryReplacements: ${message}`); return !!condition; };
  if (raw === undefined && !consumed.length) return issues;
  if (!check(Array.isArray(raw) && raw.length > 0, '实际替换必须保留非空可靠累计')) return issues;
  const plan = request.driverPlan.basicAttack;
  if (!check(!!plan, '替换累计缺少本次真实普攻')) return issues;
  const primary = basicAttackPrimaryBinding(compile, plan!);
  if (!check(!!primary, '替换累计缺少显式唯一主体')) return issues;
  const contracts = (compile.rules.skillActionBindings ?? []).map(binding => replacementPayloadBinding(compile, binding)).filter(row => row !== null);
  const seen = new Set<string>();
  let total = 0;
  for (const value of raw as unknown[]) {
    if (!check(exact(value, rowKeys), '累计行字段必须完整且没有额外字段')) continue;
    const row = value as unknown as BasicAttackPrimaryReplacement;
    const fields = value as Record<string, unknown>;
    const contract = contracts.find(contract => sameReplacement(contract.identity, row.replacement));
    if (!check(samePrimaryIdentity(row.primary, primary!.identity) && !!contract && row.target === plan!.target, '累计完整身份与真实主体、替换绑定或目标不符')) continue;
    const key = JSON.stringify([primaryKeys.map(key => row.primary[key]), replacementKeys.map(key => row.replacement[key]), row.target]);
    check(!seen.has(key), '同绑定及目标累计重复'); seen.add(key);
    if (!check(Number.isSafeInteger(row.count) && row.count > 0 && Number.isSafeInteger(row.blockedCount) && row.blockedCount >= 0
      && row.blockedCount <= row.count && ['postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss'].every(key => typeof fields[key] === 'number'
        && Number.isFinite(fields[key]) && (fields[key] as number) >= 0), '替换次数、阻挡次数或金额无效')) continue;
    total += row.count;
    check(contract!.candidate.spellShieldBlockScope !== null || row.blockedCount === 0, '无阻挡资格的替换不能伪造阻挡次数');
    const processes = consumed.filter(process => process.owner === row.replacement.owner && process.providerRef === row.replacement.providerRef
      && process.skillKey === row.replacement.skillKey && process.processKey === row.replacement.processKey);
    check(processes.length === row.count && processes.every(process => process.status === 'complete' && process.stepExecutionIndex === 1
      && process.empoweredAttack!.target === row.target && samePrimaryIdentity(process.empoweredAttack!.replacedPrimary, row.primary)), '累计与已完成真实消费过程不符');
    const breakdown = (done.summary.damageBreakdown ?? []).filter(damage => damage.owner === row.replacement.owner && damage.source === row.replacement.owner
      && damage.target === row.target && damage.abilityRef === row.replacement.hitAbilityRef && damage.operationRef === contract!.operation.ref
      && damage.damageType === contract!.operation.damageType);
    const sum = (field: 'damageCount' | 'postDefenseDamage' | 'shieldAbsorbed' | 'actualHpLoss') => breakdown.reduce((sum, damage) => sum + damage[field], 0);
    check(sum('damageCount') === row.count - row.blockedCount && ['postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss'].every(field =>
      close(sum(field as 'postDefenseDamage'), row[field as 'postDefenseDamage'])), '可靠替换累计与实际负载分类不符');
  }
  check(total === consumed.length && total <= (done.summary.basicAttack?.hitCount ?? 0), '替换总数缺失、重复或超过真实命中');
  const attacks = new Set<string>();
  for (const process of consumed) {
    const association = process.empoweredAttack!;
    check(!attacks.has(association.useRef), '同一次真实普攻重复替换主体'); attacks.add(association.useRef);
    check(!done.damageRecords?.some(row => row.useRef === association.useRef && row.operationPath === primary!.operationPath), '替换与原主体同时结算');
    if (request.outputMode !== 'summary' && done.recording?.damageRecordsTruncated === false) {
      const contract = contracts.find(contract => contract.identity.owner === process.owner && contract.identity.providerRef === process.providerRef
        && contract.identity.processKey === process.processKey && contract.identity.skillKey === process.skillKey);
      const records = (done.damageRecords ?? []).filter(row => row.useRef === process.useKey && row.operationPath === contract?.operationPath);
      check(records.length <= 1 && records.every(row => row.abilityRef === contract?.identity.hitAbilityRef && row.hitRef === association.hitRef
        && row.timeMs === process.lastExecutionAtMs && row.target === association.target && samePrimaryIdentity(row.empoweredAttack?.replacedPrimary, association.replacedPrimary)), '替换详细负载缺失双身份或重复');
    }
  }
  return issues;
}
