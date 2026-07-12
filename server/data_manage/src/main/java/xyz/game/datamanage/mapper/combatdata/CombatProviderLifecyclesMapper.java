package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatProviderLifecyclesMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("providerId") Object providerId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("providerId") Object providerId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("providerId") Object providerId,
        @Param("durationFormulaKey") Object durationFormulaKey,
        @Param("maxStacks") Object maxStacks,
        @Param("refreshPolicyTypeId") Object refreshPolicyTypeId,
        @Param("tickIntervalMs") Object tickIntervalMs,
        @Param("startDelayMs") Object startDelayMs
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
