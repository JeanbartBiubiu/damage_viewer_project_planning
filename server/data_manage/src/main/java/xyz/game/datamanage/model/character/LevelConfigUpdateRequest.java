package xyz.game.datamanage.model.character;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record LevelConfigUpdateRequest(
    @NotNull(message = "最小等级不能为空")
    @Min(value = 1, message = "最小等级不能小于1")
    @Max(value = 100, message = "最小等级不能大于100")
    Integer minLevel,
    @NotNull(message = "最大等级不能为空")
    @Min(value = 1, message = "最大等级不能小于1")
    @Max(value = 100, message = "最大等级不能大于100")
    Integer maxLevel
) {
}
