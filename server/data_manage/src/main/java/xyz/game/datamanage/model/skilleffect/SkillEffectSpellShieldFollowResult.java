package xyz.game.datamanage.model.skilleffect;

/** 同次真实命中中被跟随的完整结果身份；不表示另一次法盾判断。 */
public record SkillEffectSpellShieldFollowResult(String skillKey, String effectKey, String resultKey) { }
