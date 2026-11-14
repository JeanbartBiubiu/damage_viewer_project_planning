import type { CompileRequest, ListenerDefinition, ProviderDefinition } from '../types/genericEngine';
import type { OperationOrigin } from './simulation/model';

const onlyKeys = (row: object, keys: readonly string[]) => Object.keys(row).every(key => keys.includes(key));
const noExtraState = (provider: ProviderDefinition) => !provider.processes?.length && !provider.modifiers?.length
  && !provider.statusContributions?.length && !Object.keys(provider.initialStateSchema ?? {}).length;
function exactListener(listener: ListenerDefinition | undefined, events: readonly string[]): listener is ListenerDefinition {
  const matcher = listener?.eventMatcher;
  return !!listener && !!matcher && !listener.abilityRef && !listener.condition && !listener.oncePerUse
    && !listener.perCastThrottleMs && !listener.chainLimitKey && listener.maxTriggersPerEvent === 1
    && listener.operations?.length === 1 && matcher.all?.length === events.length
    && events.every(event => matcher.all?.includes(event)) && !matcher.any?.length && !matcher.none?.length;
}

/** 识别无独立能力的冻结法盾消费；身份必须来自唯一实际父挂载、完整初始化及其子监听。 */
export function initializedSpellShieldConsumptionOriginMatches(input: CompileRequest, origin: OperationOrigin): boolean {
  const match = /^(source|target)\.provider\[([^\]]+)\]$/.exec(origin.abilityRef);
  if (!match || origin.providerDefinitionRef !== match[2]) return false;
  const definitions = input.sharedProviders ?? [], shieldIndex = definitions.findIndex(row => row.providerKey === match[2]);
  const shield = definitions[shieldIndex];
  if (!shield || definitions.filter(row => row.providerKey === shield.providerKey).length !== 1 || shield.kind !== 'status'
    || shield.skillKey !== origin.skillKey || shield.types?.length !== 1 || shield.types[0] !== 'provider/spell_shield'
    || !shield.stableId || shield.abilities?.length || !noExtraState(shield) || shield.listeners?.length !== 1
    || !shield.lifecycle || shield.lifecycle.maxStacks !== 1 || shield.lifecycle.refreshPolicy !== 'replace'
    || !onlyKeys(shield.lifecycle, ['maxStacks', 'refreshPolicy'])
    || input.combatants.some(actor => actor.providers.some(mount => mount.definitionRef === shield.providerKey))) return false;
  const consume = shield.listeners[0];
  if (!exactListener(consume, ['event/spell_shield_blocked'])) return false;
  const remove = consume.operations![0]!;
  if (remove.operation !== 'expire_provider' || remove.target !== 'self' || remove.providerRefFromEvent !== true
    || remove.ref !== origin.operationRef || !onlyKeys(remove, ['operation', 'target', 'providerRefFromEvent', 'ref'])
    || origin.operationRef !== `skills.${origin.skillKey}.effects.${origin.effectKey}.results.${origin.resultKey}`
    || origin.compiledPaths.length !== 1 || origin.compiledPaths[0] !== `sharedProviders[${shieldIndex}].listeners[0].operations[0]`) return false;
  const parents = input.combatants.flatMap(actor => actor.providers.flatMap(mount => {
    const parent = definitions.find(row => row.providerKey === mount.definitionRef);
    return parent?.abilities?.some(ability => [...(ability.operations ?? []), ...(ability.listenerSpec?.operations ?? [])]
      .some(operation => operation.operation === 'apply_provider' && operation.providerDefinitionRef === shield.providerKey))
      ? [{ actor, parent, mount }] : [];
  }));
  if (parents.length !== 1) return false;
  const { actor, parent } = parents[0]!;
  if (actor.key !== match[1] || !['item', 'character', 'build'].includes(parent.kind) || !parent.stableId
    || definitions.filter(row => row.providerKey === parent.providerKey).length !== 1
    || parent.skillKey !== origin.skillKey || parent.lifecycle || !noExtraState(parent) || parent.listeners?.length
    || parent.abilities?.length !== 1) return false;
  const ability = parent.abilities[0]!;
  if (ability.kind !== 'passive_listener' || ability.skillKey !== origin.skillKey || ability.operations?.length
    || ability.cost || ability.cooldown || ability.castCondition || ability.tickSpec || ability.targetExpirySpec
    || ability.processControl || Object.keys(ability.stateSchema ?? {}).length
    || !exactListener(ability.listenerSpec, ['event/source_initialized', 'event/source_owner'])) return false;
  const apply = ability.listenerSpec.operations![0]!;
  return apply.operation === 'apply_provider' && apply.target === 'self' && apply.providerDefinitionRef === shield.providerKey
    && apply.providerRef === shield.providerKey && onlyKeys(apply, ['operation', 'target', 'providerDefinitionRef', 'providerRef', 'ref']);
}
