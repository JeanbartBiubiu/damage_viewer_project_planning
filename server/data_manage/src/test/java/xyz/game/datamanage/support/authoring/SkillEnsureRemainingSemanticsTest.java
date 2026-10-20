package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillEnsureRemainingSemanticsTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static ObjectNode node(String json) throws Exception { return (ObjectNode) JSON.readTree(json); }
    private static Aggregate object(String key, ObjectNode data) { return new Aggregate(SourceType.EFFECT, "duration_skill", key, data); }
    private static ObjectNode operation(String amount) throws Exception {
        return node("""
            {"lifecycle":null,"results":[{"resultKey":"ensure","resultType":"LIFECYCLE_OPERATION","target":"SOURCE",
             "lifecycleBehavior":null,"spellShieldBlockScope":null,
             "valueRule":{"value":{"kind":"FIXED","value":%s},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
             "detail":{"operation":"ENSURE_REMAINING","targetEffectKey":"window"}}]}
            """.formatted(amount));
    }
    private static ObjectNode target() throws Exception {
        return node("""
            {"lifecycle":{"durationValue":{"kind":"FIXED","value":3000},"maxStacksValue":{"kind":"FIXED","value":1},
              "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE","reapplicationStackMode":"KEEP",
              "reapplicationDurationMode":"REFRESH_ALL","expiryMode":"ALL_AT_ONCE","periodicIntervalValue":null,
              "firstPeriodicExecution":null,"endWhenShieldEndsResultKey":null},
             "results":[{"resultKey":"flat","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE","spellShieldBlockScope":null,
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED",
                  "reapplicationValueMode":"REPLACE","periodicExecutionMode":null},
               "valueRule":{"value":{"kind":"FIXED","value":10},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
               "detail":{"attributeKey":"attack_damage","operation":"INCREASE","modifierZoneKey":"flat"}},
              {"resultKey":"total","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE","spellShieldBlockScope":null,
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED",
                  "reapplicationValueMode":"REPLACE","periodicExecutionMode":null},
               "valueRule":{"value":{"kind":"FIXED","value":0.25},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
               "detail":{"attributeKey":"attack_damage","operation":"INCREASE","modifierZoneKey":"total"}}]}
            """);
    }
    private static void validate(ObjectNode operation, ObjectNode target) {
        SkillNumericSemantics.validate(List.of(object("maintenance", operation), object("window", target)), List.of(),
            Map.of("flat", "FLAT_ADD", "total", "RATIO_MULTIPLY"), Map.of("flat", "ATTRIBUTE", "total", "ATTRIBUTE"),
            Map.of("flat", "ATTRIBUTE_FLAT", "total", "ATTRIBUTE_PERCENT"));
    }
    @ParameterizedTest @ValueSource(strings = {"0", "2500", "9007199254740991"})
    void acceptsSafeStaticMillisecondsAndSelfTotalMultiplier(String amount) throws Exception {
        ObjectNode operation = operation(amount), target = target();
        assertDoesNotThrow(() -> validate(operation, target));
    }
    @ParameterizedTest @ValueSource(strings = {"-1", "0.5", "9007199254740992"})
    void rejectsInvalidEffectiveMilliseconds(String amount) throws Exception {
        ObjectNode operation = operation(amount), target = target();
        assertThrows(ApiException.class, () -> validate(operation, target));
    }
    @Test void appliesCompleteFixedRuleBeforeIntegerCheck() throws Exception {
        ObjectNode operation = operation("0.5"), target = target();
        ((ObjectNode) operation.path("results").get(0).path("valueRule")).put("fixedMultiplier", 1000);
        assertDoesNotThrow(() -> validate(operation, target));
    }
    @Test void rejectsDynamicAmount() throws Exception {
        ObjectNode operation = operation("2500"), target = target();
        ((ObjectNode) operation.path("results").get(0).path("valueRule")).set("value", node("{\"kind\":\"FORMULA\",\"formulaKey\":\"dynamic\"}"));
        assertThrows(ApiException.class, () -> validate(operation, target));
    }
    @ParameterizedTest @ValueSource(strings = {"hp", "shield", "periodic", "infinite", "stack", "foreign", "target", "resnapshot", "negative_ratio"})
    void rejectsTargetShapeChangesAfterReferenceCreation(String variant) throws Exception {
        ObjectNode operation = operation("2500"), target = target();
        ObjectNode life = (ObjectNode) target.path("lifecycle"), row = (ObjectNode) target.path("results").get(0);
        switch (variant) {
            case "hp" -> ((ObjectNode) row.path("detail")).put("attributeKey", "hp");
            case "shield" -> row.put("resultType", "NORMAL_SHIELD");
            case "periodic" -> life.set("periodicIntervalValue", node("{\"kind\":\"FIXED\",\"value\":100}"));
            case "infinite" -> life.putNull("durationValue");
            case "stack" -> ((ObjectNode) life.path("maxStacksValue")).put("value", 2);
            case "foreign" -> ((ObjectNode) operation.path("results").get(0).path("detail")).put("targetEffectKey", "missing");
            case "target" -> row.put("target", "TARGET");
            case "resnapshot" -> ((ObjectNode) row.path("lifecycleBehavior")).put("valueReadMode", "MOMENT_EVALUATION");
            case "negative_ratio" -> ((ObjectNode) target.path("results").get(1).path("valueRule").path("value")).put("value", -1);
        }
        assertThrows(ApiException.class, () -> validate(operation, target));
    }
}
