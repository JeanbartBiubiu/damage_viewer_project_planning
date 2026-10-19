package xyz.game.datamanage.model.skilleffect;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.CooldownDurationTestData;

class SkillEffectCooldownDurationModifierTest {
    @Test void parsesAndSerializesOnlyItsScopeWithoutOperationOrExtraFields() {
        var raw = CooldownDurationTestData.result();
        var result = AggregateJson.read(raw.toString(), SkillEffectResultRequest.class);
        var detail = assertInstanceOf(SkillEffectCooldownDurationModifierDetail.class, result.detail());
        assertEquals(List.of("target_skill"), detail.affectedSkillScope().skillKeys());
        assertTrue(detail.foreignFields().isEmpty());
        assertEquals(raw.path("detail"), AggregateJson.tree(AggregateJson.write(detail)));
        assertEquals(raw, AggregateJson.tree(AggregateJson.write(result)));
    }

    @ParameterizedTest @ValueSource(strings = {
        "0", "true", "[]", "{}", "{\"affectedSkillScope\":null}",
        "{\"affectedSkillScope\":{\"mode\":0,\"skillKeys\":[\"x\"],\"skillCategoryKeys\":[]}}",
        "{\"affectedSkillScope\":{\"mode\":\"ALL\",\"skillKeys\":[],\"skillCategoryKeys\":[]}}",
        "{\"affectedSkillScope\":{\"mode\":\"SKILLS\",\"skillKeys\":[1],\"skillCategoryKeys\":[]}}",
        "{\"affectedSkillScope\":{\"mode\":\"SKILLS\",\"skillKeys\":[null],\"skillCategoryKeys\":[]}}",
        "{\"affectedSkillScope\":{\"mode\":\"SKILLS\",\"skillKeys\":null,\"skillCategoryKeys\":[]}}",
        "{\"affectedSkillScope\":{\"mode\":\"SKILLS\",\"skillKeys\":[\"x\"]}}",
        "{\"affectedSkillScope\":{\"mode\":\"SKILLS\",\"skillKeys\":[\"x\"],\"skillCategoryKeys\":[],\"extra\":null}}"
    })
    void rejectsWrongJsonShapesAndCoercions(String detail) {
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(detail, SkillEffectCooldownDurationModifierDetail.class));
    }

    @ParameterizedTest @ValueSource(strings = {"operation", "modifierZoneKey", "affectedSkillKeys", "unknown"})
    void explicitNullExtraFieldsAreAlsoRejected(String field) {
        ObjectNode detail = (ObjectNode) CooldownDurationTestData.result().path("detail");
        detail.putNull(field);
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(detail.toString(), SkillEffectCooldownDurationModifierDetail.class));
    }

    @Test void newTypeAndTargetCannotBeCoercedFromNumbers() {
        var numericType = CooldownDurationTestData.result();
        numericType.put("resultType", SkillEffectResultType.COOLDOWN_DURATION_MODIFIER.ordinal());
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(numericType.toString(), SkillEffectResultRequest.class));
        var numericTarget = CooldownDurationTestData.result();
        numericTarget.put("target", SkillEffectTarget.SOURCE.ordinal());
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(numericTarget.toString(), SkillEffectResultRequest.class));
    }
}
