package xyz.game.datamanage.mapper.combatdata;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CombatAttributeDefinitionsMapper {

    List<Map<String, Object>> list(
        @Param("gameId") String gameId
    );

    Map<String, Object> findById(
        @Param("gameId") String gameId,
        @Param("attrKey") Object attrKey
    );

    int upsert(
        @Param("gameId") String gameId,
        @Param("changeRevision") long changeRevision,
        @Param("attrKey") Object attrKey,
        @Param("sortOrder") Object sortOrder,
        @Param("attrName") Object attrName,
        @Param("attrType") Object attrType,
        @Param("defaultValue") Object defaultValue,
        @Param("valueKind") Object valueKind,
        @Param("rateTargetAttrKey") Object rateTargetAttrKey,
        @Param("minValue") Object minValue,
        @Param("maxValue") Object maxValue
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
