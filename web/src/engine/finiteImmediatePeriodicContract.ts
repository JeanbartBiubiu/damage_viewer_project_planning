import type { AbilityDefinition, CompileRequest, ProcessInstanceSnapshot, ProviderDefinition, SkillActionBinding } from '../types/genericEngine';

/** 从实际父挂载、INITIAL及PROCESS_START应用取得身份，不能只凭0字段或能力名。 */
export function finiteImmediatePeriodicBinding(input: CompileRequest, provider: ProviderDefinition, ability: AbilityDefinition): SkillActionBinding | undefined {
  const tick = ability.tickSpec, life = provider.lifecycle;
  if (provider.kind !== 'status' || !provider.skillKey || !provider.stableId || provider.abilities?.length !== 1 || provider.abilities[0] !== ability
    || provider.processes?.length || provider.modifiers?.length || provider.listeners?.length || provider.statusContributions?.length || provider.initialStateSchema || provider.linkedShieldDefinitionRef
    || !life?.durationMs || life.durationMs.op !== 'const' || !Number.isSafeInteger(life.durationMs.value) || life.durationMs.value! <= 0
    || life.maxStacks !== 1 || life.refreshPolicy !== 'replace' || life.instanceScope !== 'source_target' || life.tickIntervalMs !== undefined
    || ability.kind !== 'tick' || ability.skillKey !== provider.skillKey || ability.operations?.length || ability.listenerSpec || ability.targetExpirySpec || ability.processControl || ability.cost || ability.cooldown || ability.castCondition
    || !tick || tick.startDelayMs !== 0 || !Number.isSafeInteger(tick.intervalMs) || tick.intervalMs <= 0 || tick.anchorScope || tick.anchorStateKey || tick.phasePolicy
    || !tick.onTick.length || tick.onTick.some(op => op.operation !== 'damage' || op.target !== 'target' || op.condition || op.repeatCount !== undefined || op.repeatDelayMs !== undefined || op.repeatScope)) return undefined;
  if (input.combatants.some(actor => actor.providers.some(mount => mount.definitionRef === provider.providerKey))) return undefined;
  const parents = (input.sharedProviders ?? []).filter(row => row !== provider && row.kind === 'character' && !row.lifecycle
    && row.skillKey === provider.skillKey && row.stableId === provider.stableId);
  if (parents.length !== 1) return undefined;
  const parent = parents[0]!, mounts = input.combatants.flatMap(actor => actor.providers.filter(mount => mount.definitionRef === parent.providerKey).map(mount => ({ actor: actor.key, mount })));
  if (mounts.length !== 1 || mounts[0]!.actor !== 'source') return undefined;
  const matches = input.rules.skillActionBindings?.filter(binding => binding.source === 'source' && binding.skillKey === provider.skillKey
    && binding.providerRef === mounts[0]!.mount.providerRef && binding.providerDefinitionRef === parent.providerKey) ?? [];
  if (matches.length !== 1) return undefined;
  const binding = matches[0]!, initials = binding.controls.filter(row => row.action === 'INITIAL');
  if (initials.length !== 1) return undefined;
  const initial = initials[0]!, processes = parent.processes?.filter(row => row.processKey === initial.processKey) ?? [];
  const abilities = parent.abilities?.filter(row => initial.abilityRef === `source.provider[${binding.providerRef}].ability[${row.abilityKey}]`) ?? [];
  if (processes.length !== 1 || processes[0]!.skillKey !== provider.skillKey || abilities.length !== 1 || abilities[0]!.kind !== 'active'
    || abilities[0]!.skillKey !== provider.skillKey || abilities[0]!.processControl?.action !== 'INITIAL'
    || abilities[0]!.processControl.processKey !== processes[0]!.processKey || abilities[0]!.processControl.useRefFromEvent === true) return undefined;
  const applications = processes[0]!.momentOperations.filter(row => row.moment.momentType === 'PROCESS_START' && row.moment.stepKey === null && row.moment.failureReason === null)
    .flatMap(row => row.operations).filter(op => op.operation === 'apply_provider' && op.target === 'self' && op.providerDefinitionRef === provider.providerKey && !op.condition);
  return applications.length === 1 ? binding : undefined;
}

