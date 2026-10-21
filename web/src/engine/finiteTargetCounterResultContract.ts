import type { AbilityDefinition, CompileRequest, GenericFormulaExpr, OperationDefinition, ProviderDefinition, ProviderStateFieldSchema } from '../types/genericEngine';
import type { OperationOrigin } from './simulationAdapter';
import { tryFoldConstant } from './numericAdapter';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = (expression: GenericFormulaExpr | undefined, path: string) => expression?.op === 'read' && expression.path === path;
const constant = (expression: GenericFormulaExpr | undefined, value: number) => !!expression && tryFoldConstant(expression) === value;
const scalar = (expression: GenericFormulaExpr | undefined, ability: AbilityDefinition) => expression?.op === 'read'
  && expression.path?.startsWith('ability.param.') ? ability.params?.[expression.path.slice('ability.param.'.length)]
  : expression ? tryFoldConstant(expression) : undefined;
const parts = (expression: GenericFormulaExpr | undefined): GenericFormulaExpr[] => expression?.op === 'min' && expression.args?.length === 2
  ? expression.args.flatMap(parts) : expression ? [expression] : [];
function compare(expression: GenericFormulaExpr, op: string, path: string, value: number, ability: AbilityDefinition) {
  return expression.op === op && expression.args?.length === 2 && read(expression.args[0], path) && scalar(expression.args[1], ability) === value;
}
function state(operation: OperationDefinition | undefined, key: string, policy: string, value: number, scope = 'state_scope/provider_target') {
  return !!operation && operation.operation === 'state_change' && operation.target === 'self' && operation.ref === key
    && operation.valuePolicy === policy && constant(operation.amount, value) && same(operation.types, [scope]) && !operation.condition;
}
function schema(provider: ProviderDefinition, key: string): ProviderStateFieldSchema | undefined {
  const field = provider.initialStateSchema?.[key];
  return typeof field === 'object' && field !== null ? field : undefined;
}
function guard(provider: ProviderDefinition, operation: OperationDefinition | undefined) {
  const field = operation?.ref && schema(provider, operation.ref);
  return !!operation?.ref && operation.operation === 'state_change' && operation.target === 'self'
    && operation.valuePolicy === 'set' && same(operation.types, ['state_scope/provider']) && !operation.condition
    && !!field && field.valueType === 'number' && field.defaultValue === 0 && field.maxValue === 1 && field.durationMs === 0;
}
function clean(ability: AbilityDefinition) {
  return !ability.cost && !ability.cooldown && !ability.castCondition && !ability.processControl && !ability.operations?.length;
}
function hitSource(input: CompileRequest, skillKey: string) {
  const bindings = input.rules.skillActionBindings?.filter(binding => binding.source === 'source' && binding.skillKey === skillKey) ?? [];
  if (bindings.length !== 1) return null;
  const binding = bindings[0]!, actor = input.combatants.find(row => row.key === 'source');
  const mounts = actor?.providers.filter(mount => mount.providerRef === binding.providerRef && mount.definitionRef === binding.providerDefinitionRef) ?? [];
  const providers = input.sharedProviders?.filter(provider => provider.providerKey === binding.providerDefinitionRef) ?? [];
  const root = providers[0], hit = binding.hitBindings[0], key = hit?.hitAbilityRef.match(/\.ability\[([^\]]+)\]$/)?.[1];
  const actual = root?.abilities?.find(ability => ability.abilityKey === key);
  const type = `ability/target_counter_hit/${binding.providerRef}`;
  if (mounts.length !== 1 || providers.length !== 1 || root?.kind !== 'character' || root.skillKey !== skillKey
    || root.processes?.length !== 1 || binding.controls.length !== 1 || binding.controls[0]!.action !== 'INITIAL'
    || binding.hitBindings.length !== 1 || hit?.hitAbilityRef !== `source.provider[${binding.providerRef}].ability[${key}]`
    || actual?.skillKey !== skillKey || actual.operations?.length !== 1 || actual.operations[0]!.operation !== 'resolve_skill_hit'
    || actual.operations[0]!.skillHit?.skillKey !== skillKey || !actual.types?.includes(type)) return null;
  return { actual, type };
}

