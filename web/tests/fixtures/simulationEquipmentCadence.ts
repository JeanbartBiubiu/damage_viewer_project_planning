import type { GenericFormulaExpr, OperationDefinition, ProviderDefinition } from '../../src/types/genericEngine';
import type { OperationOrigin, prepareSimulation } from '../../src/engine/simulationAdapter';

export type CadenceScenario = 'counter' | 'cooldown' | 'periodic' | 'target_death' | 'source_death' | 'vamp' | 'periodic_speed';

const constant = (value: number): GenericFormulaExpr => ({ op: 'const', value });
const slot = (base: number, current = base) => ({ base, current, max: base, resolved: base });
const compare = (key: string, operator: string, value: number): GenericFormulaExpr => ({
  op: operator, args: [{ op: 'read', path: `provider.state.${key}` }, constant(value)]
});
const stateChange = (key: string, policy: string, value: number, condition?: GenericFormulaExpr): OperationDefinition => ({
  operation: 'state_change', target: 'self', ref: key, types: ['state_scope/provider'], valuePolicy: policy, amount: constant(value), condition
});

export async function equipmentCadenceConstruct(prepared: Awaited<ReturnType<typeof prepareSimulation>>, scenario: CadenceScenario) {
  const input = structuredClone(prepared.compileRequest);
  const origins = structuredClone(prepared.operationOrigins);
  input.rulesHash = `explicit-${scenario}-mechanism-not-real-equipment`;
  input.rules.attributeDerivations = [];
  input.rules.vampRules = [{ vampType: 'LIFE_STEAL', sourceAttributeKey: 'life_steal_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1,
    targetMatcher: { all: ['combatant/champion'] }, abilityMatcher: { any: ['ability/basic_attack', 'ability/passive'] },
    damageMatcher: { all: ['damage_trait/origin_direct'], any: ['damage_trait/delivery_basic_attack', 'damage_trait/delivery_skill'] } }];
  for (const entry of [{ key: 'combatant/champion', domain: 'combatant' }, { key: 'ability/passive', domain: 'ability' },
    { key: 'state_scope/provider', domain: 'state_scope' }, { key: 'damage_trait/delivery_skill', domain: 'damage_trait' },
    { key: 'damage_trait/delivery_basic_attack', domain: 'damage_trait' }, { key: 'damage_trait/origin_direct', domain: 'damage_trait' }]) {
    if (!input.typeCatalog.types.some(declared => declared.key === entry.key)) input.typeCatalog.types.push(entry);
  }
  for (const actor of input.combatants) {
    actor.types = ['combatant/champion'];
    for (const key of ['armor', 'armor_pen_percent', 'armor_pen_flat', 'critical_strike_chance', 'critical_strike_damage_bonus_percent', 'life_steal_percent', 'omnivamp_percent', 'bonus_attack_speed_percent']) actor.attributes[key] = slot(0);
    actor.attributes.attack_speed = slot(1);
    actor.attributes.attack_speed_ratio = slot(1);
    actor.attributes.attack_damage = slot(10);
    actor.attributes.hp = actor.key === 'source' ? slot(1000, scenario === 'source_death' ? 12 : 500) : slot(10000, scenario === 'target_death' ? 27 : 10000);
  }
  if (scenario === 'vamp') input.combatants[0]!.attributes.life_steal_percent = slot(.1);
  const bodyRef = prepared.basicAttackBinding.hitAbilityRef;
  const bodyOrigin = origins.find(origin => origin.abilityRef === bodyRef)!;
  const match = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(bodyRef)!;
  const mount = input.combatants[0]!.providers.find(provider => provider.providerRef === match[1])!;
  const body = input.sharedProviders!.find(provider => provider.providerKey === mount.definitionRef)!.abilities!.find(ability => ability.abilityKey === match[2])!;
  const bodyOperations = body.operations!.flatMap(operation => operation.skillHit?.candidates.flatMap(candidate => candidate.operations) ?? []);
  const damageType = bodyOperations.find(operation => operation.operation === 'damage')!.damageType!;
  const owner = scenario === 'source_death' ? 'target' : 'source';
  const skillKey = `mechanism_${scenario}`;
  const fixedKey = `${owner}_${skillKey}_fixed`;
  const providerRef = `${owner}_${skillKey}_mount`;
  const definitionRef = `${owner}_${skillKey}_definition`;
  input.sharedProviders!.push({ providerKey: fixedKey, stableId: fixedKey, kind: 'item', modifiers: [
    { modifierKey: 'explicit_zero_hp', kind: 'attribute', target: 'self.attr.hp', valuePolicy: 'add', value: constant(0) }
  ] });
  const definition: ProviderDefinition = { providerKey: definitionRef, stableId: fixedKey, kind: 'item', abilities: [] };
  const definitionIndex = input.sharedProviders!.length;
  const damage = (resultKey: string, amount: number, suffix: string, condition?: GenericFormulaExpr): OperationDefinition => {
    const effectKey = 'cadence';
    const operationRef = `skills.${skillKey}.effects.${effectKey}.results.${resultKey}`;
    const origin: OperationOrigin = { ...bodyOrigin, skillKey, effectKey, resultKey, operationRef,
      abilityRef: `${owner}.provider[${providerRef}].ability[cadence]`, compiledPaths: [`sharedProviders[${definitionIndex}].abilities[0].${suffix}`] };
    origins.push(origin);
    return { operation: 'damage', target: 'target', damageType, ref: operationRef, amount: constant(amount), condition,
      vampQualification: 'RESOLVED', types: ['damage_trait/origin_direct', scenario === 'counter' || scenario === 'cooldown' ? 'damage_trait/delivery_basic_attack' : 'damage_trait/delivery_skill'] };
  };
  if (scenario === 'counter' || scenario === 'cooldown') {
    const ready = compare(scenario === 'counter' ? 'hits' : 'blocked', scenario === 'counter' ? 'gte' : 'eq', scenario === 'counter' ? 3 : 0);
    definition.initialStateSchema = scenario === 'counter' ? { hits: 0 } : { blocked: { valueType: 'number', defaultValue: 0, maxValue: 1, durationMs: 1001, refreshPolicy: 'refresh_on_write' } };
    const operations = [damage('bonus', 5, 'listenerSpec.operations[0]')];
    if (scenario === 'counter') operations.push(stateChange('hits', 'add', 1));
    const damageIndex = operations.length;
    operations.push(damage('conditional', scenario === 'counter' ? 40 : 25, `listenerSpec.operations[${damageIndex}]`, ready));
    operations.push(stateChange(scenario === 'counter' ? 'hits' : 'blocked', 'override', scenario === 'counter' ? 0 : 1, ready));
    definition.abilities!.push({ abilityKey: 'cadence', skillKey, kind: 'passive_listener', types: ['ability/passive'], listenerSpec: {
      listenerKey: `${skillKey}_hit`, maxTriggersPerEvent: 1, eventMatcher: { all: ['event/basic_attack_hit', 'event/source_owner'] }, operations
    } });
  } else {
    const operations = [damage('periodic', scenario === 'source_death' ? 7 : 5, 'tickSpec.onTick[0]')];
    if (scenario === 'periodic_speed') {
      definition.initialStateSchema = { active: { valueType: 'number', defaultValue: 0, maxValue: 1, durationMs: 400, refreshPolicy: 'refresh_on_write' } };
      definition.modifiers = [{ modifierKey: 'periodic_speed', kind: 'attribute', target: 'self.attr.bonus_attack_speed_percent', valuePolicy: 'add', value: { op: 'read', path: 'provider.state.active' } }];
      operations.push(stateChange('active', 'override', 1));
      input.rules.attributeDerivations = [{ combatantKey: 'source', attributeKey: 'attack_speed', value: { op: 'add', args: [
        { op: 'read', path: 'source.attr.attack_speed.base' }, { op: 'mul', args: [{ op: 'read', path: 'source.attr.attack_speed_ratio.resolved' },
          { op: 'read', path: 'source.attr.bonus_attack_speed_percent.resolved' }] }
      ] } }];
    }
    definition.abilities!.push({ abilityKey: 'cadence', skillKey, kind: 'tick', types: ['ability/passive'], tickSpec: {
      startDelayMs: scenario === 'periodic_speed' ? 400 : 500, intervalMs: 1000, onTick: operations
    } });
  }
  input.sharedProviders!.push(definition);
  input.combatants.find(actor => actor.key === owner)!.providers.push({ providerRef: fixedKey, definitionRef: fixedKey }, { providerRef, definitionRef });
  const durationMs = scenario === 'counter' ? 5000 : scenario === 'cooldown' ? 2000 : scenario === 'periodic_speed' ? 1400 : ['target_death', 'source_death'].includes(scenario) ? 4000 : 2500;
  return { input, origins, binding: prepared.basicAttackBinding, durationMs };
}
