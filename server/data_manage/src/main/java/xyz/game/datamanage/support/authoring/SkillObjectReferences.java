package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import xyz.game.datamanage.model.value.SkillNumericValue;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.error.ApiException;

/** 按已定义的业务字段提取引用；内部标识始终携带所属技能及所属对象。 */
public final class SkillObjectReferences {
    private SkillObjectReferences() {}

    public enum SourceType { FORMULA, EFFECT, STATE, PROCESS, TRIGGER }
    public enum TargetType {
        ATTRIBUTE, PARAMETER, FORMULA, SKILL, CATEGORY, DAMAGE_TYPE, MODIFIER_ZONE, STATUS,
        EFFECT, RESULT, LIFECYCLE, STATE, OPTION, PROCESS, STEP, ACTION
    }

    public record Aggregate(SourceType type, String skillKey, String key, JsonNode data) {}
    public record Target(TargetType type, String skillKey, String key, String subKey) {
        public Target {
            if (type == null || skillKey == null || key == null || subKey == null) {
                throw new IllegalArgumentException("引用目标字段不能为 null");
            }
        }
    }
    public record Reference(String gameId, String sourceSkillKey, SourceType sourceType,
                            String sourceKey, String fieldPath, Target target) {}

    /** 字典和参数由保留表提供；五类对象与结果、生命周期、模式、步骤和动作从当前聚合生成。 */
    public static List<Reference> extractAndValidate(String gameId, List<Aggregate> aggregates,
                                                    Set<Target> dictionaryAndParameters) {
        Set<Target> targets = new HashSet<>(dictionaryAndParameters);
        for (Aggregate aggregate : aggregates) index(aggregate, targets);
        List<Reference> references = new ArrayList<>();
        for (Aggregate aggregate : aggregates) {
            Collector collector = new Collector(gameId, aggregate, references);
            collector.collect();
        }
        List<Map<String, String>> issues = new ArrayList<>();
        for (Reference ref : references) {
            if (!targets.contains(ref.target())) {
                Target target = ref.target();
                issues.add(Map.of("field", ref.fieldPath(), "code", "MISSING_REFERENCE_TARGET",
                    "sourceSkillKey", ref.sourceSkillKey(), "sourceType", ref.sourceType().name(),
                    "sourceKey", ref.sourceKey(), "targetType", target.type().name(),
                    "targetSkillKey", target.skillKey(), "targetKey", target.key(),
                    "targetSubKey", target.subKey()));
            }
        }
        if (!issues.isEmpty()) throw invalid("引用目标不存在，不能保存或移除被引用对象", issues);
        return List.copyOf(new LinkedHashSet<>(references));
    }

    private static void index(Aggregate aggregate, Set<Target> targets) {
        if (aggregate.data() == null || !aggregate.data().isObject()) {
            throw invalid("技能组成缺少结构化内容", List.of(Map.of("field", aggregate.key())));
        }
        String skill = aggregate.skillKey();
        String key = aggregate.key();
        JsonNode data = aggregate.data();
        switch (aggregate.type()) {
            case FORMULA -> targets.add(new Target(TargetType.FORMULA, skill, key, ""));
            case EFFECT -> {
                targets.add(new Target(TargetType.EFFECT, skill, key, ""));
                indexChildren(aggregate, targets, TargetType.RESULT, array(data, "results"), "resultKey");
                if (present(data.get("lifecycle"))) targets.add(new Target(TargetType.LIFECYCLE, skill, key, ""));
            }
            case STATE -> {
                targets.add(new Target(TargetType.STATE, skill, key, ""));
                if ("MODE".equals(text(data, "stateType"))) {
                    indexChildren(aggregate, targets, TargetType.OPTION, array(data.path("detail"), "options"), "optionKey");
                }
            }
            case PROCESS -> {
                targets.add(new Target(TargetType.PROCESS, skill, key, ""));
                indexChildren(aggregate, targets, TargetType.STEP, array(data, "steps"), "stepKey");
            }
            case TRIGGER -> indexChildren(aggregate, targets, TargetType.ACTION, array(data, "actions"), "actionKey");
        }
    }

    private static void indexChildren(Aggregate source, Set<Target> targets, TargetType type,
                                      JsonNode children, String keyField) {
        for (JsonNode child : children) {
            String key = text(child, keyField);
            if (key == null || !targets.add(new Target(type, source.skillKey(), source.key(), key))) {
                throw invalid("技能组成的内部标识缺失或重复", List.of(Map.of("field", keyField,
                    "sourceSkillKey", source.skillKey(), "sourceKey", source.key())));
            }
        }
    }

