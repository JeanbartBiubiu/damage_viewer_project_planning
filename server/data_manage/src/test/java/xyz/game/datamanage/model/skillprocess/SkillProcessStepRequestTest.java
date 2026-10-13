package xyz.game.datamanage.model.skillprocess;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.authoring.AggregateJson;

class SkillProcessStepRequestTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void channelWindowPreservesBothNativeNumericAuthorFields() throws Exception {
        String input = """
            {"stepKey":"channel","name":"指定窗口","stepType":"CHANNEL","sortOrder":0,"occupiesAction":true,
             "detail":{"firstExecution":"CUSTOM_WINDOW","durationValue":{"kind":"FIXED","value":20},
              "executionCountValue":{"kind":"FIXED","value":4},
              "firstExecutionOffsetValue":{"kind":"PARAMETER","parameterKey":"first"},
              "lastExecutionOffsetValue":{"kind":"FORMULA","formulaKey":"last"}}}
            """;
        SkillProcessStepRequest request = json.readValue(input, SkillProcessStepRequest.class);
        var detail = (SkillProcessChannelStepDetail) request.detail();
        assertEquals(SkillProcessFirstExecution.CUSTOM_WINDOW, detail.firstExecution());
        assertEquals("first", detail.firstExecutionOffsetValue().parameterKey());
        assertEquals("last", detail.lastExecutionOffsetValue().formulaKey());
        assertEquals(request, AggregateJson.read(AggregateJson.write(request), SkillProcessStepRequest.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"IMMEDIATE", "AFTER_INTERVAL"})
    void channelLegacyShapeOmitsNewEndpointsButCapturesExplicitNullAsForeign(String firstExecution) throws Exception {
        String input = "{\"durationValue\":{\"kind\":\"FIXED\",\"value\":20},\"executionCountValue\":{\"kind\":\"FIXED\",\"value\":4},"
            + "\"firstExecution\":\"" + firstExecution + "\"}";
        var detail = json.readValue(input, SkillProcessChannelStepDetail.class);
        assertEquals(false, json.readTree(AggregateJson.write(detail)).has("firstExecutionOffsetValue"));
        assertEquals(false, json.readTree(AggregateJson.write(detail)).has("lastExecutionOffsetValue"));
        var foreign = json.readValue(input.substring(0, input.length() - 1)
            + ",\"firstExecutionOffsetValue\":null}", SkillProcessChannelStepDetail.class);
        assertEquals(java.util.Set.of("firstExecutionOffsetValue"), foreign.foreignFields());
    }

    @ParameterizedTest
    @EnumSource(SkillProcessStepType.class)
    void allStepKindsPreserveMissingNullAndExplicitBooleans(SkillProcessStepType stepType) throws Exception {
        for (String authorValue : new String[] {"", "null", "true", "false"}) {
            String occupation = authorValue.isEmpty() ? "" : "\"occupiesAction\":" + authorValue + ",";
            String input = """
                {"stepKey":"cast","name":"步骤","stepType":"%s","sortOrder":0,%s"detail":{}}
                """.formatted(stepType, occupation);
            Boolean expected = authorValue.isEmpty() || "null".equals(authorValue)
                ? null : Boolean.valueOf(authorValue);
            SkillProcessStepRequest request = json.readValue(input, SkillProcessStepRequest.class);
            assertEquals(expected, request.occupiesAction());
            assertEquals(expected, AggregateJson.read(input, SkillProcessStepRequest.class).occupiesAction());
            assertEquals(request, AggregateJson.read(AggregateJson.write(request), SkillProcessStepRequest.class));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"\"true\"", "\"false\"", "0", "1", "0.0", "\"\"", "[]", "{}"})
    void occupationRejectsNonBooleanValuesInsteadOfCoercingThem(String authorValue) {
        String input = """
            {"stepKey":"cast","name":"延时","stepType":"DELAY","sortOrder":0,
             "occupiesAction":%s,"detail":{"delayValue":{"kind":"FIXED","value":250}}}
            """.formatted(authorValue);
        assertThrows(JsonProcessingException.class, () -> json.readValue(input, SkillProcessStepRequest.class));
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(input, SkillProcessStepRequest.class));
    }
}
