package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
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
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

/** 冻结真实完整作者候选，覆盖聚合保存在所有对象落地后的额外规则复核入口。 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerNaturalCounterFinalGuardTest {
    private static final String GAME = "lol";
    private static final String SKILL = "neeko_w";
    @Mock GamesMapper games;
    @Mock SkillMapper skills;
    @Mock SkillTriggerRuleMapper mapper;
    private SkillTriggerRuleService service;
    private JsonNode candidate;

    @BeforeEach void setup() throws IOException {
        try (var input = getClass().getResourceAsStream("/authoring/neeko-w-final-guard.json")) {
            assertNotNull(input);
            candidate = AggregateJson.tree(new String(input.readAllBytes(), StandardCharsets.UTF_8).replaceFirst("^\\uFEFF", ""));
        }
        service = SkillTriggerRuleTestSupport.service(games, skills, mapper);
        when(mapper.listRulesForGame(GAME)).thenAnswer(ignored -> rows());
        when(mapper.lockInternalStates(eq(GAME), eq(SKILL), anyCollection())).thenAnswer(ignored -> {
            var state = candidate.path("expected").path("internalStates").get(0);
            return List.of(new SkillTriggerInternalStateLockRow(state.path("stateKey").asText(),
                SkillInternalStateType.valueOf(state.path("stateType").asText()), state.path("scope").asText()));
        });
    }

    @Test void theCompleteSceneInitializedCounterCandidatePassesTheActualFinalServiceRecheck() {
        JsonNode expected = candidate.path("expected");
        JsonNode state = expected.path("internalStates").get(0);
        assertEquals("SCENE_INITIAL_PARAMETER", state.path("detail").path("initialValueBinding").path("sourceType").asText());
        assertEquals("COUNTER", state.path("stateType").asText());
        assertEquals("SKILL", state.path("scope").asText());
        assertEquals(3, expected.path("triggerRules").size());
        assertEquals(2, expected.path("processes").size());
        for (JsonNode process : expected.path("processes")) {
            assertEquals("PASSIVE", process.path("activationType").asText());
            assertEquals("IMMEDIATE", process.path("steps").get(0).path("stepType").asText());
            assertEquals("hits", process.path("stateOperations").get(0).path("stateKey").asText());
        }
        assertDoesNotThrow(this::validateFinal);
        verify(mapper, times(3)).lockInternalStates(eq(GAME), eq(SKILL), eq(List.of("hits")));
    }

    @ParameterizedTest @ValueSource(strings = {"TARGET", "AMMO", "FLAG", "RECEIVED_EVENT"})
    void finalStateAndEventMutationsStillRejectAllThreeNaturalCounterReads(String scenario) {
        ObjectNode state = (ObjectNode) candidate.path("expected").path("internalStates").get(0);
        if (scenario.equals("TARGET")) state.put("scope", "TARGET");
        else if (scenario.equals("RECEIVED_EVENT")) candidate.path("expected").path("triggerRules").forEach(rule ->
            ((ObjectNode) rule.path("eventSource")).put("eventType", "BASIC_ATTACK_RECEIVED"));
        else state.put("stateType", scenario);
        var error = assertThrows(ApiException.class, this::validateFinal);
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", error.getCode());
        var issues = (List<?>) error.getDetails().get("fieldIssues");
        assertEquals(3, issues.size());
        assertTrue(issues.toString().contains("conditions[before].detail.valueKind"));
    }

    private void validateFinal() {
        service.validateAffectedConfigurationFinal(GAME, SKILL, changed("EFFECT"), changed("PROCESS"), changed("INTERNAL_STATE"));
    }

    private List<String> changed(String type) {
        var keys = new ArrayList<String>();
        for (JsonNode change : candidate.path("request").path("changes"))
            if (type.equals(change.path("objectType").asText())) keys.add(change.path("key").asText());
        return keys;
    }

    private List<SkillTriggerRuleRow> rows() {
        var rows = new ArrayList<SkillTriggerRuleRow>();
        OffsetDateTime time = OffsetDateTime.parse("2026-10-21T09:29:40Z");
        for (JsonNode rule : candidate.path("expected").path("triggerRules")) {
            rows.add(new SkillTriggerRuleRow(GAME, SKILL, rule.path("ruleKey").asText(), rule.path("name").asText(), null,
                rule.path("sortOrder").asInt(), SkillTriggerEventType.valueOf(rule.path("eventSource").path("eventType").asText()), time, time,
                rule.path("eventSource").toString(), rule.path("conditionGroups").toString(), rule.path("actions").toString(),
                "{\"perTargetCooldown\":null,\"maxTriggersPerProcess\":null,\"oncePerUse\":null}"));
        }
        return rows;
    }
}
