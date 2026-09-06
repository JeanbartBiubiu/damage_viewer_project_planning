package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerProcessShapeRow(
    String processKey,
    String bindingEffectKey,
    String operationStateKey,
    SkillProcessStateOperationKind operation,
    SkillNumericValue operationValue,
    SkillInternalStateType stateType,
    String stepKey,
    SkillProcessStepType stepType,
    SkillNumericValue cooldownValue,
    SkillNumericValue delayValue,
    SkillNumericValue multiCountValue,
    SkillNumericValue multiIntervalValue,
    SkillNumericValue periodicCountValue,
    SkillNumericValue periodicIntervalValue,
    SkillNumericValue channelDurationValue,
    SkillNumericValue channelCountValue,
    SkillNumericValue chargeMinValue,
    SkillNumericValue chargeMaxValue,
    SkillNumericValue recastWindowValue,
    SkillNumericValue recastCountValue,
    SkillNumericValue empoweredWindowValue,
    SkillNumericValue counterInitialValue,
    SkillNumericValue counterMaxValue,
    SkillNumericValue ammoInitialValue,
    SkillNumericValue ammoMaxValue,
    SkillNumericValue ammoRecoveryValue,
    SkillNumericValue cooldownDurationValue
) {
}
