package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class AttributeFinalLimitSemanticsTest {
    private ObjectNode effect() {
        return (ObjectNode) AggregateJson.tree("""
            {"lifecycle":{"durationValue":{"kind":"FIXED","value":1000},"maxStacksValue":{"kind":"FIXED","value":1},
            "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE","reapplicationStackMode":"KEEP",
            "reapplicationDurationMode":"REFRESH_ALL","expiryMode":"ALL_AT_ONCE","periodicIntervalValue":null,
            "firstPeriodicExecution":null,"endWhenShieldEndsResultKey":null},"results":[{"resultKey":"cap","resultType":"ATTRIBUTE_CHANGE",
            "target":"SOURCE","detail":{"attributeKey":"attack_speed","operation":"LIMIT_MAX","modifierZoneKey":null},
            "valueRule":{"value":{"kind":"FIXED","value":3.33},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
            "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"MOMENT_EVALUATION","stackValueMode":"SHARED",
            "reapplicationValueMode":null,"periodicExecutionMode":null},"spellShieldBlockScope":null}]}
            """);
    }

    @Test void sharedShapeAcceptsFiniteSourceAndRejectsInstantOrZone() {
        ObjectNode valid = effect();
        assertTrue(AttributeFinalLimitSemantics.issues(valid.path("lifecycle"), valid.path("results").get(0), "results[0]").isEmpty());
        ObjectNode zone = valid.deepCopy();
        ((ObjectNode) zone.path("results").get(0).path("detail")).put("modifierZoneKey", "flat_add");
        assertFalse(AttributeFinalLimitSemantics.issues(zone.path("lifecycle"), zone.path("results").get(0), "results[0]").isEmpty());
        assertFalse(AttributeFinalLimitSemantics.issues(AggregateJson.tree("null"), valid.path("results").get(0), "results[0]").isEmpty());
    }

    @Test void numericValidationKeepsZeroDistinctAndRejectsDynamicLimit() {
        ObjectNode valid = effect();
        ((ObjectNode) valid.path("results").get(0).path("valueRule").path("value")).put("value", 0);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(new Aggregate(SourceType.EFFECT, "skill", "limited", valid)), List.of()));
        ObjectNode dynamic = effect();
        ((ObjectNode) dynamic.path("results").get(0).path("valueRule")).set("value", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"missing\"}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(new Aggregate(SourceType.EFFECT, "skill", "limited", dynamic)), List.of()));
    }
}
