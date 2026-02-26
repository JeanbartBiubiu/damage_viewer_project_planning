package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface HeroesMapper {

    List<Map<String, Object>> listHeroes(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findHeroById(@Param("gameId") String gameId, @Param("heroId") String heroId);

    int upsertHero(
        @Param("gameId") String gameId,
        @Param("heroId") String heroId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("title") String title,
        @Param("avatarUrl") String avatarUrl,
        @Param("baseStatsJson") String baseStatsJson,
        @Param("statsByLevelJson") String statsByLevelJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("heroId") String heroId,
        @Param("versionId") long versionId
    );

    int upsertHeroLog(
        @Param("gameId") String gameId,
        @Param("heroId") String heroId,
        @Param("versionId") long versionId,
        @Param("name") String name,
        @Param("title") String title,
        @Param("avatarUrl") String avatarUrl,
        @Param("baseStatsJson") String baseStatsJson,
        @Param("statsByLevelJson") String statsByLevelJson
    );
}
