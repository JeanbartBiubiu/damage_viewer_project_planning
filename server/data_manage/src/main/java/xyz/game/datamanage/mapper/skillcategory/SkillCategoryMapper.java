package xyz.game.datamanage.mapper.skillcategory;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;

@Mapper
public interface SkillCategoryMapper {

    List<SkillCategoryResponse> list(
        @Param("gameId") String gameId,
        @Param("keyword") String keyword,
        @Param("status") String status
    );

    SkillCategoryResponse findById(
        @Param("gameId") String gameId,
        @Param("skillCategoryKey") String skillCategoryKey
    );

    SkillCategoryResponse findByIdForUpdate(
        @Param("gameId") String gameId,
        @Param("skillCategoryKey") String skillCategoryKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("skillCategoryKey") String skillCategoryKey
    );

    long countByNormalizedName(
        @Param("gameId") String gameId,
        @Param("name") String name,
        @Param("excludeSkillCategoryKey") String excludeSkillCategoryKey
    );

    int insert(
        @Param("gameId") String gameId,
        @Param("skillCategoryKey") String skillCategoryKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int update(
        @Param("gameId") String gameId,
        @Param("skillCategoryKey") String skillCategoryKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("status") String status,
        @Param("sortOrder") Integer sortOrder
    );

    int delete(
        @Param("gameId") String gameId,
        @Param("skillCategoryKey") String skillCategoryKey
    );
}
