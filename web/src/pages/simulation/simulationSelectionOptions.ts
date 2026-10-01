import { listCharacters } from '../../services/characterClient';
import { getCachedImage, upsertManagedImage } from '../../services/imageCache';
import { getImage } from '../../services/imageClient';
import { getRepresentativeImage } from '../../services/imageRelationClient';
import { getSkill } from '../../services/skillClient';
import { listCharacterSkillRelations } from '../../services/skillRelationClient';

export type SelectionContext = { apiBaseUrl: string; gameId: string; token: string };
export type SimulationEntityOption = { key: string; name: string; kind: 'character' | 'skill' };
export type SimulationImageLoader = (option: SimulationEntityOption) => Promise<string | null>;

function checkActive(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
}

export async function loadCharacterOptions(context: SelectionContext, signal: AbortSignal): Promise<SimulationEntityOption[]> {
  const { data } = await listCharacters(context.apiBaseUrl, context.gameId, context.token, {}, signal);
  checkActive(signal);
  if (!Array.isArray(data.items) || data.total !== data.items.length
    || data.items.some(row => row.gameId !== context.gameId || !row.characterKey || !row.name?.trim())
    || new Set(data.items.map(row => row.characterKey)).size !== data.items.length) {
    throw new Error('角色列表响应不完整或不属于当前游戏，请重试。');
  }
  return data.items.map(row => ({ key: row.characterKey, name: row.name, kind: 'character' }));
}

export async function loadBasicAttackOptions(
  context: SelectionContext, characterKey: string, signal: AbortSignal
): Promise<SimulationEntityOption[]> {
  const { data } = await listCharacterSkillRelations(context.apiBaseUrl, context.gameId, context.token, { characterKey }, signal);
  checkActive(signal);
  const relations = data.items.filter(row => row.skillStatus === 'ENABLED');
  const options: SimulationEntityOption[] = [];
  // 只读攻击方挂载的技能；详情请求每批最多四个，不读取全游戏技能。
  for (let index = 0; index < relations.length; index += 4) {
    checkActive(signal);
    const skills = await Promise.all(relations.slice(index, index + 4).map(async row => {
      const result = await getSkill(context.apiBaseUrl, context.gameId, row.skillKey, context.token, signal);
      const skill = result.data;
      if (skill.gameId !== context.gameId || skill.skillKey !== row.skillKey || !skill.name?.trim()
        || !Array.isArray(skill.skillCategoryKeys) || !['ENABLED', 'DISABLED'].includes(skill.status)) {
        throw new Error('技能详情与当前角色挂载关系不一致，请重试。');
      }
      return skill;
    }));
    checkActive(signal);
    for (const skill of skills) {
      if (skill.status === 'ENABLED' && skill.skillCategoryKeys.includes('basic_attack')) {
        options.push({ key: skill.skillKey, name: skill.name, kind: 'skill' });
      }
    }
  }
  return options;
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
      const { data } = await getImage(context.apiBaseUrl, context.gameId, imageKey, context.token, signal);
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
            { kind: option.kind, key: option.key, name: option.name }, context.token, signal);
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
