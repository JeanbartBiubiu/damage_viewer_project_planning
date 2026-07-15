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
import java.math.BigDecimal;
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
import xyz.game.datamanage.mapper.combatdata.CombatExecuteEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatHealEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatListenerEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatRepeatEffectDetailsMapper;
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
    @Mock private CombatRepeatEffectDetailsMapper repeatDetailsMapper;
    @Mock private CombatExecuteEffectDetailsMapper executeDetailsMapper;

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
            stateDetailsMapper,
            repeatDetailsMapper,
            executeDetailsMapper
        );
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void putStepWritesCommonThenClearsOldDetailThenWritesNewDetailOnceRevision() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(11L);
        when(stepsMapper.findById(GAME_ID, STEP_ID)).thenReturn(stepRow());
        when(damageDetailsMapper.findById(GAME_ID, STEP_ID)).thenReturn(damageDetailRow(false, false));

        ObjectNode body = baseStepBody();
        ObjectNode damage = body.putObject(EffectCombatDataService.DETAIL_DAMAGE);
        damage.put("amountFormulaKey", "amt");
        damage.put("damageTypeId", 1);
        damage.put("valuePolicyTypeId", 2);

        ObjectNode response = service.putStep(GAME_ID, STEP_ID, body);

        assertEquals(11L, response.get("currentRevision").asLong());
        assertTrue(response.has(EffectCombatDataService.DETAIL_DAMAGE));
        assertFalse(response.get(EffectCombatDataService.DETAIL_DAMAGE).get("copyableOnHit").asBoolean());
        assertFalse(response.get(EffectCombatDataService.DETAIL_DAMAGE).get("critEligible").asBoolean());
        verify(revisionService, times(1)).nextRevision(GAME_ID);

        InOrder order = inOrder(stepsMapper, damageDetailsMapper, healDetailsMapper, repeatDetailsMapper, executeDetailsMapper);
        order.verify(stepsMapper).upsert(eq(GAME_ID), eq(11L), eq(STEP_ID), eq("seq-1"), eq(0), eq(10), eq(20), any());
        order.verify(damageDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(healDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(repeatDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(executeDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        order.verify(damageDetailsMapper).upsert(
            eq(GAME_ID), eq(11L), eq(STEP_ID), eq("amt"), eq(1), eq(2), eq(false), eq(false));
        verify(healDetailsMapper, never()).upsert(any(), anyLong(), any(), any(), any());
        verify(repeatDetailsMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any(), any(), any());
        verify(executeDetailsMapper, never()).upsert(any(), anyLong(), any(), any());
    }

    @Test
    void putStepDamageDetailDefaultsCopyableOnHitFalseAndAcceptsTrue() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(12L);
        when(stepsMapper.findById(GAME_ID, STEP_ID)).thenReturn(stepRow());
        when(damageDetailsMapper.findById(GAME_ID, STEP_ID)).thenReturn(damageDetailRow(true, false));

        ObjectNode body = baseStepBody();
        ObjectNode damage = body.putObject(EffectCombatDataService.DETAIL_DAMAGE);
        damage.put("amountFormulaKey", "amt");
        damage.put("damageTypeId", 1);
        damage.put("valuePolicyTypeId", 2);
        damage.put("copyableOnHit", true);

        ObjectNode response = service.putStep(GAME_ID, STEP_ID, body);

        assertTrue(response.get(EffectCombatDataService.DETAIL_DAMAGE).get("copyableOnHit").asBoolean());
        assertFalse(response.get(EffectCombatDataService.DETAIL_DAMAGE).get("critEligible").asBoolean());
        verify(damageDetailsMapper).upsert(
            eq(GAME_ID), eq(12L), eq(STEP_ID), eq("amt"), eq(1), eq(2), eq(true), eq(false));
    }

    @Test
    void putStepDamageDetailDefaultsCritEligibleFalseAndAcceptsTrue() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(12L);
        when(stepsMapper.findById(GAME_ID, STEP_ID)).thenReturn(stepRow());
        when(damageDetailsMapper.findById(GAME_ID, STEP_ID)).thenReturn(damageDetailRow(false, true));

        ObjectNode body = baseStepBody();
        ObjectNode damage = body.putObject(EffectCombatDataService.DETAIL_DAMAGE);
        damage.put("amountFormulaKey", "amt");
        damage.put("damageTypeId", 1);
        damage.put("valuePolicyTypeId", 2);
        damage.put("critEligible", true);

        ObjectNode response = service.putStep(GAME_ID, STEP_ID, body);

        assertFalse(response.get(EffectCombatDataService.DETAIL_DAMAGE).get("copyableOnHit").asBoolean());
        assertTrue(response.get(EffectCombatDataService.DETAIL_DAMAGE).get("critEligible").asBoolean());
        verify(damageDetailsMapper).upsert(
            eq(GAME_ID), eq(12L), eq(STEP_ID), eq("amt"), eq(1), eq(2), eq(false), eq(true));
    }

    @Test
    void putStepWritesRepeatDetailAsTenthExactlyOneFamily() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(13L);
        when(stepsMapper.findById(GAME_ID, STEP_ID)).thenReturn(stepRow());
        when(repeatDetailsMapper.findById(GAME_ID, STEP_ID)).thenReturn(repeatDetailRow());

        ObjectNode body = baseStepBody();
        ObjectNode repeat = body.putObject(EffectCombatDataService.DETAIL_REPEAT);
        repeat.put("repeatScopeTypeId", 20263);
        repeat.put("repeatCount", 3);
        repeat.put("repeatTag", "on-hit");
        repeat.put("triggerStateKey", "stacks");
        repeat.put("threshold", 3);

        ObjectNode response = service.putStep(GAME_ID, STEP_ID, body);

        assertTrue(response.has(EffectCombatDataService.DETAIL_REPEAT));
        assertFalse(response.has(EffectCombatDataService.DETAIL_DAMAGE));
        verify(damageDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(repeatDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(repeatDetailsMapper).upsert(
            eq(GAME_ID),
            eq(13L),
            eq(STEP_ID),
            eq(20263),
            eq(3),
            eq("on-hit"),
            eq("stacks"),
            eq(new BigDecimal("3"))
        );
        verify(damageDetailsMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(Boolean.class), any(Boolean.class));
    }

    @Test
    void putStepWritesExecuteDetailAsEleventhExactlyOneFamily() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(14L);
        when(stepsMapper.findById(GAME_ID, STEP_ID)).thenReturn(stepRow());
        when(executeDetailsMapper.findById(GAME_ID, STEP_ID)).thenReturn(executeDetailRow());

        ObjectNode body = baseStepBody();
        ObjectNode execute = body.putObject(EffectCombatDataService.DETAIL_EXECUTE);
        execute.put("threshold", 0.05);

        ObjectNode response = service.putStep(GAME_ID, STEP_ID, body);

        assertTrue(response.has(EffectCombatDataService.DETAIL_EXECUTE));
        assertFalse(response.has(EffectCombatDataService.DETAIL_DAMAGE));
        assertFalse(response.has(EffectCombatDataService.DETAIL_REPEAT));
        verify(damageDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(repeatDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(executeDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(executeDetailsMapper).upsert(
            eq(GAME_ID),
            eq(14L),
            eq(STEP_ID),
            eq(new BigDecimal("0.05"))
        );
        verify(damageDetailsMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(Boolean.class), any(Boolean.class));
        verify(repeatDetailsMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void putStepRejectsExecuteThresholdOutOfRange() {
        ObjectNode body = baseStepBody();
        body.putObject(EffectCombatDataService.DETAIL_EXECUTE).put("threshold", 1.5);

        ApiException ex = assertThrows(ApiException.class, () -> service.putStep(GAME_ID, STEP_ID, body));
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, never()).nextRevision(any());
        verify(executeDetailsMapper, never()).upsert(any(), anyLong(), any(), any());
    }

    @Test
    void putStepRejectsExecuteThresholdZero() {
        ObjectNode body = baseStepBody();
        body.putObject(EffectCombatDataService.DETAIL_EXECUTE).put("threshold", 0);

        ApiException ex = assertThrows(ApiException.class, () -> service.putStep(GAME_ID, STEP_ID, body));
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, never()).nextRevision(any());
    }

    @Test
    void putStepRejectsDamageAndExecuteTogether() {
        ObjectNode body = baseStepBody();
        body.putObject(EffectCombatDataService.DETAIL_DAMAGE)
            .put("amountFormulaKey", "a")
            .put("damageTypeId", 1)
            .put("valuePolicyTypeId", 2);
        body.putObject(EffectCombatDataService.DETAIL_EXECUTE).put("threshold", 0.05);

        ApiException ex = assertThrows(ApiException.class, () -> service.putStep(GAME_ID, STEP_ID, body));
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, never()).nextRevision(any());
        verify(stepsMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void listExecuteEffectDetailsReturnsEnvelope() {
        when(revisionService.getCurrentRevision(GAME_ID)).thenReturn(7L);
        when(executeDetailsMapper.list(GAME_ID, null)).thenReturn(List.of(executeDetailRow()));

        ObjectNode response = service.listExecuteEffectDetails(GAME_ID, null);

        assertEquals(7L, response.get("currentRevision").asLong());
        assertEquals(STEP_ID, response.get("data").get(0).get("stepId").asText());
        assertEquals(0, new BigDecimal("0.05").compareTo(response.get("data").get(0).get("threshold").decimalValue()));
    }

    @Test
    void putExecuteEffectDetailWritesThresholdWithRevision() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(15L);
        when(executeDetailsMapper.findById(GAME_ID, STEP_ID)).thenReturn(executeDetailRow());

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("threshold", 0.05);

        ObjectNode response = service.putExecuteEffectDetail(GAME_ID, STEP_ID, body);

        assertEquals(15L, response.get("currentRevision").asLong());
        assertEquals(STEP_ID, response.get("stepId").asText());
        verify(executeDetailsMapper).upsert(eq(GAME_ID), eq(15L), eq(STEP_ID), eq(new BigDecimal("0.05")));
    }

    @Test
    void putExecuteEffectDetailRejectsNonFiniteThreshold() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("threshold", Double.POSITIVE_INFINITY);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putExecuteEffectDetail(GAME_ID, STEP_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, never()).nextRevision(any());
        verify(executeDetailsMapper, never()).upsert(any(), anyLong(), any(), any());
    }

    @Test
    void putStepRejectsDamageAndRepeatTogether() {
        ObjectNode body = baseStepBody();
        body.putObject(EffectCombatDataService.DETAIL_DAMAGE)
            .put("amountFormulaKey", "a")
            .put("damageTypeId", 1)
            .put("valuePolicyTypeId", 2);
        body.putObject(EffectCombatDataService.DETAIL_REPEAT)
            .put("repeatScopeTypeId", 20263)
            .put("repeatCount", 1)
            .put("repeatTag", "tag")
            .put("triggerStateKey", "k")
            .put("threshold", 1);

        ApiException ex = assertThrows(ApiException.class, () -> service.putStep(GAME_ID, STEP_ID, body));
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, never()).nextRevision(any());
        verify(stepsMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any(), any(), any());
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
        assertFalse(step.has(EffectCombatDataService.DETAIL_REPEAT));
        assertFalse(step.has(EffectCombatDataService.DETAIL_EXECUTE));
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

    private static Map<String, Object> damageDetailRow(boolean copyableOnHit, boolean critEligible) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("stepId", STEP_ID);
        row.put("amountFormulaKey", "amt");
        row.put("damageTypeId", 1);
        row.put("valuePolicyTypeId", 2);
        row.put("copyableOnHit", copyableOnHit);
        row.put("critEligible", critEligible);
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

    private static Map<String, Object> repeatDetailRow() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("stepId", STEP_ID);
        row.put("repeatScopeTypeId", 20263);
        row.put("repeatCount", 3);
        row.put("repeatTag", "on-hit");
        row.put("triggerStateKey", "stacks");
        row.put("threshold", new BigDecimal("3"));
        return row;
    }

    private static Map<String, Object> executeDetailRow() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("stepId", STEP_ID);
        row.put("threshold", new BigDecimal("0.05"));
        return row;
    }
}
