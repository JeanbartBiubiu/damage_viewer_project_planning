import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLevelConfig, listCharacters } from '../../services/characterClient';
import { getCachedImage, upsertManagedImage } from '../../services/imageCache';
import { getImage } from '../../services/imageClient';
import { getRepresentativeImage } from '../../services/imageRelationClient';
import { getSkill } from '../../services/skillClient';
import { getSkillConfiguration } from '../../services/skillConfigurationClient';
import { listCharacterSkillRelations } from '../../services/skillRelationClient';
import { listEquipment } from '../../services/equipmentClient';
import { getGameCalculationRules } from '../../services/gameCalculationRulesClient';
import { listSkillCategories } from '../../services/skillCategoryClient';
import { authoredCalculationRules } from '../../../tests/fixtures/simulationCalculationRules';
import { simulationSample } from '../../../tests/fixtures/simulationSnapshot';
import { simulationActiveSample } from '../../../tests/fixtures/simulationActiveSkill';
import { createSimulationImageLoader, loadBasicAttackOptions, loadCharacterSkillOptions, loadCharacterOptions, loadCharacterLevelOptions, loadEquipmentOptions } from './simulationSelectionOptions';

vi.mock('../../services/characterClient');
vi.mock('../../services/imageCache');
vi.mock('../../services/imageClient');
vi.mock('../../services/imageRelationClient');
vi.mock('../../services/skillClient');
vi.mock('../../services/skillConfigurationClient');
vi.mock('../../services/skillRelationClient');
vi.mock('../../services/equipmentClient');
vi.mock('../../services/gameCalculationRulesClient', async original => ({ ...await original<typeof import('../../services/gameCalculationRulesClient')>(), getGameCalculationRules: vi.fn() }));
vi.mock('../../services/skillCategoryClient');

const context = { apiBaseUrl: 'http://example.test', gameId: 'demo', token: 'test-only' };
const entity = { key: 'hero', name: '英雄', kind: 'character' as const };
const result = <T>(data: T) => ({ data, status: 200, etag: null });
const image = {
  gameId: 'demo', imageKey: 'portrait', name: '头像', description: null, enabled: true,
  imageBase64: 'data:image/png;base64,AQID', mimeType: 'image/png' as const,
  byteSize: 3, width: 1, height: 1, createdAt: '', updatedAt: ''
};