    private static final class Collector {
        private final String gameId;
        private final Aggregate source;
        private final List<Reference> references;

        private Collector(String gameId, Aggregate source, List<Reference> references) {
            this.gameId = gameId;
            this.source = source;
            this.references = references;
        }

        private void collect() {
            switch (source.type()) {
                case FORMULA -> formula(source.data().path("expression"), "expression", 1);
                case EFFECT -> effect();
                case STATE -> state();
                case PROCESS -> process();
                case TRIGGER -> trigger();
            }
        }

        private void formula(JsonNode node, String path, int depth) {
            if (depth > 32) throw shape(path, "公式表达式超过 32 层");
            switch (required(node, "nodeType", path)) {
                case "PARAMETER" -> local(node, path, "parameterKey", TargetType.PARAMETER);
                case "ATTRIBUTE" -> dictionary(node, path, "attributeKey", TargetType.ATTRIBUTE);
                case "OPERATION" -> {
                    JsonNode operands = array(node, "operands");
                    if (operands.size() != 2) throw shape(path, "运算节点必须有两个子节点");
                    for (int i = 0; i < operands.size(); i++) formula(operands.get(i), path + ".operands[" + i + "]", depth + 1);
                }
                default -> throw shape(path, "未知公式节点类型");
            }
        }

        private void effect() {
            JsonNode data = source.data();
            formulas(data.path("lifecycle"), "lifecycle", "durationValue", "maxStacksValue",
                "applicationStacksValue", "periodicIntervalValue");
            JsonNode results = array(data, "results");
            for (int i = 0; i < results.size(); i++) {
                JsonNode result = results.get(i);
                String path = "results[" + i + "]";
                formulas(result.path("valueRule"), path + ".valueRule", "value");
                if (present(result.get("lifecycleBehavior"))) {
                    add(path + ".lifecycleBehavior", TargetType.LIFECYCLE, source.skillKey(), source.key(), "");
                }
                JsonNode detail = result.path("detail");
                String dp = path + ".detail";
                switch (required(result, "resultType", path)) {
                    case "DAMAGE" -> {
                        dictionary(detail, dp, "damageTypeKey", TargetType.DAMAGE_TYPE);
                        formulas(detail.path("critical"), dp + ".critical", "multiplierValue");
                        JsonNode rules = array(detail, "vampRules");
                        for (int v = 0; v < rules.size(); v++) formulas(rules.get(v), dp + ".vampRules[" + v + "]", "efficiencyValue");
                    }
                    case "NORMAL_SHIELD" -> dictionary(detail, dp, "absorbedDamageTypeKey", TargetType.DAMAGE_TYPE);
                    case "ATTRIBUTE_CHANGE" -> {
                        dictionary(detail, dp, "attributeKey", TargetType.ATTRIBUTE);
                        dictionary(detail, dp, "modifierZoneKey", TargetType.MODIFIER_ZONE);
                    }
                    case "RESOURCE_CHANGE", "HEALTH_FLOOR", "EXECUTE" -> dictionary(detail, dp, "attributeKey", TargetType.ATTRIBUTE);
                    case "COOLDOWN_CHANGE", "SKILL_HASTE_MODIFIER" -> skillScope(detail.path("affectedSkillScope"), dp + ".affectedSkillScope");
                    case "STATUS_OPERATION" -> dictionary(detail, dp, "statusKey", TargetType.STATUS);
                    case "LIFECYCLE_OPERATION" -> local(detail, dp, "targetEffectKey", TargetType.LIFECYCLE);
                    case "DAMAGE_MODIFIER" -> {
                        dictionary(detail, dp, "modifierZoneKey", TargetType.MODIFIER_ZONE);
                        dictionary(detail, dp, "damageTypeKey", TargetType.DAMAGE_TYPE);
                    }
                    case "HEALING_MODIFIER", "SHIELD_RECEIVED_MODIFIER" -> dictionary(detail, dp, "modifierZoneKey", TargetType.MODIFIER_ZONE);
                    case "DAMAGE_IMMUNITY" -> dictionary(detail, dp, "damageTypeKey", TargetType.DAMAGE_TYPE);
                    case "DIRECT_HEAL", "SPELL_SHIELD", "HIT_LINK_APPLICATION", "ATTACK_LINK_APPLICATION" -> { }
                    default -> throw shape(path, "未知效果结果类型");
                }
            }
        }

        private void skillScope(JsonNode scope, String path) {
            switch (required(scope, "mode", path)) {
                case "ALL" -> { }
                case "SKILLS" -> dictionaryKeys(scope, path, "skillKeys", TargetType.SKILL);
                case "CATEGORIES" -> dictionaryKeys(scope, path, "skillCategoryKeys", TargetType.CATEGORY);
                default -> throw shape(path, "未知技能作用范围");
            }
        }

