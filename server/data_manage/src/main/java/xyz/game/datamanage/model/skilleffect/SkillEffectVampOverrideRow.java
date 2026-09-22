package xyz.game.datamanage.model.skilleffect;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillEffectVampOverrideRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillEffectVampType vampType,
    SkillEffectVampOverrideMode mode,
    SkillEffectVampBasisOutputKind basisOutputKind,
    SkillNumericValue efficiencyValue
) {
}
