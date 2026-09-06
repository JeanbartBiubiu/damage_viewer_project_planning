package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputs;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerValueDomain;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 同游戏事务最终状态的数值边界和动作输入复核，不执行具名公式。 */
public final class SkillNumericSemantics {
    private final JdbcTemplate jdbc;
    public SkillNumericSemantics(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void validate(String gameId, List<Aggregate> aggregates) {
        List<Parameter> parameters = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(PARAMETERS_SQL, gameId)) {
            Object fixed = row.get("fixed_value");
            parameters.add(new Parameter((String) row.get("skill_key"), (String) row.get("parameter_key"),
                (String) row.get("value_type"), (String) row.get("value_mode"),
                fixed == null ? null : new BigDecimal(fixed.toString()),
                AggregateJson.tree((String) row.get("level_values"))));
        }
        validate(aggregates, parameters);
    }

    public static void validate(List<Aggregate> aggregates, List<Parameter> parameters) {
        Context context = new Context(aggregates, parameters);
        for (Aggregate aggregate : aggregates) context.collect(aggregate);
        for (Aggregate aggregate : aggregates) if (aggregate.type() == SourceType.TRIGGER) context.bindings(aggregate);
    }

    public record Parameter(String skillKey, String key, String valueType, String valueMode,
                            BigDecimal fixedValue, JsonNode levelValues) {}
    private enum Bound { ANY, INTEGER, NON_NEGATIVE, POSITIVE, NON_NEGATIVE_INTEGER, POSITIVE_INTEGER }
    private record Id(String skill, SourceType type, String key) {}
    private record Use(Aggregate source, String path, SkillNumericValue value) {}
    private record StaticValues(String dimension, Map<String, BigDecimal> values) {}

    private static final class Context {
        private final Map<Id, Aggregate> objects = new LinkedHashMap<>();
        private final Map<String, Parameter> parameters = new LinkedHashMap<>();
        private final Map<Id, List<Use>> uses = new LinkedHashMap<>();

        private Context(List<Aggregate> aggregates, List<Parameter> parameters) {
            for (Aggregate a : aggregates) objects.put(id(a), a);
            for (Parameter p : parameters) this.parameters.put(p.skillKey() + "/" + p.key(), p);
        }

