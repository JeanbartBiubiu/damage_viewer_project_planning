package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.service.skillformula.SkillFormulaParser;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillEffectElapsedSemanticsTest {
    private static Aggregate formula() {
        return new Aggregate(SourceType.FORMULA, "sample", "decay", AggregateJson.tree("""
            {"expression":{"inputs":[{"key":"elapsed","binding":{"kind":"context","contextKey":"effect_elapsed_ms"}}],
             "stages":[{"key":"out","name":"时间衰减","expression":{"op":"read","inputKey":"elapsed"}}],"outputStageKey":"out"}}
            """));
    }
    private static Aggregate effect() {
        return new Aggregate(SourceType.EFFECT, "sample", "timed", AggregateJson.tree("""
            {"lifecycle":{"durationValue":{"kind":"FIXED","value":1500},
             "maxStacksValue":{"kind":"FIXED","value":1},"applicationStacksValue":{"kind":"FIXED","value":1},
             "reapplicationStackMode":"KEEP","reapplicationDurationMode":"REFRESH_ALL","expiryMode":"ALL_AT_ONCE"},
             "results":[{"resultKey":"speed","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE",
               "detail":{"operation":"INCREASE"},"valueRule":{"value":{"kind":"FORMULA","formulaKey":"decay"}},
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"MOMENT_EVALUATION","reapplicationValueMode":null}}]}
            """));
    }
    private static void validate(Aggregate effect) {
        SkillNumericSemantics.validate(List.of(formula(), effect), List.of());
    }
    @Test void fixedContextIsAcceptedWithoutFabricatingAttributeOrParameterReferences() {
        assertDoesNotThrow(() -> SkillFormulaParser.validate("sample", formula().data().path("expression"), List.of(), List.of()));
        assertTrue(SkillObjectReferences.extract("game", List.of(formula())).isEmpty());
        assertDoesNotThrow(() -> validate(effect()));
        ObjectNode expression = (ObjectNode) formula().data().path("expression");
        ((ObjectNode) expression.path("inputs").get(0).path("binding")).put("contextKey", "arbitrary_time");
        assertThrows(ApiException.class, () -> SkillFormulaParser.validate("sample", expression, List.of(), List.of()));
    }
    @Test void currentReadCannotEscapeIntoApplicationSnapshotDamageInitializationOrDuration() {
        for (String mutation : List.of("snapshot", "damage", "initial", "duration", "multilayer", "independent", "keep_value", "replace_snapshot", "no_duration")) {
            Aggregate base = effect();
            ObjectNode data = (ObjectNode) base.data();
            ObjectNode life = (ObjectNode) data.path("lifecycle");
            ObjectNode result = (ObjectNode) data.path("results").get(0);
            ObjectNode behavior = (ObjectNode) result.path("lifecycleBehavior");
            switch (mutation) {
                case "snapshot" -> behavior.put("valueReadMode", "APPLICATION_SNAPSHOT");
                case "damage" -> result.put("resultType", "DAMAGE");
                case "initial" -> behavior.put("moment", "APPLICATION");
                case "duration" -> life.set("durationValue", result.path("valueRule").path("value"));
                case "multilayer" -> ((ObjectNode) life.path("maxStacksValue")).put("value", 2);
                case "independent" -> life.put("reapplicationDurationMode", "INDEPENDENT");
                case "keep_value" -> behavior.put("reapplicationValueMode", "KEEP");
                case "replace_snapshot" -> behavior.put("reapplicationValueMode", "REPLACE");
                case "no_duration" -> life.remove("durationValue");
            }
            assertThrows(ApiException.class, () -> validate(base), mutation);
        }
        Aggregate state = new Aggregate(SourceType.STATE, "sample", "count", AggregateJson.tree("""
            {"stateType":"COUNTER","detail":{"initialValue":{"kind":"FORMULA","formulaKey":"decay"}}}
            """));
        assertThrows(ApiException.class, () -> validate(state));
    }
    @Test void changingAReferencedDefinitionRechecksTheFinalConsumer() {
        Aggregate original = effect();
        assertDoesNotThrow(() -> validate(original));
        ((ObjectNode) original.data().path("lifecycle")).put("expiryMode", "EXPLICIT_ONLY");
        assertThrows(ApiException.class, () -> validate(original));
    }

    private static Aggregate slowEffect() {
        Aggregate base = effect();
        ObjectNode data = (ObjectNode) base.data();
        ((ObjectNode) data.path("lifecycle")).put("instanceScope", "SOURCE_TARGET");
        ObjectNode result = (ObjectNode) data.path("results").get(0);
        result.put("resultType", "STATUS_OPERATION").put("target", "TARGET");
        result.set("detail", AggregateJson.tree("{\"statusKey\":\"slow\",\"operation\":\"APPLY\"}"));
        ((ObjectNode) result.path("lifecycleBehavior")).put("stackValueMode", "SHARED");
        ((ObjectNode) result.path("valueRule")).put("fixedMultiplier", 1).putNull("fixedMinValue").putNull("fixedMaxValue");
        return base;
    }

    @Test void finiteSingleSlowCanUseOwnElapsedAndStaticConstantsWithoutImplicitClamp() {
        assertDoesNotThrow(() -> validate(slowEffect()));
        for (double value : List.of(0.0, 0.6, 1.0)) {
            Aggregate slow = slowEffect();
            ((ObjectNode) slow.data().path("results").get(0).path("valueRule"))
                .set("value", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":" + value + "}"));
            assertDoesNotThrow(() -> validate(slow));
        }
        for (String mutation : List.of("snapshot", "clamp", "multiple_results", "scope", "merge", "stacks", "duration", "periodic", "shield", "static_range", "multiplier")) {
            Aggregate slow = slowEffect(); ObjectNode data = (ObjectNode) slow.data();
            ObjectNode life = (ObjectNode) data.path("lifecycle");
            ObjectNode result = (ObjectNode) data.path("results").get(0);
            ObjectNode rule = (ObjectNode) result.path("valueRule");
            switch (mutation) {
                case "snapshot" -> ((ObjectNode) result.path("lifecycleBehavior")).put("valueReadMode", "APPLICATION_SNAPSHOT");
                case "clamp" -> rule.put("fixedMinValue", 0).put("fixedMaxValue", 1);
                case "multiple_results" -> ((com.fasterxml.jackson.databind.node.ArrayNode) data.path("results")).add(result.deepCopy().put("resultKey", "other"));
                case "scope" -> life.put("instanceScope", "TARGET");
                case "merge" -> ((ObjectNode) result.path("lifecycleBehavior")).put("reapplicationValueMode", "REPLACE");
                case "stacks" -> ((ObjectNode) life.path("maxStacksValue")).put("value", 2);
                case "duration" -> ((ObjectNode) life.path("durationValue")).put("value", 0);
                case "periodic" -> life.set("periodicIntervalValue", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":100}"));
                case "shield" -> result.put("spellShieldBlockScope", "RESULT");
                case "static_range" -> rule.set("value", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":1.1}"));
                case "multiplier" -> { rule.put("fixedMultiplier", 2); rule.set("value", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":0.6}")); }
            }
            assertThrows(ApiException.class, () -> validate(slow), mutation);
        }
    }

    @Test void currentSlowCannotBorrowAttributeEvenThroughAnUnchosenStageBranch() {
        Aggregate formula = formula();
        ObjectNode expression = (ObjectNode) formula.data().path("expression");
        ((com.fasterxml.jackson.databind.node.ArrayNode) expression.path("inputs")).add(AggregateJson.tree("""
            {"key":"attribute","binding":{"kind":"attribute","attributeKey":"hp","object":"source","valueKind":"TOTAL","view":"current_frame"}}
            """));
        ((ObjectNode) expression.path("stages").get(0)).set("expression", AggregateJson.tree("""
            {"op":"if","args":[{"op":"const","value":"1"},{"op":"const","value":"0.6"},{"op":"read","inputKey":"attribute"}]}
            """));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(formula, slowEffect()), List.of()));
    }

    @Test void currentSlowDoesNotHideNonFiniteStaticInputOrMultiplierBehindZero() {
        for (boolean rawOverflow : List.of(false, true)) {
            Aggregate slow = slowEffect();
            ObjectNode rule = (ObjectNode) slow.data().path("results").get(0).path("valueRule");
            ObjectNode value = (ObjectNode) AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":0}");
            if (rawOverflow) { value.put("value", new java.math.BigDecimal("1e1000")); rule.put("fixedMultiplier", 0); }
            else rule.put("fixedMultiplier", new java.math.BigDecimal("1e1000"));
            rule.set("value", value);
            assertThrows(ApiException.class, () -> validate(slow));
        }
        Aggregate slow = slowEffect();
        ObjectNode rule = (ObjectNode) slow.data().path("results").get(0).path("valueRule");
        rule.put("fixedMultiplier", 0).set("value", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"huge\"}"));
        var parameter = new SkillNumericSemantics.Parameter("sample", "huge", "DECIMAL", "FIXED", new java.math.BigDecimal("1e1000"), null);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(slow), List.of(parameter)));
    }
}
