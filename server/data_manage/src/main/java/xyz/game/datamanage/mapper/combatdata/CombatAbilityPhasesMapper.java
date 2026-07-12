package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatAbilityPhasesMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("abilityId") Object abilityId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("phaseId") Object phaseId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("phaseId") Object phaseId,
        @Param("abilityId") Object abilityId,
        @Param("phaseOrder") Object phaseOrder,
        @Param("phaseTypeId") Object phaseTypeId,
        @Param("durationFormulaKey") Object durationFormulaKey,
        @Param("interruptible") Object interruptible
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
