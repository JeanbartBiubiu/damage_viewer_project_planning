import { describe, expect, it } from 'vitest';
import type { CompileRequest, RunRequest } from '../types/genericEngine';
import { hasDynamicSpeedDependency } from './simulationCalculationRules';

function scene() {
  const input: CompileRequest = { schemaVersion: 'generic-p0', schemaHash: 'reachable', rulesHash: 'reachable', typeCatalog: { types: [], relations: [] },
    combatants: [{ key: 'source', attributes: {}, resources: {}, providers: [{ providerRef: 'planned', definitionRef: 'planned_definition' }] },
      { key: 'target', attributes: {}, resources: {}, providers: [] }],
    sharedProviders: [{ providerKey: 'planned_definition', stableId: 'planned_definition', kind: 'character',
      abilities: [{ abilityKey: 'initial', kind: 'active', processControl: { processKey: 'cast', action: 'INITIAL' } },
        { abilityKey: 'hit', kind: 'active', operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: { skillKey: 'planned_skill', candidates: [{
          candidateKey: 'speed', effectOccurrenceKey: 'speed', effectKey: 'speed', resultKey: 'speed', spellShieldBlockScope: null,
          semantic: { resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', moment: 'INSTANT' },
          operations: [{ operation: 'attribute_change', target: 'self', attributeKey: 'saved_extra', valuePolicy: 'add', amount: { op: 'const', value: .2 } }]
        }] } }] }], processes: [{ processKey: 'cast', skillKey: 'planned_skill', steps: [], costs: [], cooldown: null, momentOperations: [] }] }],
    formulas: [{ key: 'authored_speed', scope: 'game', parameters: [], expression: {
      inputs: [{ key: 'extra', binding: { kind: 'attribute', object: 'source', attributeKey: 'saved_extra', valueKind: 'TOTAL', view: 'current_frame' } }],
      stages: [{ key: 'output', name: '输出', expression: { op: 'read', inputKey: 'extra' } }], outputStageKey: 'output' } }],
    rules: { attributeDerivations: [{ combatantKey: 'source', attributeKey: 'saved_tempo', valuePolicy: 'set', valueType: 'DECIMAL', value: { op: 'ref', ref: 'authored_speed' } }],
      skillActionBindings: [{ bindingKey: 'planned', source: 'source', providerRef: 'planned', providerDefinitionRef: 'planned_definition', skillKey: 'planned_skill',
        controls: [{ action: 'INITIAL', processKey: 'cast', abilityRef: 'source.provider[planned].ability[initial]' }],
        hitBindings: [{ hitBindingKey: 'hit', processKey: 'cast', moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null }, hitAbilityRef: 'source.provider[planned].ability[hit]' }] }] } };
  const request: RunRequest = { sessionId: 'reachable', expectedRulesHash: 'reachable', schemaVersion: input.schemaVersion, schemaHash: input.schemaHash, rulesHash: input.rulesHash,
    initialSnapshot: { schemaHash: input.schemaHash, rulesHash: input.rulesHash, timeMs: 0, combatants: [] },
    driverPlan: { entries: [], conditionRecheckIntervalMs: 100, skillActions: [{ instructionKey: 'first', firstAtMs: 500, sortOrder: 0, source: 'source', target: 'target',
      skillKey: 'planned_skill', bindingKey: 'planned', action: 'INITIAL', abilityRef: 'source.provider[planned].ability[initial]', parentInstructionKey: null, hitBindings: [{ hitBindingKey: 'hit', preset: 'TARGET_HIT' }] }] },
    stopPolicy: { durationMs: 2700, stopOnTargetDeath: true, stopWhenNoEvents: false }, sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 100 } };
  const operation = input.sharedProviders![0]!.abilities![1]!.operations![0]!.skillHit!.candidates[0]!.operations[0]!;
  return { input, request, operation };
}

describe('实际可达操作决定速度变化', () => {
  it('主动命中自身或来源投送改变TOTAL依赖，目标反向和BASE读取保持静态', () => {
    const { input, request, operation } = scene();
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo', request)).toBe(true);
    operation.target = 'source';
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo', request)).toBe(true);
    operation.target = 'target';
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo', request)).toBe(false);
    operation.target = 'self';
    const binding = input.formulas![0]!.expression.inputs[0]!.binding;
    if (binding.kind === 'attribute') binding.valueKind = 'BASE';
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo', request)).toBe(false);
  });
  it('未安排、明确MISS、未挂载、无真实命中绑定或孤立能力不能放宽静态核对', () => {
    const { input, request } = scene();
    request.driverPlan.skillActions = [];
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo', request)).toBe(false);
    const arranged = scene();
    arranged.request.driverPlan.skillActions![0]!.hitBindings[0]!.preset = 'MISS';
    expect(hasDynamicSpeedDependency(arranged.input, 'source', 'saved_tempo', arranged.request)).toBe(false);
    arranged.request.driverPlan.skillActions![0]!.hitBindings[0]!.preset = 'TARGET_HIT';
    arranged.input.rules.skillActionBindings![0]!.hitBindings = [];
    expect(hasDynamicSpeedDependency(arranged.input, 'source', 'saved_tempo', arranged.request)).toBe(false);
    const unmounted = scene(); unmounted.input.combatants[0]!.providers = [];
    expect(hasDynamicSpeedDependency(unmounted.input, 'source', 'saved_tempo', unmounted.request)).toBe(false);
    const isolated = scene(); isolated.request.driverPlan.skillActions![0]!.hitBindings = [];
    expect(hasDynamicSpeedDependency(isolated.input, 'source', 'saved_tempo', isolated.request)).toBe(false);
  });
  it('只沿实际过程和监听访问即时操作，opponent投向真实另一拥有方', () => {
    const { input, request, operation } = scene();
    request.driverPlan.skillActions![0]!.hitBindings = [];
    input.sharedProviders![0]!.processes![0]!.momentOperations.push({ moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null }, operations: [{ ...operation, target: 'source' }] });
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo', request)).toBe(true);
    input.sharedProviders![0]!.processes![0]!.momentOperations = [];
    input.combatants[1]!.providers.push({ providerRef: 'opponent_listener', definitionRef: 'opponent_listener' });
    input.sharedProviders!.push({ providerKey: 'opponent_listener', stableId: 'opponent_listener', kind: 'character', abilities: [{ abilityKey: 'on_start', kind: 'passive_listener',
      listenerSpec: { listenerKey: 'on_start', eventMatcher: { all: ['event/ability_started', 'event/target_owner'] }, operations: [{ ...operation, target: 'opponent' }] } }] });
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo', request)).toBe(true);
    input.sharedProviders![1]!.abilities![0]!.listenerSpec!.operations![0]!.target = 'self';
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo', request)).toBe(false);
  });
});
