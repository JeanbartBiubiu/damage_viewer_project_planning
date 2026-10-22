package xyz.game.datamanage.model.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class SkillEffectCooldownChangeOperationTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @ParameterizedTest
    @EnumSource(value = SkillEffectCooldownChangeOperation.class, names = {"REDUCE_REMAINING_RATIO", "REDUCE_TOTAL_RATIO"})
    void ratioOperationRoundTripsThroughDetailJson(SkillEffectCooldownChangeOperation operation) throws Exception {
        String json = "{\"affectedSkillScope\":{\"mode\":\"ALL\",\"skillKeys\":[],\"skillCategoryKeys\":[]},"
            + "\"operation\":\"" + operation.name() + "\"}";

        SkillEffectCooldownChangeDetail detail = mapper.readValue(json, SkillEffectCooldownChangeDetail.class);
        assertEquals(operation, detail.operation());

        JsonNode serialized = mapper.readTree(mapper.writeValueAsString(detail));
        assertEquals(operation.name(), serialized.path("operation").asText());
        SkillEffectCooldownChangeDetail roundTrip = mapper.treeToValue(serialized, SkillEffectCooldownChangeDetail.class);
        assertEquals(detail, roundTrip);
    }
}
