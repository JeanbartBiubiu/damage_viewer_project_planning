package xyz.game.datamanage.mapper.skillprocess;

import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessInternalStateLockRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessModeOptionLockRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessSummaryResponse;

@Mapper
public interface SkillProcessMapper {

    List<SkillProcessSummaryResponse> listSummaries(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    SkillProcessRow findProcess(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey
    );

    SkillProcessRow findProcessForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey
    );

    int insertProcess(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("name") String name,
        @Param("activationType") SkillProcessActivationType activationType,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("stepsJson") String stepsJson,
        @Param("cooldownJson") String cooldownJson,
        @Param("effectBindingsJson") String effectBindingsJson,
        @Param("stateOperationsJson") String stateOperationsJson
    );

    int updateProcess(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("name") String name,
        @Param("activationType") SkillProcessActivationType activationType,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("stepsJson") String stepsJson,
        @Param("cooldownJson") String cooldownJson,
        @Param("effectBindingsJson") String effectBindingsJson,
        @Param("stateOperationsJson") String stateOperationsJson
    );

    int deleteProcess(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey
    );

    int deleteAllForSkill(@Param("gameId") String gameId, @Param("skillKey") String skillKey);

    List<SkillProcessStepRow> listStepsForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey
    );

    List<SkillProcessStateOperationRow> listOperationsForUpdate(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    List<String> lockFormulas(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<String> lockEffects(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<SkillProcessInternalStateLockRow> lockInternalStates(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<SkillProcessModeOptionLockRow> lockModeOptions(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<SkillProcessModeOptionLockRow> keys
    );
}
