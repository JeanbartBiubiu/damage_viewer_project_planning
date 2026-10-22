package xyz.game.datamanage.model.skillprocess;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.AggregateJson;

class SkillProcessRecastStepDetailTest {
    private final ObjectMapper json = new ObjectMapper();

    @ParameterizedTest
    @ValueSource(strings = {"", ",\"intervalValue\":null"})
    void omittedAndNullIntervalsHaveOneUnconfiguredMeaning(String optional) throws Exception {
        var value = json.readValue(detail(optional), SkillProcessRecastStepDetail.class);
        assertNull(value.intervalValue());
        assertTrue(value.foreignFields().isEmpty());
        assertFalse(json.readTree(AggregateJson.write(value)).has("intervalValue"));
        assertEquals(value, AggregateJson.read(AggregateJson.write(value), SkillProcessRecastStepDetail.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"kind\":\"FIXED\",\"value\":1000}",
        "{\"kind\":\"PARAMETER\",\"parameterKey\":\"gap\"}", "{\"kind\":\"FORMULA\",\"formulaKey\":\"gap\"}"})
    void intervalRetainsTheSameStrictNumericAuthorShape(String interval) throws Exception {
        var value = json.readValue(detail(",\"intervalValue\":" + interval), SkillProcessRecastStepDetail.class);
        assertNotNull(value.intervalValue());
        assertTrue(value.foreignFields().isEmpty());
        assertEquals(value, AggregateJson.read(AggregateJson.write(value), SkillProcessRecastStepDetail.class));
        String step = "{\"stepKey\":\"again\",\"stepType\":\"RECAST\",\"occupiesAction\":false,\"detail\":" + detail(",\"intervalValue\":" + interval) + "}";
        var request = json.readValue(step, SkillProcessStepRequest.class);
        assertEquals(value, request.detail());
    }

    @ParameterizedTest
    @ValueSource(strings = {"true", "1000", "\"1000\"", "[]", "{}", "{\"kind\":\"FIXED\",\"value\":\"1000\"}",
        "{\"kind\":\"FIXED\",\"value\":1000,\"extra\":1}", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"\"}"})
    void malformedIntervalIsNotCoercedOrIgnored(String interval) {
        assertThrows(JsonProcessingException.class,
            () -> json.readValue(detail(",\"intervalValue\":" + interval), SkillProcessRecastStepDetail.class));
    }

    @Test
    void intervalDoesNotAuthorizeForeignFieldsOrOtherStepKinds() throws Exception {
        var foreign = json.readValue(detail(",\"delayValue\":null,\"recastStartsNewCast\":true"), SkillProcessRecastStepDetail.class);
        assertEquals(java.util.Set.of("delayValue"), foreign.foreignFields());
        assertEquals(java.util.Set.of("recastStartsNewCast"), foreign.unknownFields());
        var immediate = json.readValue("{\"intervalValue\":null}", SkillProcessImmediateStepDetail.class);
        assertEquals(java.util.Set.of("intervalValue"), immediate.foreignFields());
        assertEquals(SkillNumericValue.fixed(BigDecimal.valueOf(15000)), foreign.windowValue());
    }

    private static String detail(String optional) {
        return "{\"windowValue\":{\"kind\":\"FIXED\",\"value\":15000},\"maximumRecastCountValue\":{\"kind\":\"FIXED\",\"value\":2}" + optional + "}";
    }
}
