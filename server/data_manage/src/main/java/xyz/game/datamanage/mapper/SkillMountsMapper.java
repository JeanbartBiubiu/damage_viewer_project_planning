package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface SkillMountsMapper {

    List<Map<String, Object>> listSkillMounts(@Param("gameId") String gameId);

    Map<String, Object> findSkillMountByNaturalKey(
        @Param("gameId") String gameId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("skillId") String skillId
    );

    List<Map<String, Object>> listChangedSince(@Param("gameId") String gameId, @Param("updatedAfter") Timestamp updatedAfter);

    int upsertSkillMount(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("skillId") String skillId,
        @Param("enabled") boolean enabled,
        @Param("extendJson") String extendJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("skillId") String skillId,
        @Param("versionId") long versionId
    );

    int upsertSkillMountLog(
        @Param("gameId") String gameId,
        @Param("versionId") long versionId,
        @Param("targetCategory") String targetCategory,
        @Param("targetId") String targetId,
        @Param("skillId") String skillId,
        @Param("enabled") boolean enabled,
        @Param("extendJson") String extendJson
    );
}
