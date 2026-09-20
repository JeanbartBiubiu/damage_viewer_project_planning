package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillNumericSemanticsTest {
    private static final String SKILL = "skill";

    @Test
    void fixedZeroAndFractionalTimesAreValidInTheirOwnPositions() {
        List<Aggregate> objects = List.of(
            effect("{\"kind\":\"FIXED\",\"value\":0}"),
            object(SourceType.EFFECT, "timed", "{\"results\":[],\"lifecycle\":{\"durationValue\":" + fixed("0.25") + "}}"),
            process("DELAY", "{\"delayValue\":" + fixed("0") + "}", "\"cooldown\":{\"durationValue\":" + fixed("0.125") + "}"),
            state("COUNTER", "{\"initialValue\":" + fixed("0") + ",\"maxValue\":" + fixed("0") + "}"),
            object(SourceType.STATE, "internal_cd", "{\"stateType\":\"INTERNAL_COOLDOWN\",\"detail\":{\"durationValue\":" + fixed("0.5") + "}}")
        );
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects, List.of()));
    }

    @ParameterizedTest
    @MethodSource("invalidStaticBounds")
    void staticValuesRespectPositionBounds(Aggregate object, String path, String code) {
        assertIssue(code, path, List.of(object), List.of());
    }

    static Stream<Arguments> invalidStaticBounds() {
        return Stream.of(
            Arguments.of(process("PERIODIC", "{\"repeatCountValue\":" + fixed("1") + ",\"intervalValue\":" + fixed("0") + "}"),
                "steps[0].detail.intervalValue", "VALUE_RANGE_INVALID"),
            Arguments.of(state("AMMO", "{\"initialValue\":" + fixed("0") + ",\"maxValue\":" + fixed("0") + "}"),
                "detail.maxValue", "VALUE_RANGE_INVALID"),
            Arguments.of(state("AMMO", "{\"maxValue\":" + fixed("1") + ",\"recoveryIntervalValue\":" + fixed("0") + "}"),
                "detail.recoveryIntervalValue", "VALUE_RANGE_INVALID"),
            Arguments.of(process("DELAY", "{\"delayValue\":" + fixed("-0.25") + "}"),
                "steps[0].detail.delayValue", "VALUE_RANGE_INVALID"),
            Arguments.of(process("MULTI_HIT", "{\"repeatCountValue\":" + fixed("1.5") + ",\"intervalValue\":" + fixed("1") + "}"),
                "steps[0].detail.repeatCountValue", "VALUE_TYPE_MISMATCH")
        );
    }

    @Test
    void perTargetProtectionCooldownMustBePositiveButMayBeFractional() {
        assertIssue("VALUE_RANGE_INVALID", "perTargetCooldown.durationValue",
            List.of(protectionCooldown(fixed("0"))), List.of());
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(protectionCooldown(fixed("0.125"))), List.of()));
    }

    @Test
    void perTargetProtectionCooldownRejectsFixedParameterChangedToZero() {
        List<Aggregate> objects = List.of(protectionCooldown(parameterValue("cooldown")));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects,
            List.of(fixedParameter("cooldown", "DECIMAL", "100"))));
        assertIssue("VALUE_RANGE_INVALID", "perTargetCooldown.durationValue", objects,
            List.of(fixedParameter("cooldown", "DECIMAL", "0")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_LEVEL", "CHARACTER_LEVEL"})
    void perTargetProtectionCooldownRequiresEveryStaticParameterLevelToBePositive(String mode) {
        List<Aggregate> objects = List.of(protectionCooldown(parameterValue("cooldown")));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects,
            List.of(level("cooldown", "DECIMAL", mode, "{\"1\":0.125,\"2\":1}"))));
        assertIssue("VALUE_RANGE_INVALID", "perTargetCooldown.durationValue", objects,
            List.of(level("cooldown", "DECIMAL", mode, "{\"1\":0.125,\"2\":0}")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_LEVEL", "CHARACTER_LEVEL"})
    void validatesEveryLevelIncludingZeroInsertedWhenTheLevelRangeGrows(String mode) {
        Aggregate process = countProcess(parameterValue("count"));
        List<Parameter> valid = List.of(level("count", "INTEGER", mode, "{\"1\":1,\"2\":2}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(process), valid));
        assertIssue("VALUE_RANGE_INVALID", "steps[0].detail.repeatCountValue", List.of(process),
            List.of(level("count", "INTEGER", mode, "{\"1\":1,\"2\":0}")));
        assertIssue("VALUE_RANGE_INVALID", "steps[0].detail.repeatCountValue", List.of(process),
            List.of(level("count", "INTEGER", mode, "{\"1\":1,\"2\":2,\"3\":0}")));
    }

    @Test
    void decimalParameterDeclarationCannotBeUsedForAnIntegerCountEvenWhenItsValueIsWhole() {
        assertIssue("VALUE_TYPE_MISMATCH", "steps[0].detail.repeatCountValue",
            List.of(countProcess(parameterValue("count"))), List.of(fixedParameter("count", "DECIMAL", "3")));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("chargeRanges")
    void chargeComparesMatchingLevelsAndAllPossibleCrossDimensionOrFixedPairs(
        String scenario, String minValue, String maxValue, List<Parameter> parameters, boolean valid
    ) {
        Aggregate process = process("CHARGE", "{\"minimumChargeValue\":" + minValue + ",\"maximumChargeValue\":" + maxValue + "}");
        if (valid) assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(process), parameters), scenario);
        else assertIssue("CHARGE_RANGE_INVALID", "steps[0].detail.maximumChargeValue", List.of(process), parameters);
    }

    static Stream<Arguments> chargeRanges() {
        Parameter min = level("min", "DECIMAL", "SKILL_LEVEL", "{\"1\":1,\"2\":3}");
        return Stream.of(
            Arguments.of("同技能等级按对应等级比较", parameterValue("min"), parameterValue("max"),
                List.of(min, level("max", "DECIMAL", "SKILL_LEVEL", "{\"1\":2,\"2\":4}")), true),
            Arguments.of("同等级第二项上限过小", parameterValue("min"), parameterValue("max"),
                List.of(min, level("max", "DECIMAL", "SKILL_LEVEL", "{\"1\":2,\"2\":2}")), false),
            Arguments.of("角色等级与技能等级可独立组合", parameterValue("min"), parameterValue("max"),
                List.of(min, level("max", "DECIMAL", "CHARACTER_LEVEL", "{\"1\":2,\"2\":4}")), false),
            Arguments.of("跨等级维度全部组合有效", parameterValue("min"), parameterValue("max"),
                List.of(min, level("max", "DECIMAL", "CHARACTER_LEVEL", "{\"1\":3,\"2\":4}")), true),
            Arguments.of("固定上限检查全部等级", parameterValue("min"), fixed("2"), List.of(min), false),
            Arguments.of("固定上限等于最高下限", parameterValue("min"), fixed("3"), List.of(min), true),
            Arguments.of("固定下限检查全部等级", fixed("3"), parameterValue("max"),
                List.of(level("max", "DECIMAL", "CHARACTER_LEVEL", "{\"1\":2,\"2\":4}")), false),
            Arguments.of("固定参数也对全部等级生效", parameterValue("min"), parameterValue("max"),
                List.of(min, fixedParameter("max", "DECIMAL", "2")), false)
        );
    }

    @Test
    void namedFormulaIsNotEvaluatedButItsRuntimeParameterStillRequiresAnActionBinding() {
        Aggregate formula = formula("input");
        Aggregate process = countProcess(formulaValue());
        List<Aggregate> withoutBinding = List.of(formula, process, rule("START_PROCESS", "process", false, "RAW_DAMAGE"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(withoutBinding,
            List.of(fixedParameter("input", "DECIMAL", "-0.25"))));
        assertIssue("BINDING_MISSING", "actions[0].runtimeInputBindings", withoutBinding,
            List.of(runtime("input", "DECIMAL")));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(formula, process, rule("START_PROCESS", "process", true, "RAW_DAMAGE")),
            List.of(runtime("input", "DECIMAL"))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"PARAMETER", "FORMULA"})
    void directAndFormulaDependenciesBothNeedBindings(String source) {
        Aggregate effect = effect("PARAMETER".equals(source) ? parameterValue("input") : formulaValue());
        List<Parameter> parameters = List.of(runtime("input", "DECIMAL"));
        assertIssue("BINDING_MISSING", "actions[0].runtimeInputBindings",
            List.of(formula("input"), effect, rule("EXECUTE_EFFECT", "effect", false, "RAW_DAMAGE")), parameters);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(formula("input"), effect, rule("EXECUTE_EFFECT", "effect", true, "RAW_DAMAGE")), parameters));
    }

    @Test
    void changingParameterModeOrTypeRechecksExistingBindings() {
        Aggregate effect = effect(parameterValue("input"));
        List<Aggregate> unbound = List.of(effect, rule("EXECUTE_EFFECT", "effect", false, "RAW_DAMAGE"));
        List<Aggregate> bound = List.of(effect, rule("EXECUTE_EFFECT", "effect", true, "RAW_DAMAGE"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(unbound, List.of(fixedParameter("input", "DECIMAL", "1"))));
        assertIssue("BINDING_MISSING", "actions[0].runtimeInputBindings", unbound, List.of(runtime("input", "DECIMAL")));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(bound, List.of(runtime("input", "DECIMAL"))));
        assertIssue("BINDING_EXTRA", "actions[0].runtimeInputBindings[0]", bound, List.of(fixedParameter("input", "DECIMAL", "1")));
        assertIssue("REFERENCE_TYPE_MISMATCH", "actions[0].runtimeInputBindings[0]", bound, List.of(runtime("input", "INTEGER")));
    }

    @Test
    void changingFormulaExpressionCannotIntroduceAnUnboundRuntimeParameter() {
        Aggregate effect = effect(formulaValue());
        Aggregate rule = rule("EXECUTE_EFFECT", "effect", false, "RAW_DAMAGE");
        List<Parameter> parameters = List.of(fixedParameter("static_input", "DECIMAL", "1"), runtime("input", "DECIMAL"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(formula("static_input"), effect, rule), parameters));
        assertIssue("BINDING_MISSING", "actions[0].runtimeInputBindings", List.of(formula("input"), effect, rule), parameters);
    }

    @ParameterizedTest
    @ValueSource(strings = {"durationValue", "maxStacksValue", "applicationStacksValue", "periodicIntervalValue"})
    void effectLifecycleDependenciesReachTheExecutingAction(String field) {
        Aggregate effect = object(SourceType.EFFECT, "effect", "{\"results\":[],\"lifecycle\":{\"" + field + "\":" + parameterValue("input") + "}}");
        List<Parameter> parameters = List.of(runtime("input", "INTEGER"));
        assertIssue("BINDING_MISSING", "actions[0].runtimeInputBindings",
            List.of(effect, rule("EXECUTE_EFFECT", "effect", false, "HIT_INDEX")), parameters);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(effect, rule("EXECUTE_EFFECT", "effect", true, "HIT_INDEX")), parameters));
    }

    @Test
    void processEffectBindingsCarryTheEffectsRuntimeInputs() {
        Aggregate effect = effect(parameterValue("input"));
        Aggregate process = object(SourceType.PROCESS, "process", "{\"steps\":[],\"effectBindings\":[{\"effectKey\":\"effect\"}],\"stateOperations\":[]}");
        List<Parameter> parameters = List.of(runtime("input", "DECIMAL"));
        assertIssue("BINDING_MISSING", "actions[0].runtimeInputBindings",
            List.of(effect, process, rule("START_PROCESS", "process", false, "RAW_DAMAGE")), parameters);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(effect, process, rule("START_PROCESS", "process", true, "RAW_DAMAGE")), parameters));
    }

    @ParameterizedTest(name = "{0} {1} {2}")
    @MethodSource("stateDependencies")
    void processStateUseIncludesInitializationResetAndInternalCooldownStart(
        String stateType, String operation, String field
    ) {
        String defaults = switch (stateType) {
            case "COUNTER" -> "{\"initialValue\":" + fixed("0") + ",\"maxValue\":" + fixed("1") + "}";
            case "AMMO" -> "{\"initialValue\":" + fixed("0") + ",\"maxValue\":" + fixed("1")
                + ",\"recoveryIntervalValue\":" + fixed("1") + "}";
            case "INTERNAL_COOLDOWN" -> "{\"durationValue\":" + fixed("1") + "}";
            default -> throw new IllegalArgumentException(stateType);
        };
        ObjectNode detail = (ObjectNode) AggregateJson.tree(defaults);
        detail.set(field, AggregateJson.tree(parameterValue("input")));
        Aggregate state = state(stateType, detail.toString());
        Aggregate process = object(SourceType.PROCESS, "process", "{\"steps\":[],\"effectBindings\":[],\"stateOperations\":[{"
            + "\"stateKey\":\"state\",\"operation\":\"" + operation + "\""
            + ("INCREASE".equals(operation) ? ",\"value\":" + fixed("1") : "") + "}]}");
        List<Parameter> parameters = List.of(runtime("input", "INTEGER"));
        assertIssue("BINDING_MISSING", "actions[0].runtimeInputBindings",
            List.of(state, process, rule("START_PROCESS", "process", false, "HIT_INDEX")), parameters);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(state, process, rule("START_PROCESS", "process", true, "HIT_INDEX")), parameters));
    }

    static Stream<Arguments> stateDependencies() {
        return Stream.of(
            Arguments.of("COUNTER", "INCREASE", "initialValue"),
            Arguments.of("COUNTER", "INCREASE", "maxValue"),
            Arguments.of("AMMO", "INCREASE", "initialValue"),
            Arguments.of("AMMO", "INCREASE", "maxValue"),
            Arguments.of("AMMO", "INCREASE", "recoveryIntervalValue"),
            Arguments.of("COUNTER", "RESET", "initialValue"),
            Arguments.of("AMMO", "RESET", "initialValue"),
            Arguments.of("INTERNAL_COOLDOWN", "START", "durationValue")
        );
    }

    @ParameterizedTest(name = "{0} {1}")
    @MethodSource("runtimeForbiddenPositions")
    void conditionsThresholdsLimitsAndCurrentMomentReadRejectRuntimeDependencies(
        String position, String source, Aggregate object, String field
    ) {
        assertIssue("RUNTIME_INPUT_FORBIDDEN", field,
            List.of(formula("input"), object), List.of(runtime("input", "INTEGER")));
    }

    static Stream<Arguments> runtimeForbiddenPositions() {
        return Stream.of("PARAMETER", "FORMULA").flatMap(source -> {
            String value = "PARAMETER".equals(source) ? parameterValue("input") : formulaValue();
            Stream.Builder<Arguments> cases = Stream.builder();
            cases.add(Arguments.of("生命阈值", source, object(SourceType.TRIGGER, "rule",
                "{\"eventSource\":{\"eventType\":\"HEALTH_THRESHOLD_CROSSED\",\"detail\":{\"thresholdValue\":" + value + "}}}"),
                "eventSource.detail.thresholdValue"));
            for (String type : List.of("ATTRIBUTE_COMPARE", "STATUS_CHECK", "INTERNAL_STATE_CHECK", "EVENT_VALUE_COMPARE")) {
                cases.add(Arguments.of(type, source, object(SourceType.TRIGGER, "rule",
                    "{\"conditionGroups\":[{\"conditions\":[{\"conditionType\":\"" + type + "\",\"detail\":{\"comparisonValue\":" + value + "}}]}]}"),
                    "conditionGroups[0].conditions[0].detail.comparisonValue"));
            }
            cases.add(Arguments.of("每目标冷却", source, object(SourceType.TRIGGER, "rule",
                "{\"limits\":{\"perTargetCooldown\":{\"durationValue\":" + value + "}}}"), "perTargetCooldown.durationValue"));
            cases.add(Arguments.of("过程触发上限", source, object(SourceType.TRIGGER, "rule",
                "{\"limits\":{\"maxTriggersPerProcess\":{\"limitValue\":" + value + "}}}"), "maxTriggersPerProcess.limitValue"));
            cases.add(Arguments.of("当前时点读取", source, object(SourceType.EFFECT, "effect",
                "{\"results\":[{\"resultKey\":\"damage\",\"resultType\":\"DAMAGE\",\"valueRule\":{\"value\":" + value + "},"
                    + "\"lifecycleBehavior\":{\"moment\":\"PERSISTENT\",\"valueReadMode\":\"MOMENT_EVALUATION\"}}]}"), "results[0].valueRule.value"));
            return cases.build();
        });
    }

    private static Aggregate object(SourceType type, String key, String json) {
        return new Aggregate(type, SKILL, key, AggregateJson.tree(json));
    }

    @Test
    void slowStrengthKeepsLevelParametersAndFormulaRuntimeInputProtection() {
        Aggregate slow = object(SourceType.EFFECT, "effect", """
            {"results":[{"resultKey":"strength","resultType":"STATUS_OPERATION",
              "detail":{"statusKey":"slow","operation":"APPLY"},
              "valueRule":{"value":{"kind":"PARAMETER","parameterKey":"percent"},"fixedMultiplier":0.01,"fixedMinValue":0,"fixedMaxValue":1},
              "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT"}}]}
            """);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(slow),
            List.of(level("percent", "DECIMAL", "SKILL_LEVEL", "{\"1\":45,\"2\":50,\"3\":55,\"4\":60,\"5\":65}"))));
        ((ObjectNode) slow.data().at("/results/0/valueRule")).set("value", AggregateJson.tree(formulaValue()));
        List<Parameter> inputs = List.of(runtime("input", "DECIMAL"));
        assertIssue("BINDING_MISSING", "actions[0].runtimeInputBindings",
            List.of(formula("input"), slow, rule("EXECUTE_EFFECT", "effect", false, "RAW_DAMAGE")), inputs);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(formula("input"), slow, rule("EXECUTE_EFFECT", "effect", true, "RAW_DAMAGE")), inputs));
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "0.7", "1"})
    void remainingCooldownRatioAcceptsInclusiveStaticBoundaries(String value) {
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(ratioEffect(fixed(value), "1", null, null)), List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"-0.01", "1.01"})
    void remainingCooldownRatioRejectsStaticValuesOutsideInclusiveBounds(String value) {
        assertIssue("VALUE_RANGE_INVALID", "results[0].valueRule.value",
            List.of(ratioEffect(fixed(value), "1", null, null)), List.of());
    }

    @Test
    void remainingCooldownRatioAppliesEffectMultiplierThenBounds() {
        assertIssue("VALUE_RANGE_INVALID", "results[0].valueRule.value",
            List.of(ratioEffect(fixed("0.7"), "2", null, null)), List.of());
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(ratioEffect(fixed("0.7"), "2", null, "1")), List.of()));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(ratioEffect(fixed("-0.1"), "1", "0", "1")), List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_LEVEL", "CHARACTER_LEVEL"})
    void remainingCooldownRatioChecksEveryStaticParameterLevel(String mode) {
        Aggregate effect = ratioEffect(parameterValue("ratio"), "1", null, null);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(effect),
            List.of(level("ratio", "DECIMAL", mode, "{\"1\":0,\"2\":0.7,\"3\":1}"))));
        assertIssue("VALUE_RANGE_INVALID", "results[0].valueRule.value", List.of(effect),
            List.of(level("ratio", "DECIMAL", mode, "{\"1\":0,\"2\":0.7,\"3\":1.01}")));
    }

    @Test
    void remainingCooldownRatioLeavesNamedFormulaAndRuntimeInputUnknown() {
        Aggregate effect = ratioEffect(formulaValue(), "2", null, null);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(formula("input"), effect), List.of(fixedParameter("input", "DECIMAL", "0.7"))));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(formula("input"), effect), List.of(runtime("input", "DECIMAL"))));
    }

    @Test
    void executeEffectResultModifierChecksEffectiveRatioAgainstTriggerRule() {
        Aggregate effect = ratioEffect(fixed("0.7"), "1", null, null);
        assertIssue("VALUE_RANGE_INVALID", "actions[0].resultModifiers[0]",
            List.of(effect, ratioModifierRule("2", null, null)), List.of());
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(effect, ratioModifierRule("2", null, "1")), List.of()));
    }

    @Test
    void existingCooldownOperationsKeepTheirOriginalNumericHandling() {
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(
            object(SourceType.EFFECT, "reduce", "{\"results\":[{\"resultType\":\"COOLDOWN_CHANGE\",\"detail\":{\"operation\":\"REDUCE\"},\"valueRule\":{\"value\":" + fixed("-5") + "}}]}"),
            object(SourceType.EFFECT, "increase", "{\"results\":[{\"resultType\":\"COOLDOWN_CHANGE\",\"detail\":{\"operation\":\"INCREASE\"},\"valueRule\":{\"value\":" + fixed("-5") + "}}]}"),
            object(SourceType.EFFECT, "reset", "{\"results\":[{\"resultType\":\"COOLDOWN_CHANGE\",\"detail\":{\"operation\":\"RESET\"}}]}")
        ), List.of()));
    }

    private static Aggregate protectionCooldown(String value) {
        return object(SourceType.TRIGGER, "rule", "{\"limits\":{\"perTargetCooldown\":{\"durationValue\":" + value + "}}}");
    }

    private static Aggregate ratioEffect(String value, String multiplier, String minimum, String maximum) {
        StringBuilder rule = new StringBuilder("{\"value\":").append(value)
            .append(",\"fixedMultiplier\":").append(multiplier);
        if (minimum != null) rule.append(",\"fixedMinValue\":").append(minimum);
        if (maximum != null) rule.append(",\"fixedMaxValue\":").append(maximum);
        rule.append("}");
        return object(SourceType.EFFECT, "effect", "{\"results\":[{\"resultKey\":\"cooldown\",\"resultType\":\"COOLDOWN_CHANGE\",\"detail\":{\"operation\":\"REDUCE_REMAINING_RATIO\"},\"valueRule\":" + rule + "}]}");
    }

    private static Aggregate ratioModifierRule(String multiplier, String minimum, String maximum) {
        StringBuilder modifier = new StringBuilder("{\"resultKey\":\"cooldown\"");
        if (multiplier != null) modifier.append(",\"fixedMultiplier\":").append(multiplier);
        if (minimum != null) modifier.append(",\"fixedMinValue\":").append(minimum);
        if (maximum != null) modifier.append(",\"fixedMaxValue\":").append(maximum);
        modifier.append("}");
        return object(SourceType.TRIGGER, "rule", "{\"actions\":[{\"actionType\":\"EXECUTE_EFFECT\",\"detail\":{\"effectKey\":\"effect\"},\"resultModifiers\":[" + modifier + "]}]}");
    }

    private static Aggregate effect(String value) {
        return object(SourceType.EFFECT, "effect", "{\"results\":[{\"resultKey\":\"damage\",\"resultType\":\"DAMAGE\",\"valueRule\":{\"value\":" + value + "}}]}");
    }

    private static Aggregate state(String type, String detail) {
        return object(SourceType.STATE, "state", "{\"stateType\":\"" + type + "\",\"detail\":" + detail + "}");
    }

    private static Aggregate process(String stepType, String detail) { return process(stepType, detail, "\"cooldown\":null"); }

    private static Aggregate process(String stepType, String detail, String extra) {
        return object(SourceType.PROCESS, "process", "{\"steps\":[{\"stepKey\":\"step\",\"stepType\":\"" + stepType + "\",\"detail\":" + detail
            + "}],\"effectBindings\":[],\"stateOperations\":[]," + extra + "}");
    }

    private static Aggregate countProcess(String value) {
        return process("MULTI_HIT", "{\"repeatCountValue\":" + value + ",\"intervalValue\":" + fixed("1") + "}");
    }

    private static Aggregate formula(String parameter) {
        return object(SourceType.FORMULA, "formula", "{\"expression\":{\"nodeType\":\"OPERATION\",\"operation\":\"ADD\",\"operands\":["
            + "{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"" + parameter + "\"},"
            + "{\"nodeType\":\"ATTRIBUTE\",\"attributeOwner\":\"SOURCE\",\"attributeKey\":\"hp\",\"attributeValueKind\":\"TOTAL\"}]}}");
    }

    private static Aggregate rule(String type, String target, boolean bind, String eventValue) {
        String targetField = "EXECUTE_EFFECT".equals(type) ? "effectKey" : "processKey";
        String eventType = "RAW_DAMAGE".equals(eventValue) ? "DAMAGE_DEALT" : "SKILL_HIT";
        String binding = "{\"parameterKey\":\"input\",\"sourceType\":\"EVENT_VALUE\",\"detail\":{\"eventValueKey\":\"" + eventValue + "\"}}";
        return object(SourceType.TRIGGER, "rule", "{\"eventSource\":{\"eventType\":\"" + eventType + "\",\"detail\":{}},\"conditionGroups\":[],\"actions\":[{"
            + "\"actionKey\":\"action\",\"actionType\":\"" + type + "\",\"detail\":{\"" + targetField + "\":\"" + target + "\"},"
            + "\"runtimeInputBindings\":[" + (bind ? binding : "") + "]}]}");
    }

    private static String fixed(String value) { return "{\"kind\":\"FIXED\",\"value\":" + value + "}"; }
    private static String parameterValue(String key) { return "{\"kind\":\"PARAMETER\",\"parameterKey\":\"" + key + "\"}"; }
    private static String formulaValue() { return "{\"kind\":\"FORMULA\",\"formulaKey\":\"formula\"}"; }
    private static Parameter runtime(String key, String type) { return new Parameter(SKILL, key, type, "RUNTIME_INPUT", null, null); }
    private static Parameter fixedParameter(String key, String type, String value) {
        return new Parameter(SKILL, key, type, "FIXED", new BigDecimal(value), null);
    }
    private static Parameter level(String key, String type, String mode, String values) {
        return new Parameter(SKILL, key, type, mode, null, AggregateJson.tree(values));
    }

    @SuppressWarnings("unchecked")
    private static void assertIssue(String code, String path, List<Aggregate> objects, List<Parameter> parameters) {
        ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, parameters));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        List<Map<String, String>> issues = (List<Map<String, String>>) error.getDetails().get("fieldIssues");
        assertEquals(1, issues.size());
        assertEquals(path, issues.getFirst().get("field"));
        assertEquals(code, issues.getFirst().get("code"));
        assertEquals(SKILL, issues.getFirst().get("sourceSkillKey"));
    }
}
