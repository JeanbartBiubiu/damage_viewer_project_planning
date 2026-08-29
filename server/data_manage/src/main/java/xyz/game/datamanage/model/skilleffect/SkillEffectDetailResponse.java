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
    SkillEffectLifecycleResponse lifecycle,
    List<SkillEffectResultResponse> results,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public SkillEffectDetailResponse(
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
        this(gameId, skillKey, effectKey, name, description, sortOrder, null, results, createdAt, updatedAt);
    }
}
