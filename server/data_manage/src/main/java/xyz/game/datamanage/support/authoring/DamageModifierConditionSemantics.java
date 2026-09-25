package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import xyz.game.datamanage.model.value.SkillNumericValue;

/** 伤害修正的逐笔生命门槛形状；数值和引用由提交前保护继续检查。 */
public final class DamageModifierConditionSemantics {
    private static final Set<String> FIELDS = Set.of(
        "receiver", "attributeKey", "attributeValueKind", "comparator", "comparisonValue");
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");

    private DamageModifierConditionSemantics() {}

    public record Condition(String attributeKey, SkillNumericValue comparisonValue) {}
    public record Parsed(Condition condition, List<Map<String, String>> issues) {}

    public static Parsed parse(JsonNode raw, String path) {
        if (raw == null || raw.isNull()) return new Parsed(null, List.of());
        List<Map<String, String>> issues = new ArrayList<>();
        if (!raw.isObject()) {
            issues.add(issue(path, "TYPE_MISMATCH", "生效条件必须是对象或空值"));
            return new Parsed(null, List.copyOf(issues));
        }
        raw.fieldNames().forEachRemaining(field -> {
            if (!FIELDS.contains(field)) issues.add(issue(path + "." + field, "UNKNOWN_FIELD", "生效条件包含未知字段"));
        });
        fixed(raw, "receiver", "ENEMY_CHAMPION", path, issues);
        String attributeKey = text(raw, "attributeKey", path, issues);
        if (attributeKey != null && !KEY.matcher(attributeKey).matches()) {
            issues.add(issue(path + ".attributeKey", "INVALID_VALUE", "属性标识格式不合法"));
        }
        fixed(raw, "attributeValueKind", "CURRENT_RATIO", path, issues);
        String comparator = text(raw, "comparator", path, issues);
        if (comparator != null && !Set.of("LT", "GT").contains(comparator)) {
            issues.add(issue(path + ".comparator", "INVALID_VALUE", "比较方式仅支持严格小于或大于"));
        }
        SkillNumericValue value = null;
        JsonNode rawValue = raw.get("comparisonValue");
        if (rawValue == null || rawValue.isNull()) {
            issues.add(issue(path + ".comparisonValue", "REQUIRED", "比较值不能为空"));
        } else {
            try { value = SkillNumericValue.fromJson(rawValue); }
            catch (IllegalArgumentException ex) {
                issues.add(issue(path + ".comparisonValue", "VALUE_SHAPE_INVALID", "比较值必须使用统一数值取值形状"));
            }
        }
        return new Parsed(issues.isEmpty() ? new Condition(attributeKey, value) : null, List.copyOf(issues));
    }

    private static void fixed(JsonNode raw, String field, String expected, String path,
                              List<Map<String, String>> issues) {
        String value = text(raw, field, path, issues);
        if (value != null && !expected.equals(value)) {
            issues.add(issue(path + "." + field, "INVALID_VALUE", "当前生效条件不支持该取值"));
        }
    }

    private static String text(JsonNode raw, String field, String path, List<Map<String, String>> issues) {
        JsonNode value = raw.get(field);
        if (value == null || value.isNull()) {
            issues.add(issue(path + "." + field, "REQUIRED", "字段不能为空"));
            return null;
        }
        if (!value.isTextual() || value.textValue().isBlank()) {
            issues.add(issue(path + "." + field, "TYPE_MISMATCH", "字段必须是非空文本"));
            return null;
        }
        return value.textValue();
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }
}
