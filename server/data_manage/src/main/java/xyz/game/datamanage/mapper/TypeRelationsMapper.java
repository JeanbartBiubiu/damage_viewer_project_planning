package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface TypeRelationsMapper {

    boolean hasTypeRelationsDeletedColumn();

    boolean hasTypeRelationsLogDeletedColumn();

    List<Map<String, Object>> listTypeRelations(@Param("gameId") String gameId);

    List<Map<String, Object>> listTypeRelationsByTarget(
        @Param("gameId") String gameId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId
    );

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findTypeRelationById(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId
    );

    int upsertTypeRelation(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("versionId") long versionId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("extendJson") String extendJson,
        @Param("deleted") boolean deleted,
        @Param("hasDeletedColumn") boolean hasDeletedColumn
    );

    int markTypeRelationDeleted(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("versionId") long versionId,
        @Param("hasDeletedColumn") boolean hasDeletedColumn
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("versionId") long versionId
    );

    int upsertTypeRelationLog(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("versionId") long versionId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("extendJson") String extendJson,
        @Param("deleted") boolean deleted,
        @Param("hasDeletedColumn") boolean hasDeletedColumn
    );
}