export function finitePeriodicTargetsOpponent(input: CompileRequest, binding: SkillActionBinding): boolean {
  return (input.sharedProviders ?? []).some(provider => provider.abilities?.some(ability => finiteImmediatePeriodicBinding(input, provider, ability) === binding));
}

/** 动态区域不能伪装初始挂载；只按已闭合作者图及实际首次过程承认其伤害来源。 */
export function finiteImmediatePeriodicDamageSource(input: CompileRequest, row: {
  owner?: unknown; source?: unknown; target?: unknown; abilityRef?: unknown; providerDefinitionRef?: unknown; operationRef?: unknown; damageType?: unknown;
  operationPath?: unknown; timeMs?: unknown; providerActivatedAtMs?: unknown; attackIndex?: unknown; useRef?: unknown; instructionKey?: unknown; hitRef?: unknown;
}, processes: readonly ProcessInstanceSnapshot[] = []): boolean {
  if (row.owner !== 'source' || row.source !== 'source' || row.target !== 'target' || typeof row.abilityRef !== 'string'
    || typeof row.providerDefinitionRef !== 'string') return false;
  const definitions = (input.sharedProviders ?? []).filter(provider => provider.providerKey === row.providerDefinitionRef), provider = definitions[0];
  const ability = provider?.abilities?.[0];
  const binding = definitions.length === 1 && provider && ability ? finiteImmediatePeriodicBinding(input, provider, ability) : undefined;
  const ref = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(row.abilityRef);
  if (!binding || !provider || !ability || !ref || ref[2] !== ability.abilityKey || !ref[1]!.startsWith(provider.providerKey + '#')) return false;
  const instance = ref[1]!.slice(provider.providerKey.length + 1);
  if (!/^[1-9][0-9]*$/.test(instance) || !Number.isSafeInteger(Number(instance))) return false;
  const operations = ability.tickSpec!.onTick.filter(operation => operation.ref === row.operationRef && operation.damageType === row.damageType);
  if (operations.length !== 1) return false;
  const actual = processes.filter(process => process.owner === binding.source && process.target === 'target' && process.providerRef === binding.providerRef
    && process.processKey === binding.controls.find(control => control.action === 'INITIAL')!.processKey && process.skillKey === binding.skillKey
    && Number.isSafeInteger(process.startedAtMs) && process.startedAtMs >= 0 && Number.isSafeInteger(process.stepVersion) && process.stepVersion >= 1
    && typeof process.useKey === 'string' && process.useKey.length > 0);
  if (!actual.length) return false;
  if (row.timeMs !== undefined) {
    if (!Number.isSafeInteger(row.timeMs) || Number(row.timeMs) < 0 || !Number.isSafeInteger(row.providerActivatedAtMs) || Number(row.providerActivatedAtMs) < 0
      || row.attackIndex !== null || row.useRef !== '' || row.instructionKey || row.hitRef) return false;
    const index = input.sharedProviders!.indexOf(provider), operationIndex = ability.tickSpec!.onTick.indexOf(operations[0]!);
    if (row.operationPath !== `sharedProviders[${index}].abilities[0].tickSpec.onTick[${operationIndex}]`) return false;
    // 每个新实例从首次真实开始建相位；活动重施只续期。严格排除到期时刻。
    let phase: number | undefined, expiry = -1;
    for (const process of [...actual].sort((left, right) => left.startedAtMs - right.startedAtMs)) {
      if (process.startedAtMs > Number(row.timeMs)) break;
      if (process.startedAtMs >= expiry) phase = process.startedAtMs;
      expiry = process.startedAtMs + provider.lifecycle!.durationMs!.value!;
    }
    return phase === row.providerActivatedAtMs && Number(row.timeMs) < expiry && Number(row.timeMs) >= phase!
      && (Number(row.timeMs) - phase!) % ability.tickSpec!.intervalMs === 0;
  }
  return true;
}
