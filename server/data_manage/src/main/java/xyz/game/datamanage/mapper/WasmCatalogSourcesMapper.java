package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface WasmCatalogSourcesMapper {

    Map<String, Object> findByGameId(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    int upsertSource(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId,
        @Param("schemaVersion") String schemaVersion,
        @Param("catalogJson") String catalogJson
    );

    /**
     * Insert-only write for bootstrap. Returns 0 when a source row already exists.
     */
    int insertSourceIfAbsent(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId,
        @Param("schemaVersion") String schemaVersion,
        @Param("catalogJson") String catalogJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId
    );

    int upsertSourceLog(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId,
        @Param("schemaVersion") String schemaVersion,
        @Param("catalogJson") String catalogJson
    );
}
