package xyz.game.datamanage.model.character;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonValue;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** 角色录入检查的结构化定位，形状与前端 authoring-p8-r2 契约同名。 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record AuthoringCheckLocation(
    String skillKey,
    String objectType,
    String objectKey,
    String editor,
    String fieldPath,
    String precision,
    String degradeReason,
    List<AuthoringCheckLocationSegment> segments,
    JsonNode formulaSnapshot
) {
    public static final List<String> EDITORS = List.of(
        "CHARACTER_BASIC", "CHARACTER_ATTRIBUTES", "CHARACTER_RELATIONS", "SKILL_BASIC",
        "PARAMETER", "FORMULA", "EFFECT", "PROCESS", "INTERNAL_STATE", "TRIGGER_RULE"
    );
    public static final List<String> REASONS = List.of(
        "MISSING_KEY", "DUPLICATE_KEY", "TYPE_CHANGED", "NODE_MISSING", "UNKNOWN_FIELD",
        "OBJECT_MISSING", "CORRUPT_OBJECT"
    );
    public static final Map<String, String> COLLECTION_KEYS = Map.ofEntries(
        Map.entry("results", "resultKey"),
        Map.entry("steps", "stepKey"),
        Map.entry("effectBindings", "bindingKey"),
        Map.entry("stateOperations", "operationKey"),
        Map.entry("options", "optionKey"),
        Map.entry("conditionGroups", "groupKey"),
        Map.entry("conditions", "conditionKey"),
        Map.entry("actions", "actionKey"),
        Map.entry("runtimeInputBindings", "bindingKey"),
        Map.entry("vampOverrides", "vampType"),
        Map.entry("resultModifiers", "resultKey")
    );
    public static final Set<String> VALUE_COLLECTIONS = Set.of("skillKeys", "skillCategoryKeys");
    private static final Set<String> PRECISIONS = Set.of("FIELD", "OBJECT", "NONE");

    public AuthoringCheckLocation {
        objectType = Objects.requireNonNull(objectType, "objectType");
        objectKey = Objects.requireNonNull(objectKey, "objectKey");
        fieldPath = fieldPath == null ? "" : fieldPath;
        segments = List.copyOf(segments == null ? List.of() : segments);
        if (!PRECISIONS.contains(precision)) throw invalid("定位精度不合法");
        if (editor != null && !EDITORS.contains(editor)) throw invalid("定位入口不合法");
        if (degradeReason != null && !REASONS.contains(degradeReason)) throw invalid("定位降级原因不合法");
        if ((precision.equals("NONE")) != (editor == null)) throw invalid("无入口时入口必须为空");
        if (precision.equals("FIELD") ? degradeReason != null : degradeReason == null) {
            throw invalid("精确字段不能带降级原因");
        }
        if (formulaSnapshot != null && !formulaSnapshot.isObject()) throw invalid("公式快照必须是对象");
        if (formulaSnapshot != null && !"FORMULA".equals(editor)) throw invalid("只有公式入口可以携带表达式快照");
        if (segments.stream().anyMatch(segment -> segment instanceof AuthoringCheckLocationSegment.FormulaOperand)
            && formulaSnapshot == null) {
            throw invalid("公式操作数必须携带完整表达式快照");
        }
    }

    public sealed interface AuthoringCheckLocationSegment
        permits AuthoringCheckLocationSegment.Field,
            AuthoringCheckLocationSegment.KeyedChild,
            AuthoringCheckLocationSegment.ValueChild,
            AuthoringCheckLocationSegment.FormulaOperand,
            AuthoringCheckLocationSegment.ExpectValue {

        @JsonValue
        LinkedHashMap<String, Object> asJson();

        record Field(String field) implements AuthoringCheckLocationSegment {
            public Field {
                if (!validField(field)) throw invalid("定位字段不合法");
            }

            @Override
            public LinkedHashMap<String, Object> asJson() {
                LinkedHashMap<String, Object> json = new LinkedHashMap<>();
                json.put("kind", "FIELD");
                json.put("field", field);
                return json;
            }
        }

        record KeyedChild(String collection, String keyField, String key) implements AuthoringCheckLocationSegment {
            public KeyedChild {
                if (!COLLECTION_KEYS.containsKey(collection)
                    || !COLLECTION_KEYS.get(collection).equals(keyField)
                    || key == null || key.isEmpty()) {
                    throw invalid("有键子项定位不合法");
                }
            }

            @Override
            public LinkedHashMap<String, Object> asJson() {
                LinkedHashMap<String, Object> json = new LinkedHashMap<>();
                json.put("kind", "KEYED_CHILD");
                json.put("collection", collection);
                json.put("keyField", keyField);
                json.put("key", key);
                return json;
            }
        }

        record ValueChild(String collection, String value) implements AuthoringCheckLocationSegment {
            public ValueChild {
                if (!VALUE_COLLECTIONS.contains(collection) || value == null || value.isEmpty()) {
                    throw invalid("字符串集合定位不合法");
                }
            }

            @Override
            public LinkedHashMap<String, Object> asJson() {
                LinkedHashMap<String, Object> json = new LinkedHashMap<>();
                json.put("kind", "VALUE_CHILD");
                json.put("collection", collection);
                json.put("value", value);
                return json;
            }
        }

        record FormulaOperand(int operand) implements AuthoringCheckLocationSegment {
            public FormulaOperand {
                if (operand != 0 && operand != 1) throw invalid("公式操作数只能是 0 或 1");
            }

            @Override
            public LinkedHashMap<String, Object> asJson() {
                LinkedHashMap<String, Object> json = new LinkedHashMap<>();
                json.put("kind", "FORMULA_OPERAND");
                json.put("operand", operand);
                return json;
            }
        }

        record ExpectValue(String field, Object value) implements AuthoringCheckLocationSegment {
            public ExpectValue {
                if (!validField(field) || !validScalar(value)) throw invalid("期望值定位不合法");
            }

            @Override
            public LinkedHashMap<String, Object> asJson() {
                LinkedHashMap<String, Object> json = new LinkedHashMap<>();
                json.put("kind", "EXPECT_VALUE");
                json.put("field", field);
                json.put("value", value);
                return json;
            }
        }
    }

    public static boolean validField(String field) {
        return field != null && field.matches("^[A-Za-z][A-Za-z0-9_]*$")
            && !Set.of("constructor", "prototype", "__proto__").contains(field);
    }

    public static boolean validScalar(Object value) {
        return value == null || value instanceof String || value instanceof Boolean
            || value instanceof Integer || value instanceof Long
            || value instanceof Double && Double.isFinite((Double) value);
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }
}
