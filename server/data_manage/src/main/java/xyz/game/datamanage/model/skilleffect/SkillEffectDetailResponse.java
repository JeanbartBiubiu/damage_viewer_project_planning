package xyz.game.datamanage.model.skilleffect;

import java.time.OffsetDateTime;
import java.util.List;

public record SkillEffectDetailResponse(
    String gameId,
    String skillKey,
    String effectKey,
    String name,
    String description,
    Integer sortOrder,
    List<SkillEffectResultResponse> results,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
