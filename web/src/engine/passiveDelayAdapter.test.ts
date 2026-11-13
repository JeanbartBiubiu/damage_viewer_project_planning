import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { recurveBowConfiguration } from '../../tests/fixtures/simulationTriggeredEquipment';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillProcess } from '../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { fixedValue } from '../types/numericValue';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { naturalRuleKeys } from './simulation/sources/description';

function scene(skillKey = 'delayed_mark') {
  const snapshot = simulationActiveSample();
  const configuration = JSON.parse(JSON.stringify(recurveBowConfiguration()).replaceAll('item_1043_passive', skillKey)
    .replaceAll('"gameId":"lol"', `"gameId":"${snapshot.gameId}"`)) as SkillConfiguration;
  const prototype = configuration.triggerRules[0]!;
  const metadata = { gameId: snapshot.gameId, skillKey, name: '有限延后检查', description: null,
    sortOrder: 0, createdAt: '', updatedAt: '' };
  configuration.skill.skillCategoryKeys = ['passive'];
  configuration.internalStates = [{ ...metadata, stateKey: 'stacks', stateType: 'COUNTER', scope: 'TARGET',
    detail: { initialValue: fixedValue(0), maxValue: fixedValue(3), durationValue: fixedValue(6000) } }];
  const delay: SkillProcess = { ...metadata, processKey: 'recheck', activationType: 'PASSIVE', cooldown: null,
    steps: [{ stepKey: 'wait', name: '延后300毫秒', description: null, sortOrder: 0, stepType: 'DELAY',
      occupiesAction: false, detail: { delayValue: fixedValue(300) } }], effectBindings: [], stateOperations: [] };
  const consume: SkillProcess = { ...metadata, processKey: 'consume', activationType: 'PASSIVE', cooldown: null,
    steps: [{ stepKey: 'instant', name: '即时消费', description: null, sortOrder: 0, stepType: 'IMMEDIATE',
      occupiesAction: false, detail: {} }],
    effectBindings: [{ bindingKey: 'damage', effectKey: configuration.effects[0]!.effectKey, sortOrder: 0,
      moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } }],
    stateOperations: [{ operationKey: 'clear', name: '消费', stateSkillKey: skillKey, stateKey: 'stacks',
      operation: 'SET', value: fixedValue(0), optionKey: null, sortOrder: 1,
      moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } }] };
  configuration.processes = [delay, consume];
  const start: SkillTriggerRuleDetail = { ...structuredClone(prototype), ruleKey: 'start', name: '真实命中后预约',
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'sample_active' } },
    conditionGroups: [], oncePerUse: null, perTargetCooldown: null, maxTriggersPerProcess: null,
    actions: [{ ...structuredClone(prototype.actions[0]!), actionKey: 'schedule', actionType: 'START_PROCESS',
      detail: { processKey: 'recheck' }, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }] };
  const tail: SkillTriggerRuleDetail = { ...structuredClone(start), ruleKey: 'tail', name: '执行时检查当前层数', sortOrder: 1,
    eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'recheck',
      moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } } },
    conditionGroups: [{ groupKey: 'eligible', name: '当前有层', sortOrder: 0, conditions: [{ conditionKey: 'nonzero',
      conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0, detail: { stateSkillKey: skillKey, stateKey: 'stacks',
        valueKind: 'VALUE', comparator: 'GT', comparisonValue: fixedValue(0), optionKey: null, expectedBoolean: null } }] }],
    actions: [{ ...start.actions[0]!, actionKey: 'consume', detail: { processKey: 'consume' } }] };
  configuration.triggerRules = [start, tail];
  snapshot.skillConfigurations.push(configuration);
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'passive', name: '被动' });
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey, skillName: skillKey });
  snapshot.source.skillSources.push({ ...snapshot.source.skillSources[1]!,
    origin: { kind: 'CHARACTER', characterKey: snapshot.selection.sourceCharacterKey }, skillKey, skillName: skillKey, skillLevel: 1 });
  snapshot.selection.sourceSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: snapshot.selection.sourceCharacterKey },
    skillKey, enabled: true, skillLevel: 1 });
  syncSimulationSkillSources(snapshot);
  const source = snapshot.source.skillSources.find(row => row.skillKey === skillKey)!;
  source.enabledRuleKeys = naturalRuleKeys(snapshot, configuration, 'source'); source.inactiveReason = null;
  return { snapshot, configuration, delay, start, tail };
}

