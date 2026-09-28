package xyz.game.datamanage.model.skilltrigger;

/** 用于限定循环检查的技能连通范围。 */
public record SkillTriggerCrossSkillEdgeRow(String sourceSkillKey, String targetSkillKey) {
}
