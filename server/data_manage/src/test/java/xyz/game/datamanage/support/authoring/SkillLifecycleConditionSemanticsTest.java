package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class SkillLifecycleConditionSemanticsTest {
    private static final String PATH = "conditionGroups[0].conditions[0].detail";

    @Test
    void finalScopeAndEventChangesCannotInvalidateAnExistingSubject() {
        Aggregate rule = rule("PRESENT", "CURRENT_TARGET", "null", "BASIC_ATTACK_HIT");
        assertDoesNotThrow(() -> SkillLifecycleConditionSemantics.validate(List.of(effect("SOURCE_TARGET"), rule)));
        ApiException scopeChanged = assertThrows(ApiException.class,
            () -> SkillLifecycleConditionSemantics.validate(List.of(effect("SKILL"), rule)));
        assertTrue(scopeChanged.getDetails().toString().contains(PATH + ".subject"));
        assertTrue(scopeChanged.getDetails().toString().contains("FORBIDDEN"));
        assertDoesNotThrow(() -> SkillLifecycleConditionSemantics.validate(List.of(effect("TARGET"),
            rule("ABSENT", "EVENT_SOURCE", "null", "CONTROL_RECEIVED"))));
        ApiException eventChanged = assertThrows(ApiException.class, () -> SkillLifecycleConditionSemantics.validate(List.of(effect("TARGET"),
            rule("ABSENT", "EVENT_SOURCE", "null", "BASIC_ATTACK_HIT"))));
        assertTrue(eventChanged.getDetails().toString().contains("EVENT_SOURCE_NOT_AVAILABLE"));
    }

    @Test
    void referencesTrackTheLifecycleAndParameterAndRejectRemovalOrAnotherSkillsMatchingKey() {
        Aggregate rule = rule("STACKS_COMPARE", "CURRENT_TARGET", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"stacks\"}", "BASIC_ATTACK_HIT");
        Set<Target> catalog = Set.of(new Target(TargetType.PARAMETER, "skill", "stacks", ""));
        List<Reference> refs = SkillObjectReferences.extractAndValidate("lol", List.of(effect("TARGET"), rule), catalog);
        assertEquals(2, refs.size());
        assertTrue(refs.stream().anyMatch(ref -> ref.target().equals(new Target(TargetType.LIFECYCLE, "skill", "mark", ""))
            && ref.fieldPath().equals(PATH + ".effectKey")));
        assertTrue(refs.stream().anyMatch(ref -> ref.target().type() == TargetType.PARAMETER && ref.fieldPath().equals(PATH + ".comparisonValue.parameterKey")));
        for (Aggregate absent : List.of(aggregate(SourceType.EFFECT, "mark", "{\"results\":[],\"lifecycle\":null}"),
                new Aggregate(SourceType.EFFECT, "other_skill", "mark", effect("TARGET").data()))) {
            ApiException removed = assertThrows(ApiException.class,
                () -> SkillObjectReferences.extractAndValidate("lol", List.of(absent, rule), catalog));
            assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", removed.getCode());
        }
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(rule), catalog));
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "0.5"})
    void stacksFixedValueMustBeANonNegativeInteger(String value) {
        ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(
            List.of(rule("STACKS_COMPARE", "CURRENT_TARGET", fixed(value), "BASIC_ATTACK_HIT")), List.of()));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        assertTrue(error.getDetails().toString().contains(PATH + ".comparisonValue"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(rule("STACKS_COMPARE", "CURRENT_TARGET", fixed("0"), "BASIC_ATTACK_HIT")), List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"FIXED", "SKILL_LEVEL", "CHARACTER_LEVEL"})
    void parameterChangesRecheckEveryStaticValue(String mode) {
        List<Aggregate> rules = List.of(rule("STACKS_COMPARE", "CURRENT_TARGET", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"stacks\"}", "BASIC_ATTACK_HIT"));
        Parameter valid = new Parameter("skill", "stacks", "INTEGER", mode, BigDecimal.ONE, AggregateJson.tree("{\"1\":0,\"2\":1}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(rules, List.of(valid)));
        Parameter invalid = new Parameter("skill", "stacks", "INTEGER", mode, BigDecimal.valueOf(-1), AggregateJson.tree("{\"1\":0,\"2\":-1}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(rules, List.of(invalid)));
        Parameter decimalType = new Parameter("skill", "stacks", "DECIMAL", mode, BigDecimal.ONE, AggregateJson.tree("{\"1\":1}"));
        ApiException changedType = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(rules, List.of(decimalType)));
        assertTrue(changedType.getDetails().toString().contains("VALUE_TYPE_MISMATCH"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"PARAMETER", "FORMULA"})
    void directOrFormulaRuntimeDependenciesAreForbidden(String kind) {
        String value = "PARAMETER".equals(kind) ? "{\"kind\":\"PARAMETER\",\"parameterKey\":\"stacks\"}"
            : "{\"kind\":\"FORMULA\",\"formulaKey\":\"stack_formula\"}";
        Aggregate formula = aggregate(SourceType.FORMULA, "stack_formula", "{\"expression\":{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"stacks\"}}");
        List<Aggregate> objects = List.of(rule("STACKS_COMPARE", "CURRENT_TARGET", value, "BASIC_ATTACK_HIT"), formula);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects,
            List.of(new Parameter("skill", "stacks", "INTEGER", "FIXED", BigDecimal.ONE, null))));
        ApiException changedMode = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects,
            List.of(new Parameter("skill", "stacks", "INTEGER", "RUNTIME_INPUT", null, null))));
        assertTrue(changedMode.getDetails().toString().contains("RUNTIME_INPUT_FORBIDDEN"));
    }

    @Test
    void readingALifecycleDoesNotCollectItsExecutionInputs() {
        Aggregate mark = aggregate(SourceType.EFFECT, "mark", """
            {"results":[],"lifecycle":{"instanceScope":"SOURCE_TARGET",
             "maxStacksValue":{"kind":"PARAMETER","parameterKey":"execution_only"}}}
            """);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(mark, rule("PRESENT", "CURRENT_TARGET", "null", "BASIC_ATTACK_HIT")),
            List.of(new Parameter("skill", "execution_only", "INTEGER", "RUNTIME_INPUT", null, null))));
    }

    private static Aggregate effect(String scope) {
        return aggregate(SourceType.EFFECT, "mark", "{\"results\":[],\"lifecycle\":{\"instanceScope\":\"" + scope + "\"}}");
    }

    private static Aggregate rule(String kind, String subject, String value, String event) {
        return aggregate(SourceType.TRIGGER, "rule", "{\"eventSource\":{\"eventType\":\"" + event + "\",\"detail\":{}},"
            + "\"conditionGroups\":[{\"conditions\":[{\"conditionType\":\"LIFECYCLE_CHECK\",\"detail\":{\"effectKey\":\"mark\","
            + "\"subject\":\"" + subject + "\",\"checkKind\":\"" + kind + "\",\"comparator\":"
            + ("STACKS_COMPARE".equals(kind) ? "\"GTE\"" : "null") + ",\"comparisonValue\":" + value + "}}]}],\"actions\":[]}");
    }

    private static Aggregate aggregate(SourceType type, String key, String json) {
        return new Aggregate(type, "skill", key, AggregateJson.tree(json));
    }

    private static String fixed(String value) { return "{\"kind\":\"FIXED\",\"value\":" + value + "}"; }
}
