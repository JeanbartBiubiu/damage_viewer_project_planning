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
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class SourceCastResourceCostSemanticsTest {
    private static final String BINDING_PATH = "actions[0].runtimeInputBindings[0]";
    private static final Parameter INPUT = new Parameter("skill", "cost", "DECIMAL", "RUNTIME_INPUT", null, null);

    @Test
    void resourceAndEventSourceSkillHaveSeparateReferencesWithoutExecutionEdges() {
        List<Aggregate> objects = objects("SKILL_HIT", "source_skill", "{\"attributeKey\":\"mana\"}");
        var refs = SkillObjectReferences.extractAndValidate("lol", objects, Set.of(
            new Target(TargetType.ATTRIBUTE, "", "mana", ""), new Target(TargetType.SKILL, "", "source_skill", ""),
            new Target(TargetType.PARAMETER, "skill", "cost", "")));
        assertTrue(refs.stream().anyMatch(ref -> ref.target().equals(new Target(TargetType.ATTRIBUTE, "", "mana", ""))
            && ref.fieldPath().equals(BINDING_PATH + ".detail.attributeKey")));
        assertEquals(1, refs.stream().filter(ref -> ref.target().type() == TargetType.SKILL).count());
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects, List.of(INPUT)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"INTEGER", "FIXED"})
    void parameterTypeOrModeChangeInvalidatesExistingBinding(String change) {
        Parameter changed = new Parameter("skill", "cost", "INTEGER".equals(change) ? "INTEGER" : "DECIMAL",
            "FIXED".equals(change) ? "FIXED" : "RUNTIME_INPUT", BigDecimal.ZERO, null);
        ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(
            objects("SKILL_HIT", "source_skill", "{\"attributeKey\":\"mana\"}"), List.of(changed)));
        assertTrue(error.getDetails().toString().contains("INTEGER".equals(change) ? "REFERENCE_TYPE_MISMATCH" : "BINDING_EXTRA"));
    }

    @Test
    void formulaChangeCannotLeaveAnUnreachableBinding() {
        List<Aggregate> objects = objects("SKILL_HIT", "source_skill", "{\"attributeKey\":\"mana\"}");
        var formulaEffect = new Aggregate(SourceType.EFFECT, "skill", "refund", AggregateJson.tree(
            "{\"results\":[{\"resultKey\":\"heal\",\"resultType\":\"DIRECT_HEAL\",\"valueRule\":{\"value\":{\"kind\":\"FORMULA\",\"formulaKey\":\"refund_value\"}}}]}"));
        var formula = new Aggregate(SourceType.FORMULA, "skill", "refund_value", AggregateJson.tree(
            "{\"expression\":{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"cost\"}}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(formulaEffect, formula, objects.get(1)), List.of(INPUT)));
        var changed = new Aggregate(SourceType.FORMULA, "skill", "refund_value", AggregateJson.tree(
            "{\"expression\":{\"nodeType\":\"CONSTANT\",\"value\":0}}"));
        ApiException error = assertThrows(ApiException.class,
            () -> SkillNumericSemantics.validate(List.of(formulaEffect, changed, objects.get(1)), List.of(INPUT)));
        assertTrue(error.getDetails().toString().contains("BINDING_EXTRA"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"BASIC_ATTACK_HIT", "SKILL_USED", "MISSING_SOURCE"})
    void finalEventStateMustStillIdentifyTheHitAndOriginalSkill(String change) {
        ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(
            objects("MISSING_SOURCE".equals(change) ? "SKILL_HIT" : change, "MISSING_SOURCE".equals(change) ? "" : "source_skill",
                "{\"attributeKey\":\"mana\"}"), List.of(INPUT)));
        assertTrue(error.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"attributeKey\":null}", "{\"attributeKey\":\"mana\",\"sourceSkillKey\":\"source_skill\"}"})
    void finalBindingDetailCannotLoseItsAttributeOrStoreAnAlternateSource(String detail) {
        ApiException error = assertThrows(ApiException.class,
            () -> SkillNumericSemantics.validate(objects("SKILL_HIT", "source_skill", detail), List.of(INPUT)));
        assertTrue(error.getDetails().toString().contains("VALUE_SHAPE_INVALID"));
    }

    static List<Aggregate> objects(String eventType, String sourceSkill, String detail) {
        return List.of(
            new Aggregate(SourceType.EFFECT, "skill", "refund", AggregateJson.tree("""
                {"results":[{"resultKey":"heal","resultType":"DIRECT_HEAL","valueRule":{"value":{"kind":"PARAMETER","parameterKey":"cost"}}}]}
                """)),
            new Aggregate(SourceType.TRIGGER, "skill", "rule", AggregateJson.tree("""
                {"eventSource":{"eventType":"%s","detail":{"sourceSkillKey":"%s"}},"conditionGroups":[],
                 "actions":[{"actionKey":"refund","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"refund"},
                  "runtimeInputBindings":[{"bindingKey":"cost","parameterKey":"cost","sourceType":"SOURCE_CAST_RESOURCE_COST","detail":%s}]}]}
                """.formatted(eventType, sourceSkill, detail)))
        );
    }
}
