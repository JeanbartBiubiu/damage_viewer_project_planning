package xyz.game.datamanage.model.skillinternalstate;

import java.time.OffsetDateTime;

public record SkillInternalStateDetailResponse(
    String gameId,
    String skillKey,
    String stateKey,
    String name,
    SkillInternalStateType stateType,
    SkillInternalStateScope scope,
    String description,
    Integer sortOrder,
    SkillInternalStateDetail detail,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
