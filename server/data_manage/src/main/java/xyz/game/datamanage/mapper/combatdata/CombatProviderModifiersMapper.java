package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatProviderModifiersMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("providerId") Object providerId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("modifierId") Object modifierId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("modifierId") Object modifierId,
        @Param("providerId") Object providerId,
        @Param("modifierKey") Object modifierKey,
        @Param("modifierTypeId") Object modifierTypeId,
        @Param("targetSelectorTypeId") Object targetSelectorTypeId,
        @Param("targetAttrKey") Object targetAttrKey,
        @Param("commandTypeId") Object commandTypeId,
        @Param("channelTypeId") Object channelTypeId,
        @Param("bucketTypeId") Object bucketTypeId,
        @Param("stageTypeId") Object stageTypeId,
        @Param("priority") Object priority,
        @Param("valuePolicyTypeId") Object valuePolicyTypeId,
        @Param("valueFormulaKey") Object valueFormulaKey,
        @Param("conditionFormulaKey") Object conditionFormulaKey
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