        private void collect(Aggregate a) {
            JsonNode d = a.data();
            switch (a.type()) {
                case FORMULA -> { /* 公式仍由原表达式校验负责。 */ }
                case EFFECT -> {
                    JsonNode life = d.path("lifecycle");
                    use(a, life, "lifecycle", "durationValue", Bound.NON_NEGATIVE, false);
                    use(a, life, "lifecycle", "maxStacksValue", Bound.POSITIVE_INTEGER, false);
                    use(a, life, "lifecycle", "applicationStacksValue", Bound.POSITIVE_INTEGER, false);
                    use(a, life, "lifecycle", "periodicIntervalValue", Bound.POSITIVE, false);
                    int i = 0;
                    for (JsonNode r : d.path("results")) {
                        String path = "results[" + i++ + "]";
                        boolean current = "PERSISTENT".equals(text(r.path("lifecycleBehavior"), "moment"))
                            && "MOMENT_EVALUATION".equals(text(r.path("lifecycleBehavior"), "valueReadMode"));
                        use(a, r.path("valueRule"), path + ".valueRule", "value",
                            "LIFECYCLE_OPERATION".equals(text(r, "resultType")) ? Bound.INTEGER : Bound.ANY, current);
                        if ("DAMAGE".equals(text(r, "resultType"))) {
                            JsonNode detail = r.path("detail");
                            use(a, detail.path("critical"), path + ".detail.critical", "multiplierValue", Bound.ANY, false);
                            int v = 0;
                            for (JsonNode vamp : detail.path("vampRules")) {
                                use(a, vamp, path + ".detail.vampRules[" + v++ + "]", "efficiencyValue", Bound.ANY, false);
                            }
                        }
                    }
                }
                case STATE -> {
                    JsonNode detail = d.path("detail");
                    switch (text(d, "stateType")) {
                        case "COUNTER", "AMMO" -> {
                            use(a, detail, "detail", "initialValue", Bound.NON_NEGATIVE_INTEGER, false);
                            use(a, detail, "detail", "maxValue", "AMMO".equals(text(d, "stateType"))
                                ? Bound.POSITIVE_INTEGER : Bound.NON_NEGATIVE_INTEGER, false);
                            if ("AMMO".equals(text(d, "stateType"))) use(a, detail, "detail", "recoveryIntervalValue", Bound.POSITIVE, false);
                        }
                        case "INTERNAL_COOLDOWN" -> use(a, detail, "detail", "durationValue", Bound.NON_NEGATIVE, false);
                        default -> { }
                    }
                }
                case PROCESS -> {
                    use(a, d.path("cooldown"), "cooldown", "durationValue", Bound.NON_NEGATIVE, false);
                    int i = 0;
                    for (JsonNode step : d.path("steps")) {
                        JsonNode detail = step.path("detail");
                        String path = "steps[" + i++ + "].detail";
                        switch (text(step, "stepType")) {
                            case "DELAY" -> use(a, detail, path, "delayValue", Bound.NON_NEGATIVE, false);
                            case "MULTI_HIT", "PERIODIC" -> {
                                use(a, detail, path, "repeatCountValue", Bound.POSITIVE_INTEGER, false);
                                use(a, detail, path, "intervalValue", Bound.POSITIVE, false);
                            }
                            case "CHANNEL" -> {
                                use(a, detail, path, "durationValue", Bound.NON_NEGATIVE, false);
                                use(a, detail, path, "executionCountValue", Bound.POSITIVE_INTEGER, false);
                            }
                            case "CHARGE" -> {
                                Use minimum = use(a, detail, path, "minimumChargeValue", Bound.NON_NEGATIVE, false);
                                Use maximum = use(a, detail, path, "maximumChargeValue", Bound.NON_NEGATIVE, false);
                                compareCharge(minimum, maximum);
                            }
                            case "RECAST" -> {
                                use(a, detail, path, "windowValue", Bound.NON_NEGATIVE, false);
                                use(a, detail, path, "maximumRecastCountValue", Bound.POSITIVE_INTEGER, false);
                            }
                            case "EMPOWERED_BASIC_ATTACK" -> use(a, detail, path, "windowValue", Bound.NON_NEGATIVE, false);
                            default -> { }
                        }
                    }
                    i = 0;
                    for (JsonNode operation : d.path("stateOperations")) {
                        use(a, operation, "stateOperations[" + i++ + "]", "value", Bound.INTEGER, false);
                    }
                }
                case TRIGGER -> {
                    JsonNode event = d.path("eventSource");
                    if ("HEALTH_THRESHOLD_CROSSED".equals(text(event, "eventType"))) {
                        use(a, event.path("detail"), "eventSource.detail", "thresholdValue", Bound.ANY, true);
                    }
                    int g = 0;
                    for (JsonNode group : d.path("conditionGroups")) {
                        int c = 0;
                        for (JsonNode condition : group.path("conditions")) {
                            switch (text(condition, "conditionType")) {
                                case "ATTRIBUTE_COMPARE", "STATUS_CHECK", "INTERNAL_STATE_CHECK", "EVENT_VALUE_COMPARE" ->
                                    use(a, condition.path("detail"), "conditionGroups[" + g + "].conditions[" + c + "].detail",
                                        "comparisonValue", Bound.ANY, true);
                                default -> { }
                            }
                            c++;
                        }
                        g++;
                    }
                    use(a, d.path("limits").path("perTargetCooldown"), "perTargetCooldown", "durationValue", Bound.POSITIVE, true);
                    use(a, d.path("limits").path("maxTriggersPerProcess"), "maxTriggersPerProcess", "limitValue", Bound.POSITIVE_INTEGER, true);
                }
            }
        }

        private Use use(Aggregate a, JsonNode parent, String prefix, String field, Bound bound, boolean forbidRuntime) {
            String legacy = switch (field) {
                case "value" -> prefix.endsWith("valueRule") ? "formulaKey" : "valueFormulaKey";
                case "initialValue", "maxValue" -> field + "FormulaKey";
                default -> field.substring(0, field.length() - "Value".length()) + "FormulaKey";
            };
            if (parent.has(legacy)) throw invalid(a, prefix + "." + legacy, "UNKNOWN_FIELD", "旧公式取值字段不再接受");
            JsonNode node = parent.get(field);
            if (node == null || node.isNull()) return null;
            Use use;
            try { use = new Use(a, prefix + "." + field, SkillNumericValue.fromJson(node)); }
            catch (IllegalArgumentException ex) { throw invalid(a, prefix + "." + field, "VALUE_SHAPE_INVALID", ex.getMessage()); }
            uses.computeIfAbsent(id(a), ignored -> new ArrayList<>()).add(use);
            Set<String> runtime = runtime(use);
            if (forbidRuntime && !runtime.isEmpty()) throw invalid(a, use.path(), "RUNTIME_INPUT_FORBIDDEN", "该位置不能使用计算时传入参数");
            if (use.value().kind() == SkillNumericValue.Kind.PARAMETER) {
                Parameter p = parameter(use);
                if (integer(bound) && !"INTEGER".equals(p.valueType())) {
                    throw invalid(a, use.path(), "VALUE_TYPE_MISMATCH", "该位置要求整数参数");
                }
            }
            StaticValues known = known(use);
            if (known != null) for (BigDecimal value : known.values().values()) {
                if (integer(bound) && value.stripTrailingZeros().scale() > 0) throw invalid(a, use.path(), "VALUE_TYPE_MISMATCH", "该位置要求整数");
                if ((bound == Bound.NON_NEGATIVE || bound == Bound.NON_NEGATIVE_INTEGER) && value.signum() < 0) {
                    throw invalid(a, use.path(), "VALUE_RANGE_INVALID", "该位置的数值不能小于零");
                }
                if ((bound == Bound.POSITIVE || bound == Bound.POSITIVE_INTEGER) && value.signum() <= 0) {
                    throw invalid(a, use.path(), "VALUE_RANGE_INVALID", "该位置的数值必须大于零");
                }
            }
            return use;
        }