        private void state() {
            JsonNode detail = source.data().path("detail");
            switch (required(source.data(), "stateType", "stateType")) {
                case "COUNTER" -> formulas(detail, "detail", "initialValue", "maxValue");
                case "AMMO" -> formulas(detail, "detail", "initialValue", "maxValue", "recoveryIntervalValue");
                case "INTERNAL_COOLDOWN" -> formulas(detail, "detail", "durationValue");
                case "MODE", "FLAG" -> { }
                default -> throw shape("stateType", "未知内部状态类型");
            }
        }

        private void process() {
            JsonNode data = source.data();
            JsonNode steps = array(data, "steps");
            for (int i = 0; i < steps.size(); i++) {
                JsonNode step = steps.get(i);
                String path = "steps[" + i + "]";
                JsonNode detail = step.path("detail");
                String dp = path + ".detail";
                switch (required(step, "stepType", path)) {
                    case "DELAY" -> formulas(detail, dp, "delayValue");
                    case "MULTI_HIT", "PERIODIC" -> formulas(detail, dp, "repeatCountValue", "intervalValue");
                    case "CHANNEL" -> formulas(detail, dp, "durationValue", "executionCountValue");
                    case "CHARGE" -> formulas(detail, dp, "minimumChargeValue", "maximumChargeValue");
                    case "RECAST" -> formulas(detail, dp, "windowValue", "maximumRecastCountValue");
                    case "EMPOWERED_BASIC_ATTACK" -> formulas(detail, dp, "windowValue");
                    case "IMMEDIATE" -> { }
                    default -> throw shape(path, "未知过程步骤类型");
                }
            }
            JsonNode cooldown = data.path("cooldown");
            formulas(cooldown, "cooldown", "durationValue");
            moment(cooldown.path("startMoment"), "cooldown.startMoment", source.key());
            JsonNode bindings = array(data, "effectBindings");
            for (int i = 0; i < bindings.size(); i++) {
                JsonNode binding = bindings.get(i);
                String path = "effectBindings[" + i + "]";
                local(binding, path, "effectKey", TargetType.EFFECT);
                moment(binding.path("moment"), path + ".moment", source.key());
            }
            JsonNode operations = array(data, "stateOperations");
            for (int i = 0; i < operations.size(); i++) {
                JsonNode operation = operations.get(i);
                String path = "stateOperations[" + i + "]";
                local(operation, path, "stateKey", TargetType.STATE);
                formulas(operation, path, "value");
                child(operation, path, "optionKey", TargetType.OPTION, text(operation, "stateKey"));
                moment(operation.path("moment"), path + ".moment", source.key());
            }
        }

        private void trigger() {
            JsonNode data = source.data();
            event(data.path("eventSource"));
            JsonNode groups = array(data, "conditionGroups");
            for (int g = 0; g < groups.size(); g++) {
                JsonNode conditions = array(groups.get(g), "conditions");
                for (int i = 0; i < conditions.size(); i++) condition(conditions.get(i), "conditionGroups[" + g + "].conditions[" + i + "]");
            }
            JsonNode actions = array(data, "actions");
            Map<String, JsonNode> actionsByKey = new HashMap<>();
            for (JsonNode action : actions) actionsByKey.put(text(action, "actionKey"), action);
            for (int i = 0; i < actions.size(); i++) action(actions.get(i), "actions[" + i + "]", actionsByKey);
            JsonNode limits = data.path("limits");
            formulas(limits.path("perTargetCooldown"), "limits.perTargetCooldown", "durationValue");
            JsonNode processLimit = limits.path("maxTriggersPerProcess");
            local(processLimit, "limits.maxTriggersPerProcess", "processKey", TargetType.PROCESS);
            formulas(processLimit, "limits.maxTriggersPerProcess", "limitValue");
        }

