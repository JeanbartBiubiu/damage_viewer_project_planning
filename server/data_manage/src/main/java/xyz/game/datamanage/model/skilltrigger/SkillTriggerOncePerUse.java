package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.LinkedHashSet;
import java.util.Set;

public record SkillTriggerOncePerUse(
    @NotBlank(message = "共享限制键不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "共享限制键格式不合法")
    String groupKey,
    @NotNull(message = "同次使用限制范围不能为空")
    SkillTriggerOncePerUseScope scope,
    @JsonIgnore Set<String> unknownFields
) {
    public SkillTriggerOncePerUse {
        groupKey = groupKey == null || groupKey.isBlank() ? null : groupKey.trim();
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerOncePerUse(String groupKey, SkillTriggerOncePerUseScope scope) {
        this(groupKey, scope, Set.of());
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static SkillTriggerOncePerUse fromJson(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isObject()) {
            throw new IllegalArgumentException("同次使用限制必须是对象");
        }
        Set<String> unknown = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(name -> {
            if (!"groupKey".equals(name) && !"scope".equals(name)) {
                unknown.add(name);
            }
        });
        JsonNode groupNode = node.get("groupKey");
        if (groupNode != null && !groupNode.isNull() && !groupNode.isMissingNode() && !groupNode.isTextual()) {
            throw new IllegalArgumentException("共享限制键必须是文本");
        }
        String groupKey = groupNode != null && groupNode.isTextual() ? groupNode.asText() : null;
        SkillTriggerOncePerUseScope scope = null;
        JsonNode scopeNode = node.get("scope");
        if (scopeNode != null && !scopeNode.isNull() && !scopeNode.isMissingNode()) {
            if (!scopeNode.isTextual()) {
                throw new IllegalArgumentException("同次使用限制范围不合法");
            }
            try {
                scope = SkillTriggerOncePerUseScope.valueOf(scopeNode.asText());
            } catch (IllegalArgumentException ex) {
                throw new IllegalArgumentException("同次使用限制范围不合法");
            }
        }
        return new SkillTriggerOncePerUse(groupKey, scope, unknown);
    }
}
