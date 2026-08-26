package xyz.game.datamanage.mapper.skill;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skill.SkillCategoryLockRow;
import xyz.game.datamanage.model.skill.SkillCategoryRelationRow;
import xyz.game.datamanage.model.skill.SkillRow;

@Mapper
public interface SkillMapper {

    List<SkillRow> list(
        @Param("gameId") String gameId,
        @Param("keyword") String keyword,
        @Param("status") String status
    );

    SkillRow findById(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    SkillRow findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    int insert(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("maxLevel") Integer maxLevel,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int update(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("maxLevel") Integer maxLevel,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int delete(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    List<SkillCategoryRelationRow> listRelations(
        @Param("gameId") String gameId,
        @Param("skillKeys") List<String> skillKeys
    );

    List<String> listRelationKeys(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    List<SkillCategoryLockRow> lockCategories(
        @Param("gameId") String gameId,
        @Param("keys") List<String> keys
    );

    int insertRelation(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("skillCategoryKey") String skillCategoryKey
    );

    int deleteAllRelations(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    int deleteRelations(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") List<String> keys
    );
}
