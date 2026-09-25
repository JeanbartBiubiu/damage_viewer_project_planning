import { describe, expect, it } from 'vitest';
import type {
  AbilityDefinition, CompileRequest, OperationDefinition, ProcessDefinition, ProviderDefinition,
  SkillHitCandidate
} from '../types/genericEngine';
import { basicAttackHitAbility } from './triggerAdapter';
import {
  DamageSourceInventoryError, inventoryDamageOperations, type DamageSourceInventoryErrorCode
} from './damageSourceInventory';

const amount = { op: 'const', value: 10 };

function damage(ref: string, extra: Partial<OperationDefinition> = {}): OperationDefinition {
  return {
    operation: 'damage', target: 'target', damageType: 'damage/physical', amount, ref, ...extra
  };
}

function provider(providerKey: string, abilities: AbilityDefinition[] = []): ProviderDefinition {
  return { providerKey, stableId: providerKey, kind: 'champion', abilities };
}

function request(): CompileRequest {
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema', rulesHash: 'rules',
    typeCatalog: { types: [], relations: [] },
    combatants: [{
      key: 'source', attributes: {}, resources: {},
      providers: [{ providerRef: 'mounted', definitionRef: 'mounted' }]
    }, {
      key: 'target', attributes: {}, resources: {}, providers: []
    }],
    sharedProviders: [provider('mounted')],
    rules: {}
  };
}

function hitCandidate(candidateKey: string): SkillHitCandidate {
  return {
    candidateKey, effectOccurrenceKey: 'effect#1', effectKey: 'effect-a', resultKey: 'result-a',
    semantic: { resultType: 'DAMAGE', target: 'TARGET', moment: 'INSTANT' },
    spellShieldBlockScope: null,
    operations: [damage('hit', { copyableOnHit: true })]
  };
}

function expectInventoryError(run: () => unknown, code: DamageSourceInventoryErrorCode, path: string): void {
  try {
    run();
    throw new Error('扫描本应拒绝输入');
  } catch (error) {
    expect(error).toBeInstanceOf(DamageSourceInventoryError);
    expect(error).toMatchObject({ code, path });
  }
}

