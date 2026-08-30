package xyz.game.datamanage.model.skilleffect;

public record SkillEffectNormalShieldInteractionRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String absorbedDamageTypeKey,
    SkillEffectNormalShieldDecayMode decayMode
) {
}
