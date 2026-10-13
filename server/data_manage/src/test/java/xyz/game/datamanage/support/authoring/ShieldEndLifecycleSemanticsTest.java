package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class ShieldEndLifecycleSemanticsTest {
    @Test
    void sameParentSingleSharedShieldIsValid() {
        Aggregate effect = shield();
        assertDoesNotThrow(() -> ShieldEndLifecycleSemantics.validate(List.of(effect)));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(effect), List.of()));
    }

    @Test
    void rejectsDuplicateShieldAndIndependentRefreshAndDifferentPersistentTarget() {
        Aggregate duplicate = shield();
        ArrayNode results = (ArrayNode) duplicate.data().path("results");
        results.add(results.get(0).deepCopy());
        assertThrows(ApiException.class, () -> ShieldEndLifecycleSemantics.validate(List.of(duplicate)));
        Aggregate independent = shield();
        ((ObjectNode) independent.data().path("lifecycle")).put("reapplicationDurationMode", "INDEPENDENT");
        assertThrows(ApiException.class, () -> ShieldEndLifecycleSemantics.validate(List.of(independent)));
        Aggregate mismatch = shield();
        ObjectNode another = ((ObjectNode) mismatch.data().path("results").get(0)).deepCopy();
        another.put("resultKey", "another");
        another.put("target", "TARGET");
        ((ArrayNode) mismatch.data().path("results")).add(another);
        assertThrows(ApiException.class, () -> ShieldEndLifecycleSemantics.validate(List.of(mismatch)));
    }

    @Test
    void rejectsAnyNonOneLevelAndDynamicInputs() {
        for (Parameter parameter : List.of(
            new Parameter("skill", "stacks", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":1,\"2\":2}")),
            new Parameter("skill", "stacks", "INTEGER", "RUNTIME_INPUT", null, null))) {
            Aggregate effect = shield();
            ((ObjectNode) effect.data().path("lifecycle")).set("maxStacksValue",
                AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"stacks\"}"));
            assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(effect), List.of(parameter)));
        }
    }

    @Test
    void staticFormulaCanProveOneButDivisionByZeroCannot() {
        Aggregate effect = shield();
        ((ObjectNode) effect.data().path("lifecycle")).set("applicationStacksValue",
            AggregateJson.tree("{\"kind\":\"FORMULA\",\"formulaKey\":\"one\"}"));
        Aggregate formula = new Aggregate(SourceType.FORMULA, "skill", "one", AggregateJson.tree("""
            {"expression":{"inputs":[{"key":"input_0","binding":{"kind":"parameter","skillKey":"skill","parameterKey":"numerator"}},{"key":"input_1","binding":{"kind":"parameter","skillKey":"skill","parameterKey":"denominator"}}],"stages":[{"key":"output","name":"原技能公式输出","expression":{"op":"div","args":[{"op":"read","inputKey":"input_0"},{"op":"read","inputKey":"input_1"}]}}],"outputStageKey":"output"}}
            """));
        Parameter numerator = new Parameter("skill", "numerator", "INTEGER", "FIXED", BigDecimal.TEN, null);
        Parameter denominator = new Parameter("skill", "denominator", "INTEGER", "FIXED", BigDecimal.TEN, null);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(effect, formula), List.of(numerator, denominator)));
        ApiException failure = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(effect, formula),
            List.of(numerator, new Parameter("skill", "denominator", "INTEGER", "FIXED", BigDecimal.ZERO, null))));
        assertTrue(failure.getDetails().toString().contains("FORMULA_NOT_STATIC"));
    }

    @Test
    void capacityComparesCompatibleLevelsAndStaticFormulas() {
        Aggregate state = new Aggregate(SourceType.STATE, "skill", "ammo", AggregateJson.tree("""
            {"stateType":"AMMO","detail":{"initialValue":{"kind":"PARAMETER","parameterKey":"initial"},
             "maxValue":{"kind":"PARAMETER","parameterKey":"capacity"},"recoveryIntervalValue":{"kind":"FIXED","value":1000}}}
            """));
        Parameter initial = new Parameter("skill", "initial", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":1,\"2\":3}"));
        Parameter capacity = new Parameter("skill", "capacity", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":1,\"2\":3}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(state), List.of(initial, capacity)));
        ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(state), List.of(initial,
            new Parameter("skill", "capacity", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":1,\"2\":2}")))));
        assertTrue(error.getDetails().toString().contains("STATE_CAPACITY_EXCEEDED"));
    }

    private static Aggregate shield() {
        return new Aggregate(SourceType.EFFECT, "skill", "shield", AggregateJson.tree("""
            {"lifecycle":{"endWhenShieldEndsResultKey":"barrier","maxStacksValue":{"kind":"FIXED","value":1},
             "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE",
             "reapplicationStackMode":"KEEP","reapplicationDurationMode":"KEEP_REMAINING","expiryMode":"EXPLICIT_ONLY"},
             "results":[{"resultKey":"barrier","name":"护盾","sortOrder":0,"resultType":"NORMAL_SHIELD","target":"SOURCE","spellShieldBlockScope":null,
               "detail":{},"valueRule":{"value":{"kind":"FIXED","value":10}},
               "lifecycleBehavior":{"moment":"PERSISTENT","stackValueMode":"SHARED","valueReadMode":"APPLICATION_SNAPSHOT"}}]}
            """));
    }
}
