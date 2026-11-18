package xyz.game.datamanage.model.skilleffect;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.AggregateJson;

class SkillEffectSpellShieldFollowResultTest {
    private static final String DETAIL = """
        {"damageTypeKey":"magic","deliveryKind":"SKILL","originKind":"DIRECT",
         "critical":{"mode":"DISALLOWED","multiplierValue":null},"vampQualification":"RESOLVED","vampOverrides":[]}
        """;

    @Test void omissionPreservesTheExistingSerializedShapeAndClassification() {
        var detail = AggregateJson.read(DETAIL, SkillEffectDamageDetail.class);
        assertNull(detail.spellShieldFollowResult());
        assertFalse(AggregateJson.tree(AggregateJson.write(detail)).has("spellShieldFollowResult"));
        assertEquals(AggregateJson.tree(DETAIL), AggregateJson.tree(AggregateJson.write(detail)));
    }

    @Test void theCompleteExplicitIdentitySurvivesSerialization() {
        var json = (ObjectNode) AggregateJson.tree(DETAIL);
        json.set("spellShieldFollowResult", AggregateJson.tree("{\"skillKey\":\"source_skill\",\"effectKey\":\"payload\",\"resultKey\":\"damage\"}"));
        var detail = AggregateJson.read(json.toString(), SkillEffectDamageDetail.class);
        assertEquals(new SkillEffectSpellShieldFollowResult("source_skill", "payload", "damage"), detail.spellShieldFollowResult());
        assertTrue(detail.unknownFields().isEmpty());
        assertEquals(json, AggregateJson.tree(AggregateJson.write(detail)));
    }

    @ParameterizedTest @ValueSource(strings = {"null", "0", "true", "[]", "{}",
        "{\"skillKey\":\"s\",\"effectKey\":\"e\"}",
        "{\"skillKey\":\"s\",\"effectKey\":\"e\",\"resultKey\":\"r\",\"extra\":1}",
        "{\"skillKey\":\" s\",\"effectKey\":\"e\",\"resultKey\":\"r\"}",
        "{\"skillKey\":12,\"effectKey\":\"e\",\"resultKey\":\"r\"}",
        "{\"skillKey\":\"s\",\"effectKey\":\"e\",\"resultKey\":null}"})
    void explicitNullUnknownAndMalformedIdentityAreRejected(String value) {
        var json = (ObjectNode) AggregateJson.tree(DETAIL);
        json.set("spellShieldFollowResult", AggregateJson.tree(value));
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(json.toString(), SkillEffectDamageDetail.class));
    }

    @Test void otherResultDetailsRetainTheFieldForStrictServiceRejection() {
        for (String value : List.of("null", "{}")) {
            var detail = AggregateJson.read("{\"spellShieldFollowResult\":" + value + "}", SkillEffectDirectHealDetail.class);
            assertTrue(detail.unknownFields().contains("spellShieldFollowResult"));
        }
    }
}
