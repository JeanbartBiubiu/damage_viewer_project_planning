package xyz.game.datamanage.service.skilleffect;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownDurationModifierDetail;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.CooldownDurationTestData;

class SkillEffectCooldownDurationStorageTest {
    @Test void aggregateWriterAndIndependentReaderPreserveTheNewShapeAndRangeOrder() {
        var raw = CooldownDurationTestData.result();
        ((com.fasterxml.jackson.databind.node.ObjectNode) raw.path("detail").path("affectedSkillScope"))
            .putArray("skillKeys").add("second_skill").add("first_skill");
        var request = AggregateJson.read(raw.toString(), SkillEffectResultRequest.class);
        String stored = SkillEffectAggregate.writeResults(List.of(request));
        var loaded = SkillEffectAggregate.readResults(stored).getFirst();
        assertEquals(raw, AggregateJson.tree(AggregateJson.write(SkillEffectAggregate.resultResponse(loaded))));
        var detail = assertInstanceOf(SkillEffectCooldownDurationModifierDetail.class, loaded.detail());
        assertEquals(List.of("second_skill", "first_skill"), detail.affectedSkillScope().skillKeys());
        assertFalse(stored.contains("operation"));
    }
}
