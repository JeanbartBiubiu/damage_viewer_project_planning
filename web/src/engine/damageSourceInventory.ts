import type { CompileRequest, OperationDefinition } from '../types/genericEngine';

export type DamageSourceContainer =
  | 'rules_operations'
  | 'rules_listener'
  | 'ability_operations'
  | 'ability_listener'
  | 'ability_tick'
  | 'provider_listener'
  | 'process_moment'
  | 'skill_hit_candidate';

export type SkillHitSource = {
  skillKey: string;
  candidateKey: string;
  effectOccurrenceKey: string;
  effectKey: string;
  resultKey: string;
};

export type InventoriedOperation = {
  path: string;
  providerKey: string | null;
  abilityKey: string | null;
  container: DamageSourceContainer;
  skillHit: SkillHitSource | null;
  operation: OperationDefinition;
};

export type InventoryReferenceKind =
  | 'mounted_provider_definition'
  | 'listener_ability'
  | 'operation_ability'
  | 'apply_provider_definition'
  | 'provider_instance'
  | 'process_control';

export type InventoryReference = {
  path: string;
  kind: InventoryReferenceKind;
  value: string;
  providerKey: string | null;
  abilityKey: string | null;
};

export type DamageSourceInventory = {
  damageOperations: InventoriedOperation[];
  repeatOperations: InventoriedOperation[];
  executeThresholdOperations: InventoriedOperation[];
  references: InventoryReference[];
};

export type DamageSourceInventoryErrorCode =
  | 'invalid_structure'
  | 'duplicate_key'
  | 'unknown_operation'
  | 'unsupported_structure';

export class DamageSourceInventoryError extends Error {
  constructor(
    readonly code: DamageSourceInventoryErrorCode,
    readonly path: string,
    message: string
  ) {
    super(`${path}: ${message}`);
    this.name = 'DamageSourceInventoryError';
  }
}

type UnknownRecord = Record<string, unknown>;
type SourceContext = Pick<InventoriedOperation, 'providerKey' | 'abilityKey' | 'container' | 'skillHit'>;

const leafOperations = new Set([
  'damage', 'heal', 'shield', 'resource_change', 'attribute_change',
  'apply_provider', 'refresh_provider', 'expire_provider', 'emit_event',
  'cooldown_change', 'state_change', 'state_duration_change', 'repeat',
  'execute_threshold'
]);

const requestKeys = [
  'schemaVersion', 'schemaHash', 'rulesHash', 'typeCatalog', 'combatants',
  'sharedProviders', 'rules', 'formulas', 'settings'
];
const rulesKeys = ['operations', 'modifiers', 'listeners', 'triggerRules', 'vampRules'];
const combatantKeys = ['key', 'displayName', 'types', 'tags', 'attributes', 'resources', 'providers'];
const mountKeys = ['providerRef', 'definitionRef', 'initialState', 'initialAbilityState'];
const providerKeys = [
  'providerKey', 'kind', 'stableId', 'types', 'tags', 'abilities', 'modifiers',
  'listeners', 'lifecycle', 'statusContributions', 'initialStateSchema', 'processes'
];
const abilityKeys = [
  'abilityKey', 'kind', 'types', 'tags', 'params', 'skillKey', 'cost', 'cooldown',
  'castCondition', 'castOrigin', 'operations', 'listenerSpec', 'tickSpec',
  'stateSchema', 'processControl'
];
const listenerKeys = [
  'listenerKey', 'eventMatcher', 'abilityRef', 'operations', 'maxTriggersPerEvent',
  'chainLimitKey', 'perCastThrottleMs', 'condition', 'oncePerUse'
];
const tickKeys = ['intervalMs', 'onTick', 'startDelayMs', 'anchorScope', 'anchorStateKey'];
const processKeys = ['processKey', 'skillKey', 'steps', 'costs', 'cooldown', 'momentOperations'];
const momentGroupKeys = ['moment', 'operations'];
const momentKeys = ['momentType', 'stepKey', 'failureReason'];
const skillHitKeys = ['skillKey', 'candidates'];
const candidateKeys = [
  'candidateKey', 'effectOccurrenceKey', 'effectKey', 'resultKey', 'semantic',
  'spellShieldBlockScope', 'participationCondition', 'eventValueConditions', 'operations'
];
const operationKeys = [
  'operation', 'target', 'amount', 'valuePolicy', 'damageType', 'resourceKey',
  'attributeKey', 'abilityRef', 'shieldRef', 'shieldDurationMs',
  'providerDefinitionRef', 'providerRef', 'eventType', 'payload', 'types', 'tags',
  'ref', 'condition', 'copyableOnHit', 'critEligible', 'repeatScope', 'repeatCount',
  'repeatTag', 'repeatDelayMs', 'triggerStateKey', 'threshold', 'vampQualification',
  'vampOverrides', 'skillHit', 'providerRefFromEvent', 'outputRef'
];

