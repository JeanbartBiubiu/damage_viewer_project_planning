import { describe, expect, it } from 'vitest';
import type { CompileRequest, RunRequest } from '../types/genericEngine';
import type { Skill } from '../types/skill';
import type { CharacterSkillRelation } from '../types/skillRelation';
import type { SkillEffect, SkillEffectDamageResult, SkillEffectDamageModifierResult } from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { GameVampRule } from '../types/gameVamp';
import { fixedValue, formulaValue } from '../types/numericValue';
import { withHitProgram, type AuthoredHitProgram, type HitProgramBinding } from './hitAdapter';
import { DamageSourceInventoryError } from './damageSourceInventory';
import {
  withAuthoredOrdinaryDamageModifiers, type AuthoredDamageModifierProgram
} from './damageModifierAdapter';
import {
  auditAuthoredOrdinaryDamageSources, OrdinaryDamageSourceAuditError,
  type OrdinaryDamageSourceAuditInput, type OrdinaryDamageSourceReview
} from './ordinaryDamageSourceAudit';

const vampRules: GameVampRule[] = [{
  vampType: 'LIFE_STEAL', sourceAttributeKey: 'life_steal_percent',
  basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1,
  deliveryKinds: ['BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack']
}, {
  vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent',
  basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1,
  deliveryKinds: ['SKILL', 'BASIC_ATTACK'], originKinds: ['DIRECT'],
  skillCategoryKeys: ['basic_attack', 'common', 'passive', 'ultimate']
}];

const damageResult: SkillEffectDamageResult = {
  resultKey: 'damage', name: '碎裂之火命中', resultType: 'DAMAGE', target: 'TARGET',
  description: null, sortOrder: 10, spellShieldBlockScope: 'RESULT', lifecycleBehavior: null,
  valueRule: {
    value: formulaValue('damage'), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null
  },
  detail: {
    damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT',
    critical: { mode: 'DISALLOWED', multiplierValue: null },
    vampQualification: 'RESOLVED', vampOverrides: []
  }
};

const effect: SkillEffect = {
  gameId: 'lol', skillKey: 'annie_q', effectKey: 'spell_hit', name: '命中',
  description: null, sortOrder: 10, lifecycle: null, results: [damageResult],
  createdAt: '', updatedAt: ''
};

const rule: SkillTriggerRuleDetail = {
  ruleKey: 'actual_hit', name: '命中', description: null, sortOrder: 10,
  eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
  conditionGroups: [],
  actions: [{
    actionKey: 'damage', name: '伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
    targetContext: 'CURRENT_TARGET', detail: { effectKey: 'spell_hit' },
    runtimeInputBindings: [], resultModifiers: []
  }],
  perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
};

function parameter(parameterKey: string, value: number, mode: 'FIXED' | 'SKILL_LEVEL'): SkillParameter {
  return {
    gameId: 'lol', skillKey: 'annie_q', parameterKey, name: parameterKey,
    valueType: 'DECIMAL', valueMode: mode,
    fixedValue: mode === 'FIXED' ? value : null,
    levelValues: mode === 'SKILL_LEVEL' ? { '1': value } : null,
    description: null, sortOrder: 10, createdAt: '', updatedAt: ''
  };
}

const formula: SkillFormula = {
  gameId: 'lol', skillKey: 'annie_q', formulaKey: 'damage', name: '命中伤害',
  description: null, sortOrder: 10, createdAt: '', updatedAt: '',
  expression: {
    nodeType: 'OPERATION', operation: 'ADD', operands: [
      { nodeType: 'PARAMETER', parameterKey: 'base_damage' },
      { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'ap_ratio' },
        { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE',
          attributeKey: 'ability_power', attributeValueKind: 'TOTAL' }
      ] }
    ]
  }
};

function authored(): AuthoredHitProgram {
  return {
    gameId: 'lol', skillKey: 'annie_q', skillLevel: 1, characterLevel: 1,
    rules: [structuredClone(rule)], effects: [structuredClone(effect)],
    parameters: [parameter('base_damage', 80, 'SKILL_LEVEL'), parameter('ap_ratio', 0.8, 'FIXED')],
    formulas: [structuredClone(formula)], statuses: [], modifierZones: [],
    identity: {
      source: { category: 'CHAMPION', hostility: 'SELF' },
      target: { category: 'CHAMPION', hostility: 'ENEMY' }
    },
    skillCategoryKeys: ['common'], vampRules: structuredClone(vampRules)
  };
}

