package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatRepeatEffectDetailsMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("stepId") Object stepId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("stepId") Object stepId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("stepId") Object stepId,
        @Param("repeatScopeTypeId") Object repeatScopeTypeId,
        @Param("repeatCount") Object repeatCount,
        @Param("repeatTag") Object repeatTag,
        @Param("triggerStateKey") Object triggerStateKey,
        @Param("threshold") Object threshold,
        @Param("delayMs") Object delayMs
    );

    int deleteByStepId(@Param("gameId") String gameId, @Param("stepId") String stepId);

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
