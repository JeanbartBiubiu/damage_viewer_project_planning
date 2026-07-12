package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatTypeRelationsMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId,
        @Param("typeId") Object typeId,
        @Param("targetCategory") Object targetCategory,
        @Param("targetId") Object targetId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("typeId") Object typeId,
        @Param("targetCategory") Object targetCategory,
        @Param("targetId") Object targetId
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("typeId") Object typeId,
        @Param("targetCategory") Object targetCategory,
        @Param("targetId") Object targetId,
        @Param("extend") Object extend
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