        private Parameter parameter(Use use) {
            Parameter p = parameters.get(use.source().skillKey() + "/" + use.value().parameterKey());
            if (p == null) throw invalid(use.source(), use.path(), "UNKNOWN_PARAMETER", "参数不存在或不属于当前技能");
            return p;
        }

        private StaticValues known(Use use) {
            if (use == null) return null;
            if (use.value().kind() == SkillNumericValue.Kind.FIXED) return new StaticValues("FIXED", Map.of("", use.value().value()));
            if (use.value().kind() == SkillNumericValue.Kind.FORMULA) return null;
            Parameter p = parameter(use);
            if ("RUNTIME_INPUT".equals(p.valueMode())) return null;
            if ("FIXED".equals(p.valueMode())) {
                if (p.fixedValue() == null) throw invalid(use.source(), use.path(), "PARAMETER_VALUES_INVALID", "固定参数缺少数值");
                return new StaticValues("FIXED", Map.of("", p.fixedValue()));
            }
            Map<String, BigDecimal> values = new LinkedHashMap<>();
            if (p.levelValues() == null || !p.levelValues().isObject()) throw invalid(use.source(), use.path(), "PARAMETER_VALUES_INVALID", "等级参数缺少完整取值图");
            p.levelValues().fields().forEachRemaining(entry -> {
                if (!entry.getValue().isNumber()) throw invalid(use.source(), use.path(), "PARAMETER_VALUES_INVALID", "等级参数取值必须为数值");
                values.put(entry.getKey(), entry.getValue().decimalValue());
            });
            return new StaticValues(p.valueMode(), values);
        }

        private void compareCharge(Use minimum, Use maximum) {
            StaticValues min = known(minimum), max = known(maximum);
            if (min == null || max == null) return;
            for (Map.Entry<String, BigDecimal> lower : min.values().entrySet()) {
                for (Map.Entry<String, BigDecimal> upper : max.values().entrySet()) {
                    if (!"FIXED".equals(min.dimension()) && min.dimension().equals(max.dimension()) && !lower.getKey().equals(upper.getKey())) continue;
                    if (upper.getValue().compareTo(lower.getValue()) < 0) throw invalid(maximum.source(), maximum.path(), "CHARGE_RANGE_INVALID", "最大蓄力时间不能小于最小蓄力时间");
                }
            }
        }

        private Set<String> runtime(Use use) {
            Set<String> keys = new LinkedHashSet<>();
            if (use.value().kind() == SkillNumericValue.Kind.PARAMETER) {
                Parameter p = parameter(use);
                if ("RUNTIME_INPUT".equals(p.valueMode())) keys.add(p.key());
            } else if (use.value().kind() == SkillNumericValue.Kind.FORMULA) {
                Aggregate formula = objects.get(new Id(use.source().skillKey(), SourceType.FORMULA, use.value().formulaKey()));
                if (formula == null) throw invalid(use.source(), use.path(), "UNKNOWN_FORMULA", "公式不存在或不属于当前技能");
                collectFormulaParameters(formula.data().path("expression"), keys, use.source().skillKey());
            }
            return keys;
        }

        private void collectFormulaParameters(JsonNode node, Set<String> runtime, String skill) {
            if ("PARAMETER".equals(text(node, "nodeType"))) {
                Parameter p = parameters.get(skill + "/" + text(node, "parameterKey"));
                if (p != null && "RUNTIME_INPUT".equals(p.valueMode())) runtime.add(p.key());
            } else if ("OPERATION".equals(text(node, "nodeType"))) {
                for (JsonNode child : node.path("operands")) collectFormulaParameters(child, runtime, skill);
            }
        }

