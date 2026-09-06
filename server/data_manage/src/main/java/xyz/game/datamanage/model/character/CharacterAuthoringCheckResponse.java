package xyz.game.datamanage.model.character;

import java.time.OffsetDateTime;
import java.util.List;

public record CharacterAuthoringCheckResponse(
    String gameId, String characterKey, String characterName, OffsetDateTime checkedAt,
    Conclusions conclusions, Summary summary, List<Skill> skills,
    List<Reference> references, List<Issue> issues
) {
    public CharacterAuthoringCheckResponse {
        skills = List.copyOf(skills);
        references = List.copyOf(references);
        issues = List.copyOf(issues);
    }

    public record Conclusions(String structure, String mechanics, String runtime) { }
    public record Summary(int attachedSkillCount, int configuredAttributeCount, int errorCount, int reviewCount) { }
    public record Skill(String skillKey, String name, String status, Integer maxLevel, Integer sortOrder,
                        int effectCount, int processCount, int triggerRuleCount) { }
    public record Reference(String sourceSkillKey, String sourceType, String sourceKey, String fieldPath,
                            String targetType, String targetSkillKey, String targetKey, String targetSubKey) { }
    public record Issue(String code, String severity, String message, String skillKey,
                        String objectType, String objectKey, String fieldPath) { }
}
