package xyz.game.datamanage.mapper;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface SkillsMapper {

    List<Map<String, Object>> listSkills(@Param("gameId") String gameId);

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
        @Param("mechanicsConfigJson") String mechanicsConfigJson
    );
}
