package xyz.game.datamanage.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface PublishedBundleSnapshotsMapper {

    String findBundleSnapshotJson(@Param("gameId") String gameId, @Param("versionCode") String versionCode);

    int upsertBundleSnapshot(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId,
        @Param("versionCode") String versionCode,
        @Param("bundleJson") String bundleJson
    );
}