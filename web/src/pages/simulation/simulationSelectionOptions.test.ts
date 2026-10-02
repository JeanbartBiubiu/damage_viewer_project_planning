import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLevelConfig, listCharacters } from '../../services/characterClient';
import { getCachedImage, upsertManagedImage } from '../../services/imageCache';
import { getImage } from '../../services/imageClient';
import { getRepresentativeImage } from '../../services/imageRelationClient';
import { getSkill } from '../../services/skillClient';
import { listCharacterSkillRelations } from '../../services/skillRelationClient';
import { createSimulationImageLoader, loadBasicAttackOptions, loadCharacterOptions, loadCharacterLevelOptions } from './simulationSelectionOptions';

vi.mock('../../services/characterClient');
vi.mock('../../services/imageCache');
vi.mock('../../services/imageClient');
vi.mock('../../services/imageRelationClient');
vi.mock('../../services/skillClient');
vi.mock('../../services/skillRelationClient');

const context = { apiBaseUrl: 'http://example.test', gameId: 'demo', token: 'test-only' };
const entity = { key: 'hero', name: '英雄', kind: 'character' as const };
const result = <T>(data: T) => ({ data, status: 200, etag: null });
const image = {
  gameId: 'demo', imageKey: 'portrait', name: '头像', description: null, enabled: true,
  imageBase64: 'data:image/png;base64,AQID', mimeType: 'image/png' as const,
  byteSize: 3, width: 1, height: 1, createdAt: '', updatedAt: ''
};

