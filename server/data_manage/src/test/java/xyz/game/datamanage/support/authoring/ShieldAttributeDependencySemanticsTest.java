package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class ShieldAttributeDependencySemanticsTest {
    @Test
    void explicitDependencyRoundTripsAndIsIndexedWithCompleteShieldIdentity() {
        Aggregate dependent = dependent();
        Aggregate shield = shield();
        assertDoesNotThrow(() -> ShieldAttributeDependencySemantics.validate(List.of(dependent), List.of(dependent, shield)));
        SkillEffectResultRequest result = AggregateJson.read(dependent.data().path("results").get(0).toString(), SkillEffectResultRequest.class);
        assertEquals(dependent.data().path("results").get(0).path("detail"),
            AggregateJson.tree(AggregateJson.write(result.detail())));
        var references = SkillObjectReferences.extract("lab", List.of(dependent));
        var reference = references.stream().filter(ref -> ref.fieldPath().endsWith("requiredShield.resultKey")).findFirst().orElseThrow();
        assertEquals(new Target(TargetType.RESULT, "barrier_skill", "shield", "barrier"), reference.target());
        assertThrows(ApiException.class, () -> SkillObjectReferences.validateExistingTargets(List.of(reference), List.of(dependent), java.util.Set.of()));
        assertDoesNotThrow(() -> SkillObjectReferences.validateExistingTargets(List.of(reference), List.of(dependent, shield), java.util.Set.of()));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(dependent), List.of(), Map.of("total", "RATIO_MULTIPLY")));
    }

    @Test
    void missingFieldStaysAbsentButExplicitNullAndUnknownDependencyFieldsAreRejected() {
        ObjectNode detail = detail(dependent());
        detail.remove("requiredShield");
        var result = AggregateJson.read(detail.toString(), xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetail.class);
        assertFalse(AggregateJson.tree(AggregateJson.write(result)).has("requiredShield"));
        for (String invalid : List.of("null", "{}", "{\"skillKey\":\"barrier_skill\",\"effectKey\":\"shield\",\"resultKey\":\"barrier\",\"extra\":1}",
            "{\"skillKey\":12,\"effectKey\":\"shield\",\"resultKey\":\"barrier\"}")) {
            Aggregate dependent = dependent();
            detail(dependent).set("requiredShield", AggregateJson.tree(invalid));
            assertThrows(ApiException.class, () -> ShieldAttributeDependencySemantics.validate(List.of(dependent), List.of(dependent, shield())));
        }
    }

    @Test
    void targetMutationAndSelfCycleAreRejectedAfterAuthoring() {
        for (String mutation : List.of("type", "target", "lifecycle", "recursive")) {
            Aggregate dependent = dependent();
            Aggregate shield = shield();
            ObjectNode target = (ObjectNode) shield.data().path("results").get(0);
            switch (mutation) {
                case "type" -> target.put("resultType", "DIRECT_HEAL");
                case "target" -> target.put("target", "TARGET");
                case "lifecycle" -> ((ObjectNode) shield.data().path("lifecycle")).putNull("endWhenShieldEndsResultKey");
                case "recursive" -> ((ObjectNode) target.path("detail")).set("requiredShield", detail(dependent).path("requiredShield"));
            }
            assertThrows(ApiException.class, () -> ShieldAttributeDependencySemantics.validate(List.of(dependent), List.of(dependent, shield)));
        }
        Aggregate dependent = dependent();
        ((ObjectNode) detail(dependent).path("requiredShield")).put("skillKey", "armor_skill").put("effectKey", "bonus");
        assertThrows(ApiException.class, () -> ShieldAttributeDependencySemantics.validate(List.of(dependent), List.of(dependent, shield())));
    }

    @Test
    void everyDeclaredLevelMustBeStaticNonNegativeAndSingleLayer() {
        Aggregate dependent = dependent();
        ((ObjectNode) dependent.data().path("results").get(0).path("valueRule")).set("value",
            AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"ratio\"}"));
        for (Parameter parameter : List.of(
            new Parameter("armor_skill", "ratio", "DECIMAL", "RUNTIME_INPUT", null, null),
            new Parameter("armor_skill", "ratio", "DECIMAL", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":0.2,\"2\":-0.1}")))) {
            ApiException error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(dependent), List.of(parameter)));
            assertTrue(error.getDetails().toString().contains(parameter.valueMode().equals("RUNTIME_INPUT")
                ? "RUNTIME_INPUT_FORBIDDEN" : "STATIC_SHIELD_ATTRIBUTE_REQUIRED"), error.getDetails().toString());
        }
        Aggregate stacks = dependent();
        ((ObjectNode) stacks.data().path("lifecycle").path("maxStacksValue")).put("value", 2);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(stacks), List.of()));
        Aggregate hp = dependent();
        detail(hp).put("attributeKey", "hp");
        assertThrows(ApiException.class, () -> ShieldAttributeDependencySemantics.validate(List.of(hp), List.of(hp, shield())));
    }

    private static ObjectNode detail(Aggregate aggregate) { return (ObjectNode) aggregate.data().path("results").get(0).path("detail"); }
    private static Aggregate dependent() {
        return new Aggregate(SourceType.EFFECT, "armor_skill", "bonus", AggregateJson.tree("""
            {"lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},"applicationStacksValue":{"kind":"FIXED","value":1},
              "instanceScope":"SOURCE","reapplicationStackMode":"KEEP","reapplicationDurationMode":null,"expiryMode":"EXPLICIT_ONLY",
              "periodicIntervalValue":null,"firstPeriodicExecution":null,"endWhenShieldEndsResultKey":null},
             "results":[{"resultKey":"armor","name":"护盾护甲","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE","description":null,"sortOrder":0,
              "valueRule":{"value":{"kind":"FIXED","value":0.2},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
              "detail":{"attributeKey":"armor","operation":"INCREASE","modifierZoneKey":"total",
                "requiredShield":{"skillKey":"barrier_skill","effectKey":"shield","resultKey":"barrier"}},
              "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"MOMENT_EVALUATION","stackValueMode":"SHARED","reapplicationValueMode":null,"periodicExecutionMode":null},
              "spellShieldBlockScope":null}]}
            """));
    }
    private static Aggregate shield() {
        return new Aggregate(SourceType.EFFECT, "barrier_skill", "shield", AggregateJson.tree("""
            {"lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},"applicationStacksValue":{"kind":"FIXED","value":1},
              "instanceScope":"SOURCE","reapplicationStackMode":"KEEP","reapplicationDurationMode":null,"expiryMode":"EXPLICIT_ONLY",
              "periodicIntervalValue":null,"firstPeriodicExecution":null,"endWhenShieldEndsResultKey":"barrier"},
             "results":[{"resultKey":"barrier","name":"护盾","resultType":"NORMAL_SHIELD","target":"SOURCE","sortOrder":0,"description":null,
              "detail":{"absorbedDamageTypeKey":null,"decayMode":"NONE"},"valueRule":{"value":{"kind":"FIXED","value":10},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
              "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED","reapplicationValueMode":"REPLACE","periodicExecutionMode":null},"spellShieldBlockScope":null}]}
            """));
    }
}
