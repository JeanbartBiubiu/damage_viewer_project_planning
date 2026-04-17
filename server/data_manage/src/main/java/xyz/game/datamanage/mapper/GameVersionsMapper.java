package xyz.game.datamanage.mapper;

import java.sql.Date;
import java.sql.Timestamp;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface GameVersionsMapper {

    Map<String, Object> findCurrentPublishedVersion(@Param("gameId") String gameId);

    Map<String, Object> findVersionById(@Param("gameId") String gameId, @Param("versionId") long versionId);

    Map<String, Object> findVersionByCode(@Param("gameId") String gameId, @Param("versionCode") String versionCode);

    Long findCurrentVersionId(@Param("gameId") String gameId);

    Long findLatestVersionId(@Param("gameId") String gameId);

    Long createVersion(
        @Param("gameId") String gameId,
        @Param("versionCode") String versionCode,
        @Param("releaseDate") Date releaseDate
    );

    int clearCurrentVersion(@Param("gameId") String gameId);

    int markVersionCurrent(
        @Param("publishedAt") Timestamp publishedAt,
        @Param("gameId") String gameId,
        @Param("versionId") long versionId
    );
}
