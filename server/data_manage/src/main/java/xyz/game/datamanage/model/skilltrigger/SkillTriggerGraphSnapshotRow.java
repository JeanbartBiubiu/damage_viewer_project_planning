package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;

public record SkillTriggerGraphSnapshotRow(
    String ruleKey,
    String actionKey,
    SkillTriggerActionType actionType,
    String effectKey,
    String processKey,
    Boolean protectedRule,
    SkillEffectResultType resultType,
    SkillEffectTarget resultTarget,
    String resultKey,
    String resultAttributeKey,
    SkillEffectAttributeChangeOperation attributeOperation,
    String statusKey,
    SkillEffectStatusOperation statusOperation,
    SkillEffectLifecycleMoment resultMoment,
    Boolean effectHasLifecycle,
    Boolean hasPeriodic,
    Boolean hasNaturalEnd,
    SkillEffectLifecycleExpiryMode expiryMode,
    String lifecycleTargetEffectKey,
    SkillEffectLifecycleOperation lifecycleOperation,
    String boundEffectKey,
    String operatedStateKey,
    SkillProcessStateOperationKind stateOperation,
    SkillInternalStateType stateType,
    String stepKey,
    SkillProcessStepType stepType
) {
}
