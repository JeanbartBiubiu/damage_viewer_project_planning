package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

@JsonDeserialize(using = SkillEffectResultRequestDeserializer.class)
public record SkillEffectResultRequest(
    @NotBlank(message = "结果标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "结果标识格式不合法")
    String resultKey,
    @NotBlank(message = "结果名称不能为空")
    @Size(max = 100, message = "结果名称不能超过100个字符")
    String name,
    @NotNull(message = "结果种类不能为空")
    SkillEffectResultType resultType,
    @NotNull(message = "作用对象不能为空")
    SkillEffectTarget target,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder,
    @Valid
    SkillEffectValueRuleRequest valueRule,
    @NotNull(message = "结果明细不能为空")
    @Valid
    SkillEffectResultDetail detail,
    @Valid
    SkillEffectResultLifecycleBehaviorRequest lifecycleBehavior,
    SkillEffectSpellShieldBlockScope spellShieldBlockScope
) {
    public SkillEffectResultRequest {
        resultKey = resultKey == null ? null : resultKey.trim();
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }

    public SkillEffectResultRequest(
        String resultKey,
        String name,
        SkillEffectResultType resultType,
        SkillEffectTarget target,
        String description,
        Integer sortOrder,
        SkillEffectValueRuleRequest valueRule,
        SkillEffectResultDetail detail,
        SkillEffectResultLifecycleBehaviorRequest lifecycleBehavior
    ) {
        this(
            resultKey,
            name,
            resultType,
            target,
            description,
            sortOrder,
            valueRule,
            detail,
            lifecycleBehavior,
            null
        );
    }

    public SkillEffectResultRequest(
        String resultKey,
        String name,
        SkillEffectResultType resultType,
        SkillEffectTarget target,
        String description,
        Integer sortOrder,
        SkillEffectValueRuleRequest valueRule,
        SkillEffectResultDetail detail
    ) {
        this(resultKey, name, resultType, target, description, sortOrder, valueRule, detail, null, null);
    }
}
