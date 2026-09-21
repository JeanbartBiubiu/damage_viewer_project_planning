package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillHitTargetIsEnemyConditionSemanticsTest {

    @Test
    void enemyHitTargetNeedsNoCatalogNumericOrExecutionReference() {
        List<Aggregate> objects = List.of(rule("SKILL_HIT", "{}"));
        assertEquals(List.of(), SkillObjectReferences.extractAndValidate("lol", objects, Set.of()));
        assertDoesNotThrow(() -> SkillHitTargetIsEnemyConditionSemantics.validate(objects));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects, List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_USED", "BASIC_ATTACK_HIT", "SOURCE_INITIALIZED"})
    void finalAuthoringSnapshotRejectsEventsOtherThanSkillHit(String eventType) {
        ApiException error = assertThrows(
            ApiException.class,
            () -> SkillHitTargetIsEnemyConditionSemantics.validate(List.of(rule(eventType, "{}")))
        );
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
        assertTrue(error.getDetails().toString().contains("conditionGroups[0].conditions[0].detail"));
        assertTrue(error.getDetails().toString().contains("EVENT_VALUE_NOT_AVAILABLE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "[]", "true", "{\"targetKey\":null}"})
    void finalAuthoringSnapshotRejectsNonEmptyOrMalformedDetail(String detail) {
        ApiException error = assertThrows(
            ApiException.class,
            () -> SkillHitTargetIsEnemyConditionSemantics.validate(List.of(rule("SKILL_HIT", detail)))
        );
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
    }

    static Aggregate rule(String eventType, String detail) {
        String eventDetail = "SKILL_USED".equals(eventType) ? "{\"useKind\":\"ANY\"}" : "{}";
        return new Aggregate(SourceType.TRIGGER, "skill", "rule", AggregateJson.tree("""
            {"eventSource":{"eventType":"%s","detail":%s},"actions":[],
             "conditionGroups":[{"conditions":[{"conditionType":"SKILL_HIT_TARGET_IS_ENEMY","detail":%s}]}]}
            """.formatted(eventType, eventDetail, detail)));
    }
}
