package xyz.game.datamanage.mapper;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface SkillsMapper {

    List<Map<String, Object>> listSkills(@Param("gameId") String gameId);

    List<Map<String, Object>> listChangedSince(
        @Param("gameId") String gameId,
        @Param("updatedAfter") Timestamp updatedAfter
    );

    Map<String, Object> findSkillById(@Param("gameId") String gameId, @Param("skillId") String skillId);

    int upsertSkill(
        @Param("gameId") String gameId,
        @Param("skillId") String skillId,
        @Param("versionId") long versionId,
        @Param("ownerId") String ownerId,
        @Param("ownerType") String ownerType,
        @Param("skillKey") String skillKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("resourceCostsJson") String resourceCostsJson,
        @Param("cooldownsJson") String cooldownsJson,
        @Param("paramsJson") String paramsJson,
        @Param("timingProfileJson") String timingProfileJson,
        @Param("mechanicsConfigJson") String mechanicsConfigJson
    );

    int updateVersionRange(
        @Param("gameId") String gameId,
        @Param("skillId") String skillId,
        @Param("versionId") long versionId
    );

    int upsertSkillLog(
        @Param("gameId") String gameId,
        @Param("skillId") String skillId,
        @Param("versionId") long versionId,
        @Param("ownerId") String ownerId,
        @Param("ownerType") String ownerType,
        @Param("skillKey") String skillKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("resourceCostsJson") String resourceCostsJson,
        @Param("cooldownsJson") String cooldownsJson,
        @Param("paramsJson") String paramsJson,
        @Param("timingProfileJson") String timingProfileJson,
        @Param("mechanicsConfigJson") String mechanicsConfigJson
    );
}
