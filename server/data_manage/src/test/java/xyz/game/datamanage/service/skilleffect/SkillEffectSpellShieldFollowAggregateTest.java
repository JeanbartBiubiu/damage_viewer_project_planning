package xyz.game.datamanage.service.skilleffect;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldFollowResult;
import xyz.game.datamanage.support.authoring.AggregateJson;

class SkillEffectSpellShieldFollowAggregateTest {
    @Test void persistenceAndResponseSortingPreserveTheOptionalCompleteReference() {
        var request = AggregateJson.read("""
            {"resultKey":"proc","name":"附伤","resultType":"DAMAGE","target":"TARGET","description":null,"sortOrder":0,
             "valueRule":{"value":{"kind":"FIXED","value":75},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},
             "detail":{"damageTypeKey":"magic","deliveryKind":"SKILL","originKind":"DIRECT",
              "critical":{"mode":"DISALLOWED","multiplierValue":null},"vampQualification":"RESOLVED","vampOverrides":[],
              "spellShieldFollowResult":{"skillKey":"producer","effectKey":"payload","resultKey":"damage"}},
             "lifecycleBehavior":null,"spellShieldBlockScope":null}
            """, SkillEffectResultRequest.class);
        var written = SkillEffectAggregate.writeResults(List.of(request));
        var read = SkillEffectAggregate.readResults(written).getFirst();
        var detail = (SkillEffectDamageDetail) read.detail();
        assertEquals(new SkillEffectSpellShieldFollowResult("producer", "payload", "damage"), detail.spellShieldFollowResult());
        assertEquals(AggregateJson.tree(written), AggregateJson.tree(SkillEffectAggregate.writeResults(List.of(read))));
        assertEquals(detail.spellShieldFollowResult(), ((SkillEffectDamageDetail) SkillEffectAggregate.resultResponse(read).detail()).spellShieldFollowResult());
    }
}
