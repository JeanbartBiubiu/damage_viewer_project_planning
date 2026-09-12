package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageDeliveryKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageOriginKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillTargetCategoryConditionSemanticsTest {
    @Test
    void killCategoryCheckReadsTheKilledObjectAsCurrentTarget() {
        assertEquals("本次被击杀对象",
            SkillTriggerEventCapabilities.currentTargetBindings().get(SkillTriggerEventType.KILL));
    }

    @Test
    void damageDealtUsesTheCurrentInjuredTargetAndPendingOrTakenUseTheEventSource() {
        var bindings = SkillTriggerEventCapabilities.currentTargetBindings();
        assertFalse(SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.DAMAGE_DEALT));
        assertTrue(SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.DAMAGE_PENDING));
        assertTrue(SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.DAMAGE_TAKEN));
        assertEquals("本次伤害承受对象", bindings.get(SkillTriggerEventType.DAMAGE_DEALT));
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_HIT", "BASIC_ATTACK_HIT", "KILL", "DAMAGE_PENDING", "DAMAGE_DEALT", "DAMAGE_TAKEN"})
    void supportedEventOpponentCategoriesNeedNoCatalogOrExecutionReferences(String event) {
        List<Aggregate> objects = List.of(rule(event, "{\"categories\":[\"CHAMPION\",\"EPIC_MONSTER\"]}"));
        assertEquals(List.of(), SkillObjectReferences.extractAndValidate("lol", objects, Set.of()));
        assertDoesNotThrow(() -> SkillTargetCategoryConditionSemantics.validate(objects));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects, List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_USED", "RESULT_AVAILABLE", "BASIC_ATTACK_START"})
    void finalEventStateCannotRetainTargetCategoryCondition(String event) {
        ApiException error = assertThrows(ApiException.class, () -> SkillTargetCategoryConditionSemantics.validate(
            List.of(rule(event, "{\"categories\":[\"CHAMPION\"]}"))));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
        assertTrue(error.getDetails().toString().contains("conditionGroups[0].conditions[0].detail.categories"));
        assertTrue(error.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{}", "{\"categories\":[]}", "{\"categories\":[\"PET\"]}", "{\"categories\":[0]}",
        "{\"categories\":[\"CHAMPION\",\"CHAMPION\"]}", "{\"categories\":[\"CHAMPION\"],\"subject\":null}"})
    void finalShapeCannotSaveMissingUnknownDuplicateOrMixedCategories(String detail) {
        ApiException error = assertThrows(ApiException.class, () -> SkillTargetCategoryConditionSemantics.validate(List.of(rule("SKILL_HIT", detail))));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
    }

    static Aggregate rule(String event, String detail) {
        String eventDetail = switch (event) {
            case "DAMAGE_PENDING", "DAMAGE_DEALT", "DAMAGE_TAKEN"
                -> AggregateJson.write(new SkillTriggerDamageEventDetail(
                    null, SkillTriggerDamageDeliveryKind.ANY, SkillTriggerDamageOriginKind.ANY));
            default -> "{}";
        };
        return new Aggregate(SourceType.TRIGGER, "skill", "rule", AggregateJson.tree("""
            {"eventSource":{"eventType":"%s","detail":%s},"actions":[],
             "conditionGroups":[{"conditions":[{"conditionType":"TARGET_CATEGORY_CHECK","detail":%s}]}]}
            """.formatted(event, eventDetail, detail)));
    }
}
