package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDeliveryKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldBlockScope;

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
    SkillEffectLifecycleExpiryMode expiryMode,
    String damageTypeKey,
    SkillEffectDamageDeliveryKind damageDeliveryKind,
    SkillEffectDamageOriginKind damageOriginKind,
    SkillEffectSpellShieldBlockScope spellShieldBlockScope,
    int vampCount,
    SkillEffectCooldownChangeOperation cooldownOperation
) {
    public SkillTriggerEffectShapeRow(
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
        SkillEffectLifecycleExpiryMode expiryMode,
        String damageTypeKey,
        SkillEffectDamageDeliveryKind damageDeliveryKind,
        SkillEffectDamageOriginKind damageOriginKind,
        SkillEffectSpellShieldBlockScope spellShieldBlockScope
    ) {
        this(
            effectKey,
            resultKey,
            resultType,
            target,
            hasValueRule,
            valueFormulaKey,
            resultAttributeKey,
            attributeOperation,
            statusKey,
            statusOperation,
            resultMoment,
            lifecycleTargetEffectKey,
            lifecycleOperation,
            hasLifecycle,
            durationFormulaKey,
            maxStacksFormulaKey,
            applicationStacksFormulaKey,
            periodicIntervalFormulaKey,
            expiryMode,
            damageTypeKey,
            damageDeliveryKind,
            damageOriginKind,
            spellShieldBlockScope,
            0,
            null
        );
    }
    public SkillTriggerEffectShapeRow(
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
        this(
            effectKey,
            resultKey,
            resultType,
            target,
            hasValueRule,
            valueFormulaKey,
            resultAttributeKey,
            attributeOperation,
            statusKey,
            statusOperation,
            resultMoment,
            lifecycleTargetEffectKey,
            lifecycleOperation,
            hasLifecycle,
            durationFormulaKey,
            maxStacksFormulaKey,
            applicationStacksFormulaKey,
            periodicIntervalFormulaKey,
            expiryMode,
            null,
            resultType == SkillEffectResultType.DAMAGE ? SkillEffectDamageDeliveryKind.SKILL : null,
            resultType == SkillEffectResultType.DAMAGE ? SkillEffectDamageOriginKind.DIRECT : null,
            null
        );
    }
}