        private void event(JsonNode event) {
            JsonNode detail = event.path("detail");
            String path = "eventSource.detail";
            switch (required(event, "eventType", "eventSource")) {
                case "SKILL_USED", "SKILL_HIT", "HIT_LINK_APPLIED", "ATTACK_LINK_APPLIED" -> dictionary(detail, path, "sourceSkillKey", TargetType.SKILL);
                case "PROCESS_MOMENT" -> {
                    local(detail, path, "processKey", TargetType.PROCESS);
                    moment(detail.path("moment"), path + ".moment", text(detail, "processKey"));
                }
                case "PROCESS_CANCEL_REQUESTED" -> local(detail, path, "processKey", TargetType.PROCESS);
                case "RESULT_AVAILABLE" -> {
                    local(detail, path, "effectKey", TargetType.EFFECT);
                    child(detail, path, "resultKey", TargetType.RESULT, text(detail, "effectKey"));
                }
                case "LIFECYCLE_MOMENT" -> local(detail, path, "effectKey", TargetType.LIFECYCLE);
                case "DAMAGE_PENDING", "DAMAGE_DEALT", "DAMAGE_TAKEN" -> dictionary(detail, path, "damageTypeKey", TargetType.DAMAGE_TYPE);
                case "STATUS_CHANGED" -> dictionary(detail, path, "statusKey", TargetType.STATUS);
                case "HEALTH_THRESHOLD_CROSSED" -> {
                    dictionary(detail, path, "attributeKey", TargetType.ATTRIBUTE);
                    formulas(detail, path, "thresholdValue");
                }
                case "INTERNAL_STATE_CHANGED" -> local(detail, path, "stateKey", TargetType.STATE);
                case "SPELL_SHIELD_BLOCKED" -> local(detail, path, "shieldEffectKey", TargetType.EFFECT);
                case "SOURCE_INITIALIZED", "BASIC_ATTACK_START", "BASIC_ATTACK_HIT", "CONTROL_RECEIVED", "ENTITY_DIED", "ENTITY_UNTARGETABLE", "KILL" -> { }
                default -> throw shape("eventSource", "未知触发事件类型");
            }
        }

        private void condition(JsonNode condition, String path) {
            JsonNode detail = condition.path("detail");
            String dp = path + ".detail";
            switch (required(condition, "conditionType", path)) {
                case "ATTRIBUTE_COMPARE" -> {
                    dictionary(detail, dp, "attributeKey", TargetType.ATTRIBUTE);
                    formulas(detail, dp, "comparisonValue");
                }
                case "STATUS_CHECK" -> {
                    statusSource(detail, dp);
                    formulas(detail, dp, "comparisonValue");
                }
                case "INTERNAL_STATE_CHECK" -> {
                    local(detail, dp, "stateKey", TargetType.STATE);
                    child(detail, dp, "optionKey", TargetType.OPTION, text(detail, "stateKey"));
                    formulas(detail, dp, "comparisonValue");
                }
                case "LIFECYCLE_CHECK" -> {
                    local(detail, dp, "effectKey", TargetType.LIFECYCLE);
                    formulas(detail, dp, "comparisonValue");
                }
                case "TARGET_CATEGORY_CHECK" -> { /* 固定类别不生成引用。 */ }
                case "EXPLICIT_TARGET_IS_SOURCE" -> { /* 显式目标身份检查不生成引用。 */ }
                case "SKILL_HIT_TARGET_IS_ENEMY" -> { /* 命中对象敌我关系检查不生成引用。 */ }
                case "EVENT_VALUE_COMPARE" -> formulas(detail, dp, "comparisonValue");
                default -> throw shape(path, "未知触发条件类型");
            }
        }

        private void action(JsonNode action, String path, Map<String, JsonNode> actionsByKey) {
            JsonNode detail = action.path("detail");
            String effectKey = null;
            switch (required(action, "actionType", path)) {
                case "EXECUTE_EFFECT" -> {
                    local(detail, path + ".detail", "effectKey", TargetType.EFFECT);
                    effectKey = text(detail, "effectKey");
                }
                case "START_PROCESS", "FAIL_PROCESS" -> local(detail, path + ".detail", "processKey", TargetType.PROCESS);
                default -> throw shape(path, "未知触发动作类型");
            }
            JsonNode bindings = array(action, "runtimeInputBindings");
            for (int i = 0; i < bindings.size(); i++) {
                JsonNode binding = bindings.get(i);
                String bp = path + ".runtimeInputBindings[" + i + "]";
                local(binding, bp, "parameterKey", TargetType.PARAMETER);
                JsonNode bindingDetail = binding.path("detail");
                String dp = bp + ".detail";
                switch (required(binding, "sourceType", bp)) {
                    case "INTERNAL_STATE" -> {
                        local(bindingDetail, dp, "stateKey", TargetType.STATE);
                        child(bindingDetail, dp, "optionKey", TargetType.OPTION, text(bindingDetail, "stateKey"));
                    }
                    case "COMBAT_STATUS" -> statusSource(bindingDetail, dp);
                    case "SOURCE_CAST_RESOURCE_COST" -> dictionary(bindingDetail, dp, "attributeKey", TargetType.ATTRIBUTE);
                    case "PRIOR_ACTION_RESULT" -> {
                        child(bindingDetail, dp, "sourceActionKey", TargetType.ACTION, source.key());
                        JsonNode sourceAction = actionsByKey.get(text(bindingDetail, "sourceActionKey"));
                        if (sourceAction == null || !"EXECUTE_EFFECT".equals(text(sourceAction, "actionType"))) {
                            throw shape(dp + ".sourceActionKey", "前序结果必须引用本规则内执行效果的动作");
                        }
                        child(bindingDetail, dp, "sourceResultKey", TargetType.RESULT,
                            text(sourceAction.path("detail"), "effectKey"));
                    }
                    case "EVENT_VALUE" -> { }
                    default -> throw shape(bp, "未知动态输入来源");
                }
            }
            JsonNode modifiers = array(action, "resultModifiers");
            for (int i = 0; i < modifiers.size(); i++) child(modifiers.get(i), path + ".resultModifiers[" + i + "]",
                "resultKey", TargetType.RESULT, effectKey);
        }

