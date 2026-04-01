import type { JsonObject, TypeRelation, TypeRelationReplaceItem, TypeRelationReplacePayload } from '../../../../types/api';

export function buildTypeRelationReplacePayload(relations: TypeRelationReplaceItem[]): TypeRelationReplacePayload {
  return {
    relations: relations
      .map((relation) => {
        const normalized: TypeRelationReplaceItem = { typeId: relation.typeId };
        if (relation.extend && Object.keys(relation.extend).length > 0) {
          normalized.extend = relation.extend as JsonObject;
        }
        return normalized;
      })
      .sort((left, right) => left.typeId - right.typeId)
  };
}

export function buildTypeRelationReplacePayloadFromIds(typeIds: number[]): TypeRelationReplacePayload {
  return buildTypeRelationReplacePayload(typeIds.map((typeId) => ({ typeId })));
}

export function getRelationsForTarget(
  typeRelations: TypeRelation[],
  targetCategory: string,
  targetId: string
): TypeRelationReplaceItem[] {
  return typeRelations
    .filter((relation) => relation.targetCategory === targetCategory && relation.targetId === targetId)
    .map((relation) => ({
      typeId: relation.typeId,
      extend: relation.extend
    }))
    .sort((left, right) => left.typeId - right.typeId);
}
