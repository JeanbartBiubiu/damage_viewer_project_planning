package xyz.game.datamanage.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface PublishedWasmCatalogSnapshotsMapper {

    String findCatalogSnapshotJson(@Param("gameId") String gameId, @Param("versionCode") String versionCode);

    int upsertCatalogSnapshot(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId,
        @Param("versionCode") String versionCode,
        @Param("schemaVersion") String schemaVersion,
        @Param("schemaHash") String schemaHash,
        @Param("rulesHash") String rulesHash,
        @Param("catalogJson") String catalogJson
    );
}