function fail(code: DamageSourceInventoryErrorCode, path: string, message: string): never {
  throw new DamageSourceInventoryError(code, path, message);
}

function record(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_structure', path, '必须是对象');
  }
  return value as UnknownRecord;
}

function knownKeys(value: UnknownRecord, allowed: readonly string[], path: string): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) fail('unsupported_structure', field(path, key), '未知结构字段');
  }
}

function field(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function keyed(path: string, key: string): string {
  return `${path}[${JSON.stringify(key)}]`;
}

function array(value: unknown, path: string, required = false): unknown[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) fail('invalid_structure', path, '必须是数组');
  return value as unknown[];
}

function nonemptyKey(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('invalid_structure', path, '缺少非空稳定键');
  }
  return value as string;
}

function unique(seen: Map<string, number>, key: string, index: number, path: string): void {
  const first = seen.get(key);
  if (first !== undefined) {
    fail('duplicate_key', path, `重复容器键 ${JSON.stringify(key)}，首次出现在下标 ${first}`);
  }
  seen.set(key, index);
}

function snapshot(operation: UnknownRecord, path: string): OperationDefinition {
  try {
    return structuredClone(operation) as OperationDefinition;
  } catch {
    return fail('invalid_structure', path, '操作必须可完整复制');
  }
}

function addReference(
  inventory: DamageSourceInventory,
  kind: InventoryReferenceKind,
  path: string,
  value: unknown,
  providerKey: string | null,
  abilityKey: string | null
): void {
  if (value === undefined) return;
  inventory.references.push({
    kind, path, value: nonemptyKey(value, path), providerKey, abilityKey
  });
}

function scanOperations(
  inventory: DamageSourceInventory,
  value: unknown,
  path: string,
  context: SourceContext,
  required = false
): void {
  const operations = array(value, path, required);
  for (const [index, raw] of operations.entries()) {
    const opPath = `${path}[${index}]`;
    const op = record(raw, opPath);
    knownKeys(op, operationKeys, opPath);
    const kind = nonemptyKey(op.operation, `${opPath}.operation`);
    if (kind === 'resolve_skill_hit') {
      if (context.container !== 'ability_operations' || index !== 0 || operations.length !== 1) {
        fail('unsupported_structure', `${opPath}.operation`, '命中解析只能是能力的唯一操作');
      }
      scanSkillHit(inventory, op, opPath, context);
      continue;
    }
    if (!leafOperations.has(kind)) {
      fail('unknown_operation', `${opPath}.operation`, `未知操作 ${JSON.stringify(kind)}`);
    }
    if (op.skillHit !== undefined) {
      fail('unsupported_structure', `${opPath}.skillHit`, '只有命中解析操作可以包含候选操作');
    }
    if (op.abilityRef !== undefined) {
      addReference(inventory, 'operation_ability', `${opPath}.abilityRef`, op.abilityRef, context.providerKey, context.abilityKey);
    }
    if (kind === 'apply_provider') {
      addReference(inventory, 'apply_provider_definition', `${opPath}.providerDefinitionRef`,
        op.providerDefinitionRef, context.providerKey, context.abilityKey);
      if (op.providerDefinitionRef === undefined) {
        fail('invalid_structure', `${opPath}.providerDefinitionRef`, '应用供值器缺少定义引用');
      }
    }
    if (op.providerRef !== undefined) {
      addReference(inventory, 'provider_instance', `${opPath}.providerRef`, op.providerRef,
        context.providerKey, context.abilityKey);
    }
    const entry: InventoriedOperation = { path: opPath, ...context, operation: snapshot(op, opPath) };
    if (kind === 'damage') inventory.damageOperations.push(entry);
    else if (kind === 'repeat') inventory.repeatOperations.push(entry);
    else if (kind === 'execute_threshold') inventory.executeThresholdOperations.push(entry);
  }
}

