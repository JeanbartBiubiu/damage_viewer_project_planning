package xyz.game.datamanage.model.equipment;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Null;
import jakarta.validation.constraints.Size;

public record EquipmentUpdateRequest(
    @Null(message = "装备标识不能修改")
    String equipmentKey,
    @NotBlank(message = "装备名称不能为空")
    @Size(max = 100, message = "装备名称不能超过100个字符")
    String name,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description
) {
    public EquipmentUpdateRequest {
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }
}
