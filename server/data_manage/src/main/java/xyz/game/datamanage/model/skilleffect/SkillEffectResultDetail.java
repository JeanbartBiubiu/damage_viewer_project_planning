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
        SkillEffectDamageImmunityDetail,
        SkillEffectHealthFloorDetail,
        SkillEffectSpellShieldDetail {

    Set<String> foreignFields();

    Set<String> unknownFields();
}
