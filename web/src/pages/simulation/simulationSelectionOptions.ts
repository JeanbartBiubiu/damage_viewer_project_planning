import { getLevelConfig, listCharacters } from '../../services/characterClient';
import { getCachedImage, upsertManagedImage } from '../../services/imageCache';
import { getImage } from '../../services/imageClient';
import { getRepresentativeImage } from '../../services/imageRelationClient';
import { getSkill } from '../../services/skillClient';
import { getSkillConfiguration } from '../../services/skillConfigurationClient';
import { listCharacterSkillRelations } from '../../services/skillRelationClient';
import { listEquipment } from '../../services/equipmentClient';
import { getGameCalculationRules, parseGameCalculationRules } from '../../services/gameCalculationRulesClient';
import { listSkillCategories } from '../../services/skillCategoryClient';
import type { SkillConfiguration } from '../../types/skillConfiguration';
import { describeCombatSkill } from './combatSkillRoster';

export type SelectionContext = { apiBaseUrl: string; gameId: string; };
export type SimulationEntityOption = { key: string; name: string } &
  ({ kind: 'character' } | { kind: 'equipment' } | { kind: 'skill'; maxLevel: number });
export type SimulationImageLoader = (option: SimulationEntityOption) => Promise<string | null>;
export type SimulationCharacterSkillOption = SimulationEntityOption & { kind: 'skill'; basicAttack: boolean; combat?: {
  kind: 'basic' | 'active' | 'passive'; configuration: SkillConfiguration;
  targetSide: 'source' | 'target'; hitPreset: 'TARGET_HIT' | null; issue: string | null;
} };

function checkActive(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
}

export async function loadCharacterLevelOptions(context: SelectionContext, signal: AbortSignal): Promise<number[]> {
  const { data } = await getLevelConfig(context.apiBaseUrl, context.gameId, signal);
  checkActive(signal);
  if (!data || data.gameId !== context.gameId || !Number.isInteger(data.minLevel) || !Number.isInteger(data.maxLevel)
    || data.minLevel < 1 || data.maxLevel < data.minLevel || data.maxLevel > 100) {
    throw new Error('角色等级范围响应不合法或不属于当前游戏，请重试。');
  }
  return Array.from({ length: data.maxLevel - data.minLevel + 1 }, (_, index) => data.minLevel + index);
}

export async function loadCharacterOptions(context: SelectionContext, signal: AbortSignal): Promise<SimulationEntityOption[]> {
  const { data } = await listCharacters(context.apiBaseUrl, context.gameId, {}, signal);
  checkActive(signal);
  if (!Array.isArray(data.items) || data.total !== data.items.length
    || data.items.some(row => row.gameId !== context.gameId || !row.characterKey || !row.name?.trim())
    || new Set(data.items.map(row => row.characterKey)).size !== data.items.length) {
    throw new Error('角色列表响应不完整或不属于当前游戏，请重试。');
  }
  return data.items.map(row => ({ key: row.characterKey, name: row.name, kind: 'character' }));
}

export async function loadEquipmentOptions(context: SelectionContext, signal: AbortSignal): Promise<SimulationEntityOption[]> {
  const { data } = await listEquipment(context.apiBaseUrl, context.gameId, {}, signal);
  checkActive(signal);
  if (!Array.isArray(data.items) || data.total !== data.items.length
    || data.items.some(row => row.gameId !== context.gameId || !/^[a-z][a-z0-9_]{0,63}$/.test(row.equipmentKey) || !row.name?.trim())
    || new Set(data.items.map(row => row.equipmentKey)).size !== data.items.length) {
    throw new Error('装备列表响应不完整或不属于当前游戏，请重试。');
  }
  return data.items.map(row => ({ key: row.equipmentKey, name: row.name, kind: 'equipment' }));
}

