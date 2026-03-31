/**
 * Bundle 索引工具
 *
 * 从 GameDataBundle 构建便捷的 Map 索引，供 UI 组件快速查找英雄/装备/技能。
 */

import type { GameDataBundle, Hero, Item, Skill } from '../types/api';
import type { BundleIndex } from './types';

export function buildBundleIndex(bundle: GameDataBundle): BundleIndex {
  const heroes = new Map<string, Hero>();
  for (const h of bundle.heroes) {
    heroes.set(h.heroId, h);
  }

  const items = new Map<string, Item>();
  for (const i of bundle.items) {
    items.set(i.itemId, i);
  }

  const skills = new Map<string, Skill>();
  const heroSkills = new Map<string, Skill[]>();
  for (const s of bundle.skills) {
    skills.set(s.skillId, s);
    if (s.ownerType === 'hero' && s.ownerId) {
      const list = heroSkills.get(s.ownerId) ?? [];
      list.push(s);
      heroSkills.set(s.ownerId, list);
    }
  }

  return {
    gameId: bundle.meta.gameId,
    attributeDefinitions: bundle.attributeDefinitions ?? [],
    heroes,
    items,
    skills,
    heroSkills
  };
}

/**
 * 查找英雄的普攻技能 ID。
 * 优先匹配 skillKey === 'A'，其次匹配 skillId 包含 'basic_attack'。
 */
export function findBasicAttackSkillId(index: BundleIndex, heroId: string): string | undefined {
  const skills = index.heroSkills.get(heroId) ?? [];
  const byKey = skills.find((s) => s.skillKey === 'A');
  if (byKey) return byKey.skillId;
  const byName = skills.find((s) => s.skillId.includes('basic_attack'));
  if (byName) return byName.skillId;
  return skills[0]?.skillId;
}

/**
 * 为英雄构建技能优先级列表（skillId 列表）。
 * 非普攻技能排前，普攻排最后。
 */
export function buildSkillPriorities(index: BundleIndex, heroId: string): string[] {
  const skills = index.heroSkills.get(heroId) ?? [];
  const basicAttackId = findBasicAttackSkillId(index, heroId);
  const nonBasic = skills.filter((s) => s.skillId !== basicAttackId).map((s) => s.skillId);
  const result = [...nonBasic];
  if (basicAttackId) result.push(basicAttackId);
  return result;
}

/**
 * 为英雄构建默认技能等级 Map（skillKey → level）。
 * 普攻(A)默认1级，R默认3级，其他默认5级。
 */
export function buildDefaultSkillLevels(index: BundleIndex, heroId: string): Record<string, number> {
  const skills = index.heroSkills.get(heroId) ?? [];
  const levels: Record<string, number> = {};
  for (const s of skills) {
    const key = s.skillKey ?? s.skillId;
    if (key === 'A') {
      levels[key] = 1;
    } else if (key === 'R') {
      levels[key] = 3;
    } else {
      levels[key] = 5;
    }
  }
  return levels;
}
