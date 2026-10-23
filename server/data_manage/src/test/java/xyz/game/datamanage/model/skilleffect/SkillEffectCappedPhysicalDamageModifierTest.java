package xyz.game.datamanage.model.skilleffect;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.AggregateJson;

class SkillEffectCappedPhysicalDamageModifierTest {
    private static final String DETAIL = """
        {"modifierZoneKey":"taken_flat","direction":"TAKEN","operation":"DECREASE",
         "damageTypeKey":"physical_type","deliveryKind":"ANY","originKind":"ANY","criticalFilter":"ANY","condition":null}
        """;

    @Test void absentCapDoesNotAddAnEmptyFieldToOldDetail() {
        var detail = AggregateJson.read(DETAIL, SkillEffectDamageModifierDetail.class);
        assertEquals(AggregateJson.tree(DETAIL), AggregateJson.tree(AggregateJson.write(detail)));
        assertFalse(AggregateJson.tree(AggregateJson.write(detail)).has("maximumReductionRatioValue"));
    }

    @ParameterizedTest @ValueSource(strings = {"{\"kind\":\"FIXED\",\"value\":0.5}", "{\"kind\":\"PARAMETER\",\"parameterKey\":\"cap\"}"})
    void explicitCapSurvivesTheExistingDetailReadWritePath(String value) {
        ObjectNode node = (ObjectNode) AggregateJson.tree(DETAIL);
        node.set("maximumReductionRatioValue", AggregateJson.tree(value));
        var detail = AggregateJson.read(node.toString(), SkillEffectDamageModifierDetail.class);
        assertTrue(detail.unknownFields().isEmpty());
        assertEquals(node, AggregateJson.tree(AggregateJson.write(detail)));
    }

    @ParameterizedTest @ValueSource(strings = {"null", "0.5", "true", "{}", "{\"kind\":\"FIXED\",\"value\":\"0.5\"}", "{\"kind\":\"FIXED\",\"value\":0.5,\"extra\":0}"})
    void explicitNullAndMalformedNumericValuesCannotBecomeAbsent(String value) {
        ObjectNode node = (ObjectNode) AggregateJson.tree(DETAIL);
        node.set("maximumReductionRatioValue", AggregateJson.tree(value));
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(node.toString(), SkillEffectDamageModifierDetail.class));
    }
}
