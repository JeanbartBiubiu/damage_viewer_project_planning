package xyz.game.datamanage.model.skillprocess;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.AggregateJson;

class SkillProcessStepRequestTest {

    private final ObjectMapper json = new ObjectMapper();

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
