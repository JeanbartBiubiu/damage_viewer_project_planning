package xyz.game.datamanage.mapper.skillprocess;

import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessChannelStepDetailRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessChargeStepDetailRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessCooldownRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessDelayStepDetailRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessEffectBindingRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessEmpoweredAttackStepDetailRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessEmpoweredConsumeMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessFirstExecution;
import xyz.game.datamanage.model.skillprocess.SkillProcessInternalStateLockRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessModeOptionLockRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMultiHitStepDetailRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessPeriodicStepDetailRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessRecastStepDetailRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
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
        @Param("sortOrder") Integer sortOrder
    );

    int updateProcess(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("name") String name,
        @Param("activationType") SkillProcessActivationType activationType,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder
    );

    int deleteProcess(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey
    );

    int deleteAllForSkill(@Param("gameId") String gameId, @Param("skillKey") String skillKey);

    List<SkillProcessStepRow> listSteps(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey
    );

    List<SkillProcessStepRow> listStepsForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey
    );

    int insertStep(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("name") String name,
        @Param("stepType") SkillProcessStepType stepType,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder
    );

    int updateStep(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder
    );

    int deleteSteps(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKeys") Collection<String> stepKeys
    );

    List<SkillProcessDelayStepDetailRow> listDelayDetails(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertDelayDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("delayFormulaKey") String delayFormulaKey
    );

    int updateDelayDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("delayFormulaKey") String delayFormulaKey
    );

    List<SkillProcessMultiHitStepDetailRow> listMultiHitDetails(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertMultiHitDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("repeatCountFormulaKey") String repeatCountFormulaKey,
        @Param("intervalFormulaKey") String intervalFormulaKey
    );

    int updateMultiHitDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("repeatCountFormulaKey") String repeatCountFormulaKey,
        @Param("intervalFormulaKey") String intervalFormulaKey
    );

    List<SkillProcessPeriodicStepDetailRow> listPeriodicDetails(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertPeriodicDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("repeatCountFormulaKey") String repeatCountFormulaKey,
        @Param("intervalFormulaKey") String intervalFormulaKey,
        @Param("firstExecution") SkillProcessFirstExecution firstExecution
    );

    int updatePeriodicDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("repeatCountFormulaKey") String repeatCountFormulaKey,
        @Param("intervalFormulaKey") String intervalFormulaKey,
        @Param("firstExecution") SkillProcessFirstExecution firstExecution
    );

    List<SkillProcessChannelStepDetailRow> listChannelDetails(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertChannelDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("durationFormulaKey") String durationFormulaKey,
        @Param("executionCountFormulaKey") String executionCountFormulaKey,
        @Param("firstExecution") SkillProcessFirstExecution firstExecution
    );

    int updateChannelDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("durationFormulaKey") String durationFormulaKey,
        @Param("executionCountFormulaKey") String executionCountFormulaKey,
        @Param("firstExecution") SkillProcessFirstExecution firstExecution
    );

    List<SkillProcessChargeStepDetailRow> listChargeDetails(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertChargeDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("minimumChargeFormulaKey") String minimumChargeFormulaKey,
        @Param("maximumChargeFormulaKey") String maximumChargeFormulaKey,
        @Param("releaseAtMaximum") Boolean releaseAtMaximum
    );

    int updateChargeDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("minimumChargeFormulaKey") String minimumChargeFormulaKey,
        @Param("maximumChargeFormulaKey") String maximumChargeFormulaKey,
        @Param("releaseAtMaximum") Boolean releaseAtMaximum
    );

    List<SkillProcessRecastStepDetailRow> listRecastDetails(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertRecastDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("windowFormulaKey") String windowFormulaKey,
        @Param("maximumRecastCountFormulaKey") String maximumRecastCountFormulaKey
    );

    int updateRecastDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("windowFormulaKey") String windowFormulaKey,
        @Param("maximumRecastCountFormulaKey") String maximumRecastCountFormulaKey
    );

    List<SkillProcessEmpoweredAttackStepDetailRow> listEmpoweredDetails(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertEmpoweredDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("windowFormulaKey") String windowFormulaKey,
        @Param("consumeMoment") SkillProcessEmpoweredConsumeMoment consumeMoment
    );

    int updateEmpoweredDetail(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey,
        @Param("windowFormulaKey") String windowFormulaKey,
        @Param("consumeMoment") SkillProcessEmpoweredConsumeMoment consumeMoment
    );

    SkillProcessCooldownRow findCooldown(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertCooldown(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("durationFormulaKey") String durationFormulaKey,
        @Param("momentType") SkillProcessMomentType momentType,
        @Param("stepKey") String stepKey
    );

    int deleteCooldown(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    List<SkillProcessEffectBindingRow> listBindings(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    List<SkillProcessEffectBindingRow> listBindingsForUpdate(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertBinding(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("bindingKey") String bindingKey,
        @Param("effectKey") String effectKey,
        @Param("momentType") SkillProcessMomentType momentType,
        @Param("stepKey") String stepKey,
        @Param("sortOrder") Integer sortOrder
    );

    int updateBinding(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("bindingKey") String bindingKey,
        @Param("effectKey") String effectKey,
        @Param("momentType") SkillProcessMomentType momentType,
        @Param("stepKey") String stepKey,
        @Param("sortOrder") Integer sortOrder
    );

    int deleteBindings(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("bindingKeys") Collection<String> bindingKeys
    );

    int deleteAllBindings(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    List<SkillProcessStateOperationRow> listOperations(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    List<SkillProcessStateOperationRow> listOperationsForUpdate(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    int insertOperation(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("operationKey") String operationKey,
        @Param("name") String name,
        @Param("stateKey") String stateKey,
        @Param("operation") SkillProcessStateOperationKind operation,
        @Param("valueFormulaKey") String valueFormulaKey,
        @Param("optionKey") String optionKey,
        @Param("momentType") SkillProcessMomentType momentType,
        @Param("stepKey") String stepKey,
        @Param("sortOrder") Integer sortOrder
    );

    int updateOperation(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("operationKey") String operationKey,
        @Param("name") String name,
        @Param("stateKey") String stateKey,
        @Param("valueFormulaKey") String valueFormulaKey,
        @Param("optionKey") String optionKey,
        @Param("momentType") SkillProcessMomentType momentType,
        @Param("stepKey") String stepKey,
        @Param("sortOrder") Integer sortOrder
    );

    int deleteOperations(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("operationKeys") Collection<String> operationKeys
    );

    int deleteAllOperations(
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
