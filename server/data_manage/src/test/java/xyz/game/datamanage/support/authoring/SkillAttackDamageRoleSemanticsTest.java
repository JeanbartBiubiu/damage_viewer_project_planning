package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillAttackDamageRoleSemanticsTest {
    static Aggregate effect(String role) {
        return object(SourceType.EFFECT, "hit", """
            {"lifecycle":null,"results":[{"resultKey":"hit","resultType":"DAMAGE","target":"TARGET",
              "detail":{"attackDamageRole":"%s","deliveryKind":"BASIC_ATTACK","originKind":"DIRECT"},
              "lifecycleBehavior":null,"valueRule":{"value":{"kind":"FIXED","value":0}}}]}
            """.formatted(role));
    }
    static Aggregate process() {
        return object(SourceType.PROCESS, "cast", """
            {"activationType":"ACTIVE","steps":[{"stepKey":"waiting","stepType":"EMPOWERED_BASIC_ATTACK",
             "detail":{"consumeMoment":"ATTACK_HIT","windowValue":{"kind":"FIXED","value":1000}}}],
             "effectBindings":[{"bindingKey":"hit","effectKey":"hit","moment":{"momentType":"STEP_EXECUTION","stepKey":"waiting"}}],
             "stateOperations":[]}
            """);
    }
    static Aggregate initial() {
        return object(SourceType.TRIGGER, "initial", """
            {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"renamed_skill","useKind":"ACTIVE","castPhase":"INITIAL"}},
             "conditionGroups":[{"conditions":[{"conditionType":"EXPLICIT_TARGET_IS_SOURCE","detail":{}}]}],
             "actions":[{"actionType":"START_PROCESS","detail":{"processKey":"cast"},"targetContext":"CURRENT_TARGET",
             "runtimeInputBindings":[],"resultModifiers":[]}]}
            """);
    }
    private static Aggregate object(SourceType type, String key, String json) {
        return new Aggregate(type, "renamed_skill", key, AggregateJson.tree(json));
    }
    private static void validate(List<Aggregate> values) {
        SkillAttackDamageRoleSemantics.validate(values, values);
    }

    @Test void standaloneRoleDataIsAllowedWithoutClaimingACompleteProgram() {
        assertDoesNotThrow(() -> validate(List.of(effect("PRIMARY"))));
        assertDoesNotThrow(() -> validate(List.of(effect("REPLACE_PRIMARY"))));
    }

    @Test void primaryKeepsOtherNonDamageResultsAndOtherParentActions() {
        Aggregate effect = effect("PRIMARY");
        ((ObjectNode) effect.data()).withArray("results").addObject().put("resultType", "HIT_LINK_APPLICATION");
        Aggregate rule = object(SourceType.TRIGGER, "on_hit", """
            {"eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},"conditionGroups":[],
             "actions":[{"actionType":"EXECUTE_EFFECT","detail":{"effectKey":"ordinary_before"},"targetContext":"CURRENT_TARGET"},
             {"actionType":"EXECUTE_EFFECT","detail":{"effectKey":"hit"},"targetContext":"CURRENT_TARGET","resultModifiers":[]},
             {"actionType":"EXECUTE_EFFECT","detail":{"effectKey":"ordinary_after"},"targetContext":"CURRENT_TARGET"}]}
            """);
        assertDoesNotThrow(() -> validate(List.of(effect, rule)));
    }

    @Test void onlyThePayloadIsRestrictedWhileStartOperationsRemainLegal() {
        Aggregate process = process();
        ((ObjectNode) process.data()).withArray("effectBindings").addObject().put("effectKey", "ordinary_start")
            .putObject("moment").put("momentType", "PROCESS_START");
        ((ObjectNode) process.data()).withArray("stateOperations").addObject().put("operation", "SET")
            .putObject("moment").put("momentType", "PROCESS_START");
        assertDoesNotThrow(() -> validate(List.of(effect("REPLACE_PRIMARY"), process, initial())));
    }

    @ParameterizedTest @ValueSource(strings = {"target", "delivery", "origin", "lifecycle", "behavior", "second_damage", "two_roles", "non_damage", "null", "unknown", "shield"})
    void roleEffectShapeIsStrict(String mutation) {
        Aggregate effect = effect("PRIMARY");
        ObjectNode data = (ObjectNode) effect.data();
        ObjectNode result = (ObjectNode) data.path("results").get(0);
        ObjectNode detail = (ObjectNode) result.path("detail");
        switch (mutation) {
            case "target" -> result.put("target", "SOURCE");
            case "delivery" -> detail.put("deliveryKind", "SKILL");
            case "origin" -> detail.put("originKind", "REFLECTED");
            case "lifecycle" -> data.putObject("lifecycle").put("durationValue", 10);
            case "behavior" -> result.putObject("lifecycleBehavior").put("moment", "PERIODIC");
            case "second_damage" -> data.withArray("results").addObject().put("resultType", "DAMAGE");
            case "two_roles" -> data.withArray("results").add(result.deepCopy());
            case "non_damage" -> result.put("resultType", "DIRECT_HEAL");
            case "null" -> detail.putNull("attackDamageRole");
            case "unknown" -> detail.put("attackDamageRole", "UNRECOGNIZED");
            case "shield" -> result.put("spellShieldBlockScope", "RESULT");
        }
        assertThrows(ApiException.class, () -> validate(List.of(effect)), mutation);
    }

    @Test void replaceCannotContainAnyOtherResultEvenANonDamageLink() {
        Aggregate effect = effect("REPLACE_PRIMARY");
        ((ObjectNode) effect.data()).withArray("results").addObject().put("resultType", "HIT_LINK_APPLICATION");
        assertThrows(ApiException.class, () -> validate(List.of(effect)));
    }

    @Test void replacementOwnShieldQualificationRemainsAvailable() {
        for (String scope : List.of("SKILL", "RESULT")) {
            Aggregate effect = effect("REPLACE_PRIMARY");
            ((ObjectNode) effect.data().path("results").get(0)).put("spellShieldBlockScope", scope);
            assertDoesNotThrow(() -> validate(List.of(effect, process(), initial())));
        }
    }

    @Test void primarySiblingResultsCannotConsumeShieldBeforeTheReplacementPayload() {
        Aggregate effect = effect("PRIMARY");
        ((ObjectNode) effect.data()).withArray("results").addObject().put("resultType", "HIT_LINK_APPLICATION")
            .put("spellShieldBlockScope", "RESULT");
        assertThrows(ApiException.class, () -> validate(List.of(effect)));
    }

    @ParameterizedTest @ValueSource(strings = {"passive", "delay", "start_consume", "second_step", "wrong_moment", "wrong_step", "extra_payload", "state_operation"})
    void changingAnExistingProcessRechecksItsFullFinalRoleContext(String mutation) {
        Aggregate effect = effect("REPLACE_PRIMARY");
        Aggregate process = process();
        ObjectNode data = (ObjectNode) process.data();
        ObjectNode step = (ObjectNode) data.path("steps").get(0);
        ObjectNode binding = (ObjectNode) data.path("effectBindings").get(0);
        switch (mutation) {
            case "passive" -> data.put("activationType", "PASSIVE");
            case "delay" -> step.put("stepType", "DELAY");
            case "start_consume" -> ((ObjectNode) step.path("detail")).put("consumeMoment", "ATTACK_START");
            case "second_step" -> data.withArray("steps").add(step.deepCopy());
            case "wrong_moment" -> ((ObjectNode) binding.path("moment")).put("momentType", "PROCESS_START");
            case "wrong_step" -> ((ObjectNode) binding.path("moment")).put("stepKey", "other");
            case "extra_payload" -> data.withArray("effectBindings").add(binding.deepCopy());
            case "state_operation" -> data.withArray("stateOperations").addObject().putObject("moment").put("momentType", "STEP_EXECUTION");
        }
        ApiException error = assertThrows(ApiException.class, () -> SkillAttackDamageRoleSemantics.validate(List.of(process), List.of(effect, process, initial())));
        assertTrue(error.getDetails().toString().contains("ATTACK_DAMAGE_ROLE_INVALID"));
    }

    @ParameterizedTest @ValueSource(strings = {"event", "skill", "phase", "kind", "advance", "arbitrary_condition", "direct_execute", "modifier"})
    void changingTheEntryCannotEscapeOwnInitialSelfCast(String mutation) {
        Aggregate rule = initial();
        ObjectNode event = (ObjectNode) rule.data().path("eventSource");
        ObjectNode detail = (ObjectNode) event.path("detail");
        ObjectNode action = (ObjectNode) rule.data().path("actions").get(0);
        switch (mutation) {
            case "event" -> event.put("eventType", "BASIC_ATTACK_HIT");
            case "skill" -> detail.put("sourceSkillKey", "other_skill");
            case "phase" -> detail.put("castPhase", "RECAST");
            case "kind" -> detail.put("useKind", "ANY");
            case "advance" -> action.put("actionType", "ADVANCE_PROCESS");
            case "arbitrary_condition" -> ((ObjectNode) rule.data().path("conditionGroups").get(0).path("conditions").get(0)).put("conditionType", "EVENT_VALUE_COMPARE");
            case "direct_execute" -> { action.put("actionType", "EXECUTE_EFFECT"); ((ObjectNode) action.path("detail")).put("effectKey", "hit"); }
            case "modifier" -> action.withArray("resultModifiers").addObject().put("anything", 1);
        }
        assertThrows(ApiException.class, () -> SkillAttackDamageRoleSemantics.validate(List.of(rule), List.of(effect("REPLACE_PRIMARY"), process(), rule)));
    }

    @Test void distinctSkillRoleDefinitionsAreNotAGlobalConflictAndUnrelatedChangesStayScoped() {
        List<Aggregate> values = new ArrayList<>(List.of(effect("REPLACE_PRIMARY"), process(), initial()));
        values.add(new Aggregate(SourceType.EFFECT, "another_skill", "hit", effect("REPLACE_PRIMARY").data().deepCopy()));
        assertDoesNotThrow(() -> validate(values));
        Aggregate invalid = effect("PRIMARY");
        ((ObjectNode) invalid.data().path("results").get(0)).put("target", "SOURCE");
        Aggregate unrelated = new Aggregate(SourceType.FORMULA, "other_skill", "formula", AggregateJson.tree("{}"));
        assertDoesNotThrow(() -> SkillAttackDamageRoleSemantics.validate(List.of(unrelated), List.of(invalid, unrelated)));
    }
}
