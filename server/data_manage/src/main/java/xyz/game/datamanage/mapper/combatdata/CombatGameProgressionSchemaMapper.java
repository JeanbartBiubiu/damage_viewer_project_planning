package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatGameProgressionSchemaMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId
    );

    Map<String, Object> findByGameId(@Param("gameId") String gameId);

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("progressionKind") Object progressionKind,
        @Param("stageMin") Object stageMin,
        @Param("stageMax") Object stageMax,
        @Param("stageLabel") Object stageLabel,
        @Param("requireAllStages") Object requireAllStages
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
