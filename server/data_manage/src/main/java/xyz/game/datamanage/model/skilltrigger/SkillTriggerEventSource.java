package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonDeserialize(using = SkillTriggerEventSourceDeserializer.class)
public record SkillTriggerEventSource(
    @NotNull(message = "事件种类不能为空")
    SkillTriggerEventType eventType,
    @NotNull(message = "事件明细不能为空")
    @Valid
    SkillTriggerEventDetail detail
) {
}
