package xyz.game.datamanage.model.authoring;

import java.util.List;

public record ConfigurationReferenceAuditResponse(
    String gameId,
    boolean complete,
    boolean healthy,
    int observedIssueCount,
    Integer totalIssueCount,
    int returnedIssueCount,
    boolean truncated,
    Counts counts,
    List<Issue> issues
) {
    public record Counts(long sourceCount, long existingReferenceCount, long catalogTargetCount,
                         Integer extractedReferenceCount) {}

    public record Issue(String code, String message, String gameId,
                        String sourceSkillKey, String sourceType, String sourceKey, String fieldPath,
                        String targetType, String targetSkillKey, String targetKey, String targetSubKey) {}
}
