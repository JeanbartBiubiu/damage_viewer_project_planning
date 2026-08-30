package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;

public record SkillTriggerEffectShapeRow(
    String effectKey,
    String resultKey,
    SkillEffectResultType resultType,
    SkillEffectTarget target,
    boolean hasValueRule,
    String valueFormulaKey,
    String resultAttributeKey,
    SkillEffectAttributeChangeOperation attributeOperation,
    String statusKey,
    SkillEffectStatusOperation statusOperation,
    SkillEffectLifecycleMoment resultMoment,
    String lifecycleTargetEffectKey,
    SkillEffectLifecycleOperation lifecycleOperation,
    boolean hasLifecycle,
    String durationFormulaKey,
    String maxStacksFormulaKey,
    String applicationStacksFormulaKey,
    String periodicIntervalFormulaKey,
    SkillEffectLifecycleExpiryMode expiryMode
) {
}
