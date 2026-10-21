package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class SkillHitPhaseSemanticsTest {
    @Test void phaseGroupsUseActualStepOrderAndGenerateAllThreeReferences() {
        var context = valid();
        context.add(phase("last_extra", "third", "first"));
        var steps = (com.fasterxml.jackson.databind.node.ArrayNode) context.getFirst().data().path("steps");
        var third = steps.remove(2); steps.insert(0, third);
        assertDoesNotThrow(() -> SkillHitPhaseSemantics.validate(context, context));
        var references = SkillObjectReferences.extractAndValidate("lol", context, context,
            Set.of(new Target(TargetType.SKILL, "", "spell", "")));
        assertTrue(references.stream().anyMatch(r -> r.sourceKey().equals("last") && r.fieldPath().equals("eventSource.detail.processMoment.processKey")
            && r.target().equals(new Target(TargetType.PROCESS, "spell", "cast", ""))));
        assertTrue(references.stream().anyMatch(r -> r.sourceKey().equals("last") && r.fieldPath().equals("eventSource.detail.processMoment.moment.stepKey")
            && r.target().equals(new Target(TargetType.STEP, "spell", "cast", "third"))));
        assertTrue(references.stream().anyMatch(r -> r.sourceKey().equals("last") && r.fieldPath().equals("eventSource.detail.processMoment.requiresPriorStepKey")
            && r.target().equals(new Target(TargetType.STEP, "spell", "cast", "first"))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing_prior", "self", "forward", "unknown_prior", "deleted_prior_rule", "duplicate_sort", "missing_sort",
        "changed_step_type", "deleted_step", "passive", "no_initial", "other_initial", "two_initial", "foreign_source", "empty_source",
        "mixed", "wildcard_mixed", "inconsistent", "empty_phase", "wrong_moment", "unknown_phase_field", "unknown_moment_field", "null_phase", "too_many", "all_immediate"})
    void invalidFinalGraphsAreRejected(String scenario) {
        var context = valid();
        ObjectNode process = (ObjectNode) context.getFirst().data();
        ObjectNode last = (ObjectNode) context.getLast().data().path("eventSource").path("detail").path("processMoment");
        switch (scenario) {
            case "missing_prior" -> last.remove("requiresPriorStepKey");
            case "self" -> last.put("requiresPriorStepKey", "third");
            case "forward" -> ((ObjectNode) context.get(2).data().path("eventSource").path("detail").path("processMoment")).put("requiresPriorStepKey", "third");
            case "unknown_prior" -> last.put("requiresPriorStepKey", "foreign");
            case "deleted_prior_rule" -> context.remove(2);
            case "duplicate_sort" -> ((ObjectNode) process.path("steps").get(1)).put("sortOrder", 1);
            case "missing_sort" -> ((ObjectNode) process.path("steps").get(1)).remove("sortOrder");
            case "changed_step_type" -> ((ObjectNode) process.path("steps").get(1)).put("stepType", "PERIODIC");
            case "deleted_step" -> ((com.fasterxml.jackson.databind.node.ArrayNode) process.path("steps")).remove(0);
            case "passive" -> process.put("activationType", "PASSIVE");
            case "no_initial" -> context.remove(1);
            case "other_initial" -> ((ObjectNode) context.get(1).data().path("actions").get(0).path("detail")).put("processKey", "other");
            case "two_initial" -> ((com.fasterxml.jackson.databind.node.ArrayNode) context.get(1).data().path("actions"))
                .add(AggregateJson.tree("{\"actionType\":\"START_PROCESS\",\"detail\":{\"processKey\":\"other\"}}"));
            case "foreign_source" -> ((ObjectNode) context.getLast().data().path("eventSource").path("detail")).put("sourceSkillKey", "foreign");
            case "empty_source" -> ((ObjectNode) context.getLast().data().path("eventSource").path("detail")).putNull("sourceSkillKey");
            case "mixed", "wildcard_mixed" -> context.add(aggregate(SourceType.TRIGGER, "implicit",
                "{\"eventSource\":{\"eventType\":\"SKILL_HIT\",\"detail\":{\"sourceSkillKey\":"
                    + (scenario.equals("mixed") ? "\"spell\"" : "null") + "}},\"actions\":[{\"actionType\":\"FAIL_PROCESS\",\"detail\":{\"processKey\":\"cast\"}}]}"));
            case "inconsistent" -> context.add(phase("last_extra", "third", "second"));
            case "empty_phase" -> ((com.fasterxml.jackson.databind.node.ArrayNode) context.getLast().data().path("actions")).removeAll();
            case "wrong_moment" -> ((ObjectNode) last.path("moment")).put("momentType", "STEP_COMPLETE");
            case "unknown_phase_field" -> last.put("requiresPriorHitBindingKey", "first");
            case "unknown_moment_field" -> ((ObjectNode) last.path("moment")).put("extra", true);
            case "null_phase" -> ((ObjectNode) context.getLast().data().path("eventSource").path("detail")).putNull("processMoment");
            case "all_immediate" -> process.path("steps").forEach(step -> ((ObjectNode) step).put("stepType", "IMMEDIATE"));
            case "too_many" -> {
                var steps = (com.fasterxml.jackson.databind.node.ArrayNode) process.path("steps");
                for (int i = 3; i < 65; i++) steps.add(AggregateJson.tree("{\"stepKey\":\"s" + i + "\",\"stepType\":\"IMMEDIATE\",\"sortOrder\":" + i + "}"));
            }
            default -> fail(scenario);
        }
        var error = assertThrows(ApiException.class, () -> SkillHitPhaseSemantics.validate(context, context), scenario);
        assertEquals("409.SKILL_HIT_PHASE_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains("sourceSkillKey=spell"));
    }

    @Test void unrelatedLegacyAuthorsAndCrossAuthorListenersRetainTheirOwnMeaning() {
        var legacy = aggregate(SourceType.TRIGGER, "legacy", "{\"eventSource\":{\"eventType\":\"SKILL_HIT\",\"detail\":{}},\"actions\":[]}");
        assertDoesNotThrow(() -> SkillHitPhaseSemantics.validate(List.of(legacy), List.of(legacy)));
        var context = valid();
        context.add(new Aggregate(SourceType.TRIGGER, "passive", "listen", AggregateJson.tree("{\"eventSource\":{\"eventType\":\"SKILL_HIT\",\"detail\":{\"sourceSkillKey\":\"spell\"}},\"actions\":[]}")));
        assertDoesNotThrow(() -> SkillHitPhaseSemantics.validate(context, context));
    }

    @Test void singleImmediatePhaseAndLegacyImplicitProcessesRetainTheirExistingAdmission() {
        var single = valid();
        single.subList(3, single.size()).clear();
        var steps = (com.fasterxml.jackson.databind.node.ArrayNode) single.getFirst().data().path("steps");
        while (steps.size() > 1) steps.remove(steps.size() - 1);
        ((ObjectNode) steps.get(0)).put("stepType", "IMMEDIATE").set("detail", AggregateJson.tree("{}"));
        assertDoesNotThrow(() -> SkillHitPhaseSemantics.validate(single, single));

        var legacy = valid();
        legacy.getFirst().data().path("steps").forEach(step -> ((ObjectNode) step).put("stepType", "IMMEDIATE"));
        legacy.stream().filter(a -> a.type() == SourceType.TRIGGER && a.data().path("eventSource").path("eventType").asText().equals("SKILL_HIT"))
            .forEach(a -> ((ObjectNode) a.data().path("eventSource").path("detail")).remove("processMoment"));
        assertDoesNotThrow(() -> SkillHitPhaseSemantics.validate(legacy, legacy));
    }

    static ArrayList<Aggregate> valid() {
        var result = new ArrayList<Aggregate>();
        result.add(aggregate(SourceType.PROCESS, "cast", """
            {"activationType":"ACTIVE","steps":[
              {"stepKey":"first","stepType":"DELAY","sortOrder":1,"occupiesAction":true,"detail":{"delayValue":{"kind":"FIXED","value":250}}},
              {"stepKey":"second","stepType":"DELAY","sortOrder":2,"occupiesAction":false,"detail":{"delayValue":{"kind":"FIXED","value":750}}},
              {"stepKey":"third","stepType":"DELAY","sortOrder":3,"occupiesAction":false,"detail":{"delayValue":{"kind":"FIXED","value":750}}}],
             "effectBindings":[],"stateOperations":[]}
            """));
        result.add(aggregate(SourceType.TRIGGER, "start", """
            {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"spell","useKind":"ACTIVE","castPhase":"INITIAL"}},
             "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"cast"}}]}
            """));
        result.add(phase("first", "first", null)); result.add(phase("second", "second", "first")); result.add(phase("last", "third", "first"));
        return result;
    }

    private static Aggregate phase(String key, String step, String prior) {
        return aggregate(SourceType.TRIGGER, key, """
            {"eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"spell","processMoment":{"processKey":"cast",
              "moment":{"momentType":"STEP_EXECUTION","stepKey":"%s"},"requiresPriorStepKey":%s}}},
             "conditionGroups":[],"actions":[{"actionKey":"apply","actionType":"FAIL_PROCESS","detail":{"processKey":"cast"}}]}
            """.formatted(step, prior == null ? "null" : "\"" + prior + "\""));
    }
    private static Aggregate aggregate(SourceType type, String key, String data) { return new Aggregate(type, "spell", key, AggregateJson.tree(data)); }
}
