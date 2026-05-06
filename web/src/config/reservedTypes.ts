import type { TypeDefinition } from '../types/api';

export const TYPE_ID_RANGES = {
  FIRST_LEVEL_RESERVED_START: 10000,
  SECOND_LEVEL_RESERVED_START: 20000,
  GAME_LOCAL_START: 30000
} as const;

export const RESERVED_TYPE_IDS = {
  ATTRIBUTE_ENTRY_GROUP: TYPE_ID_RANGES.FIRST_LEVEL_RESERVED_START,
  DAMAGE_TYPE_GROUP: TYPE_ID_RANGES.FIRST_LEVEL_RESERVED_START + 1,
  ATTRIBUTE_HERO_PROGRESSION: TYPE_ID_RANGES.SECOND_LEVEL_RESERVED_START,
  ATTRIBUTE_MECHANIC_ONLY: 20001
} as const;

export type ReservedTypeKey = keyof typeof RESERVED_TYPE_IDS;
export type ReservedTypeId = (typeof RESERVED_TYPE_IDS)[ReservedTypeKey];

export type ReservedTypeDefinition = {
  key: ReservedTypeKey;
  reservedTypeId: ReservedTypeId;
  label: string;
  parentReservedTypeId?: ReservedTypeId;
};

export const RESERVED_TYPES: Record<ReservedTypeKey, ReservedTypeDefinition> = {
  ATTRIBUTE_ENTRY_GROUP: {
    key: 'ATTRIBUTE_ENTRY_GROUP',
    reservedTypeId: RESERVED_TYPE_IDS.ATTRIBUTE_ENTRY_GROUP,
    label: '属性录入分组'
  },
  DAMAGE_TYPE_GROUP: {
    key: 'DAMAGE_TYPE_GROUP',
    reservedTypeId: RESERVED_TYPE_IDS.DAMAGE_TYPE_GROUP,
    label: '伤害类型'
  },
  ATTRIBUTE_HERO_PROGRESSION: {
    key: 'ATTRIBUTE_HERO_PROGRESSION',
    reservedTypeId: RESERVED_TYPE_IDS.ATTRIBUTE_HERO_PROGRESSION,
    label: '人物成长属性',
    parentReservedTypeId: RESERVED_TYPE_IDS.ATTRIBUTE_ENTRY_GROUP
  },
  ATTRIBUTE_MECHANIC_ONLY: {
    key: 'ATTRIBUTE_MECHANIC_ONLY',
    reservedTypeId: RESERVED_TYPE_IDS.ATTRIBUTE_MECHANIC_ONLY,
    label: '机制属性',
    parentReservedTypeId: RESERVED_TYPE_IDS.ATTRIBUTE_ENTRY_GROUP
  }
};

export const ATTRIBUTE_ENTRY_RESERVED_TYPE_IDS = [
  RESERVED_TYPE_IDS.ATTRIBUTE_HERO_PROGRESSION,
  RESERVED_TYPE_IDS.ATTRIBUTE_MECHANIC_ONLY
] as const;

export type AttributeEntryReservedTypeId = (typeof ATTRIBUTE_ENTRY_RESERVED_TYPE_IDS)[number];

export function findTypeByReservedTypeId(
  types: TypeDefinition[],
  reservedTypeId: ReservedTypeId
): TypeDefinition | undefined {
  return types.find((type) => type.reservedTypeId === reservedTypeId);
}

export function findTypeIdByReservedTypeId(
  types: TypeDefinition[],
  reservedTypeId: ReservedTypeId
): number | undefined {
  return findTypeByReservedTypeId(types, reservedTypeId)?.typeId;
}

export function resolveTypeIdsByReservedTypeIds(
  types: TypeDefinition[],
  reservedTypeIds: readonly ReservedTypeId[]
): number[] {
  return reservedTypeIds
    .map((reservedTypeId) => findTypeIdByReservedTypeId(types, reservedTypeId))
    .filter((typeId): typeId is number => typeId !== undefined);
}

export function isAttributeEntryReservedTypeId(
  reservedTypeId: number | undefined
): reservedTypeId is AttributeEntryReservedTypeId {
  return ATTRIBUTE_ENTRY_RESERVED_TYPE_IDS.some((current) => current === reservedTypeId);
}

export function getNextGameLocalTypeId(types: TypeDefinition[]): number {
  const maxExistingTypeId = types.reduce((maxTypeId, type) => {
    const typeId = Number(type.typeId);
    if (!Number.isFinite(typeId) || typeId < TYPE_ID_RANGES.GAME_LOCAL_START) {
      return maxTypeId;
    }
    return Math.max(maxTypeId, typeId);
  }, TYPE_ID_RANGES.GAME_LOCAL_START - 1);

  return maxExistingTypeId + 1;
}
