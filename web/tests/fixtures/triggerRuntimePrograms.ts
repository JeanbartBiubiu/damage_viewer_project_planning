import type { AbilityDefinition, OperationDefinition, OncePerUseScope, ProviderDefinition } from '../../src/types/genericEngine';

// 直接声明本专项的通用执行输入；不读取或转换任何管理端作者模型。
export const TRIGGER_RUNTIME_TYPES = [
  ...['event/skill_hit', 'event/basic_attack_start', 'event/basic_attack_hit', 'event/ability_started', 'event/source_owner']
    .map(key => ({ key, domain: 'event' })),
  { key: 'ability/basic_attack', domain: 'ability' },
  { key: 'ability/p6_selected_cast', domain: 'ability' },
  { key: 'state_scope/provider', domain: 'state_scope' },
  { key: 'state_scope/provider_target', domain: 'state_scope' },
  { key: 'ability/skill_category/common', domain: 'ability' },
  { key: 'combatant/champion', domain: 'combatant' },
  ...['delivery_skill', 'delivery_basic_attack', 'origin_direct', 'origin_reflected']
    .map(key => ({ key: `damage_trait/${key}`, domain: 'damage_trait' }))
];

export function countWindowProvider(input: {
  providerKey: string; skillKey: string; eventTypes: string[]; scope: OncePerUseScope;
  initialValue: number; durationMs: number; cooldownMs: number; reward: OperationDefinition[]; abilityTypes: string[];
}): ProviderDefinition {
  const statePath = input.scope === 'provider_target' ? 'provider.target_state.hits' : 'provider.state.hits';
  const abilities = input.eventTypes.flatMap((eventType, index): AbilityDefinition[] => [
    {
      abilityKey: `first_${index}`, skillKey: input.skillKey, kind: 'passive_listener', types: [...input.abilityTypes],
      listenerSpec: {
        listenerKey: `first_${index}`, eventMatcher: { all: [eventType, 'event/source_owner'] },
        oncePerUse: { groupKey: 'proc', scope: input.scope },
        condition: { op: 'min', args: [
          { op: 'eq', args: [{ op: 'read', path: statePath }, { op: 'const', value: input.initialValue }] },
          { op: 'eq', args: [{ op: 'read', path: 'provider.state.icd' }, { op: 'const', value: 0 }] }
        ] },
        operations: [{ operation: 'state_change', target: 'source', ref: 'hits', valuePolicy: 'add',
          types: [`state_scope/${input.scope}`], amount: { op: 'const', value: 1 } }]
      }
    },
    {
      abilityKey: `reward_${index}`, skillKey: input.skillKey, kind: 'passive_listener', types: [...input.abilityTypes],
      listenerSpec: {
        listenerKey: `reward_${index}`, eventMatcher: { all: [eventType, 'event/source_owner'] },
        oncePerUse: { groupKey: 'proc', scope: input.scope },
        condition: { op: 'min', args: [
          { op: 'gte', args: [{ op: 'read', path: statePath }, { op: 'const', value: input.initialValue + 1 }] },
          { op: 'eq', args: [{ op: 'read', path: 'provider.state.icd' }, { op: 'const', value: 0 }] }
        ] },
        operations: [
          ...structuredClone(input.reward),
          { operation: 'state_change', target: 'source', ref: 'hits', valuePolicy: 'set',
            types: [`state_scope/${input.scope}`], amount: { op: 'const', value: input.initialValue } },
          { operation: 'state_change', target: 'source', ref: 'icd', valuePolicy: 'set',
            types: ['state_scope/provider'], amount: { op: 'const', value: 1 } }
        ]
      }
    }
  ]);
  return {
    providerKey: input.providerKey, stableId: input.providerKey, skillKey: input.skillKey, kind: 'item', abilities,
    initialStateSchema: {
      hits: { valueType: 'number', defaultValue: input.initialValue, maxValue: 99,
        durationMs: input.durationMs, refreshPolicy: 'start_on_first_write' },
      icd: { valueType: 'number', defaultValue: 0, maxValue: 1,
        durationMs: input.cooldownMs, refreshPolicy: 'start_on_first_write' }
    }
  };
}

export function waitingAttackProvider(input: {
  providerKey: string; skillKey: string; castType: string; groupKey: string;
  windowMs: number; cooldownMs: number; reward: OperationDefinition[]; abilityTypes: string[];
}): ProviderDefinition {
  return {
    providerKey: input.providerKey, stableId: input.providerKey, skillKey: input.skillKey, kind: 'item',
    initialStateSchema: {
      ready: { valueType: 'number', defaultValue: 0, maxValue: 1,
        durationMs: input.windowMs, refreshPolicy: 'refresh_on_write' },
      icd: { valueType: 'number', defaultValue: 0, maxValue: 1,
        durationMs: input.cooldownMs, refreshPolicy: 'start_on_first_write' }
    },
    abilities: [
      {
        abilityKey: 'arm', skillKey: input.skillKey, kind: 'passive_listener', types: [...input.abilityTypes],
        listenerSpec: {
          listenerKey: 'arm', eventMatcher: { all: ['event/ability_started', input.castType, 'event/source_owner'] },
          condition: { op: 'eq', args: [{ op: 'read', path: 'provider.state.icd' }, { op: 'const', value: 0 }] },
          operations: [{ operation: 'state_change', target: 'source', ref: 'ready', valuePolicy: 'set',
            types: ['state_scope/provider'], amount: { op: 'const', value: 1 } }]
        }
      },
      {
        abilityKey: 'consume', skillKey: input.skillKey, kind: 'passive_listener', types: [...input.abilityTypes],
        listenerSpec: {
          listenerKey: 'consume', eventMatcher: { all: ['event/basic_attack_hit', 'event/source_owner'] },
          oncePerUse: { groupKey: input.groupKey, scope: 'provider' },
          condition: { op: 'min', args: [
            { op: 'eq', args: [{ op: 'read', path: 'provider.state.ready' }, { op: 'const', value: 1 }] },
            { op: 'eq', args: [{ op: 'read', path: 'provider.state.icd' }, { op: 'const', value: 0 }] }
          ] },
          operations: [
            ...structuredClone(input.reward),
            { operation: 'state_change', target: 'source', ref: 'ready', valuePolicy: 'set',
              types: ['state_scope/provider'], amount: { op: 'const', value: 0 } },
            { operation: 'state_change', target: 'source', ref: 'icd', valuePolicy: 'set',
              types: ['state_scope/provider'], amount: { op: 'const', value: 1 } }
          ]
        }
      }
    ]
  };
}
