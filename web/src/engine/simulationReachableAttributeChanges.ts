import type { AbilityDefinition, CompileRequest, OperationDefinition, ProviderDefinition, RunRequest, TypeMatcher } from '../types/genericEngine';

type Side = 'source' | 'target';
type Context = { source: Side; target: Side; owner: Side };
const opposite = (side: Side): Side => side === 'source' ? 'target' : 'source';
const recipient = (selector: string, context: Context): Side | undefined => selector === 'self' ? context.owner
  : selector === 'opponent' ? opposite(context.owner) : selector === 'source' ? context.source : selector === 'target' ? context.target : undefined;

/** 从实际驱动和绑定进入，只访问可能执行的操作；声明读取不算属性变化。 */
export function reachableAttributeChanges(input: CompileRequest, request?: RunRequest): Set<string> {
  const changed = new Set<string>();
  const definitions = new Map(input.sharedProviders?.map(provider => [provider.providerKey, provider]));
  const mounts = input.combatants.flatMap(actor => actor.providers.map(mount => ({ owner: actor.key, mount, provider: definitions.get(mount.definitionRef) })));
  const visited = new Set<string>();
  const eventTypes = (types: string[], context: Context, owner: Side) => {
    const expanded = new Set([...types, ...(context.source === owner ? ['event/source_owner'] : []), ...(context.target === owner ? ['event/target_owner'] : [])]);
    for (const type of expanded) for (const relation of input.typeCatalog.relations) if (relation.child === type) expanded.add(relation.parent);
    return expanded;
  };
  const matches = (matcher: TypeMatcher, types: Set<string>) => (matcher.all ?? []).every(type => types.has(type))
    && (!(matcher.any?.length) || matcher.any.some(type => types.has(type))) && !(matcher.none ?? []).some(type => types.has(type));
  const event = (types: string[], context: Context) => {
    for (const { owner, mount, provider } of mounts) {
      if (!provider) continue;
      const available = eventTypes(types, context, owner);
      for (const ability of provider.abilities ?? []) if (ability.listenerSpec && matches(ability.listenerSpec.eventMatcher, available)) {
        abilityOperations(provider, mount.providerRef, ability, { ...context, owner });
      }
      for (const listener of provider.listeners ?? []) if (matches(listener.eventMatcher, available)) {
        const key = `listener/${owner}/${mount.providerRef}/${listener.listenerKey}/${context.source}/${context.target}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (listener.abilityRef) abilityReference(listener.abilityRef, { ...context, owner });
        operations(listener.operations ?? [], { ...context, owner });
      }
    }
  };
  const operations = (rows: readonly OperationDefinition[], context: Context) => {
    for (const operation of rows) {
      if (operation.condition?.op === 'const' && operation.condition.value === 0) continue;
      const owner = recipient(operation.target, context);
      if (operation.operation === 'attribute_change' && operation.attributeKey && owner) changed.add(`${owner}.${operation.attributeKey}`);
      if (operation.operation === 'resolve_skill_hit') for (const candidate of operation.skillHit?.candidates ?? []) {
        if (candidate.participationCondition?.op === 'const' && candidate.participationCondition.value === 0) continue;
        operations(candidate.operations, context);
      }
      if (operation.abilityRef) abilityReference(operation.abilityRef, { ...context, ...(owner ? { target: owner } : {}) });
      if (operation.operation === 'emit_event' && operation.eventType) event([operation.eventType], context);
      if (operation.operation === 'apply_provider' && operation.providerDefinitionRef && owner) {
        const provider = definitions.get(operation.providerDefinitionRef);
        for (const modifier of provider?.modifiers ?? []) {
          const match = /^(self|opponent)\.attr\.([a-z][a-z0-9_]*)$/.exec(modifier.target ?? '');
          if (modifier.kind === 'attribute' && match) changed.add(`${match[1] === 'self' ? owner : opposite(owner)}.${match[2]}`);
        }
      }
    }
  };
  const abilityOperations = (provider: ProviderDefinition, providerRef: string, ability: AbilityDefinition, context: Context) => {
    const key = `ability/${context.owner}/${providerRef}/${ability.abilityKey}/${context.source}/${context.target}`;
    if (visited.has(key)) return;
    visited.add(key);
    operations(ability.operations ?? [], context);
    if (ability.listenerSpec) {
      if (ability.listenerSpec.abilityRef) abilityReference(ability.listenerSpec.abilityRef, context);
      operations(ability.listenerSpec.operations ?? [], context);
    }
    if (ability.tickSpec) operations(ability.tickSpec.onTick, context);
    if (ability.processControl) {
      const process = provider.processes?.find(row => row.processKey === ability.processControl!.processKey);
      for (const group of process?.momentOperations ?? []) {
        if (ability.processControl.action === 'CANCEL' || ability.processControl.action === 'INTERRUPT') {
          if (group.moment.momentType !== 'PROCESS_FAILURE') continue;
        }
        operations(group.operations, context);
      }
    }
    if (ability.kind !== 'passive_listener') event(['event/ability_started', ...(ability.types ?? [])], context);
  };
  const abilityReference = (ref: string, context: Context) => {
    const match = /^(source|target|self|opponent)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(ref);
    const owner = match && recipient(match[1]!, context);
    const bound = owner && mounts.find(row => row.owner === owner && row.mount.providerRef === match![2]);
    const ability = bound?.provider?.abilities?.find(row => row.abilityKey === match![3]);
    if (bound?.provider && ability) abilityOperations(bound.provider, bound.mount.providerRef, ability, { ...context, owner: owner! });
  };
  const background = request?.driverPlan.basicAttack;
  if (background) {
    const context = { source: background.source, target: background.target, owner: background.source };
    abilityReference(background.startAbilityRef, context);
    abilityReference(background.initialControlAbilityRef, context);
    abilityReference(background.hitAbilityRef, context);
    event(['event/basic_attack_start'], context);
    event(['event/basic_attack_hit'], context);
  }
  for (const entry of request?.driverPlan.entries ?? []) abilityReference(entry.abilityRef, { source: entry.source, target: entry.target, owner: entry.source });
  for (const action of request?.driverPlan.skillActions ?? []) {
    const context = { source: action.source, target: action.target, owner: action.source };
    abilityReference(action.abilityRef, context);
    const binding = input.rules.skillActionBindings?.find(row => row.bindingKey === action.bindingKey && row.skillKey === action.skillKey && row.source === action.source);
    for (const hit of action.hitBindings) if (hit.preset !== 'MISS') {
      const compiled = binding?.hitBindings.find(row => row.hitBindingKey === hit.hitBindingKey);
      if (compiled) abilityReference(compiled.hitAbilityRef, context);
    }
  }
  for (const rule of request?.driverPlan.automaticSkills?.rules ?? []) {
    const bindings = input.rules.skillActionBindings?.filter(row => row.bindingKey === rule.bindingKey && row.source === 'source') ?? [];
    if (bindings.length !== 1) continue;
    const binding = bindings[0]!;
    const initial = binding.controls.filter(row => row.action === 'INITIAL');
    if (initial.length !== 1) continue;
    const context: Context = { source: binding.source, target: rule.target, owner: binding.source };
    abilityReference(initial[0]!.abilityRef, context);
    for (const hit of rule.hitBindings) if (hit.preset !== 'MISS') {
      const compiled = binding.hitBindings.filter(row => row.hitBindingKey === hit.hitBindingKey);
      if (compiled.length === 1) abilityReference(compiled[0]!.hitAbilityRef, context);
    }
  }
  if (!request) for (const binding of input.rules.skillActionBindings ?? []) {
    const context: Context = { source: binding.source, target: binding.hitBindings.length ? 'target' : binding.source, owner: binding.source };
    for (const control of binding.controls) abilityReference(control.abilityRef, context);
    for (const hit of binding.hitBindings) abilityReference(hit.hitAbilityRef, context);
  }
  return changed;
}
