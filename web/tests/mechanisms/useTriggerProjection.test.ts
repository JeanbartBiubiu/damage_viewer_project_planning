import { describe, expect, it } from 'vitest';
import type { CompileRequest, DoneResult, RunRequest, UseTriggerLedgerEntry } from '../../src/types/genericEngine';
import { projectUseTriggerLedger } from './useTriggerProjection';

function fixture(scope: 'provider' | 'provider_target' = 'provider_target') {
  const row: UseTriggerLedgerEntry = { owner: 'source', providerRef: 'parent', groupKey: 'quota', scope,
    useSource: 'source', useSkillKey: 'lab_skill', useKey: 'skill:actual', target: scope === 'provider' ? null : 'target' };
  const compile = { combatants: [{ key: 'source', providers: [{ providerRef: 'parent', definitionRef: 'parent_definition' }] },
    { key: 'target', providers: [] }], sharedProviders: [{ providerKey: 'parent_definition', kind: 'character', abilities: [{
      abilityKey: 'hit', skillKey: 'lab_skill', operations: [{ operation: 'resolve_skill_hit', skillHit: { skillKey: 'lab_skill',
        candidates: [{ candidateKey: 'rule:action:result', effectOccurrenceKey: 'rule:action', effectKey: 'effect', resultKey: 'result',
          semantic: { resultType: 'DAMAGE', target: 'TARGET', moment: 'INSTANT' }, spellShieldBlockScope: 'SKILL',
          operations: [{ operation: 'damage', target: 'target', amount: { op: 'const', value: 10 } }] }],
        ruleGroups: [{ ruleKey: 'rule', candidateKeys: ['rule:action:result'], oncePerUse: { groupKey: 'quota', scope } }] } }]
    }] }] } as unknown as CompileRequest;
  const request = { skillUses: [] } as unknown as RunRequest;
  const done = { finalSnapshot: { useTriggerLedger: [row], processInstances: [
    { owner: 'source', useKey: 'skill:actual', skillKey: 'lab_skill' }
  ] } } as unknown as DoneResult;
  return { row, compile, request, done, project: () => projectUseTriggerLedger(compile, request, done) };
}

describe('完整同次使用额度投影', () => {
  it('保留明确0写入后的原生额度事实，provider范围严格保留null，不推算动作效果', () => {
    const target = fixture(), skill = fixture('provider');
    expect(target.project()).toEqual([target.row]);
    expect(skill.project()).toEqual([skill.row]);
  });
  it.each(['owner', 'providerRef', 'groupKey', 'scope', 'useSource', 'useSkillKey', 'useKey', 'target'])('缺失%s不能补身份', key => {
    const f = fixture(); delete (f.row as unknown as Record<string, unknown>)[key]; expect(f.project).toThrow('同次使用额度');
  });
  it('provider范围也必须存在真实null目标字段，不用默认值掩盖缺失', () => {
    const f = fixture('provider'); delete (f.row as unknown as Record<string, unknown>).target; expect(f.project).toThrow();
  });
  it.each(['foreign_mount', 'foreign_group', 'foreign_scope', 'foreign_skill', 'foreign_source', 'missing_use', 'duplicate', 'dynamic_parent'])('拒绝%s', kind => {
    const f = fixture();
    if (kind === 'foreign_mount') f.row.providerRef = 'other';
    if (kind === 'foreign_group') f.row.groupKey = 'other';
    if (kind === 'foreign_scope') { f.row.scope = 'provider'; f.row.target = null; }
    if (kind === 'foreign_skill') f.row.useSkillKey = 'other';
    if (kind === 'foreign_source') f.row.useSource = 'target';
    if (kind === 'missing_use') f.done.finalSnapshot.processInstances = [];
    if (kind === 'duplicate') f.done.finalSnapshot.useTriggerLedger!.push(structuredClone(f.row));
    if (kind === 'dynamic_parent') f.compile.sharedProviders![0]!.kind = 'status';
    expect(f.project).toThrow('同次使用额度');
  });
  it('普通监听和命中组同键时范围仍须一致，不把监听的可用使用范围误套父技能', () => {
    const f = fixture();
    f.compile.sharedProviders![0]!.listeners = [{ listenerKey: 'taken', eventMatcher: { all: ['event/damage_taken'] },
      oncePerUse: { groupKey: 'quota', scope: 'provider_target' }, operations: [] }];
    f.row.useSource = 'target'; f.row.useSkillKey = 'foreign_actual_attacker';
    f.request.skillUses = [{ useKey: f.row.useKey, source: 'target', skillKey: f.row.useSkillKey, historyState: 'complete' }];
    expect(f.project()).toEqual([f.row]);
    f.compile.sharedProviders![0]!.listeners[0]!.oncePerUse!.scope = 'provider';
    expect(f.project).toThrow();
  });
});
