package xyz.game.datamanage.model.character;

/** 检查查询专用行；存在标记和原始 JSON 不对外返回。 */
public final class CharacterAuthoringCheckRows {
    private CharacterAuthoringCheckRows() { }

    public record AttachedSkill(String skillKey, String name, String status, Integer maxLevel,
                                Integer sortOrder, boolean skillExists,
                                int effectCount, int processCount, int triggerRuleCount) { }
    public record ObjectRow(String skillKey, String objectType, String objectKey, String name,
                            Integer sortOrder, String dataJson) { }
    public record ReferenceRow(String sourceSkillKey, String sourceType, String sourceKey, String fieldPath,
                               String targetType, String targetSkillKey, String targetKey, String targetSubKey,
                               boolean targetExists) { }
}
