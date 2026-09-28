package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class ScopedAuthoringValidationTest {
    @Test
    void referencingAnExistingRootDoesNotValidateItsUnrelatedOldChildren() {
        Aggregate oldEffect = object(SourceType.EFFECT, "effect", """
            {"results":[{"resultType":"FUTURE_OR_OLD_SHAPE"}]}
            """);
        Reference root = new Reference("lol", "skill", SourceType.TRIGGER, "rule", "actions[0].effectKey",
            new Target(TargetType.EFFECT, "skill", "effect", ""));
        assertDoesNotThrow(() -> SkillObjectReferences.validateExistingTargets(List.of(root), List.of(oldEffect), Set.of()));
    }

    @Test
    void referencedChildMustStillExistUniquelyWithoutValidatingOtherChildren() {
        Aggregate effect = object(SourceType.EFFECT, "effect", """
            {"results":[{"resultKey":"hit"},{"oldUnrelatedField":true}]}
            """);
        Reference child = new Reference("lol", "skill", SourceType.TRIGGER, "rule", "sourceResultKey",
            new Target(TargetType.RESULT, "skill", "effect", "hit"));
        assertDoesNotThrow(() -> SkillObjectReferences.validateExistingTargets(List.of(child), List.of(effect), Set.of()));
        for (String results : List.of("[]", "[{\"resultKey\":\"hit\"},{\"resultKey\":\"hit\"}]")) {
            Aggregate invalid = object(SourceType.EFFECT, "effect", "{\"results\":" + results + "}");
            assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", assertThrows(ApiException.class,
                () -> SkillObjectReferences.validateExistingTargets(List.of(child), List.of(invalid), Set.of())).getCode());
        }
    }

    @Test
    void changedRuleStillRequiresInputsFromAnUnchangedEffect() {
        Aggregate effect = object(SourceType.EFFECT, "effect", """
            {"results":[{"resultKey":"heal","resultType":"DIRECT_HEAL",
              "valueRule":{"value":{"kind":"PARAMETER","parameterKey":"amount"}}}]}
            """);
        Aggregate rule = object(SourceType.TRIGGER, "rule", """
            {"eventSource":{"eventType":"SKILL_USED","detail":{"castPhase":"INITIAL"}},
             "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"effect"},
               "runtimeInputBindings":[]}]}
            """);
        Parameter parameter = new Parameter("skill", "amount", "DECIMAL", "RUNTIME_INPUT", null, null);
        ApiException error = assertThrows(ApiException.class,
            () -> SkillNumericSemantics.validate(List.of(rule), List.of(rule, effect), List.of(parameter), Map.of(), Map.of(), Map.of()));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        org.junit.jupiter.api.Assertions.assertTrue(error.getDetails().toString().contains("BINDING_MISSING"));
    }

    @Test
    void unrelatedInvalidNumericDefinitionIsOnlyContext() {
        Aggregate oldState = object(SourceType.STATE, "old_state", """
            {"stateType":"INTERNAL_COOLDOWN","detail":{"durationValue":{"kind":"FIXED","value":-10}}}
            """);
        Aggregate valid = object(SourceType.EFFECT, "valid", "{\"results\":[]}");
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(valid), List.of(valid, oldState), List.of(), Map.of(), Map.of(), Map.of()));
    }

    private static Aggregate object(SourceType type, String key, String json) {
        return new Aggregate(type, "skill", key, AggregateJson.tree(json));
    }
}
