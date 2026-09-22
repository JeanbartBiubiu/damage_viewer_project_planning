import type {
  SkillEffectDamageDeliveryKind,
  SkillEffectDamageOriginKind,
  SkillEffectVampBasisOutputKind,
  SkillEffectVampType
} from './skillEffect';

export const GAME_VAMP_TYPES = ['LIFE_STEAL', 'OMNIVAMP', 'PHYSICAL_VAMP', 'SPELL_VAMP'] as const;
export const GAME_VAMP_TYPE_LABELS = {
  LIFE_STEAL: '生命偷取', OMNIVAMP: '全能吸血', PHYSICAL_VAMP: '物理吸血', SPELL_VAMP: '法术吸血'
} satisfies Record<SkillEffectVampType, string>;
export const GAME_VAMP_BASIS_LABELS = {
  POST_DEFENSE_DAMAGE: '防御结算后伤害', ACTUAL_HP_LOSS: '实际扣血'
} satisfies Record<SkillEffectVampBasisOutputKind, string>;

export type GameVampRule = {
  vampType: SkillEffectVampType;
  sourceAttributeKey: string;
  basisOutputKind: SkillEffectVampBasisOutputKind;
  defaultEfficiency: number;
  deliveryKinds: SkillEffectDamageDeliveryKind[];
  originKinds: SkillEffectDamageOriginKind[];
  skillCategoryKeys: string[];
};

export type GameVampRulesResponse = { rules: GameVampRule[] };

export function sortGameVampRules<T extends { vampType: SkillEffectVampType }>(rules: readonly T[]): T[] {
  return [...rules].sort((left, right) => GAME_VAMP_TYPES.indexOf(left.vampType) - GAME_VAMP_TYPES.indexOf(right.vampType));
}
