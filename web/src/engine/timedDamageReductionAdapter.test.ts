import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DamageType } from '../types/damageType';
import type { ModifierZone } from '../types/modifierZone';
import type { SkillEffect } from '../types/skillEffect';
import type { AuthoredProcessProgram } from './processAdapter';
import type { CompileRequest } from '../types/genericEngine';
import { fixedValue } from '../types/numericValue';
import { createNumericCompileState } from './numericAdapter';
import { compileTimedDamageReduction } from './timedDamageReductionAdapter';
import { adaptProcessProgram, withProcessProgram } from './processAdapter';
import { TinyGoV2Bridge } from '../../tests/fixtures/authorizedBridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { authoredConstantDefense } from '../../tests/fixtures/authoredDamageFormula';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { assembleActiveSkills } from './simulationActiveSkills';

const metadata = { description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
const zone: ModifierZone = { ...metadata, gameId: 'lol', modifierZoneKey: 'incoming_product', name: '承受伤害乘算', domain: 'DAMAGE',
  calculationMode: 'RATIO_MULTIPLY', applicationStage: 'DAMAGE_POST_DEFENSE', status: 'ENABLED' };
const damageTypes: DamageType[] = ['steel', 'ether', 'pure'].map(damageTypeKey => ({ ...metadata, gameId: 'lol', damageTypeKey,
  name: damageTypeKey, status: 'ENABLED', formulaConfigured: true }));
function effect(skillKey = 'defense_alpha', damageTypeKey = 'steel', ratio = .25): SkillEffect {
  return { ...metadata, gameId: 'lol', skillKey, effectKey: `reduce_${damageTypeKey}`, name: '独立有期承受减少',
    lifecycle: { instanceScope: 'SOURCE', durationValue: fixedValue(4000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
      reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null,
      firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
    results: [{ resultKey: 'reduction', name: '减伤', description: null, sortOrder: 0, resultType: 'DAMAGE_MODIFIER', target: 'SOURCE',
      spellShieldBlockScope: null, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED',
        reapplicationValueMode: null, periodicExecutionMode: null }, valueRule: { value: fixedValue(ratio), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { modifierZoneKey: zone.modifierZoneKey, direction: 'TAKEN', operation: 'DECREASE', damageTypeKey, deliveryKind: 'ANY', originKind: 'ANY', criticalFilter: 'ANY' } }] };
}
function state(skillKey: string) { return createNumericCompileState({ gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1,
  parameters: [], formulas: [], formulaNamespace: 'defense-test', bindParameters: false, allowAttributeReads: true, runtimeInputMessage: '不补输入' }); }
function program(skillKey: string): AuthoredProcessProgram {
  const moment = { momentType: 'PROCESS_START' as const, stepKey: null, failureReason: null };
  return { gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1, parameters: [], formulas: [], castCosts: [], modifierZones: [zone], damageTypes,
    effects: [effect(skillKey), effect(skillKey, 'ether')], process: { ...metadata, gameId: 'lol', skillKey, processKey: 'cast', name: '即时防御', activationType: 'ACTIVE',
      cooldown: { durationValue: fixedValue(12000), startMoment: moment }, stateOperations: [],
      steps: [{ stepKey: 'now', name: '即时', description: null, sortOrder: 0, stepType: 'IMMEDIATE', detail: {}, occupiesAction: false }],
      effectBindings: ['steel', 'ether'].map((key, sortOrder) => ({ bindingKey: key, effectKey: `reduce_${key}`, moment, sortOrder })) },
    rules: [{ ruleKey: 'cast', name: '真正首次', description: null, sortOrder: 0, eventSource: { eventType: 'SKILL_USED',
      detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } }, conditionGroups: [], oncePerUse: null,
      perTargetCooldown: null, maxTriggersPerProcess: null, actions: [{ actionKey: 'begin', name: '开始', sortOrder: 0, actionType: 'START_PROCESS',
        detail: { processKey: 'cast' }, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }] }] };
}

describe('有限承受伤害比例乘算', () => {
  it('计划主动装配保留两个独立作者效果的准确结果来源，不伪造同一实例多结果', () => {
    const snapshot = simulationActiveSample();
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === snapshot.selection.plannedSkills[0]!.skillKey)!;
    const authored = JSON.parse(JSON.stringify(program(configuration.skill.skillKey)).replaceAll('"lol"', JSON.stringify(snapshot.gameId))) as AuthoredProcessProgram;
    configuration.effects = [...authored.effects]; configuration.processes = [authored.process]; configuration.triggerRules = [...authored.rules];
    configuration.parameters = []; configuration.formulas = [];
    snapshot.catalogs.modifierZones.push({ ...zone, gameId: snapshot.gameId });
    for (const row of damageTypes) snapshot.catalogs.damageTypes.push({ ...structuredClone(snapshot.catalogs.damageTypes[0]!), type: { ...row, gameId: snapshot.gameId } });
    syncSimulationSkillSources(snapshot); approveSnapshotFixture(snapshot);
    const compiled = assembleActiveSkills(snapshot);
    expect(compiled.operationOrigins).toHaveLength(2);
    expect(new Set(compiled.operationOrigins.map(row => row.operationRef)).size).toBe(2);
    expect(compiled.providers.filter(row => row.modifiers?.some(modifier => modifier.command === 'damage'))).toHaveLength(2);
    expect(compiled.coverage.filter(row => row.authorPath.startsWith('catalogs.damageTypes.'))).toHaveLength(2);
    expect(compiled.bindings[0]!.controls).toHaveLength(1);
  });

  it.each(['defense_alpha', 'barrier_beta'])('%s 从真实目录类型编译，原作者数据与区域不改写', skillKey => {
    const input = program(skillKey), before = structuredClone(input);
    const adapted = adaptProcessProgram(input);
    expect(input).toEqual(before);
    expect(adapted.providers).toHaveLength(2);
    expect(adapted.providers.map(row => row.modifiers![0]!.condition!.path)).toEqual(['damage.type.steel', 'damage.type.ether']);
    expect(adapted.providers.every(row => row.lifecycle?.instanceScope === 'source_target' && row.lifecycle.durationMs?.value === 4000)).toBe(true);
    expect(adapted.provider.processes[0]!.cooldown?.durationMs).toEqual({ op: 'const', value: 12000 });
    expect(adapted.provider.processes[0]!.momentOperations[0]!.operations.map(row => row.ref))
      .toEqual(['steel', 'ether'].map(key => `skills.${skillKey}.effects.reduce_${key}.results.reduction`));
    expect(adapted.typeEntries).toEqual([{ key: 'steel', domain: 'damage' }, { key: 'ether', domain: 'damage' }]);
  });

  it.each(['add_zone', 'pre_stage', 'outgoing', 'increase', 'any_type', 'missing_type', 'disabled_type', 'foreign_type', 'multi_result', 'periodic', 'shield_link', 'target', 'dynamic', 'negative', 'too_large'] as const)
    ('拒绝尚未接入或错误组合 %s', variant => {
      const input = effect(), zones = [structuredClone(zone)], types = structuredClone(damageTypes), result = input.results[0]!;
      if (result.resultType !== 'DAMAGE_MODIFIER') throw new Error('样例结果类型');
      if (variant === 'add_zone') zones[0]!.calculationMode = 'RATIO_ADD';
      if (variant === 'pre_stage') zones[0]!.applicationStage = 'DAMAGE_PRE_DEFENSE';
      if (variant === 'outgoing') result.detail.direction = 'DEALT';
      if (variant === 'increase') result.detail.operation = 'INCREASE';
      if (variant === 'any_type') result.detail.damageTypeKey = null;
      if (variant === 'missing_type') types.shift();
      if (variant === 'disabled_type') types[0]!.status = 'DISABLED';
      if (variant === 'foreign_type') types[0]!.gameId = 'other';
      if (variant === 'multi_result') input.results.push({ ...structuredClone(result), resultKey: 'extra' });
      if (variant === 'periodic') input.lifecycle!.periodicIntervalValue = fixedValue(100);
      if (variant === 'shield_link') input.lifecycle!.endWhenShieldEndsResultKey = 'reduction';
      if (variant === 'target') result.target = 'TARGET';
      if (variant === 'dynamic') { result.lifecycleBehavior!.valueReadMode = 'APPLICATION_SNAPSHOT'; result.lifecycleBehavior!.reapplicationValueMode = 'REPLACE'; }
      if (variant === 'negative') result.valueRule!.value = fixedValue(-.1);
      if (variant === 'too_large') result.valueRule!.value = fixedValue(1.01);
      expect(() => compileTimedDamageReduction(input, state(input.skillKey), zones, types)).toThrow();
    });

  it.each(['source', 'target'] as const)('真实 Wasm 对 %s 拥有者只降低显式类型，4000ms到期且同会话无残留', async owner => {
    const authored = program(`defense_${owner}`);
    authored.owner = owner;
    const attacker = owner === 'source' ? 'target' : 'source';
    const input: CompileRequest = { schemaVersion: 'generic-p0', schemaHash: 'defense-test', rulesHash: 'before',
      typeCatalog: { types: [{ key: 'hp', domain: 'attribute' }], relations: [] }, rules: { damageTypeFormulas: damageTypes.map(row => ({ damageType: row.damageTypeKey, formula: authoredConstantDefense('1') })) },
      combatants: (['source', 'target'] as const).map(key => ({ key, attributes: { hp: { base: 1000, current: 1000, max: 1000, resolved: 1000 } }, resources: {}, providers: [] })),
      sharedProviders: [{ providerKey: 'attacks', kind: 'character', stableId: 'attacks', abilities: ['steel', 'ether', 'pure'].map(key => ({ abilityKey: key, kind: 'active',
        operations: [{ operation: 'damage', target: 'target', amount: { op: 'const', value: 100 }, damageType: key, ref: `damage_${key}` }] })) }] };
    input.combatants.find(row => row.key === attacker)!.providers.push({ providerRef: 'attack', definitionRef: 'attacks' });
    input.typeCatalog.types.push(...damageTypes.map(row => ({ key: row.damageTypeKey, domain: 'damage' })));
    const request = withProcessProgram(input, { processProviderKey: 'guard', authored }, { rulesHash: `defense-${owner}` });
    request.sharedProviders!.push({ providerKey: 'peer_reduction', stableId: 'peer_reduction', kind: 'item', modifiers: [{ modifierKey: 'peer',
      kind: 'pipeline', command: 'damage', channel: 'all_damage', stage: 'incoming_post_mitigation', bucket: 'all_instances', valuePolicy: 'multiply',
      value: { op: 'const', value: .8 }, condition: { op: 'read', path: 'damage.type.steel' } }] });
    request.combatants.find(row => row.key === owner)!.providers.push({ providerRef: 'peer', definitionRef: 'peer_reduction' });
    const ability = request.sharedProviders!.find(row => row.providerKey === `process_${owner}_guard`)!.abilities!.find(row => row.processControl?.action === 'INITIAL')!;
    const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
    const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
    const compiled = parseCompileResult(bridge.compile(request));
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw new Error('缺少真实编译会话');
    try {
      for (const { active, multi } of [{ active: true, multi: false }, { active: false, multi: false }, { active: true, multi: false }, { active: true, multi: true }]) {
        const initialSnapshot = simulationInitialSnapshot(request);
        if (!multi) initialSnapshot.combatants.find(row => row.key === owner)!.providers = initialSnapshot.combatants.find(row => row.key === owner)!.providers.filter(row => row.providerRef !== 'peer');
        const entries = [
          ...(active ? [{ entryKey: 'guard', abilityRef: `${owner}.provider[guard].ability[${ability.abilityKey}]`, source: owner, target: owner, firstAtMs: 0, priority: 0 }] : []),
          ...[['steel', 1], ['ether', 750], ['pure', 1000], ['steel', 4000]].map(([key, at], priority) => ({ entryKey: `hit_${priority}`,
            abilityRef: `${attacker}.provider[attack].ability[${key}]`, source: attacker, target: owner, firstAtMs: Number(at), priority: priority + 1 }))
        ];
        const done = parseDoneResult(bridge.run({ sessionId: compiled.sessionId, expectedRulesHash: request.rulesHash, schemaVersion: request.schemaVersion,
          schemaHash: request.schemaHash, rulesHash: request.rulesHash, initialSnapshot,
          skillUses: active ? [{ useKey: 'guard_use', source: owner, skillKey: authored.skillKey, historyState: 'complete' }] : [],
          processCommandFacts: active ? [{ driverEntryKey: 'guard', useRef: 'guard_use' }] : [],
          driverPlan: { conditionRecheckIntervalMs: 100, entries }, stopPolicy: { durationMs: 4001, stopOnTargetDeath: false, stopWhenNoEvents: false },
          sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 10 } }));
        expect(done.ok, JSON.stringify(done.errors)).toBe(true);
        expect(done.finalSnapshot.combatants.find(row => row.key === owner)!.attributes.hp!.current).toBe(multi ? 685 : active ? 650 : 600);
        expect(done.damageRecords?.map(row => [row.damageType, row.postDefenseDamage])).toEqual([['steel', multi ? 60 : active ? 75 : 100], ['ether', active ? 75 : 100], ['pure', 100], ['steel', multi ? 80 : 100]]);
        expect(done.finalSnapshot.combatants.find(row => row.key === owner)!.providers.filter(row => row.definitionRef.startsWith('reduction/'))).toEqual([]);
      }
    } finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, request.rulesHash)).released).toBe(true); }
  });
});
