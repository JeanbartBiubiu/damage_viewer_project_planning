package xyz.game.datamanage.support.formula;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 技能使用点授权；全部声明参与授权，供值仅按输出可达的 read 计算。 */
public final class SkillFormulaBindings {
    private SkillFormulaBindings() {}

    public static List<JsonNode> allowed(String skillKey, Collection<String> attributeKeys, Collection<String> parameterKeys) {
        List<JsonNode> allowed = new ArrayList<>();
        for (String key : new java.util.TreeSet<>(attributeKeys)) {
            for (String object : List.of("source", "target")) {
                for (String kind : List.of("BASE", "BONUS", "TOTAL", "CURRENT", "MAX", "MISSING", "CURRENT_RATIO", "MISSING_RATIO")) {
                    allowed.add(JsonNodeFactory.instance.objectNode().put("kind", "attribute").put("object", object)
                        .put("attributeKey", key).put("valueKind", kind).put("view", "current_frame"));
                }
            }
        }
        for (String key : new java.util.TreeSet<>(parameterKeys)) {
            allowed.add(JsonNodeFactory.instance.objectNode().put("kind", "parameter")
                .put("skillKey", skillKey).put("parameterKey", key));
        }
        // 声明只开放这一固定上下文；真正的使用点由 SkillNumericSemantics 继续收窄。
        allowed.add(JsonNodeFactory.instance.objectNode().put("kind", "context").put("contextKey", "effect_elapsed_ms"));
        return List.copyOf(allowed);
    }

    public static Set<String> attributeKeys(JsonNode definition) { return declarationKeys(definition, "attribute", "attributeKey"); }
    public static Set<String> parameterKeys(JsonNode definition) { return declarationKeys(definition, "parameter", "parameterKey"); }

    private static Set<String> declarationKeys(JsonNode definition, String kind, String field) {
        Set<String> keys = new LinkedHashSet<>();
        if (definition != null && definition.path("inputs").isArray()) for (JsonNode input : definition.path("inputs")) {
            JsonNode binding = input.path("binding");
            if (kind.equals(binding.path("kind").asText()) && binding.path(field).isTextual()) keys.add(binding.path(field).textValue());
        }
        return Set.copyOf(keys);
    }

    /** 定义已通过共同校验后使用；条件两条分支均遍历，局部结果只沿 outputStageKey 可达集合。 */
    public static List<JsonNode> reachableBindings(JsonNode definition) {
        java.util.Map<String, JsonNode> stages = new java.util.LinkedHashMap<>(), inputs = new java.util.LinkedHashMap<>();
        for (JsonNode stage : definition.path("stages")) stages.put(stage.path("key").textValue(), stage.path("expression"));
        for (JsonNode input : definition.path("inputs")) inputs.put(input.path("key").textValue(), input.path("binding"));
        Set<String> readKeys = new LinkedHashSet<>(), visited = new LinkedHashSet<>();
        collectStage(definition.path("outputStageKey").textValue(), stages, readKeys, visited);
        return readKeys.stream().map(inputs::get).toList();
    }

    public static Set<String> reachableParameterKeys(JsonNode definition) {
        Set<String> keys = new LinkedHashSet<>();
        for (JsonNode binding : reachableBindings(definition)) if ("parameter".equals(binding.path("kind").asText())) keys.add(binding.path("parameterKey").textValue());
        return Set.copyOf(keys);
    }

    private static void collectStage(String key, java.util.Map<String, JsonNode> stages, Set<String> reads, Set<String> visited) {
        if (visited.add(key)) collect(stages.get(key), stages, reads, visited);
    }

    private static void collect(JsonNode node, java.util.Map<String, JsonNode> stages, Set<String> reads, Set<String> visited) {
        if (node == null) throw new IllegalStateException("共同公式结果不存在");
        switch (node.path("op").asText()) {
            case "read" -> reads.add(node.path("inputKey").textValue());
            case "ref" -> collectStage(node.path("stageKey").textValue(), stages, reads, visited);
            default -> { for (JsonNode arg : node.path("args")) collect(arg, stages, reads, visited); }
        }
    }
}
