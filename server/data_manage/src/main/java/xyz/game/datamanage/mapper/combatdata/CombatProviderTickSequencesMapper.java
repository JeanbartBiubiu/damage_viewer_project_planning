package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatProviderTickSequencesMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("providerId") Object providerId,
        @Param("sequenceId") Object sequenceId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("providerId") Object providerId,
        @Param("sequenceId") Object sequenceId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("providerId") Object providerId,
        @Param("sequenceId") Object sequenceId
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