        private void statusSource(JsonNode detail, String path) {
            dictionary(detail, path, "statusKey", TargetType.STATUS);
            local(detail, path, "sourceEffectKey", TargetType.EFFECT);
            child(detail, path, "sourceResultKey", TargetType.RESULT, text(detail, "sourceEffectKey"));
        }

        private void moment(JsonNode moment, String path, String processKey) {
            child(moment, path, "stepKey", TargetType.STEP, processKey);
        }

        private void formulas(JsonNode node, String path, String... fields) {
            for (String field : fields) {
                JsonNode raw = node.get(field);
                if (raw == null || raw.isNull()) continue;
                SkillNumericValue value;
                try { value = SkillNumericValue.fromJson(raw); }
                catch (IllegalArgumentException ex) { throw shape(path + "." + field, "数值取值形状不合法"); }
                if (value.kind() == SkillNumericValue.Kind.FORMULA) add(path + "." + field + ".formulaKey", TargetType.FORMULA, source.skillKey(), value.formulaKey(), "");
                if (value.kind() == SkillNumericValue.Kind.PARAMETER) add(path + "." + field + ".parameterKey", TargetType.PARAMETER, source.skillKey(), value.parameterKey(), "");
            }
        }

        private void local(JsonNode node, String path, String field, TargetType type) {
            String key = text(node, field);
            if (key != null) add(path + "." + field, type, source.skillKey(), key, "");
        }

        private void dictionary(JsonNode node, String path, String field, TargetType type) {
            String key = text(node, field);
            if (key != null) add(path + "." + field, type, "", key, "");
        }

        private void dictionaryKeys(JsonNode node, String path, String field, TargetType type) {
            JsonNode keys = array(node, field);
            for (int i = 0; i < keys.size(); i++) {
                if (!keys.get(i).isTextual() || keys.get(i).asText().isBlank()) throw shape(path + "." + field, "引用标识必须为非空字符串");
                add(path + "." + field + "[" + i + "]", type, "", keys.get(i).asText(), "");
            }
        }

        private void child(JsonNode node, String path, String field, TargetType type, String parentKey) {
            String subKey = text(node, field);
            if (subKey == null) return;
            if (parentKey == null) throw shape(path + "." + field, "引用子项缺少所属对象标识");
            add(path + "." + field, type, source.skillKey(), parentKey, subKey);
        }

        private void add(String path, TargetType type, String skillKey, String key, String subKey) {
            references.add(new Reference(gameId, source.skillKey(), source.type(), source.key(), path,
                new Target(type, skillKey, key, subKey)));
        }

        private ApiException shape(String path, String message) {
            return invalid(message, List.of(Map.of("field", path, "sourceSkillKey", source.skillKey(),
                "sourceType", source.type().name(), "sourceKey", source.key())));
        }
    }

    private static boolean present(JsonNode value) { return value != null && !value.isNull() && !value.isMissingNode(); }

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (!present(value)) return null;
        if (!value.isTextual() || value.asText().isBlank()) {
            throw invalid("引用标识必须为非空字符串", List.of(Map.of("field", field)));
        }
        return value.asText();
    }

    private static String required(JsonNode node, String field, String path) {
        String value = text(node, field);
        if (value == null) throw invalid("技能组成缺少类型字段", List.of(Map.of("field", path + "." + field)));
        return value;
    }

    private static JsonNode array(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (!present(value)) return AggregateJson.tree("[]");
        if (!value.isArray()) throw invalid("技能组成的集合字段形状错误", List.of(Map.of("field", field)));
        return value;
    }

    private static ApiException invalid(String message, List<Map<String, String>> issues) {
        return new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID", message,
            Map.of("fieldIssues", List.copyOf(issues)));
    }
}
