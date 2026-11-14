package xyz.game.datamanage.model.skilleffect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
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
        assertFalse(serialized.has("cumulativeLimit"));
        assertEquals(operation.name(), serialized.path("operation").asText());
        SkillEffectCooldownChangeDetail roundTrip = mapper.treeToValue(serialized, SkillEffectCooldownChangeDetail.class);
        assertEquals(detail, roundTrip);
    }

    @Test
    void optionalLimitRoundTripsWithoutHidingExplicitNullFromValidation() throws Exception {
        String base = "{\"affectedSkillScope\":{\"mode\":\"SKILLS\",\"skillKeys\":[\"target_skill\"],\"skillCategoryKeys\":[]},"
            + "\"operation\":\"REDUCE_TOTAL_RATIO\",\"cumulativeLimit\":";
        SkillEffectCooldownChangeDetail present = mapper.readValue(base + "{\"groupKey\":\"refund\",\"maxRatio\":0.39}}",
            SkillEffectCooldownChangeDetail.class);
        assertEquals(present.cumulativeLimit(), mapper.readTree(mapper.writeValueAsString(present)).path("cumulativeLimit"));
        assertEquals(present, mapper.readValue(mapper.writeValueAsString(present), SkillEffectCooldownChangeDetail.class));
        SkillEffectCooldownChangeDetail explicitNull = mapper.readValue(base + "null}", SkillEffectCooldownChangeDetail.class);
        assertTrue(explicitNull.cumulativeLimit().isNull());
        assertTrue(mapper.readTree(mapper.writeValueAsString(explicitNull)).path("cumulativeLimit").isNull());
    }
}