        private void dependencies(Id target, Set<String> runtime, Set<Id> visited) {
            if (!visited.add(target)) return;
            Aggregate a = objects.get(target);
            if (a == null) return; // 引用存在性已由统一引用校验保护。
            for (Use use : uses.getOrDefault(target, List.of())) runtime.addAll(runtime(use));
            if (a.type() == SourceType.PROCESS) {
                for (JsonNode binding : a.data().path("effectBindings")) dependencies(new Id(a.skillKey(), SourceType.EFFECT, text(binding, "effectKey")), runtime, visited);
                for (JsonNode operation : a.data().path("stateOperations")) {
                    Id stateId = new Id(a.skillKey(), SourceType.STATE, text(operation, "stateKey"));
                    Aggregate state = objects.get(stateId);
                    if ((state != null && Set.of("COUNTER", "AMMO").contains(text(state.data(), "stateType")))
                        || "RESET".equals(text(operation, "operation")) || ("START".equals(text(operation, "operation"))
                        && state != null && "INTERNAL_COOLDOWN".equals(text(state.data(), "stateType")))) dependencies(stateId, runtime, visited);
                }
            }
        }

        private void bindings(Aggregate rule) {
            int i = 0;
            for (JsonNode action : rule.data().path("actions")) {
                Set<String> required = new LinkedHashSet<>();
                String type = text(action, "actionType");
                if ("EXECUTE_EFFECT".equals(type)) dependencies(new Id(rule.skillKey(), SourceType.EFFECT, text(action.path("detail"), "effectKey")), required, new LinkedHashSet<>());
                if ("START_PROCESS".equals(type)) dependencies(new Id(rule.skillKey(), SourceType.PROCESS, text(action.path("detail"), "processKey")), required, new LinkedHashSet<>());
                Set<String> bound = new LinkedHashSet<>();
                int j = 0;
                for (JsonNode binding : action.path("runtimeInputBindings")) {
                    String path = "actions[" + i + "].runtimeInputBindings[" + j++ + "]";
                    String key = text(binding, "parameterKey");
                    Parameter p = parameters.get(rule.skillKey() + "/" + key);
                    if (!bound.add(key)) throw invalid(rule, path, "BINDING_DUPLICATE", "同一参数不能重复绑定");
                    if (p == null || !"RUNTIME_INPUT".equals(p.valueMode()) || !required.contains(key)) throw invalid(rule, path, "BINDING_EXTRA", "绑定参数不是该动作需要的计算时输入");
                    if ("INTEGER".equals(p.valueType()) && bindingDomain(binding) == SkillTriggerValueDomain.DECIMAL) throw invalid(rule, path, "REFERENCE_TYPE_MISMATCH", "小数来源不能绑定整数参数");
                }
                if (!bound.containsAll(required)) throw invalid(rule, "actions[" + i + "].runtimeInputBindings", "BINDING_MISSING", "动作需要的计算时输入缺少绑定");
                i++;
            }
        }

        private SkillTriggerValueDomain bindingDomain(JsonNode binding) {
            JsonNode detail = binding.path("detail");
            return switch (text(binding, "sourceType")) {
                case "INTERNAL_STATE", "COMBAT_STATUS" -> "REMAINING_MS".equals(text(detail, "valueKind")) ? SkillTriggerValueDomain.DECIMAL : SkillTriggerValueDomain.INTEGER;
                case "EVENT_VALUE" -> SkillTriggerEventCapabilities.valueDomain(SkillTriggerEventValueKey.valueOf(text(detail, "eventValueKey")));
                case "PRIOR_ACTION_RESULT" -> SkillTriggerPriorResultOutputs.valueDomain(SkillTriggerPriorResultOutputKind.valueOf(text(detail, "outputKind")));
                default -> null;
            };
        }
    }

    private static Id id(Aggregate a) { return new Id(a.skillKey(), a.type(), a.key()); }
    private static String text(JsonNode node, String field) { return node.path(field).asText(""); }
    private static boolean integer(Bound bound) { return bound == Bound.INTEGER || bound == Bound.NON_NEGATIVE_INTEGER || bound == Bound.POSITIVE_INTEGER; }
    private static ApiException invalid(Aggregate source, String path, String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_SKILL_NUMERIC_VALUE", message,
            Map.of("fieldIssues", List.of(Map.of("field", path, "code", code,
                "sourceSkillKey", source.skillKey(), "sourceType", source.type().name(), "sourceKey", source.key()))));
    }
    static final String PARAMETERS_SQL = """
        SELECT skill_key, parameter_key, value_type, value_mode, fixed_value, level_values::text AS level_values
        FROM public.skill_parameters WHERE game_id = ? ORDER BY skill_key, parameter_key
        """;
}