function slot(value: number) {
  return { base: value, current: value, max: value, resolved: value };
}

function fixture(): {
  request: CompileRequest; run: RunRequest; input: OrdinaryDamageSourceAuditInput
} {
  const binding: HitProgramBinding = {
    hitProviderKey: 'annie_definition', hitAbilityKey: 'hit', authored: authored()
  };
  const skill: Skill = {
    gameId: 'lol', skillKey: 'annie_q', name: '碎裂之火', description: null,
    maxLevel: 5, status: 'ENABLED', sortOrder: 10, skillCategoryKeys: ['common'],
    createdAt: '', updatedAt: ''
  };
  const relation: CharacterSkillRelation = {
    gameId: 'lol', characterKey: 'champion_annie', characterName: '安妮',
    skillKey: 'annie_q', skillName: '碎裂之火', skillStatus: 'ENABLED', sortOrder: 10
  };
  const review: OrdinaryDamageSourceReview = {
    reviewKey: 'annie_q_spell_hit_damage', gameId: 'lol', characterKey: 'champion_annie',
    skillKey: 'annie_q', ruleKey: 'actual_hit', actionKey: 'damage',
    effectKey: 'spell_hit', resultKey: 'damage', damageTypeKey: 'magic',
    deliveryKind: 'SKILL', originKind: 'DIRECT', classification: 'ORDINARY_DIRECT',
    rationale: '已核定安妮 Q 直接魔法伤害', evidenceRefs: ['正式来源'],
    reviewedResult: structuredClone(damageResult)
  };
  const attributes = {
    hp: slot(1000), ability_power: slot(200),
    life_steal_percent: slot(0), omnivamp_percent: slot(0.1)
  };
  const base: CompileRequest = {
    schemaVersion: 'generic-p0', schemaHash: 'schema', rulesHash: 'before',
    typeCatalog: { types: [{ key: 'combatant/champion', domain: 'combatant' }], relations: [] },
    combatants: [{
      key: 'source', types: ['combatant/champion'], attributes: structuredClone(attributes),
      resources: {}, providers: [{ providerRef: 'annie_mount', definitionRef: 'annie_definition' }]
    }, {
      key: 'target', types: ['combatant/champion'], attributes: structuredClone(attributes),
      resources: {}, providers: []
    }],
    sharedProviders: [{
      providerKey: 'annie_definition', kind: 'champion', stableId: 'annie_definition',
      abilities: [{ abilityKey: 'hit', kind: 'active', operations: [] }]
    }],
    rules: {}, formulas: []
  };
  const request = withHitProgram(base, binding, { rulesHash: 'after-hit' });
  const run: RunRequest = {
    sessionId: 'session', expectedRulesHash: request.rulesHash,
    schemaVersion: request.schemaVersion, schemaHash: request.schemaHash, rulesHash: request.rulesHash,
    initialSnapshot: {
      schemaHash: request.schemaHash, rulesHash: request.rulesHash, timeMs: 0,
      combatants: [{
        key: 'source', attributes: structuredClone(attributes), resources: {}, cooldowns: {},
        providers: [{ providerRef: 'annie_mount', definitionRef: 'annie_definition',
          source: 'source', owner: 'source', stacks: 1, expireAt: null, state: {} }],
        shields: [], abilityState: {}, providerState: {}, vars: {}
      }, {
        key: 'target', attributes: structuredClone(attributes), resources: {}, cooldowns: {},
        providers: [], shields: [], abilityState: {}, providerState: {}, vars: {}
      }]
    },
    driverPlan: {
      entries: [{
        entryKey: 'hit', abilityRef: 'source.provider[annie_mount].ability[hit]',
        source: 'source', target: 'target', firstAtMs: 0
      }], conditionRecheckIntervalMs: 100
    },
    stopPolicy: { durationMs: 100, stopOnTargetDeath: false, stopWhenNoEvents: false },
    sampling: { sampleEveryMs: 100, dpsWindowMs: 100, maxSeriesPoints: 10 }
  };
  const input: OrdinaryDamageSourceAuditInput = {
    gameId: 'lol',
    combatants: {
      source: { characterKey: 'champion_annie' },
      target: { characterKey: 'champion_garen' }
    },
    catalog: { catalogKey: 'approved-ordinary', gameId: 'lol', scope: 'selected-hit',
      reviews: [review] },
    sources: [{
      reviewKey: review.reviewKey, owner: 'source', providerRef: 'annie_mount',
      hitBinding: binding, skill, relation
    }]
  };
  return { request, run, input };
}

