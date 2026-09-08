package xyz.game.datamanage.mapper.skillrelation;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationResponse;

@Mapper
public interface RuneRelationMapper {

    List<RuneSkillRelationResponse> listRuneRelations(
        @Param("gameId") String gameId,
        @Param("runeKey") String runeKey,
        @Param("skillKey") String skillKey
    );

    RuneSkillRelationResponse findRuneRelation(
        @Param("gameId") String gameId,
        @Param("runeKey") String runeKey,
        @Param("skillKey") String skillKey
    );

    int insertRuneRelation(
        @Param("gameId") String gameId,
        @Param("runeKey") String runeKey,
        @Param("skillKey") String skillKey,
        @Param("sortOrder") int sortOrder
    );

    int updateRuneRelation(
        @Param("gameId") String gameId,
        @Param("runeKey") String runeKey,
        @Param("skillKey") String skillKey,
        @Param("sortOrder") int sortOrder
    );

    int deleteRuneRelation(
        @Param("gameId") String gameId,
        @Param("runeKey") String runeKey,
        @Param("skillKey") String skillKey
    );

}
