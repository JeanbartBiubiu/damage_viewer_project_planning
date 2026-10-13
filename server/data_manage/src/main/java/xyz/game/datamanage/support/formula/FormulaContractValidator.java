package xyz.game.datamanage.support.formula;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** 共同公式定义的纯校验；不读取目录、不执行算术，也不修改调用者的 JSON 树。 */
public final class FormulaContractValidator {
    private static final JsonNode SCHEMA = readSchema();
    private static final int MAX_NODES = SCHEMA.path("x-limits").path("maxNodes").asInt();
    private static final int MAX_DEPTH = SCHEMA.path("x-limits").path("maxDepth").asInt();
    private static final int MAX_INSTRUCTIONS = SCHEMA.path("x-limits").path("maxInstructions").asInt();
    private static final String INVALID_STRUCTURE = "FORMULA_INVALID_STRUCTURE";
    private static final String INVALID_DECIMAL = "FORMULA_INVALID_DECIMAL";
    private static final String DUPLICATE_KEY = "FORMULA_DUPLICATE_KEY";
    private static final String UNKNOWN_INPUT = "FORMULA_UNKNOWN_INPUT";
    private static final String UNKNOWN_STAGE = "FORMULA_UNKNOWN_STAGE";
    private static final String UNKNOWN_BINDING = "FORMULA_UNKNOWN_BINDING";
    private static final String CYCLE = "FORMULA_CYCLE";
    private static final String LIMIT = "FORMULA_LIMIT";

    private FormulaContractValidator() {}

    public record Issue(String code, String path) {}

    /** 返回确定性的首个问题；成功返回 null。授权绑定须由调用者建立。 */
    public static Issue validate(JsonNode definition, List<JsonNode> allowedBindings) {
        Budget budget = new Budget();
        Issue issue = structure(SCHEMA, definition, "", 0, budget);
        if (issue != null) return issue;

        List<Stage> stages = stages(definition.path("stages"));
        for (Stage stage : stages) {
            for (Expression expression : stage.expressions()) {
                if ("const".equals(expression.node().path("op").asText())) {
                    BigDecimal decimal = new BigDecimal(expression.node().path("value").textValue());
                    double value = decimal.doubleValue();
                    if (!Double.isFinite(value) || decimal.signum() != 0 && value == 0) {
                        return new Issue(INVALID_DECIMAL, pointer(expression.path(), "value"));
                    }
                }
            }
        }

        Set<String> inputKeys = new HashSet<>();
        JsonNode inputs = definition.path("inputs");
        for (int i = 0; i < inputs.size(); i++) {
            if (!inputKeys.add(inputs.get(i).path("key").textValue())) {
                return new Issue(DUPLICATE_KEY, "/inputs/" + i + "/key");
            }
        }
        Map<String, Stage> stageKeys = new LinkedHashMap<>();
        for (Stage stage : stages) {
            if (stageKeys.putIfAbsent(stage.key(), stage) != null) {
                return new Issue(DUPLICATE_KEY, "/stages/" + stage.index() + "/key");
            }
        }
        if (!stageKeys.containsKey(definition.path("outputStageKey").textValue())) {
            return new Issue(UNKNOWN_STAGE, "/outputStageKey");
        }
        for (int i = 0; i < inputs.size(); i++) {
            JsonNode binding = inputs.get(i).path("binding");
            if (allowedBindings == null || allowedBindings.stream().noneMatch(binding::equals)) {
                return new Issue(UNKNOWN_BINDING, "/inputs/" + i + "/binding");
            }
        }
        for (Stage stage : stages) {
            for (Expression expression : stage.expressions()) {
                JsonNode node = expression.node();
                if ("read".equals(node.path("op").asText()) && !inputKeys.contains(node.path("inputKey").textValue())) {
                    return new Issue(UNKNOWN_INPUT, pointer(expression.path(), "inputKey"));
                }
                if ("ref".equals(node.path("op").asText()) && !stageKeys.containsKey(node.path("stageKey").textValue())) {
                    return new Issue(UNKNOWN_STAGE, pointer(expression.path(), "stageKey"));
                }
            }
        }

        Map<String, Integer> colors = new HashMap<>();
        List<Stage> dependencyOrder = new ArrayList<>();
        for (Stage stage : stages) {
            issue = cycle(stage, stageKeys, colors, dependencyOrder);
            if (issue != null) return issue;
        }

        // 先按依赖顺序计算各结果一次，再按声明顺序报告；不沿引用递归内联表达式。
        Map<String, Integer> depths = new HashMap<>();
        for (Stage stage : dependencyOrder) {
            depths.put(stage.key(), depth(stage.node().path("expression"), depths));
        }
        for (Stage stage : stages) {
            if (depths.get(stage.key()) > MAX_DEPTH) {
                return new Issue(LIMIT, "/stages/" + stage.index() + "/expression");
            }
        }
        return null;
    }

