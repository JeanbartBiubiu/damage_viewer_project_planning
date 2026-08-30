package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;

public record SkillTriggerProcessShapeRow(
    String processKey,
    String bindingEffectKey,
    String operationStateKey,
    SkillProcessStateOperationKind operation,
    String operationValueFormulaKey,
    SkillInternalStateType stateType,
    String stepKey,
    SkillProcessStepType stepType,
    String cooldownFormulaKey,
    String delayFormulaKey,
    String multiCountFormulaKey,
    String multiIntervalFormulaKey,
    String periodicCountFormulaKey,
    String periodicIntervalFormulaKey,
    String channelDurationFormulaKey,
    String channelCountFormulaKey,
    String chargeMinFormulaKey,
    String chargeMaxFormulaKey,
    String recastWindowFormulaKey,
    String recastCountFormulaKey,
    String empoweredWindowFormulaKey,
    String counterInitialFormulaKey,
    String counterMaxFormulaKey,
    String ammoInitialFormulaKey,
    String ammoMaxFormulaKey,
    String ammoRecoveryFormulaKey,
    String cooldownDurationFormulaKey
) {
}