describe('伤害来源结构清单', () => {
  it('覆盖规则、监听、能力、周期、过程和命中候选中的所有直接伤害，包含未挂载定义', () => {
    const input = request();
    const candidateKey = 'candidate-one';
    const hitAbility = basicAttackHitAbility({ abilityKey: 'hit_ability', skillKey: 'skill_a' });
    hitAbility.operations![0]!.skillHit!.candidates.push(hitCandidate(candidateKey));
    const unused = provider('unused', [
      {
        abilityKey: 'direct', kind: 'active',
        operations: [
          damage('direct'),
          { operation: 'repeat', target: 'target', repeatCount: 2, repeatDelayMs: 0 },
          { operation: 'repeat', target: 'target', repeatCount: 3, repeatDelayMs: 75 },
          { operation: 'execute_threshold', target: 'target', threshold: 0.2 },
          { operation: 'apply_provider', target: 'source', providerDefinitionRef: 'buff' },
          { operation: 'cooldown_change', target: 'source', abilityRef: 'self.provider[unused].ability[direct]' }
        ],
        listenerSpec: {
          listenerKey: 'ability-listen', eventMatcher: { all: ['event/damage_instance'] },
          abilityRef: 'self.provider[unused].ability[child]',
          operations: [damage('ability-listener')]
        },
        tickSpec: { intervalMs: 100, onTick: [damage('tick')] },
        processControl: { processKey: 'process-one', action: 'INITIAL' }
      },
      hitAbility
    ]);
    unused.listeners = [{
      listenerKey: 'provider-listen', eventMatcher: { all: ['event/basic_attack_hit'] },
      operations: [damage('provider-listener')]
    }];
    unused.processes = [{
      processKey: 'process-one', skillKey: 'skill_a', steps: [], costs: [], cooldown: null,
      momentOperations: [{
        moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
        operations: [damage('process')]
      }]
    }];
    input.sharedProviders!.push(unused);
    input.rules.operations = [damage('rules')];
    input.rules.listeners = [{
      listenerKey: 'rule-listen', eventMatcher: { all: ['event/basic_attack_hit'] },
      abilityRef: 'self.provider[mounted].ability[child]',
      operations: [damage('rule-listener')]
    }];
    const before = structuredClone(input);

    const found = inventoryDamageOperations(input);
    expect(found.damageOperations).toHaveLength(8);
    expect(found.damageOperations.map(({ container }) => container)).toEqual([
      'rules_operations', 'rules_listener', 'provider_listener', 'ability_operations',
      'ability_listener', 'ability_tick', 'skill_hit_candidate', 'process_moment'
    ]);
    const hidden = found.damageOperations.find((entry) => entry.container === 'skill_hit_candidate');
    expect(hidden).toMatchObject({
      providerKey: 'unused', abilityKey: 'hit_ability',
      skillHit: {
        skillKey: 'skill_a', candidateKey, effectOccurrenceKey: 'effect#1',
        effectKey: 'effect-a', resultKey: 'result-a'
      },
      operation: { ref: 'hit', copyableOnHit: true }
    });
    expect(hidden?.path).toBe(
      'sharedProviders["unused"].abilities["hit_ability"].operations[0]'
      + `.skillHit.candidates[${JSON.stringify(candidateKey)}].operations[0]`
    );
    expect(found.damageOperations.find((entry) => entry.container === 'process_moment')?.path)
      .toContain('.processes["process-one"].momentOperations[');
    expect(found.damageOperations.filter((entry) => entry.providerKey === 'unused')).toHaveLength(6);
    expect(found.repeatOperations.map(({ operation }) => operation.repeatDelayMs)).toEqual([0, 75]);
    expect(found.repeatOperations.map(({ operation }) => operation.repeatCount)).toEqual([2, 3]);
    expect(found.executeThresholdOperations).toHaveLength(1);
    expect(found.executeThresholdOperations[0]?.operation.operation).toBe('execute_threshold');
    expect(found.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'mounted_provider_definition', value: 'mounted' }),
      expect.objectContaining({ kind: 'listener_ability', value: 'self.provider[mounted].ability[child]' }),
      expect.objectContaining({ kind: 'listener_ability', value: 'self.provider[unused].ability[child]' }),
      expect.objectContaining({ kind: 'apply_provider_definition', value: 'buff' }),
      expect.objectContaining({ kind: 'operation_ability', value: 'self.provider[unused].ability[direct]' }),
      expect.objectContaining({ kind: 'process_control', value: 'process-one' })
    ]));
    expect(input).toEqual(before);
    hidden!.operation.amount!.value = 999;
    expect(hitCandidate(candidateKey).operations[0]?.amount?.value).toBe(10);
    expect(unused.abilities![1]?.operations?.[0]?.skillHit?.candidates[0]?.operations[0]?.amount?.value).toBe(10);
  });

  it('载荷和静态状态中的伪 operation 不会被当作执行入口', () => {
    const input = request();
    input.rules.operations = [{
      operation: 'emit_event', target: 'target', eventType: 'event/probe',
      payload: {
        operation: 'damage', operations: [damage('not-executable')],
        vars: { operation: 'damage', damageType: 'damage/true' }
      }
    }];
    input.sharedProviders![0]!.initialStateSchema = {
      data: { valueType: 'number', defaultValue: 0, operation: 'damage' }
    } as unknown as NonNullable<ProviderDefinition['initialStateSchema']>;
    expect(inventoryDamageOperations(input).damageOperations).toEqual([]);
  });

  it('路径按对象键转义，不使用易随排序变化的容器下标', () => {
    const input = request();
    const key = 'quoted"\\key';
    input.sharedProviders!.push(provider(key, [{
      abilityKey: 'direct', kind: 'active', operations: [damage('escaped')]
    }]));
    expect(inventoryDamageOperations(input).damageOperations[0]?.path)
      .toBe(`sharedProviders[${JSON.stringify(key)}].abilities["direct"].operations[0]`);
  });

  it.each([
    ['重复供值器', (r: CompileRequest) => r.sharedProviders!.push(provider('mounted')), 'sharedProviders[1].providerKey'],
    ['重复能力', (r: CompileRequest) => r.sharedProviders![0]!.abilities = [
      { abilityKey: 'same', kind: 'active' }, { abilityKey: 'same', kind: 'active' }
    ], 'sharedProviders["mounted"].abilities[1].abilityKey'],
    ['重复规则监听', (r: CompileRequest) => r.rules.listeners = [
      { listenerKey: 'same', eventMatcher: {} }, { listenerKey: 'same', eventMatcher: {} }
    ], 'rules.listeners[1].listenerKey'],
    ['重复过程', (r: CompileRequest) => r.sharedProviders![0]!.processes = [
      { processKey: 'same', skillKey: 'skill', steps: [], costs: [], cooldown: null, momentOperations: [] },
      { processKey: 'same', skillKey: 'skill', steps: [], costs: [], cooldown: null, momentOperations: [] }
    ], 'sharedProviders["mounted"].processes[1].processKey'],
    ['重复命中候选', (r: CompileRequest) => r.sharedProviders![0]!.abilities = [{
      abilityKey: 'hit', kind: 'active', operations: [{
        operation: 'resolve_skill_hit', target: 'target',
        skillHit: { skillKey: 'skill', candidates: [hitCandidate('same'), hitCandidate('same')] }
      }]
    }], 'sharedProviders["mounted"].abilities["hit"].operations[0].skillHit.candidates[1].candidateKey'],
    ['重复过程时点', (r: CompileRequest) => r.sharedProviders![0]!.processes = [{
      processKey: 'same', skillKey: 'skill', steps: [], costs: [], cooldown: null,
      momentOperations: [0, 1].map(() => ({
        moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
        operations: [damage('process')]
      }))
    }], 'sharedProviders["mounted"].processes["same"].momentOperations[1].moment'],
    ['重复挂载键', (r: CompileRequest) => r.combatants[0]!.providers.push({
      providerRef: 'mounted', definitionRef: 'mounted'
    }), 'combatants["source"].providers[1].providerRef']
  ] as const)('%s会在第二处稳定定位并拒绝', (_name, change, path) => {
    const input = request();
    change(input);
    expectInventoryError(() => inventoryDamageOperations(input), 'duplicate_key', path);
  });

  it.each([
    ['未知操作', (r: CompileRequest) => r.rules.operations = [
      { operation: 'future_damage', target: 'target' }
    ], 'rules.operations[0].operation', 'unknown_operation'],
    ['非空触发规则', (r: CompileRequest) => r.rules.triggerRules = [{}],
      'rules.triggerRules', 'unsupported_structure'],
    ['未知执行容器', (r: CompileRequest) => {
      (r.sharedProviders![0] as unknown as Record<string, unknown>).futureOperations = [damage('hidden')];
    }, 'sharedProviders["mounted"].futureOperations', 'unsupported_structure'],
    ['缺命中候选操作', (r: CompileRequest) => r.sharedProviders![0]!.abilities = [{
      abilityKey: 'hit', kind: 'active', operations: [{
        operation: 'resolve_skill_hit', target: 'target',
        skillHit: { skillKey: 'skill', candidates: [{
          ...hitCandidate('candidate'), operations: undefined as unknown as OperationDefinition[]
        }] }
      }]
    }], 'sharedProviders["mounted"].abilities["hit"].operations[0].skillHit.candidates["candidate"].operations',
    'invalid_structure'],
    ['缺命中候选数组', (r: CompileRequest) => r.sharedProviders![0]!.abilities = [{
      abilityKey: 'hit', kind: 'active', operations: [{
        operation: 'resolve_skill_hit', target: 'target', skillHit: {
          skillKey: 'skill', candidates: undefined as unknown as SkillHitCandidate[]
        }
      }]
    }], 'sharedProviders["mounted"].abilities["hit"].operations[0].skillHit.candidates', 'invalid_structure'],
    ['缺周期操作数组', (r: CompileRequest) => r.sharedProviders![0]!.abilities = [{
      abilityKey: 'tick', kind: 'tick', tickSpec: {
        intervalMs: 100, onTick: undefined as unknown as OperationDefinition[]
      }
    }], 'sharedProviders["mounted"].abilities["tick"].tickSpec.onTick', 'invalid_structure'],
    ['缺过程时点数组', (r: CompileRequest) => r.sharedProviders![0]!.processes = [{
      processKey: 'process', skillKey: 'skill', steps: [], costs: [], cooldown: null,
      momentOperations: undefined as unknown as ProcessDefinition['momentOperations']
    }], 'sharedProviders["mounted"].processes["process"].momentOperations', 'invalid_structure'],
    ['非命中操作藏候选', (r: CompileRequest) => r.rules.operations = [
      { ...damage('fake'), skillHit: { skillKey: 'skill', candidates: [hitCandidate('candidate')] } }
    ], 'rules.operations[0].skillHit', 'unsupported_structure']
  ] as const)('%s明确失败', (_name, change, path, code) => {
    const input = request();
    change(input);
    expectInventoryError(() => inventoryDamageOperations(input), code, path);
  });

  it('命中解析不能混放其他能力操作，也不能藏在规则操作中', () => {
    const resolve: OperationDefinition = {
      operation: 'resolve_skill_hit', target: 'target',
      skillHit: { skillKey: 'skill', candidates: [hitCandidate('candidate')] }
    };
    const input = request();
    input.sharedProviders![0]!.abilities = [{
      abilityKey: 'hit', kind: 'active', operations: [resolve, damage('extra')]
    }];
    expectInventoryError(() => inventoryDamageOperations(input), 'unsupported_structure',
      'sharedProviders["mounted"].abilities["hit"].operations[0].operation');
    input.sharedProviders![0]!.abilities = [];
    input.rules.operations = [resolve];
    expectInventoryError(() => inventoryDamageOperations(input), 'unsupported_structure',
      'rules.operations[0].operation');
  });
});
