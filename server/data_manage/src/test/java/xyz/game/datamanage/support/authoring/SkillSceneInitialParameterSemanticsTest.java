package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillSceneInitialParameterSemanticsTest {
    static final String SKILL = "initial_defense";
    static final String DETAIL = "{\"minValue\":0,\"maxValue\":150}";
    static final SkillNumericSemantics.Parameter INPUT = new SkillNumericSemantics.Parameter(SKILL, "initial_count",
        "INTEGER", "RUNTIME_INPUT", null, null);

    @Test void explicitZeroBoundaryAndNegativeGeneralRangesHaveNoDefaultValue() {
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects(DETAIL), List.of(INPUT)));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects("{\"minValue\":-5,\"maxValue\":5}"), List.of(INPUT)));
        var binding = AggregateJson.read("{\"bindingKey\":\"initial\",\"parameterKey\":\"initial_count\","
            + "\"sourceType\":\"SCENE_INITIAL_PARAMETER\",\"detail\":" + DETAIL + "}", SkillTriggerRuntimeInputBinding.class);
        assertFalse(AggregateJson.tree(AggregateJson.write(binding)).path("detail").has("value"));
    }

    @ParameterizedTest @ValueSource(strings = {"{}", "{\"minValue\":null,\"maxValue\":150}",
        "{\"minValue\":0,\"maxValue\":null}", "{\"minValue\":2,\"maxValue\":1}",
        "{\"minValue\":0.5,\"maxValue\":150}", "{\"minValue\":0,\"maxValue\":9007199254740992}",
        "{\"minValue\":0,\"maxValue\":1e309}", "{\"minValue\":0,\"maxValue\":150,\"value\":null}"})
    void badBoundsAndAnyDefaultAreRejected(String detail) {
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects(detail), List.of(INPUT)));
    }

    @ParameterizedTest @ValueSource(strings = {"EVENT", "TARGET", "ACTION", "UNUSED", "PARAMETER_FIXED", "LIFECYCLE", "CONDITION"})
    void finalChangesCannotReuseInitializationAuthorization(String change) {
        var aggregates = objects(DETAIL);
        ObjectNode effect = (ObjectNode) aggregates.getFirst().data();
        ObjectNode rule = (ObjectNode) aggregates.get(1).data();
        ObjectNode action = (ObjectNode) rule.path("actions").get(0);
        var input = INPUT;
        switch (change) {
            case "EVENT" -> ((ObjectNode) rule.path("eventSource")).put("eventType", "BASIC_ATTACK_HIT");
            case "TARGET" -> action.put("targetContext", "CURRENT_TARGET");
            case "ACTION" -> action.put("actionType", "START_PROCESS");
            case "UNUSED" -> ((ObjectNode) effect.path("results").get(0).path("valueRule"))
                .set("value", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":1}"));
            case "PARAMETER_FIXED" -> input = new SkillNumericSemantics.Parameter(SKILL, "initial_count", "INTEGER", "FIXED", java.math.BigDecimal.ZERO, null);
            case "LIFECYCLE" -> effect.set("lifecycle", AggregateJson.tree("{\"durationValue\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"initial_count\"}}"));
            case "CONDITION" -> rule.set("conditionGroups", AggregateJson.tree("[{\"conditions\":[{\"conditionType\":\"ATTRIBUTE_COMPARE\",\"detail\":{\"comparisonValue\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"initial_count\"}}}]}]"));
        }
        var finalInput = input;
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(aggregates, List.of(finalInput)));
    }

    static List<Aggregate> objects(String detail) {
        return List.of(new Aggregate(SourceType.EFFECT, SKILL, "permanent", AggregateJson.tree("""
            {"lifecycle":null,"results":[{"resultKey":"flat","resultType":"ATTRIBUTE_CHANGE",
             "valueRule":{"value":{"kind":"PARAMETER","parameterKey":"initial_count"},"fixedMultiplier":0.2,
             "fixedMinValue":null,"fixedMaxValue":null},"lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT"}}]}
            """)), new Aggregate(SourceType.TRIGGER, SKILL, "initial", AggregateJson.tree("""
            {"eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],
             "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE",
             "detail":{"effectKey":"permanent"},"runtimeInputBindings":[{"bindingKey":"initial","parameterKey":"initial_count",
             "sourceType":"SCENE_INITIAL_PARAMETER","detail":%s}],"resultModifiers":[]}]}
            """.formatted(detail))));
    }
}
