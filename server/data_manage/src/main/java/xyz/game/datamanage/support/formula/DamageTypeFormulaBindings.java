package xyz.game.datamanage.support.formula;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 本使用点授权：同游戏启用属性、来源／目标、本帧、基础／额外／总值。 */
public final class DamageTypeFormulaBindings {
    private DamageTypeFormulaBindings() {}

    public static List<JsonNode> allowed(Collection<String> enabledAttributeKeys) {
        List<JsonNode> bindings = new ArrayList<>();
        for (String attributeKey : new java.util.TreeSet<>(enabledAttributeKeys)) {
            for (String object : List.of("source", "target")) {
                for (String kind : List.of("BASE", "BONUS", "TOTAL")) {
                    bindings.add(JsonNodeFactory.instance.objectNode().put("kind", "attribute")
                        .put("object", object).put("attributeKey", attributeKey)
                        .put("valueKind", kind).put("view", "current_frame"));
                }
            }
        }
        return List.copyOf(bindings);
    }

    /** 仅提取声明，不据此授予真实目录权限。 */
    public static Set<String> attributeKeys(JsonNode definition) {
        Set<String> keys = new LinkedHashSet<>();
        if (definition != null && definition.path("inputs").isArray()) {
            for (JsonNode input : definition.path("inputs")) {
                JsonNode binding = input.path("binding");
                if (binding.path("attributeKey").isTextual()) keys.add(binding.path("attributeKey").textValue());
            }
        }
        return Set.copyOf(keys);
    }
}
