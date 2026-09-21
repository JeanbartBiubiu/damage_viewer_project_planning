package xyz.game.datamanage.model.skilleffect;

import java.util.Set;

public sealed interface SkillEffectResultDetail
    permits SkillEffectDamageDetail,
        SkillEffectDirectHealDetail,
        SkillEffectNormalShieldDetail,
        SkillEffectAttributeChangeDetail,
        SkillEffectResourceChangeDetail,
        SkillEffectCooldownChangeDetail,
        SkillEffectStatusOperationDetail,
        SkillEffectLifecycleOperationDetail,
        SkillEffectDamageModifierDetail,
        SkillEffectHealingModifierDetail,
        SkillEffectShieldReceivedModifierDetail,
        SkillEffectDamageImmunityDetail,
        SkillEffectHealthFloorDetail,
        SkillEffectSpellShieldDetail,
        SkillEffectExecuteDetail,
        SkillEffectHitLinkApplicationDetail,
        SkillEffectAttackLinkApplicationDetail,
        SkillEffectHasteModifierDetail,
        SkillEffectAttackTimerResetDetail {

    Set<String> foreignFields();

    Set<String> unknownFields();
}
