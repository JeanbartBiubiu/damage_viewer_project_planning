package xyz.game.datamanage.service.character;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import xyz.game.datamanage.model.character.AuthoringCheckLocation;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.ExpectValue;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.Field;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.FormulaOperand;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.KeyedChild;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.ValueChild;

/** 从本次检查读取的保存树提取稳定定位；无 IO、不写库。 */
public final class AuthoringCheckLocationResolver {
    private static final Pattern TOKEN = Pattern.compile("^([A-Za-z][A-Za-z0-9_]*|\\d+)(?:\\[(\\d+)\\])?$");
    private static final List<String> TYPE_FIELDS = List.of(
        "stateType", "resultType", "stepType", "conditionType", "actionType",
        "sourceType", "nodeType", "eventType", "operation", "mode"
    );
    private static final List<String> PARENT_FIELDS = List.of("effectKey", "stateKey", "processKey", "sourceSkillKey");
    private static final Set<String> CHILD_REF_FIELDS = Set.of("resultKey", "optionKey", "stepKey", "moment");
    private static final Map<String, String> COLLECTION_KEYS = AuthoringCheckLocation.COLLECTION_KEYS;
    private static final Set<String> VALUE_COLLECTIONS = AuthoringCheckLocation.VALUE_COLLECTIONS;

    private AuthoringCheckLocationResolver() { }

    public static AuthoringCheckLocation resolve(String skillKey, String objectType, String objectKey,
                                                 String fieldPath, JsonNode rawSavedObject) {
        String path = fieldPath == null ? "" : fieldPath;
        String type = objectType == null ? "" : objectType;
        String key = objectKey == null ? "" : objectKey;
        String editor = editorFor(type, path);
        if (editor == null) {
            return location(skillKey, type, key, null, path, "NONE", "OBJECT_MISSING", List.of(), null);
        }
        if (rawSavedObject == null) {
            return location(skillKey, type, key, editor, path, "OBJECT", "OBJECT_MISSING", List.of(), null);
        }
        if (!rawSavedObject.isObject()) {
            return location(skillKey, type, key, editor, path, "OBJECT", "CORRUPT_OBJECT", List.of(), null);
        }
        if (path.isEmpty()) {
            return location(skillKey, type, key, editor, path, "OBJECT", "UNKNOWN_FIELD", List.of(), null);
        }
        List<PathToken> tokens = parsePath(path);
        if (tokens == null) {
            return location(skillKey, type, key, editor, path, "OBJECT", "UNKNOWN_FIELD", List.of(), null);
        }
        return toDetailShape(new Walk(skillKey, type, key, editor, path, rawSavedObject).run(tokens));
    }

    /** 存储的 limits 包装在管理详情中已展开；基本字段检查的 key 对应各对象真实键字段。 */
    private static AuthoringCheckLocation toDetailShape(AuthoringCheckLocation location) {
        List<AuthoringCheckLocationSegment> segments = new ArrayList<>(location.segments());
        int firstMove = 0;
        while (firstMove < segments.size() && segments.get(firstMove) instanceof ExpectValue) firstMove++;
        if (firstMove < segments.size() && segments.get(firstMove) instanceof Field field) {
            if ("TRIGGER".equals(location.objectType()) && "limits".equals(field.field())) {
                segments.remove(firstMove);
                if (segments.size() == firstMove) return location(location.skillKey(), location.objectType(), location.objectKey(),
                    location.editor(), location.fieldPath(), "OBJECT", "UNKNOWN_FIELD", segments, location.formulaSnapshot());
            } else if ("key".equals(field.field())) {
                String keyField = switch (location.objectType()) {
                    case "PARAMETER" -> "parameterKey";
                    case "FORMULA" -> "formulaKey";
                    case "EFFECT" -> "effectKey";
                    case "PROCESS" -> "processKey";
                    case "STATE" -> "stateKey";
                    case "TRIGGER" -> "ruleKey";
                    default -> "key";
                };
                segments.set(firstMove, new Field(keyField));
            }
        }
        return location(location.skillKey(), location.objectType(), location.objectKey(), location.editor(), location.fieldPath(),
            location.precision(), location.degradeReason(), segments, location.formulaSnapshot());
    }

    /** 缺失挂载技能由调用方显式声明，不把空 JSON 猜成技能已删除。 */
    public static AuthoringCheckLocation missingSkill(String skillKey, String objectKey, String fieldPath) {
        String path = fieldPath == null ? "" : fieldPath;
        return location(skillKey, "SKILL", objectKey == null ? "" : objectKey, "CHARACTER_RELATIONS",
            path, "OBJECT", "OBJECT_MISSING", List.of(), null);
    }

