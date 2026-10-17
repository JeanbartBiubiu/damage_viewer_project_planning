import { describe, expect, it } from 'vitest';
import type { SimulationAvailabilityEntry, SimulationAvailabilityResponse } from '../../types/simulationAvailability';
import { SIMULATION_AVAILABILITY_IDENTITY } from '../../services/simulationAvailabilityClient';
import {
  applySimulationAvailability, selectedSimulationAvailabilityIssues, type SimulationAvailabilitySelection, type SimulationEntityOption
} from './simulationSelectionOptions';

const ready = (key: string, equipment = false): SimulationAvailabilityEntry => ({ key, status: 'READY', contentDigest: 'a'.repeat(64), issues: [], excludedSkillSources: [],
  verification: { ...SIMULATION_AVAILABILITY_IDENTITY, externalDigest: 'b'.repeat(64), matched: true, evidenceRefs: ['real-run'],
    requiredCoverage: { scenario: 'one-way-combat-analysis-v1', sides: ['source', 'target'], characterLevels: [1, 2, 3], skills: [],
      levelValidation: 'each-declared-level', allRequiredSourcesEnabled: true, sourceActiveStartedAndCompleted: true,
      relevantPassivesTriggered: true, equipmentMode: equipment ? 'single-item' : 'none' } } });
const pending = (key: string, equipment = false): SimulationAvailabilityEntry => ({ ...ready(key, equipment), status: 'CONFIGURATION_INCOMPLETE',
  issues: [{ code: 'MISSING_PROGRAM', skillKey: 'actual_passive', fieldPath: 'triggerRules', message: '尚未补齐全部自然技能程序' },
    { code: 'MISSING_RELATION', skillKey: 'actual_active', fieldPath: 'attachedSkills', message: '缺少必要技能绑定' }],
  verification: { ...ready(key, equipment).verification, matched: false, evidenceRefs: [] } });
const directory = (): SimulationAvailabilityResponse => ({ gameId: 'demo', profile: 'combat-analysis-v1', digestVersion: 'simulation-availability-v1',
  scopeDigest: 'c'.repeat(64), sharedDigest: 'd'.repeat(64), characters: [ready('hero'), pending('unfinished')],
  equipment: [ready('item', true), pending('unfinished_item', true)] });
const options: SimulationEntityOption[] = [{ key: 'hero', name: '完整英雄', kind: 'character' },
  { key: 'unfinished', name: '待补英雄', kind: 'character' }, { key: 'unknown', name: '目录之外', kind: 'character' },
  { key: 'item', name: '完整装备', kind: 'equipment' }, { key: 'unfinished_item', name: '待补装备', kind: 'equipment' }];
const selection = (): SimulationAvailabilitySelection => ({ sourceCharacterKey: 'hero', targetCharacterKey: 'hero', sourceLevel: 2, targetLevel: 3,
  sourceEquipmentKeys: ['item'], targetEquipmentKeys: ['item'] });

