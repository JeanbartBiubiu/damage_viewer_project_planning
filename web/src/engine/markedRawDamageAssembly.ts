import type { AbilityDefinition, CompileRequest, GenericFormulaExpr, ListenerDefinition, OperationDefinition, ProviderDefinition } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { BasicAttackBinding, OperationOrigin, SimulationSkillOriginTrace } from './simulation/model';
import { NumericAdaptationError } from './numericAdapter';
import { basicAttackPrimaryBinding } from './primaryAttackReplacementContract';
import { validateMarkedRawDamageContract } from './markedRawDamageContract';
import { sameFormulaPayload } from '../services/skillFormulaContract';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
const single = (operation: OperationDefinition) => !operation.condition && !operation.repeatScope
  && (operation.repeatCount === undefined || operation.repeatCount === 1) && !operation.repeatDelayMs;

function mountedAbility(request: CompileRequest, reference: string) {
  const match = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(reference);
  const mounts = request.combatants.find(actor => actor.key === match?.[1])?.providers.filter(row => row.providerRef === match?.[2]) ?? [];
  const providers = request.sharedProviders?.filter(row => row.providerKey === mounts[0]?.definitionRef) ?? [];
  const abilities = providers[0]?.abilities?.filter(row => row.abilityKey === match?.[3]) ?? [];
  return match && mounts.length === 1 && providers.length === 1 && abilities.length === 1
    ? { provider: providers[0]!, ability: abilities[0]!, mount: mounts[0]! } : undefined;
}

function operations(value: unknown): OperationDefinition[] {
  if (Array.isArray(value)) return value.flatMap(operations);
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  return [...(typeof row.operation === 'string' ? [row as OperationDefinition] : []), ...Object.values(row).flatMap(operations)];
}

function possibleMatch(matcher: { all?: string[]; any?: string[]; none?: string[] }, tags: Set<string>) {
  return (matcher.all ?? []).every(type => tags.has(type)) && (!matcher.any?.length || matcher.any.some(type => tags.has(type)))
    && !(matcher.none ?? []).some(type => tags.has(type));
}

