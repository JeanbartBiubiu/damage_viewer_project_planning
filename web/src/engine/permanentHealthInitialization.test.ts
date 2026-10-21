import { describe, expect, it } from 'vitest';
import type { DoneResult, RunRequest } from '../types/genericEngine';
import { simulationSceneInitialParameter } from '../../tests/fixtures/simulationSceneInitialParameter';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { inspectSimulationSnapshot, assembleSimulation } from './simulationAdapter';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { inspectPermanentHealthInitialization, permanentHealthInitializers } from './permanentHealthInitialization';
import { simulationHealthLimit } from './simulationEquipment';
import { fixedValue } from '../types/numericValue';

function sample() {
  const { snapshot, configuration, inputs } = simulationSceneInitialParameter();
  const permanent = configuration.effects.find(row => row.effectKey === 'permanent_resist')!;
  permanent.results = [{ ...permanent.results[0]!, resultKey: 'health', detail: { attributeKey: 'hp', operation: 'INCREASE', modifierZoneKey: 'flat' } } as typeof permanent.results[number]];
  const expression = configuration.formulas[0]!.expression;
  expression.stages[0]!.expression = { op: 'mul', args: [{ op: 'read', inputKey: 'stacks' }, { op: 'const', value: '100' }] };
  const scene = inputs(2, 0);
  approveSnapshotFixture(snapshot, scene);
  const inspection = inspectSimulationSnapshot(snapshot, [], scene);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspection.requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  const prepared = assembleSimulation(snapshot, attributes, { source: 250, target: 500 }, [], [], [], scene);
  const compile = prepared.compileRequest;
  const request = { initialSnapshot: simulationInitialSnapshot(compile), stopPolicy: { durationMs: 100 } } as RunRequest;
  const rows = permanentHealthInitializers(compile.sharedProviders, compile.combatants.flatMap(actor => actor.providers.map(mount => ({
    side: actor.key as 'source' | 'target', ...mount }))));
  const done = { finalSnapshot: structuredClone(request.initialSnapshot), evidence: { items: [], truncated: false, countsByKind: { resource_max_initialized: 2 } } } as unknown as DoneResult;
  for (const side of ['source', 'target'] as const) {
    const actor = done.finalSnapshot.combatants.find(actor => actor.key === side)!;
    const contributions = rows.filter(row => row.owner === side).map(row => ({ ...row, providerRef: `actual_new_${side}` })), hp = actor.attributes.hp!;
    done.evidence.items.push({ kind: 'resource_max_initialized', ref: side, timeMs: 0, data: { resourceKey: 'hp', owner: side, target: side,
      anchorMax: side === 'source' ? 650 : 590, permanentIncrease: side === 'source' ? 200 : 0,
      max: hp.max, current: hp.current, contributions } });
    for (const row of contributions) actor.providers.push({ providerRef: row.providerRef, definitionRef: row.definitionRef,
      owner: side, source: side, stacks: 1, expireAt: null, state: {} });
  }
  return { snapshot, configuration, scene, inspection, attributes, prepared, compile, request, done };
}