function assemble(input: ReturnType<typeof scene>) {
  approveSnapshotFixture(input.snapshot);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(input.snapshot).requirements) if (row.storedValue === undefined) {
    attributes[row.side][row.attribute.attributeKey] = 0;
  }
  return assembleSimulation(input.snapshot, attributes, { source: 250, target: 500 });
}

describe('真实技能命中的有限被动延迟编译', () => {
  it.each(['delayed_mark', 'another_counter'])('%s 保留原生300毫秒过程，命中监听不提前执行尾伤或清零', skillKey => {
    const input = scene(skillKey), original = structuredClone(input.snapshot);
    const assembled = assemble(input), compiled = assembled.compileRequest;
    expect(input.snapshot).toEqual(original);
    const provider = compiled.sharedProviders!.find(row => row.skillKey === skillKey)!;
    const process = provider.processes![0]!;
    expect(process).toMatchObject({ processKey: 'recheck', entryKind: 'SKILL_HIT_PASSIVE', costs: [], cooldown: null,
      steps: [{ stepType: 'DELAY', occupiesAction: false, delayMs: { op: 'const', value: 300 } }] });
    expect(provider.abilities![0]!.listenerSpec!.eventMatcher.all).toContain('event/skill_hit');
    expect(provider.abilities![0]!.listenerSpec!.operations).toEqual([
      { operation: 'start_passive_process', target: 'self', processKey: 'recheck', ref: `skills.${skillKey}.processes.recheck` }
    ]);
    expect(process.momentOperations).toHaveLength(1);
    expect(process.momentOperations[0]!.moment.momentType).toBe('PROCESS_COMPLETE');
    expect(process.momentOperations[0]!.operations.some(row => row.operation === 'damage')).toBe(true);
    expect(process.momentOperations[0]!.operations.some(row => row.operation === 'state_change' && row.valuePolicy === 'set')).toBe(true);
    expect(compiled.rules.skillActionBindings!.some(row => row.skillKey === skillKey)).toBe(false);
    const providerIndex = compiled.sharedProviders!.indexOf(provider);
    const origins = assembled.operationOrigins.filter(origin => origin.skillKey === skillKey);
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      const expectedPaths = provider.processes!.flatMap((entry, processIndex) => entry.momentOperations.flatMap((group, momentIndex) =>
        group.operations.flatMap((operation, operationIndex) => operation.ref === origin.operationRef
          ? [`sharedProviders[${providerIndex}].processes[${processIndex}].momentOperations[${momentIndex}].operations[${operationIndex}]`] : [])));
      expect(origin.compiledPaths).toEqual(expectedPaths);
    }
  });

  it('没有明确不占用行动或不是技能命中的延迟不进入原生计划', () => {
    for (const occupiesAction of [undefined, null, true]) {
      const input = scene(); input.delay.steps[0]!.occupiesAction = occupiesAction;
      expect(() => assemble(input)).toThrow(/不占/);
    }
    const input = scene(); input.start.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
    input.snapshot.selection.basicAttackSkillKey = input.snapshot.source.attachedSkills[0]!.skillKey;
    input.snapshot.selection.basicAttackLevel = 1;
    syncSimulationSkillSources(input.snapshot);
    const source = input.snapshot.source.skillSources.find(row => row.skillKey === input.configuration.skill.skillKey)!;
    source.enabledRuleKeys = naturalRuleKeys(input.snapshot, input.configuration, 'source'); source.inactiveReason = null;
    expect(() => assemble(input)).toThrow(/真实技能命中/);
  });

  it('尾过程再次预约延迟被拒绝，不能形成循环或隐藏另一个计时实例', () => {
    const input = scene(); input.tail.actions = [{ ...input.start.actions[0]! }];
    expect(() => assemble(input)).toThrow(/尾过程再预约|循环/);
  });

  it('同一个延迟过程不混用两个监听入口的参数与来源归属', () => {
    const input = scene();
    input.configuration.triggerRules.push({ ...structuredClone(input.start), ruleKey: 'another_start', sortOrder: 2 });
    input.snapshot.source.skillSources.find(row => row.skillKey === input.configuration.skill.skillKey)!.enabledRuleKeys =
      naturalRuleKeys(input.snapshot, input.configuration, 'source');
    expect(() => assemble(input)).toThrow(/唯一真实监听入口/);
  });
});
