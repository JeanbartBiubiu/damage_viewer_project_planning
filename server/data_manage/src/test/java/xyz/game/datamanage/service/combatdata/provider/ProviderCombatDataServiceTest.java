package xyz.game.datamanage.service.combatdata.provider;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatListenerMatchTypesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderFormulasMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderLifecyclesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderListenersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderModifiersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderStateFieldsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatProviderTickSequencesMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class ProviderCombatDataServiceTest {

    private static final String GAME_ID = "lol";
    private static final String PROVIDER_ID = "p1";
    private static final String STATE_KEY = "stacks";

    @Mock private GamesMapper gamesMapper;
    @Mock private GameDataRevisionService revisionService;
    @Mock private CombatProviderDefinitionsMapper providersMapper;
    @Mock private CombatProviderLifecyclesMapper lifecyclesMapper;
    @Mock private CombatProviderStateFieldsMapper stateFieldsMapper;
    @Mock private CombatProviderFormulasMapper formulasMapper;
    @Mock private CombatProviderModifiersMapper modifiersMapper;
    @Mock private CombatProviderListenersMapper listenersMapper;
    @Mock private CombatListenerMatchTypesMapper matchTypesMapper;
    @Mock private CombatProviderTickSequencesMapper tickSequencesMapper;

    private ProviderCombatDataService service;

    @BeforeEach
    void setUp() {
        CombatDataSupport support = new CombatDataSupport(new ObjectMapper(), gamesMapper, revisionService);
        service = new ProviderCombatDataService(
            support,
            revisionService,
            providersMapper,
            lifecyclesMapper,
            stateFieldsMapper,
            formulasMapper,
            modifiersMapper,
            listenersMapper,
            matchTypesMapper,
            tickSequencesMapper
        );
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listStateFieldsProjectsOptionalStackFieldsIncludingNulls() {
        when(revisionService.getCurrentRevision(GAME_ID)).thenReturn(3L);
        Map<String, Object> row = stateFieldRow(null, null, null);
        when(stateFieldsMapper.list(GAME_ID, PROVIDER_ID)).thenReturn(List.of(row));

        ObjectNode response = service.listStateFields(GAME_ID, PROVIDER_ID);

        assertEquals(3L, response.get("currentRevision").asLong());
        ObjectNode item = (ObjectNode) response.get("data").get(0);
        assertEquals(STATE_KEY, item.get("stateKey").asText());
        assertTrue(item.has("maxValue"));
        assertTrue(item.get("maxValue").isNull());
        assertTrue(item.has("durationMs"));
        assertTrue(item.get("durationMs").isNull());
        assertTrue(item.has("refreshPolicyTypeId"));
        assertTrue(item.get("refreshPolicyTypeId").isNull());
    }

    @Test
    void putStateFieldWritesOptionalFieldsAndReturnsProjection() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(9L);
        Map<String, Object> row = stateFieldRow(new BigDecimal("3"), 1500L, 20101);
        when(stateFieldsMapper.findById(GAME_ID, PROVIDER_ID, STATE_KEY)).thenReturn(row);

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("valueTypeId", 1);
        body.put("maxValue", 3);
        body.put("durationMs", 1500);
        body.put("refreshPolicyTypeId", 20101);

        ObjectNode response = service.putStateField(GAME_ID, PROVIDER_ID, STATE_KEY, body);

        assertEquals(9L, response.get("currentRevision").asLong());
        assertEquals(3, response.get("maxValue").decimalValue().intValue());
        assertEquals(1500L, response.get("durationMs").asLong());
        assertEquals(20101, response.get("refreshPolicyTypeId").asInt());
        verify(revisionService, times(1)).nextRevision(GAME_ID);
        verify(stateFieldsMapper).upsert(
            eq(GAME_ID),
            eq(9L),
            eq(PROVIDER_ID),
            eq(STATE_KEY),
            eq(1),
            eq(new BigDecimal("3")),
            eq(1500L),
            eq(20101)
        );
    }

    @Test
    void putStateFieldAllowsAllOptionalFieldsNull() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(4L);
        when(stateFieldsMapper.findById(GAME_ID, PROVIDER_ID, STATE_KEY))
            .thenReturn(stateFieldRow(null, null, null));

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("valueTypeId", 2);

        service.putStateField(GAME_ID, PROVIDER_ID, STATE_KEY, body);

        verify(stateFieldsMapper).upsert(
            eq(GAME_ID),
            eq(4L),
            eq(PROVIDER_ID),
            eq(STATE_KEY),
            eq(2),
            isNull(),
            isNull(),
            isNull()
        );
    }

    @Test
    void listLifecyclesProjectsOmittedTickAnchorPairAsNulls() {
        when(revisionService.getCurrentRevision(GAME_ID)).thenReturn(5L);
        when(lifecyclesMapper.list(GAME_ID, PROVIDER_ID)).thenReturn(List.of(lifecycleRow(null, null)));

        ObjectNode response = service.listLifecycles(GAME_ID, PROVIDER_ID);

        assertEquals(5L, response.get("currentRevision").asLong());
        ObjectNode item = (ObjectNode) response.get("data").get(0);
        assertTrue(item.has("tickAnchorScopeTypeId"));
        assertTrue(item.get("tickAnchorScopeTypeId").isNull());
        assertTrue(item.has("tickAnchorStateKey"));
        assertTrue(item.get("tickAnchorStateKey").isNull());
    }

    @Test
    void putLifecycleAcceptsOmittedPairAndCompletePair() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(21L);
        when(lifecyclesMapper.findById(GAME_ID, PROVIDER_ID)).thenReturn(lifecycleRow(null, null));

        ObjectNode omitted = JsonNodeFactory.instance.objectNode();
        omitted.put("maxStacks", 1);
        ObjectNode omittedResponse = service.putLifecycle(GAME_ID, PROVIDER_ID, omitted);
        assertTrue(omittedResponse.get("tickAnchorScopeTypeId").isNull());
        assertTrue(omittedResponse.get("tickAnchorStateKey").isNull());
        verify(lifecyclesMapper).upsert(
            eq(GAME_ID),
            eq(21L),
            eq(PROVIDER_ID),
            isNull(),
            eq(1),
            isNull(),
            isNull(),
            isNull(),
            isNull(),
            isNull()
        );

        when(revisionService.nextRevision(GAME_ID)).thenReturn(22L);
        when(lifecyclesMapper.findById(GAME_ID, PROVIDER_ID))
            .thenReturn(lifecycleRow(20252, "deadly_venom_stacks"));
        ObjectNode complete = JsonNodeFactory.instance.objectNode();
        complete.put("maxStacks", 1);
        complete.put("tickIntervalMs", 1000);
        complete.put("startDelayMs", 0);
        complete.put("tickAnchorScopeTypeId", 20252);
        complete.put("tickAnchorStateKey", "deadly_venom_stacks");
        ObjectNode completeResponse = service.putLifecycle(GAME_ID, PROVIDER_ID, complete);
        assertEquals(20252, completeResponse.get("tickAnchorScopeTypeId").asInt());
        assertEquals("deadly_venom_stacks", completeResponse.get("tickAnchorStateKey").asText());
        verify(lifecyclesMapper).upsert(
            eq(GAME_ID),
            eq(22L),
            eq(PROVIDER_ID),
            isNull(),
            eq(1),
            isNull(),
            eq(1000),
            eq(0),
            eq(20252),
            eq("deadly_venom_stacks")
        );
    }

    @Test
    void putLifecycleRejectsPartialTickAnchorPair() {
        ObjectNode scopeOnly = JsonNodeFactory.instance.objectNode();
        scopeOnly.put("tickAnchorScopeTypeId", 20252);
        ApiException scopeEx =
            assertThrows(ApiException.class, () -> service.putLifecycle(GAME_ID, PROVIDER_ID, scopeOnly));
        assertEquals("400.INVALID_BODY", scopeEx.getCode());
        assertTrue(scopeEx.getMessage().contains("tickAnchorScopeTypeId and tickAnchorStateKey"));

        ObjectNode keyOnly = JsonNodeFactory.instance.objectNode();
        keyOnly.put("tickAnchorStateKey", "deadly_venom_stacks");
        ApiException keyEx =
            assertThrows(ApiException.class, () -> service.putLifecycle(GAME_ID, PROVIDER_ID, keyOnly));
        assertEquals("400.INVALID_BODY", keyEx.getCode());

        verify(revisionService, never()).nextRevision(any());
        verify(lifecyclesMapper, never())
            .upsert(any(), anyLong(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    private static Map<String, Object> lifecycleRow(
        Integer tickAnchorScopeTypeId, String tickAnchorStateKey) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("providerId", PROVIDER_ID);
        row.put("durationFormulaKey", null);
        row.put("maxStacks", 1);
        row.put("refreshPolicyTypeId", null);
        row.put("tickIntervalMs", null);
        row.put("startDelayMs", null);
        row.put("tickAnchorScopeTypeId", tickAnchorScopeTypeId);
        row.put("tickAnchorStateKey", tickAnchorStateKey);
        row.put("changeRevision", 1L);
        return row;
    }

    private static Map<String, Object> stateFieldRow(BigDecimal maxValue, Long durationMs, Integer refreshPolicyTypeId) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("providerId", PROVIDER_ID);
        row.put("stateKey", STATE_KEY);
        row.put("valueTypeId", 1);
        row.put("maxValue", maxValue);
        row.put("durationMs", durationMs);
        row.put("refreshPolicyTypeId", refreshPolicyTypeId);
        row.put("changeRevision", 9L);
        return row;
    }
}
