package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillChannelWindowSemanticsTest {
    @ParameterizedTest
    @CsvSource({"1,2,0,1", "20,4,2,13", "20,1,5,5", "9007199254740991,2,0,9007199254740991"})
    void acceptsCompleteWindowIncludingOneMillisecondTwoExecutions(String duration, String count, String first, String last) {
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(window(duration, count, first, last)), List.of()));
    }

    @ParameterizedTest
    @CsvSource({
        "0,2,0,1,durationValue", "1.5,2,0,1,durationValue", "9007199254740992,2,0,1,durationValue",
        "20,0,2,13,executionCountValue", "20,65,2,13,executionCountValue", "20,1.5,2,13,executionCountValue",
        "20,4,-1,13,firstExecutionOffsetValue", "20,4,2.5,13,firstExecutionOffsetValue",
        "20,4,14,13,lastExecutionOffsetValue", "20,4,2,4,lastExecutionOffsetValue",
        "20,1,2,13,lastExecutionOffsetValue", "20,4,2,21,lastExecutionOffsetValue",
        "20,4,21,22,firstExecutionOffsetValue", "20,4,2,9007199254740992,lastExecutionOffsetValue"
    })
    void rejectsInvalidStaticTimesCountsAndWindows(String duration, String count, String first, String last, String field) {
        ApiException error = assertThrows(ApiException.class,
            () -> SkillNumericSemantics.validate(List.of(window(duration, count, first, last)), List.of()));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        assertTrue(error.getDetails().toString().contains("steps[0].detail." + field));
    }

    @ParameterizedTest
    @ValueSource(strings = {"firstExecutionOffsetValue", "lastExecutionOffsetValue"})
    void windowRequiresBothNumericValuesIncludingExplicitNull(String field) {
        for (boolean explicitNull : List.of(false, true)) {
            Aggregate object = window("20", "4", "2", "13");
            var detail = (com.fasterxml.jackson.databind.node.ObjectNode) object.data().path("steps").get(0).path("detail");
            if (explicitNull) detail.putNull(field); else detail.remove(field);
            ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(object), List.of()));
            assertTrue(error.getDetails().toString().contains("REQUIRED"));
            assertTrue(error.getDetails().toString().contains(field));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"IMMEDIATE", "AFTER_INTERVAL"})
    void equalDivisionRejectsForeignEndpointsAndKeepsDurationAtLeastCount(String firstExecution) {
        for (String endpoint : List.of("firstExecutionOffsetValue", "lastExecutionOffsetValue")) {
            Aggregate object = window("20", "4", "2", "13");
            var detail = (com.fasterxml.jackson.databind.node.ObjectNode) object.data().path("steps").get(0).path("detail");
            detail.put("firstExecution", firstExecution);
            detail.remove("firstExecutionOffsetValue");
            detail.remove("lastExecutionOffsetValue");
            detail.putNull(endpoint);
            ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(object), List.of()));
            assertTrue(error.getDetails().toString().contains("FIELD_NOT_ALLOWED"));
        }
        Aggregate object = process("{\"firstExecution\":\"" + firstExecution + "\",\"durationValue\":" + fixed("1")
            + ",\"executionCountValue\":" + fixed("2") + "}");
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(object), List.of()));
    }

    @Test
    void comparesMatchingSkillLevelsAndStaticallyResolvableFormulaEndpoints() {
        Aggregate object = process("""
            {"firstExecution":"CUSTOM_WINDOW","durationValue":{"kind":"FIXED","value":200},
             "executionCountValue":{"kind":"FIXED","value":4},
             "firstExecutionOffsetValue":{"kind":"PARAMETER","parameterKey":"first"},
             "lastExecutionOffsetValue":{"kind":"FORMULA","formulaKey":"last_formula"}}
            """);
        Aggregate formula = new Aggregate(SourceType.FORMULA, "skill", "last_formula", AggregateJson.tree("""
            {"expression":{"nodeType":"PARAMETER","parameterKey":"last"}}
            """));
        Parameter first = new Parameter("skill", "first", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":2,\"2\":100}"));
        Parameter last = new Parameter("skill", "last", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":13,\"2\":103}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(object, formula), List.of(first, last)));
        Parameter invalid = new Parameter("skill", "last", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":13,\"2\":102}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(object, formula), List.of(first, invalid)));
        Parameter crossLevel = new Parameter("skill", "last", "INTEGER", "CHARACTER_LEVEL", null, last.levelValues());
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(object, formula), List.of(first, crossLevel)));
    }

    @Test
    void runtimeEndpointParticipatesInExistingStartProcessBindingProtection() {
        Aggregate object = process("""
            {"firstExecution":"CUSTOM_WINDOW","durationValue":{"kind":"FIXED","value":200},
             "executionCountValue":{"kind":"FIXED","value":4},"firstExecutionOffsetValue":{"kind":"FIXED","value":0},
             "lastExecutionOffsetValue":{"kind":"PARAMETER","parameterKey":"input"}}
            """);
        Aggregate rule = new Aggregate(SourceType.TRIGGER, "skill", "start", AggregateJson.tree("""
            {"eventSource":{"eventType":"SKILL_HIT","detail":{}},"conditionGroups":[],
             "actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"cast"},"runtimeInputBindings":[]}]}
            """));
        ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(object, rule),
            List.of(new Parameter("skill", "input", "INTEGER", "RUNTIME_INPUT", null, null))));
        assertTrue(error.getDetails().toString().contains("BINDING_MISSING"));
    }

    private static Aggregate window(String duration, String count, String first, String last) {
        return process("{\"firstExecution\":\"CUSTOM_WINDOW\",\"durationValue\":" + fixed(duration)
            + ",\"executionCountValue\":" + fixed(count) + ",\"firstExecutionOffsetValue\":" + fixed(first)
            + ",\"lastExecutionOffsetValue\":" + fixed(last) + "}");
    }

    private static Aggregate process(String detail) {
        return new Aggregate(SourceType.PROCESS, "skill", "cast", AggregateJson.tree(
            "{\"steps\":[{\"stepKey\":\"channel\",\"stepType\":\"CHANNEL\",\"detail\":" + detail
                + "}],\"cooldown\":null,\"effectBindings\":[],\"stateOperations\":[]}"));
    }

    private static String fixed(String number) {
        return "{\"kind\":\"FIXED\",\"value\":" + new BigDecimal(number).toPlainString() + "}";
    }
}
