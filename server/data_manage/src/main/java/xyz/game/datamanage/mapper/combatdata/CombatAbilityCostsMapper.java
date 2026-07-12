package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatAbilityCostsMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("abilityId") Object abilityId,
        @Param("phaseId") Object phaseId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("costId") Object costId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("costId") Object costId,
        @Param("abilityId") Object abilityId,
        @Param("phaseId") Object phaseId,
        @Param("resourceKey") Object resourceKey,
        @Param("amountFormulaKey") Object amountFormulaKey,
        @Param("allowPartial") Object allowPartial
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
