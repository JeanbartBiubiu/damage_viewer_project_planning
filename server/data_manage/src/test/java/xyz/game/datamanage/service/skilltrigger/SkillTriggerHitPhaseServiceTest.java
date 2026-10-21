package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerHitPhaseServiceTest {
    @Mock GamesMapper games;
    @Mock SkillMapper skills;
    @Mock SkillTriggerRuleMapper mapper;
    SkillTriggerRuleService service;

    @BeforeEach void setup() {
        stubParentAndCatalogs(games, skills, mapper);
        var shape = (ObjectNode) AggregateJson.tree(AggregateJson.write(processShape(PROCESS_KEY)));
        shape.put("activationType", "ACTIVE"); shape.put("stepKey", "hit"); shape.put("stepType", "DELAY");
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(AggregateJson.read(shape.toString(), SkillTriggerProcessShapeRow.class)));
        service = SkillTriggerRuleTestSupport.service(games, skills, mapper);
    }

    @Test void saveAndReadPreserveTheExplicitMomentAndNullDependency() {
        var event = event();
        var saved = service.create(GAME_ID, SKILL_KEY, rule("phase", event, List.of(executeAction("apply", EFFECT_KEY))));
        assertEquals(event, saved.eventSource());
        var read = service.get(GAME_ID, SKILL_KEY, "phase");
        var detail = (SkillTriggerSkillEventDetail) read.eventSource().detail();
        assertEquals("hit", detail.processMoment().moment().stepKey());
        assertNull(detail.processMoment().requiresPriorStepKey());
        assertTrue(AggregateJson.tree(mapper.findRule(GAME_ID, SKILL_KEY, "phase").eventSourceJson())
            .path("detail").path("processMoment").has("requiresPriorStepKey"));
        verify(mapper).lockProcesses(eq(GAME_ID), eq(SKILL_KEY), argThat(keys -> keys.size() == 1 && keys.contains(PROCESS_KEY)));
        verify(mapper).lockSteps(eq(GAME_ID), eq(SKILL_KEY), eq(PROCESS_KEY), eq(List.of("hit")));
    }

    @Test void legacyEventDetailBytesDoNotGainAnyNewField() {
        var event = AggregateJson.read("{\"eventType\":\"SKILL_HIT\",\"detail\":{\"sourceSkillKey\":\"" + SKILL_KEY + "\"}}", SkillTriggerEventSource.class);
        assertEquals("{\"eventType\":\"SKILL_HIT\",\"detail\":{\"sourceSkillKey\":\"" + SKILL_KEY + "\"}}", AggregateJson.write(event));
        assertThrows(IllegalStateException.class, () -> AggregateJson.read("{\"eventType\":\"SKILL_HIT\",\"detail\":{\"processMoment\":null}}", SkillTriggerEventSource.class));
    }

    @Test void stringTrueCanNameARealProcessAndStepWithoutAllowingBooleanIdentifiers() {
        var shape = (ObjectNode) AggregateJson.tree(AggregateJson.write(processShape("true")));
        shape.put("activationType", "ACTIVE").put("stepKey", "true").put("stepType", "DELAY");
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(AggregateJson.read(shape.toString(), SkillTriggerProcessShapeRow.class)));
        ObjectNode event = (ObjectNode) AggregateJson.tree(AggregateJson.write(event()));
        ObjectNode phase = (ObjectNode) event.path("detail").path("processMoment");
        phase.put("processKey", "true");
        ((ObjectNode) phase.path("moment")).put("stepKey", "true");
        var parsed = AggregateJson.read(event.toString(), SkillTriggerEventSource.class);
        assertDoesNotThrow(() -> service.create(GAME_ID, SKILL_KEY, rule("string_true", parsed, List.of(executeAction("apply", EFFECT_KEY)))));

        phase.put("processKey", true);
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(event.toString(), SkillTriggerEventSource.class));
        phase.put("processKey", "true");
        ((ObjectNode) phase.path("moment")).put("stepKey", true);
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(event.toString(), SkillTriggerEventSource.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"boolean_process", "number_process", "boolean_step", "number_step", "boolean_moment", "number_moment"})
    void newPhaseStringFieldsRejectOriginalScalarTypesBeforeConversion(String scenario) {
        ObjectNode event = (ObjectNode) AggregateJson.tree(AggregateJson.write(event()));
        ObjectNode phase = (ObjectNode) event.path("detail").path("processMoment");
        var value = AggregateJson.tree(scenario.startsWith("boolean") ? "true" : "4");
        if (scenario.endsWith("process")) phase.set("processKey", value);
        else ((ObjectNode) phase.path("moment")).set(scenario.endsWith("step") ? "stepKey" : "momentType", value);
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(event.toString(), SkillTriggerEventSource.class));
        verify(mapper, never()).insertRule(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing_prior", "blank_prior", "number_prior", "unknown_phase", "unknown_moment", "failure", "wrong_moment", "used", "foreign_source"})
    void rejectsIncompleteOrForeignPhaseDetails(String scenario) {
        ObjectNode event = (ObjectNode) AggregateJson.tree(AggregateJson.write(event()));
        ObjectNode phase = (ObjectNode) event.path("detail").path("processMoment");
        switch (scenario) {
            case "missing_prior" -> phase.remove("requiresPriorStepKey");
            case "blank_prior" -> phase.put("requiresPriorStepKey", " ");
            case "number_prior" -> phase.put("requiresPriorStepKey", 1);
            case "unknown_phase" -> phase.put("other", true);
            case "unknown_moment" -> ((ObjectNode) phase.path("moment")).put("other", true);
            case "failure" -> ((ObjectNode) phase.path("moment")).put("failureReason", "EVENT_ABORTED");
            case "wrong_moment" -> ((ObjectNode) phase.path("moment")).put("momentType", "PROCESS_COMPLETE");
            case "used" -> {
                event.put("eventType", "SKILL_USED");
                ((ObjectNode) event.path("detail")).put("useKind", "ACTIVE").put("castPhase", "INITIAL");
            }
            case "foreign_source" -> ((ObjectNode) event.path("detail")).put("sourceSkillKey", "other");
            default -> fail(scenario);
        }
        SkillTriggerEventSource parsed = AggregateJson.read(event.toString(), SkillTriggerEventSource.class);
        var error = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            rule("bad", parsed, List.of(executeAction("apply", EFFECT_KEY)))));
        assertTrue(error.getDetails().toString().contains(scenario.equals("foreign_source") ? "sourceSkillKey" : "processMoment"));
        verify(mapper, never()).insertRule(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    private static SkillTriggerEventSource event() {
        return AggregateJson.read("""
            {"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"%s","processMoment":{"processKey":"%s",
              "moment":{"momentType":"STEP_EXECUTION","stepKey":"hit"},"requiresPriorStepKey":null}}}
            """.formatted(SKILL_KEY, PROCESS_KEY), SkillTriggerEventSource.class);
    }
}
