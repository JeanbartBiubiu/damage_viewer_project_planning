import { createFormulaPhase4Input } from './formula-phase4-input.mjs';

// 独立作者定义复用显式基准构造器，未读受保护旧样例或按类型补规则。
export function createDamageEventInput({ mixed = false, overflow = false, sameType = false, declared = true } = {}) {
  const input = createFormulaPhase4Input();
  const request = input.compileRequest;
  const slot = value => ({ base: value, current: value, max: value, resolved: value });
  for (const key of ['heat', 'cold', 'quiet']) request.typeCatalog.types.push({ key, domain: 'damage' });
  request.typeCatalog.types.push({ key: 'event/damage_instance', domain: 'event' }, { key: 'event/damage_taken', domain: 'event' }, { key: 'event/source_owner', domain: 'event' });
  const constantDefense = (damageType, value) => ({ damageType, formula: {
    inputs: [], stages: [{ key: 'factor', name: '明确作者倍率', expression: { op: 'const', value } }], outputStageKey: 'factor',
  } });
  const tiny = `0.${'0'.repeat(307)}1`;
  request.rules.damageTypeFormulas = [constantDefense('damage/physical', '0.5'), constantDefense('heat', overflow ? tiny : '1'), constantDefense('cold', tiny), constantDefense('quiet', '0')];
  for (const [index, actor] of request.combatants.entries()) {
    for (const key of ['heat_frames', 'physical_frames', 'damage_instances', 'damage_received']) {
      actor.attributes[key] = slot(0);
      input.runRequest.initialSnapshot.combatants[index].attributes[key] = slot(0);
    }
  }
  const damage = (damageType, amount, ref) => ({ operation: 'damage', target: 'target', damageType, ref, amount: { op: 'const', value: amount } });
  request.sharedProviders[0].abilities[0].operations = overflow
    ? [damage('heat', 1e308, 'large_first'), damage(sameType ? 'heat' : 'cold', 1e308, 'large_second')]
    : [damage('heat', 20, 'heat_first'), damage('heat', 30, 'heat_second'), damage('quiet', 5, 'fully_defended'), ...(mixed ? [damage('damage/physical', 100, 'physical')] : [])];
  const listener = (listenerKey, all, attributeKey) => ({ listenerKey, eventMatcher: { all },
    operations: [{ operation: 'attribute_change', target: 'source', attributeKey, amount: { op: 'const', value: 1 } }] });
  request.sharedProviders[0].listeners = [
    listener('observe_heat', ['event/damage_dealt', 'heat', 'event/source_owner'], 'heat_frames'),
    listener('observe_physical', ['event/damage_dealt', 'damage/physical', 'event/source_owner'], 'physical_frames'),
    listener('observe_instances', ['event/damage_instance', 'event/source_owner'], 'damage_instances'),
  ];
  request.sharedProviders.push({ providerKey: 'recipient_observer', kind: 'generic', stableId: 'recipient_observer',
    listeners: [listener('observe_received', ['event/damage_taken', 'event/source_opponent'], 'damage_received')] });
  request.typeCatalog.types.push({ key: 'event/source_opponent', domain: 'event' });
  request.combatants[1].providers.push({ providerRef: 'recipient_observer', definitionRef: 'recipient_observer' });
  input.runRequest.initialSnapshot.combatants[1].providers.push({ providerRef: 'recipient_observer', definitionRef: 'recipient_observer', source: 'target', owner: 'target', stacks: 1, expireAt: null, state: {} });
  if (!declared) {
    request.typeCatalog.types = request.typeCatalog.types.filter(row => row.key !== 'event/damage_dealt');
    request.sharedProviders[0].listeners = request.sharedProviders[0].listeners.slice(2);
  }
  const total = overflow ? 2 : mixed ? 100 : 50;
  input.expectedSummarySubset = { targetFinalHp: 1000 - total, sourceDamageDealt: total, abilityCastCount: 1, abilityAttemptCount: 1 };
  return input;
}