export async function loadCharacterSkillOptions(
  context: SelectionContext, characterKey: string, signal: AbortSignal, combatMode = false
): Promise<{ items: SimulationCharacterSkillOption[]; notice: string | null }> {
  checkActive(signal);
  const [relationsResponse, rulesResponse, categoryResponse] = await Promise.all([
    listCharacterSkillRelations(context.apiBaseUrl, context.gameId, { characterKey }, signal),
    getGameCalculationRules(context.apiBaseUrl, context.gameId, signal),
    listSkillCategories(context.apiBaseUrl, context.gameId, {}, signal)
  ]);
  checkActive(signal);
  const catalog = categoryResponse.data;
  if (!Array.isArray(catalog.items) || catalog.total !== catalog.items.length
    || new Set(catalog.items.map(row => row.skillCategoryKey)).size !== catalog.items.length) {
    throw new Error('技能分类目录不完整或标识重复，请重试。');
  }
  const rules = parseGameCalculationRules(rulesResponse.data, context.gameId, undefined, catalog.items);
  const basicAttackCategoryKey = rules.configuration?.basicAttackCategoryKey ?? null;
  const data = relationsResponse.data;
  if (!Array.isArray(data.items) || data.total !== data.items.length
    || data.items.some(row => row.gameId !== context.gameId || row.characterKey !== characterKey)
    || new Set(data.items.map(row => row.skillKey)).size !== data.items.length) {
    throw new Error('角色技能挂载列表不完整或不属于当前角色，请重试。');
  }
  const relations = data.items.filter(row => row.skillStatus === 'ENABLED');
  const options: SimulationCharacterSkillOption[] = [];
  // 只读当前角色挂载的技能；详情请求每批最多四个，不读取全游戏技能。
  for (let index = 0; index < relations.length; index += 4) {
    checkActive(signal);
    const skills = await Promise.all(relations.slice(index, index + 4).map(async row => {
      checkActive(signal);
      const configuration = combatMode
        ? (await getSkillConfiguration(context.apiBaseUrl, context.gameId, row.skillKey)).data : null;
      checkActive(signal);
      const skill = configuration?.skill
        ?? (await getSkill(context.apiBaseUrl, context.gameId, row.skillKey, signal)).data;
      checkActive(signal);
      if (skill.gameId !== context.gameId || skill.skillKey !== row.skillKey || !skill.name?.trim()
        || !Array.isArray(skill.skillCategoryKeys) || !['ENABLED', 'DISABLED'].includes(skill.status)
        || !Number.isSafeInteger(skill.maxLevel) || skill.maxLevel < 1) {
        throw new Error('技能详情与当前角色挂载关系不一致，请重试。');
      }
      return { skill, configuration };
    }));
    checkActive(signal);
    for (const { skill, configuration } of skills) {
      if (skill.status === 'ENABLED') {
        const basicAttack = basicAttackCategoryKey !== null && skill.skillCategoryKeys.includes(basicAttackCategoryKey);
        options.push({ key: skill.skillKey, name: skill.name, kind: 'skill', maxLevel: skill.maxLevel,
          basicAttack, ...(configuration ? { combat: describeCombatSkill(configuration, basicAttack) } : {}) });
      }
    }
  }
  return { items: options, notice: basicAttackCategoryKey === null ? '尚未配置普通攻击分类用途绑定。' : null };
}

export async function loadBasicAttackOptions(context: SelectionContext, characterKey: string, signal: AbortSignal): Promise<SimulationEntityOption[]> {
  return (await loadCharacterSkillOptions(context, characterKey, signal)).items.filter(option => option.basicAttack)
    .map(({ basicAttack: _basicAttack, ...option }) => option);
}

export function createSimulationImageLoader(context: SelectionContext, signal: AbortSignal): SimulationImageLoader {
  const entities = new Map<string, Promise<string | null>>();
  const images = new Map<string, Promise<string | null>>();
  const queue: (() => void)[] = [];
  let running = 0;
  const schedule = () => {
    while (running < 4 && queue.length) queue.shift()!();
  };
  const readImage = (imageKey: string): Promise<string | null> => {
    const existing = images.get(imageKey);
    if (existing) return existing;
    const pending = (async () => {
      const cached = await getCachedImage(context.gameId, imageKey).catch(() => null);
      checkActive(signal);
      if (cached?.gameId === context.gameId && cached.imageKey === imageKey) return cached.imageBase64;
      const { data } = await getImage(context.apiBaseUrl, context.gameId, imageKey, signal);
      checkActive(signal);
      if (data.gameId !== context.gameId || data.imageKey !== imageKey || !data.enabled) return null;
      await upsertManagedImage(data).catch(() => undefined);
      checkActive(signal);
      return data.imageBase64;
    })();
    images.set(imageKey, pending);
    return pending;
  };
  return option => {
    if (signal.aborted) return Promise.resolve(null);
    const key = `${option.kind}:${option.key}`;
    const existing = entities.get(key);
    if (existing) return existing;
    const pending = new Promise<string | null>(resolve => {
      queue.push(() => {
        running += 1;
        void (async () => {
          checkActive(signal);
          const { data } = await getRepresentativeImage(context.apiBaseUrl, context.gameId,
            { kind: option.kind, key: option.key, name: option.name }, signal);
          checkActive(signal);
          return data.image?.enabled ? await readImage(data.image.imageKey) : null;
        })().catch(() => null).then(resolve).finally(() => { running -= 1; schedule(); });
      });
      schedule();
    });
    entities.set(key, pending);
    return pending;
  };
}
