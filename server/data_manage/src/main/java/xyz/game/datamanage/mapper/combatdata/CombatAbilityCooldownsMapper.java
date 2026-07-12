package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatAbilityCooldownsMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("abilityId") Object abilityId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("cooldownId") Object cooldownId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("cooldownId") Object cooldownId,
        @Param("abilityId") Object abilityId,
        @Param("durationFormulaKey") Object durationFormulaKey,
        @Param("startsOnPhaseId") Object startsOnPhaseId,
        @Param("groupKey") Object groupKey
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
