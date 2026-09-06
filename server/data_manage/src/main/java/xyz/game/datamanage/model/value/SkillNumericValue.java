package xyz.game.datamanage.model.value;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import java.math.BigDecimal;
import java.util.HashSet;
import java.util.Set;

/** 数值直接来自固定值、当前技能参数或当前技能公式。 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonDeserialize(using = SkillNumericValueDeserializer.class)
public record SkillNumericValue(Kind kind, BigDecimal value, String parameterKey, String formulaKey) {
    public enum Kind { FIXED, PARAMETER, FORMULA }

    public SkillNumericValue {
        if (kind == null) throw new IllegalArgumentException("取值来源不能为空");
        switch (kind) {
            case FIXED -> {
                if (value == null || parameterKey != null || formulaKey != null) throw invalid();
            }
            case PARAMETER -> {
                if (value != null || formulaKey != null || !validKey(parameterKey)) throw invalid();
            }
            case FORMULA -> {
                if (value != null || parameterKey != null || !validKey(formulaKey)) throw invalid();
            }
        }
    }

    public static SkillNumericValue fixed(BigDecimal value) { return new SkillNumericValue(Kind.FIXED, value, null, null); }
    public static SkillNumericValue parameter(String key) { return new SkillNumericValue(Kind.PARAMETER, null, key, null); }
    public static SkillNumericValue formula(String key) { return new SkillNumericValue(Kind.FORMULA, null, null, key); }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static SkillNumericValue fromJson(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (!node.isObject() || !node.path("kind").isTextual()) throw invalid();
        Kind kind;
        try { kind = Kind.valueOf(node.path("kind").textValue()); }
        catch (IllegalArgumentException ex) { throw invalid(); }
        Set<String> fields = new HashSet<>();
        node.fieldNames().forEachRemaining(fields::add);
        String field = switch (kind) { case FIXED -> "value"; case PARAMETER -> "parameterKey"; case FORMULA -> "formulaKey"; };
        if (!fields.equals(Set.of("kind", field))) throw invalid();
        JsonNode selected = node.get(field);
        if (kind == Kind.FIXED) {
            if (selected == null || !selected.isNumber()) throw invalid();
            return fixed(selected.decimalValue());
        }
        if (selected == null || !selected.isTextual()) throw invalid();
        return kind == Kind.PARAMETER ? parameter(selected.textValue()) : formula(selected.textValue());
    }

    private static boolean validKey(String key) { return key != null && key.matches("^[a-z][a-z0-9_]{0,63}$"); }
    private static IllegalArgumentException invalid() { return new IllegalArgumentException("数值取值必须是字段严格互斥的固定值、参数或公式对象"); }
}
