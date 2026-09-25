package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class DamageModifierConditionNumericTest {
    private static final String FIXED = "{\"kind\":\"FIXED\",\"value\":0.4}";
    private static final String PARAMETER = "{\"kind\":\"PARAMETER\",\"parameterKey\":\"threshold\"}";
    private static final String FORMULA = "{\"kind\":\"FORMULA\",\"formulaKey\":\"threshold_formula\"}";
    private static final Map<String, String> MODES = Map.of("zone", "RATIO_ADD");
    private static final Map<String, String> DOMAINS = Map.of("zone", "DAMAGE");
    private static final Map<String, String> STAGES = Map.of("zone", "DAMAGE_PRE_DEFENSE");

    @Test
    void fixedAndAllStaticParameterLevelsAreAccepted() {
        assertDoesNotThrow(() -> validate(List.of(effect(FIXED)), List.of()));
        assertDoesNotThrow(() -> validate(List.of(effect(PARAMETER)), List.of(levels("0.4", "0.6"))));
        assertDoesNotThrow(() -> validate(List.of(effect(PARAMETER)), List.of(fixedParameter("1"))));
    }

    @Test
    void staticFormulaEvaluatesEverySkillAndCharacterLevelCombinationExactly() {
        Aggregate formula = formula("""
            {"nodeType":"OPERATION","operation":"DIVIDE","operands":[
              {"nodeType":"PARAMETER","parameterKey":"threshold"},
              {"nodeType":"PARAMETER","parameterKey":"denominator"}]}
            """);
        Parameter denominator = new Parameter("skill", "denominator", "DECIMAL", "CHARACTER_LEVEL", null,
            AggregateJson.tree("{\"1\":2,\"2\":4}"));
        assertDoesNotThrow(() -> validate(List.of(effect(FORMULA), formula),
            List.of(levels("0.4", "0.6"), denominator)));
        Parameter changed = new Parameter("skill", "denominator", "DECIMAL", "CHARACTER_LEVEL", null,
            AggregateJson.tree("{\"1\":2,\"2\":0}"));
        assertIssue("FORMULA_NOT_STATIC", List.of(effect(FORMULA), formula), List.of(levels("0.4", "0.6"), changed));
    }

    @Test
    void laterParameterOrFormulaChangesCannotInvalidateStoredThreshold() {
        Aggregate effect = effect(PARAMETER);
        assertDoesNotThrow(() -> validate(List.of(effect), List.of(levels("0.4", "0.6"))));
        assertIssue("VALUE_RANGE_INVALID", List.of(effect), List.of(levels("0.4", "1.1")));

        Aggregate staticFormula = formula("{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"threshold\"}");
        assertDoesNotThrow(() -> validate(List.of(effect(FORMULA), staticFormula), List.of(levels("0.4", "0.6"))));
        assertIssue("ATTRIBUTE_FORBIDDEN", List.of(effect(FORMULA), formula("""
            {"nodeType":"ATTRIBUTE","attributeOwner":"SOURCE","attributeKey":"hp","attributeValueKind":"TOTAL"}
            """)), List.of(levels("0.4", "0.6")));
    }

    @Test
    void dynamicDependenciesAndOutOfRangeValuesAreRejected() {
        assertIssue("VALUE_RANGE_INVALID", List.of(effect("{\"kind\":\"FIXED\",\"value\":-0.01}")), List.of());
        assertIssue("VALUE_RANGE_INVALID", List.of(effect("{\"kind\":\"FIXED\",\"value\":1.01}")), List.of());
        assertIssue("RUNTIME_INPUT_FORBIDDEN", List.of(effect(PARAMETER)), List.of(
            new Parameter("skill", "threshold", "DECIMAL", "RUNTIME_INPUT", null, null)));
        assertIssue("RUNTIME_INPUT_FORBIDDEN", List.of(effect(FORMULA),
            formula("{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"threshold\"}")), List.of(
                new Parameter("skill", "threshold", "DECIMAL", "RUNTIME_INPUT", null, null)));
    }

    @Test
    void conditionedScopeStageAndLifecycleAreRequiredOnlyWhenConditionExists() {
        assertIssue("CONDITION_TARGET_UNSUPPORTED", "results[0].target",
            List.of(effect(FIXED, "TARGET", "DEALT", true)), List.of(), STAGES);
        assertIssue("CONDITION_DIRECTION_UNSUPPORTED", "results[0].detail.direction",
            List.of(effect(FIXED, "SOURCE", "TAKEN", true)), List.of(), STAGES);
        assertIssue("CONDITION_LIFECYCLE_UNSUPPORTED", "results[0].lifecycleBehavior.moment",
            List.of(effect(FIXED, "SOURCE", "DEALT", false)), List.of(), STAGES);
        assertIssue("CONDITION_ZONE_UNSUPPORTED", "results[0].detail.modifierZoneKey",
            List.of(effect(FIXED)), List.of(), Map.of("zone", "DAMAGE_POST_DEFENSE"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(unconditional()), List.of()));
    }

    private static void validate(List<Aggregate> aggregates, List<Parameter> parameters) {
        SkillNumericSemantics.validate(aggregates, parameters, MODES, DOMAINS, STAGES);
    }

    private static void assertIssue(String code, List<Aggregate> aggregates, List<Parameter> parameters) {
        assertIssue(code, "results[0].detail.condition.comparisonValue", aggregates, parameters, STAGES);
    }

    @SuppressWarnings("unchecked")
    private static void assertIssue(String code, String path, List<Aggregate> aggregates,
                                    List<Parameter> parameters, Map<String, String> stages) {
        ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(
            aggregates, parameters, MODES, DOMAINS, stages));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        Map<String, String> issue = (Map<String, String>) ((List<?>) error.getDetails().get("fieldIssues")).getFirst();
        assertEquals(code, issue.get("code"));
        assertEquals(path, issue.get("field"));
    }

    private static Aggregate effect(String threshold) { return effect(threshold, "SOURCE", "DEALT", true); }

    private static Aggregate effect(String threshold, String target, String direction, boolean lifecycle) {
        return new Aggregate(SourceType.EFFECT, "skill", "modifier", AggregateJson.tree("""
            {"lifecycle":%s,"results":[{"resultKey":"mod","resultType":"DAMAGE_MODIFIER",
            "target":"%s","lifecycleBehavior":{"moment":"PERSISTENT"},
            "detail":{"modifierZoneKey":"zone","direction":"%s","condition":{
              "receiver":"ENEMY_CHAMPION","attributeKey":"hp","attributeValueKind":"CURRENT_RATIO",
              "comparator":"LT","comparisonValue":%s}}}]}
            """.formatted(lifecycle ? "{}" : "null", target, direction, threshold)));
    }

    private static Aggregate unconditional() {
        return new Aggregate(SourceType.EFFECT, "skill", "modifier", AggregateJson.tree("""
            {"lifecycle":null,"results":[{"resultKey":"mod","resultType":"DAMAGE_MODIFIER",
            "target":"TARGET","detail":{"modifierZoneKey":"zone","direction":"TAKEN"}}]}
            """));
    }

    private static Aggregate formula(String expression) {
        return new Aggregate(SourceType.FORMULA, "skill", "threshold_formula",
            AggregateJson.tree("{\"expression\":" + expression + "}"));
    }

    private static Parameter fixedParameter(String value) {
        return new Parameter("skill", "threshold", "DECIMAL", "FIXED", new BigDecimal(value), null);
    }

    private static Parameter levels(String first, String second) {
        return new Parameter("skill", "threshold", "DECIMAL", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":" + first + ",\"2\":" + second + "}"));
    }
}
