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

    public enum SourceType { FORMULA, EFFECT, STATE, PROCESS, TRIGGER, DAMAGE_TYPE }
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

    /** 从当前读取内容提取真实引用；读取方随后按自身范围读取并核对目标，不依赖持久化索引。 */
    public static List<Reference> extract(String gameId, List<Aggregate> sources) {
        List<Reference> references = new ArrayList<>();
        for (Aggregate aggregate : sources) new Collector(gameId, aggregate, references).collect();
        return List.copyOf(references);
    }

    /** 字典和参数由保留表提供；五类对象与结果、生命周期、模式、步骤和动作从当前聚合生成。 */
    public static List<Reference> extractAndValidate(String gameId, List<Aggregate> aggregates,
                                                    Set<Target> dictionaryAndParameters) {
        return extractAndValidate(gameId, aggregates, aggregates, dictionaryAndParameters);
    }

    /** 只检查本次来源；其余组成仅在被引用时提供目标身份。 */
    public static List<Reference> extractAndValidate(String gameId, List<Aggregate> sources,
                                                    List<Aggregate> context,
                                                    Set<Target> dictionaryAndParameters) {
        Set<Target> targets = new HashSet<>(dictionaryAndParameters);
        List<Reference> references = extract(gameId, sources);
        Set<Aggregate> needed = new LinkedHashSet<>(sources);
        for (Aggregate aggregate : needed) index(aggregate, targets);
        for (Aggregate aggregate : context) {
            if (!needed.contains(aggregate)) indexReferenced(aggregate, references, targets);
        }
        validateTargets(references, targets);
        return List.copyOf(new LinkedHashSet<>(references));
    }

    static boolean belongsTo(Target target, Aggregate aggregate) {
        if (!target.skillKey().equals(aggregate.skillKey()) || !target.key().equals(aggregate.key())) return false;
        return switch (target.type()) {
            case FORMULA -> aggregate.type() == SourceType.FORMULA;
            case EFFECT, RESULT, LIFECYCLE -> aggregate.type() == SourceType.EFFECT;
            case STATE, OPTION -> aggregate.type() == SourceType.STATE;
            case PROCESS, STEP -> aggregate.type() == SourceType.PROCESS;
            case ACTION -> aggregate.type() == SourceType.TRIGGER;
            case DAMAGE_TYPE -> aggregate.type() == SourceType.DAMAGE_TYPE;
            default -> false;
        };
    }

    static void validateExistingTargets(List<Reference> references, List<Aggregate> context,
                                        Set<Target> dictionaryAndParameters) {
        Set<Target> targets = new HashSet<>(dictionaryAndParameters);
        for (Aggregate aggregate : context) {
            indexReferenced(aggregate, references, targets);
        }
        validateTargets(references, targets);
    }

    private static void indexReferenced(Aggregate aggregate, List<Reference> references, Set<Target> targets) {
        for (Reference ref : references) {
            Target target = ref.target();
            if (!belongsTo(target, aggregate) || targets.contains(target)) continue;
            JsonNode data = aggregate.data();
            if (data == null || !data.isObject()) continue;
            switch (target.type()) {
                case FORMULA, EFFECT, STATE, PROCESS, DAMAGE_TYPE -> targets.add(target);
                case LIFECYCLE -> { if (present(data.get("lifecycle"))) targets.add(target); }
                case RESULT -> indexReferencedChild(target, data.path("results"), "resultKey", targets);
                case STEP -> indexReferencedChild(target, data.path("steps"), "stepKey", targets);
                case ACTION -> indexReferencedChild(target, data.path("actions"), "actionKey", targets);
                case OPTION -> {
                    if ("MODE".equals(text(data, "stateType")))
                        indexReferencedChild(target, data.path("detail").path("options"), "optionKey", targets);
                }
                default -> { }
            }
        }
    }

    private static void indexReferencedChild(Target target, JsonNode children, String keyField, Set<Target> targets) {
        int matches = 0;
        for (JsonNode child : children) if (target.subKey().equals(text(child, keyField))) matches++;
        if (matches == 1) targets.add(target);
        // 缺失和重复都不能唯一定位；由调用方输出带来源位置的引用错误。
    }

    private static void validateTargets(List<Reference> references, Set<Target> targets) {
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
    }

    private static void index(Aggregate aggregate, Set<Target> targets) {
        if (aggregate.data() == null || !aggregate.data().isObject()) {
            throw invalid("技能组成缺少结构化内容", List.of(Map.of("field", aggregate.key())));
        }
        String skill = aggregate.skillKey();
        String key = aggregate.key();
        JsonNode data = aggregate.data();
        switch (aggregate.type()) {
            case DAMAGE_TYPE -> targets.add(new Target(TargetType.DAMAGE_TYPE, "", key, ""));
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
                case DAMAGE_TYPE -> damageType();
                case FORMULA -> formula();
                case EFFECT -> effect();
                case STATE -> state();
                case PROCESS -> process();
                case TRIGGER -> trigger();
            }
        }

        private void damageType() {
            if (!source.skillKey().isEmpty()) throw shape("sourceSkillKey", "伤害类型来源不能归属技能");
            JsonNode definition = source.data().get("formula");
            if (!present(definition)) return;
            xyz.game.datamanage.service.damagetype.DamageTypeFormulaParser.readStored(AggregateJson.write(definition));
            JsonNode inputs = definition.path("inputs");
            for (int i = 0; i < inputs.size(); i++) {
                String key = inputs.get(i).path("binding").path("attributeKey").textValue();
                add("inputs/" + i + "/binding/attributeKey", TargetType.ATTRIBUTE, "", key, "");
            }
        }

        private void formula() {
            JsonNode definition = source.data().path("expression");
            var issue = xyz.game.datamanage.service.skillformula.SkillFormulaParser.structuralIssue(source.skillKey(), definition);
            if (issue != null) throw shape("/expression" + issue.path(), issue.code());
            JsonNode inputs = definition.path("inputs");
            for (int i = 0; i < inputs.size(); i++) {
                JsonNode binding = inputs.get(i).path("binding");
                String path = "expression/inputs/" + i + "/binding/";
                if ("parameter".equals(binding.path("kind").asText())) {
                    add(path + "parameterKey", TargetType.PARAMETER, binding.path("skillKey").textValue(), binding.path("parameterKey").textValue(), "");
                } else if ("attribute".equals(binding.path("kind").asText())) {
                    add(path + "attributeKey", TargetType.ATTRIBUTE, "", binding.path("attributeKey").textValue(), "");
                }
            }
        }
        private void effect() {
            JsonNode data = source.data();
            String shieldEndKey = text(data.path("lifecycle"), "endWhenShieldEndsResultKey");
            if (shieldEndKey != null) add("lifecycle.endWhenShieldEndsResultKey", TargetType.RESULT,
                source.skillKey(), source.key(), shieldEndKey);
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
                        JsonNode rules = array(detail, "vampOverrides");
                        for (int v = 0; v < rules.size(); v++) {
                            if ("OVERRIDE".equals(rules.get(v).path("mode").asText())) {
                                formulas(rules.get(v), dp + ".vampOverrides[" + v + "]", "efficiencyValue");
                            }
                        }
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
                        JsonNode condition = detail.path("condition");
                        if (present(condition)) {
                            dictionary(condition, dp + ".condition", "attributeKey", TargetType.ATTRIBUTE);
                            formulas(condition, dp + ".condition", "comparisonValue");
                        }
                    }
                    case "HEALING_MODIFIER", "SHIELD_RECEIVED_MODIFIER" -> dictionary(detail, dp, "modifierZoneKey", TargetType.MODIFIER_ZONE);
                    case "DAMAGE_IMMUNITY" -> dictionary(detail, dp, "damageTypeKey", TargetType.DAMAGE_TYPE);
                    case "DIRECT_HEAL", "SPELL_SHIELD", "HIT_LINK_APPLICATION", "ATTACK_LINK_APPLICATION", "ATTACK_TIMER_RESET" -> { }
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
                case "COUNTER" -> {
                    formulas(detail, "detail", "initialValue", "maxValue", "durationValue");
                    local(detail.path("initialValueBinding"), "detail.initialValueBinding", "parameterKey", TargetType.PARAMETER);
                }
                case "AMMO" -> {
                    formulas(detail, "detail", "initialValue", "maxValue", "recoveryIntervalValue", "initialRemainingValue");
                    local(detail.path("initialValueBinding"), "detail.initialValueBinding", "parameterKey", TargetType.PARAMETER);
                    local(detail.path("initialRemainingMsBinding"), "detail.initialRemainingMsBinding", "parameterKey", TargetType.PARAMETER);
                }
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
                    case "CHANNEL" -> formulas(detail, dp, "durationValue", "executionCountValue",
                        "firstExecutionOffsetValue", "lastExecutionOffsetValue");
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
                qualified(operation, path, "stateSkillKey", "stateKey", TargetType.STATE);
                formulas(operation, path, "value");
                qualifiedChild(operation, path, "stateSkillKey", "optionKey", TargetType.OPTION, text(operation, "stateKey"));
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
                case "PROCESS_RESOLVED" -> {
                    dictionary(detail, path, "sourceSkillKey", TargetType.SKILL);
                    qualified(detail, path, "sourceSkillKey", "processKey", TargetType.PROCESS);
                }
                case "PROCESS_CANCEL_REQUESTED" -> local(detail, path, "processKey", TargetType.PROCESS);
                case "RESULT_AVAILABLE" -> {
                    local(detail, path, "effectKey", TargetType.EFFECT);
                    child(detail, path, "resultKey", TargetType.RESULT, text(detail, "effectKey"));
                }
                case "LIFECYCLE_MOMENT" -> local(detail, path, "effectKey", TargetType.LIFECYCLE);
                case "DAMAGE_PENDING", "DAMAGE_DEALT", "DAMAGE_TAKEN" -> {
                    dictionary(detail, path, "damageTypeKey", TargetType.DAMAGE_TYPE);
                    dictionary(detail, path, "sourceSkillKey", TargetType.SKILL);
                }
                case "STATUS_CHANGED" -> dictionary(detail, path, "statusKey", TargetType.STATUS);
                case "HEALTH_THRESHOLD_CROSSED" -> {
                    dictionary(detail, path, "attributeKey", TargetType.ATTRIBUTE);
                    formulas(detail, path, "thresholdValue");
                }
                case "INTERNAL_STATE_CHANGED" -> qualified(detail, path, "stateSkillKey", "stateKey", TargetType.STATE);
                case "SPELL_SHIELD_BLOCKED" -> local(detail, path, "shieldEffectKey", TargetType.EFFECT);
                case "SOURCE_INITIALIZED", "BASIC_ATTACK_START", "BASIC_ATTACK_HIT", "BASIC_ATTACK_RECEIVED",
                    "CONTROL_RECEIVED", "ENTITY_DIED", "ENTITY_UNTARGETABLE", "KILL", "TAKEDOWN" -> { }
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
                    qualified(detail, dp, "stateSkillKey", "stateKey", TargetType.STATE);
                    qualifiedChild(detail, dp, "stateSkillKey", "optionKey", TargetType.OPTION, text(detail, "stateKey"));
                    formulas(detail, dp, "comparisonValue");
                }
                case "LIFECYCLE_CHECK" -> {
                    qualified(detail, dp, "effectSkillKey", "effectKey", TargetType.LIFECYCLE);
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
                case "ADVANCE_PROCESS" -> {
                    local(detail, path + ".detail", "processKey", TargetType.PROCESS);
                    child(detail, path + ".detail", "stepKey", TargetType.STEP, text(detail, "processKey"));
                }
                case "MODIFY_INTERNAL_STATE" -> {
                    qualified(detail, path + ".detail", "stateSkillKey", "stateKey", TargetType.STATE);
                    formulas(detail, path + ".detail", "value");
                }
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
                        qualified(bindingDetail, dp, "stateSkillKey", "stateKey", TargetType.STATE);
                        qualifiedChild(bindingDetail, dp, "stateSkillKey", "optionKey", TargetType.OPTION, text(bindingDetail, "stateKey"));
                    }
                    case "COMBAT_STATUS" -> statusSource(bindingDetail, dp);
                    case "COMBAT_ELAPSED_TIME", "SCENE_INITIAL_PARAMETER" -> { }
                    case "RECENT_DAMAGE_SUM" -> {
                        formulas(bindingDetail, dp, "windowValue");
                        dictionary(bindingDetail, dp, "sourceSkillKey", TargetType.SKILL);
                        dictionary(bindingDetail, dp, "damageTypeKey", TargetType.DAMAGE_TYPE);
                    }
                    case "SOURCE_CAST_RESOURCE_COST", "SCENE_ATTRIBUTE_SNAPSHOT" -> dictionary(bindingDetail, dp, "attributeKey", TargetType.ATTRIBUTE);
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
            qualified(detail, path, "effectSkillKey", "sourceEffectKey", TargetType.EFFECT);
            qualifiedChild(detail, path, "effectSkillKey", "sourceResultKey", TargetType.RESULT, text(detail, "sourceEffectKey"));
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

        private void qualified(JsonNode node, String path, String skillField, String keyField, TargetType type) {
            String key = text(node, keyField);
            if (key == null) return;
            String skillKey = required(node, skillField, path);
            add(path + "." + keyField, type, skillKey, key, "");
        }

        private void qualifiedChild(JsonNode node, String path, String skillField, String field,
                                     TargetType type, String parentKey) {
            String subKey = text(node, field);
            if (subKey == null) return;
            if (parentKey == null) throw shape(path + "." + field, "引用子项缺少所属对象标识");
            add(path + "." + field, type, required(node, skillField, path), parentKey, subKey);
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
