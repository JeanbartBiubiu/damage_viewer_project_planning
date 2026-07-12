package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatProviderListenersMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("providerId") Object providerId,
        @Param("abilityId") Object abilityId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("listenerId") Object listenerId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("listenerId") Object listenerId,
        @Param("providerId") Object providerId,
        @Param("listenerKey") Object listenerKey,
        @Param("eventTypeId") Object eventTypeId,
        @Param("abilityId") Object abilityId,
        @Param("maxTriggersPerEvent") Object maxTriggersPerEvent,
        @Param("chainLimitKey") Object chainLimitKey
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
