package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputs;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerValueDomain;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 同游戏事务最终状态的数值边界和动作输入复核；共同公式只作精确静态管理证明。 */
public final class SkillNumericSemantics {
    private final JdbcTemplate jdbc;
    public SkillNumericSemantics(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void validate(String gameId, List<Aggregate> aggregates) {
        validate(gameId, aggregates, aggregates);
    }

    public void validate(String gameId, List<Aggregate> sources, List<Aggregate> context) {
        List<Parameter> parameters = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(PARAMETERS_SQL, gameId)) {
            Object fixed = row.get("fixed_value");
            parameters.add(new Parameter((String) row.get("skill_key"), (String) row.get("parameter_key"),
                (String) row.get("value_type"), (String) row.get("value_mode"),
                fixed == null ? null : new BigDecimal(fixed.toString()),
                AggregateJson.tree((String) row.get("level_values"))));
        }
        Map<String, String> zoneModes = new LinkedHashMap<>();
        Map<String, String> zoneDomains = new LinkedHashMap<>();
        Map<String, String> zoneStages = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(HealingRatioMaxSemantics.ZONES_SQL, gameId)) {
            String key = (String) row.get("modifier_zone_key");
            zoneModes.put(key, (String) row.get("calculation_mode"));
            zoneDomains.put(key, (String) row.get("domain"));
            zoneStages.put(key, (String) row.get("application_stage"));
        }
        validate(sources, context, parameters, zoneModes, zoneDomains, zoneStages);
    }

    public static void validate(List<Aggregate> aggregates, List<Parameter> parameters) {
        validate(aggregates, parameters, Map.of());
    }

    public static void validate(List<Aggregate> aggregates, List<Parameter> parameters, Map<String, String> zoneModes) {
        validate(aggregates, parameters, zoneModes, Map.of(), Map.of());
    }

    public static void validate(List<Aggregate> aggregates, List<Parameter> parameters, Map<String, String> zoneModes,
                                Map<String, String> zoneDomains, Map<String, String> zoneStages) {
        validate(aggregates, aggregates, parameters, zoneModes, zoneDomains, zoneStages);
    }

    static void validate(List<Aggregate> sources, List<Aggregate> objects, List<Parameter> parameters,
                         Map<String, String> zoneModes, Map<String, String> zoneDomains, Map<String, String> zoneStages) {
        Context context = new Context(objects, parameters, zoneModes, zoneDomains, zoneStages);
        for (Aggregate aggregate : sources) context.collect(aggregate);
        for (Aggregate aggregate : sources) if (aggregate.type() == SourceType.TRIGGER) context.bindings(aggregate);
    }

    public record Parameter(String skillKey, String key, String valueType, String valueMode,
                            BigDecimal fixedValue, JsonNode levelValues) {}
    private enum Bound { ANY, INTEGER, NON_NEGATIVE, NON_NEGATIVE_FINITE, POSITIVE, NON_NEGATIVE_INTEGER, POSITIVE_INTEGER }
    private record Id(String skill, SourceType type, String key) {}
    private record Use(Aggregate source, String path, SkillNumericValue value) {}
    private record Levels(String skill, String character) {
        private boolean compatible(Levels other) {
            return (skill.isEmpty() || other.skill.isEmpty() || skill.equals(other.skill))
                && (character.isEmpty() || other.character.isEmpty() || character.equals(other.character));
        }
        private Levels merge(Levels other) {
            return new Levels(skill.isEmpty() ? other.skill : skill,
                character.isEmpty() ? other.character : character);
        }
    }
    private record Fraction(BigInteger numerator, BigInteger denominator) implements Comparable<Fraction> {
        private Fraction {
            if (denominator.signum() == 0) throw new ArithmeticException("分母为零");
            if (denominator.signum() < 0) { numerator = numerator.negate(); denominator = denominator.negate(); }
            BigInteger gcd = numerator.gcd(denominator);
            numerator = numerator.divide(gcd);
            denominator = denominator.divide(gcd);
        }
        private static Fraction of(BigDecimal value) {
            int scale = value.scale();
            return scale >= 0
                ? new Fraction(value.unscaledValue(), BigInteger.TEN.pow(scale))
                : new Fraction(value.unscaledValue().multiply(BigInteger.TEN.pow(-scale)), BigInteger.ONE);
        }
        private Fraction add(Fraction other) {
            return new Fraction(numerator.multiply(other.denominator).add(other.numerator.multiply(denominator)),
                denominator.multiply(other.denominator));
        }
        private Fraction subtract(Fraction other) {
            return new Fraction(numerator.multiply(other.denominator).subtract(other.numerator.multiply(denominator)),
                denominator.multiply(other.denominator));
        }
        private Fraction multiply(Fraction other) {
            return new Fraction(numerator.multiply(other.numerator), denominator.multiply(other.denominator));
        }
        private Fraction divide(Fraction other) {
            return new Fraction(numerator.multiply(other.denominator), denominator.multiply(other.numerator));
        }
        @Override public int compareTo(Fraction other) {
            return numerator.multiply(other.denominator).compareTo(other.numerator.multiply(denominator));
        }
    }

    private static final class Context {
        private final Map<Id, Aggregate> objects = new LinkedHashMap<>();
        private final Map<String, Parameter> parameters = new LinkedHashMap<>();
        private final Map<Id, List<Use>> uses = new LinkedHashMap<>();
        private final Set<Id> collected = new LinkedHashSet<>();
        private final Map<String, String> zoneModes;
        private final Map<String, String> zoneDomains;
        private final Map<String, String> zoneStages;

        private Context(List<Aggregate> aggregates, List<Parameter> parameters, Map<String, String> zoneModes,
                        Map<String, String> zoneDomains, Map<String, String> zoneStages) {
            for (Aggregate a : aggregates) objects.put(id(a), a);
            for (Parameter p : parameters) this.parameters.put(p.skillKey() + "/" + p.key(), p);
            this.zoneModes = zoneModes == null ? Map.of() : zoneModes;
            this.zoneDomains = zoneDomains == null ? Map.of() : zoneDomains;
            this.zoneStages = zoneStages == null ? Map.of() : zoneStages;
        }

        private void collect(Aggregate a) {
            if (!collected.add(id(a))) return;
            JsonNode d = a.data();
            switch (a.type()) {
                case FORMULA -> { /* 全声明结构由共同校验负责，使用点按输出依赖作静态证明。 */ }
                case EFFECT -> {
                    JsonNode life = d.path("lifecycle");
                    use(a, life, "lifecycle", "durationValue", Bound.NON_NEGATIVE, false);
                    use(a, life, "lifecycle", "maxStacksValue", Bound.POSITIVE_INTEGER, false);
                    use(a, life, "lifecycle", "applicationStacksValue", Bound.POSITIVE_INTEGER, false);
                    use(a, life, "lifecycle", "periodicIntervalValue", Bound.POSITIVE, false);
                    if (life.hasNonNull("endWhenShieldEndsResultKey")) {
                        requireStaticOne(a, life, "maxStacksValue");
                        requireStaticOne(a, life, "applicationStacksValue");
                    }
                    int i = 0;
                    for (JsonNode r : d.path("results")) {
                        String path = "results[" + i++ + "]";
                        boolean current = "PERSISTENT".equals(text(r.path("lifecycleBehavior"), "moment"))
                            && "MOMENT_EVALUATION".equals(text(r.path("lifecycleBehavior"), "valueReadMode"));
                        String lifecycleOperation = text(r.path("detail"), "operation");
                        boolean extendDuration = "LIFECYCLE_OPERATION".equals(text(r, "resultType"))
                            && "EXTEND_DURATION".equals(lifecycleOperation);
                        Bound valueBound = Bound.ANY;
                        if ("LIFECYCLE_OPERATION".equals(text(r, "resultType")) && !extendDuration) {
                            valueBound = Bound.INTEGER;
                        } else if ("COOLDOWN_CHANGE".equals(text(r, "resultType"))
                            && SkillEffectCooldownChangeOperation.SET_REMAINING.name()
                                .equals(text(r.path("detail"), "operation"))) {
                            valueBound = Bound.NON_NEGATIVE_FINITE;
                        }
                        Use valueUse = use(a, r.path("valueRule"), path + ".valueRule", "value",
                            valueBound,
                            current);
                        if (extendDuration) {
                            validateExtendedDuration(a, valueUse, r.path("valueRule"), path + ".valueRule.value");
                        }
                        if ("COOLDOWN_CHANGE".equals(text(r, "resultType"))
                            && SkillEffectCooldownChangeOperation.SET_REMAINING.name()
                                .equals(text(r.path("detail"), "operation"))) {
                            validateSetRemainingCooldown(a, valueUse, r.path("valueRule"), null, path + ".valueRule.value");
                        }
                        if ("COOLDOWN_CHANGE".equals(text(r, "resultType"))
                            && SkillEffectCooldownChangeOperation.REDUCE_REMAINING_RATIO.name()
                                .equals(text(r.path("detail"), "operation"))) {
                            validateRemainingCooldownRatio(a, valueUse, r.path("valueRule"), path + ".valueRule.value");
                        }
                        if (isHealingRatioMaxDecrease(r)) {
                            validateHealingRatioMaxDecrease(a, valueUse, r.path("valueRule"), path + ".valueRule.value");
                        }
                        if ("DAMAGE_MODIFIER".equals(text(r, "resultType"))) {
                            validateDamageModifierCondition(a, r, path);
                        }
                        if ("DAMAGE".equals(text(r, "resultType"))) {
                            JsonNode detail = r.path("detail");
                            use(a, detail.path("critical"), path + ".detail.critical", "multiplierValue", Bound.ANY, false);
                            int v = 0;
                            for (JsonNode vamp : detail.path("vampOverrides")) {
                                if ("OVERRIDE".equals(vamp.path("mode").asText())) {
                                    use(a, vamp, path + ".detail.vampOverrides[" + v + "]", "efficiencyValue", Bound.NON_NEGATIVE_FINITE, false);
                                }
                                v++;
                            }
                        }
                    }
                }
                case STATE -> {
                    JsonNode detail = d.path("detail");
                    switch (text(d, "stateType")) {
                        case "COUNTER", "AMMO" -> {
                            Use initial = use(a, detail, "detail", "initialValue", Bound.NON_NEGATIVE_INTEGER, false);
                            Use maximum = use(a, detail, "detail", "maxValue", "AMMO".equals(text(d, "stateType"))
                                ? Bound.POSITIVE_INTEGER : Bound.NON_NEGATIVE_INTEGER, false);
                            compareInitialCapacity(initial, maximum);
                            if ("AMMO".equals(text(d, "stateType"))) use(a, detail, "detail", "recoveryIntervalValue", Bound.POSITIVE, false);
                            if ("COUNTER".equals(text(d, "stateType")) && !detail.path("durationValue").isMissingNode()
                                && !detail.path("durationValue").isNull()) {
                                use(a, detail, "detail", "durationValue", Bound.NON_NEGATIVE_INTEGER, false);
                            }
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
                            case "CHANNEL" -> validateChannel(a, detail, path);
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
                            if ("EVENT_VALUE_COMPARE".equals(text(condition, "conditionType"))) {
                                validateSkillHitEventValue(a, condition.path("detail"), "conditionGroups[" + g + "].conditions[" + c + "].detail");
                            }
                            switch (text(condition, "conditionType")) {
                                case "ATTRIBUTE_COMPARE", "STATUS_CHECK", "INTERNAL_STATE_CHECK", "EVENT_VALUE_COMPARE" ->
                                    use(a, condition.path("detail"), "conditionGroups[" + g + "].conditions[" + c + "].detail",
                                        "comparisonValue", Bound.ANY, true);
                                case "LIFECYCLE_CHECK" ->
                                    use(a, condition.path("detail"), "conditionGroups[" + g + "].conditions[" + c + "].detail",
                                        "comparisonValue", Bound.NON_NEGATIVE_INTEGER, true);
                                default -> { }
                            }
                            c++;
                        }
                        g++;
                    }
                    use(a, d.path("limits").path("perTargetCooldown"), "perTargetCooldown", "durationValue", Bound.POSITIVE, true);
                    use(a, d.path("limits").path("maxTriggersPerProcess"), "maxTriggersPerProcess", "limitValue", Bound.POSITIVE_INTEGER, true);
                    int actionIndex = 0;
                    for (JsonNode action : d.path("actions")) {
                        int bindingIndex = 0;
                        for (JsonNode binding : action.path("runtimeInputBindings")) {
                            if ("RECENT_DAMAGE_SUM".equals(text(binding, "sourceType"))) {
                                Use window = use(a, binding.path("detail"),
                                    "actions[" + actionIndex + "].runtimeInputBindings[" + bindingIndex + "].detail",
                                    "windowValue", Bound.POSITIVE, true);
                                if (window == null) throw invalid(a, "actions[" + actionIndex + "].runtimeInputBindings[" + bindingIndex + "].detail.windowValue",
                                    "REQUIRED", "近期伤害累计必须配置时间窗");
                                Map<Levels, Fraction> knownWindow = optionalStaticValues(window);
                                if (knownWindow != null) for (Fraction value : knownWindow.values()) {
                                    if (value.compareTo(Fraction.of(BigDecimal.ZERO)) <= 0)
                                        throw invalid(a, window.path(), "VALUE_RANGE_INVALID", "近期伤害累计的时间窗在全部等级必须大于零");
                                }
                            }
                            bindingIndex++;
                        }
                        actionIndex++;
                    }
                }
            }
        }

        private record ChannelValues(Levels levels, Map<String, Fraction> values) {}

        private void validateChannel(Aggregate source, JsonNode detail, String path) {
            boolean custom = "CUSTOM_WINDOW".equals(text(detail, "firstExecution"));
            List<String> fields = custom
                ? List.of("durationValue", "executionCountValue", "firstExecutionOffsetValue", "lastExecutionOffsetValue")
                : List.of("durationValue", "executionCountValue");
            if (!custom) for (String field : List.of("firstExecutionOffsetValue", "lastExecutionOffsetValue")) {
                if (detail.has(field)) throw invalid(source, path + "." + field, "FIELD_NOT_ALLOWED", "只有指定窗口引导可以配置首末执行偏移");
            }
            List<ChannelValues> combinations = List.of(new ChannelValues(new Levels("", ""), Map.of()));
            for (String field : fields) {
                boolean positive = "durationValue".equals(field) || "executionCountValue".equals(field);
                Use value = use(source, detail, path, field, positive ? Bound.POSITIVE_INTEGER : Bound.NON_NEGATIVE_INTEGER, false);
                if (value == null) throw invalid(source, path + "." + field, "REQUIRED", "引导必须完整配置次数、时长和所选首末执行窗口");
                Map<Levels, Fraction> values = optionalStaticValues(value);
                if (values == null) continue;
                Fraction maximum = Fraction.of(new BigDecimal("executionCountValue".equals(field) ? "64" : "9007199254740991"));
                for (Fraction number : values.values()) {
                    if (!number.denominator().equals(BigInteger.ONE)) throw invalid(source, value.path(), "VALUE_TYPE_MISMATCH", "引导次数和时间必须为整数");
                    if (number.compareTo(Fraction.of(positive ? BigDecimal.ONE : BigDecimal.ZERO)) < 0 || number.compareTo(maximum) > 0) {
                        throw invalid(source, value.path(), "VALUE_RANGE_INVALID", "引导时间必须为安全整数毫秒，次数为1至64，完整时长大于零");
                    }
                }
                List<ChannelValues> next = new ArrayList<>();
                for (ChannelValues combination : combinations) for (var entry : values.entrySet()) {
                    if (!combination.levels().compatible(entry.getKey())) continue;
                    Map<String, Fraction> merged = new LinkedHashMap<>(combination.values());
                    merged.put(field, entry.getValue());
                    next.add(new ChannelValues(combination.levels().merge(entry.getKey()), merged));
                }
                combinations = next;
            }
            for (ChannelValues combination : combinations) {
                Map<String, Fraction> values = combination.values();
                Fraction duration = values.get("durationValue"), count = values.get("executionCountValue");
                Fraction first = values.get("firstExecutionOffsetValue"), last = values.get("lastExecutionOffsetValue");
                if (!custom) {
                    if (duration != null && count != null && duration.compareTo(count) < 0) {
                        throw invalid(source, path + ".durationValue", "CHANNEL_WINDOW_INVALID", "等分引导时长不得小于执行次数");
                    }
                    continue;
                }
                if (duration != null && first != null && first.compareTo(duration) > 0) {
                    throw invalid(source, path + ".firstExecutionOffsetValue", "CHANNEL_WINDOW_INVALID", "首段执行偏移不能超过完整引导时长");
                }
                if (duration != null && last != null && last.compareTo(duration) > 0) {
                    throw invalid(source, path + ".lastExecutionOffsetValue", "CHANNEL_WINDOW_INVALID", "末段执行偏移不能超过完整引导时长");
                }
                if (first == null || last == null) continue;
                Fraction span = last.subtract(first);
                if (span.compareTo(Fraction.of(BigDecimal.ZERO)) < 0 || count != null
                    && (count.compareTo(Fraction.of(BigDecimal.ONE)) == 0 ? span.compareTo(Fraction.of(BigDecimal.ZERO)) != 0
                        : span.compareTo(count.subtract(Fraction.of(BigDecimal.ONE))) < 0)) {
                    throw invalid(source, path + ".lastExecutionOffsetValue", "CHANNEL_WINDOW_INVALID", "首段不得晚于末段；单段两端相等，多段跨度至少为次数减一");
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
            Map<Levels, Fraction> known = bound == Bound.ANY ? null : optionalStaticValues(use);
            if (known != null) for (Fraction value : known.values()) {
                if (integer(bound) && !value.denominator().equals(BigInteger.ONE)) throw invalid(a, use.path(), "VALUE_TYPE_MISMATCH", "该位置要求整数");
                if ((bound == Bound.NON_NEGATIVE || bound == Bound.NON_NEGATIVE_INTEGER || bound == Bound.NON_NEGATIVE_FINITE) && value.numerator().signum() < 0) {
                    throw invalid(a, use.path(), "VALUE_RANGE_INVALID", "该位置的数值不能小于零");
                }
                if (bound == Bound.NON_NEGATIVE_FINITE && !finite(value)) throw invalid(a, use.path(), "VALUE_RANGE_INVALID", "该位置的数值必须是有限非负数");
                if ((bound == Bound.POSITIVE || bound == Bound.POSITIVE_INTEGER) && value.numerator().signum() <= 0) {
                    throw invalid(a, use.path(), "VALUE_RANGE_INVALID", "该位置的数值必须大于零");
                }
            }            return use;
        }

        private Parameter parameter(Use use) {
            Parameter p = parameters.get(use.source().skillKey() + "/" + use.value().parameterKey());
            if (p == null) throw invalid(use.source(), use.path(), "UNKNOWN_PARAMETER", "参数不存在或不属于当前技能");
            return p;
        }

        private void compareCharge(Use minimum, Use maximum) {
            Map<Levels, Fraction> min = minimum == null ? null : optionalStaticValues(minimum);
            Map<Levels, Fraction> max = maximum == null ? null : optionalStaticValues(maximum);
            if (min == null || max == null) return;
            for (var lower : min.entrySet()) for (var upper : max.entrySet()) {
                if (lower.getKey().compatible(upper.getKey()) && upper.getValue().compareTo(lower.getValue()) < 0)
                    throw invalid(maximum.source(), maximum.path(), "CHARGE_RANGE_INVALID", "最大蓄力时间不能小于最小蓄力时间");
            }
        }
        private void validateDamageModifierCondition(Aggregate effect, JsonNode result, String path) {
            JsonNode detail = result.path("detail");
            JsonNode raw = detail.path("condition");
            if (raw.isMissingNode() || raw.isNull()) return;
            String conditionPath = path + ".detail.condition";
            var parsed = DamageModifierConditionSemantics.parse(raw, conditionPath);
            if (!parsed.issues().isEmpty()) {
                Map<String, String> issue = parsed.issues().getFirst();
                throw invalid(effect, issue.get("field"), issue.get("code"), issue.get("message"));
            }
            if (!"SOURCE".equals(text(result, "target"))) {
                throw invalid(effect, path + ".target", "CONDITION_TARGET_UNSUPPORTED", "逐笔生命门槛只支持作用于来源对象");
            }
            if (!"DEALT".equals(text(detail, "direction"))) {
                throw invalid(effect, path + ".detail.direction", "CONDITION_DIRECTION_UNSUPPORTED", "逐笔生命门槛只支持造成伤害方向");
            }
            if (!effect.data().path("lifecycle").isObject()
                || !"PERSISTENT".equals(text(result.path("lifecycleBehavior"), "moment"))) {
                throw invalid(effect, path + ".lifecycleBehavior.moment", "CONDITION_LIFECYCLE_UNSUPPORTED",
                    "逐笔生命门槛要求父生命周期和持续生效结果");
            }
            String zoneKey = text(detail, "modifierZoneKey");
            if (!"DAMAGE".equals(zoneDomains.get(zoneKey))
                || !"DAMAGE_PRE_DEFENSE".equals(zoneStages.get(zoneKey))) {
                throw invalid(effect, path + ".detail.modifierZoneKey", "CONDITION_ZONE_UNSUPPORTED",
                    "逐笔生命门槛只支持防御前伤害乘区");
            }
            Use threshold = use(effect, raw, conditionPath, "comparisonValue", Bound.ANY, true);
            for (Fraction value : staticConditionValues(threshold).values()) {
                if (value.compareTo(Fraction.of(BigDecimal.ZERO)) < 0
                    || value.compareTo(Fraction.of(BigDecimal.ONE)) > 0) {
                    throw invalid(effect, conditionPath + ".comparisonValue", "VALUE_RANGE_INVALID",
                        "逐笔生命门槛的全部等级比例必须有限且位于0到1之间");
                }
            }
        }

        private Map<Levels, Fraction> staticConditionValues(Use use) {
            return switch (use.value().kind()) {
                case FIXED -> Map.of(new Levels("", ""), Fraction.of(use.value().value()));
                case PARAMETER -> staticParameterValues(use, parameter(use));
                case FORMULA -> {
                    Aggregate formula = objects.get(new Id(use.source().skillKey(), SourceType.FORMULA,
                        use.value().formulaKey()));
                    if (formula == null) throw invalid(use.source(), use.path(), "UNKNOWN_FORMULA", "公式不存在或不属于当前技能");
                    yield evaluateFormula(use, formula.data().path("expression"), 1);
                }
            };
        }

        private void requireStaticOne(Aggregate effect, JsonNode lifecycle, String field) {
            Use value = use(effect, lifecycle, "lifecycle", field, Bound.POSITIVE_INTEGER, true);
            if (value == null) throw invalid(effect, "lifecycle." + field, "REQUIRED", "随护盾结束时必须明确配置单层数值");
            Map<Levels, Fraction> values;
            try { values = staticConditionValues(value); }
            catch (ApiException ex) {
                throw invalid(effect, value.path(), "STATIC_ONE_REQUIRED", "随护盾结束的层数必须静态可求值，不能依赖属性、计算时输入或除零");
            }
            if (values.isEmpty() || values.values().stream().anyMatch(v -> v.compareTo(Fraction.of(BigDecimal.ONE)) != 0)) {
                throw invalid(effect, value.path(), "STATIC_ONE_REQUIRED", "随护盾结束的最大层数和本次叠层数必须在全部等级恒为1");
            }
        }

        private void compareInitialCapacity(Use initial, Use maximum) {
            if (initial == null || maximum == null) return;
            Map<Levels, Fraction> first = optionalStaticValues(initial), limit = optionalStaticValues(maximum);
            if (first == null || limit == null) return;
            for (var lhs : first.entrySet()) for (var rhs : limit.entrySet()) {
                if (lhs.getKey().compatible(rhs.getKey()) && lhs.getValue().compareTo(rhs.getValue()) > 0) {
                    throw invalid(initial.source(), initial.path(), "STATE_CAPACITY_EXCEEDED", "初始计数或弹药不能超过同等级的上限");
                }
            }
        }

        private Map<Levels, Fraction> optionalStaticValues(Use value) {
            if (!runtime(value).isEmpty()) return null;
            try { return staticConditionValues(value); }
            catch (ApiException ex) {
                Object raw = ex.getDetails().get("fieldIssues");
                if (raw instanceof List<?> issues && issues.stream().anyMatch(issue -> issue instanceof Map<?, ?> fields
                    && "ATTRIBUTE_FORBIDDEN".equals(fields.get("code")))) return null;
                throw ex;
            }
        }

        private Map<Levels, Fraction> staticParameterValues(Use use, Parameter parameter) {
            if ("RUNTIME_INPUT".equals(parameter.valueMode())) {
                throw invalid(use.source(), use.path(), "RUNTIME_INPUT_FORBIDDEN", "逐笔生命门槛不能使用计算时传入参数");
            }
            if ("FIXED".equals(parameter.valueMode())) {
                if (parameter.fixedValue() == null) throw invalid(use.source(), use.path(), "PARAMETER_VALUES_INVALID", "固定参数缺少数值");
                return Map.of(new Levels("", ""), Fraction.of(parameter.fixedValue()));
            }
            if (!Set.of("SKILL_LEVEL", "CHARACTER_LEVEL").contains(parameter.valueMode())
                || parameter.levelValues() == null || !parameter.levelValues().isObject()
                || parameter.levelValues().isEmpty()) {
                throw invalid(use.source(), use.path(), "PARAMETER_VALUES_INVALID", "等级参数缺少完整取值图");
            }
            Map<Levels, Fraction> values = new LinkedHashMap<>();
            parameter.levelValues().fields().forEachRemaining(entry -> {
                if (!entry.getValue().isNumber()) throw invalid(use.source(), use.path(), "PARAMETER_VALUES_INVALID", "等级参数取值必须为数值");
                Levels levels = "SKILL_LEVEL".equals(parameter.valueMode())
                    ? new Levels(entry.getKey(), "") : new Levels("", entry.getKey());
                values.put(levels, Fraction.of(entry.getValue().decimalValue()));
            });
            return values;
        }

        private record FormulaValues(Levels levels, Map<String, Fraction> inputs) {}

        private Map<Levels, Fraction> evaluateFormula(Use use, JsonNode definition, int ignoredDepth) {
            var issue = xyz.game.datamanage.service.skillformula.SkillFormulaParser.structuralIssue(use.source().skillKey(), definition);
            if (issue != null) throw invalid(use.source(), use.path(), issue.code(), "共同公式结构不合法");
            List<JsonNode> bindings = xyz.game.datamanage.support.formula.SkillFormulaBindings.reachableBindings(definition);
            for (JsonNode binding : bindings) {
                if ("attribute".equals(text(binding, "kind"))) throw invalid(use.source(), use.path(), "ATTRIBUTE_FORBIDDEN", "静态数值公式不能读取属性");
            }
            List<FormulaValues> combinations = List.of(new FormulaValues(new Levels("", ""), Map.of()));
            for (JsonNode input : definition.path("inputs")) {
                JsonNode binding = input.path("binding");
                if (!bindings.contains(binding)) continue;
                String parameterKey = text(binding, "parameterKey");
                Parameter parameter = parameters.get(use.source().skillKey() + "/" + parameterKey);
                if (parameter == null) throw invalid(use.source(), use.path(), "UNKNOWN_PARAMETER", "公式参数不存在或不属于当前技能");
                List<FormulaValues> next = new ArrayList<>();
                for (FormulaValues combination : combinations) for (var value : staticParameterValues(use, parameter).entrySet()) {
                    if (!combination.levels().compatible(value.getKey())) continue;
                    Map<String, Fraction> values = new LinkedHashMap<>(combination.inputs());
                    values.put(text(input, "key"), value.getValue());
                    next.add(new FormulaValues(combination.levels().merge(value.getKey()), values));
                    if (next.size() > 10000) throw invalid(use.source(), use.path(), "FORMULA_LIMIT", "静态等级组合超限");
                }
                combinations = next;
            }
            Map<String, JsonNode> stages = new LinkedHashMap<>();
            for (JsonNode stage : definition.path("stages")) stages.put(text(stage, "key"), stage.path("expression"));
            Map<Levels, Fraction> results = new LinkedHashMap<>();
            for (FormulaValues combination : combinations) {
                try {
                    results.put(combination.levels(), evaluateStage(text(definition, "outputStageKey"), stages, combination.inputs(), new LinkedHashMap<>()));
                } catch (ArithmeticException ex) {
                    throw invalid(use.source(), use.path(), "FORMULA_NOT_STATIC", "共同公式在实际静态分支存在除零或上下界错误");
                }
            }
            if (results.isEmpty()) throw invalid(use.source(), use.path(), "FORMULA_NOT_STATIC", "公式没有可求值的等级组合");
            return results;
        }

        private static Fraction evaluateStage(String key, Map<String, JsonNode> stages, Map<String, Fraction> inputs, Map<String, Fraction> cache) {
            if (!cache.containsKey(key)) cache.put(key, evaluateExpression(stages.get(key), stages, inputs, cache));
            return cache.get(key);
        }

        private static Fraction evaluateExpression(JsonNode node, Map<String, JsonNode> stages, Map<String, Fraction> inputs, Map<String, Fraction> cache) {
            String op = text(node, "op");
            if (op.equals("const")) return Fraction.of(new BigDecimal(text(node, "value")));
            if (op.equals("read")) return inputs.get(text(node, "inputKey"));
            if (op.equals("ref")) return evaluateStage(text(node, "stageKey"), stages, inputs, cache);
            JsonNode args = node.path("args");
            Fraction a = evaluateExpression(args.get(0), stages, inputs, cache);
            if (op.equals("if")) return evaluateExpression(args.get(a.numerator().signum() == 0 ? 2 : 1), stages, inputs, cache);
            if (Set.of("floor", "ceil", "trunc", "round").contains(op)) {
                int decimals = op.equals("round") ? node.path("decimals").asInt() : 0;
                java.math.RoundingMode mode = switch (op) {
                    case "floor" -> java.math.RoundingMode.FLOOR;
                    case "ceil" -> java.math.RoundingMode.CEILING;
                    case "trunc" -> java.math.RoundingMode.DOWN;
                    default -> java.math.RoundingMode.HALF_UP;
                };
                return Fraction.of(new BigDecimal(a.numerator()).divide(new BigDecimal(a.denominator()), decimals, mode));
            }
            Fraction b = evaluateExpression(args.get(1), stages, inputs, cache);
            int comparison = a.compareTo(b);
            return switch (op) {
                case "add" -> a.add(b); case "sub" -> a.subtract(b); case "mul" -> a.multiply(b); case "div" -> a.divide(b);
                case "min" -> comparison <= 0 ? a : b; case "max" -> comparison >= 0 ? a : b;
                case "eq" -> truth(comparison == 0); case "ne" -> truth(comparison != 0);
                case "lt" -> truth(comparison < 0); case "lte" -> truth(comparison <= 0);
                case "gt" -> truth(comparison > 0); case "gte" -> truth(comparison >= 0);
                case "clamp" -> {
                    Fraction c = evaluateExpression(args.get(2), stages, inputs, cache);
                    if (b.compareTo(c) > 0) throw new ArithmeticException("下界大于上界");
                    yield a.compareTo(b) < 0 ? b : a.compareTo(c) > 0 ? c : a;
                }
                default -> throw new IllegalStateException("未支持的共同公式运算");
            };
        }

        private static Fraction truth(boolean value) { return Fraction.of(value ? BigDecimal.ONE : BigDecimal.ZERO); }
        private Set<String> runtime(Use use) {
            Set<String> keys = new LinkedHashSet<>();
            if (use.value().kind() == SkillNumericValue.Kind.PARAMETER) {
                Parameter p = parameter(use);
                if ("RUNTIME_INPUT".equals(p.valueMode())) keys.add(p.key());
            } else if (use.value().kind() == SkillNumericValue.Kind.FORMULA) {
                Aggregate formula = objects.get(new Id(use.source().skillKey(), SourceType.FORMULA, use.value().formulaKey()));
                if (formula == null) throw invalid(use.source(), use.path(), "UNKNOWN_FORMULA", "公式不存在或不属于当前技能");
                collectFormulaParameters(formula.data().path("expression"), keys, use);
            }
            return keys;
        }

        private void collectFormulaParameters(JsonNode definition, Set<String> runtime, Use use) {
            String skill = use.source().skillKey();
            var issue = xyz.game.datamanage.service.skillformula.SkillFormulaParser.structuralIssue(skill, definition);
            if (issue != null) throw invalid(use.source(), use.path() + "/expression" + issue.path(), issue.code(), "共同公式定义不合法");
            for (JsonNode binding : xyz.game.datamanage.support.formula.SkillFormulaBindings.reachableBindings(definition)) {
                if (!"parameter".equals(text(binding, "kind"))) continue;
                Parameter p = parameters.get(skill + "/" + text(binding, "parameterKey"));
                if (p == null) throw invalid(use.source(), use.path(), "UNKNOWN_PARAMETER", "共同公式参数不存在");
                if ("RUNTIME_INPUT".equals(p.valueMode())) runtime.add(p.key());
            }
        }
        private void dependencies(Aggregate consumer, Id target, Set<String> runtime, Set<Id> visited) {
            if (!visited.add(target)) return;
            Aggregate a = objects.get(target);
            if (a == null) return; // 引用存在性已由统一引用校验保护。
            collect(a);
            for (Use use : uses.getOrDefault(target, List.of())) {
                Set<String> inputs = runtime(use);
                if (!consumer.skillKey().equals(a.skillKey()) && !inputs.isEmpty()) {
                    throw invalid(consumer, "actions.runtimeInputBindings", "FOREIGN_RUNTIME_INPUT_UNSUPPORTED",
                        "跨技能状态的计算时参数属于其定义技能，不能由当前技能的同名参数代替绑定");
                }
                runtime.addAll(inputs);
            }
            if (a.type() == SourceType.PROCESS) {
                for (JsonNode binding : a.data().path("effectBindings")) dependencies(consumer, new Id(a.skillKey(), SourceType.EFFECT, text(binding, "effectKey")), runtime, visited);
                for (JsonNode operation : a.data().path("stateOperations")) {
                    String owner = text(operation, "stateSkillKey");
                    // 未改旧过程的只读依赖仍沿其既有本技能归属，新写由引用校验要求显式所属技能。
                    Id stateId = new Id(owner.isEmpty() ? a.skillKey() : owner, SourceType.STATE, text(operation, "stateKey"));
                    Aggregate state = objects.get(stateId);
                    if ((state != null && Set.of("COUNTER", "AMMO").contains(text(state.data(), "stateType")))
                        || "RESET".equals(text(operation, "operation")) || ("START".equals(text(operation, "operation"))
                        && state != null && "INTERNAL_COOLDOWN".equals(text(state.data(), "stateType")))) dependencies(consumer, stateId, runtime, visited);
                }
            }
        }

        private void bindings(Aggregate rule) {
            int i = 0;
            for (JsonNode action : rule.data().path("actions")) {
                Set<String> required = new LinkedHashSet<>();
                String type = text(action, "actionType");
                if ("EXECUTE_EFFECT".equals(type)) {
                    String effectKey = text(action.path("detail"), "effectKey");
                    dependencies(rule, new Id(rule.skillKey(), SourceType.EFFECT, effectKey), required, new LinkedHashSet<>());
                    validateResultModifiers(rule, action, i, effectKey);
                }
                if ("START_PROCESS".equals(type)) dependencies(rule, new Id(rule.skillKey(), SourceType.PROCESS, text(action.path("detail"), "processKey")), required, new LinkedHashSet<>());
                Set<String> bound = new LinkedHashSet<>();
                int j = 0;
                for (JsonNode binding : action.path("runtimeInputBindings")) {
                    String path = "actions[" + i + "].runtimeInputBindings[" + j++ + "]";
                    String key = text(binding, "parameterKey");
                    Parameter p = parameters.get(rule.skillKey() + "/" + key);
                    if (!bound.add(key)) throw invalid(rule, path, "BINDING_DUPLICATE", "同一参数不能重复绑定");
                    if (p == null || !"RUNTIME_INPUT".equals(p.valueMode()) || !required.contains(key)) throw invalid(rule, path, "BINDING_EXTRA", "绑定参数不是该动作需要的计算时输入");
                    if ("EVENT_VALUE".equals(text(binding, "sourceType"))) validateSkillHitEventValue(rule, binding.path("detail"), path + ".detail");
                    if ("SOURCE_CAST_RESOURCE_COST".equals(text(binding, "sourceType"))) {
                        JsonNode detail = binding.path("detail");
                        if (!detail.isObject() || detail.size() != 1 || !detail.path("attributeKey").isTextual()
                            || detail.path("attributeKey").asText().isBlank()) {
                            throw invalid(rule, path + ".detail", "VALUE_SHAPE_INVALID", "来源施放消耗明细只能包含资源属性标识");
                        }
                        if (!sourceCastResourceCostAllowed(rule)) {
                            throw invalid(rule, path + ".sourceType", "EVENT_VALUE_NOT_AVAILABLE",
                                "来源施放消耗仅适用于明确来源技能的技能命中，或当前技能非被动过程的完成与失败时点");
                        }
                    }
                    if ("INTEGER".equals(p.valueType()) && bindingDomain(binding) == SkillTriggerValueDomain.DECIMAL) throw invalid(rule, path, "REFERENCE_TYPE_MISMATCH", "小数来源不能绑定整数参数");
                }
                if (!bound.containsAll(required)) throw invalid(rule, "actions[" + i + "].runtimeInputBindings", "BINDING_MISSING", "动作需要的计算时输入缺少绑定");
                i++;
            }
        }

        private void validateResultModifiers(Aggregate rule, JsonNode action, int actionIndex, String effectKey) {
            Aggregate effect = objects.get(new Id(rule.skillKey(), SourceType.EFFECT, effectKey));
            if (effect == null) return; // 引用存在性由统一引用校验保护。
            int modifierIndex = 0;
            for (JsonNode modifier : action.path("resultModifiers")) {
                String resultKey = text(modifier, "resultKey");
                JsonNode result = null;
                int resultIndex = 0;
                for (JsonNode candidate : effect.data().path("results")) {
                    if (resultKey.equals(text(candidate, "resultKey"))) {
                        result = candidate;
                        break;
                    }
                    resultIndex++;
                }
                if (result != null
                    && "COOLDOWN_CHANGE".equals(text(result, "resultType"))
                    && SkillEffectCooldownChangeOperation.REDUCE_REMAINING_RATIO.name()
                        .equals(text(result.path("detail"), "operation"))) {
                    String valuePath = "results[" + resultIndex + "].valueRule.value";
                    Use valueUse = findUse(effect, valuePath);
                    validateRemainingCooldownRatio(
                        rule,
                        valueUse,
                        result.path("valueRule"),
                        modifier,
                        "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]"
                    );
                }
                if (result != null
                    && "LIFECYCLE_OPERATION".equals(text(result, "resultType"))
                    && "EXTEND_DURATION".equals(text(result.path("detail"), "operation"))) {
                    String valuePath = "results[" + resultIndex + "].valueRule.value";
                    Use valueUse = findUse(effect, valuePath);
                    validateExtendedDuration(
                        rule,
                        valueUse,
                        result.path("valueRule"),
                        modifier,
                        "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]"
                    );
                }
                if (result != null
                    && "COOLDOWN_CHANGE".equals(text(result, "resultType"))
                    && SkillEffectCooldownChangeOperation.SET_REMAINING.name()
                        .equals(text(result.path("detail"), "operation"))) {
                    validateSetRemainingCooldown(rule,
                        findUse(effect, "results[" + resultIndex + "].valueRule.value"),
                        result.path("valueRule"), modifier,
                        "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]");
                }
                if (result != null && isHealingRatioMaxDecrease(result)) {
                    validateHealingRatioMaxDecrease(
                        rule,
                        findUse(effect, "results[" + resultIndex + "].valueRule.value"),
                        result.path("valueRule"),
                        modifier,
                        "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]"
                    );
                }
                modifierIndex++;
            }
        }

        private Use findUse(Aggregate source, String path) {
            for (Use use : uses.getOrDefault(id(source), List.of())) {
                if (use.path().equals(path)) return use;
            }
            return null;
        }

        private boolean isHealingRatioMaxDecrease(JsonNode result) {
            if (!"HEALING_MODIFIER".equals(text(result, "resultType"))) {
                return false;
            }
            JsonNode detail = result.path("detail");
            if (!"DECREASE".equals(text(detail, "operation"))) {
                return false;
            }
            return "RATIO_MAX".equals(zoneModes.get(text(detail, "modifierZoneKey")));
        }

        private void validateHealingRatioMaxDecrease(
            Aggregate source,
            Use valueUse,
            JsonNode valueRule,
            String errorPath
        ) {
            validateHealingRatioMaxDecrease(source, valueUse, valueRule, null, errorPath);
        }

        private void validateHealingRatioMaxDecrease(
            Aggregate source,
            Use valueUse,
            JsonNode valueRule,
            JsonNode modifier,
            String errorPath
        ) {
            Map<Levels, Fraction> known = valueUse == null ? null : optionalStaticValues(valueUse);
            if (known == null) return;
            for (Fraction value : known.values()) {
                Fraction effective = applyFixedRule(value, valueRule);
                if (modifier != null) effective = applyFixedRule(effective, modifier);
                if (!finite(effective)
                    || effective.compareTo(Fraction.of(BigDecimal.ZERO)) < 0
                    || effective.compareTo(Fraction.of(BigDecimal.ONE)) > 0) {
                    throw invalid(source, errorPath, "VALUE_RANGE_INVALID", "比例减少取强的有效减少比例必须有限且位于0到1之间");
                }
            }
        }

        private void validateRemainingCooldownRatio(
            Aggregate source,
            Use valueUse,
            JsonNode valueRule,
            String errorPath
        ) {
            validateRemainingCooldownRatio(source, valueUse, valueRule, null, errorPath);
        }

        private void validateRemainingCooldownRatio(
            Aggregate source,
            Use valueUse,
            JsonNode valueRule,
            JsonNode modifier,
            String errorPath
        ) {
            Map<Levels, Fraction> known = valueUse == null ? null : optionalStaticValues(valueUse);
            if (known == null) return;
            for (Fraction value : known.values()) {
                Fraction effective = applyFixedRule(value, valueRule);
                if (modifier != null) effective = applyFixedRule(effective, modifier);
                if (effective.compareTo(Fraction.of(BigDecimal.ZERO)) < 0 || effective.compareTo(Fraction.of(BigDecimal.ONE)) > 0) {
                    throw invalid(source, errorPath, "VALUE_RANGE_INVALID", "按比例减少剩余冷却的有效比例必须在0到1之间");
                }
            }
        }

        private void validateSetRemainingCooldown(
            Aggregate source,
            Use valueUse,
            JsonNode valueRule,
            JsonNode modifier,
            String errorPath
        ) {
            BigDecimal upperBound = decimal(valueRule, "fixedMaxValue");
            BigDecimal modifierUpperBound = modifier == null ? null : decimal(modifier, "fixedMaxValue");
            if ((upperBound != null && upperBound.signum() < 0)
                || (modifierUpperBound != null && modifierUpperBound.signum() < 0)) {
                throw invalid(source, errorPath, "VALUE_RANGE_INVALID", "设置剩余冷却不能使用负数上界");
            }
            Map<Levels, Fraction> known = valueUse == null ? null : optionalStaticValues(valueUse);
            if (known == null) return;
            for (Fraction value : known.values()) {
                Fraction effective = applyFixedRule(value, valueRule);
                if (modifier != null) effective = applyFixedRule(effective, modifier);
                if (effective.numerator().signum() < 0 || !finite(effective)) {
                    throw invalid(source, errorPath, "VALUE_RANGE_INVALID", "设置剩余冷却的有效毫秒数必须是有限非负数");
                }
            }
        }

        private void validateExtendedDuration(
            Aggregate source,
            Use valueUse,
            JsonNode valueRule,
            String errorPath
        ) {
            validateExtendedDuration(source, valueUse, valueRule, null, errorPath);
        }

        private void validateExtendedDuration(
            Aggregate source,
            Use valueUse,
            JsonNode valueRule,
            JsonNode modifier,
            String errorPath
        ) {
            Map<Levels, Fraction> known = valueUse == null ? null : optionalStaticValues(valueUse);
            if (known == null) return;
            for (Fraction value : known.values()) {
                Fraction effective = applyFixedRule(value, valueRule);
                if (modifier != null) effective = applyFixedRule(effective, modifier);
                if (!finite(effective)) {
                    throw invalid(source, errorPath, "VALUE_RANGE_INVALID", "延长剩余时长的有效增加毫秒数超出可保存范围");
                }
                if (effective.numerator().signum() < 0) {
                    throw invalid(source, errorPath, "VALUE_RANGE_INVALID", "延长剩余时长的有效增加毫秒数不能小于零");
                }
                if (!effective.denominator().equals(BigInteger.ONE)) {
                    throw invalid(source, errorPath, "VALUE_TYPE_MISMATCH", "延长剩余时长的有效增加毫秒数必须为整数");
                }
            }
        }

        private static boolean finite(Fraction value) {
            return Double.isFinite(new BigDecimal(value.numerator()).divide(new BigDecimal(value.denominator()), java.math.MathContext.DECIMAL128).doubleValue());
        }

        private static Fraction applyFixedRule(Fraction value, JsonNode rule) {
            if (rule == null || !rule.isObject()) return value;
            BigDecimal multiplier = decimal(rule, "fixedMultiplier");
            Fraction effective = multiplier == null ? value : value.multiply(Fraction.of(multiplier));
            BigDecimal minimum = decimal(rule, "fixedMinValue"), maximum = decimal(rule, "fixedMaxValue");
            if (minimum != null && effective.compareTo(Fraction.of(minimum)) < 0) effective = Fraction.of(minimum);
            if (maximum != null && effective.compareTo(Fraction.of(maximum)) > 0) effective = Fraction.of(maximum);
            return effective;
        }
        private static BigDecimal decimal(JsonNode parent, String field) {
            JsonNode value = parent.get(field);
            return value != null && value.isNumber() ? value.decimalValue() : null;
        }

        private void validateSkillHitEventValue(Aggregate rule, JsonNode detail, String path) {
            String valueKey = text(detail, "eventValueKey");
            if ("CHARGE_DURATION_MS".equals(valueKey) && !SkillChargeDurationSemantics.valueAvailable(rule, objects.values())) {
                throw invalid(rule, path + ".eventValueKey", "EVENT_VALUE_NOT_AVAILABLE", "充能时长必须来自本技能实际充能释放组成或合法充能过程时点");
            }
            String label = switch (valueKey) {
                case "SKILL_HIT_SPELL_SHIELD_BLOCKED" -> "技能命中护盾结果";
                case "SKILL_HIT_FIRST_CONTACT" -> "本次使用首次目标接触";
                default -> null;
            };
            if (label != null && !"SKILL_HIT".equals(text(rule.data().path("eventSource"), "eventType"))) {
                throw invalid(rule, path + ".eventValueKey", "EVENT_VALUE_NOT_AVAILABLE", label + "只适用于技能命中事件");
            }
        }

        private boolean sourceCastResourceCostAllowed(Aggregate rule) {
            JsonNode event = rule.data().path("eventSource");
            String eventTypeName = text(event, "eventType");
            SkillTriggerEventType eventType;
            try {
                eventType = SkillTriggerEventType.valueOf(eventTypeName);
            } catch (IllegalArgumentException ex) {
                return false;
            }
            if (eventType == SkillTriggerEventType.SKILL_HIT) {
                return SkillTriggerEventCapabilities.sourceCastResourceCostAvailable(
                    eventType, text(event.path("detail"), "sourceSkillKey"));
            }
            if (eventType != SkillTriggerEventType.PROCESS_MOMENT) {
                return false;
            }
            JsonNode detail = event.path("detail");
            SkillProcessMomentType momentType;
            try {
                momentType = SkillProcessMomentType.valueOf(text(detail.path("moment"), "momentType"));
            } catch (IllegalArgumentException ex) {
                return false;
            }
            Aggregate process = objects.get(new Id(rule.skillKey(), SourceType.PROCESS, text(detail, "processKey")));
            boolean currentSkillNonPassive = process != null
                && !"PASSIVE".equals(text(process.data(), "activationType"));
            return SkillTriggerEventCapabilities.sourceCastResourceCostAvailable(
                eventType, null, momentType, currentSkillNonPassive);
        }

        private SkillTriggerValueDomain bindingDomain(JsonNode binding) {
            JsonNode detail = binding.path("detail");
            return switch (text(binding, "sourceType")) {
                case "INTERNAL_STATE", "COMBAT_STATUS" -> "REMAINING_MS".equals(text(detail, "valueKind")) ? SkillTriggerValueDomain.DECIMAL : SkillTriggerValueDomain.INTEGER;
                case "EVENT_VALUE" -> SkillTriggerEventCapabilities.valueDomain(SkillTriggerEventValueKey.valueOf(text(detail, "eventValueKey")));
                case "SOURCE_CAST_RESOURCE_COST" -> SkillTriggerValueDomain.DECIMAL;
                case "COMBAT_ELAPSED_TIME", "RECENT_DAMAGE_SUM" -> SkillTriggerValueDomain.DECIMAL;
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
