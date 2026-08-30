package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;

public record SkillTriggerParameterRefRow(
    String parameterKey,
    SkillParameterValueType valueType,
    String valueMode
) {
}