    private static Issue structure(JsonNode schema, JsonNode value, String path, int expressionDepth, Budget budget) {
        if (schema.has("$ref")) {
            String reference = schema.path("$ref").textValue();
            if ("#/$defs/expression".equals(reference)) {
                expressionDepth++;
                // 在进入节点之前检查，超限树不先做无界递归或复制。
                if (expressionDepth > MAX_DEPTH || ++budget.nodes > MAX_NODES) return new Issue(LIMIT, path);
                budget.instructions += value != null && "if".equals(value.path("op").asText()) ? 3 : 1;
                if (budget.instructions > MAX_INSTRUCTIONS) return new Issue(LIMIT, path);
            } else if ("#/$defs/stage".equals(reference)) {
                if (++budget.instructions > MAX_INSTRUCTIONS) return new Issue(LIMIT, pointer(path, "expression"));
            }
            schema = SCHEMA.at(reference.substring(1));
        }
        if (value == null) return new Issue(INVALID_STRUCTURE, path);

        if (schema.has("oneOf")) {
            if (!value.isObject()) return new Issue(INVALID_STRUCTURE, path);
            String discriminator = schema.path("x-discriminator").textValue();
            JsonNode selected = null;
            JsonNode tag = value.get(discriminator);
            for (JsonNode alternative : schema.path("oneOf")) {
                if (tag != null && allowedValue(alternative.path("properties").path(discriminator), tag)) {
                    selected = alternative;
                    break;
                }
            }
            if (selected == null) return new Issue(INVALID_STRUCTURE, pointer(path, discriminator));
            schema = selected;
        }
        if (schema.has("type") && !hasType(value, schema.path("type").textValue())) {
            return new Issue(INVALID_STRUCTURE, path);
        }
        if (!allowedValue(schema, value)) return new Issue(INVALID_STRUCTURE, path);

        if (value.isObject()) {
            JsonNode properties = schema.path("properties");
            if (schema.has("additionalProperties") && !schema.path("additionalProperties").asBoolean()) {
                String firstUnknown = null;
                Iterator<String> fields = value.fieldNames();
                while (fields.hasNext()) {
                    String field = fields.next();
                    if (!properties.has(field) && (firstUnknown == null || compareCodePoints(field, firstUnknown) < 0)) {
                        firstUnknown = field;
                    }
                }
                if (firstUnknown != null) return new Issue(INVALID_STRUCTURE, pointer(path, firstUnknown));
            }
            // 先检查全部必填字段的存在性，再按规范的字段顺序检查内容。
            for (JsonNode required : schema.path("required")) {
                if (!value.has(required.textValue())) return new Issue(INVALID_STRUCTURE, pointer(path, required.textValue()));
            }
            Iterator<Map.Entry<String, JsonNode>> fields = properties.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                if (value.has(field.getKey())) {
                    Issue issue = structure(field.getValue(), value.get(field.getKey()), pointer(path, field.getKey()), expressionDepth, budget);
                    if (issue != null) return issue;
                }
            }
        } else if (value.isArray()) {
            if (schema.has("minItems") && value.size() < schema.path("minItems").asInt()
                || schema.has("maxItems") && value.size() > schema.path("maxItems").asInt()) {
                return new Issue(INVALID_STRUCTURE, path);
            }
            for (int i = 0; i < value.size(); i++) {
                Issue issue = structure(schema.path("items"), value.get(i), pointer(path, Integer.toString(i)), expressionDepth, budget);
                if (issue != null) return issue;
            }
        } else if (value.isTextual()) {
            String text = value.textValue();
            int length = text.codePointCount(0, text.length());
            if (schema.has("minLength") && length < schema.path("minLength").asInt()
                || schema.has("maxLength") && length > schema.path("maxLength").asInt()
                || schema.has("pattern") && !Pattern.compile(schema.path("pattern").textValue()).matcher(text).matches()) {
                return new Issue(INVALID_STRUCTURE, path);
            }
        } else if (value.isNumber()) {
            BigDecimal number = decimal(value);
            if (number == null || schema.has("minimum") && number.compareTo(schema.path("minimum").decimalValue()) < 0
                || schema.has("maximum") && number.compareTo(schema.path("maximum").decimalValue()) > 0) {
                return new Issue(INVALID_STRUCTURE, path);
            }
        }
        return null;
    }

    private static boolean allowedValue(JsonNode schema, JsonNode value) {
        if (schema.has("const") && !schema.get("const").equals(value)) return false;
        if (schema.has("enum")) {
            for (JsonNode option : schema.path("enum")) if (option.equals(value)) return true;
            return false;
        }
        return true;
    }

    private static boolean hasType(JsonNode value, String type) {
        return switch (type) {
            case "object" -> value.isObject();
            case "array" -> value.isArray();
            case "string" -> value.isTextual();
            case "integer" -> value.isNumber() && decimal(value) != null && decimal(value).stripTrailingZeros().scale() <= 0;
            case "number" -> value.isNumber() && decimal(value) != null;
            case "boolean" -> value.isBoolean();
            case "null" -> value.isNull();
            default -> throw new IllegalStateException("未支持的公式结构类型：" + type);
        };
    }

    private static BigDecimal decimal(JsonNode value) {
        try {
            return value.decimalValue();
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private static List<Stage> stages(JsonNode definitions) {
        List<Stage> stages = new ArrayList<>();
        for (int i = 0; i < definitions.size(); i++) {
            JsonNode node = definitions.get(i);
            List<Expression> expressions = new ArrayList<>();
            collect(node.path("expression"), "/stages/" + i + "/expression", expressions);
            stages.add(new Stage(node.path("key").textValue(), i, node, expressions));
        }
        return stages;
    }

    private static void collect(JsonNode node, String path, List<Expression> expressions) {
        expressions.add(new Expression(node, path));
        JsonNode args = node.path("args");
        for (int i = 0; i < args.size(); i++) collect(args.get(i), path + "/args/" + i, expressions);
    }

    private static Issue cycle(Stage stage, Map<String, Stage> stages, Map<String, Integer> colors, List<Stage> order) {
        if (colors.getOrDefault(stage.key(), 0) == 2) return null;
        colors.put(stage.key(), 1);
        for (Expression expression : stage.expressions()) {
            if (!"ref".equals(expression.node().path("op").asText())) continue;
            String dependency = expression.node().path("stageKey").textValue();
            if (colors.getOrDefault(dependency, 0) == 1) return new Issue(CYCLE, pointer(expression.path(), "stageKey"));
            Issue issue = cycle(stages.get(dependency), stages, colors, order);
            if (issue != null) return issue;
        }
        colors.put(stage.key(), 2);
        order.add(stage);
        return null;
    }

    private static int depth(JsonNode expression, Map<String, Integer> stageDepths) {
        if ("ref".equals(expression.path("op").asText())) {
            return 1 + stageDepths.get(expression.path("stageKey").textValue());
        }
        int children = 0;
        for (JsonNode child : expression.path("args")) children = Math.max(children, depth(child, stageDepths));
        return 1 + children;
    }

    private static String pointer(String parent, String field) {
        return parent + "/" + field.replace("~", "~0").replace("/", "~1");
    }

    private static int compareCodePoints(String left, String right) {
        int l = 0;
        int r = 0;
        while (l < left.length() && r < right.length()) {
            int a = left.codePointAt(l);
            int b = right.codePointAt(r);
            if (a != b) return Integer.compare(a, b);
            l += Character.charCount(a);
            r += Character.charCount(b);
        }
        return Integer.compare(left.length() - l, right.length() - r);
    }

    private static JsonNode readSchema() {
        try {
            return new ObjectMapper().readTree(FormulaContractSchema.JSON);
        } catch (JsonProcessingException exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }

    private record Stage(String key, int index, JsonNode node, List<Expression> expressions) {}
    private record Expression(JsonNode node, String path) {}
    private static final class Budget {
        private int nodes;
        private int instructions;
    }
}