function scanSkillHit(
  inventory: DamageSourceInventory,
  operation: UnknownRecord,
  opPath: string,
  context: SourceContext
): void {
  if (operation.payload !== undefined) {
    fail('unsupported_structure', `${opPath}.payload`, '命中解析不能携带自由载荷');
  }
  const hitPath = `${opPath}.skillHit`;
  const hit = record(operation.skillHit, hitPath);
  knownKeys(hit, skillHitKeys, hitPath);
  const skillKey = nonemptyKey(hit.skillKey, `${hitPath}.skillKey`);
  const candidatePath = `${hitPath}.candidates`;
  const seen = new Map<string, number>();
  for (const [index, raw] of array(hit.candidates, candidatePath, true).entries()) {
    const sourcePath = `${candidatePath}[${index}]`;
    const candidate = record(raw, sourcePath);
    knownKeys(candidate, candidateKeys, sourcePath);
    const candidateKey = nonemptyKey(candidate.candidateKey, `${sourcePath}.candidateKey`);
    unique(seen, candidateKey, index, `${sourcePath}.candidateKey`);
    const path = keyed(candidatePath, candidateKey);
    const skillHit: SkillHitSource = {
      skillKey,
      candidateKey,
      effectOccurrenceKey: nonemptyKey(candidate.effectOccurrenceKey, `${path}.effectOccurrenceKey`),
      effectKey: nonemptyKey(candidate.effectKey, `${path}.effectKey`),
      resultKey: nonemptyKey(candidate.resultKey, `${path}.resultKey`)
    };
    scanOperations(inventory, candidate.operations, `${path}.operations`, {
      ...context, container: 'skill_hit_candidate', skillHit
    }, true);
  }
}

function scanListener(
  inventory: DamageSourceInventory,
  raw: unknown,
  path: string,
  context: Omit<SourceContext, 'skillHit'>
): void {
  const listener = record(raw, path);
  knownKeys(listener, listenerKeys, path);
  nonemptyKey(listener.listenerKey, `${path}.listenerKey`);
  addReference(inventory, 'listener_ability', `${path}.abilityRef`, listener.abilityRef,
    context.providerKey, context.abilityKey);
  scanOperations(inventory, listener.operations, `${path}.operations`, {
    ...context, skillHit: null
  });
}

function scanListenerArray(
  inventory: DamageSourceInventory,
  value: unknown,
  path: string,
  context: Omit<SourceContext, 'skillHit' | 'container'>,
  container: 'rules_listener' | 'provider_listener'
): void {
  const seen = new Map<string, number>();
  for (const [index, raw] of array(value, path).entries()) {
    const listener = record(raw, `${path}[${index}]`);
    const key = nonemptyKey(listener.listenerKey, `${path}[${index}].listenerKey`);
    unique(seen, key, index, `${path}[${index}].listenerKey`);
    scanListener(inventory, listener, keyed(path, key), { ...context, container });
  }
}

