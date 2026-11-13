package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillProcessBehaviorSemanticsTest {
    @Test
    void finitePassiveDelayFindsAnExistingLeafThroughItsRealMomentRule() {
        assertDoesNotThrow(() -> validate(List.of(ProcessBehaviorTestData.waitProcess("waiter"),
            ProcessBehaviorTestData.rule("after", "waiter", "consume"), ProcessBehaviorTestData.leafProcess("consume"))));
    }

    @Test
    void severalFiniteProcessesCanReachTheSameRealLeafWithoutEvaluatingNumericConditions() {
        Aggregate rule = ProcessBehaviorTestData.rule("tail", "second", "consume");
        ((ObjectNode) rule.data()).set("conditionGroups", AggregateJson.tree("[{\"conditions\":[{\"detail\":{\"value\":0}}]}]"));
        assertDoesNotThrow(() -> validate(List.of(ProcessBehaviorTestData.waitProcess("first"),
            ProcessBehaviorTestData.waitProcess("second"), ProcessBehaviorTestData.leafProcess("consume"),
            ProcessBehaviorTestData.rule("first_tail", "first", "second"), rule)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"absent", "wrong_process", "wrong_step", "unknown_moment", "failure_only", "empty_actions", "missing_leaf"})
    void unrelatedOrUnreachableTailCannotProvideBehavior(String scenario) {
        Aggregate rule = ProcessBehaviorTestData.rule("after", "waiter", "consume");
        ObjectNode detail = (ObjectNode) rule.data().path("eventSource").path("detail");
        switch (scenario) {
            case "wrong_process" -> detail.put("processKey", "other");
            case "wrong_step" -> ((ObjectNode) detail.path("moment")).put("stepKey", "unknown");
            case "unknown_moment" -> ((ObjectNode) detail.path("moment")).put("momentType", "NOT_A_MOMENT");
            case "failure_only" -> ((ObjectNode) detail.path("moment")).put("momentType", "PROCESS_FAILURE");
            case "empty_actions" -> ((ObjectNode) rule.data()).putArray("actions");
            case "missing_leaf" -> ((ObjectNode) rule.data().path("actions").get(0).path("detail")).put("processKey", "missing");
            default -> { }
        }
        List<Aggregate> context = scenario.equals("absent")
            ? List.of(ProcessBehaviorTestData.waitProcess("waiter"), ProcessBehaviorTestData.leafProcess("consume"))
            : List.of(ProcessBehaviorTestData.waitProcess("waiter"), rule, ProcessBehaviorTestData.leafProcess("consume"));
        ApiException error = assertThrows(ApiException.class, () -> validate(context));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertTrue(error.getDetails().toString().contains("PROCESS_BEHAVIOR_REQUIRED"));
    }

    @Test
    void pureSelfAndMutualCyclesNeverAcquireARealLeaf() {
        for (List<Aggregate> context : List.of(
            List.of(ProcessBehaviorTestData.waitProcess("first"), ProcessBehaviorTestData.rule("self", "first", "first")),
            List.of(ProcessBehaviorTestData.waitProcess("first"), ProcessBehaviorTestData.waitProcess("second"),
                ProcessBehaviorTestData.rule("one", "first", "second"), ProcessBehaviorTestData.rule("two", "second", "first")))) {
            assertThrows(ApiException.class, () -> validate(context));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"occupying", "unknown_occupancy", "periodic"})
    void noDirectBehaviorOnlyOpensTheFiniteUnoccupiedPassiveVariant(String scenario) {
        Aggregate wait = ProcessBehaviorTestData.waitProcess("waiter");
        ObjectNode data = (ObjectNode) wait.data(), step = (ObjectNode) data.path("steps").get(0);
        switch (scenario) {
            case "occupying" -> step.put("occupiesAction", true);
            case "unknown_occupancy" -> step.remove("occupiesAction");
            case "periodic" -> step.put("stepType", "PERIODIC");
            default -> throw new AssertionError(scenario);
        }
        assertThrows(ApiException.class, () -> validate(List.of(wait,
            ProcessBehaviorTestData.rule("after", "waiter", "consume"), ProcessBehaviorTestData.leafProcess("consume"))));
    }

    @Test
    void anActiveProcessWithoutItsRequiredDirectBehaviorIsNotATransitiveLeaf() {
        Aggregate emptyActive = ProcessBehaviorTestData.waitProcess("active");
        ((ObjectNode) emptyActive.data()).put("activationType", "ACTIVE");
        assertThrows(ApiException.class, () -> validate(List.of(ProcessBehaviorTestData.waitProcess("waiter"),
            ProcessBehaviorTestData.rule("after", "waiter", "active"), emptyActive)));
    }

    @Test
    void effectAndStateLeavesMustExistAndEmptyEffectsDoNotCount() {
        Aggregate wait = ProcessBehaviorTestData.waitProcess("waiter");
        Aggregate rule = ProcessBehaviorTestData.rule("after", "waiter", "unused");
        ObjectNode action = (ObjectNode) rule.data().path("actions").get(0);
        action.put("actionType", "EXECUTE_EFFECT"); action.set("detail", AggregateJson.tree("{\"effectKey\":\"damage\"}"));
        Aggregate empty = new Aggregate(SourceType.EFFECT, ProcessBehaviorTestData.SKILL, "damage", AggregateJson.tree("{\"results\":[]}"));
        assertThrows(ApiException.class, () -> validate(List.of(wait, rule, empty)));
        Aggregate damage = new Aggregate(SourceType.EFFECT, ProcessBehaviorTestData.SKILL, "damage",
            AggregateJson.tree("{\"results\":[{\"resultType\":\"DAMAGE\"}]}"));
        assertDoesNotThrow(() -> validate(List.of(wait, rule, damage)));
        action.put("actionType", "MODIFY_INTERNAL_STATE");
        action.set("detail", AggregateJson.tree("{\"stateSkillKey\":\"caster_skill\",\"stateKey\":\"count\",\"operation\":\"SET\"}"));
        assertThrows(ApiException.class, () -> validate(List.of(wait, rule)));
        assertDoesNotThrow(() -> validate(List.of(wait, rule, new Aggregate(SourceType.STATE, ProcessBehaviorTestData.SKILL,
            "count", AggregateJson.tree("{\"stateType\":\"COUNTER\"}")))));
    }

    @Test
    void unrelatedSkillsAreContextRatherThanASecondGlobalAdmissionCheck() {
        assertDoesNotThrow(() -> SkillProcessBehaviorSemantics.validate(Set.of("unrelated"),
            List.of(ProcessBehaviorTestData.waitProcess("waiter"))));
    }

    private void validate(List<Aggregate> context) {
        SkillProcessBehaviorSemantics.validate(Set.of(ProcessBehaviorTestData.SKILL), context);
    }
}
