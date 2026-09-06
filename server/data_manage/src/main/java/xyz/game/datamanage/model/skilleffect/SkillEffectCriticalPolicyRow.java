package xyz.game.datamanage.model.skilleffect;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillEffectCriticalPolicyRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillEffectCriticalMode criticalMode,
    SkillNumericValue multiplierValue
) {
}