function scanProcesses(inventory: DamageSourceInventory, value: unknown, path: string, providerKey: string): void {
  const seen = new Map<string, number>();
  for (const [index, raw] of array(value, path).entries()) {
    const process = record(raw, `${path}[${index}]`);
    knownKeys(process, processKeys, `${path}[${index}]`);
    const key = nonemptyKey(process.processKey, `${path}[${index}].processKey`);
    unique(seen, key, index, `${path}[${index}].processKey`);
    const processPath = keyed(path, key);
    nonemptyKey(process.skillKey, `${processPath}.skillKey`);
    array(process.steps, `${processPath}.steps`, true);
    array(process.costs, `${processPath}.costs`, true);
    const momentsPath = `${processPath}.momentOperations`;
    const seenMoments = new Map<string, number>();
    for (const [momentIndex, rawGroup] of array(process.momentOperations, momentsPath, true).entries()) {
      const group = record(rawGroup, `${momentsPath}[${momentIndex}]`);
      knownKeys(group, momentGroupKeys, `${momentsPath}[${momentIndex}]`);
      const moment = record(group.moment, `${momentsPath}[${momentIndex}].moment`);
      knownKeys(moment, momentKeys, `${momentsPath}[${momentIndex}].moment`);
      const momentType = nonemptyKey(moment.momentType, `${momentsPath}[${momentIndex}].moment.momentType`);
      if (moment.stepKey !== null && typeof moment.stepKey !== 'string') {
        fail('invalid_structure', `${momentsPath}[${momentIndex}].moment.stepKey`, '步骤键必须是字符串或空');
      }
      if (moment.failureReason !== null && typeof moment.failureReason !== 'string') {
        fail('invalid_structure', `${momentsPath}[${momentIndex}].moment.failureReason`, '失败原因必须是字符串或空');
      }
      const momentKey = JSON.stringify([momentType, moment.stepKey, moment.failureReason]);
      unique(seenMoments, momentKey, momentIndex, `${momentsPath}[${momentIndex}].moment`);
      scanOperations(inventory, group.operations, `${keyed(momentsPath, momentKey)}.operations`, {
        providerKey, abilityKey: null, container: 'process_moment', skillHit: null
      }, true);
    }
  }
}

function scanProvider(inventory: DamageSourceInventory, raw: unknown, path: string, key: string): void {
  const provider = record(raw, path);
  knownKeys(provider, providerKeys, path);
  if (nonemptyKey(provider.providerKey, `${path}.providerKey`) !== key) {
    fail('invalid_structure', `${path}.providerKey`, '供值器键与定位键不一致');
  }
  scanListenerArray(inventory, provider.listeners, `${path}.listeners`,
    { providerKey: key, abilityKey: null }, 'provider_listener');
  const abilitiesPath = `${path}.abilities`;
  const seenAbilities = new Map<string, number>();
  for (const [index, rawAbility] of array(provider.abilities, abilitiesPath).entries()) {
    const ability = record(rawAbility, `${abilitiesPath}[${index}]`);
    knownKeys(ability, abilityKeys, `${abilitiesPath}[${index}]`);
    const abilityKey = nonemptyKey(ability.abilityKey, `${abilitiesPath}[${index}].abilityKey`);
    unique(seenAbilities, abilityKey, index, `${abilitiesPath}[${index}].abilityKey`);
    const abilityPath = keyed(abilitiesPath, abilityKey);
    scanOperations(inventory, ability.operations, `${abilityPath}.operations`, {
      providerKey: key, abilityKey, container: 'ability_operations', skillHit: null
    });
    if (ability.listenerSpec !== undefined) {
      const spec = record(ability.listenerSpec, `${abilityPath}.listenerSpec`);
      const listenerKey = nonemptyKey(spec.listenerKey, `${abilityPath}.listenerSpec.listenerKey`);
      scanListener(inventory, spec, keyed(`${abilityPath}.listenerSpec`, listenerKey), {
        providerKey: key, abilityKey, container: 'ability_listener'
      });
    }
    if (ability.tickSpec !== undefined) {
      const tickPath = `${abilityPath}.tickSpec`;
      const tick = record(ability.tickSpec, tickPath);
      knownKeys(tick, tickKeys, tickPath);
      scanOperations(inventory, tick.onTick, `${tickPath}.onTick`, {
        providerKey: key, abilityKey, container: 'ability_tick', skillHit: null
      }, true);
    }
    if (ability.processControl !== undefined) {
      const controlPath = `${abilityPath}.processControl`;
      const control = record(ability.processControl, controlPath);
      knownKeys(control, ['processKey', 'action', 'stepKey', 'failureReason'], controlPath);
      addReference(inventory, 'process_control', `${controlPath}.processKey`,
        control.processKey, key, abilityKey);
    }
  }
  scanProcesses(inventory, provider.processes, `${path}.processes`, key);
}

