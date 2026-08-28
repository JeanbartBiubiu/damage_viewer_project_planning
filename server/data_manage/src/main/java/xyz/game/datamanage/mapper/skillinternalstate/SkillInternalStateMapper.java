package xyz.game.datamanage.mapper.skillinternalstate;

import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoRecoveryMode;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCooldownDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateFlagDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateModeOptionRow;
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
        @Param("sortOrder") Integer sortOrder
    );

    int updateState(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder
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

    SkillInternalStateCounterDetailRow findCounterDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    int insertCounterDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("initialValueFormulaKey") String initialValueFormulaKey,
        @Param("maxValueFormulaKey") String maxValueFormulaKey
    );

    int updateCounterDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("initialValueFormulaKey") String initialValueFormulaKey,
        @Param("maxValueFormulaKey") String maxValueFormulaKey
    );

    SkillInternalStateAmmoDetailRow findAmmoDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    int insertAmmoDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("initialValueFormulaKey") String initialValueFormulaKey,
        @Param("maxValueFormulaKey") String maxValueFormulaKey,
        @Param("recoveryIntervalFormulaKey") String recoveryIntervalFormulaKey,
        @Param("recoveryMode") SkillInternalStateAmmoRecoveryMode recoveryMode
    );

    int updateAmmoDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("initialValueFormulaKey") String initialValueFormulaKey,
        @Param("maxValueFormulaKey") String maxValueFormulaKey,
        @Param("recoveryIntervalFormulaKey") String recoveryIntervalFormulaKey,
        @Param("recoveryMode") SkillInternalStateAmmoRecoveryMode recoveryMode
    );

    SkillInternalStateFlagDetailRow findFlagDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    int insertFlagDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("initialEnabled") Boolean initialEnabled
    );

    int updateFlagDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("initialEnabled") Boolean initialEnabled
    );

    SkillInternalStateCooldownDetailRow findCooldownDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    int insertCooldownDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("durationFormulaKey") String durationFormulaKey
    );

    int updateCooldownDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("durationFormulaKey") String durationFormulaKey
    );

    List<SkillInternalStateModeOptionRow> listModeOptions(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    List<SkillInternalStateModeOptionRow> listModeOptionsForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    int insertModeOption(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("optionKey") String optionKey,
        @Param("name") String name,
        @Param("sortOrder") Integer sortOrder,
        @Param("initial") Boolean initial
    );

    int updateModeOption(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("optionKey") String optionKey,
        @Param("name") String name,
        @Param("sortOrder") Integer sortOrder,
        @Param("initial") Boolean initial
    );

    int deleteModeOptions(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("optionKeys") Collection<String> optionKeys
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
