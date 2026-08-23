package xyz.game.datamanage.service.combatdata.ability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityControlEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhaseEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhasesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatDamageEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectSequencesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEffectStepsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEventEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatExecuteEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatHealEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatRepeatEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatShieldEffectDetailsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatStateEffectDetailsMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class DirectDamageAbilitySetupServiceTest {

    private static final String GAME_ID = "lol";
    private static final String PROVIDER_ID = "provider_q";
    private static final String ABILITY_ID = "ability_q";
    private static final String PHASE_ID = "phase_q";
    private static final String SEQUENCE_ID = "seq_q";
    private static final String STEP_ID = "step_q";

    @Mock private GamesMapper gamesMapper;
    @Mock private GameDataRevisionService revisionService;
    @Mock private CombatAbilityDefinitionsMapper abilitiesMapper;
    @Mock private CombatAbilityPhasesMapper phasesMapper;
    @Mock private CombatEffectSequencesMapper sequencesMapper;
    @Mock private CombatEffectStepsMapper stepsMapper;
    @Mock private CombatAbilityPhaseEffectSequencesMapper phaseSequencesMapper;
    @Mock private CombatDamageEffectDetailsMapper damageDetailsMapper;
    @Mock private CombatHealEffectDetailsMapper healDetailsMapper;
    @Mock private CombatAttributeEffectDetailsMapper attributeDetailsMapper;
    @Mock private CombatShieldEffectDetailsMapper shieldDetailsMapper;
    @Mock private CombatProviderEffectDetailsMapper providerDetailsMapper;
    @Mock private CombatEventEffectDetailsMapper eventDetailsMapper;
    @Mock private CombatAbilityControlEffectDetailsMapper abilityControlDetailsMapper;
    @Mock private CombatStateEffectDetailsMapper stateDetailsMapper;
    @Mock private CombatRepeatEffectDetailsMapper repeatDetailsMapper;
    @Mock private CombatExecuteEffectDetailsMapper executeDetailsMapper;

    private DirectDamageAbilitySetupService service;

    @BeforeEach
    void setUp() {
        CombatDataSupport support = new CombatDataSupport(new ObjectMapper(), gamesMapper, revisionService);
        service = new DirectDamageAbilitySetupService(
            support,
            revisionService,
            abilitiesMapper,
            phasesMapper,
            sequencesMapper,
            stepsMapper,
            phaseSequencesMapper,
            damageDetailsMapper,
            healDetailsMapper,
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
    void rejectsUnknownTopLevelFieldBeforeRevisionAllocation() {
        ObjectNode body = validBody();
        body.put("extraField", "nope");

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putDirectDamageSetup(GAME_ID, PROVIDER_ID, ABILITY_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/extraField", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevisionIfExpected(any(), anyLong());
        verify(revisionService, never()).nextRevision(any());
        verify(abilitiesMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(), any(), any()
        );
    }

    @Test
    void rejectsProviderIdentityMismatchBeforeRevisionAllocation() {
        ObjectNode body = validBody();
        ((ObjectNode) body.get("ability")).put("providerId", "other");

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putDirectDamageSetup(GAME_ID, PROVIDER_ID, ABILITY_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/ability/providerId", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevisionIfExpected(any(), anyLong());
        verify(abilitiesMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(), any(), any()
        );
    }

    @Test
    void rejectsAbilityIdMismatchBeforeRevisionAllocation() {
        ObjectNode body = validBody();
        ((ObjectNode) body.get("ability")).put("abilityId", "other");

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putDirectDamageSetup(GAME_ID, PROVIDER_ID, ABILITY_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/ability/abilityId", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevisionIfExpected(any(), anyLong());
    }

    @Test
    void rejectsMissingDamageDetailBeforeRevisionAllocation() {
        ObjectNode body = validBody();
        ((ObjectNode) body.get("effectStep")).remove("damageDetail");

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putDirectDamageSetup(GAME_ID, PROVIDER_ID, ABILITY_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, never()).nextRevisionIfExpected(any(), anyLong());
        verify(stepsMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(), any()
        );
    }

    @Test
    void rejectsMultipleDetailFamiliesBeforeRevisionAllocation() {
        ObjectNode body = validBody();
        ((ObjectNode) body.get("effectStep")).putObject("healDetail")
            .put("amountFormulaKey", "h")
            .put("valuePolicyTypeId", 1);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putDirectDamageSetup(GAME_ID, PROVIDER_ID, ABILITY_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, never()).nextRevisionIfExpected(any(), anyLong());
        verify(damageDetailsMapper, never()).upsert(
            any(), anyLong(), any(), any(), anyInt(), anyInt(), anyBoolean(), anyBoolean()
        );
    }

    @Test
    void usesOneRevisionForAllPersistenceInFkOrder() {
        when(revisionService.nextRevisionIfExpected(GAME_ID, 42L)).thenReturn(43L);
        stubFindByIdRows(43L);

        ObjectNode response = service.putDirectDamageSetup(GAME_ID, PROVIDER_ID, ABILITY_ID, validBody());

        assertEquals(GAME_ID, response.get("gameId").asText());
        assertEquals(PROVIDER_ID, response.get("providerId").asText());
        assertEquals(ABILITY_ID, response.get("abilityId").asText());
        assertEquals(43L, response.get("currentRevision").asLong());
        assertTrue(response.get("effectStep").has("damageDetail"));
        assertEquals(false, response.get("effectStep").get("damageDetail").get("copyableOnHit").asBoolean());
        assertEquals(false, response.get("effectStep").get("damageDetail").get("critEligible").asBoolean());

        verify(revisionService, times(1)).nextRevisionIfExpected(GAME_ID, 42L);
        verify(revisionService, never()).nextRevision(any());

        InOrder order = inOrder(
            abilitiesMapper,
            phasesMapper,
            sequencesMapper,
            stepsMapper,
            damageDetailsMapper,
            healDetailsMapper,
            phaseSequencesMapper
        );
        order.verify(abilitiesMapper).upsert(
            eq(GAME_ID),
            eq(43L),
            eq(ABILITY_ID),
            eq(PROVIDER_ID),
            eq("q"),
            eq(1),
            eq("Q"),
            isNull(),
            isNull()
        );
        order.verify(phasesMapper).upsert(
            eq(GAME_ID),
            eq(43L),
            eq(PHASE_ID),
            eq(ABILITY_ID),
            eq(0),
            eq(2),
            isNull(),
            eq(true)
        );
        order.verify(sequencesMapper).upsert(
            eq(GAME_ID),
            eq(43L),
            eq(SEQUENCE_ID),
            eq(PROVIDER_ID),
            eq("seq_key"),
            isNull()
        );
        order.verify(stepsMapper).upsert(
            eq(GAME_ID),
            eq(43L),
            eq(STEP_ID),
            eq(SEQUENCE_ID),
            eq(0),
            eq(10),
            eq(20),
            isNull()
        );
        order.verify(damageDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        verify(healDetailsMapper).deleteByStepId(GAME_ID, STEP_ID);
        order.verify(damageDetailsMapper).upsert(
            eq(GAME_ID),
            eq(43L),
            eq(STEP_ID),
            eq("amt"),
            eq(1),
            eq(2),
            eq(false),
            eq(false)
        );
        order.verify(phaseSequencesMapper).upsert(eq(GAME_ID), eq(43L), eq(PHASE_ID), eq(5), eq(SEQUENCE_ID));
    }

    @Test
    void staleExpectedRevisionPerformsNoPersistence() {
        when(revisionService.nextRevisionIfExpected(GAME_ID, 42L)).thenThrow(
            new ApiException(
                org.springframework.http.HttpStatus.CONFLICT,
                "409.REVISION_CONFLICT",
                "expectedCurrentRevision does not match current revision",
                Map.of("expectedCurrentRevision", 42L, "actualCurrentRevision", 99L)
            )
        );

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putDirectDamageSetup(GAME_ID, PROVIDER_ID, ABILITY_ID, validBody())
        );
        assertEquals("409.REVISION_CONFLICT", ex.getCode());
        assertEquals(42L, ex.getDetails().get("expectedCurrentRevision"));
        assertEquals(99L, ex.getDetails().get("actualCurrentRevision"));
        verify(revisionService, times(1)).nextRevisionIfExpected(GAME_ID, 42L);
        verify(abilitiesMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(), any(), any()
        );
        verify(phasesMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(), anyBoolean()
        );
        verify(sequencesMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any());
        verify(stepsMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(), any()
        );
        verify(damageDetailsMapper, never()).upsert(
            any(), anyLong(), any(), any(), anyInt(), anyInt(), anyBoolean(), anyBoolean()
        );
        verify(phaseSequencesMapper, never()).upsert(any(), anyLong(), any(), anyInt(), any());
    }

    private void stubFindByIdRows(long revision) {
        when(abilitiesMapper.findById(GAME_ID, ABILITY_ID)).thenReturn(abilityRow(revision));
        when(phasesMapper.findById(GAME_ID, PHASE_ID)).thenReturn(phaseRow(revision));
        when(sequencesMapper.findById(GAME_ID, SEQUENCE_ID)).thenReturn(sequenceRow(revision));
        when(stepsMapper.findById(GAME_ID, STEP_ID)).thenReturn(stepRow(revision));
        when(damageDetailsMapper.findById(GAME_ID, STEP_ID)).thenReturn(damageRow(revision));
        when(phaseSequencesMapper.findById(GAME_ID, PHASE_ID, 5, SEQUENCE_ID))
            .thenReturn(bindingRow(revision));
    }

    private static ObjectNode validBody() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("expectedCurrentRevision", 42);

        ObjectNode ability = body.putObject("ability");
        ability.put("abilityId", ABILITY_ID);
        ability.put("providerId", PROVIDER_ID);
        ability.put("abilityKey", "q");
        ability.put("abilityKindTypeId", 1);
        ability.put("displayName", "Q");

        ObjectNode phase = body.putObject("phase");
        phase.put("phaseId", PHASE_ID);
        phase.put("abilityId", ABILITY_ID);
        phase.put("phaseOrder", 0);
        phase.put("phaseTypeId", 2);

        ObjectNode sequence = body.putObject("effectSequence");
        sequence.put("sequenceId", SEQUENCE_ID);
        sequence.put("providerId", PROVIDER_ID);
        sequence.put("sequenceKey", "seq_key");

        ObjectNode step = body.putObject("effectStep");
        step.put("stepId", STEP_ID);
        step.put("sequenceId", SEQUENCE_ID);
        step.put("stepOrder", 0);
        step.put("operationTypeId", 10);
        step.put("targetSelectorTypeId", 20);
        ObjectNode damage = step.putObject("damageDetail");
        damage.put("amountFormulaKey", "amt");
        damage.put("damageTypeId", 1);
        damage.put("valuePolicyTypeId", 2);

        ObjectNode binding = body.putObject("phaseEffectSequenceBinding");
        binding.put("phaseId", PHASE_ID);
        binding.put("triggerTypeId", 5);
        binding.put("sequenceId", SEQUENCE_ID);
        return body;
    }

    private static Map<String, Object> abilityRow(long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("abilityId", ABILITY_ID);
        row.put("providerId", PROVIDER_ID);
        row.put("abilityKey", "q");
        row.put("abilityKindTypeId", 1);
        row.put("displayName", "Q");
        row.put("changeRevision", revision);
        return row;
    }

    private static Map<String, Object> phaseRow(long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("phaseId", PHASE_ID);
        row.put("abilityId", ABILITY_ID);
        row.put("phaseOrder", 0);
        row.put("phaseTypeId", 2);
        row.put("interruptible", true);
        row.put("changeRevision", revision);
        return row;
    }

    private static Map<String, Object> sequenceRow(long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("sequenceId", SEQUENCE_ID);
        row.put("providerId", PROVIDER_ID);
        row.put("sequenceKey", "seq_key");
        row.put("changeRevision", revision);
        return row;
    }

    private static Map<String, Object> stepRow(long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("stepId", STEP_ID);
        row.put("sequenceId", SEQUENCE_ID);
        row.put("stepOrder", 0);
        row.put("operationTypeId", 10);
        row.put("targetSelectorTypeId", 20);
        row.put("changeRevision", revision);
        return row;
    }

    private static Map<String, Object> damageRow(long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("stepId", STEP_ID);
        row.put("amountFormulaKey", "amt");
        row.put("damageTypeId", 1);
        row.put("valuePolicyTypeId", 2);
        row.put("copyableOnHit", false);
        row.put("critEligible", false);
        row.put("changeRevision", revision);
        return row;
    }

    private static Map<String, Object> bindingRow(long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("phaseId", PHASE_ID);
        row.put("triggerTypeId", 5);
        row.put("sequenceId", SEQUENCE_ID);
        row.put("changeRevision", revision);
        return row;
    }
}