function expectAuditError(run: () => unknown, path: string, code?: string): void {
  try {
    run();
    throw new Error('应拒绝');
  } catch (error) {
    expect(error instanceof OrdinaryDamageSourceAuditError || error instanceof DamageSourceInventoryError).toBe(true);
    expect(error).toMatchObject({ path, ...(code ? { code } : {}) });
  }
}

function modifier(): AuthoredDamageModifierProgram {
  const result: SkillEffectDamageModifierResult = {
    resultKey: 'amplify', name: '增伤', resultType: 'DAMAGE_MODIFIER',
    target: 'SOURCE', description: null, sortOrder: 10, spellShieldBlockScope: null,
    valueRule: { value: fixedValue(0.08), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    lifecycleBehavior: {
      moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
      reapplicationValueMode: 'KEEP', periodicExecutionMode: null
    },
    detail: {
      modifierZoneKey: 'rune_amp', direction: 'DEALT', operation: 'INCREASE',
      damageTypeKey: null, deliveryKind: 'ANY', originKind: 'DIRECT',
      criticalFilter: 'ANY', condition: null
    }
  };
  return {
    gameId: 'lol', skillKey: 'rune_passive', skillLevel: 1, characterLevel: 1,
    owner: 'source',
    identity: {
      owner: { category: 'CHAMPION', hostility: 'SELF' },
      opponent: { category: 'CHAMPION', hostility: 'ENEMY' }
    },
    effects: [{
      gameId: 'lol', skillKey: 'rune_passive', effectKey: 'passive', name: '增伤',
      description: null, sortOrder: 10, createdAt: '', updatedAt: '',
      results: [result],
      lifecycle: {
        instanceScope: 'SOURCE', durationValue: null, maxStacksValue: fixedValue(1),
        applicationStacksValue: fixedValue(1), reapplicationStackMode: 'KEEP',
        reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY',
        periodicIntervalValue: null, firstPeriodicExecution: null
      }
    }],
    rules: [{
      ruleKey: 'initialize', name: '初始化', description: null, sortOrder: 10,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
      conditionGroups: [], perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null,
      actions: [{
        actionKey: 'apply', name: '施加', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
        targetContext: 'CURRENT_TARGET', detail: { effectKey: 'passive' },
        runtimeInputBindings: [], resultModifiers: []
      }]
    }],
    parameters: [], formulas: [],
    modifierZones: [{
      gameId: 'lol', modifierZoneKey: 'rune_amp', name: '增伤区域',
      domain: 'DAMAGE', calculationMode: 'RATIO_ADD', applicationStage: 'DAMAGE_PRE_DEFENSE',
      status: 'ENABLED', sortOrder: 10, description: null, createdAt: '', updatedAt: ''
    }]
  };
}

describe('已核普通直接伤害来源', () => {
  it('用现有命中适配形状逐项认领伤害，保留作者与运行输入', () => {
    const { request, run, input } = fixture();
    const before = structuredClone({ request, run, input });
    const audit = auditAuthoredOrdinaryDamageSources(request, run, input);
    expect(audit.facts).toHaveLength(1);
    expect(audit.facts[0]).toMatchObject({
      reviewKey: 'annie_q_spell_hit_damage', owner: 'source',
      characterKey: 'champion_annie', providerRef: 'annie_mount',
      skillKey: 'annie_q', ruleKey: 'actual_hit', actionKey: 'damage',
      effectKey: 'spell_hit', resultKey: 'damage', damageTypeKey: 'magic',
      operation: { operation: 'damage', damageType: 'damage/magic' },
      driverEntryKeys: ['hit']
    });
    expect(audit.facts[0]?.operationPath).toContain('.skillHit.candidates["actual_hit:damage:damage"].operations[0]');
    expect(JSON.parse(JSON.stringify(audit))).toEqual(audit);
    expect({ request, run, input }).toEqual(before);
  });

  it('同一实际挂载可承载两项各自核定的并列伤害结果', () => {
    const f = fixture();
    const second = structuredClone(damageResult);
    second.resultKey = 'second_damage';
    second.name = '第二笔已核伤害';
    second.sortOrder = 20;
    const binding = structuredClone(f.input.sources[0]!.hitBinding);
    binding.authored.effects[0]!.results.push(second);
    f.request = withHitProgram(f.request, binding, { rulesHash: 'after-two-results' });
    f.run.rulesHash = f.request.rulesHash;
    f.run.expectedRulesHash = f.request.rulesHash;
    f.run.initialSnapshot.rulesHash = f.request.rulesHash;
    f.input.sources[0]!.hitBinding = binding;
    const review = structuredClone(f.input.catalog.reviews[0]!);
    review.reviewKey = 'annie_q_second_damage';
    review.resultKey = 'second_damage';
    review.reviewedResult = structuredClone(second);
    f.input.catalog.reviews.push(review);
    f.input.sources.push({ ...f.input.sources[0]!, reviewKey: review.reviewKey });
    const audit = auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input);
    expect(audit.facts.map((row) => row.resultKey)).toEqual(['damage', 'second_damage']);
    expect(audit.facts.map((row) => row.providerRef)).toEqual(['annie_mount', 'annie_mount']);
  });

  it('source、self 两种合法驱动引用可用；target 别名与驱动双方错位拒绝', () => {
    const f = fixture();
    f.run.driverPlan.entries[0]!.abilityRef = 'self.provider[annie_mount].ability[hit]';
    expect(auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input).facts).toHaveLength(1);
    f.run.driverPlan.entries[0]!.abilityRef = 'target.provider[annie_mount].ability[hit]';
    expectAuditError(() => auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input),
      'driverPlan.entries[0].source', 'ownership_mismatch');
    f.run.driverPlan.entries[0]!.abilityRef = 'source.provider[annie_mount].ability[hit]';
    f.run.driverPlan.entries[0]!.target = 'source';
    expectAuditError(() => auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input),
      'driverPlan.entries[0].target', 'ownership_mismatch');
  });

  it('目标侧真实拥有者可使用 target.provider 驱动引用', () => {
    const f = fixture();
    f.request.combatants[0]!.providers = [];
    f.request.combatants[1]!.providers = [{ providerRef: 'annie_mount', definitionRef: 'annie_definition' }];
    f.run.initialSnapshot.combatants[0]!.providers = [];
    f.run.initialSnapshot.combatants[1]!.providers = [{
      providerRef: 'annie_mount', definitionRef: 'annie_definition', source: 'target', owner: 'target',
      stacks: 1, expireAt: null, state: {}
    }];
    f.input.sources[0]!.owner = 'target';
    f.input.combatants.source.characterKey = 'champion_garen';
    f.input.combatants.target.characterKey = 'champion_annie';
    f.run.driverPlan.entries[0] = {
      entryKey: 'target_hit', abilityRef: 'target.provider[annie_mount].ability[hit]',
      source: 'target', target: 'source', firstAtMs: 0
    };
    expect(auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input).facts[0])
      .toMatchObject({ owner: 'target', driverEntryKeys: ['target_hit'] });
  });

  it('正式角色技能的施放来源缺省或明确 champion 均可核对', () => {
    const f = fixture();
    expect(auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input).facts).toHaveLength(1);
    f.request.sharedProviders![0]!.abilities![0]!.castOrigin = 'champion';
    expect(auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input).facts).toHaveLength(1);
  });

  it.each([
    ['额外隐藏伤害', (f: ReturnType<typeof fixture>) => { f.request.rules.operations = [{
      operation: 'damage', target: 'target', damageType: 'damage/true',
      amount: { op: 'const', value: 10 }
    }]; }, 'rules.operations[0]', 'unreviewed_damage'],
    ['未知操作', (f: ReturnType<typeof fixture>) => { f.request.rules.operations = [{
      operation: 'new_damage', target: 'target'
    }]; }, 'rules.operations[0].operation', 'unknown_operation'],
    ['重复绑定', (f: ReturnType<typeof fixture>) => { f.input.sources.push(structuredClone(f.input.sources[0]!)); },
      'sources.sources[1]', 'invalid_input'],
    ['错误目录标识', (f: ReturnType<typeof fixture>) => { f.input.sources[0]!.reviewKey = 'unreviewed'; },
      'sources.sources[0].reviewKey', 'catalog_mismatch'],
    ['错误人物', (f: ReturnType<typeof fixture>) => { f.input.combatants.source.characterKey = 'other'; },
      'sources.combatants.source.characterKey', 'ownership_mismatch'],
    ['错误快照来源', (f: ReturnType<typeof fixture>) => {
      f.run.initialSnapshot.combatants[0]!.providers[0]!.source = 'target';
    }, 'initialSnapshot.combatants["source"].providers["annie_mount"]', 'ownership_mismatch'],
    ['其他对象复用产伤定义', (f: ReturnType<typeof fixture>) => {
      f.request.combatants[1]!.providers.push({ providerRef: 'copy', definitionRef: 'annie_definition' });
      f.run.initialSnapshot.combatants[1]!.providers.push({
        providerRef: 'copy', definitionRef: 'annie_definition', owner: 'target', source: 'target',
        stacks: 1, expireAt: null, state: {}
      });
    }, 'combatants["target"].providers[0]', 'ownership_mismatch'],
    ['命中候选被改', (f: ReturnType<typeof fixture>) => {
      f.request.sharedProviders![0]!.abilities![0]!.operations![0]!.skillHit!.candidates[0]!.operations[0]!.amount = {
        op: 'const', value: 999
      };
    }, 'sharedProviders["annie_definition"].abilities["hit"].operations', 'compiled_mismatch'],
    ['复制标记未经作者重编而被改', (f: ReturnType<typeof fixture>) => {
      f.request.sharedProviders![0]!.abilities![0]!.operations![0]!.skillHit!.candidates[0]!.operations[0]!.copyableOnHit = true;
    }, 'sharedProviders["annie_definition"].abilities["hit"].operations', 'compiled_mismatch'],
    ['参数被改', (f: ReturnType<typeof fixture>) => {
      f.request.sharedProviders![0]!.abilities![0]!.params!.base_damage = 81;
    }, 'sharedProviders["annie_definition"].abilities["hit"].params.base_damage', 'compiled_mismatch'],
    ['额外普攻能力分类', (f: ReturnType<typeof fixture>) => {
      f.request.sharedProviders![0]!.abilities![0]!.types!.push('ability/basic_attack');
      f.request.typeCatalog.types.push({ key: 'event/basic_attack_hit', domain: 'event' });
    }, 'sharedProviders["annie_definition"].abilities["hit"].types', 'compiled_mismatch'],
    ['额外终极能力分类', (f: ReturnType<typeof fixture>) => {
      f.request.sharedProviders![0]!.abilities![0]!.types!.push('ability/ultimate');
    }, 'sharedProviders["annie_definition"].abilities["hit"].types', 'compiled_mismatch'],
    ['宠物施放来源', (f: ReturnType<typeof fixture>) => {
      f.request.sharedProviders![0]!.abilities![0]!.castOrigin = 'pet';
    }, 'sharedProviders["annie_definition"].abilities["hit"].castOrigin', 'compiled_mismatch'],
    ['装备施放来源', (f: ReturnType<typeof fixture>) => {
      f.request.sharedProviders![0]!.abilities![0]!.castOrigin = 'item';
    }, 'sharedProviders["annie_definition"].abilities["hit"].castOrigin', 'compiled_mismatch'],
    ['固有施放来源', (f: ReturnType<typeof fixture>) => {
      f.request.sharedProviders![0]!.abilities![0]!.castOrigin = 'innate';
    }, 'sharedProviders["annie_definition"].abilities["hit"].castOrigin', 'compiled_mismatch'],
    ['公式被改', (f: ReturnType<typeof fixture>) => {
      f.request.formulas![0]!.expression = { op: 'const', value: 0 };
    }, 'formulas["hit/annie_q/damage"]', 'compiled_mismatch'],
    ['吸血规则被改', (f: ReturnType<typeof fixture>) => {
      f.request.rules.vampRules![0]!.defaultEfficiency = 0.5;
    }, 'rules.vampRules', 'compiled_mismatch'],
    ['动态应用产伤定义', (f: ReturnType<typeof fixture>) => { f.request.rules.operations = [{
      operation: 'apply_provider', target: 'source', providerDefinitionRef: 'annie_definition'
    }]; }, 'rules.operations[0].providerDefinitionRef', 'unverified_reference'],
    ['独立处决', (f: ReturnType<typeof fixture>) => { f.request.rules.operations = [{
      operation: 'execute_threshold', target: 'target', threshold: 0.1
    }]; }, 'rules.operations[0]', 'independent_execution']
  ] as const)('%s按具体路径拒绝', (_name, mutate, path, code) => {
    const f = fixture();
    mutate(f);
    expectAuditError(() => auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input), path, code);
  });

  it('完整作者结果与目录正文必须相等，不能以任意说明自批', () => {
    const f = fixture();
    f.input.sources[0]!.hitBinding.authored.effects[0]!.results[0]!.name = '改名';
    expectAuditError(() => auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input),
      'sources.sources[0].hitBinding.authored.effects.spell_hit.results.damage', 'authored_mismatch');
    const g = fixture();
    (g.input.sources[0] as unknown as Record<string, unknown>).basis = '我认为普通伤害';
    expectAuditError(() => auditAuthoredOrdinaryDamageSources(g.request, g.run, g.input),
      'sources.sources[0].basis', 'invalid_input');
  });

  it('监听别名不能再次触发已核产伤能力；重复操作可继承已核伤害', () => {
    const f = fixture();
    f.request.rules.operations = [{
      operation: 'repeat', target: 'target', repeatCount: 2, repeatDelayMs: 75
    }];
    expect(auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input).repeatOperations)
      .toMatchObject([{ path: 'rules.operations[0]', operation: { repeatCount: 2, repeatDelayMs: 75 } }]);
    f.request.sharedProviders![0]!.listeners = [{
      listenerKey: 'hidden', eventMatcher: {},
      abilityRef: 'self.provider[annie_mount].ability[hit]'
    }];
    expectAuditError(() => auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input),
      'sharedProviders["annie_definition"].listeners["hidden"].abilityRef', 'unverified_reference');
    f.request.sharedProviders![0]!.listeners![0]!.abilityRef = 'source.provider[annie_mount].ability[hit]';
    expectAuditError(() => auditAuthoredOrdinaryDamageSources(f.request, f.run, f.input),
      'sharedProviders["annie_definition"].listeners["hidden"].abilityRef', 'unverified_reference');
  });

  it('正式组合入口摘要对相同来源稳定，对审定依据及目录键变化敏感，四处摘要一致', async () => {
    const f = fixture();
    const scenario = { compileRequest: f.request, runRequest: f.run };
    const modifierBinding = { providerKey: 'rune_amp', authored: modifier() };
    const before = structuredClone({ scenario, modifierBinding, sources: f.input });
    const first = await withAuthoredOrdinaryDamageModifiers(scenario, [modifierBinding], f.input);
    const second = await withAuthoredOrdinaryDamageModifiers(scenario, [modifierBinding], f.input);
    const hash = first.compileRequest.rulesHash;
    expect(second.compileRequest.rulesHash).toBe(hash);
    expect([first.runRequest.rulesHash, first.runRequest.expectedRulesHash,
      first.runRequest.initialSnapshot.rulesHash]).toEqual([hash, hash, hash]);
    expect(first.sourceAudit.facts).toHaveLength(1);
    expect({ scenario, modifierBinding, sources: f.input }).toEqual(before);
    const rationale = structuredClone(f.input);
    rationale.catalog.reviews[0]!.rationale += '；补充核定依据';
    const changedRationale = await withAuthoredOrdinaryDamageModifiers(scenario, [modifierBinding], rationale);
    expect(changedRationale.compileRequest.rulesHash).not.toBe(hash);
    const renamed = structuredClone(f.input);
    renamed.catalog.reviews[0]!.reviewKey = 'annie_q_review_v2';
    renamed.sources[0]!.reviewKey = 'annie_q_review_v2';
    const changedKey = await withAuthoredOrdinaryDamageModifiers(scenario, [modifierBinding], renamed);
    expect(changedKey.compileRequest.rulesHash).not.toBe(hash);
    expect(changedKey.sourceAudit.facts[0]?.reviewKey).toBe('annie_q_review_v2');
  });
});
