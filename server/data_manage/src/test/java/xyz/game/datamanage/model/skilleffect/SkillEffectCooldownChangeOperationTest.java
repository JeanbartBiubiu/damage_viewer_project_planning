package xyz.game.datamanage.model.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class SkillEffectCooldownChangeOperationTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void remainingRatioOperationRoundTripsThroughDetailJson() throws Exception {
        String json = "{\"affectedSkillScope\":{\"mode\":\"ALL\",\"skillKeys\":[],\"skillCategoryKeys\":[]},"
            + "\"operation\":\"REDUCE_REMAINING_RATIO\"}";

        SkillEffectCooldownChangeDetail detail = mapper.readValue(json, SkillEffectCooldownChangeDetail.class);
        assertEquals(SkillEffectCooldownChangeOperation.REDUCE_REMAINING_RATIO, detail.operation());

        JsonNode serialized = mapper.readTree(mapper.writeValueAsString(detail));
        assertEquals("REDUCE_REMAINING_RATIO", serialized.path("operation").asText());
        SkillEffectCooldownChangeDetail roundTrip = mapper.treeToValue(serialized, SkillEffectCooldownChangeDetail.class);
        assertEquals(detail, roundTrip);
    }
}
