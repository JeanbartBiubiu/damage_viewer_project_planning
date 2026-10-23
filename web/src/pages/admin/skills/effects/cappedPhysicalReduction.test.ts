import { describe, expect, it } from 'vitest';
import { cappedPhysicalReductionSample } from '../../../../../tests/fixtures/cappedPhysicalReduction';
import { parseSkillEffect } from '../../../../services/skillEffectClient';
import { cappedReductionRatioIssue } from '../../../../services/cappedPhysicalReductionContract';
import type { SkillParameter } from '../../../../types/skillParameter';
import { skillEffectToDraft, validateSkillEffectDraft, buildCreateSkillEffectRequest, applyResultTypeChange, type EffectFormCatalog } from './effectForm';
import { buildResultReferenceSummary } from './resultReferenceSummary';

function sample() {
  const input = cappedPhysicalReductionSample();
  const catalog: EffectFormCatalog = { parentSkillKey: input.source.skillKey, parentSkillMaxLevel: 5, formulas: [], effects: [],
    skills: [], skillCategories: [], statuses: [], attributes: [], damageTypes: [{ damageTypeKey: 'physics', status: 'ENABLED' }],
    modifierZones: input.snapshot.catalogs.modifierZones };
  return { ...input, catalog };
}
function parameter(values: number[]): SkillParameter {
  const { snapshot, source } = sample();
  return { gameId: snapshot.gameId, skillKey: source.skillKey, parameterKey: 'cap', name: '最大减免比例', valueType: 'DECIMAL',
    valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: Object.fromEntries(values.map((v, i) => [String(i + 1), v])),
    description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
}
describe('物理分支封顶平减作者往返', () => {
  it('真实字段读回、编辑与保存不把比例换为点数或新增默认', () => {
    const { effect, catalog } = sample();
    const result = validateSkillEffectDraft(skillEffectToDraft(parseSkillEffect(effect)), { includeEffectKey: true, catalog });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(buildCreateSkillEffectRequest(result.normalized).results).toEqual(effect.results);
    expect(result.normalized.lifecycle).toEqual(effect.lifecycle);
    const draft = skillEffectToDraft(effect).results[0]!;
    expect(buildResultReferenceSummary(draft).segments.join(' ')).toContain('点');
    expect(buildResultReferenceSummary(draft).segments.join(' ')).toContain('每分支上限');
    expect(applyResultTypeChange(draft, 'NORMAL_SHIELD').maximumReductionRatioValue).toBeNull();
  });
  it('旧结果完全不新增空比例字段', () => {
    const { effect } = sample();
    const old = structuredClone(effect); if (old.results[0]!.resultType !== 'DAMAGE_MODIFIER') throw new Error('fixture');
    delete old.results[0]!.detail.maximumReductionRatioValue;
    expect(parseSkillEffect(old)).toEqual(old);
  });
  it.each([null, { kind: 'FIXED', value: -0.1 }, { kind: 'FIXED', value: 1.1 }, { kind: 'FORMULA', formulaKey: 'cap' },
    { kind: 'FIXED', value: 0.5, fallback: 0 }])('显式非法字段拒绝：%j', value => {
    const { effect } = sample(); Object.assign(effect.results[0]!.detail, { maximumReductionRatioValue: value });
    expect(() => parseSkillEffect(effect)).toThrow('maximumReductionRatioValue');
  });
  it.each(['direction', 'operation', 'target', 'condition', 'scope', 'unknown'] as const)('比例不能夹带于%s形状', field => {
    const { effect } = sample(), r = effect.results[0]!;
    if (r.resultType !== 'DAMAGE_MODIFIER') throw new Error('fixture');
    if (field === 'direction') r.detail.direction = 'DEALT';
    if (field === 'operation') r.detail.operation = 'INCREASE';
    if (field === 'target') r.target = 'TARGET';
    if (field === 'condition') Object.assign(r.detail, { condition: {} });
    if (field === 'scope') r.spellShieldBlockScope = 'RESULT';
    if (field === 'unknown') Object.assign(r.detail, { capPolicy: 'any' });
    expect(() => parseSkillEffect(effect)).toThrow();
  });
  it('参数必须全技能等级完整合法，不只核当前等级', () => {
    const p = parameter([0, 0.25, 0.5, 0.75, 1]);
    expect(cappedReductionRatioIssue({ kind: 'PARAMETER', parameterKey: 'cap' }, [p], p.skillKey, 5, p.gameId)).toBeNull();
    expect(cappedReductionRatioIssue({ kind: 'PARAMETER', parameterKey: 'cap' }, [{ ...p, valueType: 'INTEGER' }], p.skillKey, 5, p.gameId)).not.toBeNull();
    p.levelValues!['1'] = -0.1;
    expect(cappedReductionRatioIssue({ kind: 'PARAMETER', parameterKey: 'cap' }, [p], p.skillKey, 5, p.gameId)).not.toBeNull();
    p.levelValues!['1'] = 0; delete p.levelValues!['3'];
    expect(cappedReductionRatioIssue({ kind: 'PARAMETER', parameterKey: 'cap' }, [p], p.skillKey, 5, p.gameId)).not.toBeNull();
    p.valueMode = 'RUNTIME_INPUT'; p.levelValues = null;
    expect(cappedReductionRatioIssue({ kind: 'PARAMETER', parameterKey: 'cap' }, [p], p.skillKey, 5, p.gameId)).not.toBeNull();
  });
  it('新平加区缺比例/错区保存失败，显式0与1均可', () => {
    const { effect, catalog } = sample(), draft = skillEffectToDraft(effect);
    draft.results[0]!.maximumReductionRatioValue = null;
    expect(validateSkillEffectDraft(draft, { includeEffectKey: true, catalog }).ok).toBe(false);
    for (const value of [0, 1]) {
      draft.results[0]!.maximumReductionRatioValue = { kind: 'FIXED', value };
      expect(validateSkillEffectDraft(draft, { includeEffectKey: true, catalog }).ok).toBe(true);
    }
    catalog.modifierZones = catalog.modifierZones!.map(z => ({ ...z, calculationMode: 'RATIO_ADD' }));
    expect(validateSkillEffectDraft(draft, { includeEffectKey: true, catalog }).ok).toBe(false);
  });
});
