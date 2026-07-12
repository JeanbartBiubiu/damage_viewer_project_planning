package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatListenerMatchTypesMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("listenerId") Object listenerId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("listenerId") Object listenerId,
        @Param("matchModeTypeId") Object matchModeTypeId,
        @Param("typeId") Object typeId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("listenerId") Object listenerId,
        @Param("matchModeTypeId") Object matchModeTypeId,
        @Param("typeId") Object typeId
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