describe('永久生命冷初始化与显式当前生命', () => {
  it('B650+P200=M850先预览容量，保持C250；共享0贡献仍有真实初始化身份', () => {
    const { snapshot, inspection, compile, request, done } = sample();
    expect(inspection.permanentHealthIncreases).toEqual({ source: 200, target: 0 });
    expect(simulationHealthLimit(snapshot, 'source', undefined, inspection.permanentHealthIncreases.source)).toBe(850);
    expect(compile.combatants[0]!.attributes.hp).toEqual({ base: 650, current: 250, max: 850, resolved: 850 });
    expect(inspectPermanentHealthInitialization(compile, request, done)).toEqual({ issues: [], identityGaps: [] });
    expect(compile.combatants[0]!.providers.filter(mount => compile.sharedProviders.find(provider => provider.providerKey === mount.definitionRef)?.processes?.length)).toHaveLength(1);
  });
  it('满血是明确850输入，超过M或缺失不能填满或夹取', () => {
    const { snapshot, attributes, scene } = sample();
    expect(assembleSimulation(snapshot, attributes, { source: 850, target: 590 }, [], [], [], scene).compileRequest.combatants[0]!.attributes.hp!.current).toBe(850);
    expect(() => assembleSimulation(snapshot, attributes, { source: 851, target: 500 }, [], [], [], scene)).toThrow(/当前生命/);
    expect(() => assembleSimulation(snapshot, attributes, { target: 500 } as never, [], [], [], scene)).toThrow(/initialHealth/);
  });
  it.each(['time', 'preinstalled', 'current', 'missing', 'duplicate', 'owner', 'ability', 'amount', 'source', 'path', 'provider'] as const)(
    '拒绝伪造或不完整的初始化事实 %s', kind => {
      const { compile, request, done } = sample();
      const data = done.evidence.items[0]!.data!;
      const contribution = (data.contributions as Array<Record<string, unknown>>)[0]!;
      if (kind === 'time') request.initialSnapshot.timeMs = 1;
      if (kind === 'preinstalled') request.initialSnapshot.combatants[0]!.providers.push(structuredClone(done.finalSnapshot.combatants[0]!.providers.slice(-1)[0]!));
      if (kind === 'current') request.initialSnapshot.combatants[0]!.attributes.hp!.current = 850;
      if (kind === 'missing') delete contribution.useRef;
      if (kind === 'duplicate') done.evidence.items.push(structuredClone(done.evidence.items[0]!));
      if (kind === 'owner') data.owner = 'target';
      if (kind === 'ability') contribution.abilityRef = 'invented';
      if (kind === 'amount') data.permanentIncrease = 201;
      if (kind === 'source') contribution.sourceProviderRef = 'other';
      if (kind === 'path') contribution.opPath = 'other';
      if (kind === 'provider') done.finalSnapshot.combatants[0]!.providers.slice(-1)[0]!.source = 'target';
      expect(inspectPermanentHealthInitialization(compile, request, done).issues.length).toBeGreaterThan(0);
    });
  it('零记录与普通证据预算无关；冷证据缺失只有明确截断可报告证明缺口', () => {
    const { compile, request, done } = sample();
    request.recordBudget = { maxDamageRecords: 0, maxResourceChangeRecords: 0 };
    expect(inspectPermanentHealthInitialization(compile, request, done).issues).toEqual([]);
    done.evidence.items = [];
    expect(inspectPermanentHealthInitialization(compile, request, done).issues.length).toBeGreaterThan(0);
    done.evidence.truncated = true;
    expect(inspectPermanentHealthInitialization(compile, request, done).identityGaps).toHaveLength(2);
  });
  it('普通主动能力不能引用已授权的永久效果定义', () => {
    const { compile, request, done } = sample();
    const effect = compile.sharedProviders.find(provider => provider.modifiers?.some(modifier => modifier.currentValuePolicy === 'preserve_initial_current'))!;
    compile.sharedProviders.find(provider => provider.abilities?.length)!.abilities![0]!.operations = [{ operation: 'apply_provider', target: 'self', providerDefinitionRef: effect.providerKey }];
    expect(inspectPermanentHealthInitialization(compile, request, done).issues.join(' ')).toContain('再次施加');
  });
  it('负值、百分比、SET及非快照生命不能借永久初始化入口', () => {
    for (const kind of ['negative', 'percent', 'set', 'live'] as const) {
      const { snapshot, configuration, scene } = sample();
      const result = configuration.effects.find(row => row.effectKey === 'permanent_resist')!.results[0]!;
      if (kind === 'negative') result.valueRule!.value = fixedValue(-1);
      if (kind === 'percent') snapshot.catalogs.modifierZones[0]!.calculationMode = 'RATIO_ADD';
      if (kind === 'set' && result.resultType === 'ATTRIBUTE_CHANGE') result.detail.operation = 'SET';
      if (kind === 'live') result.lifecycleBehavior!.valueReadMode = 'MOMENT_EVALUATION';
      expect(() => inspectSimulationSnapshot(snapshot, [], scene), kind).toThrow();
    }
  });
});
