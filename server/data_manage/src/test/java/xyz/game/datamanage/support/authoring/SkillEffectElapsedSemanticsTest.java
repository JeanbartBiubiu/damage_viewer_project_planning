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
}