describe('混合战斗可用目录与实际选择核对', () => {
  it('只开放READY并保留未准备项名称、标识、首个原因及全部问题', () => {
    const decorated = applySimulationAvailability(options, directory());
    expect(decorated.map(row => [row.key, row.disabled])).toEqual([
      ['hero', false], ['unfinished', true], ['unknown', true], ['item', false], ['unfinished_item', true]
    ]);
    expect(decorated[1]).toMatchObject({ name: '待补英雄', unavailableReason: '配置未完整：尚未补齐全部自然技能程序' });
    expect(decorated[1]!.unavailableDetails).toContain('actual_passive');
    expect(decorated[1]!.unavailableDetails).toContain('缺少必要技能绑定');
    expect(decorated[2]!.unavailableReason).toContain('缺少完整计算证明');
    expect(options.every(row => !Object.hasOwn(row, 'disabled'))).toBe(true);
  });

  it('目录加载、读取失败和缺失条目都禁选，旧角色资料不会获得READY', () => {
    expect(applySimulationAvailability(options, null, '目录读取失败').every(row => row.disabled)).toBe(true);
    expect(applySimulationAvailability(options, null, '目录读取失败')[0]!.unavailableReason).toBe('目录读取失败');
    expect(applySimulationAvailability(options, { ...directory(), characters: [], equipment: [] }).every(row => row.disabled)).toBe(true);
    const prior = applySimulationAvailability(options, directory());
    expect(applySimulationAvailability(prior, null).every(row => row.disabled)).toBe(true);
  });

  it('重新核对只更新可用状态，不改技能、角色、装备或已有选择草稿', () => {
    const draft = { ...selection(), targetCharacterKey: 'unfinished', targetEquipmentKeys: ['unfinished_item'] };
    const frozen = structuredClone(draft);
    const skill: SimulationEntityOption = { key: 'actual_skill', name: '技能', kind: 'skill', maxLevel: 5 };
    expect(applySimulationAvailability([skill], null)[0]).toBe(skill);
    const response = directory();
    response.characters[0] = pending('hero');
    expect(applySimulationAvailability(options, response)[0]!.disabled).toBe(true);
    expect(selectedSimulationAvailabilityIssues(response, draft)).toHaveLength(3);
    expect(draft).toEqual(frozen);
  });

  it.each(['ENGINE_UNSUPPORTED', 'UNVERIFIED', 'OUT_OF_SCOPE'] as const)('%s保留原因，不能凭有程序或旧证据放行', status => {
    const response = directory();
    response.characters[0]!.status = status;
    response.characters[0]!.issues = [];
    const decorated = applySimulationAvailability(options, response)[0]!;
    expect(decorated.disabled).toBe(true);
    expect(decorated.unavailableReason).toBeTruthy();
    expect(selectedSimulationAvailabilityIssues(response, selection())).toHaveLength(2);
  });

  it('两侧同英雄及同装备允许，只要各对象和实际等级都有当前证明', () => {
    expect(selectedSimulationAvailabilityIssues(directory(), selection())).toEqual([]);
    const noEquipment = { ...selection(), sourceEquipmentKeys: [], targetEquipmentKeys: [] };
    expect(selectedSimulationAvailabilityIssues(directory(), noEquipment)).toEqual([]);
  });

  it('缺目录、缺角色、缺装备和未就绪分别显示具体中文原因', () => {
    expect(selectedSimulationAvailabilityIssues(null, selection())).toEqual(['计算可用性目录尚未读取成功，暂不能准备或运行，请重试。']);
    expect(selectedSimulationAvailabilityIssues(directory(), { ...selection(), sourceCharacterKey: '', targetCharacterKey: 'unknown',
      sourceEquipmentKeys: ['missing'], targetEquipmentKeys: ['unfinished_item'] })).toEqual([
      '请先选择攻击方角色。', '攻击方装备「missing」缺少完整计算证明。', '目标方角色「unknown」缺少完整计算证明。',
      '目标方装备「unfinished_item」配置未完整：尚未补齐全部自然技能程序。'
    ]);
  });

  it('覆盖外等级不放行，装备的等级覆盖也独立核对', () => {
    const response = directory();
    response.equipment[0]!.verification.requiredCoverage!.characterLevels = [1, 2];
    expect(selectedSimulationAvailabilityIssues(response, { ...selection(), sourceLevel: 4 })).toEqual([
      '攻击方角色「hero」的 4 级尚未得到完整计算核验。', '攻击方装备「item」在角色 4 级时尚未得到完整计算核验。',
      '目标方装备「item」在角色 3 级时尚未得到完整计算核验。'
    ]);
  });

  it('同侧重复装备拒绝且同一缺口只展示一次', () => {
    expect(selectedSimulationAvailabilityIssues(directory(), { ...selection(), sourceEquipmentKeys: ['missing', 'missing'] })).toEqual([
      '攻击方装备不能重复选择。', '攻击方装备「missing」缺少完整计算证明。'
    ]);
  });

  it('只有明确排除来源必须显式关闭，同名装备或另一角色设置不能代替', () => {
    const response = directory();
    response.characters[0]!.excludedSkillSources = [{ skillKey: 'outside', reason: '只作用另一名友方英雄，本场为一对一。' }];
    const draft = selection();
    expect(selectedSimulationAvailabilityIssues(response, draft)).toHaveLength(2);
    draft.sourceSkillSettings = [{ origin: { kind: 'EQUIPMENT', equipmentKey: 'item' }, skillKey: 'outside', enabled: false }];
    expect(selectedSimulationAvailabilityIssues(response, draft)).toHaveLength(2);
    draft.sourceSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: 'hero' }, skillKey: 'outside', enabled: false });
    draft.targetSkillSettings = [{ origin: { kind: 'CHARACTER', characterKey: 'hero' }, skillKey: 'outside', enabled: false }];
    expect(selectedSimulationAvailabilityIssues(response, draft)).toEqual([]);
    draft.sourceSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: 'hero' }, skillKey: 'required', enabled: true });
    expect(selectedSimulationAvailabilityIssues(response, draft)).toEqual([]);
    expect(draft.sourceSkillSettings.at(-1)!.enabled).toBe(true);
  });
});
