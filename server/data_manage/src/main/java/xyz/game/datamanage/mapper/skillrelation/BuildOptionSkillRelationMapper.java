package xyz.game.datamanage.mapper.skillrelation;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;

@Mapper
public interface BuildOptionSkillRelationMapper {
    List<BuildOptionSkillRelationResponse> listRelations(
        @Param("gameId") String gameId,
        @Param("systemKey") String systemKey,
        @Param("optionKey") String optionKey,
        @Param("skillKey") String skillKey
    );

    BuildOptionSkillRelationResponse findRelation(
        @Param("gameId") String gameId,
        @Param("systemKey") String systemKey,
        @Param("optionKey") String optionKey,
        @Param("skillKey") String skillKey
    );

    int insertRelation(
        @Param("gameId") String gameId,
        @Param("systemKey") String systemKey,
        @Param("optionKey") String optionKey,
        @Param("skillKey") String skillKey,
        @Param("activationRank") int activationRank,
        @Param("skillLevelMode") String skillLevelMode,
        @Param("fixedSkillLevel") Integer fixedSkillLevel,
        @Param("sortOrder") int sortOrder
    );

    int updateRelation(
        @Param("gameId") String gameId,
        @Param("systemKey") String systemKey,
        @Param("optionKey") String optionKey,
        @Param("skillKey") String skillKey,
        @Param("activationRank") int activationRank,
        @Param("skillLevelMode") String skillLevelMode,
        @Param("fixedSkillLevel") Integer fixedSkillLevel,
        @Param("sortOrder") int sortOrder
    );

    int deleteRelation(
        @Param("gameId") String gameId,
        @Param("systemKey") String systemKey,
        @Param("optionKey") String optionKey,
        @Param("skillKey") String skillKey
    );
}
