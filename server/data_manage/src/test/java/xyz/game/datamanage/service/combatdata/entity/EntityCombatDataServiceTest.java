package xyz.game.datamanage.service.combatdata.entity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityProviderMountsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityResourceStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityResourceValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameEntitiesMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class EntityCombatDataServiceTest {

    private static final String GAME_ID = "lol";

    @Mock private GamesMapper gamesMapper;
    @Mock private GameDataRevisionService revisionService;
    @Mock private CombatGameEntitiesMapper entitiesMapper;
    @Mock private CombatEntityAttributeValuesMapper attributeValuesMapper;
    @Mock private CombatEntityAttributeStageValuesMapper attributeStageValuesMapper;
    @Mock private CombatEntityResourceValuesMapper resourceValuesMapper;
    @Mock private CombatEntityResourceStageValuesMapper resourceStageValuesMapper;
    @Mock private CombatEntityProviderMountsMapper providerMountsMapper;

    private EntityCombatDataService service;

    @BeforeEach
    void setUp() {
        CombatDataSupport support = new CombatDataSupport(new ObjectMapper(), gamesMapper, revisionService);
        service = new EntityCombatDataService(
            support,
            revisionService,
            entitiesMapper,
            attributeValuesMapper,
            attributeStageValuesMapper,
            resourceValuesMapper,
            resourceStageValuesMapper,
            providerMountsMapper
        );
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listEntitiesReturnsRevisionEnvelope() {
        when(revisionService.getCurrentRevision(GAME_ID)).thenReturn(7L);
        when(entitiesMapper.list(GAME_ID)).thenReturn(List.of(entityRow("e1", "Hero", 3L)));

        ObjectNode response = service.listEntities(GAME_ID);

        assertEquals(GAME_ID, response.get("gameId").asText());
        assertEquals(7L, response.get("currentRevision").asLong());
        assertTrue(response.get("data").isArray());
        assertEquals("e1", response.get("data").get(0).get("entityId").asText());
    }

    @Test
    void getEntityReturnsObjectEnvelope() {
        when(revisionService.getCurrentRevision(GAME_ID)).thenReturn(2L);
        when(entitiesMapper.findById(GAME_ID, "e1")).thenReturn(entityRow("e1", "Hero", 2L));

        ObjectNode response = service.getEntity(GAME_ID, "e1");

        assertTrue(response.get("data").isObject());
        assertEquals("Hero", response.get("data").get("displayName").asText());
    }

    @Test
    void putEntityIncrementsRevisionOnceAndReturnsWriteObject() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(5L);
        when(entitiesMapper.findById(GAME_ID, "e1")).thenReturn(entityRow("e1", "Hero", 5L));
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("displayName", "Hero");

        ObjectNode response = service.putEntity(GAME_ID, "e1", body);

        assertEquals(5L, response.get("currentRevision").asLong());
        assertEquals("e1", response.get("entityId").asText());
        verify(revisionService, times(1)).nextRevision(GAME_ID);
        verify(entitiesMapper).upsert(eq(GAME_ID), eq(5L), eq("e1"), eq("Hero"), isNull());
    }

    @Test
    void putEntityRejectsServerManagedFields() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("displayName", "Hero");
        body.put("changeRevision", 9);

        ApiException ex = assertThrows(ApiException.class, () -> service.putEntity(GAME_ID, "e1", body));
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, times(0)).nextRevision(any());
    }

    private static Map<String, Object> entityRow(String entityId, String displayName, long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("entityId", entityId);
        row.put("displayName", displayName);
        row.put("description", null);
        row.put("changeRevision", revision);
        return row;
    }
}