/** 检查最终候选边界；同候选内的操作下标不能证明伤害已提交。 */
export function validateMarkedRawPrimaryOrder(request: CompileRequest, binding: BasicAttackBinding,
  contract: { primarySkillKey: string; physicalDamageTypeKey: string; magicDamageTypeKey: string },
  mark: { provider: ProviderDefinition; ability: AbilityDefinition }, origins: readonly OperationOrigin[], root: string) {
  if (binding.skillKey !== contract.primarySkillKey || binding.source !== 'source' || binding.target !== 'target') {
    fail(root, '挂标入口必须绑定本场真实选定的普通攻击');
  }
  const primary = basicAttackPrimaryBinding(request, binding);
  const hit = mountedAbility(request, binding.hitAbilityRef), start = mountedAbility(request, binding.startAbilityRef);
  const initial = mountedAbility(request, binding.initialControlAbilityRef);
  const resolver = hit?.ability.operations?.[0];
  if (!primary || !hit || !start || !initial || hit.ability.operations?.length !== 1 || resolver?.operation !== 'resolve_skill_hit'
    || !resolver.skillHit || !single(resolver) || start.ability.operations?.length || initial.ability.operations?.length
    || primary.operation.damageType !== contract.physicalDamageTypeKey
    || !primary.operation.types?.includes('damage_trait/delivery_basic_attack') || !primary.operation.types.includes('damage_trait/origin_direct')) {
    fail(root, '先挂标需要唯一独立的物理PRIMARY候选与无额外负载的真实普攻入口');
  }
  const candidates = resolver.skillHit.candidates;
  const primaryIndex = candidates.indexOf(primary.candidate);
  if (primaryIndex !== 0 || resolver.skillHit.ruleGroups?.length
    || candidates.some((candidate, index) => candidate.attackDamageRole === 'REPLACE_PRIMARY'
      || index < primaryIndex && operations(candidate).some(operation => operation.operation === 'damage'))) {
    fail(root, '主体必须先于其它伤害候选独立提交，不能共用暂存规则或替换主体');
  }
  for (const candidate of candidates) {
    if (candidate === primary.candidate) continue;
    if (candidate.operations.length !== 1 || !single(candidate.operations[0]!)
      || !['damage', 'apply_hit_link', 'apply_attack_link'].includes(candidate.operations[0]!.operation)) {
      fail(root, '普攻其余候选需是可证明顺序的独立叶操作');
    }
  }
  const process = initial.provider.processes?.find(row => row.processKey === initial.ability.processControl?.processKey);
  const processOperations = operations(process);
  if (!process || processOperations.some(operation => !single(operation)
    || !['state_change', 'apply_hit_link', 'apply_attack_link'].includes(operation.operation))) {
    fail(root, '普攻开始过程不能在物理主体前另行产生伤害或未知调用');
  }
  const mounts = request.combatants.find(actor => actor.key === 'source')?.providers ?? [];
  const providers = mounts.map(mount => request.sharedProviders?.find(provider => provider.providerKey === mount.definitionRef))
    .filter((provider): provider is ProviderDefinition => !!provider);
  const identity = `ability/skill/${binding.skillKey}`;
  const tags = new Set(['event/damage_instance', 'event/source_owner', identity, contract.physicalDamageTypeKey,
    ...(hit.ability.types ?? []), ...(primary.operation.types ?? [])]);
  const beforeEvents = ['event/basic_attack_start', 'event/ability_started',
    ...processOperations.flatMap(operation => operation.operation === 'apply_attack_link' ? ['event/attack_link_applied']
      : operation.operation === 'apply_hit_link' ? ['event/hit_link_applied'] : [])];
  const checkListener = (listener: ListenerDefinition, ownProvider?: ProviderDefinition) => {
    const before = beforeEvents.some(event => possibleMatch(listener.eventMatcher,
      new Set([event, 'event/source_owner', identity, ...(hit.ability.types ?? [])])));
    if (!before && !possibleMatch(listener.eventMatcher, tags)) return;
    const initialListener = ownProvider === hit.provider && !listener.operations?.length
      && listener.abilityRef?.replace(/^self\./, 'source.') === binding.initialControlAbilityRef
      && !listener.eventMatcher.any?.length && !listener.eventMatcher.none?.length
      && sameFormulaPayload([...(listener.eventMatcher.all ?? [])].sort(), ['event/basic_attack_start', 'event/source_owner'].sort());
    if (initialListener) return;
    if (listener.abilityRef || operations(listener).some(operation =>
      !['state_change', 'cooldown_change', 'heal', 'resource_change'].includes(operation.operation))) {
      fail(root, '另一个先发监听可能在挂标前产生伤害，当前组合无法证明');
    }
  };
  const packets: OperationDefinition[] = [];
  for (const provider of providers) {
    for (const listener of provider.listeners ?? []) checkListener(listener, provider);
    for (const ability of provider.abilities ?? []) {
      for (const operation of operations(ability)) {
        if (operation.operation === 'damage' && operation.damageType === contract.physicalDamageTypeKey
          && (ability.skillKey === binding.skillKey || ability.types?.includes(identity) || operation.types?.includes(identity))
          && operation.types?.includes('damage_trait/delivery_basic_attack') && operation.types.includes('damage_trait/origin_direct')) packets.push(operation);
        if (operation.operation === 'resolve_skill_hit' && operation.skillHit?.candidates.some(candidate => candidate.attackDamageRole === 'REPLACE_PRIMARY')) {
          fail(root, '当前挂标抽象不能与普攻主体替换共用');
        }
      }
      if (ability === mark.ability) continue;
      const listener = ability.listenerSpec;
      if (!listener) continue;
      checkListener(listener, provider);
    }
  }
  for (const listener of request.rules.listeners ?? []) checkListener(listener);
  if (packets.length !== 1 || packets[0] !== primary.operation) fail(root, '物理普攻标签必须只命中该真实PRIMARY，不能把额外物理包当成主体');
  const origin = origins.filter(row => row.abilityRef === binding.hitAbilityRef && row.skillKey === binding.skillKey
    && row.effectKey === primary.identity.effectKey && row.resultKey === primary.identity.resultKey
    && row.operationRef === primary.operation.ref && row.compiledPaths.includes(primary.operationPath));
  if (origin.length !== 1) fail(root, '物理主体缺少最终实际操作路径与作者结果的唯一对应');
}

