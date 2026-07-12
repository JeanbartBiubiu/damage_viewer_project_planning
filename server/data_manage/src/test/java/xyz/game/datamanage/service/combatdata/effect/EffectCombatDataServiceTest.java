package xyz.game.datamanage.service.combatdata.effect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityControlEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhaseEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatDamageEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectStepsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEventEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatHealEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatListenerEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatResourceEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatShieldEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatStateEffectDetailsMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class EffectCombatDataServiceTest {

    private static final String GAME_ID = "lol";
    private static final String STEP_ID = "step-1";

    @Mock private GamesMapper gamesMapper;
    @Mock private GameDataRevisionService revisionService;
    @Mock private CombatEffectSequencesMapper sequencesMapper;
    @Mock private CombatEffectStepsMapper stepsMapper;
    @Mock private CombatAbilityPhaseEffectSequencesMapper phaseSequencesMapper;
    @Mock private CombatListenerEffectSequencesMapper listenerSequencesMapper;
    @Mock private CombatDamageEffectDetailsMapper damageDetailsMapper;
    @Mock private CombatHealEffectDetailsMapper healDetailsMapper;
    @Mock private CombatResourceEffectDetailsMapper resourceDetailsMapper;
    @Mock private CombatAttributeEffectDetailsMapper attributeDetailsMapper;
    @Mock private CombatShieldEffectDetailsMapper shieldDetailsMapper;
    @Mock private CombatProviderEffectDetailsMapper providerDetailsMapper;
    @Mock private CombatEventEffectDetailsMapper eventDetailsMapper;
    @Mock private CombatAbilityControlEffectDetailsMapper abilityControlDetailsMapper;
    @Mock private CombatStateEffectDetailsMapper stateDetailsMapper;

    private EffectCombatDataService service;

    @BeforeEach
    void setUp() {
        CombatDataSupport support = new CombatDataSupport(new ObjectMapper(), gamesMapper, revisionService);
        service = new EffectCombatDataService(
            support,
            revisionService,
            sequencesMapper,
            stepsMapper,
            phaseSequencesMapper,
            listenerSequencesMapper,
            damageDetailsMapper,
            healDetailsMapper,
            resourceDetailsMapper,
            attributeDetailsMapper,
            shieldDetailsMapper,
            providerDetailsMapper,
            eventDetailsMapper,
            abilityControlDetailsMapper,
            stateDetailsMapper
        );
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void putStepWritesCommonThenClearsOldDetailThenWritesNewDetailOnceRevision() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(11L);
        when(stepsMapper.findById(GAME_ID, STEP_ID)).thenReturn(stepRow());
        when(damageDetailsMapper.findById(GAME_ID, STEP_ID)).thenReturn(damageDetailRow());

        ObjectNode body = baseStepBody();
        ObjectNode damage = body.putObject(EffectCombatDataService.DETAIL_DAMAGE);
        damage.put("amountFormulaKey", "amt");
        damage.put("damageTypeId", 1);
        damage.put("valuePolicyTypeId", 2);

        ObjectNode response = service.putStep(GAME_ID, STEP_ID, body);

        assertEquals(11L, response.get("currentRevision").asLong());
        assertTrue(response.has(EffectCombatDataService.DETAIL_DAMAGE));
        verify(revisionService, times(1)).nextRevision(GAME_ID);

        InOrder order = inOrder(stepsMapper, damageDetailsMapper, healDetailsMapper);
        order.verify(stepsMapper).upsert(eq(GAME_ID), eq(11L), eq(STEP_ID), eq("seq-1"), eq(0), eq(10), eq(20), any());
        order.verify(damageDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(healDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        order.verify(damageDetailsMapper).upsert(eq(GAME_ID), eq(11L), eq(STEP_ID), eq("amt"), eq(1), eq(2));
        verify(healDetailsMapper, never()).upsert(any(), anyLong(), any(), any(), any());
    }

    @Test
    void putStepRejectsMultipleDetails() {
        ObjectNode body = baseStepBody();
        body.putObject(EffectCombatDataService.DETAIL_DAMAGE)
            .put("amountFormulaKey", "a")
            .put("damageTypeId", 1)
            .put("valuePolicyTypeId", 2);
        body.putObject(EffectCombatDataService.DETAIL_HEAL)
            .put("amountFormulaKey", "b")
            .put("valuePolicyTypeId", 2);

        ApiException ex = assertThrows(ApiException.class, () -> service.putStep(GAME_ID, STEP_ID, body));
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, never()).nextRevision(any());
        verify(stepsMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void putStepRejectsMissingDetail() {
        ObjectNode body = baseStepBody();
        ApiException ex = assertThrows(ApiException.class, () -> service.putStep(GAME_ID, STEP_ID, body));
        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    @Test
    void listStepsReturnsJoinedDetailDto() {
        when(revisionService.getCurrentRevision(GAME_ID)).thenReturn(4L);
        when(stepsMapper.list(GAME_ID, "seq-1")).thenReturn(List.of(stepRow()));
        when(healDetailsMapper.findById(GAME_ID, STEP_ID)).thenReturn(healDetailRow());

        ObjectNode response = service.listSteps(GAME_ID, "seq-1");

        assertEquals(4L, response.get("currentRevision").asLong());
        assertTrue(response.get("data").isArray());
        ObjectNode step = (ObjectNode) response.get("data").get(0);
        assertTrue(step.has(EffectCombatDataService.DETAIL_HEAL));
        assertFalse(step.has(EffectCombatDataService.DETAIL_DAMAGE));
    }

    private static ObjectNode baseStepBody() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("sequenceId", "seq-1");
        body.put("stepOrder", 0);
        body.put("operationTypeId", 10);
        body.put("targetSelectorTypeId", 20);
        return body;
    }

    private static Map<String, Object> stepRow() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("stepId", STEP_ID);
        row.put("sequenceId", "seq-1");
        row.put("stepOrder", 0);
        row.put("operationTypeId", 10);
        row.put("targetSelectorTypeId", 20);
        row.put("changeRevision", 11L);
        return row;
    }

    private static Map<String, Object> damageDetailRow() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("stepId", STEP_ID);
        row.put("amountFormulaKey", "amt");
        row.put("damageTypeId", 1);
        row.put("valuePolicyTypeId", 2);
        return row;
    }

    private static Map<String, Object> healDetailRow() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("stepId", STEP_ID);
        row.put("amountFormulaKey", "heal");
        row.put("valuePolicyTypeId", 2);
        return row;
    }
}