/** 核对本轮完整编译因果图后，才把独立目标终点纳入结果身份；不授权任意anchored tick。 */
export function finiteTargetCounterExpiryOrigin(input: CompileRequest, provider: ProviderDefinition, ability: AbilityDefinition,
  origin: OperationOrigin, operation: OperationDefinition): boolean {
  const skillKey = provider.skillKey, tick = ability.tickSpec;
  if (!skillKey || provider.kind !== 'character' || provider.processes?.length || provider.listeners?.length || provider.modifiers?.length
    || provider.lifecycle || provider.statusContributions?.length || !clean(ability) || ability.kind !== 'tick' || ability.listenerSpec
    || ability.skillKey !== skillKey || !tick || tick.anchorScope !== 'state_scope/provider_target' || !tick.anchorStateKey
    || (tick.startDelayMs ?? 0) !== 0 || !Number.isSafeInteger(tick.intervalMs) || tick.intervalMs <= 0 || tick.onTick.length !== 2
    || provider.abilities?.filter(row => row.tickSpec).length !== 1) return false;
  const windowKey = tick.anchorStateKey, window = schema(provider, windowKey), expiryGuard = tick.onTick[0], damage = tick.onTick[1];
  const source = hitSource(input, skillKey);
  if (!source || !window || window.valueType !== 'integer' || window.defaultValue !== 0 || window.maxValue !== 1
    || window.durationMs !== tick.intervalMs || window.refreshPolicy !== 'refresh_on_write' || !guard(provider, expiryGuard)
    || damage !== operation || damage?.operation !== 'damage' || damage.target !== 'target' || damage.critEligible !== false
    || damage.vampQualification !== 'RESOLVED' || damage.ref !== origin.operationRef || origin.skillKey !== skillKey
    || origin.operationRef !== `skills.${skillKey}.effects.${origin.effectKey}.results.${origin.resultKey}`
    || !read(damage.condition, `provider.state.${expiryGuard!.ref}`)) return false;
  const own = input.combatants.find(actor => actor.key === 'source')?.providers.filter(mount => mount.definitionRef === provider.providerKey) ?? [];
  if (own.length !== 1 || origin.abilityRef !== `source.provider[${own[0]!.providerRef}].ability[${ability.abilityKey}]`) return false;
  const candidates = source.actual.operations![0]!.skillHit!.candidates;
  if (candidates.length !== 1 || candidates[0]!.spellShieldBlockScope !== 'SKILL'
    || candidates[0]!.semantic.resultType !== 'DAMAGE' || candidates[0]!.semantic.target !== 'TARGET'
    || candidates[0]!.operations.length !== 1 || candidates[0]!.operations[0]!.operation !== 'damage'
    || candidates[0]!.operations[0]!.critEligible !== false || !constant(candidates[0]!.operations[0]!.amount, 0)) return false;
  const listeners = (provider.abilities ?? []).filter(row => row !== ability);
  if (listeners.some(row => row.kind !== 'passive_listener' || row.skillKey !== skillKey || !clean(row) || row.tickSpec
    || !row.listenerSpec || row.listenerSpec.abilityRef || row.listenerSpec.maxTriggersPerEvent !== 1
    || row.listenerSpec.oncePerUse || row.listenerSpec.perCastThrottleMs || row.listenerSpec.eventMatcher.any?.length
    || row.listenerSpec.eventMatcher.none?.length)) return false;
  const applications = listeners.filter(row => same(row.listenerSpec!.eventMatcher.all,
    ['event/skill_hit', 'event/source_owner', `ability/skill/${skillKey}`, source.type]));
  if (applications.length !== 1) return false;
  const application = applications[0]!, app = application.listenerSpec!;
  const appOperations = app.operations ?? [], countKey = appOperations[0]?.ref, count = countKey && schema(provider, countKey);
  if (!countKey || countKey === windowKey || !count || count.valueType !== 'integer' || count.defaultValue !== 0 || count.durationMs !== 0
    || typeof count.maxValue !== 'number' || !Number.isSafeInteger(count.maxValue) || count.maxValue <= 0
    || appOperations.length !== 2 || !state(appOperations[0], countKey, 'set', 0) || !state(appOperations[1], windowKey, 'set', 1)
    || parts(app.condition).length !== 1 || !compare(parts(app.condition)[0]!, 'eq', 'event.skill_hit.blocked', 0, application)) return false;
  const used = new Set([countKey, windowKey, expiryGuard!.ref!]), seen = new Set<string>();
  const sameDamage = (candidate: OperationDefinition) => same({ ...candidate, condition: null }, { ...damage, condition: null });
  for (const listenerAbility of listeners.filter(row => row !== application)) {
    const listener = listenerAbility.listenerSpec!, all = listener.eventMatcher.all ?? [], roots = listener.operations ?? [];
    const basic = same(all, ['event/basic_attack_hit', 'event/source_owner']);
    const identity = all.filter(key => key.startsWith('ability/skill/'));
    const sibling = identity.length === 1 && hitSource(input, identity[0]!.slice('ability/skill/'.length));
    if (!basic && (!sibling || identity[0] === `ability/skill/${skillKey}`
      || !same(all, ['event/skill_hit', 'event/source_owner', identity[0], sibling.type]))) return false;
    const event = basic ? 'basic' : identity[0]!;
    if (seen.has(event)) return false;
    seen.add(event);
    const checks = parts(listener.condition);
    if (checks.length !== (basic ? 2 : 3) || !checks.some(check => compare(check, 'eq', `provider.target_state.${windowKey}`, 1, listenerAbility))
      || !checks.some(check => compare(check, 'lt', `provider.target_state.${countKey}`, count.maxValue as number, listenerAbility))
      || !basic && !checks.some(check => compare(check, 'eq', 'event.skill_hit.blocked', 0, listenerAbility))
      || roots.length !== 4 || !state(roots[0], countKey, 'add', 1) || !guard(provider, roots[1])
      || !roots[1]!.amount || !compare(roots[1]!.amount, 'eq', `provider.target_state.${countKey}`, count.maxValue as number, listenerAbility)
      || !sameDamage(roots[2]!) || !read(roots[2]!.condition, `provider.state.${roots[1]!.ref}`)
      || !same(roots[3]!.condition, roots[2]!.condition) || !state({ ...roots[3]!, condition: undefined }, windowKey, 'set', 0)) return false;
    used.add(roots[1]!.ref!);
  }
  const expiryChecks = parts(expiryGuard!.amount);
  return seen.has('basic') && expiryChecks.length === 3
    && expiryChecks.some(check => compare(check, 'lt', `provider.target_state.${countKey}`, count.maxValue as number, ability))
    && expiryChecks.filter(check => check.op === 'eq' && check.args?.length === 2
      && constant(check.args[0], 1) && constant(check.args[1], 1)).length === 1
    && expiryChecks.filter(check => check.op === 'eq' && check.args?.length === 2
      && constant(check.args[0], 0) && constant(check.args[1], 0)).length === 1
    && Object.keys(provider.initialStateSchema ?? {}).every(key => used.has(key));
}
