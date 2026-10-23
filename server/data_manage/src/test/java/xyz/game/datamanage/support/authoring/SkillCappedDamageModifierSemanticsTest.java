package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillCappedDamageModifierSemanticsTest {
    private static final String EFFECT = """
        {"lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},
          "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE","reapplicationStackMode":"KEEP",
          "reapplicationDurationMode":null,"expiryMode":"EXPLICIT_ONLY","periodicIntervalValue":null,"firstPeriodicExecution":null},
         "results":[{"resultKey":"flat","resultType":"DAMAGE_MODIFIER","target":"SOURCE","spellShieldBlockScope":null,
          "valueRule":{"value":{"kind":"FIXED","value":13},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},
          "detail":{"modifierZoneKey":"flat_pre","direction":"TAKEN","operation":"DECREASE","damageTypeKey":"stored_single_type",
           "deliveryKind":"ANY","originKind":"ANY","criticalFilter":"ANY","condition":null,"maximumReductionRatioValue":{"kind":"FIXED","value":0.5}},
          "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"MOMENT_EVALUATION","stackValueMode":"SHARED",
           "reapplicationValueMode":null,"periodicExecutionMode":null}}]}
        """;
    private static final String INITIAL = """
        {"eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],"oncePerUse":null,
         "perTargetCooldown":null,"maxTriggersPerProcess":null,"actions":[{"actionKey":"init","actionType":"EXECUTE_EFFECT",
         "detail":{"effectKey":"defense"},"targetContext":"EVENT_SOURCE","runtimeInputBindings":[],"resultModifiers":[]}]}
        """;
    private static final String FORMULA = """
        {"expression":{"inputs":[
         {"key":"base","binding":{"kind":"parameter","skillKey":"skill","parameterKey":"base"}},
         {"key":"bonus","binding":{"kind":"attribute","object":"source","view":"current_frame","valueKind":"BONUS","attributeKey":"armor"}}],
         "stages":[{"key":"output","name":"点数","expression":{"op":"add","args":[{"op":"read","inputKey":"base"},{"op":"read","inputKey":"bonus"}]}}],"outputStageKey":"output"}}
        """;

    private static Aggregate object(SourceType type, String key, JsonNode data) { return new Aggregate(type, "skill", key, data); }
    private static List<Aggregate> graph(ObjectNode effect) { return List.of(object(SourceType.EFFECT, "defense", effect), object(SourceType.TRIGGER, "init", AggregateJson.tree(INITIAL))); }
    private static void validate(List<Aggregate> graph, List<Parameter> parameters) {
        List<Aggregate> catalog = new ArrayList<>(graph);
        catalog.add(new Aggregate(SourceType.DAMAGE_TYPE, "", "stored_single_type", AggregateJson.tree("""
            {"status":"ENABLED","formula":{"inputs":[{"key":"defense","binding":{"kind":"attribute","object":"target","view":"current_frame","valueKind":"TOTAL","attributeKey":"armor"}}],
             "stages":[{"key":"output","name":"结算","expression":{"op":"read","inputKey":"defense"}}],"outputStageKey":"output"}}
            """)));
        SkillNumericSemantics.validate(graph, catalog, parameters, Map.of("flat_pre", "FLAT_ADD"), Map.of("flat_pre", "DAMAGE"), Map.of("flat_pre", "DAMAGE_PRE_DEFENSE"), Set.of("armor", "health"));
    }
    private static ObjectNode effect() { return (ObjectNode) AggregateJson.tree(EFFECT); }
    private static ObjectNode detail(ObjectNode effect) { return (ObjectNode) effect.path("results").get(0).path("detail"); }

    @Test void fixedAndCompleteAllLevelCapAreAcceptedWithoutTypeNameInference() {
        assertDoesNotThrow(() -> validate(graph(effect()), List.of()));
        ObjectNode effect = effect(); detail(effect).set("maximumReductionRatioValue", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"cap\"}"));
        assertDoesNotThrow(() -> validate(graph(effect), List.of(new Parameter("skill", "cap", "DECIMAL", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":0,\"2\":0.5,\"3\":1}"), 3))));
        assertThrows(ApiException.class, () -> validate(graph(effect), List.of(new Parameter("skill", "cap", "DECIMAL", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":0.5,\"2\":0.5}"), 3))));
        assertThrows(ApiException.class, () -> validate(graph(effect), List.of(new Parameter("skill", "cap", "DECIMAL", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":0.5,\"2\":0.5,\"3\":1.1}"), 3))));
        assertThrows(ApiException.class, () -> validate(graph(effect), List.of(new Parameter("skill", "cap", "DECIMAL", "RUNTIME_INPUT", null, null, 3))));
    }

    @ParameterizedTest @ValueSource(strings = {"null", "{\"kind\":\"FIXED\",\"value\":-0.1}", "{\"kind\":\"FIXED\",\"value\":1.1}", "{\"kind\":\"FORMULA\",\"formulaKey\":\"hidden\"}"})
    void capCannotBeMissingDynamicOrOutsideUnitInterval(String cap) {
        ObjectNode effect = effect(); detail(effect).set("maximumReductionRatioValue", AggregateJson.tree(cap));
        assertThrows(ApiException.class, () -> validate(graph(effect), List.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"direction", "operation", "deliveryKind", "originKind", "criticalFilter", "damageTypeKey"})
    void newCapCannotBeCarriedByDifferentModifierShapes(String field) {
        ObjectNode effect = effect(); detail(effect).put(field, field.equals("damageTypeKey") ? "" : "OTHER");
        assertThrows(ApiException.class, () -> validate(graph(effect), List.of()));
    }

    @Test void realOwnBonusFormulaIsAcceptedButEveryHiddenBindingIsChecked() {
        ObjectNode effect = effect(); ((ObjectNode) effect.path("results").get(0).path("valueRule")).set("value", AggregateJson.tree("{\"kind\":\"FORMULA\",\"formulaKey\":\"points\"}"));
        List<Aggregate> graph = new ArrayList<>(graph(effect)); graph.add(object(SourceType.FORMULA, "points", AggregateJson.tree(FORMULA)));
        List<Parameter> parameters = List.of(new Parameter("skill", "base", "INTEGER", "FIXED", BigDecimal.valueOf(13), null, 5));
        assertDoesNotThrow(() -> validate(graph, parameters));
        for (String mutation : List.of("target", "TOTAL", "runtime", "foreign")) {
            ObjectNode formula = (ObjectNode) AggregateJson.tree(FORMULA);
            ObjectNode binding = (ObjectNode) formula.path("expression").path("inputs").get(mutation.equals("foreign") ? 0 : 1).path("binding");
            if (mutation.equals("target")) binding.put("object", "target");
            if (mutation.equals("TOTAL")) binding.put("valueKind", "TOTAL");
            if (mutation.equals("runtime")) { binding.removeAll(); binding.put("kind", "parameter").put("skillKey", "skill").put("parameterKey", "runtime"); }
            if (mutation.equals("foreign")) binding.put("skillKey", "foreign");
            graph.set(2, object(SourceType.FORMULA, "points", formula));
            assertThrows(ApiException.class, () -> validate(graph, parameters), mutation);
        }
    }

    @Test void initializerMustBeUniqueAndUnconditionalAndPointFloorExplicitZero() {
        ObjectNode effect = effect(); List<Aggregate> graph = new ArrayList<>(graph(effect)); graph.remove(1);
        assertThrows(ApiException.class, () -> validate(graph, List.of()));
        graph.add(object(SourceType.TRIGGER, "init", AggregateJson.tree(INITIAL)));
        graph.add(object(SourceType.TRIGGER, "extra", AggregateJson.tree(INITIAL)));
        assertThrows(ApiException.class, () -> validate(graph, List.of()));
        ((ObjectNode) effect.path("results").get(0).path("valueRule")).putNull("fixedMinValue");
        assertThrows(ApiException.class, () -> validate(graph(effect), List.of()));
    }
}
