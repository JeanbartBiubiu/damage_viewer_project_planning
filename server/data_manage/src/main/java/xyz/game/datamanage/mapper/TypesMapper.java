package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface TypesMapper {

    List<Map<String, Object>> listTypes(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findTypeById(@Param("gameId") String gameId, @Param("typeId") int typeId);

    int upsertType(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("description") String description,
        @Param("reservedTypeId") Integer reservedTypeId
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("versionId") long versionId
    );

    int upsertTypeLog(
        @Param("gameId") String gameId,
        @Param("typeId") int typeId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("description") String description,
        @Param("reservedTypeId") Integer reservedTypeId
    );
}
