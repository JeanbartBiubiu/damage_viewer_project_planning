package xyz.game.datamanage.model.skillinternalstate;

import java.time.OffsetDateTime;

public record SkillInternalStateSummaryResponse(
    String gameId,
    String skillKey,
    String stateKey,
    String name,
    SkillInternalStateType stateType,
    SkillInternalStateScope scope,
    String description,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
