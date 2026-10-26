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
        validate(gameId, sources, context, Set.of());
    }

    public void validate(String gameId, List<Aggregate> sources, List<Aggregate> context, Set<String> enabledAttributes) {
        List<Parameter> parameters = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(PARAMETERS_SQL, gameId)) {
            Object fixed = row.get("fixed_value");
            parameters.add(new Parameter((String) row.get("skill_key"), (String) row.get("parameter_key"),
                (String) row.get("value_type"), (String) row.get("value_mode"),
                fixed == null ? null : new BigDecimal(fixed.toString()),
                AggregateJson.tree((String) row.get("level_values")),
                row.get("skill_max_level") instanceof Number number ? number.intValue() : null));
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
        validate(sources, context, parameters, zoneModes, zoneDomains, zoneStages, enabledAttributes);
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
        validate(sources, objects, parameters, zoneModes, zoneDomains, zoneStages, Set.of());
    }

    static void validate(List<Aggregate> sources, List<Aggregate> objects, List<Parameter> parameters,
                         Map<String, String> zoneModes, Map<String, String> zoneDomains, Map<String, String> zoneStages,
                         Set<String> enabledAttributes) {
        Context context = new Context(objects, parameters, zoneModes, zoneDomains, zoneStages, enabledAttributes);
        context.validateSceneStartProcessUniqueness(sources.stream().map(Aggregate::skillKey).collect(java.util.stream.Collectors.toSet()));
        for (Aggregate aggregate : sources) context.collect(aggregate);
        SkillTargetTimingSemantics.validate(sources, objects, context::targetTimingNumber);
        for (Aggregate aggregate : sources) if (aggregate.type() == SourceType.TRIGGER) context.bindings(aggregate);
    }

    public record Parameter(String skillKey, String key, String valueType, String valueMode,
                            BigDecimal fixedValue, JsonNode levelValues, Integer skillMaxLevel) {
        public Parameter(String skillKey, String key, String valueType, String valueMode,
                         BigDecimal fixedValue, JsonNode levelValues) {
            this(skillKey, key, valueType, valueMode, fixedValue, levelValues, null);
        }
    }

    /** 只核快照实际必要的新封顶声明；不对无关旧图追加管理提交规则。 */
    public static void validateCappedDamageModifiers(List<Aggregate> sources, List<Aggregate> objects, List<Parameter> parameters,
        Map<String, String> zoneModes, Map<String, String> zoneDomains, Map<String, String> zoneStages, Set<String> enabledAttributes) {
        Context context = new Context(objects, parameters, zoneModes, zoneDomains, zoneStages, enabledAttributes);
        for (Aggregate source : sources) if (source.type() == SourceType.EFFECT && source.data().path("results").valueStream().anyMatch(result ->
            result.path("detail").has("maximumReductionRatioValue") || "DAMAGE".equals(zoneDomains.get(text(result.path("detail"), "modifierZoneKey")))
                && "FLAT_ADD".equals(zoneModes.get(text(result.path("detail"), "modifierZoneKey")))
                && "DAMAGE_PRE_DEFENSE".equals(zoneStages.get(text(result.path("detail"), "modifierZoneKey"))))) context.collect(source);
    }

    /** 快照只复核实际闭包内的分组比例及消费动作，保持原区域引用与数值规则。 */
    public static void validateGroupedAmplification(List<Aggregate> sources, List<Aggregate> objects, List<Parameter> parameters,
        Map<String, String> zoneModes, Map<String, String> zoneDomains, Map<String, String> zoneStages) {
        Context context = new Context(objects, parameters, zoneModes, zoneDomains, zoneStages);
        Set<Id> groupedEffects = new LinkedHashSet<>();
        for (Aggregate source : sources) if (source.type() == SourceType.EFFECT && source.data().path("results").valueStream()
            .anyMatch(result -> "RATIO_GROUP_ADD".equals(zoneModes.get(text(result.path("detail"), "modifierZoneKey"))))) {
            groupedEffects.add(id(source));
            context.collect(source);
        }
        for (Aggregate source : sources) if (source.type() == SourceType.TRIGGER) {
            int index = 0;
            for (JsonNode action : source.data().path("actions")) {
                String effectKey = text(action.path("detail"), "effectKey");
                if ("EXECUTE_EFFECT".equals(text(action, "actionType"))
                    && groupedEffects.contains(new Id(source.skillKey(), SourceType.EFFECT, effectKey))) {
                    context.validateResultModifiers(source, action, index, effectKey, true);
                }
                index++;
            }
        }
    }

    /** 快照按真实来源选定参数后复用共同静态求值；不接受运行输入或未定等级组合。 */
    public static BigInteger snapshotStaticInteger(Aggregate source, JsonNode value, String path,
        List<Aggregate> context, List<Parameter> selectedParameters) {
        Context numeric = new Context(context, selectedParameters, Map.of(), Map.of(), Map.of());
        Use use;
        try { use = new Use(source, path, SkillNumericValue.fromJson(value)); }
        catch (IllegalArgumentException invalid) { throw invalid(source, path, "VALUE_SHAPE_INVALID", "只读目标计数数值形状不合法"); }
        if (use.value() == null) throw invalid(source, path, "REQUIRED", "只读目标计数需要明确静态数值");
        Map<Levels, Fraction> values = numeric.optionalStaticValues(use);
        if (values == null || values.size() != 1) throw invalid(source, path, "STATIC_REQUIRED", "只读目标计数必须在实际所属等级静态可求值");
        Fraction known = values.values().iterator().next();
        if (!known.denominator().equals(BigInteger.ONE) || known.numerator().abs().compareTo(BigInteger.valueOf(9007199254740991L)) > 0)
            throw invalid(source, path, "VALUE_RANGE_INVALID", "只读目标计数数值必须为安全整数");
        return known.numerator();
    }

    /** 只读快照复核新声明，不向旧来源追加整套管理写校验。 */
    public static void validateTargetTiming(List<Aggregate> sources, List<Aggregate> context, List<Parameter> parameters) {
        Context numeric = new Context(context, parameters, Map.of(), Map.of(), Map.of());
        SkillTargetTimingSemantics.validate(sources, context, numeric::targetTimingNumber);
        for (Aggregate source : sources) if (source.type() == SourceType.TRIGGER) {
            numeric.validateTargetCounterTimeConditions(source);
            int i = 0;
            for (JsonNode action : source.data().path("actions")) {
                if ("ENSURE_REMAINING_PRESERVE_PHASE".equals(text(action.path("detail"), "operation"))) numeric.validatePhaseExtensionAction(source, action, i);
                else if ("ENSURE_REMAINING".equals(text(action.path("detail"), "operation"))) numeric.validateEnsureTargetCounterTimeAction(source, action, i);
                i++;
            }
        }
    }

    public static boolean targetTimingNaturalRootsOnly(String skill, JsonNode configuration, List<Aggregate> context, List<Parameter> parameters) {
        Context numeric = new Context(context, parameters, Map.of(), Map.of(), Map.of());
        return SkillTargetTimingSemantics.deferrableRoots(skill, configuration, (rule, value, expected) -> {
            try {
                numeric.targetTimingNumber(new Aggregate(SourceType.TRIGGER, skill, text(rule, "ruleKey"), rule), value, "conditionGroups.conditions.comparisonValue",
                    expected == 0 ? SkillTargetTimingSemantics.NumberKind.ZERO : SkillTargetTimingSemantics.NumberKind.ONE, null);
                return true;
            } catch (ApiException invalid) { return false; }
        });
    }
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
        private final Set<String> enabledAttributes;
        private Set<String> cappedDefenseAttributes;

        private Context(List<Aggregate> aggregates, List<Parameter> parameters, Map<String, String> zoneModes,
                        Map<String, String> zoneDomains, Map<String, String> zoneStages) {
            this(aggregates, parameters, zoneModes, zoneDomains, zoneStages, Set.of());
        }

        private Context(List<Aggregate> aggregates, List<Parameter> parameters, Map<String, String> zoneModes,
                        Map<String, String> zoneDomains, Map<String, String> zoneStages, Set<String> enabledAttributes) {
            for (Aggregate a : aggregates) objects.put(id(a), a);
            for (Parameter p : parameters) this.parameters.put(p.skillKey() + "/" + p.key(), p);
            this.zoneModes = zoneModes == null ? Map.of() : zoneModes;
            this.zoneDomains = zoneDomains == null ? Map.of() : zoneDomains;
            this.zoneStages = zoneStages == null ? Map.of() : zoneStages;
            this.enabledAttributes = Set.copyOf(enabledAttributes);
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
                        if (r.path("detail").has("maximumReductionRatioValue") && !"DAMAGE_MODIFIER".equals(text(r, "resultType")))
                            throw invalid(a, path + ".detail.maximumReductionRatioValue", "FORBIDDEN", "其它结果不得夹带封顶平减比例");
                        boolean current = "PERSISTENT".equals(text(r.path("lifecycleBehavior"), "moment"))
                            && "MOMENT_EVALUATION".equals(text(r.path("lifecycleBehavior"), "valueReadMode"));
                        String lifecycleOperation = text(r.path("detail"), "operation");
                        boolean extendDuration = "LIFECYCLE_OPERATION".equals(text(r, "resultType"))
                            && "EXTEND_DURATION".equals(lifecycleOperation);
                        boolean ensureRemaining = "LIFECYCLE_OPERATION".equals(text(r, "resultType"))
                            && "ENSURE_REMAINING".equals(lifecycleOperation);
                        boolean groupedAmplification = "RATIO_GROUP_ADD".equals(zoneModes.get(text(r.path("detail"), "modifierZoneKey")));
                        Bound valueBound = groupedAmplification ? Bound.NON_NEGATIVE_FINITE : Bound.ANY;
                        if ("LIFECYCLE_OPERATION".equals(text(r, "resultType")) && !extendDuration && !ensureRemaining) {
                            valueBound = Bound.INTEGER;
                        } else if ("COOLDOWN_CHANGE".equals(text(r, "resultType"))
                            && SkillEffectCooldownChangeOperation.SET_REMAINING.name()
                                .equals(text(r.path("detail"), "operation"))) {
                            valueBound = Bound.NON_NEGATIVE_FINITE;
                        }
                        Use valueUse = use(a, r.path("valueRule"), path + ".valueRule", "value",
                            valueBound,
                            current);
                        if (current && "STATUS_OPERATION".equals(text(r, "resultType"))) {
                            validateMomentSlow(a, r, valueUse, path);
                        }
                        if ("ATTRIBUTE_CHANGE".equals(text(r, "resultType")) && r.path("detail").has("requiredShield")) {
                            requireStaticOne(a, life, "maxStacksValue");
                            requireStaticOne(a, life, "applicationStacksValue");
                            if (valueUse == null) throw invalid(a, path + ".valueRule", "REQUIRED", "护盾依赖属性必须明确静态数值");
                            Map<Levels, Fraction> values;
                            try { values = staticConditionValues(valueUse); }
                            catch (ApiException ex) { throw invalid(a, path + ".valueRule.value", "STATIC_SHIELD_ATTRIBUTE_REQUIRED", "护盾依赖属性须在全部声明等级静态求值"); }
                            boolean ratioDecrease = "DECREASE".equals(text(r.path("detail"), "operation"))
                                && !"FLAT_ADD".equals(zoneModes.get(text(r.path("detail"), "modifierZoneKey")));
                            for (Fraction raw : values.values()) {
                                Fraction value = applyFixedRule(raw, r.path("valueRule"));
                                if (!finite(value) || value.numerator().signum() < 0
                                    || ratioDecrease && value.compareTo(Fraction.of(BigDecimal.ONE)) > 0)
                                    throw invalid(a, path + ".valueRule.value", "STATIC_SHIELD_ATTRIBUTE_REQUIRED", "护盾依赖属性金额须有限非负，比例减少不得超过1");
                            }
                        }
                        if ("COOLDOWN_DURATION_MODIFIER".equals(text(r, "resultType"))) {
                            List<Map<String, String>> issues = SkillCooldownDurationSemantics.issues(life, r, path);
                            if (!issues.isEmpty()) {
                                Map<String, String> issue = issues.getFirst();
                                throw invalid(a, issue.get("field"), issue.get("code"), issue.get("message"));
                            }
                            validateCooldownDuration(a, valueUse, r.path("valueRule"), null, path + ".valueRule.value");
                            requireCooldownStatic(a, use(a, life, "lifecycle", "durationValue", Bound.POSITIVE_INTEGER, true),
                                false, "lifecycle.durationValue");
                            for (String field : List.of("maxStacksValue", "applicationStacksValue")) {
                                requireCooldownStatic(a, use(a, life, "lifecycle", field, Bound.POSITIVE_INTEGER, true),
                                    true, "lifecycle." + field);
                            }
                        }
                        if ("RATIO_COMPLEMENT_MULTIPLY".equals(zoneModes.get(text(r.path("detail"), "modifierZoneKey")))) {
                            List<Map<String, String>> issues = new ArrayList<>();
                            AttributeComplementMultiplySemantics.addReferenceIssues(
                                xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode.RATIO_COMPLEMENT_MULTIPLY,
                                text(r, "resultType"), text(r.path("detail"), "operation"),
                                path + ".detail.modifierZoneKey", path + ".detail.operation", issues);
                            if (!issues.isEmpty()) {
                                Map<String, String> issue = issues.getFirst();
                                throw invalid(a, issue.get("field"), issue.get("code"), issue.get("message"));
                            }
                            validateUnitRatio(a, valueUse, r.path("valueRule"), null, path + ".valueRule.value");
                        }
                        if (groupedAmplification) {
                            JsonNode detail = r.path("detail");
                            String zoneKey = text(detail, "modifierZoneKey");
                            List<Map<String, String>> issues = new ArrayList<>();
                            GroupedAmplificationSemantics.addReferenceIssues(zoneDomains.get(zoneKey), zoneModes.get(zoneKey),
                                zoneStages.get(zoneKey), text(r, "resultType"), text(detail, "direction"),
                                text(detail, "operation"), text(detail, "criticalFilter"), path, issues);
                            if (!issues.isEmpty()) {
                                Map<String, String> issue = issues.getFirst();
                                throw invalid(a, issue.get("field"), issue.get("code"), issue.get("message"));
                            }
                            validateGroupedAmplification(a, valueUse, r.path("valueRule"), null, path + ".valueRule.value");
                        }
                        if (extendDuration) {
                            validateExtendedDuration(a, valueUse, r.path("valueRule"), path + ".valueRule.value");
                        }
                        if (ensureRemaining) {
                            requireSafeStaticMilliseconds(a, valueUse, r.path("valueRule"), false, path + ".valueRule.value");
                            validateEnsureRemainingTarget(a, r, path);
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
                        if ("COOLDOWN_CHANGE".equals(text(r, "resultType"))
                            && SkillEffectCooldownChangeOperation.REDUCE_TOTAL_RATIO.name()
                                .equals(text(r.path("detail"), "operation"))) {
                            validateTotalCooldownRatio(a, valueUse, r.path("valueRule"), null, path + ".valueRule.value");
                        }
                        if (isHealingRatioMaxDecrease(r)) {
                            validateHealingRatioMaxDecrease(a, valueUse, r.path("valueRule"), path + ".valueRule.value");
                        }
                        if ("DAMAGE_MODIFIER".equals(text(r, "resultType"))) {
                            validateCappedDamageModifier(a, r, path);
                            validateDamageModifierCondition(a, r, path);
                            if (isDamageRatioMultiply(r)) {
                                List<Map<String, String>> issues = new ArrayList<>();
                                DamageRatioMultiplySemantics.addReferenceIssues(
                                    xyz.game.datamanage.model.modifierzone.ModifierZoneDomain.DAMAGE,
                                    xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode.RATIO_MULTIPLY,
                                    text(r, "resultType"), text(r.path("detail"), "direction"), text(r.path("detail"), "operation"),
                                    path + ".detail.modifierZoneKey", path + ".detail.direction", path + ".detail.operation", issues);
                                if (!issues.isEmpty()) {
                                    Map<String, String> issue = issues.getFirst();
                                    throw invalid(a, issue.get("field"), issue.get("code"), issue.get("message"));
                                }
                                validateUnitRatio(a, valueUse, r.path("valueRule"), null, path + ".valueRule.value");
                            }
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
                    var stateIssues = SkillStateInitialParameterSemantics.detailIssues(text(d, "stateType"), text(d, "scope"), detail);
                    if (!stateIssues.isEmpty()) {
                        var issue = stateIssues.getFirst();
                        throw invalid(a, issue.get("field"), issue.get("code"), issue.get("message"));
                    }
                    switch (text(d, "stateType")) {
                        case "COUNTER", "AMMO" -> {
                            Use initial = use(a, detail, "detail", "initialValue", Bound.NON_NEGATIVE_INTEGER, false);
                            Use maximum = use(a, detail, "detail", "maxValue", "AMMO".equals(text(d, "stateType"))
                                ? Bound.POSITIVE_INTEGER : Bound.NON_NEGATIVE_INTEGER, false);
                            compareInitialCapacity(initial, maximum);
                            validateStateInitialBinding(a, "initialValueBinding");
                            if ("AMMO".equals(text(d, "stateType"))) {
                                use(a, detail, "detail", "recoveryIntervalValue", Bound.POSITIVE, false);
                                Use remaining = use(a, detail, "detail", "initialRemainingValue", Bound.NON_NEGATIVE_INTEGER,
                                    !detail.hasNonNull("initialRemainingMsBinding"));
                                validateSafeInteger(remaining);
                                validateStateInitialBinding(a, "initialRemainingMsBinding");
                            }
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
                            case "RECAST" -> validateRecast(a, detail, path);
                            case "EMPOWERED_BASIC_ATTACK" -> validateEmpowered(a, step, detail, path);
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
                        if ("MODIFY_INTERNAL_STATE".equals(text(action, "actionType"))) {
                            Use value = use(a, action.path("detail"), "actions[" + actionIndex + "].detail", "value",
                                ("ENSURE_REMAINING".equals(text(action.path("detail"), "operation")) || "ENSURE_REMAINING_PRESERVE_PHASE".equals(text(action.path("detail"), "operation")))
                                    ? Bound.POSITIVE_INTEGER : Bound.NON_NEGATIVE_FINITE, true);
                            if (value == null) throw invalid(a, "actions[" + actionIndex + "].detail.value", "REQUIRED", "状态计时动作必须配置数值");
                        }
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

        private void validateStateInitialBinding(Aggregate state, String field) {
            JsonNode detail = state.data().path("detail"), binding = detail.path(field);
            if (binding.isMissingNode() || binding.isNull()) return;
            String key = text(binding, "parameterKey");
            Parameter parameter = parameters.get(state.skillKey() + "/" + key);
            if (parameter == null || !"INTEGER".equals(parameter.valueType()) || !noDefaultRuntime(parameter)) {
                throw invalid(state, "detail." + field + ".parameterKey", "REFERENCE_TYPE_MISMATCH",
                    "状态初值必须绑定本技能无默认值的整数计算时参数");
            }
            for (String other : List.of("maxValue", "durationValue", "recoveryIntervalValue")) {
                JsonNode raw = detail.get(other);
                if (raw != null && !raw.isNull()) {
                    Use use = new Use(state, "detail." + other, SkillNumericValue.fromJson(raw));
                    if (runtime(use).contains(key)) throw invalid(state, use.path(), "EVENT_VALUE_NOT_AVAILABLE",
                        "状态初值声明不能供给容量、时长或回充间隔");
                }
            }
        }

        private static boolean noDefaultRuntime(Parameter parameter) {
            return "RUNTIME_INPUT".equals(parameter.valueMode()) && parameter.fixedValue() == null
                && (parameter.levelValues() == null || parameter.levelValues().isNull() || parameter.levelValues().isMissingNode());
        }

        private void validateSafeInteger(Use use) {
            Map<Levels, Fraction> known = use == null ? null : optionalStaticValues(use);
            if (known == null) return;
            Fraction maximum = Fraction.of(new BigDecimal("9007199254740991"));
            for (Fraction value : known.values()) if (value.compareTo(maximum) > 0) {
                throw invalid(use.source(), use.path(), "VALUE_RANGE_INVALID", "状态初始余时必须为非负安全整数毫秒");
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

        private void validateRecast(Aggregate source, JsonNode detail, String path) {
            for (String field : List.of("windowValue", "maximumRecastCountValue", "intervalValue")) {
                Use value = use(source, detail, path, field, Bound.ANY, true);
                if (value == null) {
                    if ("intervalValue".equals(field)) continue;
                    throw invalid(source, path + "." + field, "REQUIRED", "重施必须明确窗口及额外施放次数");
                }
                Map<Levels, Fraction> values = optionalStaticValues(value);
                if (values == null) throw invalid(source, value.path(), "STATIC_REQUIRED", "重施时间和次数必须在全部等级静态可求值");
                BigInteger maximum = BigInteger.valueOf("maximumRecastCountValue".equals(field) ? 63L : 9007199254740991L);
                for (Fraction number : values.values()) {
                    if (!number.denominator().equals(BigInteger.ONE))
                        throw invalid(source, value.path(), "VALUE_TYPE_MISMATCH", "重施时间和次数必须是整数");
                    if (number.numerator().signum() <= 0 || number.numerator().compareTo(maximum) > 0)
                        throw invalid(source, value.path(), "VALUE_RANGE_INVALID", "重施窗口及间隔须为正安全整数毫秒，额外次数为1至63");
                }
            }
        }

        private void validateEmpowered(Aggregate source, JsonNode step, JsonNode detail, String path) {
            if (!detail.has("maximumAttackCountValue")) {
                use(source, detail, path, "windowValue", Bound.NON_NEGATIVE, false);
                if ("ATTACK_START".equals(text(detail, "consumeMoment"))) {
                    throw invalid(source, path, "REQUIRED", "发动消费必须明确最多消费次数");
                }
                return;
            }
            if (!"ATTACK_START".equals(text(detail, "consumeMoment"))
                || source.data().path("steps").size() != 1 || !step.path("occupiesAction").isBoolean()
                || step.path("occupiesAction").booleanValue() || !"ACTIVE".equals(text(source.data(), "activationType"))) {
                throw invalid(source, path, "COMBINATION_INVALID", "多次强化只接主动单步骤、不占行动且发动消费");
            }
            for (String field : List.of("windowValue", "maximumAttackCountValue")) {
                Use value = use(source, detail, path, field, Bound.POSITIVE_INTEGER, true);
                if (value == null) throw invalid(source, path + "." + field, "REQUIRED", "多次强化必须明确窗口及消费次数");
                Map<Levels, Fraction> values = optionalStaticValues(value);
                if (values == null) throw invalid(source, value.path(), "RUNTIME_INPUT_FORBIDDEN", "窗口和消费次数须可静态求值");
                Fraction maximum = Fraction.of(new BigDecimal("maximumAttackCountValue".equals(field) ? "64" : "9007199254740991"));
                for (Fraction number : values.values()) if (!finite(number) || number.compareTo(maximum) > 0) {
                    throw invalid(source, value.path(), "VALUE_RANGE_INVALID", "窗口须为正安全整数毫秒，消费次数为1至64");
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
            validateEffectElapsedUse(use);
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

        /** 生命周期已过时间只属于当前有效的单层属性或普通减速，不属于整场时间或施加快照。 */
        private void validateEffectElapsedUse(Use use) {
            if (use.value().kind() != SkillNumericValue.Kind.FORMULA) return;
            Aggregate formula = objects.get(new Id(use.source().skillKey(), SourceType.FORMULA, use.value().formulaKey()));
            if (formula == null) return;
            boolean elapsed = formula.data().path("expression").path("inputs").valueStream()
                .map(input -> input.path("binding"))
                .anyMatch(binding -> "context".equals(text(binding, "kind"))
                    && "effect_elapsed_ms".equals(text(binding, "contextKey")));
            if (!elapsed) return;
            var match = java.util.regex.Pattern.compile("results\\[(\\d+)]\\.valueRule\\.value").matcher(use.path());
            JsonNode life = use.source().data().path("lifecycle");
            JsonNode result = match.matches() ? use.source().data().path("results").path(Integer.parseInt(match.group(1))) : null;
            boolean valid = use.source().type() == SourceType.EFFECT && result != null
                && ("ATTRIBUTE_CHANGE".equals(text(result, "resultType"))
                    || "STATUS_OPERATION".equals(text(result, "resultType"))
                        && "APPLY".equals(text(result.path("detail"), "operation")))
                && "PERSISTENT".equals(text(result.path("lifecycleBehavior"), "moment"))
                && "MOMENT_EVALUATION".equals(text(result.path("lifecycleBehavior"), "valueReadMode"))
                && result.path("lifecycleBehavior").path("reapplicationValueMode").isNull()
                && life.hasNonNull("durationValue") && "ALL_AT_ONCE".equals(text(life, "expiryMode"))
                && "KEEP".equals(text(life, "reapplicationStackMode"))
                && "REFRESH_ALL".equals(text(life, "reapplicationDurationMode"));
            if (!valid) throw invalid(use.source(), use.path(), "CONTEXT_NOT_AVAILABLE",
                "效果已过时间只允许有限单层、保留层数并刷新全部的持续属性或普通减速当前时点求值");
            requireStaticOne(use.source(), life, "maxStacksValue");
            requireStaticOne(use.source(), life, "applicationStacksValue");
            Use duration = use(use.source(), life, "lifecycle", "durationValue", Bound.NON_NEGATIVE_FINITE, false);
            Map<Levels, Fraction> known = optionalStaticValues(duration);
            if (known != null && known.values().stream().anyMatch(value -> value.numerator().signum() <= 0)) {
                throw invalid(use.source(), "lifecycle.durationValue", "VALUE_RANGE_INVALID", "效果已过时间要求有限且大于零的生命周期");
            }
        }

        private void validateMomentSlow(Aggregate effect, JsonNode result, Use value, String path) {
            JsonNode life = effect.data().path("lifecycle"), behavior = result.path("lifecycleBehavior");
            if (!"APPLY".equals(text(result.path("detail"), "operation"))
                || effect.data().path("results").size() != 1
                || !"SOURCE_TARGET".equals(text(life, "instanceScope"))
                || !"KEEP".equals(text(life, "reapplicationStackMode"))
                || !"REFRESH_ALL".equals(text(life, "reapplicationDurationMode"))
                || !"ALL_AT_ONCE".equals(text(life, "expiryMode"))
                || life.hasNonNull("periodicIntervalValue") || life.hasNonNull("firstPeriodicExecution")
                || life.hasNonNull("endWhenShieldEndsResultKey")
                || !"SHARED".equals(text(behavior, "stackValueMode"))
                || behavior.hasNonNull("reapplicationValueMode") || behavior.hasNonNull("periodicExecutionMode")
                || result.hasNonNull("spellShieldBlockScope")) {
                throw invalid(effect, path + ".lifecycleBehavior", "COMBINATION_INVALID",
                    "当前时点普通减速只接独立单结果、来源与目标分组、有限单层保留并刷新全部；不能配置快照合并、周期或法盾粒度");
            }
            JsonNode rule = result.path("valueRule");
            if (value == null || rule.hasNonNull("fixedMinValue") || rule.hasNonNull("fixedMaxValue")) {
                throw invalid(effect, path + ".valueRule", "VALUE_RANGE_INVALID",
                    "当前时点减速必须明确强度且上下界为空，由运行时校验倍率后强度在0至1之间");
            }
            BigDecimal multiplier = decimal(rule, "fixedMultiplier");
            if (multiplier != null && (!finite(Fraction.of(multiplier)) || multiplier.signum() < 0)) {
                throw invalid(effect, path + ".valueRule.fixedMultiplier", "VALUE_RANGE_INVALID", "当前时点减速倍率必须是有限非负数");
            }
            for (String field : List.of("maxStacksValue", "applicationStacksValue", "durationValue")) {
                Use lifeValue = use(effect, life, "lifecycle", field, Bound.POSITIVE_INTEGER, true);
                if (lifeValue == null) throw invalid(effect, "lifecycle." + field, "REQUIRED", "当前时点减速必须明确正整数期限和单层");
                Map<Levels, Fraction> values = staticConditionValues(lifeValue);
                for (Fraction number : values.values()) {
                    if (!finite(number) || number.compareTo(Fraction.of(new BigDecimal("9007199254740991"))) > 0
                        || !"durationValue".equals(field) && number.compareTo(Fraction.of(BigDecimal.ONE)) != 0) {
                        throw invalid(effect, lifeValue.path(), "VALUE_RANGE_INVALID", "当前时点减速只接安全整数正期限及恒为1的层数");
                    }
                }
            }
            if (value.value().kind() == SkillNumericValue.Kind.FORMULA) {
                Aggregate formula = objects.get(new Id(effect.skillKey(), SourceType.FORMULA, value.value().formulaKey()));
                for (JsonNode input : formula.data().path("expression").path("inputs")) {
                    JsonNode binding = input.path("binding");
                    if ("context".equals(text(binding, "kind"))
                        && "effect_elapsed_ms".equals(text(binding, "contextKey"))) continue;
                    if ("parameter".equals(text(binding, "kind"))) {
                        Parameter parameter = parameters.get(effect.skillKey() + "/" + text(binding, "parameterKey"));
                        if (parameter == null) throw invalid(effect, value.path(), "UNKNOWN_PARAMETER", "当前时点减速参数不存在");
                        for (Fraction number : staticParameterValues(value, parameter).values()) {
                            if (!finite(number)) throw invalid(effect, value.path(), "VALUE_RANGE_INVALID", "当前时点减速参数必须为有限静态数");
                        }
                        continue;
                    }
                    throw invalid(effect, value.path(), "CONTEXT_NOT_AVAILABLE", "当前时点普通减速只允许本实例已过时间及冻结静态值");
                }
            }
            Map<Levels, Fraction> known = optionalStaticValues(value);
            if (known != null) for (Fraction number : known.values()) {
                if (!finite(number)) throw invalid(effect, value.path(), "VALUE_RANGE_INVALID", "当前时点减速原始静态数值必须有限，不能用零倍率掩盖溢出");
                Fraction strength = applyFixedRule(number, rule);
                if (!finite(strength) || strength.compareTo(Fraction.of(BigDecimal.ZERO)) < 0
                    || strength.compareTo(Fraction.of(BigDecimal.ONE)) > 0) {
                    throw invalid(effect, value.path(), "VALUE_RANGE_INVALID", "当前时点普通减速的倍率后强度必须在0至1之间");
                }
            }
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

        private void validateCappedDamageModifier(Aggregate effect, JsonNode result, String path) {
            JsonNode detail = result.path("detail");
            String zone = text(detail, "modifierZoneKey");
            boolean flatPre = "DAMAGE".equals(zoneDomains.get(zone)) && "FLAT_ADD".equals(zoneModes.get(zone))
                && "DAMAGE_PRE_DEFENSE".equals(zoneStages.get(zone));
            String capPath = path + ".detail.maximumReductionRatioValue";
            if (!flatPre) {
                if (detail.has("maximumReductionRatioValue")) throw invalid(effect, capPath, "FORBIDDEN",
                    "封顶比例只用于防御前承受平减");
                return;
            }
            if (!detail.hasNonNull("maximumReductionRatioValue")) throw invalid(effect, capPath, "REQUIRED", "封顶平减必须明确最大减免比例");
            Aggregate damageType = objects.get(new Id("", SourceType.DAMAGE_TYPE, text(detail, "damageTypeKey")));
            if (damageType == null || !"ENABLED".equals(text(damageType.data(), "status")) || !damageType.data().path("formula").isObject())
                throw invalid(effect, path + ".detail.damageTypeKey", "REFERENCE_DISABLED", "封顶平减必须引用当前游戏真实启用且有结算公式的单一伤害类型");
            if (xyz.game.datamanage.support.formula.FormulaContractValidator.validate(damageType.data().path("formula"),
                xyz.game.datamanage.support.formula.DamageTypeFormulaBindings.allowed(enabledAttributes)) != null)
                throw invalid(effect, path + ".detail.damageTypeKey", "DAMAGE_TYPE_FORMULA_INVALID", "封顶平减伤害类型的真实结算公式必须结构完整");
            JsonNode life = effect.data().path("lifecycle"), behavior = result.path("lifecycleBehavior"), rule = result.path("valueRule");
            if (!"SOURCE".equals(text(result, "target")) || !"TAKEN".equals(text(detail, "direction"))
                || !"DECREASE".equals(text(detail, "operation")) || text(detail, "damageTypeKey").isEmpty()
                || !"ANY".equals(text(detail, "deliveryKind")) || !"ANY".equals(text(detail, "originKind"))
                || !"ANY".equals(text(detail, "criticalFilter")) || detail.hasNonNull("condition")
                || result.hasNonNull("spellShieldBlockScope") || effect.data().path("results").size() != 1
                || !life.isObject() || life.hasNonNull("durationValue") || !"SOURCE".equals(text(life, "instanceScope"))
                || !"KEEP".equals(text(life, "reapplicationStackMode")) || life.hasNonNull("reapplicationDurationMode")
                || !"EXPLICIT_ONLY".equals(text(life, "expiryMode")) || life.hasNonNull("periodicIntervalValue")
                || life.hasNonNull("firstPeriodicExecution") || life.hasNonNull("endWhenShieldEndsResultKey")
                || !"PERSISTENT".equals(text(behavior, "moment")) || !"MOMENT_EVALUATION".equals(text(behavior, "valueReadMode"))
                || !"SHARED".equals(text(behavior, "stackValueMode")) || behavior.hasNonNull("reapplicationValueMode")
                || behavior.hasNonNull("periodicExecutionMode")) {
                throw invalid(effect, path + ".detail", "CAPPED_REDUCTION_SHAPE_INVALID", "封顶平减只接无条件单层永久自身承受、明确单伤害类型的减少结果");
            }
            for (String field : List.of("maxStacksValue", "applicationStacksValue")) {
                Use one = use(effect, life, "lifecycle", field, Bound.POSITIVE_INTEGER, false);
                if (one == null || cappedStaticValues(one).values().stream().anyMatch(v -> v.compareTo(Fraction.of(BigDecimal.ONE)) != 0))
                    throw invalid(effect, "lifecycle." + field, "STATIC_ONE_REQUIRED", "封顶平减生命周期必须全部等级恒为单层");
            }
            Use cap = use(effect, detail, path + ".detail", "maximumReductionRatioValue", Bound.NON_NEGATIVE_FINITE, false);
            for (Fraction value : cappedStaticValues(cap).values()) {
                if (!finite(value) || value.compareTo(Fraction.of(BigDecimal.ZERO)) < 0 || value.compareTo(Fraction.of(BigDecimal.ONE)) > 0)
                    throw invalid(effect, capPath, "VALUE_RANGE_INVALID", "最大减免比例的全部声明等级必须有限且位于0到1");
            }
            if (!rule.path("fixedMinValue").isNumber() || rule.path("fixedMinValue").decimalValue().compareTo(BigDecimal.ZERO) != 0)
                throw invalid(effect, path + ".valueRule.fixedMinValue", "ZERO_MINIMUM_REQUIRED", "减伤点数必须明确以下限0夹取");
            BigDecimal multiplier = decimal(rule, "fixedMultiplier"), maximum = decimal(rule, "fixedMaxValue");
            if (multiplier == null || !Double.isFinite(multiplier.doubleValue()) || multiplier.signum() < 0
                || rule.hasNonNull("fixedMaxValue") && (maximum == null || !Double.isFinite(maximum.doubleValue()) || maximum.signum() < 0))
                throw invalid(effect, path + ".valueRule", "VALUE_RANGE_INVALID", "减伤点数的倍率和固定边界必须完整、有限且非负");
            Use amount = findUse(effect, path + ".valueRule.value");
            if (amount == null || amount.value() == null)
                throw invalid(effect, path + ".valueRule.value", "REQUIRED", "减伤点数必须明确供值");
            if (amount.value().kind() == SkillNumericValue.Kind.FORMULA) {
                Aggregate formula = objects.get(new Id(effect.skillKey(), SourceType.FORMULA, amount.value().formulaKey()));
                if (formula == null) throw invalid(effect, amount.path(), "UNKNOWN_FORMULA", "减伤点数公式必须属于本技能");
                JsonNode definition = formula.data().path("expression");
                var structure = xyz.game.datamanage.support.formula.FormulaContractValidator.validate(definition,
                    xyz.game.datamanage.support.formula.SkillFormulaBindings.allowed(effect.skillKey(), enabledAttributes,
                        parameters.values().stream().filter(parameter -> effect.skillKey().equals(parameter.skillKey())).map(Parameter::key).toList()));
                if (structure != null) throw invalid(effect, amount.path() + structure.path(), structure.code(), "封顶点数共同公式结构或声明权限不合法");
                for (JsonNode input : definition.path("inputs")) {
                    JsonNode binding = input.path("binding");
                    if ("parameter".equals(text(binding, "kind")) && effect.skillKey().equals(text(binding, "skillKey"))) {
                        cappedStaticValues(new Use(effect, amount.path(), SkillNumericValue.parameter(text(binding, "parameterKey"))));
                    } else if (!("attribute".equals(text(binding, "kind")) && "source".equals(text(binding, "object"))
                        && "current_frame".equals(text(binding, "view")) && "BONUS".equals(text(binding, "valueKind"))
                        && enabledAttributes.contains(text(binding, "attributeKey")) && cappedDefenseAttributes(effect, amount.path()).contains(text(binding, "attributeKey")))) {
                        throw invalid(effect, amount.path(), "CAPPED_REDUCTION_BINDING_FORBIDDEN", "点数公式只接本技能静态参数和真实结算公式证明的当前拥有者额外抗性");
                    }
                }
            } else cappedStaticValues(amount);
            int initializers = 0;
            for (Aggregate candidate : objects.values()) {
                if (candidate.type() != SourceType.TRIGGER || !candidate.skillKey().equals(effect.skillKey())) continue;
                JsonNode trigger = candidate.data();
                for (JsonNode action : trigger.path("actions")) {
                    if (!"EXECUTE_EFFECT".equals(text(action, "actionType")) || !effect.key().equals(text(action.path("detail"), "effectKey"))) continue;
                    initializers++;
                    if (!"SOURCE_INITIALIZED".equals(text(trigger.path("eventSource"), "eventType"))
                        || !trigger.path("eventSource").path("detail").isObject() || !trigger.path("eventSource").path("detail").isEmpty()
                        || !trigger.path("conditionGroups").isArray() || !trigger.path("conditionGroups").isEmpty()
                        || trigger.path("actions").size() != 1 || !"EVENT_SOURCE".equals(text(action, "targetContext"))
                        || !action.path("runtimeInputBindings").isArray() || !action.path("runtimeInputBindings").isEmpty()
                        || !action.path("resultModifiers").isArray() || !action.path("resultModifiers").isEmpty()
                        || trigger.hasNonNull("oncePerUse") || trigger.hasNonNull("perTargetCooldown") || trigger.hasNonNull("maxTriggersPerProcess"))
                        throw invalid(effect, path, "CAPPED_REDUCTION_INITIALIZER_INVALID", "永久平减只能由本来源唯一无条件初始化施加");
                }
            }
            if (initializers != 1) throw invalid(effect, path, "CAPPED_REDUCTION_INITIALIZER_REQUIRED", "永久平减必须有唯一真实来源初始化");
        }

        private Map<Levels, Fraction> cappedStaticValues(Use value) {
            if (value.value() == null) throw invalid(value.source(), value.path(), "REQUIRED", "必须明确静态数值");
            if (value.value().kind() == SkillNumericValue.Kind.FIXED) return Map.of(new Levels("", ""), Fraction.of(value.value().value()));
            if (value.value().kind() != SkillNumericValue.Kind.PARAMETER) throw invalid(value.source(), value.path(), "STATIC_PARAMETER_REQUIRED", "只允许固定值或本技能静态参数");
            Parameter parameter = parameter(value);
            if (!Set.of("INTEGER", "DECIMAL").contains(parameter.valueType())
                || "FIXED".equals(parameter.valueMode()) && parameter.levelValues() != null && !parameter.levelValues().isNull())
                throw invalid(value.source(), value.path(), "PARAMETER_VALUES_INVALID", "静态数值参数不得夹带其它模式取值");
            Map<Levels, Fraction> values = staticParameterValues(value, parameter);
            if (values.values().stream().anyMatch(number -> !finite(number)))
                throw invalid(value.source(), value.path(), "PARAMETER_VALUES_INVALID", "静态参数的全部声明值必须有限");
            if (!"FIXED".equals(parameter.valueMode())) {
                List<Integer> levels = new ArrayList<>();
                List<String> declaredKeys = new ArrayList<>();
                parameter.levelValues().fieldNames().forEachRemaining(declaredKeys::add);
                for (String key : declaredKeys) {
                    if (!key.matches("[1-9][0-9]*")) throw invalid(value.source(), value.path(), "PARAMETER_VALUES_INVALID", "等级声明必须使用正整数键");
                    try { levels.add(Integer.valueOf(key)); }
                    catch (NumberFormatException badLevel) { throw invalid(value.source(), value.path(), "PARAMETER_VALUES_INVALID", "等级声明超出整数范围"); }
                }
                levels.sort(Integer::compareTo);
                int first = "SKILL_LEVEL".equals(parameter.valueMode()) ? 1 : levels.getFirst();
                int last = "SKILL_LEVEL".equals(parameter.valueMode()) && parameter.skillMaxLevel() != null ? parameter.skillMaxLevel() : levels.getLast();
                if ("SKILL_LEVEL".equals(parameter.valueMode()) && parameter.skillMaxLevel() == null)
                    throw invalid(value.source(), value.path(), "SKILL_LEVEL_RANGE_REQUIRED", "静态技能等级参数必须有真实技能上限");
                if (levels.size() != last - first + 1 || levels.getFirst() != first || levels.getLast() != last)
                    throw invalid(value.source(), value.path(), "PARAMETER_VALUES_INVALID", "必须完整声明连续等级取值");
            }
            return values;
        }

        private Set<String> cappedDefenseAttributes(Aggregate source, String path) {
            if (cappedDefenseAttributes != null) return cappedDefenseAttributes;
            Set<String> result = new LinkedHashSet<>();
            for (Aggregate catalog : objects.values()) {
                if (catalog.type() != SourceType.DAMAGE_TYPE || !"ENABLED".equals(text(catalog.data(), "status"))) continue;
                JsonNode formula = catalog.data().path("formula");
                var issue = xyz.game.datamanage.support.formula.FormulaContractValidator.validate(formula,
                    xyz.game.datamanage.support.formula.DamageTypeFormulaBindings.allowed(enabledAttributes));
                if (issue != null) throw invalid(source, path, "DAMAGE_TYPE_FORMULA_INVALID", "抗性权限证明需要真实启用且结构完整的伤害结算公式");
                for (JsonNode binding : xyz.game.datamanage.support.formula.SkillFormulaBindings.reachableBindings(formula)) {
                    if ("attribute".equals(text(binding, "kind")) && "target".equals(text(binding, "object"))
                        && "current_frame".equals(text(binding, "view")) && "TOTAL".equals(text(binding, "valueKind"))) result.add(text(binding, "attributeKey"));
                }
            }
            cappedDefenseAttributes = Set.copyOf(result);
            return cappedDefenseAttributes;
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
                    && Set.of("ATTRIBUTE_FORBIDDEN", "CONTEXT_FORBIDDEN").contains(fields.get("code")))) return null;
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
                if ("context".equals(text(binding, "kind"))) throw invalid(use.source(), use.path(), "CONTEXT_FORBIDDEN", "静态数值公式不能读取生命周期上下文");
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
                if (declaredStateInitialUse(use)) continue;
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

        private boolean declaredStateInitialUse(Use use) {
            if (use.source().type() != SourceType.STATE) return false;
            JsonNode detail = use.source().data().path("detail");
            return "detail.initialValue".equals(use.path()) && detail.hasNonNull("initialValueBinding")
                || "detail.initialRemainingValue".equals(use.path()) && detail.hasNonNull("initialRemainingMsBinding");
        }

        private void bindings(Aggregate rule) {
            validateTargetCounterTimeConditions(rule);
            int i = 0;
            for (JsonNode action : rule.data().path("actions")) {
                Set<String> required = new LinkedHashSet<>();
                String type = text(action, "actionType");
                if ("EXECUTE_EFFECT".equals(type)) {
                    String effectKey = text(action.path("detail"), "effectKey");
                    dependencies(rule, new Id(rule.skillKey(), SourceType.EFFECT, effectKey), required, new LinkedHashSet<>());
                    validateResultModifiers(rule, action, i, effectKey, false);
                    Aggregate effect = objects.get(new Id(rule.skillKey(), SourceType.EFFECT, effectKey));
                    if (effect != null && effect.data().path("results").valueStream().anyMatch(result ->
                        "LIFECYCLE_OPERATION".equals(text(result, "resultType")) && "ENSURE_REMAINING".equals(text(result.path("detail"), "operation")))
                        && (!action.path("runtimeInputBindings").isEmpty() || !action.path("resultModifiers").isEmpty())) {
                        throw invalid(rule, "actions[" + i + "]", "COMBINATION_INVALID", "至少保留剩余时长必须使用静态完整结果，不能再绑定输入或修正数值");
                    }
                }
                if ("START_PROCESS".equals(type)) dependencies(rule, new Id(rule.skillKey(), SourceType.PROCESS, text(action.path("detail"), "processKey")), required, new LinkedHashSet<>());
                if ("MODIFY_INTERNAL_STATE".equals(type)) {
                    if ("ENSURE_REMAINING_PRESERVE_PHASE".equals(text(action.path("detail"), "operation"))) validatePhaseExtensionAction(rule, action, i);
                    else if ("ENSURE_REMAINING".equals(text(action.path("detail"), "operation"))) validateEnsureTargetCounterTimeAction(rule, action, i);
                    else validateRecoveryAction(rule, action, i);
                }
                Set<String> bound = new LinkedHashSet<>();
                int j = 0;
                for (JsonNode binding : action.path("runtimeInputBindings")) {
                    String path = "actions[" + i + "].runtimeInputBindings[" + j++ + "]";
                    String key = text(binding, "parameterKey");
                    Parameter p = parameters.get(rule.skillKey() + "/" + key);
                    if (!bound.add(key)) throw invalid(rule, path, "BINDING_DUPLICATE", "同一参数不能重复绑定");
                    if (p == null || !"RUNTIME_INPUT".equals(p.valueMode()) || !required.contains(key)) throw invalid(rule, path, "BINDING_EXTRA", "绑定参数不是该动作需要的计算时输入");
                    if ("START_PROCESS".equals(type)) {
                        validateCounterStartBinding(rule, action, binding, p, path);
                    }
                    if ("EVENT_VALUE".equals(text(binding, "sourceType"))) validateSkillHitEventValue(rule, binding.path("detail"), path + ".detail");
                    if ("SCENE_ATTRIBUTE_SNAPSHOT".equals(text(binding, "sourceType"))) {
                        Aggregate process = objects.get(new Id(rule.skillKey(), SourceType.PROCESS, text(action.path("detail"), "processKey")));
                        SkillSceneAttributeSnapshotSemantics.validateBinding(rule, action, process, binding, path);
                        if (!Set.of("INTEGER", "DECIMAL").contains(p.valueType())) {
                            throw invalid(rule, path + ".parameterKey", "REFERENCE_TYPE_MISMATCH", "场景属性快照只能绑定数值参数");
                        }
                    }
                    if ("SCENE_INITIAL_PARAMETER".equals(text(binding, "sourceType"))) {
                        Aggregate sceneProcess = objects.get(new Id(rule.skillKey(), SourceType.PROCESS, text(action.path("detail"), "processKey")));
                        SkillSceneInitialParameterSemantics.validateBinding(rule, action, sceneProcess, binding, p.valueType(), path);
                        if (!Set.of("INTEGER", "DECIMAL").contains(p.valueType()) || !noDefaultRuntime(p)) {
                            throw invalid(rule, path, "REFERENCE_TYPE_MISMATCH", "场景显式初值只能绑定无默认的数值运行输入");
                        }
                        if ("START_PROCESS".equals(type)) validateScenePayloadBinding(rule, sceneProcess, p, path);
                        Aggregate effect = objects.get(new Id(rule.skillKey(), SourceType.EFFECT, text(action.path("detail"), "effectKey")));
                        if (effect != null) {
                            collect(effect);
                            for (Use use : uses.getOrDefault(id(effect), List.of())) {
                                if (runtime(use).contains(key) && !use.path().matches("results\\[\\d+\\]\\.valueRule\\.value")) {
                                    throw invalid(rule, path, "EVENT_VALUE_NOT_AVAILABLE", "场景显式初值只授权本初始化动作的结果数值，不能供给生命周期");
                                }
                            }
                        }
                        for (Use use : uses.getOrDefault(id(rule), List.of())) {
                            if (runtime(use).contains(key)) throw invalid(rule, use.path(), "EVENT_VALUE_NOT_AVAILABLE",
                                "初始化初值不能借给条件或规则时序");
                        }
                    }
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
                    if (!"SCENE_ATTRIBUTE_SNAPSHOT".equals(text(binding, "sourceType"))
                        && "INTEGER".equals(p.valueType()) && bindingDomain(binding) == SkillTriggerValueDomain.DECIMAL) throw invalid(rule, path, "REFERENCE_TYPE_MISMATCH", "小数来源不能绑定整数参数");
                }
                if (!bound.containsAll(required)) throw invalid(rule, "actions[" + i + "].runtimeInputBindings", "BINDING_MISSING", "动作需要的计算时输入缺少绑定");
                i++;
            }
        }

        private void validateTargetCounterTimeConditions(Aggregate rule) {
            int groupIndex = 0;
            for (JsonNode group : rule.data().path("conditionGroups")) {
                int conditionIndex = 0;
                for (JsonNode condition : group.path("conditions")) {
                    JsonNode detail = condition.path("detail");
                    Aggregate state = objects.get(new Id(text(detail, "stateSkillKey"), SourceType.STATE, text(detail, "stateKey")));
                    if ("INTERNAL_STATE_CHECK".equals(text(condition, "conditionType")) && "DAMAGE_BEFORE_VALUE".equals(text(detail, "valueKind"))) {
                        String path = "conditionGroups[" + groupIndex + "].conditions[" + conditionIndex + "].detail";
                        if (!"DAMAGE_DEALT".equals(text(rule.data().path("eventSource"), "eventType")) || state == null
                            || !rule.skillKey().equals(text(detail, "stateSkillKey")) || !"COUNTER".equals(text(state.data(), "stateType"))
                            || !"TARGET".equals(text(state.data(), "scope")) || state.data().path("detail").has("targetTiming")
                            || detail.hasNonNull("optionKey") || detail.hasNonNull("expectedBoolean")
                            || !Set.of("EQ", "NE", "LT", "LTE", "GT", "GTE").contains(detail.path("comparator").asText(""))) {
                            throw invalid(rule, path, "REFERENCE_TYPE_MISMATCH", "伤害前值只允许真实造成伤害事件读取本技能自身目标计数");
                        }
                        Use comparison = use(rule, detail, path, "comparisonValue", Bound.NON_NEGATIVE_INTEGER, true);
                        requireStaticMilliseconds(rule, comparison, path + ".comparisonValue", false);
                    }
                    if ("INTERNAL_STATE_CHECK".equals(text(condition, "conditionType"))
                        && "REMAINING_MS".equals(text(detail, "valueKind")) && state != null
                        && "COUNTER".equals(text(state.data(), "stateType"))) {
                        String path = "conditionGroups[" + groupIndex + "].conditions[" + conditionIndex + "].detail";
                        validateTimedOwnTargetCounter(rule, detail, path);
                        Use comparison = use(rule, detail, path, "comparisonValue", Bound.NON_NEGATIVE_INTEGER, true);
                        requireStaticMilliseconds(rule, comparison, path + ".comparisonValue", false);
                    }
                    conditionIndex++;
                }
                groupIndex++;
            }
        }

        private void validateEnsureTargetCounterTimeAction(Aggregate rule, JsonNode action, int index) {
            String path = "actions[" + index + "]";
            JsonNode detail = action.path("detail"), event = rule.data().path("eventSource"), source = event.path("detail");
            if (!"SKILL_USED".equals(text(event, "eventType")) || !"ACTIVE".equals(text(source, "useKind"))
                || !"INITIAL".equals(text(source, "castPhase")) || text(source, "sourceSkillKey") == null
                || text(source, "sourceSkillKey").isBlank() || !"CURRENT_TARGET".equals(text(action, "targetContext"))
                || !action.path("resultModifiers").isEmpty() || !action.path("runtimeInputBindings").isEmpty()) {
                throw invalid(rule, path, "REFERENCE_TYPE_MISMATCH", "最低目标计数余时只允许明确技能首次主动使用，不接受输入绑定或结果修正");
            }
            validateTimedOwnTargetCounter(rule, detail, path + ".detail");
            Aggregate state = objects.get(new Id(rule.skillKey(), SourceType.STATE, text(detail, "stateKey")));
            if (state.data().path("detail").has("targetTiming"))
                throw invalid(rule, path + ".detail.operation", "COMBINATION_INVALID", "原最低余时动作不能修改目标时序锚");
            Use value = use(rule, detail, path + ".detail", "value", Bound.POSITIVE_INTEGER, true);
            requireStaticMilliseconds(rule, value, path + ".detail.value", true);
        }

        private void validateTimedOwnTargetCounter(Aggregate rule, JsonNode detail, String path) {
            Aggregate state = objects.get(new Id(text(detail, "stateSkillKey"), SourceType.STATE, text(detail, "stateKey")));
            if (!rule.skillKey().equals(text(detail, "stateSkillKey")) || state == null
                || !"COUNTER".equals(text(state.data(), "stateType")) || !"TARGET".equals(text(state.data(), "scope"))) {
                throw invalid(rule, path + ".stateKey", "REFERENCE_TYPE_MISMATCH", "只能读取或保持本技能自身目标范围的有限计数余时");
            }
            Use duration = use(state, state.data().path("detail"), "detail", "durationValue", Bound.POSITIVE_INTEGER, true);
            requireStaticMilliseconds(state, duration, "detail.durationValue", true);
        }

        private void requireStaticMilliseconds(Aggregate source, Use value, String path, boolean positive) {
            Map<Levels, Fraction> values = value == null ? null : optionalStaticValues(value);
            if (values == null || values.isEmpty()) {
                throw invalid(source, path, "STATIC_REQUIRED", "目标计数余时必须在全部等级静态可求值");
            }
            BigInteger maximum = BigInteger.valueOf(9007199254740991L);
            for (Fraction known : values.values()) {
                if (!known.denominator().equals(BigInteger.ONE) || known.numerator().signum() < (positive ? 1 : 0)
                    || known.numerator().compareTo(maximum) > 0) {
                    throw invalid(source, path, "VALUE_RANGE_INVALID", positive
                        ? "目标计数时长必须为严格正安全整数毫秒" : "目标计数余时比较必须为非负安全整数毫秒");
                }
            }
        }

        private boolean targetTimingNumber(Aggregate source, JsonNode node, String path,
            SkillTargetTimingSemantics.NumberKind kind, Aggregate capacity) {
            Use value;
            try { value = new Use(source, path, SkillNumericValue.fromJson(node)); }
            catch (IllegalArgumentException error) { throw invalid(source, path, "VALUE_SHAPE_INVALID", "目标时序数值形状不合法"); }
            uses.computeIfAbsent(id(source), ignored -> new ArrayList<>()).add(value);
            Map<Levels, Fraction> known = optionalStaticValues(value);
            if (known == null || known.isEmpty()) throw invalid(source, path, "STATIC_REQUIRED", "目标时序数值必须在全部等级完整静态可求值");
            BigInteger safe = BigInteger.valueOf(9007199254740991L);
            for (Fraction number : known.values()) {
                if (!finite(number)) throw invalid(source, path, "VALUE_RANGE_INVALID", "目标时序数值必须有限");
                if (kind == SkillTargetTimingSemantics.NumberKind.STATIC) continue;
                if (!number.denominator().equals(BigInteger.ONE) || number.numerator().signum() < 0 || number.numerator().compareTo(safe) > 0
                    || kind == SkillTargetTimingSemantics.NumberKind.ZERO && number.numerator().signum() != 0
                    || kind == SkillTargetTimingSemantics.NumberKind.ONE && !number.numerator().equals(BigInteger.ONE)
                    || kind == SkillTargetTimingSemantics.NumberKind.POSITIVE_SAFE && number.numerator().signum() == 0) {
                    throw invalid(source, path, "VALUE_RANGE_INVALID", "目标时序需要约定范围内的静态安全整数");
                }
            }
            if (capacity != null) {
                Use maximum = new Use(capacity, "detail.maxValue", SkillNumericValue.fromJson(capacity.data().path("detail").path("maxValue")));
                targetTimingNumber(capacity, capacity.data().path("detail").path("maxValue"), "detail.maxValue", SkillTargetTimingSemantics.NumberKind.NON_NEGATIVE_SAFE, null);
                compareInitialCapacity(value, maximum);
            }
            return known.values().stream().allMatch(number -> number.numerator().signum() == 0);
        }

        private void validatePhaseExtensionAction(Aggregate rule, JsonNode action, int index) {
            String path = "actions[" + index + "]";
            JsonNode detail = action.path("detail"), event = rule.data().path("eventSource"), source = event.path("detail");
            if (!"SKILL_HIT".equals(text(event, "eventType")) || text(source, "sourceSkillKey") == null || text(source, "sourceSkillKey").isBlank()
                || !"CURRENT_TARGET".equals(text(action, "targetContext")) || !action.path("runtimeInputBindings").isEmpty() || !action.path("resultModifiers").isEmpty())
                throw invalid(rule, path, "REFERENCE_TYPE_MISMATCH", "保相位续期只允许明确真实技能命中和无修饰当前目标动作");
            validateTimedOwnTargetCounter(rule, detail, path + ".detail");
            Aggregate state = objects.get(new Id(rule.skillKey(), SourceType.STATE, text(detail, "stateKey")));
            if (!"PHASED_TICK".equals(text(state.data().path("detail").path("targetTiming"), "kind")))
                throw invalid(rule, path + ".detail.stateKey", "REFERENCE_TYPE_MISMATCH", "保相位续期必须引用明确周期锚");
            requireStaticMilliseconds(rule, use(rule, detail, path + ".detail", "value", Bound.POSITIVE_INTEGER, true), path + ".detail.value", true);
            JsonNode groups = rule.data().path("conditionGroups");
            if (!groups.isArray() || groups.isEmpty()) throw invalid(rule, "conditionGroups", "COMBINATION_INVALID", "保相位续期必须明确排除法术盾阻挡");
            for (JsonNode group : groups) {
                boolean unblocked = false;
                for (JsonNode condition : group.path("conditions")) {
                    JsonNode check = condition.path("detail");
                    if ("EVENT_VALUE_COMPARE".equals(text(condition, "conditionType")) && "SKILL_HIT_SPELL_SHIELD_BLOCKED".equals(text(check, "eventValueKey"))
                        && "EQ".equals(text(check, "comparator"))) {
                        targetTimingNumber(rule, check.path("comparisonValue"), "conditionGroups.conditions.comparisonValue", SkillTargetTimingSemantics.NumberKind.ZERO, null);
                        unblocked = true;
                    }
                }
                if (!unblocked) throw invalid(rule, "conditionGroups", "COMBINATION_INVALID", "每个或分支均须排除原接触法术盾阻挡");
            }
        }

        private void validateRecoveryAction(Aggregate rule, JsonNode action, int index) {
            String path = "actions[" + index + "]";
            JsonNode detail = action.path("detail"), event = rule.data().path("eventSource");
            Aggregate state = objects.get(new Id(text(detail, "stateSkillKey"), SourceType.STATE, text(detail, "stateKey")));
            if (!"BASIC_ATTACK_HIT".equals(text(event, "eventType")) || !"EVENT_SOURCE".equals(text(action, "targetContext"))
                || !event.path("detail").isObject() || !event.path("detail").isEmpty()
                || !rule.skillKey().equals(text(detail, "stateSkillKey")) || state == null
                || !"AMMO".equals(text(state.data(), "stateType")) || !"SKILL".equals(text(state.data(), "scope"))
                || !"REDUCE_RECOVERY".equals(text(detail, "operation")) || !action.path("resultModifiers").isEmpty()
                || !action.path("runtimeInputBindings").isEmpty()) {
                throw invalid(rule, path, "REFERENCE_TYPE_MISMATCH", "回充减时只允许本技能普攻命中作用于自身技能弹药，不接受结果修正");
            }
        }

        private void validateSceneStartProcessUniqueness(Set<String> changedSkills) {
            for (Aggregate rule : objects.values()) {
                if (rule.type() != SourceType.TRIGGER || !changedSkills.contains(rule.skillKey())) continue;
                for (JsonNode action : rule.data().path("actions")) {
                    if (!"START_PROCESS".equals(text(action, "actionType")) || !action.path("runtimeInputBindings").valueStream()
                        .anyMatch(binding -> "SCENE_INITIAL_PARAMETER".equals(text(binding, "sourceType")))) continue;
                    Set<String> processes = new LinkedHashSet<>();
                    for (Aggregate candidate : objects.values()) {
                        if (candidate.type() != SourceType.TRIGGER || !candidate.skillKey().equals(rule.skillKey())) continue;
                        JsonNode event = candidate.data().path("eventSource"), detail = event.path("detail");
                        if (!"SKILL_USED".equals(text(event, "eventType")) || !rule.skillKey().equals(text(detail, "sourceSkillKey"))
                            || !"ACTIVE".equals(text(detail, "useKind")) || !"INITIAL".equals(text(detail, "castPhase"))) continue;
                        for (JsonNode start : candidate.data().path("actions")) if ("START_PROCESS".equals(text(start, "actionType"))) {
                            processes.add(text(start.path("detail"), "processKey"));
                        }
                    }
                    if (processes.size() != 1 || !processes.contains(text(action.path("detail"), "processKey"))) {
                        throw invalid(rule, "actions.runtimeInputBindings", "COMBINATION_INVALID", "场景负载初值需要本技能唯一真实首次主动过程");
                    }
                }
            }
        }

        private void validateScenePayloadBinding(Aggregate rule, Aggregate process, Parameter parameter, String path) {
            if (process == null) return; // 缺少引用由统一目录检查报告。
            Set<Id> visited = new LinkedHashSet<>();
            dependencies(rule, id(process), new LinkedHashSet<>(), visited);
            Set<Id> payloads = new LinkedHashSet<>();
            for (JsonNode binding : process.data().path("effectBindings")) {
                Id effectId = new Id(process.skillKey(), SourceType.EFFECT, text(binding, "effectKey"));
                boolean consumed = uses.getOrDefault(effectId, List.of()).stream().anyMatch(use -> runtime(use).contains(parameter.key()));
                if (!consumed) continue;
                if (!"STEP_EXECUTION".equals(text(binding.path("moment"), "momentType"))) {
                    throw invalid(rule, path, "EVENT_VALUE_NOT_AVAILABLE", "场景初值只能供给真实步骤执行的命中负载金额");
                }
                payloads.add(effectId);
            }
            boolean consumed = false;
            for (Id target : visited) for (Use use : uses.getOrDefault(target, List.of())) {
                if (declaredStateInitialUse(use) || !runtime(use).contains(parameter.key())) continue;
                boolean allowed = payloads.contains(target) && use.path().matches("results\\[\\d+\\]\\.valueRule\\.value");
                if (allowed) {
                    int index = Integer.parseInt(use.path().substring("results[".length(), use.path().indexOf(']')));
                    allowed = "DAMAGE".equals(text(use.source().data().path("results").path(index), "resultType"));
                }
                if (!allowed) throw invalid(rule, path, "EVENT_VALUE_NOT_AVAILABLE",
                    "场景初值只授权本过程真实伤害负载，不能供给费用、冷却、步骤、生命周期或状态");
                consumed = true;
            }
            if (!consumed) throw invalid(rule, path, "BINDING_EXTRA", "场景初值未被本过程真实伤害负载消费");
        }

        private void validateCounterStartBinding(Aggregate rule, JsonNode action, JsonNode binding, Parameter parameter, String path) {
            Aggregate process = objects.get(new Id(rule.skillKey(), SourceType.PROCESS, text(action.path("detail"), "processKey")));
            if (process == null) return;
            List<Use> affected = uses.getOrDefault(id(process), List.of()).stream()
                .filter(use -> use.path().startsWith("stateOperations[") && runtime(use).contains(parameter.key())).toList();
            if (affected.isEmpty()) return; // 原有非状态操作的绑定保持原校验。
            JsonNode detail = binding.path("detail"), event = rule.data().path("eventSource");
            Aggregate state = objects.get(new Id(text(detail, "stateSkillKey"), SourceType.STATE, text(detail, "stateKey")));
            if (!"INTERNAL_STATE".equals(text(binding, "sourceType"))
                || !"INTEGER".equals(parameter.valueType()) || !noDefaultRuntime(parameter)
                || !rule.skillKey().equals(text(detail, "stateSkillKey")) || !"VALUE".equals(text(detail, "valueKind"))
                || detail.hasNonNull("optionKey") || state == null || !"COUNTER".equals(text(state.data(), "stateType"))
                || !"SKILL".equals(text(state.data(), "scope")) || !"SKILL_USED".equals(text(event, "eventType"))
                || !"INITIAL".equals(text(event.path("detail"), "castPhase"))
                || !rule.skillKey().equals(text(event.path("detail"), "sourceSkillKey"))
                || "PASSIVE".equals(text(process.data(), "activationType"))) {
                throw invalid(rule, path, "REFERENCE_TYPE_MISMATCH", "过程开始状态赋值只接受真实首次动作读取本技能整数计数器");
            }
            for (Use use : affected) {
                int index = Integer.parseInt(use.path().substring("stateOperations[".length(), use.path().indexOf(']')));
                JsonNode operation = process.data().path("stateOperations").path(index);
                Aggregate target = objects.get(new Id(text(operation, "stateSkillKey"), SourceType.STATE, text(operation, "stateKey")));
                if (!"SET".equals(text(operation, "operation")) || !"PROCESS_START".equals(text(operation.path("moment"), "momentType"))
                    || !rule.skillKey().equals(text(operation, "stateSkillKey")) || target == null
                    || !"COUNTER".equals(text(target.data(), "stateType")) || !"SKILL".equals(text(target.data(), "scope"))) {
                    throw invalid(rule, path, "EVENT_VALUE_NOT_AVAILABLE", "动态计数赋值只允许同技能计数器的过程开始 SET");
                }
                if (use.value().kind() == SkillNumericValue.Kind.FORMULA) {
                    Aggregate formula = objects.get(new Id(rule.skillKey(), SourceType.FORMULA, use.value().formulaKey()));
                    if (formula != null) for (JsonNode input : xyz.game.datamanage.support.formula.SkillFormulaBindings
                        .reachableBindings(formula.data().path("expression"))) {
                        if (!"parameter".equals(text(input, "kind")) || !rule.skillKey().equals(text(input, "skillKey"))) {
                            throw invalid(rule, path, "EVENT_VALUE_NOT_AVAILABLE", "动态计数公式只允许同技能已绑定整数状态参数及固定或等级参数");
                        }
                    }
                }
            }
        }

        private void validateResultModifiers(Aggregate rule, JsonNode action, int actionIndex, String effectKey, boolean groupedOnly) {
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
                if (groupedOnly && (result == null || !"RATIO_GROUP_ADD".equals(zoneModes.get(text(result.path("detail"), "modifierZoneKey"))))) {
                    modifierIndex++;
                    continue;
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
                if (result != null && "COOLDOWN_DURATION_MODIFIER".equals(text(result, "resultType"))) {
                    validateCooldownDuration(rule, findUse(effect, "results[" + resultIndex + "].valueRule.value"),
                        result.path("valueRule"), modifier,
                        "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]");
                }
                if (result != null && "COOLDOWN_CHANGE".equals(text(result, "resultType"))
                    && SkillEffectCooldownChangeOperation.REDUCE_TOTAL_RATIO.name()
                        .equals(text(result.path("detail"), "operation"))) {
                    validateTotalCooldownRatio(rule,
                        findUse(effect, "results[" + resultIndex + "].valueRule.value"),
                        result.path("valueRule"), modifier,
                        "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]");
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
                if (result != null && "RATIO_COMPLEMENT_MULTIPLY".equals(
                    zoneModes.get(text(result.path("detail"), "modifierZoneKey")))) {
                    validateUnitRatio(rule, findUse(effect, "results[" + resultIndex + "].valueRule.value"),
                        result.path("valueRule"), modifier,
                        "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]");
                }
                if (result != null && isDamageRatioMultiply(result)) {
                    validateUnitRatio(rule, findUse(effect, "results[" + resultIndex + "].valueRule.value"),
                        result.path("valueRule"), modifier,
                        "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]");
                }
                if (result != null && "RATIO_GROUP_ADD".equals(zoneModes.get(text(result.path("detail"), "modifierZoneKey")))) {
                    validateGroupedAmplification(rule, findUse(effect, "results[" + resultIndex + "].valueRule.value"),
                        result.path("valueRule"), modifier,
                        "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]");
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

        private void requireCooldownStatic(Aggregate source, Use value, boolean one, String path) {
            if (value == null) throw invalid(source, path, "REQUIRED", "冷却时长修正需要明确的有限单层生命周期");
            for (Fraction result : staticConditionValues(value).values()) {
                if (!finite(result) || !result.denominator().equals(BigInteger.ONE)
                    || result.numerator().signum() <= 0
                    || result.compareTo(Fraction.of(new BigDecimal("9007199254740991"))) > 0
                    || one && result.compareTo(Fraction.of(BigDecimal.ONE)) != 0) {
                    throw invalid(source, path, "VALUE_RANGE_INVALID", one
                        ? "冷却时长修正的全部等级层数必须静态恒为1" : "冷却时长修正的持续时间必须是静态正安全整数毫秒");
                }
            }
        }

        private void validateCooldownDuration(Aggregate source, Use value, JsonNode rule, JsonNode modifier, String path) {
            if (value == null) throw invalid(source, path, "REQUIRED", "冷却时长修正必须提供静态正倍率");
            for (Fraction raw : staticConditionValues(value).values()) {
                Fraction effective = applyFixedRule(raw, rule);
                if (modifier != null) effective = applyFixedRule(effective, modifier);
                double number = new BigDecimal(effective.numerator())
                    .divide(new BigDecimal(effective.denominator()), java.math.MathContext.DECIMAL128).doubleValue();
                if (!Double.isFinite(number) || number <= 0) {
                    throw invalid(source, path, "VALUE_RANGE_INVALID", "冷却时长修正的全部等级有效倍率必须静态、有限且大于零");
                }
            }
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

        private boolean isDamageRatioMultiply(JsonNode result) {
            return "DAMAGE_MODIFIER".equals(text(result, "resultType"))
                && "RATIO_MULTIPLY".equals(zoneModes.get(text(result.path("detail"), "modifierZoneKey")));
        }

        private void validateUnitRatio(Aggregate source, Use valueUse, JsonNode valueRule, JsonNode modifier,
                                             String errorPath) {
            Map<Levels, Fraction> known = valueUse == null ? null : optionalStaticValues(valueUse);
            if (known == null) return;
            for (Fraction value : known.values()) {
                Fraction effective = applyFixedRule(value, valueRule);
                if (modifier != null) effective = applyFixedRule(effective, modifier);
                if (!finite(effective) || effective.compareTo(Fraction.of(BigDecimal.ZERO)) < 0
                    || effective.compareTo(Fraction.of(BigDecimal.ONE)) > 0) {
                    throw invalid(source, errorPath, "VALUE_RANGE_INVALID", "连乘的有效比例必须有限且位于0到1之间");
                }
            }
        }

        private void validateGroupedAmplification(Aggregate source, Use use, JsonNode valueRule,
            JsonNode modifier, String path) {
            if (use == null) throw invalid(source, path, "REQUIRED", "同组增幅必须明确提供非负比例");
            Map<Levels, Fraction> known = optionalStaticValues(use);
            if (known == null || known.isEmpty()) {
                throw invalid(source, path, "STATIC_GROUP_RATIO_REQUIRED", "同组增幅比例必须在全部声明等级静态核定");
            }
            String rulePath = use.path().endsWith(".value") ? use.path().substring(0, use.path().length() - 6) : use.path();
            validateGroupedRule(use.source(), valueRule, rulePath);
            if (modifier != null) validateGroupedRule(source, modifier, path);
            for (Fraction raw : known.values()) {
                if (!finite(raw) || raw.numerator().signum() < 0) {
                    throw invalid(source, path, "VALUE_RANGE_INVALID", "同组增幅原始比例必须有限且不小于零");
                }
                Fraction effective = applyFixedRule(raw, valueRule);
                if (!finite(effective) || effective.numerator().signum() < 0) {
                    throw invalid(source, path, "VALUE_RANGE_INVALID", "同组增幅有效比例必须有限且不小于零");
                }
                if (modifier != null) effective = applyFixedRule(effective, modifier);
                if (!finite(effective) || effective.numerator().signum() < 0) {
                    throw invalid(source, path, "VALUE_RANGE_INVALID", "结果修正后的同组增幅比例必须有限且不小于零");
                }
            }
        }

        private void validateGroupedRule(Aggregate source, JsonNode rule, String path) {
            for (String field : List.of("fixedMultiplier", "fixedMinValue", "fixedMaxValue")) {
                if (!rule.hasNonNull(field)) continue;
                JsonNode node = rule.path(field);
                if (!node.isNumber()) throw invalid(source, path + "." + field, "VALUE_SHAPE_INVALID", "同组增幅修正规则必须是明确数值");
                Fraction value = Fraction.of(node.decimalValue());
                if (!finite(value) || "fixedMultiplier".equals(field) && value.numerator().signum() < 0) {
                    throw invalid(source, path + "." + field, "VALUE_RANGE_INVALID", "同组增幅固定倍率必须有限非负，边界必须有限");
                }
            }
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

        private void validateTotalCooldownRatio(
            Aggregate source, Use value, JsonNode rule, JsonNode modifier, String path
        ) {
            if (value == null) throw invalid(source, path, "REQUIRED", "总冷却返还必须提供静态比例");
            Map<Levels, Fraction> values;
            try { values = staticConditionValues(value); }
            catch (ApiException ex) {
                throw invalid(source, path, "STATIC_COOLDOWN_RATIO_REQUIRED", "总冷却返还比例必须在全部等级静态求值");
            }
            for (Fraction raw : values.values()) {
                Fraction effective = applyFixedRule(raw, rule);
                if (modifier != null) effective = applyFixedRule(effective, modifier);
                if (!finite(effective) || effective.compareTo(Fraction.of(BigDecimal.ZERO)) < 0
                    || effective.compareTo(Fraction.of(BigDecimal.ONE)) > 0) {
                    throw invalid(source, path, "VALUE_RANGE_INVALID", "总冷却返还的全部等级有效比例必须有限且位于0到1之间");
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

        private void requireSafeStaticMilliseconds(Aggregate source, Use valueUse, JsonNode rule, boolean positive, String path) {
            Map<Levels, Fraction> known = valueUse == null ? null : optionalStaticValues(valueUse);
            if (known == null || known.isEmpty()) throw invalid(source, path, "STATIC_VALUE_REQUIRED", "剩余时长维护必须使用完整可核定的静态毫秒数");
            Fraction maximum = Fraction.of(new BigDecimal("9007199254740991"));
            for (Fraction value : known.values()) {
                Fraction effective = applyFixedRule(value, rule);
                if (!effective.denominator().equals(BigInteger.ONE)) throw invalid(source, path, "VALUE_TYPE_MISMATCH", "剩余时长维护必须使用安全整数毫秒");
                if (effective.numerator().signum() < (positive ? 1 : 0) || effective.compareTo(maximum) > 0) {
                    throw invalid(source, path, "VALUE_RANGE_INVALID", positive ? "目标持续时间必须是安全正整数毫秒" : "至少保留的剩余时长必须是非负安全整数毫秒");
                }
            }
        }

        private void validateEnsureRemainingTarget(Aggregate source, JsonNode result, String path) {
            JsonNode detail = result.path("detail");
            String targetKey = text(detail, "targetEffectKey");
            Aggregate target = objects.get(new Id(source.skillKey(), SourceType.EFFECT, targetKey));
            if (source.data().hasNonNull("lifecycle") || !"SOURCE".equals(text(result, "target"))
                || result.hasNonNull("lifecycleBehavior") || result.hasNonNull("spellShieldBlockScope")
                || target == null || targetKey.equals(source.key())) {
                throw invalid(source, path + ".detail.targetEffectKey", "REFERENCE_TYPE_MISMATCH", "剩余时长维护只能由即时自身结果引用本技能的其它有期效果");
            }
            JsonNode life = target.data().path("lifecycle");
            if (!life.isObject() || !"SOURCE".equals(text(life, "instanceScope"))
                || !"ALL_AT_ONCE".equals(text(life, "expiryMode")) || !"KEEP".equals(text(life, "reapplicationStackMode"))
                || !"REFRESH_ALL".equals(text(life, "reapplicationDurationMode")) || life.hasNonNull("periodicIntervalValue")
                || life.hasNonNull("firstPeriodicExecution") || life.hasNonNull("endWhenShieldEndsResultKey")
                || !life.hasNonNull("durationValue") || target.data().path("results").isEmpty()) {
                throw invalid(source, path + ".detail.targetEffectKey", "REFERENCE_TYPE_MISMATCH", "续时目标必须是自身无周期单层、一次到期的有限属性效果");
            }
            requireStaticOne(target, life, "maxStacksValue");
            requireStaticOne(target, life, "applicationStacksValue");
            requireSafeStaticMilliseconds(target, use(target, life, "lifecycle", "durationValue", Bound.ANY, false), null, true, "lifecycle.durationValue");
            int index = 0;
            for (JsonNode row : target.data().path("results")) {
                String rowPath = "results[" + index++ + "]";
                JsonNode behavior = row.path("lifecycleBehavior"), attribute = row.path("detail");
                String zoneKey = text(attribute, "modifierZoneKey"), mode = zoneModes.get(zoneKey);
                if (!"ATTRIBUTE_CHANGE".equals(text(row, "resultType")) || !"SOURCE".equals(text(row, "target"))
                    || "hp".equals(text(attribute, "attributeKey")) || text(attribute, "attributeKey").isBlank()
                    || !"INCREASE".equals(text(attribute, "operation")) || row.hasNonNull("spellShieldBlockScope")
                    || !"PERSISTENT".equals(text(behavior, "moment")) || !"APPLICATION_SNAPSHOT".equals(text(behavior, "valueReadMode"))
                    || !"SHARED".equals(text(behavior, "stackValueMode")) || !"REPLACE".equals(text(behavior, "reapplicationValueMode"))
                    || behavior.hasNonNull("periodicExecutionMode") || !row.hasNonNull("valueRule")
                    || !"ATTRIBUTE".equals(zoneDomains.get(zoneKey)) || !("FLAT_ADD".equals(mode) && "ATTRIBUTE_FLAT".equals(zoneStages.get(zoneKey))
                      || Set.of("RATIO_ADD", "RATIO_MULTIPLY", "RATIO_COMPLEMENT_MULTIPLY").contains(mode == null ? "" : mode)
                        && "ATTRIBUTE_PERCENT".equals(zoneStages.get(zoneKey)))) {
                    throw invalid(source, path + ".detail.targetEffectKey", "REFERENCE_TYPE_MISMATCH", "续时目标只接受完整静态的自身非生命属性组");
                }
                Use amount = use(target, row.path("valueRule"), rowPath + ".valueRule", "value", Bound.ANY, false);
                Map<Levels, Fraction> known = amount == null ? null : optionalStaticValues(amount);
                if (known == null || known.isEmpty()) throw invalid(target, rowPath + ".valueRule.value", "STATIC_VALUE_REQUIRED", "续时目标属性必须可静态核定");
                for (Fraction value : known.values()) {
                    Fraction effective = applyFixedRule(value, row.path("valueRule"));
                    if (!finite(effective) || "RATIO_MULTIPLY".equals(mode) && effective.numerator().signum() < 0
                        || "RATIO_COMPLEMENT_MULTIPLY".equals(mode) && (effective.numerator().signum() < 0 || effective.compareTo(Fraction.of(BigDecimal.ONE)) > 0)) {
                        throw invalid(target, rowPath + ".valueRule.value", "VALUE_RANGE_INVALID", "续时目标属性值超出所属修正区的范围");
                    }
                }
            }
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
            if ("SKILL_USE_CONTACT_COUNT".equals(valueKey)
                && !"PROCESS_RESOLVED".equals(text(rule.data().path("eventSource"), "eventType"))) {
                throw invalid(rule, path + ".eventValueKey", "EVENT_VALUE_NOT_AVAILABLE", "本次使用接触次数只适用于过程已结算事件");
            }
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
        SELECT p.skill_key, p.parameter_key, p.value_type, p.value_mode, p.fixed_value, p.level_values::text AS level_values,
               s.max_level AS skill_max_level
        FROM public.skill_parameters p JOIN public.skills s ON s.game_id = p.game_id AND s.skill_key = p.skill_key
        WHERE p.game_id = ? ORDER BY p.skill_key, p.parameter_key
        """;
}
