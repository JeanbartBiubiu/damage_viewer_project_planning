package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatAbilityDefinitionsMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("providerId") Object providerId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("abilityId") Object abilityId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("abilityId") Object abilityId,
        @Param("providerId") Object providerId,
        @Param("abilityKey") Object abilityKey,
        @Param("abilityKindTypeId") Object abilityKindTypeId,
        @Param("displayName") Object displayName,
        @Param("castConditionFormulaKey") Object castConditionFormulaKey
    );

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("previousRevision") long previousRevision,
        @Param("publishRevision") long publishRevision
    );

    int copyChangedToLog(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId,
        @Param("previousRevision") long previousRevision,
        @Param("publishRevision") long publishRevision
    );

}
