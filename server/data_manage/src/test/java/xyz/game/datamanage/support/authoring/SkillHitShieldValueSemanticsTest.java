package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillHitShieldValueSemanticsTest {
    @ParameterizedTest
    @ValueSource(strings = {"-0.5", "0", "1", "2.25"})
    void comparisonThresholdIsNotRestrictedToTheBooleanSourceRange(String threshold) {
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(condition("SKILL_HIT", threshold)), List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"BASIC_ATTACK_HIT", "DAMAGE_DEALT", "SPELL_SHIELD_BLOCKED"})
    void finalEventChangeInvalidatesBothConditionAndBinding(String event) {
        for (List<Aggregate> objects : List.of(List.of(condition(event, "0")), binding(event, "SKILL_HIT_SPELL_SHIELD_BLOCKED"))) {
            ApiException error = assertThrows(ApiException.class,
                () -> SkillNumericSemantics.validate(objects, List.of(parameter("INTEGER", "RUNTIME_INPUT"))));
            assertTrue(error.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"INTEGER", "DECIMAL"})
    void integerSourceSupportsBothExistingNumericDomains(String type) {
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(binding("SKILL_HIT", "SKILL_HIT_SPELL_SHIELD_BLOCKED"),
            List.of(parameter(type, "RUNTIME_INPUT"))));
    }

    @Test
    void parameterModeAndBindingSourceDomainChangesRecheckExistingInput() {
        ApiException mode = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(
            binding("SKILL_HIT", "SKILL_HIT_SPELL_SHIELD_BLOCKED"), List.of(parameter("INTEGER", "FIXED"))));
        assertTrue(mode.getDetails().toString().contains("BINDING_EXTRA"));
        ApiException domain = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(
            binding("DAMAGE_DEALT", "RAW_DAMAGE"), List.of(parameter("INTEGER", "RUNTIME_INPUT"))));
        assertTrue(domain.getDetails().toString().contains("REFERENCE_TYPE_MISMATCH"));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", domain.getCode());
    }

    static Aggregate condition(String event, String threshold) {
        return new Aggregate(SourceType.TRIGGER, "skill", "rule", AggregateJson.tree("""
            {"eventSource":{"eventType":"%s","detail":{}},"actions":[],"conditionGroups":[{"conditions":[{
             "conditionType":"EVENT_VALUE_COMPARE","detail":{"eventValueKey":"SKILL_HIT_SPELL_SHIELD_BLOCKED",
              "comparator":"EQ","comparisonValue":{"kind":"FIXED","value":%s}}}]}]}
            """.formatted(event, threshold)));
    }

    static List<Aggregate> binding(String event, String valueKey) {
        return List.of(new Aggregate(SourceType.EFFECT, "skill", "effect", AggregateJson.tree("""
                {"results":[{"resultKey":"heal","resultType":"DIRECT_HEAL","valueRule":{"value":{"kind":"PARAMETER","parameterKey":"flag"}}}]}
                """)), new Aggregate(SourceType.TRIGGER, "skill", "rule", AggregateJson.tree("""
                {"eventSource":{"eventType":"%s","detail":{}},"conditionGroups":[],"actions":[{
                 "actionKey":"act","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"effect"},"runtimeInputBindings":[{
                  "bindingKey":"flag","parameterKey":"flag","sourceType":"EVENT_VALUE","detail":{"eventValueKey":"%s"}}]}]}
                """.formatted(event, valueKey))));
    }

    private static Parameter parameter(String type, String mode) { return new Parameter("skill", "flag", type, mode, BigDecimal.ZERO, null); }
}
