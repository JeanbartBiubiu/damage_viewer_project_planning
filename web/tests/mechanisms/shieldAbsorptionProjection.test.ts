import { describe, expect, it } from 'vitest';
import type { CompileRequest, DoneResult, RunRequest } from '../../src/types/genericEngine';
import { projectShieldAbsorptions, projectShieldWaits } from './shieldAbsorptionProjection';

function sample(absorbed = 20) {
  const compile = { combatants: [{ key: 'target', providers: [{ providerRef: 'actual_parent', definitionRef: 'ward' }] }], sharedProviders: [
    { providerKey: 'ward', kind: 'character', initialStateSchema: { wait: { valueType: 'INTEGER', defaultValue: 0,
      onExpire: [{ operation: 'shield', target: 'self' }] } }, listeners: [{ condition: {
      op: 'read', path: 'event.damage.linked_shield[ward_shield].absorbed'
    } }] },
    { providerKey: 'ward_link', linkedShieldDefinitionRef: 'ward_shield' }
  ] } as unknown as CompileRequest;
  const row = { shieldRef: 'actual_shield', definitionRef: 'ward_shield', lifecycleProviderRef: 'actual_link',
    source: 'target', owner: 'target', remainingBefore: 100, remainingAfter: 100 - absorbed, absorbed };
  const event = { timeMs: 0, kind: 'emitted_event', ref: 'event/damage_taken', data: {
    damageId: 1, source: 'source', target: 'target', operationRef: 'actual_hit', useRef: 'attack_one',
    shieldAbsorbed: absorbed, actualHpLoss: 20 - absorbed, shieldAbsorptions: absorbed > 0 ? [row] : []
  } };
  const done = {
    evidence: { truncated: false, items: [
      { timeMs: 0, kind: 'provider_apply', data: { providerRef: 'actual_link', definitionRef: 'ward_link', source: 'target', owner: 'target' } },
      event
    ] },
    damageRecords: [{ damageId: 1, timeMs: 0, source: 'source', target: 'target', operationRef: 'actual_hit', useRef: 'attack_one',
      shieldAbsorbed: absorbed, actualHpLoss: 20 - absorbed }],
    recording: { damageRecordsTruncated: false },
    finalSnapshot: { timeMs: 1001, combatants: [{ key: 'target', providers: [
      { providerRef: 'actual_parent', definitionRef: 'ward', owner: 'target', source: 'target' }
    ], providerState: { actual_parent: { state: { wait: 1 }, expireAt: { wait: 2500 } } } }] }
  } as unknown as DoneResult;
  const request = { initialSnapshot: { combatants: [] } } as unknown as RunRequest;
  return { compile, done, request, row, event };
}

describe('逐盾事实投影不补造受伤或关联身份', () => {
  it('盾即使已耗尽移除也依据原创建事实，保留完整行和原伤害身份', () => {
    const { compile, request, done, row } = sample();
    expect(projectShieldAbsorptions(compile, request, done)).toEqual([
      { ...row, timeMs: 0, damageId: 1, damageSource: 'source', damageTarget: 'target' }
    ]);
    expect(projectShieldWaits(compile, done)).toEqual([
      { owner: 'target', source: 'target', definitionRef: 'ward', stateKey: 'wait', value: 1, expireAt: 2500 }
    ]);
  });
  it('明确采集的空列表代表真实零吸收，缺列表仍拒绝', () => {
    const { compile, request, done, event } = sample(0);
    expect(projectShieldAbsorptions(compile, request, done)).toEqual([]);
    delete (event.data as Record<string, unknown>).shieldAbsorptions;
    expect(() => projectShieldAbsorptions(compile, request, done)).toThrow(/采集完成/);
  });
  it.each(['damage_id', 'damage_source', 'owner', 'missing_identity', 'wrong_link', 'wrong_amount', 'total', 'duplicate', 'truncated', 'records_truncated'])(
    '拒绝不一致的原始事实 %s', variant => {
      const { compile, request, done, event, row } = sample();
      if (variant === 'damage_id') event.data.damageId = 9;
      if (variant === 'damage_source') event.data.source = 'target';
      if (variant === 'owner') row.owner = 'source';
      if (variant === 'missing_identity') delete (row as Record<string, unknown>).shieldRef;
      if (variant === 'wrong_link') row.lifecycleProviderRef = 'other_link';
      if (variant === 'wrong_amount') row.remainingAfter = 90;
      if (variant === 'total') event.data.shieldAbsorbed = 30;
      if (variant === 'duplicate') event.data.shieldAbsorptions.push({ ...row });
      if (variant === 'truncated') done.evidence.truncated = true;
      if (variant === 'records_truncated') done.recording!.damageRecordsTruncated = true;
      expect(() => projectShieldAbsorptions(compile, request, done)).toThrow(/shieldAbsorptions/);
    }
  );
  it('无新读会话不接受新增采集字段，旧输出可保持原形状', () => {
    const { done, request } = sample();
    expect(() => projectShieldAbsorptions({} as CompileRequest, request, done)).toThrow(/没有新读取/);
    done.evidence.items = [];
    expect(projectShieldAbsorptions({} as CompileRequest, request, done)).toEqual([]);
    expect(projectShieldWaits({} as CompileRequest, done)).toEqual([]);
  });
  it('等待值、期限与真实状态包必须一致，不能补0或采用最终活跃盾推测', () => {
    const { compile, done } = sample();
    const actor = done.finalSnapshot.combatants[0]!;
    const bag = actor.providerState.actual_parent as { state: { wait?: number }; expireAt: { wait?: number } };
    bag.state.wait = 0; bag.expireAt = {};
    expect(projectShieldWaits(compile, done)[0]).toMatchObject({ value: 0, expireAt: null });
    bag.state.wait = 1;
    expect(() => projectShieldWaits(compile, done)).toThrow(/等待值/);
    delete bag.state.wait;
    expect(() => projectShieldWaits(compile, done)).toThrow(/有限非负/);
  });
  it('不能把等待父引用及其状态包一起换成同定义的外来挂载', () => {
    const { compile, done } = sample();
    const actor = done.finalSnapshot.combatants[0]!;
    actor.providers[0]!.providerRef = 'foreign_parent';
    actor.providerState.foreign_parent = actor.providerState.actual_parent;
    delete actor.providerState.actual_parent;
    expect(() => projectShieldWaits(compile, done)).toThrow(/实际静态父挂载/);
  });
  it('本笔之前已失效的盾拒绝，本笔同刻耗尽后的冻结事实仍合法', () => {
    const { compile, request, done, event } = sample();
    event.timeMs = 100; done.damageRecords![0]!.timeMs = 100;
    const ended = { timeMs: 50, kind: 'provider_expire', ref: 'actual_link', data: { providerRef: 'actual_link' } };
    done.evidence.items.push(ended);
    expect(() => projectShieldAbsorptions(compile, request, done)).toThrow(/伤害之前已经失效/);
    ended.timeMs = 100;
    expect(projectShieldAbsorptions(compile, request, done)).toHaveLength(1);
  });
});
