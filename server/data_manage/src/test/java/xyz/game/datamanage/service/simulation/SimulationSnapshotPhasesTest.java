package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Origin;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.PlannedSkill;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SkillSetting;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotPhasesTest {
    private static final String SPELL = "selected_spell";
    private SimulationSnapshotFixture fixture;
    private ObjectNode author;

    @BeforeEach
    void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", SPELL);
        fixture.attach("hero_b");
        author = (ObjectNode) fixture.json.readTree("""
            {"effects":[%s,%s],"processes":[{"processKey":"cast","activationType":"ACTIVE",
              "steps":[{"stepKey":"charge","stepType":"CHARGE","occupiesAction":true,
                "detail":{"minimumChargeValue":{"kind":"FIXED","value":0},"maximumChargeValue":{"kind":"FIXED","value":6000},"releaseAtMaximum":false}},
                {"stepKey":"recast","stepType":"RECAST","occupiesAction":false,
                 "detail":{"windowValue":{"kind":"FIXED","value":1000},"maximumRecastCountValue":{"kind":"FIXED","value":2}}}],
              "effectBindings":[],"stateOperations":[]}],"triggerRules":[
              {"ruleKey":"initial","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"selected_spell","castPhase":"INITIAL"}},
               "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"cast"},"runtimeInputBindings":[],"resultModifiers":[]}]},
              %s,%s,
              {"ruleKey":"cancel","eventSource":{"eventType":"PROCESS_CANCEL_REQUESTED","detail":{"processKey":"cast"}},"conditionGroups":[],
               "actions":[{"actionKey":"before","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"before"},"runtimeInputBindings":[],"resultModifiers":[]},
                {"actionKey":"fail","actionType":"FAIL_PROCESS","detail":{"processKey":"cast","failureReason":"ACTIVE_CANCELLED"},"runtimeInputBindings":[],"resultModifiers":[]}]},
              {"ruleKey":"failure","eventSource":{"eventType":"PROCESS_MOMENT","detail":{"processKey":"cast","moment":{"momentType":"PROCESS_FAILURE","failureReason":"ACTIVE_CANCELLED"}}},
               "conditionGroups":[],"actions":[{"actionKey":"tail","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"tail"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """.formatted(heal("before", "{\"kind\":\"FIXED\",\"value\":1}"), heal("tail", "{\"kind\":\"FIXED\",\"value\":2}"),
                advance("release", "CHARGE_RELEASE", "charge"), advance("recast", "RECAST", "recast")));
    }

    @Test
    void selectedPhasesKeepTheSameProcessFullCancelActionsAndFailureClosure() throws Exception {
        var result = snapshot("INITIAL", "RECAST", "CHARGE_RELEASE", "CANCEL");
        assertEquals(List.of("cancel", "initial", "recast", "release"), result.source().skillSources().getFirst().enabledRuleKeys());
        assertEquals(1, result.skillConfigurations().getFirst().processes().size());
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceKey().equals("cancel") && reference.targetKey().equals("before")));
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceKey().equals("failure") && reference.targetKey().equals("tail")));
        assertTrue(result.references().stream().anyMatch(reference -> reference.sourceKey().equals("release") && reference.targetSubKey().equals("charge")));
        assertEquals(2, result.skillConfigurations().getFirst().triggerRules().stream()
            .filter(rule -> rule.ruleKey().equals("cancel")).findFirst().orElseThrow().actions().size());
    }

    @Test
    void phaseSetsNormalizeForTheDigestButUnselectedControlRootsAreNotExecuted() throws Exception {
        var result = snapshot("INITIAL", "RECAST", "CHARGE_RELEASE", "CANCEL");
        assertEquals(result.snapshotDigest(), snapshot("CANCEL", "CHARGE_RELEASE", "RECAST", "INITIAL").snapshotDigest());
        var initial = snapshot("INITIAL");
        assertEquals(List.of("initial"), initial.source().skillSources().getFirst().enabledRuleKeys());
        assertFalse(initial.references().stream().anyMatch(reference -> List.of("release", "recast", "cancel").contains(reference.sourceKey())));
        assertNotEquals(initial.snapshotDigest(), result.snapshotDigest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"RECAST", "CHARGE_RELEASE", "CANCEL"})
    void eachRequestedPhaseNeedsItsOwnActualRoot(String phase) throws Exception {
        String key = phase.equals("RECAST") ? "recast" : phase.equals("CHARGE_RELEASE") ? "release" : "cancel";
        removeRule(key);
        assertIssue("PHASE_ROOT_MISSING", "phaseKinds[1]", "INITIAL", phase);
    }

    @ParameterizedTest
    @ValueSource(strings = {"release", "recast"})
    void foreignSourceControlCannotServeAsTheSelectedRoot(String key) throws Exception {
        ((ObjectNode) rule(key).path("eventSource").path("detail")).put("sourceSkillKey", "foreign_spell");
        assertIssue("PHASE_ROOT_MISSING", "phaseKinds[1]", "INITIAL", key.equals("release") ? "CHARGE_RELEASE" : "RECAST");
    }

    @Test
    void recastCannotReplaceTheChargeStepAndMissingStepReferencesRemainErrors() throws Exception {
        ((ObjectNode) rule("release").path("actions").get(0).path("detail")).put("stepKey", "recast");
        assertIssue("INVALID_STORED_DATA", "actions[0].detail.stepKey", "INITIAL", "CHARGE_RELEASE");
        ((ObjectNode) rule("release").path("actions").get(0).path("detail")).put("stepKey", "missing");
        assertIssue("REFERENCE_MISSING", "actions[0].detail.stepKey", "INITIAL", "CHARGE_RELEASE");
    }

    @Test
    void aDefinitionReferenceIsNotAnExecutableInitialProcess() throws Exception {
        rule("initial").withArray("actions").removeAll();
        rule("initial").withArray("actions").add(fixture.json.readTree("""
            {"actionKey":"effect","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"tail"},"runtimeInputBindings":[],"resultModifiers":[]}
            """));
        assertIssue("PHASE_PROCESS_MISSING", "phaseKinds", "INITIAL", "CHARGE_RELEASE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"CONTROLLED", "SOURCE_DIED", "EVENT_ABORTED"})
    void aDifferentFailureReasonDoesNotDeclareActiveCancellation(String reason) throws Exception {
        ((ObjectNode) rule("cancel").path("actions").get(1).path("detail")).put("failureReason", reason);
        assertIssue("CANCEL_ROOT_INVALID", "triggerRules.cancel.actions[1]", "INITIAL", "CANCEL");
    }

    @Test
    void cancelMustEndWithOneSameProcessFailureAndCannotSelectAnUnstartedProcess() throws Exception {
        ((ObjectNode) rule("cancel").path("actions").get(1).path("detail")).put("processKey", "other");
        assertIssue("CANCEL_ROOT_INVALID", "triggerRules.cancel.actions[1]", "INITIAL", "CANCEL");
        ((ObjectNode) rule("cancel").path("actions").get(1).path("detail")).put("processKey", "cast");
        rule("cancel").withArray("actions").add(rule("cancel").path("actions").get(0).deepCopy());
        assertIssue("CANCEL_ROOT_INVALID", "triggerRules.cancel.actions[2]", "INITIAL", "CANCEL");
        rule("cancel").withArray("actions").remove(2);
        ((ObjectNode) rule("cancel").path("eventSource").path("detail")).put("processKey", "other");
        assertIssue("PHASE_ROOT_MISSING", "phaseKinds[1]", "INITIAL", "CANCEL");
    }

    @Test
    void cancelConditionsAndEarlierActionReferencesCannotBeSilentlyDropped() throws Exception {
        rule("cancel").withArray("conditionGroups").add(fixture.json.readTree("""
            {"groupKey":"check","conditions":[{"conditionKey":"state","conditionType":"INTERNAL_STATE_CHECK",
              "detail":{"stateSkillKey":"selected_spell","stateKey":"missing_flag","valueKind":"ENABLED","expectedBoolean":true}}]}
            """));
        assertIssue("REFERENCE_MISSING", "conditionGroups[0].conditions[0].detail.stateKey", "INITIAL", "CANCEL");
        rule("cancel").withArray("conditionGroups").removeAll();
        ((ObjectNode) rule("cancel").path("actions").get(0).path("detail")).put("effectKey", "missing_before");
        assertIssue("REFERENCE_MISSING", "triggerRules.cancel.actions[0].detail.effectKey", "INITIAL", "CANCEL");
    }

    @Test
    void anExecutableSecondProcessBeforeCancellationIsRejectedRatherThanChosen() throws Exception {
        ObjectNode second = (ObjectNode) author.path("processes").get(0).deepCopy();
        second.put("processKey", "other");
        author.withArray("processes").add(second);
        ObjectNode before = (ObjectNode) rule("cancel").path("actions").get(0);
        before.put("actionType", "START_PROCESS");
        before.putObject("detail").put("processKey", "other");
        assertIssue("PHASE_PROCESS_AMBIGUOUS", "phaseKinds", "INITIAL", "CANCEL");
    }

    @Test
    void chargeHitInputRequiresTheActualReleaseRootInsideTheSelectedClosure() throws Exception {
        author.withArray("triggerRules").add(fixture.json.readTree("""
            {"ruleKey":"charged_hit","eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"selected_spell"}},
             "conditionGroups":[{"groupKey":"charge","conditions":[{"conditionKey":"elapsed","conditionType":"EVENT_VALUE_COMPARE",
               "detail":{"eventValueKey":"CHARGE_DURATION_MS","comparator":"GTE","comparisonValue":{"kind":"FIXED","value":0}}}]}],
             "actions":[{"actionKey":"hit","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"tail"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """));
        assertDoesNotThrow(() -> snapshot("INITIAL", "CHARGE_RELEASE"));
        assertIssue("INVALID_STORED_DATA", "conditionGroups[0].conditions[0].detail.eventValueKey", "INITIAL");
    }

    @Test
    void actualAutomaticChargeHitKeepsInitialOnlyWithoutAddingAReleaseRootOrInstruction() throws Exception {
        removeRule("release");
        removeRule("recast");
        var steps = (com.fasterxml.jackson.databind.node.ArrayNode) author.path("processes").get(0).path("steps");
        steps.remove(1);
        ((ObjectNode) steps.get(0).path("detail")).put("releaseAtMaximum", true);
        author.withArray("parameters").add(fixture.json.readTree("""
            {"parameterKey":"charge_ms","valueType":"DECIMAL","valueMode":"RUNTIME_INPUT"}
            """));
        author.withArray("formulas").add(fixture.json.readTree("""
            {"formulaKey":"charge_value","expression":{"nodeType":"PARAMETER","parameterKey":"charge_ms"}}
            """));
        author.withArray("effects").add(fixture.json.readTree(heal("charge_hit", "{\"kind\":\"FORMULA\",\"formulaKey\":\"charge_value\"}")));
        author.withArray("triggerRules").add(fixture.json.readTree("""
            {"ruleKey":"charged_hit","eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"selected_spell"}},
             "conditionGroups":[],"actions":[{"actionKey":"hit","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"charge_hit"},
              "runtimeInputBindings":[{"bindingKey":"duration","parameterKey":"charge_ms","sourceType":"EVENT_VALUE","detail":{"eventValueKey":"CHARGE_DURATION_MS"}}],"resultModifiers":[]}]}
            """));
        var result = snapshot("INITIAL");
        assertEquals(List.of("INITIAL"), result.selection().plannedSkills().getFirst().phaseKinds());
        assertEquals(List.of("charged_hit", "initial"), result.source().skillSources().getFirst().enabledRuleKeys());
        assertFalse(result.references().stream().anyMatch(reference -> reference.sourceKey().equals("release")));
        ((ObjectNode) steps.get(0).path("detail")).put("releaseAtMaximum", false);
        assertIssue("INVALID_STORED_DATA", "runtimeInputBindings[0].detail.eventValueKey", "INITIAL");
    }

    private SimulationSnapshotResponse snapshot(String... phases) throws Exception {
        fixture.configuration(SPELL, 2, author.toString());
        return fixture.service.get(GAME, choice(phases));
    }

    private Selection choice(String... phases) {
        Origin origin = Origin.character("hero_a");
        return new Selection("hero_a", 1, "hero_b", 2, null, null, List.of(), List.of(), List.of(), List.of(),
            List.of(new SkillSetting(origin, SPELL, true, 1)), List.of(), List.of(new PlannedSkill(origin, SPELL, 1, List.of(phases))));
    }

    private ObjectNode rule(String key) {
        return (ObjectNode) author.path("triggerRules").findParents("ruleKey").stream()
            .filter(row -> row.path("ruleKey").asText().equals(key)).findFirst().orElseThrow();
    }

    private void removeRule(String key) {
        var rules = author.withArray("triggerRules");
        for (int index = rules.size() - 1; index >= 0; index--) if (rules.get(index).path("ruleKey").asText().equals(key)) rules.remove(index);
    }

    private void assertIssue(String code, String path, String... phases) throws Exception {
        fixture.configuration(SPELL, 2, author.toString());
        ApiException error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, choice(phases)));
        assertTrue(error.getDetails().toString().contains(code), error.getDetails().toString());
        assertTrue(error.getDetails().toString().contains(path), error.getDetails().toString());
    }

    private static String advance(String key, String phase, String step) {
        return """
            {"ruleKey":"%s","eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"selected_spell","castPhase":"%s"}},
             "conditionGroups":[],"actions":[{"actionKey":"advance","actionType":"ADVANCE_PROCESS","detail":{"processKey":"cast","stepKey":"%s"},
              "runtimeInputBindings":[],"resultModifiers":[]}]}
            """.formatted(key, phase, step);
    }
}
