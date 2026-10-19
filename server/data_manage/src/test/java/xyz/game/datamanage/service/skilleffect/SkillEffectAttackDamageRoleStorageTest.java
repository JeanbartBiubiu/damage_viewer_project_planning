package xyz.game.datamanage.service.skilleffect;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.support.authoring.AggregateJson;

class SkillEffectAttackDamageRoleStorageTest {
    @Test void canonicalResultWriterAndIndependentReaderPreserveBothRolesWithoutChangingOldShapes() {
        for (String role : List.of("", ",\"attackDamageRole\":\"PRIMARY\"", ",\"attackDamageRole\":\"REPLACE_PRIMARY\"")) {
            String row = """
                {"resultKey":"hit","name":"伤害","resultType":"DAMAGE","target":"TARGET","description":null,
                 "sortOrder":0,"valueRule":{"value":{"kind":"FIXED","value":0},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
                 "detail":{"damageTypeKey":"magic","deliveryKind":"BASIC_ATTACK","originKind":"DIRECT",
                   "critical":{"mode":"DISALLOWED","multiplierValue":null},"vampQualification":"RESOLVED","vampOverrides":[]%s},
                 "lifecycleBehavior":null,"spellShieldBlockScope":null}
                """.formatted(role);
            var request = AggregateJson.read(row, SkillEffectResultRequest.class);
            var written = SkillEffectAggregate.writeResults(List.of(request));
            assertEquals(AggregateJson.tree("[" + row + "]"), AggregateJson.tree(written));
            var read = SkillEffectAggregate.readResults(written).getFirst();
            var response = SkillEffectAggregate.resultResponse(read);
            assertEquals(((SkillEffectDamageDetail) request.detail()).attackDamageRole(),
                ((SkillEffectDamageDetail) response.detail()).attackDamageRole());
            assertEquals(AggregateJson.tree(row), AggregateJson.tree(AggregateJson.write(response)));
        }
    }
}
