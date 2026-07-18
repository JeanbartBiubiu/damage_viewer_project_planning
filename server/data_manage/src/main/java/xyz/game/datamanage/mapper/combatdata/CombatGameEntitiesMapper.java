package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatGameEntitiesMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("entityId") Object entityId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("entityId") Object entityId,
        @Param("displayName") Object displayName,
        @Param("description") Object description,
        @Param("imageUri") Object imageUri
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
