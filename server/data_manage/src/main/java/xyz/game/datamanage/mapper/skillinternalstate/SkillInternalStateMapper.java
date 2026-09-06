package xyz.game.datamanage.mapper.skillinternalstate;

import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateScope;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateSummaryResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;

@Mapper
public interface SkillInternalStateMapper {

    List<SkillInternalStateSummaryResponse> listSummaries(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    SkillInternalStateRow findState(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    SkillInternalStateRow findStateForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    int insertState(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("name") String name,
        @Param("stateType") SkillInternalStateType stateType,
        @Param("scope") SkillInternalStateScope scope,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("detailJson") String detailJson
    );

    int updateState(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("detailJson") String detailJson
    );

    int deleteState(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    int deleteAllForSkill(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    long countStateOperations(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    long countOptionOperations(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("optionKeys") Collection<String> optionKeys
    );

    List<String> lockFormulas(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );
}