describe('模拟选择目录与按需头像', () => {
  beforeEach(() => vi.resetAllMocks());

  it('角色等级按游戏实际上下限生成，读取只进行一次并传递取消信号', async () => {
    const signal = new AbortController().signal;
    vi.mocked(getLevelConfig).mockResolvedValue(result({ gameId: 'demo', minLevel: 2, maxLevel: 4 }));
    expect(await loadCharacterLevelOptions(context, signal)).toEqual([2, 3, 4]);
    expect(getLevelConfig).toHaveBeenCalledOnce();
    expect(getLevelConfig).toHaveBeenCalledWith(context.apiBaseUrl, 'demo', context.token, signal);
  });

  it('等级范围失败、非法或属于旧游戏时不猜1到18，取消后不接受返回', async () => {
    const controller = new AbortController();
    for (const row of [
      { gameId: 'other', minLevel: 1, maxLevel: 18 },
      { gameId: 'demo', minLevel: 0, maxLevel: 18 },
      { gameId: 'demo', minLevel: 3, maxLevel: 2 },
      { gameId: 'demo', minLevel: 1, maxLevel: 101 },
      { gameId: 'demo', minLevel: 1, maxLevel: 1.5 }
    ]) {
      vi.mocked(getLevelConfig).mockResolvedValue(result(row));
      await expect(loadCharacterLevelOptions(context, controller.signal)).rejects.toThrow('等级范围');
    }
    vi.mocked(getLevelConfig).mockRejectedValueOnce(new Error('读取失败'));
    await expect(loadCharacterLevelOptions(context, controller.signal)).rejects.toThrow('读取失败');
    vi.mocked(getLevelConfig).mockResolvedValue(result({ gameId: 'demo', minLevel: 1, maxLevel: 18 }));
    controller.abort();
    await expect(loadCharacterLevelOptions(context, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('角色列表保留名称和标识，拒绝其他游戏或重复项', async () => {
    const row = { gameId: 'demo', characterKey: 'hero', name: '英雄', description: null, createdAt: '', updatedAt: '' };
    const signal = new AbortController().signal;
    vi.mocked(listCharacters).mockResolvedValue(result({ items: [row], total: 1 }));
    expect(await loadCharacterOptions(context, signal)).toEqual([entity]);
    expect(listCharacters).toHaveBeenCalledWith(context.apiBaseUrl, 'demo', context.token, {}, signal);
    vi.mocked(listCharacters).mockResolvedValue(result({ items: [{ ...row, gameId: 'other' }], total: 1 }));
    await expect(loadCharacterOptions(context, signal)).rejects.toThrow('当前游戏');
    vi.mocked(listCharacters).mockResolvedValue(result({ items: [row, row], total: 2 }));
    await expect(loadCharacterOptions(context, signal)).rejects.toThrow('角色列表');
  });

  it('只读取已挂载且启用的技能详情，只留下普攻分类', async () => {
    const signal = new AbortController().signal;
    const relations = ['attack', 'spell', 'disabled'].map((skillKey, index) => ({
      gameId: 'demo', characterKey: 'hero', characterName: '英雄', skillKey, skillName: skillKey,
      skillStatus: index === 2 ? 'DISABLED' as const : 'ENABLED' as const, sortOrder: index
    }));
    vi.mocked(listCharacterSkillRelations).mockResolvedValue(result({ items: relations, total: 3 }));
    vi.mocked(getSkill).mockImplementation(async (_, gameId, skillKey) => result({
      gameId, skillKey, name: skillKey, description: null, maxLevel: 1, status: 'ENABLED', sortOrder: 0,
      skillCategoryKeys: [skillKey === 'attack' ? 'basic_attack' : 'active'], createdAt: '', updatedAt: ''
    }));
    expect(await loadBasicAttackOptions(context, 'hero', signal)).toEqual([{ key: 'attack', name: 'attack', kind: 'skill', maxLevel: 1 }]);
    expect(listCharacterSkillRelations).toHaveBeenCalledWith(context.apiBaseUrl, 'demo', context.token, { characterKey: 'hero' }, signal);
    expect(getSkill).toHaveBeenCalledTimes(2);
    expect(getSkill).toHaveBeenCalledWith(context.apiBaseUrl, 'demo', 'attack', context.token, signal);
  });

  it('技能详情失败不伪装成空列表', async () => {
    vi.mocked(listCharacterSkillRelations).mockRejectedValue(new Error('读取失败'));
    await expect(loadBasicAttackOptions(context, 'hero', new AbortController().signal)).rejects.toThrow('读取失败');
  });

  it('技能最高等级非法时拒绝目录，不退回默认1级', async () => {
    vi.mocked(listCharacterSkillRelations).mockResolvedValue(result({ items: [{
      gameId: 'demo', characterKey: 'hero', characterName: '英雄', skillKey: 'attack', skillName: '普攻',
      skillStatus: 'ENABLED', sortOrder: 0
    }], total: 1 }));
    for (const maxLevel of [0, 1.5, NaN]) {
      vi.mocked(getSkill).mockResolvedValue(result({ gameId: 'demo', skillKey: 'attack', name: '普攻',
        description: null, maxLevel, status: 'ENABLED', sortOrder: 0,
        skillCategoryKeys: ['basic_attack'], createdAt: '', updatedAt: '' }));
      await expect(loadBasicAttackOptions(context, 'hero', new AbortController().signal)).rejects.toThrow('技能详情');
    }
  });

  it('两边共用同一角色头像请求，缓存命中不下载图片', async () => {
    const signal = new AbortController().signal;
    vi.mocked(getRepresentativeImage).mockResolvedValue(result({ image: { imageKey: 'portrait', name: '头像', enabled: true } }));
    vi.mocked(getCachedImage).mockResolvedValue({ cacheKey: 'demo:portrait', gameId: 'demo', imageKey: 'portrait',
      enabled: true, imageBase64: image.imageBase64, updatedAt: '' });
    const load = createSimulationImageLoader(context, signal);
    expect(await Promise.all([load(entity), load(entity)])).toEqual([image.imageBase64, image.imageBase64]);
    expect(getRepresentativeImage).toHaveBeenCalledTimes(1);
    expect(getImage).not.toHaveBeenCalled();
  });

  it('缓存缺图只下载一张，缓存不可用不影响显示', async () => {
    const signal = new AbortController().signal;
    vi.mocked(getRepresentativeImage).mockResolvedValue(result({ image: { imageKey: 'portrait', name: '头像', enabled: true } }));
    vi.mocked(getCachedImage).mockRejectedValue(new Error('缓存不可用'));
    vi.mocked(getImage).mockResolvedValue(result(image));
    vi.mocked(upsertManagedImage).mockRejectedValue(new Error('缓存不可用'));
    expect(await createSimulationImageLoader(context, signal)(entity)).toBe(image.imageBase64);
    expect(getImage).toHaveBeenCalledWith(context.apiBaseUrl, 'demo', 'portrait', context.token, signal);
  });

  it('缺少头像、停用头像和读取失败均退为占位，不抛出页面错误', async () => {
    const signal = new AbortController().signal;
    vi.mocked(getRepresentativeImage).mockResolvedValueOnce(result({ image: null }))
      .mockResolvedValueOnce(result({ image: { imageKey: 'portrait', name: '头像', enabled: false } }))
      .mockRejectedValueOnce(new Error('读取失败'));
    const load = createSimulationImageLoader(context, signal);
    for (const key of ['missing', 'disabled', 'failed']) expect(await load({ ...entity, key })).toBeNull();
    expect(getImage).not.toHaveBeenCalled();
  });

  it('取消上下文后不请求头像，也不接受其他游戏的图片', async () => {
    const controller = new AbortController();
    const load = createSimulationImageLoader(context, controller.signal);
    controller.abort();
    expect(await load(entity)).toBeNull();
    expect(getRepresentativeImage).not.toHaveBeenCalled();
    vi.mocked(getRepresentativeImage).mockResolvedValue(result({ image: { imageKey: 'portrait', name: '头像', enabled: true } }));
    vi.mocked(getCachedImage).mockResolvedValue(null);
    vi.mocked(getImage).mockResolvedValue(result({ ...image, gameId: 'other' }));
    expect(await createSimulationImageLoader(context, new AbortController().signal)(entity)).toBeNull();
    expect(upsertManagedImage).not.toHaveBeenCalled();
  });
});
