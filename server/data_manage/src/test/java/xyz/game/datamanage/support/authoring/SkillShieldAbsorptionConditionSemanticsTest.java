package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import static xyz.game.datamanage.support.authoring.ShieldAbsorptionTestData.*;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingDetail;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class SkillShieldAbsorptionConditionSemanticsTest {
    @Test
    void selectorRoundTripsButOldTotalAbsorptionHasNoAddedJsonKey() {
        var detail = detail(rule("shield_skill"));
        var typed = AggregateJson.read(detail.toString(), SkillTriggerEventValueConditionDetail.class);
        assertEquals(detail, AggregateJson.tree(AggregateJson.write(typed)));
        detail.remove("shieldResult");
        var old = AggregateJson.read(detail.toString(), SkillTriggerEventValueConditionDetail.class);
        assertNull(old.shieldResult());
        assertEquals(detail, AggregateJson.tree(AggregateJson.write(old)));
        assertFalse(AggregateJson.tree(AggregateJson.write(old)).has("shieldResult"));
        detail.putNull("shieldResult");
        var explicitNull = AggregateJson.read(detail.toString(), SkillTriggerEventValueConditionDetail.class);
        assertTrue(explicitNull.shieldResult().isNull());
        assertTrue(AggregateJson.tree(AggregateJson.write(explicitNull)).has("shieldResult"));
        assertTrue(AggregateJson.read(detail.toString(), SkillTriggerEventValueBindingDetail.class)
            .unknownFields().contains("shieldResult"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{}", "[]", "1", "\"shield\"",
        "{\"skillKey\":\"shield_skill\",\"effectKey\":\"barrier\"}",
        "{\"skillKey\":\"shield_skill\",\"effectKey\":\"barrier\",\"resultKey\":\"shield\",\"extra\":null}",
        "{\"skillKey\":true,\"effectKey\":\"barrier\",\"resultKey\":\"shield\"}",
        "{\"skillKey\":\"shield_skill\",\"effectKey\":12,\"resultKey\":\"shield\"}",
        "{\"skillKey\":\"shield_skill\",\"effectKey\":\"barrier\",\"resultKey\":null}",
        "{\"skillKey\":\"shield_skill\",\"effectKey\":\"barrier\",\"resultKey\":\"\"}",
        "{\"skillKey\":\"shield_skill\",\"effectKey\":\"barrier\",\"resultKey\":\" shield\"}"})
    void malformedSelectorsFailBothSemanticValidationAndReferenceExtraction(String json) {
        Aggregate rule = rule("shield_skill");
        detail(rule).set("shieldResult", AggregateJson.tree(json));
        assertThrows(ApiException.class, () -> SkillShieldAbsorptionConditionSemantics.validate(List.of(rule), List.of(rule, shield("shield_skill"))));
        assertThrows(ApiException.class, () -> SkillObjectReferences.extract("lol", List.of(rule)));
    }

    @Test
    void completeResultReferenceProtectsResultAndWholeEffectDeletion() {
        Aggregate rule = rule("shield_skill"), shield = shield("shield_skill");
        assertEquals(List.of(shield), SkillShieldAbsorptionConditionSemantics.validate(List.of(rule), List.of(rule, shield)));
        var refs = SkillObjectReferences.extractAndValidate("lol", List.of(rule), List.of(rule, shield), Set.of());
        assertEquals(1, refs.size());
        assertEquals(new Target(TargetType.RESULT, "shield_skill", "barrier", "shield"), refs.getFirst().target());
        assertEquals("conditionGroups[0].conditions[0].detail.shieldResult.resultKey", refs.getFirst().fieldPath());
        assertThrows(ApiException.class, () -> SkillObjectReferences.validateExistingTargets(refs, List.of(rule), Set.of()));
        ((ArrayNode) shield.data().path("results")).removeAll();
        assertThrows(ApiException.class, () -> SkillObjectReferences.validateExistingTargets(refs, List.of(rule, shield), Set.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"event", "value", "other_skill", "missing_effect", "missing_result", "duplicate", "second_shield",
        "spell_shield", "target", "scope", "no_lifecycle", "no_shield_end", "wrong_shield_end", "instant", "individual", "independent"})
    void rejectsWrongEventOwnerOrShieldStructure(String mutation) {
        Aggregate rule = rule("shield_skill"), shield = shield("shield_skill");
        ObjectNode selector = (ObjectNode) detail(rule).path("shieldResult");
        ObjectNode life = (ObjectNode) shield.data().path("lifecycle"), result = (ObjectNode) shield.data().path("results").get(0);
        switch (mutation) {
            case "event" -> ((ObjectNode) rule.data().path("eventSource")).put("eventType", "DAMAGE_DEALT");
            case "value" -> detail(rule).put("eventValueKey", "ACTUAL_HP_LOSS");
            case "other_skill" -> selector.put("skillKey", "other_skill");
            case "missing_effect" -> selector.put("effectKey", "missing");
            case "missing_result" -> selector.put("resultKey", "missing");
            case "duplicate" -> ((ArrayNode) shield.data().path("results")).add(result.deepCopy());
            case "second_shield" -> ((ArrayNode) shield.data().path("results")).add(result.deepCopy().put("resultKey", "other"));
            case "spell_shield" -> result.put("resultType", "SPELL_SHIELD");
            case "target" -> result.put("target", "TARGET");
            case "scope" -> life.put("instanceScope", "TARGET");
            case "no_lifecycle" -> ((ObjectNode) shield.data()).putNull("lifecycle");
            case "no_shield_end" -> life.putNull("endWhenShieldEndsResultKey");
            case "wrong_shield_end" -> life.put("endWhenShieldEndsResultKey", "other");
            case "instant" -> ((ObjectNode) result.path("lifecycleBehavior")).put("moment", "APPLICATION");
            case "individual" -> ((ObjectNode) result.path("lifecycleBehavior")).put("stackValueMode", "PER_STACK");
            case "independent" -> life.put("reapplicationDurationMode", "INDEPENDENT");
        }
        assertThrows(ApiException.class, () -> SkillShieldAbsorptionConditionSemantics.validate(List.of(rule), List.of(rule, shield)));
    }

    @Test
    void newlyAddedReadRechecksAllDeclaredStackLevelsOfUnchangedShield() {
        Aggregate rule = rule("shield_skill"), shield = shield("shield_skill");
        ((ObjectNode) shield.data().path("lifecycle")).set("maxStacksValue", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"layers\"}"));
        var numericTargets = SkillShieldAbsorptionConditionSemantics.validate(List.of(rule), List.of(rule, shield));
        assertEquals(List.of(shield), numericTargets);
        var one = new SkillNumericSemantics.Parameter("shield_skill", "layers", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":1,\"2\":1}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(numericTargets, List.of(rule, shield), List.of(one), Map.of(), Map.of(), Map.of()));
        var two = new SkillNumericSemantics.Parameter("shield_skill", "layers", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":1,\"2\":2}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(numericTargets, List.of(rule, shield), List.of(two), Map.of(), Map.of(), Map.of()));
    }

    private static ObjectNode detail(Aggregate rule) {
        return (ObjectNode) rule.data().path("conditionGroups").get(0).path("conditions").get(0).path("detail");
    }
}
