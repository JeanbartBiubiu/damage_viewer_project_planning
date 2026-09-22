package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUseScope;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class SkillTriggerOncePerUseSemanticsTest {

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"null"})
    void missingOrNullLimitIsOff(String raw) {
        String once = raw == null ? "" : "\"oncePerUse\":null,";
        Aggregate rule = trigger("skill", "rule", "BASIC_ATTACK_HIT", once);
        assertDoesNotThrow(() -> SkillTriggerOncePerUseSemantics.validate(List.of(rule)));
        List<SkillObjectReferences.Reference> refs = SkillObjectReferences.extractAndValidate("lol", List.of(rule), Set.of(effect()));
        assertTrue(refs.stream().noneMatch(ref -> ref.fieldPath().contains("oncePerUse") || "eclipse".equals(ref.target().key())));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(rule), List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_HIT", "BASIC_ATTACK_HIT", "BASIC_ATTACK_START"})
    void allowedEventsKeepSharedGroupAndDoNotIndexGroupKey(String eventType) {
        Aggregate first = trigger("skill", "a", eventType, once("eclipse", "SKILL"));
        Aggregate second = trigger("skill", "b", eventType, once("eclipse", "SKILL"));
        assertDoesNotThrow(() -> SkillTriggerOncePerUseSemantics.validate(List.of(first, second)));
        List<SkillObjectReferences.Reference> refs = SkillObjectReferences.extractAndValidate(
            "lol",
            List.of(first),
            Set.of(effect(), new Target(TargetType.SKILL, "", "eclipse", ""))
        );
        assertEquals(1, refs.size());
        assertEquals("actions[0].detail.effectKey", refs.get(0).fieldPath());
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(first), List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL_USED", "PROCESS_MOMENT", "SOURCE_INITIALIZED", "DAMAGE_DEALT"})
    void otherEventsAreRejectedByTheSharedValidator(String eventType) {
        ApiException error = assertThrows(
            ApiException.class,
            () -> SkillTriggerOncePerUseSemantics.validate(List.of(trigger("skill", "rule", eventType, once("eclipse", "TARGET"))))
        );
        assertEquals("409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("ONCE_PER_USE_EVENT_INVALID"));
        assertTrue(error.getDetails().toString().contains("limits.oncePerUse"));
    }

    @Test
    void sameSkillGroupMustShareScopeAndPointsAtTheOtherRule() {
        ApiException error = assertThrows(
            ApiException.class,
            () -> SkillTriggerOncePerUseSemantics.validate(List.of(
                trigger("skill", "first", "BASIC_ATTACK_HIT", once("eclipse", "SKILL")),
                trigger("skill", "second", "SKILL_HIT", once("eclipse", "TARGET"))
            ))
        );
        assertEquals("409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID", error.getCode());
        @SuppressWarnings("unchecked")
        List<Map<String, String>> issues = (List<Map<String, String>>) error.getDetails().get("fieldIssues");
        Map<String, String> issue = issues.stream()
            .filter(row -> "ONCE_PER_USE_SCOPE_CONFLICT".equals(row.get("code")))
            .findFirst()
            .orElseThrow();
        assertEquals("limits.oncePerUse.scope", issue.get("field"));
        assertEquals("first", issue.get("conflictingRuleKey"));
        assertEquals("second", issue.get("sourceKey"));
        assertEquals("skill", issue.get("sourceSkillKey"));
    }

    @Test
    void sameGroupNameOnDifferentSkillsIsIndependent() {
        assertDoesNotThrow(() -> SkillTriggerOncePerUseSemantics.validate(List.of(
            trigger("alpha", "rule", "BASIC_ATTACK_HIT", once("eclipse", "SKILL")),
            trigger("beta", "rule", "SKILL_HIT", once("eclipse", "TARGET"))
        )));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "[]",
        "true",
        "\"eclipse\"",
        "{\"scope\":\"SKILL\"}",
        "{\"groupKey\":\"\",\"scope\":\"SKILL\"}",
        "{\"groupKey\":\"Eclipse\",\"scope\":\"SKILL\"}",
        "{\"groupKey\":\"1bad\",\"scope\":\"SKILL\"}",
        "{\"groupKey\":\"abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklm\",\"scope\":\"SKILL\"}",
        "{\"groupKey\":\"eclipse\",\"scope\":\"PROVIDER\"}",
        "{\"groupKey\":\"eclipse\"}",
        "{\"groupKey\":\"eclipse\",\"scope\":\"SKILL\",\"quota\":1}"
    })
    void illegalShapeIsRejectedWithoutGuessingAGroup(String oncePerUse) {
        ApiException error = assertThrows(
            ApiException.class,
            () -> SkillTriggerOncePerUseSemantics.validate(List.of(
                trigger("skill", "rule", "BASIC_ATTACK_HIT", "\"oncePerUse\":" + oncePerUse + ",")
            ))
        );
        assertEquals("409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("limits.oncePerUse"));
    }

    @Test
    void dtoBlankGroupKeyIsRequiredLikeStoredEmptyText() {
        var parsed = SkillTriggerOncePerUseSemantics.fromDto(new SkillTriggerOncePerUse("  ", SkillTriggerOncePerUseScope.SKILL));
        List<Map<String, String>> issues = SkillTriggerOncePerUseSemantics.shapeIssues(parsed, "oncePerUse");
        assertEquals("oncePerUse.groupKey", issues.get(0).get("field"));
        assertEquals("REQUIRED", issues.get(0).get("code"));
        assertNull(SkillTriggerOncePerUseSemantics.member("rule", parsed));
    }

    private static Aggregate trigger(String skill, String key, String eventType, String once) {
        String detail = switch (eventType) {
            case "PROCESS_MOMENT" -> "{\"processKey\":\"cast\",\"moment\":{\"momentType\":\"PROCESS_START\"}}";
            case "SKILL_USED" -> "{\"useKind\":\"ANY\"}";
            default -> "{}";
        };
        return new Aggregate(SourceType.TRIGGER, skill, key, AggregateJson.tree("""
            {"eventSource":{"eventType":"%s","detail":%s},"conditionGroups":[],
             "actions":[{"actionKey":"deal","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"burst"}}],
             "limits":{%s"perTargetCooldown":null,"maxTriggersPerProcess":null}}
            """.formatted(eventType, detail, once)));
    }

    private static String once(String groupKey, String scope) {
        return "\"oncePerUse\":{\"groupKey\":\"%s\",\"scope\":\"%s\"},".formatted(groupKey, scope);
    }

    private static Target effect() {
        return new Target(TargetType.EFFECT, "skill", "burst", "");
    }
}
