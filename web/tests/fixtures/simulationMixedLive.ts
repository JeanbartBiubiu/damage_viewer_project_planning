import { expect, type APIRequestContext } from '@playwright/test';
import type { SimulationSkillPhase, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { simulationComparisonSelection } from './simulationSnapshotRequests';

export async function readMixedLiveSnapshot(request: APIRequestContext, apiBase: string, hero: string, skills: string[], equipmentKeys: string[] = [],
  options: { sourceLevel?: number; targetLevel?: number; phaseKinds?: Record<string, SimulationSkillPhase[]>; backgroundAttack?: boolean; naturalSkills?: string[] } = {}) {
  const characterKey = `champion_${hero}`;
  const selection = simulationComparisonSelection({ sourceCharacterKey: characterKey, sourceLevel: options.sourceLevel ?? 18,
    targetCharacterKey: 'champion_malphite', targetLevel: options.targetLevel ?? 18, sourceEquipmentKeys: equipmentKeys,
    ...(options.backgroundAttack === false ? { basicAttackSkillKey: null, basicAttackLevel: null } : {}),
    plannedSkills: skills.map(skillKey => ({ origin: { kind: 'CHARACTER', characterKey }, skillKey, skillLevel: 1, phaseKinds: options.phaseKinds?.[skillKey] ?? ['INITIAL'] })),
    sourceSkillSettings: skills.map(skillKey => ({ origin: { kind: 'CHARACTER', characterKey }, skillKey, skillLevel: 1, enabled: true })) });
  const path = `${apiBase}/api/admin/games/lol/simulation-snapshot`;
  const enabledSkills = new Set([...skills, ...(options.naturalSkills ?? []), ...(selection.basicAttackSkillKey ? [selection.basicAttackSkillKey] : [])]);
  for (const side of ['source', 'target'] as const) {
    const relations = await request.get(`${apiBase}/api/admin/games/lol/character-skill-relations?characterKey=${selection[`${side}CharacterKey`]}`);
    expect(relations.status()).toBe(200);
    const related = await relations.json() as { items: Array<{ skillKey: string; skillStatus: string }> };
    selection[`${side}SkillSettings`] = related.items.filter(row => row.skillStatus === 'ENABLED').map(row => ({
      origin: { kind: 'CHARACTER', characterKey: selection[`${side}CharacterKey`] }, skillKey: row.skillKey,
      enabled: side === 'source' && enabledSkills.has(row.skillKey),
      ...(side === 'source' && enabledSkills.has(row.skillKey) ? { skillLevel: 1 } : {})
    }));
  }
  const candidate = await request.post(path, { data: selection });
  expect(candidate.status(), `真实只读计划选择：${candidate.status() === 200 ? '完整读取' : await candidate.text()}`).toBe(200);
  const initial = await candidate.json() as SimulationSnapshot;
  for (const side of ['source', 'target'] as const) selection[`${side}SkillSettings`] = initial[side].skillSources
    .filter(source => source.origin.kind === 'CHARACTER' && source.skillStatus === 'ENABLED').map(source => ({
      origin: source.origin, skillKey: source.skillKey,
      enabled: side === 'source' && enabledSkills.has(source.skillKey),
      ...(side === 'source' && enabledSkills.has(source.skillKey) ? { skillLevel: 1 } : {})
    }));
  const response = await request.post(path, { data: selection });
  expect(response.status(), '显式隔离其它未核定英雄来源，不关闭已选装备来源').toBe(200);
  return await response.json() as SimulationSnapshot;
}
