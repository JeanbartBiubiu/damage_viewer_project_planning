package xyz.game.datamanage.model.skilleffect;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.AggregateJson;

class SkillEffectAttackDamageRoleTest {
    private static final String DETAIL = """
        {"damageTypeKey":"magic","deliveryKind":"BASIC_ATTACK","originKind":"DIRECT",
         "critical":{"mode":"DISALLOWED","multiplierValue":null},"vampQualification":"RESOLVED","vampOverrides":[]}
        """;

    @Test void absentRoleKeepsTheOriginalSerializedBytes() {
        var detail = AggregateJson.read(DETAIL, SkillEffectDamageDetail.class);
        assertNull(detail.attackDamageRole());
        assertFalse(AggregateJson.tree(AggregateJson.write(detail)).has("attackDamageRole"));
        assertEquals(DETAIL.replaceAll("\\s+", ""), AggregateJson.write(detail));
    }

    @ParameterizedTest @ValueSource(strings = {"PRIMARY", "REPLACE_PRIMARY"})
    void explicitRolesSurviveBothReadAndWrite(String role) {
        ObjectNode value = (ObjectNode) AggregateJson.tree(DETAIL);
        value.put("attackDamageRole", role);
        var detail = AggregateJson.read(value.toString(), SkillEffectDamageDetail.class);
        assertEquals(role, detail.attackDamageRole().name());
        assertTrue(detail.unknownFields().isEmpty());
        assertEquals(value, AggregateJson.tree(AggregateJson.write(detail)));
    }

    @ParameterizedTest @ValueSource(strings = {"null", "0", "1", "1.0", "true", "{}", "[]", "\"primary\"", "\"OTHER\"", "\"\"", "\" PRIMARY \""})
    void explicitNullAndAnyNonExactStringAreRejected(String value) {
        ObjectNode node = (ObjectNode) AggregateJson.tree(DETAIL);
        node.set("attackDamageRole", AggregateJson.tree(value));
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(node.toString(), SkillEffectDamageDetail.class));
    }

    @Test void foreignResultTypesRetainTheFieldForTheExistingStrictServiceRejection() {
        for (String value : List.of("\"PRIMARY\"", "null", "0")) {
            var detail = AggregateJson.read("{\"attackDamageRole\":" + value + "}", SkillEffectDirectHealDetail.class);
            assertTrue(detail.unknownFields().contains("attackDamageRole"));
        }
    }
}
