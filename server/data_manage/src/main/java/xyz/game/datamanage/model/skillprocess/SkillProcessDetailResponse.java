package xyz.game.datamanage.model.skillprocess;

import java.time.OffsetDateTime;
import java.util.List;

public record SkillProcessDetailResponse(
    String gameId,
    String skillKey,
    String processKey,
    String name,
    SkillProcessActivationType activationType,
    String description,
    Integer sortOrder,
    SkillProcessCooldown cooldown,
    List<SkillProcessStepResponse> steps,
    List<SkillProcessEffectBindingResponse> effectBindings,
    List<SkillProcessStateOperationResponse> stateOperations,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