    private static String editorFor(String objectType, String fieldPath) {
        return switch (objectType) {
            case "CHARACTER" -> firstName(fieldPath).equals("skills") ? "CHARACTER_RELATIONS" : "CHARACTER_BASIC";
            case "CHARACTER_ATTRIBUTES" -> "CHARACTER_ATTRIBUTES";
            case "CHARACTER_SKILL_RELATION" -> "CHARACTER_RELATIONS";
            case "SKILL" -> "SKILL_BASIC";
            case "PARAMETER" -> "PARAMETER";
            case "FORMULA" -> "FORMULA";
            case "EFFECT" -> "EFFECT";
            case "PROCESS" -> "PROCESS";
            case "STATE" -> "INTERNAL_STATE";
            case "TRIGGER" -> "TRIGGER_RULE";
            default -> null;
        };
    }

    private static String firstName(String fieldPath) {
        List<PathToken> tokens = parsePath(fieldPath == null ? "" : fieldPath);
        return tokens == null || tokens.isEmpty() ? "" : tokens.getFirst().name();
    }

    private static List<PathToken> parsePath(String fieldPath) {
        if (fieldPath.isEmpty()) return List.of();
        String[] parts = fieldPath.split("\\.", -1);
        List<PathToken> tokens = new ArrayList<>();
        for (String part : parts) {
            Matcher matcher = TOKEN.matcher(part);
            if (part.isEmpty() || !matcher.matches()) return null;
            Integer index;
            try { index = matcher.group(2) == null ? null : Integer.valueOf(matcher.group(2)); }
            catch (NumberFormatException ignored) { return null; }
            tokens.add(new PathToken(matcher.group(1), index));
        }
        return tokens;
    }

    private static AuthoringCheckLocation location(String skillKey, String objectType, String objectKey, String editor,
                                                   String fieldPath, String precision, String reason,
                                                   List<AuthoringCheckLocationSegment> segments, JsonNode snapshot) {
        return new AuthoringCheckLocation(skillKey, objectType, objectKey, editor, fieldPath, precision, reason,
            segments, snapshot);
    }

    private record PathToken(String name, Integer index) {
        boolean indexed() { return index != null; }
    }

    private static final class Walk {
        private final String skillKey;
        private final String objectType;
        private final String objectKey;
        private final String editor;
        private final String fieldPath;
        private final List<AuthoringCheckLocationSegment> segments = new ArrayList<>();
        private final Set<String> emittedExpects = new LinkedHashSet<>();
        private JsonNode current;
        private JsonNode formulaSnapshot;
        private String reason;

        private Walk(String skillKey, String objectType, String objectKey, String editor, String fieldPath, JsonNode root) {
            this.skillKey = skillKey;
            this.objectType = objectType;
            this.objectKey = objectKey;
            this.editor = editor;
            this.fieldPath = fieldPath;
            this.current = root;
        }

        private AuthoringCheckLocation run(List<PathToken> tokens) {
            for (PathToken token : tokens) {
                if (reason != null) break;
                if (current == null || !current.isObject()) {
                    reason = "NODE_MISSING";
                    break;
                }
                if (token.indexed()) enterCollection(token);
                else enterField(token.name());
            }
            if (reason == null && (current == null || current.isMissingNode())) reason = "NODE_MISSING";
            String precision = reason == null ? "FIELD" : "OBJECT";
            return location(skillKey, objectType, objectKey, editor, fieldPath, precision, reason, segments, formulaSnapshot);
        }

        private void enterField(String name) {
            if (!AuthoringCheckLocation.validField(name)) {
                reason = "UNKNOWN_FIELD";
                return;
            }
            if (!current.has(name)) {
                reason = "UNKNOWN_FIELD";
                return;
            }
            emitBefore(name, false);
            if (reason != null) return;
            segments.add(new Field(name));
            JsonNode next = current.get(name);
            if ("expression".equals(name) && "FORMULA".equals(editor) && next != null && next.isObject()) {
                formulaSnapshot = next.deepCopy();
            }
            current = next;
            emittedExpects.clear();
        }

