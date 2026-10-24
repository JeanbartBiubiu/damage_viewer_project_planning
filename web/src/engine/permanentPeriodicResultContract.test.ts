import { describe, expect, it } from 'vitest';
import type { CompileRequest, DamageRecord, DoneResult, RunRequest } from '../types/genericEngine';
import type { OperationOrigin } from './simulationAdapter';
import { inspectPermanentPeriodicResult } from './permanentPeriodicResultContract';

function sample(mixed = true, owner: 'source' | 'target' = 'source') {
  const target = owner === 'source' ? 'target' : 'source';
  const p = 'periodic', q = 'reaction', definition = 'periodic_definition', passive = 'reaction_definition';
  const tickRef = `skills.${p}.effects.period.results.damage`, rawRef = `skills.${q}.effects.extra.results.damage`;
  const tickAbility = `${owner}.provider[period].ability[tick]`, rawAbility = `${owner}.provider[reaction].ability[raw]`;
  const input = {
    typeCatalog: { types: [], relations: [] }, rules: {},
    combatants: ['source', 'target'].map(key => ({ key, providers: key === owner ? [{ providerRef: 'period', definitionRef: definition }, { providerRef: 'reaction', definitionRef: passive }] : [] })),
    sharedProviders: [
      { providerKey: definition, stableId: definition, skillKey: p, kind: 'character', abilities: [
        { abilityKey: 'tick', kind: 'tick', skillKey: p, types: ['ability/skill/periodic'], tickSpec: { startDelayMs: 500, intervalMs: 500, onTick: [
          { operation: 'damage', target: 'target', ref: tickRef, damageType: 'magic', amount: { op: 'const', value: 10 }, critEligible: false,
            types: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'], vampQualification: 'RESOLVED', vampOverrides: [] }
        ] } }
      ] },
      { providerKey: passive, stableId: passive, skillKey: q, kind: 'character', initialStateSchema: { mark: {
        valueType: 'integer', defaultValue: 0, maxValue: 1, durationMs: 3000, refreshPolicy: 'refresh_on_write'
      } }, abilities: [
        { abilityKey: 'raw', kind: 'passive_listener', skillKey: q, listenerSpec: { listenerKey: 'raw', maxTriggersPerEvent: 1,
          eventMatcher: { all: ['event/damage_instance', 'event/source_owner', 'magic'] },
          condition: { op: 'eq', args: [{ op: 'read', path: 'event.provider_target_state_before.mark' }, { op: 'const', value: 1 }] },
          operations: [{ operation: 'damage', target: 'target', ref: rawRef, damageType: 'real', critEligible: false,
            amount: { op: 'max', args: [{ op: 'mul', args: [{ op: 'read', path: 'event.damage.baseRawAmount' }, { op: 'const', value: 0.1 }] }, { op: 'const', value: 0 }] },
            types: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'], vampQualification: 'RESOLVED', vampOverrides: [] }] } }
      ] }
    ]
  } as unknown as CompileRequest;
  const request = { driverPlan: { entries: [], ...(mixed ? { skillActions: [{}] } : {}) }, initialSnapshot: { timeMs: 0,
    combatants: input.combatants.map(actor => ({ key: actor.key, providers: actor.providers.map(mount => ({ ...mount,
      owner: actor.key, source: actor.key, stacks: 1, expireAt: null, state: {} })) })) } } as unknown as RunRequest;
  const common = { owner, source: owner, target, castInstanceId: 4, timeMs: 500, attackIndex: mixed ? null : 0,
    useRef: '', hitRef: null, phase: 'original', phantom: false, traits: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'], postDefenseDamage: 10, rawAmount: 10 };
  const parent = { ...common, damageId: 1, providerRef: 'period', abilityRef: tickAbility, operationRef: tickRef,
    damageType: 'magic', operationPath: 'sharedProviders[0].abilities[0].tickSpec.onTick[0]' } as DamageRecord;
  const child = { ...common, damageId: 2, providerRef: 'reaction', abilityRef: rawAbility, operationRef: rawRef,
    damageType: 'real', rawAmount: 1, postDefenseDamage: 1, operationPath: 'sharedProviders[1].abilities[0].listenerSpec.operations[0]' } as DamageRecord;
  const done = { damageRecords: [parent, child], recording: { damageRecordsTruncated: false }, evidence: { truncated: false, items: [
    { kind: 'damage_state_before', timeMs: 500, ref: 'reaction', data: { damageId: 1, owner, providerRef: 'reaction', definitionRef: passive,
      stateKey: 'mark', target, beforeValue: 1 } },
    ...[parent, child].map(row => ({ kind: 'emitted_event', ref: 'event/damage_instance', timeMs: row.timeMs,
      data: { eventType: 'event/damage_instance', abilityRef: row.abilityRef, operationRef: row.operationRef,
        damageId: row.damageId, source: row.source, target: row.target, castInstanceId: row.castInstanceId,
        damageType: row.damageType, phantom: false, damage: { baseRawAmount: row.rawAmount, mitigatedAmount: row.postDefenseDamage } } }))
  ] } } as unknown as DoneResult;
  const origins: OperationOrigin[] = [{ abilityRef: tickAbility, operationRef: tickRef, skillKey: p, effectKey: 'period', resultKey: 'damage', compiledPaths: [parent.operationPath] },
    { abilityRef: rawAbility, operationRef: rawRef, skillKey: q, effectKey: 'extra', resultKey: 'damage', compiledPaths: [child.operationPath] }];
  return { input, request, done, origins, parent, child };
}
const inspect = (s: ReturnType<typeof sample>) => inspectPermanentPeriodicResult(s.input, s.request, s.done, s.origins);

function bareSample(owner: 'source' | 'target' = 'source') {
  const s = sample(false, owner);
  s.input.sharedProviders!.pop(); s.origins.pop();
  for (const actor of s.input.combatants) actor.providers = actor.providers.filter(p => p.providerRef !== 'reaction');
  for (const actor of s.request.initialSnapshot.combatants) actor.providers = actor.providers.filter(p => p.providerRef !== 'reaction');
  s.done.damageRecords = [s.parent];
  s.done.evidence.items = [
    { kind: 'damage', ref: s.parent.abilityRef, timeMs: 500, data: { abilityRef: s.parent.abilityRef, operationRef: s.parent.operationRef,
      providerRef: 'period', source: owner, target: s.parent.target, damageType: 'magic', damageId: 1, castInstanceId: 4,
      phase: 'original', phantom: false, rawAmount: 10, postDefenseDamage: 10 } },
    { kind: 'provider_tick', ref: 'period', timeMs: 500, data: { providerRef: 'period', definitionRef: 'periodic_definition', combatantKey: owner } }
  ];
  return s;
}

describe('永久周期及本笔RAW派生的独立结果身份', () => {
  it.each([true, false])('按真实mixed=%s区分null/0且连接同次父子提交', mixed => {
    const s = sample(mixed), result = inspect(s);
    expect(result.accepts(s.parent)).toBe(true); expect(result.accepts(s.child)).toBe(true);
    expect(result.sameCommit(s.parent, s.child)).toBe(true); expect(result.identityGaps).toEqual([]);
    s.parent.attackIndex = mixed ? 0 : null;
    expect(inspect(s).accepts(s.parent)).toBe(false);
  });
  it('目标角色永久周期仍命中真实对手，不借来源方标记', () => {
    const s = sample(true, 'target'); s.done.evidence.items[0]!.data!.beforeValue = 0;
    s.done.damageRecords = [s.parent]; s.done.evidence.items = s.done.evidence.items.filter(item => item.data?.damageId !== 2);
    expect(inspect(s).accepts(s.parent)).toBe(true); expect(inspect(s).accepts(s.child)).toBe(false);
  });
  const parentMutations: Array<[string, (s: ReturnType<typeof sample>) => void]> = [
    ['错拥有者', s => { s.parent.owner = 'target'; }],
    ['错对手', s => { s.parent.target = 'source'; }],
    ['错实际挂载', s => { s.request.initialSnapshot.combatants[0]!.providers[0]!.definitionRef = 'unknown'; }],
    ['有期挂载', s => { s.request.initialSnapshot.combatants[0]!.providers[0]!.expireAt = 2000; }],
    ['错作者路径', s => { s.parent.operationPath = 'sharedProviders[0].abilities[0].tickSpec.onTick[1]'; }],
    ['错来源操作', s => { s.parent.operationRef = 'other'; }],
    ['伪造伤害特征', s => { (s.parent as unknown as { traits: string[] }).traits = ['damage_trait/delivery_basic_attack']; }],
    ['错节拍', s => { s.parent.timeMs = 501; }],
    ['晚激活冒充原相位', s => { s.parent.providerActivatedAtMs = 500; }],
    ['附加tick操作', s => { s.input.sharedProviders![0]!.abilities![0]!.tickSpec!.onTick.push({ operation: 'heal', target: 'self' }); }],
    ['额外状态', s => { s.input.sharedProviders![0]!.initialStateSchema = { hidden: 0 }; }],
    ['伪造使用', s => { s.parent.useRef = 'skill:fake'; }],
    ['伪造命中', s => { s.parent.hitRef = 'hit:fake'; }],
  ];
  it.each(parentMutations)('拒绝永久父包：%s', (_label, mutate) => {
    const s = sample(); mutate(s); const result = inspect(s);
    expect(result.accepts(s.parent)).toBe(false); expect(result.accepts(s.child)).toBe(false);
  });
  const childMutations: Array<[string, (s: ReturnType<typeof sample>) => void]> = [
    ['错施放身份', s => { s.child.castInstanceId++; }],
    ['错拥有者', s => { s.child.owner = 'target'; }],
    ['错监听路径', s => { s.child.operationPath = s.parent.operationPath; }],
    ['非紧邻父包', s => { s.done.damageRecords!.splice(1, 0, { ...s.parent, damageId: 3, operationPath: 'unknown' }); }],
    ['漏父包', s => { s.done.damageRecords!.shift(); }],
    ['父金额不符', s => { s.child.rawAmount = 2; }],
    ['无伤前事实', s => { s.done.evidence.items = []; }],
    ['重复伤前事实', s => { s.done.evidence.items.push(structuredClone(s.done.evidence.items[0]!)); }],
    ['伤前为0', s => { s.done.evidence.items[0]!.data!.beforeValue = 0; }],
    ['漏完整条件', s => { delete s.input.sharedProviders![1]!.abilities![0]!.listenerSpec!.condition; }],
    ['错技能过滤', s => { s.input.sharedProviders![1]!.abilities![0]!.listenerSpec!.eventMatcher.all!.push('ability/skill/other'); }],
    ['混入其它监听事件', s => { s.input.sharedProviders![1]!.abilities![0]!.listenerSpec!.eventMatcher.any = ['event/basic_attack_hit']; }],
    ['POST不是RAW授权', s => { s.input.sharedProviders![1]!.abilities![0]!.listenerSpec!.operations![0]!.amount = { op: 'read', path: 'event.damage.mitigatedAmount' }; }],
    ['偏移量不能冒充比例', s => { s.input.sharedProviders![1]!.abilities![0]!.listenerSpec!.operations![0]!.amount = { op: 'add', args: [{ op: 'read', path: 'event.damage.baseRawAmount' }, { op: 'const', value: 1 }] }; }],
  ];
  it.each(childMutations)('拒绝空使用派生：%s', (_label, mutate) => {
    const s = sample(); mutate(s); expect(inspect(s).accepts(s.child)).toBe(false);
  });
  it('纯连续0刀号RAW也必须保留同次父施放身份', () => {
    const s = sample(false); s.child.castInstanceId++;
    const result = inspect(s); expect(result.requiresProof(s.child)).toBe(true); expect(result.accepts(s.child)).toBe(false);
  });
  it('同刻另一笔真实tick不能成为相同提交或重复首跳', () => {
    const s = sample(), other = { ...s.parent, damageId: 3, castInstanceId: 5 };
    s.done.damageRecords!.push(other);
    const result = inspect(s); expect(result.accepts(other)).toBe(false);
    expect(result.sameCommit(other, s.child)).toBe(false);
  });
  it('截断不给RAW因果证明，零明细仍明确身份缺口', () => {
    const s = sample(); s.done.recording.damageRecordsTruncated = true;
    expect(inspect(s).accepts(s.child)).toBe(false); expect(inspect(s).identityGaps.length).toBe(1);
    s.done.damageRecords = []; expect(inspect(s).identityGaps.length).toBe(1);
  });
  it.each([999999, 1])('父子共同伪造或借用Ci=%s仍不能代替真实已提交事件', ci => {
    const s = sample(); s.parent.castInstanceId = ci; s.child.castInstanceId = ci;
    const result = inspect(s); expect(result.accepts(s.parent)).toBe(false); expect(result.accepts(s.child)).toBe(false);
    expect(result.identityGaps.length).toBeGreaterThan(0);
  });
  it('后一跳父子复用前一跳Ci，不能同时借用实际事件', () => {
    const s = sample();
    const later = { ...s.parent, damageId: 3, timeMs: 1000, castInstanceId: 5 };
    s.done.damageRecords!.push(later);
    s.done.evidence.items.push({ ...s.done.evidence.items[1]!, timeMs: 1000,
      data: { ...s.done.evidence.items[1]!.data!, damageId: 3, castInstanceId: 5 } });
    later.castInstanceId = s.parent.castInstanceId;
    expect(inspect(s).accepts(later)).toBe(false);
  });
  it('即使同步污染两条事件，独立根Ci仍不能复用', () => {
    const s = sample();
    const later = { ...s.parent, damageId: 3, timeMs: 1000 };
    s.done.damageRecords!.push(later);
    s.done.evidence.items.push({ ...s.done.evidence.items[1]!, timeMs: 1000,
      data: { ...s.done.evidence.items[1]!.data!, damageId: 3 } });
    expect(inspect(s).accepts(s.parent)).toBe(false); expect(inspect(s).accepts(later)).toBe(false);
  });
  it('省略可选damageId时仍以完整事件身份唯一闭合；事件省略则留下缺口', () => {
    const s = sample(); delete s.done.evidence.items[1]!.data!.damageId;
    expect(inspect(s).accepts(s.parent)).toBe(true);
    s.done.evidence.items = []; const result = inspect(s);
    expect(result.accepts(s.parent)).toBe(false); expect(result.identityGaps.length).toBe(1);
  });
  it.each(['source', 'target'] as const)('无DI目录及监听的%s旧纯周期仍以真实damage和provider_tick闭合0刀号', owner => {
    const s = bareSample(owner); expect(inspect(s).accepts(s.parent)).toBe(true); expect(inspect(s).identityGaps).toEqual([]);
  });
  it.each(['damage', 'provider_tick'])('旧纯周期缺少%s提交事实不得补造Ci', kind => {
    const s = bareSample(); s.done.evidence.items = s.done.evidence.items.filter(item => item.kind !== kind);
    expect(inspect(s).accepts(s.parent)).toBe(false);
  });
  it('旧纯周期的真实damage证据Ci也不能与记录共同假借', () => {
    const s = bareSample(); s.parent.castInstanceId = 999999;
    expect(inspect(s).accepts(s.parent)).toBe(false);
  });
  it('存在DI目录或监听时不接受仅damage事实绕过V2', () => {
    const s = bareSample(); s.input.typeCatalog.types.push({ key: 'event/damage_instance', domain: 'event' });
    expect(inspect(s).accepts(s.parent)).toBe(false);
    s.input.typeCatalog.types = []; s.input.rules.listeners = [sample().input.sharedProviders![1]!.abilities![0]!.listenerSpec!];
    expect(inspect(s).accepts(s.parent)).toBe(false);
  });
});
