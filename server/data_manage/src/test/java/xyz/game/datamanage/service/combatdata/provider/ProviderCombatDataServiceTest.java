package xyz.game.datamanage.service.combatdata.provider;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
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
    void putListenerForwardsPerCastThrottleMsWhenPresent() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(11L);
        when(listenersMapper.findById(GAME_ID, "listener-1")).thenReturn(listenerRow(1000));

        ObjectNode body = baseListenerBody();
        body.put("perCastThrottleMs", 1000);

        ObjectNode response = service.putListener(GAME_ID, "listener-1", body);

        assertEquals(11L, response.get("currentRevision").asLong());
        assertEquals(1000, response.get("perCastThrottleMs").asInt());
        verify(listenersMapper).upsert(
            eq(GAME_ID),
            eq(11L),
            eq("listener-1"),
            eq(PROVIDER_ID),
            eq("on_hit"),
            eq(20217),
            isNull(),
            isNull(),
            isNull(),
            eq(1000)
        );
    }

    @Test
    void putListenerForwardsNullPerCastThrottleWhenAbsentOrNull() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(12L);
        when(listenersMapper.findById(GAME_ID, "listener-1")).thenReturn(listenerRow(null));

        ObjectNode bodyAbsent = baseListenerBody();
        ObjectNode responseAbsent = service.putListener(GAME_ID, "listener-1", bodyAbsent);
        assertTrue(responseAbsent.get("perCastThrottleMs").isNull());
        verify(listenersMapper).upsert(
            eq(GAME_ID),
            eq(12L),
            eq("listener-1"),
            eq(PROVIDER_ID),
            eq("on_hit"),
            eq(20217),
            isNull(),
            isNull(),
            isNull(),
            isNull()
        );

        when(revisionService.nextRevision(GAME_ID)).thenReturn(13L);
        ObjectNode bodyNull = baseListenerBody();
        bodyNull.putNull("perCastThrottleMs");
        ObjectNode responseNull = service.putListener(GAME_ID, "listener-1", bodyNull);
        assertTrue(responseNull.get("perCastThrottleMs").isNull());
        verify(listenersMapper).upsert(
            eq(GAME_ID),
            eq(13L),
            eq("listener-1"),
            eq(PROVIDER_ID),
            eq("on_hit"),
            eq(20217),
            isNull(),
            isNull(),
            isNull(),
            isNull()
        );
    }

    private static ObjectNode baseListenerBody() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("providerId", PROVIDER_ID);
        body.put("listenerKey", "on_hit");
        body.put("eventTypeId", 20217);
        return body;
    }

    private static Map<String, Object> listenerRow(Integer perCastThrottleMs) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("listenerId", "listener-1");
        row.put("providerId", PROVIDER_ID);
        row.put("listenerKey", "on_hit");
        row.put("eventTypeId", 20217);
        row.put("abilityId", null);
        row.put("maxTriggersPerEvent", null);
        row.put("chainLimitKey", null);
        row.put("perCastThrottleMs", perCastThrottleMs);
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