/** 保留完整定义和本场可达入口的区别；未驱动普攻时不虚构PRIMARY。 */
export function validateMarkedRawDamageAssembly(snapshot: SimulationSnapshot, request: CompileRequest,
  binding: BasicAttackBinding | null, origins: readonly SimulationSkillOriginTrace[], operationOrigins: readonly OperationOrigin[]) {
  for (const source of origins) {
    if (!source.enabled || source.skillStatus !== 'ENABLED' || !source.skillLevel || source.inactiveReason !== null) continue;
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === source.skillKey);
    if (!configuration) continue;
    const root = `skills.${source.skillKey}`;
    const contract = validateMarkedRawDamageContract(snapshot, configuration, root);
    if (!contract) continue;
    const owners = request.combatants.filter(actor => actor.key === source.side);
    const mounts = owners[0]?.providers.filter(row => row.providerRef === source.providerRef) ?? [];
    const providers = request.sharedProviders?.filter(row => row.providerKey === source.definitionRef) ?? [];
    const provider = providers[0];
    if (owners.length !== 1 || !['CHARACTER', 'BUILD_OPTION'].includes(source.origin.kind) || mounts.length !== 1
      || mounts[0]!.definitionRef !== source.definitionRef || providers.length !== 1 || !provider
      || provider.skillKey !== source.skillKey || provider.lifecycle || !['character', 'build'].includes(provider.kind)
      || source.side === 'target' && (source.origin.kind !== 'CHARACTER' || provider.kind !== 'character')) {
      fail(root, '原额派生缺少实际拥有方唯一永久自然挂载');
    }
    const ownedMounts = owners[0]!.providers.filter(mount =>
      request.sharedProviders?.some(row => row.providerKey === mount.definitionRef && row.skillKey === source.skillKey));
    const abilities = provider.abilities ?? [], keys = abilities.map(ability => ability.abilityKey);
    const state = provider.initialStateSchema?.[contract.state.stateKey];
    if (ownedMounts.length !== 1 || ownedMounts[0] !== mounts[0] || provider.listeners?.length || provider.processes?.length || provider.modifiers?.length
      || new Set(keys).size !== keys.length || !sameFormulaPayload([...keys].sort(), [...source.enabledRuleKeys].sort())
      || Object.keys(provider.initialStateSchema ?? {}).length !== 1
      || !sameFormulaPayload(state, { valueType: 'integer', defaultValue: 0, maxValue: 1,
        durationMs: contract.durationMs, refreshPolicy: 'refresh_on_write' })) {
      fail(root, '实际标记挂载必须只含本场完整可达规则和唯一原目标计数，不能附加写者');
    }
    const before = `event.provider_target_state_before.${contract.state.stateKey}`;
    const compareBefore = (op: string, value: number): GenericFormulaExpr => ({ op,
      args: [{ op: 'read', path: before }, { op: 'const', value }] });
    for (const ability of abilities) {
      const listener = ability.listenerSpec, operation = listener?.operations?.[0];
      if (ability.kind !== 'passive_listener' || ability.skillKey !== source.skillKey || ability.operations?.length
        || ability.processControl || ability.tickSpec || ability.targetExpirySpec || ability.castCondition || ability.cooldown || ability.cost
        || !listener || listener.listenerKey !== ability.abilityKey || listener.operations?.length !== 1
        || listener.abilityRef || listener.maxTriggersPerEvent !== 1 || listener.oncePerUse !== undefined
        || listener.chainLimitKey !== undefined || listener.perCastThrottleMs !== undefined || listener.eventMatcher.any?.length || listener.eventMatcher.none?.length) {
        fail(root, '实际标记规则必须仍是无额外控制和节流的唯一逐笔监听');
      }
      const isPrimary = ability.abilityKey === contract.primaryRule.ruleKey;
      const isMagic = ability.abilityKey === contract.magicRule.ruleKey;
      const isR = ability.abilityKey === contract.rRule.ruleKey;
      const isW = ability.abilityKey === contract.wRule.ruleKey;
      if (!isPrimary && !isMagic && !isR && !isW) fail(root, '实际标记图混入了未授权规则');
      const tags = isPrimary ? ['event/damage_instance', 'event/source_owner', `ability/skill/${contract.primarySkillKey}`,
        contract.physicalDamageTypeKey, 'damage_trait/delivery_basic_attack', 'damage_trait/origin_direct']
        : isMagic ? ['event/damage_instance', 'event/source_owner', contract.magicDamageTypeKey]
          : isW ? ['event/damage_instance', 'event/source_owner', `ability/skill/${contract.wSkillKey}`,
            contract.magicDamageTypeKey, 'damage_trait/delivery_skill']
            : ['event/skill_hit', 'event/source_owner', `ability/skill/${contract.rSkillKey}`];
      let predicate = isPrimary ? compareBefore('gte', 0) : compareBefore('eq', 1);
      if (isR) {
        const predicates: GenericFormulaExpr[] = [...contract.rRule.conditionGroups[0]!.conditions].sort((left, right) => left.sortOrder - right.sortOrder)
          .map(condition => condition.conditionType === 'SKILL_HIT_TARGET_IS_ENEMY' ? { op: 'const', value: 1 }
            : { op: 'eq', args: [{ op: 'read', path: 'event.skill_hit.blocked' }, { op: 'const', value: 0 }] });
        predicate = predicates.reduce((left, right) => ({ op: 'min', args: [left, right] }));
      }
      if (!sameFormulaPayload([...(listener.eventMatcher.all ?? [])].sort(), tags.sort()) || !sameFormulaPayload(listener.condition, predicate)) {
        fail(root, '实际标记监听必须保留该入口的完整事件过滤及冻结资格');
      }
      if (isMagic) {
        if (operation?.operation !== 'damage' || operation.target !== 'target' || operation.damageType !== contract.trueDamageTypeKey
          || !single(operation) || operation.critEligible !== false || operation.ref !== `${root}.effects.${contract.effect.effectKey}.results.${contract.result.resultKey}`
          || operation.vampQualification !== 'RESOLVED' || operation.vampOverrides?.length
          || !sameFormulaPayload([...(operation.types ?? [])].sort(), ['damage_trait/delivery_skill', 'damage_trait/origin_direct'].sort())
          || Object.keys(operation).some(key => !['operation', 'target', 'damageType', 'amount', 'ref', 'critEligible', 'types', 'vampQualification', 'vampOverrides'].includes(key))
          || !sameFormulaPayload(operation.amount, contract.loweredValue.expression)) fail(root, '实际派生必须仍是本笔原额的唯一真伤操作');
      } else if (operation?.operation !== 'state_change' || operation.ref !== contract.state.stateKey || operation.target !== 'self'
        || operation.valuePolicy !== 'set' || !single(operation)
        || Object.keys(operation).some(key => !['operation', 'target', 'ref', 'valuePolicy', 'amount', 'types'].includes(key))
        || !sameFormulaPayload(operation.types, ['state_scope/provider_target']) || !sameFormulaPayload(operation.amount, { op: 'const', value: 1 })) {
        fail(root, '实际挂标只能执行一次原目标SET1，不能附加其它状态写入');
      }
    }
    const primary = provider.abilities?.filter(ability => ability.abilityKey === contract.primaryRule.ruleKey && ability.listenerSpec) ?? [];
    const drivenPrimary = binding?.source === source.side && binding.target === (source.side === 'source' ? 'target' : 'source')
      && binding.skillKey === contract.primarySkillKey;
    if (!drivenPrimary) {
      if (primary.length || source.enabledRuleKeys.includes(contract.primaryRule.ruleKey)) fail(root, '本场未驱动普攻时不能保留虚构挂标入口');
      continue;
    }
    if (primary.length !== 1 || !source.enabledRuleKeys.includes(contract.primaryRule.ruleKey)) fail(root, '本场真实普攻缺少唯一挂标监听');
    validateMarkedRawPrimaryOrder(request, binding!, contract, { provider, ability: primary[0]! }, operationOrigins, root);
  }
}