/**
 * 仅枚举编译请求中的可执行操作。返回的条目不表示普通伤害资格，
 * 也不据施放来源或挂载情况推断管理所属；引用解析继续由原生编译完成。
 */
export function inventoryDamageOperations(request: CompileRequest): DamageSourceInventory {
  const root = record(request, 'request');
  knownKeys(root, requestKeys, 'request');
  const inventory: DamageSourceInventory = {
    damageOperations: [], repeatOperations: [], executeThresholdOperations: [], references: []
  };
  const rules = record(root.rules, 'rules');
  knownKeys(rules, rulesKeys, 'rules');
  const triggerRules = array(rules.triggerRules, 'rules.triggerRules');
  if (triggerRules.length > 0) {
    fail('unsupported_structure', 'rules.triggerRules', '非空触发规则尚无可核对的执行结构');
  }
  scanOperations(inventory, rules.operations, 'rules.operations', {
    providerKey: null, abilityKey: null, container: 'rules_operations', skillHit: null
  });
  scanListenerArray(inventory, rules.listeners, 'rules.listeners',
    { providerKey: null, abilityKey: null }, 'rules_listener');

  const combatants = array(root.combatants, 'combatants', true);
  const seenCombatants = new Map<string, number>();
  for (const [index, raw] of combatants.entries()) {
    const actor = record(raw, `combatants[${index}]`);
    knownKeys(actor, combatantKeys, `combatants[${index}]`);
    const key = nonemptyKey(actor.key, `combatants[${index}].key`);
    unique(seenCombatants, key, index, `combatants[${index}].key`);
    const mountsPath = `${keyed('combatants', key)}.providers`;
    const seenMounts = new Map<string, number>();
    for (const [mountIndex, rawMount] of array(actor.providers, mountsPath, true).entries()) {
      const mount = record(rawMount, `${mountsPath}[${mountIndex}]`);
      knownKeys(mount, mountKeys, `${mountsPath}[${mountIndex}]`);
      const providerRef = nonemptyKey(mount.providerRef, `${mountsPath}[${mountIndex}].providerRef`);
      unique(seenMounts, providerRef, mountIndex, `${mountsPath}[${mountIndex}].providerRef`);
      addReference(inventory, 'mounted_provider_definition',
        `${keyed(mountsPath, providerRef)}.definitionRef`, mount.definitionRef, null, null);
    }
  }
  const providersPath = 'sharedProviders';
  const seenProviders = new Map<string, number>();
  for (const [index, raw] of array(root.sharedProviders, providersPath).entries()) {
    const provider = record(raw, `${providersPath}[${index}]`);
    const key = nonemptyKey(provider.providerKey, `${providersPath}[${index}].providerKey`);
    unique(seenProviders, key, index, `${providersPath}[${index}].providerKey`);
    scanProvider(inventory, provider, keyed(providersPath, key), key);
  }
  return inventory;
}