        private void enterCollection(PathToken token) {
            String name = token.name();
            int index = token.index();
            if (!AuthoringCheckLocation.validField(name)) {
                reason = "UNKNOWN_FIELD";
                return;
            }
            if ("operands".equals(name)) {
                enterOperand(index);
                return;
            }
            if (VALUE_COLLECTIONS.contains(name)) {
                enterValueChild(name, index);
                return;
            }
            if (COLLECTION_KEYS.containsKey(name)) {
                enterKeyedChild(name, index);
                return;
            }
            reason = "UNKNOWN_FIELD";
        }

        private void enterOperand(int index) {
            emitBefore("operands", true);
            if (reason != null) return;
            JsonNode operands = current.get("operands");
            if (!"OPERATION".equals(text(current.get("nodeType")))
                || operands == null || !operands.isArray() || operands.size() != 2
                || index != 0 && index != 1) {
                reason = "TYPE_CHANGED";
                return;
            }
            if (formulaSnapshot == null) {
                reason = "TYPE_CHANGED";
                return;
            }
            segments.add(new FormulaOperand(index));
            current = operands.get(index);
            emittedExpects.clear();
        }

        private void enterKeyedChild(String collection, int index) {
            if (!current.has(collection)) {
                reason = "UNKNOWN_FIELD";
                return;
            }
            emitBefore(collection, true);
            if (reason != null) return;
            JsonNode array = current.get(collection);
            if (array == null || !array.isArray()) {
                reason = "NODE_MISSING";
                return;
            }
            if (index < 0 || index >= array.size()) {
                reason = "NODE_MISSING";
                return;
            }
            JsonNode child = array.get(index);
            if (child == null || !child.isObject()) {
                reason = "CORRUPT_OBJECT";
                return;
            }
            String keyField = COLLECTION_KEYS.get(collection);
            String key = text(child.get(keyField));
            if (key == null || key.isEmpty()) {
                reason = "MISSING_KEY";
                return;
            }
            int matches = 0;
            for (JsonNode node : array) {
                if (node != null && node.isObject() && key.equals(text(node.get(keyField)))) matches++;
            }
            if (matches != 1) {
                reason = "DUPLICATE_KEY";
                return;
            }
            segments.add(new KeyedChild(collection, keyField, key));
            current = child;
            emittedExpects.clear();
        }

        private void enterValueChild(String collection, int index) {
            if (!current.has(collection)) {
                reason = "UNKNOWN_FIELD";
                return;
            }
            emitBefore(collection, true);
            if (reason != null) return;
            JsonNode array = current.get(collection);
            if (array == null || !array.isArray()) {
                reason = "NODE_MISSING";
                return;
            }
            if (index < 0 || index >= array.size()) {
                reason = "NODE_MISSING";
                return;
            }
            String value = text(array.get(index));
            if (value == null || value.isEmpty()) {
                reason = "MISSING_KEY";
                return;
            }
            int matches = 0;
            for (JsonNode node : array) if (value.equals(text(node))) matches++;
            if (matches != 1) {
                reason = "DUPLICATE_KEY";
                return;
            }
            segments.add(new ValueChild(collection, value));
            current = array.get(index);
            emittedExpects.clear();
        }

        private void emitBefore(String nextField, boolean collection) {
            for (String field : TYPE_FIELDS) {
                if (!field.equals(nextField)) emitExpect(field);
            }
            if (collection || CHILD_REF_FIELDS.contains(nextField)) {
                for (String field : PARENT_FIELDS) {
                    if (!field.equals(nextField)) emitExpect(field);
                }
            }
        }

        private void emitExpect(String field) {
            if (emittedExpects.contains(field) || current == null || !current.has(field)) return;
            Object value = scalar(current.get(field));
            if (!AuthoringCheckLocation.validScalar(value) && value != null) return;
            if (!AuthoringCheckLocation.validField(field)) return;
            segments.add(new ExpectValue(field, value));
            emittedExpects.add(field);
        }

        private static String text(JsonNode node) {
            return node != null && node.isTextual() ? node.textValue() : null;
        }

        private static Object scalar(JsonNode node) {
            if (node == null || node.isNull()) return null;
            if (node.isTextual()) return node.textValue();
            if (node.isBoolean()) return node.booleanValue();
            if (node.isIntegralNumber() && node.canConvertToInt()) return node.intValue();
            if (node.isNumber() && Double.isFinite(node.doubleValue()) && !node.isIntegralNumber()) {
                return node.doubleValue();
            }
            if (node.isIntegralNumber() && node.canConvertToLong()) return node.longValue();
            return node;
        }
    }
}