describe('模拟选择目录与按需头像', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getGameCalculationRules).mockResolvedValue(result(authoredCalculationRules('demo')));
    const categories = simulationSample().catalogs.skillCategories;
    vi.mocked(listSkillCategories).mockResolvedValue(result({ items: categories, total: categories.length }));
  });

  it('真实装备列表复用现有client，完整保留目录且共用取消信号，不伪装全部可运行', async () => {
    const row = { gameId: 'demo', equipmentKey: 'item_1036', name: '长剑', description: null, createdAt: '', updatedAt: '' };
    const unknown = { ...row, equipmentKey: 'item_unverified', name: '未核定装备' };
    const controller = new AbortController();
    vi.mocked(listEquipment).mockResolvedValue(result({ items: [row, unknown], total: 2 }));
    expect(await loadEquipmentOptions(context, controller.signal)).toEqual([
      { key: 'item_1036', name: '长剑', kind: 'equipment' }, { key: 'item_unverified', name: '未核定装备', kind: 'equipment' }
    ]);
    expect(listEquipment).toHaveBeenCalledWith(context.apiBaseUrl, 'demo', context.token, {}, controller.signal);
    controller.abort();
    await expect(loadEquipmentOptions(context, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('装备列表错游戏、重复、分页缺项或读取失败不当成空装备', async () => {
    const row = { gameId: 'demo', equipmentKey: 'item_1036', name: '长剑', description: null, createdAt: '', updatedAt: '' };
    const signal = new AbortController().signal;
    for (const data of [{ items: [{ ...row, gameId: 'other' }], total: 1 }, { items: [row, row], total: 2 }, { items: [row], total: 2 }]) {
      vi.mocked(listEquipment).mockResolvedValue(result(data));
      await expect(loadEquipmentOptions(context, signal)).rejects.toThrow(/装备列表/);
    }
    vi.mocked(listEquipment).mockRejectedValueOnce(new Error('读取失败'));
    await expect(loadEquipmentOptions(context, signal)).rejects.toThrow('读取失败');
  });

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
    expect(getGameCalculationRules).toHaveBeenCalledWith(context.apiBaseUrl, 'demo', context.token, signal);
    expect(listSkillCategories).toHaveBeenCalledWith(context.apiBaseUrl, 'demo', context.token, {}, signal);
    expect(getSkillConfiguration).not.toHaveBeenCalled();
  });

  it('混合页只读真实完整绑定配置，按作者入口描述主动与被动，不额外读技能详情', async () => {
    const configurations = [simulationSample().skillConfigurations[0]!, simulationActiveSample().skillConfigurations[1]!,
      simulationActiveSample(true).skillConfigurations[1]!];
    const passive = structuredClone(configurations[1]!);
    passive.skill.skillKey = 'actual_passive';
    passive.triggerRules = [];
    configurations[2] = passive;
    const relations = configurations.map((configuration, index) => ({ gameId: 'demo', characterKey: 'hero', characterName: '英雄',
      skillKey: configuration.skill.skillKey, skillName: configuration.skill.name, skillStatus: 'ENABLED' as const, sortOrder: index }));
    vi.mocked(listCharacterSkillRelations).mockResolvedValue(result({ items: relations, total: relations.length }));
    vi.mocked(getSkillConfiguration).mockImplementation(async (_, __, skillKey) => result(configurations.find(row => row.skill.skillKey === skillKey)!));
    const read = await loadCharacterSkillOptions(context, 'hero', new AbortController().signal, true);
    expect(read.items.map(row => row.combat?.kind)).toEqual(['basic', 'active', 'passive']);
    expect(read.items[1]!.combat).toMatchObject({ targetSide: 'target', hitPreset: 'TARGET_HIT', issue: null });
    expect(getSkillConfiguration).toHaveBeenCalledTimes(3);
    expect(getSkill).not.toHaveBeenCalled();
  });

  it('完整配置每批最多4份，取消后迟到配置不接收且不再发下一批', async () => {
    const base = simulationActiveSample().skillConfigurations[1]!;
    const relations = Array.from({ length: 9 }, (_, index) => ({ gameId: 'demo', characterKey: 'hero', characterName: '英雄',
      skillKey: `spell_${index}`, skillName: `技能${index}`, skillStatus: 'ENABLED' as const, sortOrder: index }));
    vi.mocked(listCharacterSkillRelations).mockResolvedValue(result({ items: relations, total: 9 }));
    const release: Array<() => void> = [];
    let concurrent = 0; let peak = 0;
    vi.mocked(getSkillConfiguration).mockImplementation((_, __, skillKey) => new Promise(resolve => {
      concurrent += 1; peak = Math.max(peak, concurrent);
      release.push(() => { concurrent -= 1; resolve(result({ ...base, skill: { ...base.skill, skillKey } })); });
    }));
    const controller = new AbortController();
    const pending = loadCharacterSkillOptions(context, 'hero', controller.signal, true);
    await vi.waitFor(() => expect(getSkillConfiguration).toHaveBeenCalledTimes(4));
    expect(peak).toBe(4);
    controller.abort();
    release.forEach(deliver => deliver());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(getSkillConfiguration).toHaveBeenCalledTimes(4);
    expect(getSkill).not.toHaveBeenCalled();
  });

  it('完整配置失败保持读取错误，不伪装为空技能；错角色关系拒绝读取配置', async () => {
    const relation = { gameId: 'demo', characterKey: 'hero', characterName: '英雄', skillKey: 'spell', skillName: '技能',
      skillStatus: 'ENABLED' as const, sortOrder: 0 };
    vi.mocked(listCharacterSkillRelations).mockResolvedValue(result({ items: [relation], total: 1 }));
    vi.mocked(getSkillConfiguration).mockRejectedValue(new Error('完整配置读取失败'));
    await expect(loadCharacterSkillOptions(context, 'hero', new AbortController().signal, true)).rejects.toThrow('完整配置读取失败');
    vi.mocked(getSkillConfiguration).mockClear();
    vi.mocked(listCharacterSkillRelations).mockResolvedValue(result({ items: [{ ...relation, characterKey: 'previous_hero' }], total: 1 }));
    await expect(loadCharacterSkillOptions(context, 'hero', new AbortController().signal, true)).rejects.toThrow('当前角色');
    expect(getSkillConfiguration).not.toHaveBeenCalled();
  });

  const bindSkill = (categories: string[]) => {
    vi.mocked(listCharacterSkillRelations).mockResolvedValue(result({ items: [{ gameId: 'demo', characterKey: 'hero', characterName: '英雄',
      skillKey: 'attack', skillName: '作者技能', skillStatus: 'ENABLED', sortOrder: 0 }], total: 1 }));
    vi.mocked(getSkill).mockResolvedValue(result({ gameId: 'demo', skillKey: 'attack', name: '作者技能', description: null,
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: categories, createdAt: '', updatedAt: '' }));
  };

  it('真实读取的新分类键识别普攻，旧basic_attack目录不能替代绑定', async () => {
    const rules = authoredCalculationRules('demo'); rules.configuration!.basicAttackCategoryKey = 'chosen_strike';
    vi.mocked(getGameCalculationRules).mockResolvedValue(result(rules));
    vi.mocked(listSkillCategories).mockResolvedValue(result({ items: [{ ...simulationSample().catalogs.skillCategories[0]!, skillCategoryKey: 'chosen_strike' }], total: 1 }));
    bindSkill(['chosen_strike']);
    expect(await loadBasicAttackOptions(context, 'hero', new AbortController().signal)).toHaveLength(1);
    bindSkill(['basic_attack']);
    expect(await loadBasicAttackOptions(context, 'hero', new AbortController().signal)).toEqual([]);
  });

  it.each(['null_configuration', 'null_binding'])('未绑定%s显示明确提示，普攻为空且不阻止未消费分类的主动候选', async kind => {
    const rules = authoredCalculationRules('demo');
    if (kind === 'null_configuration') rules.configuration = null;
    else rules.configuration!.basicAttackCategoryKey = null;
    vi.mocked(getGameCalculationRules).mockResolvedValue(result(rules));
    bindSkill(['active']);
    const read = await loadCharacterSkillOptions(context, 'hero', new AbortController().signal);
    expect(read.notice).toContain('尚未配置普通攻击分类');
    expect(read.items).toMatchObject([{ basicAttack: false, key: 'attack' }]);
    expect(await loadBasicAttackOptions(context, 'hero', new AbortController().signal)).toEqual([]);
  });

  it('计算规则读取失败不回退原分类，不继续使用技能详情', async () => {
    bindSkill(['basic_attack']);
    vi.mocked(getGameCalculationRules).mockRejectedValue(new Error('计算规则读取失败'));
    await expect(loadBasicAttackOptions(context, 'hero', new AbortController().signal)).rejects.toThrow('计算规则读取失败');
    expect(getSkill).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'foreign', 'missing', 'duplicate', 'partial'])('分类目录%s拒绝且不凭旧名恢复候选', async variant => {
    bindSkill(['basic_attack']);
    const category = simulationSample().catalogs.skillCategories[0]!;
    if (variant === 'disabled') category.status = 'DISABLED';
    if (variant === 'foreign') category.gameId = 'other';
    const items = variant === 'missing' ? [] : variant === 'duplicate' ? [category, category] : [category];
    vi.mocked(listSkillCategories).mockResolvedValue(result({ items, total: variant === 'partial' ? 2 : items.length }));
    await expect(loadBasicAttackOptions(context, 'hero', new AbortController().signal)).rejects.toThrow();
    expect(getSkill).not.toHaveBeenCalled();
  });

  it('取消后迟到计算规则和分类目录不能产出候选', async () => {
    bindSkill(['basic_attack']);
    let deliver!: (value: ReturnType<typeof result<ReturnType<typeof authoredCalculationRules>>>) => void;
    vi.mocked(getGameCalculationRules).mockReturnValue(new Promise(resolve => { deliver = resolve; }));
    const controller = new AbortController();
    const pending = loadBasicAttackOptions(context, 'hero', controller.signal);
    controller.abort();
    deliver(result(authoredCalculationRules('demo')));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(getSkill).not.toHaveBeenCalled();
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
