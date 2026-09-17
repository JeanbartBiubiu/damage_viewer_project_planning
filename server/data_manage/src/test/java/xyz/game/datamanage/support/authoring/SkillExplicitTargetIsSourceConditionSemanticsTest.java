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

class SkillExplicitTargetIsSourceConditionSemanticsTest {

    @Test
    void skillUsedExplicitSelfTargetNeedsNoCatalogNumericOrExecutionReference() {
        List<Aggregate> objects = List.of(rule("SKILL_USED", "{}"));
        assertEquals(List.of(), SkillObjectReferences.extractAndValidate("lol", objects, Set.of()));
        assertDoesNotThrow(() -> SkillExplicitTargetIsSourceConditionSemantics.validate(objects));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects, List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_HIT", "BASIC_ATTACK_START", "SOURCE_INITIALIZED"})
    void finalAuthoringSnapshotRejectsEventsOtherThanSkillUsed(String eventType) {
        ApiException error = assertThrows(
            ApiException.class,
            () -> SkillExplicitTargetIsSourceConditionSemantics.validate(List.of(rule(eventType, "{}")))
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
            () -> SkillExplicitTargetIsSourceConditionSemantics.validate(List.of(rule("SKILL_USED", detail)))
        );
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
    }

    static Aggregate rule(String eventType, String detail) {
        String eventDetail = "SKILL_USED".equals(eventType) ? "{\"useKind\":\"ANY\"}" : "{}";
        return new Aggregate(SourceType.TRIGGER, "skill", "rule", AggregateJson.tree("""
            {"eventSource":{"eventType":"%s","detail":%s},"actions":[],
             "conditionGroups":[{"conditions":[{"conditionType":"EXPLICIT_TARGET_IS_SOURCE","detail":%s}]}]}
            """.formatted(eventType, eventDetail, detail)));
    }
}
