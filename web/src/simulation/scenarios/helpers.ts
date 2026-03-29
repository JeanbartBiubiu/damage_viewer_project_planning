/**
 * 场景模块共享工具
 */

import type {
  CombatantDraft,
  ComparisonRow,
  SimulationDraft,
  SummaryCard,
  VariantResult,
} from '../types';
import type { CombatantInit, CombatantOverride, EngineRunInput } from '../../engine/types';
import type { GameDataBundle } from '../../types/api';
import { buildBundleIndex, findBasicAttackSkillId } from '../bundleIndex';

/**
 * 从 CombatantDraft 构建引擎 CombatantInit。
 */
export function buildCombatantInit(draft: CombatantDraft): CombatantInit {
  return {
    heroId: draft.heroId,
    level: draft.level,
    itemIds: draft.itemIds.length > 0 ? draft.itemIds : undefined,
  };
}

/**
 * 从 CombatantDraft 构建引擎 CombatantOverride（如有属性覆盖）。
 */
export function buildCombatantOverride(draft: CombatantDraft): CombatantOverride | undefined {
  const hasOverrides = Object.keys(draft.statOverrides).length > 0;
  if (!hasOverrides) return undefined;
  return { baseStats: draft.statOverrides };
}

/**
 * 从 SimulationDraft 构建引擎 EngineRunInput 的通用部分。
 * 需要传入 bundle 以便推导 basic_attack 的 skillId。
 */
export function buildBaseRunInput(draft: SimulationDraft, bundle?: GameDataBundle): EngineRunInput {
  // 推导普攻 skillId
  let basicAttackSkillId: string | undefined;
  if (bundle) {
    const idx = buildBundleIndex(bundle);
    basicAttackSkillId = findBasicAttackSkillId(idx, draft.self.heroId);
  }

  return {
    seed: draft.seed,
    stop: { maxSeconds: draft.maxSeconds },
    initial: {
      self: buildCombatantInit(draft.self),
      enemy: buildCombatantInit(draft.enemy),
    },
    overrides: {
      self: buildCombatantOverride(draft.self),
      enemy: buildCombatantOverride(draft.enemy),
    },
    plan: draft.action.type === 'cast_skill'
      ? {
          type: 'cast_skill',
          skillId: draft.action.skillId ?? '',
          castCount: draft.action.castCount,
        }
      : {
          type: 'basic_attack',
          count: draft.action.hitCount ?? 10,
          skillId: draft.action.skillId ?? basicAttackSkillId,
        },
  };
}

/**
 * 从单次运行结果提取标准摘要卡片。
 */
export function buildSummaryCardsFromSingle(vr: VariantResult): SummaryCard[] {
  const r = vr.output.result;
  const cards: SummaryCard[] = [
    { label: '总伤害', value: Math.round(r.totalDamageToEnemy), unit: 'dmg' },
    { label: '命中次数', value: r.executedHits },
    { label: '持续时间', value: `${(r.actionDurationMs / 1000).toFixed(2)}s` },
    { label: 'DPS', value: r.actionDurationMs > 0 ? Math.round(r.totalDamageToEnemy / (r.actionDurationMs / 1000)) : 0, unit: '/s' },
    {
      label: '停止原因',
      value: r.stopReason,
      highlight: r.stopReason === 'enemyDead' ? 'positive' : r.stopReason === 'selfDead' ? 'negative' : 'neutral',
    },
  ];
  if (r.timeToKillEnemyMs != null) {
    cards.push({ label: '击杀耗时', value: `${(r.timeToKillEnemyMs / 1000).toFixed(2)}s`, highlight: 'positive' });
  }
  return cards;
}

/**
 * 从多个变体结果构建对比行。
 */
export function buildComparisonRows(results: VariantResult[]): ComparisonRow[] {
  return results.map((vr) => {
    const r = vr.output.result;
    return {
      variantKey: vr.variant.key,
      variantLabel: vr.variant.label,
      totalDamage: Math.round(r.totalDamageToEnemy),
      dps: r.actionDurationMs > 0 ? Math.round(r.totalDamageToEnemy / (r.actionDurationMs / 1000)) : 0,
      timeToKillMs: r.timeToKillEnemyMs,
      stopReason: r.stopReason,
    };
  });
}
