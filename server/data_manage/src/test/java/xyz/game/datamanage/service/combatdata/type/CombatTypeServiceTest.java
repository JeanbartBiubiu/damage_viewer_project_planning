package xyz.game.datamanage.service.combatdata.type;

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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.combatdata.CombatTypeRelationsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatTypesMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class CombatTypeServiceTest {

    private static final String GAME_ID = "lol";
    private static final String IMAGE_URI = "icons/attr.png";

    @Mock private GamesMapper gamesMapper;
    @Mock private ImagesMapper imagesMapper;
    @Mock private GameDataRevisionService revisionService;
    @Mock private CombatGameProgressionSchemaMapper progressionSchemaMapper;
    @Mock private CombatAttributeDefinitionsMapper attributeDefinitionsMapper;
    @Mock private CombatTypesMapper typesMapper;
    @Mock private CombatTypeRelationsMapper typeRelationsMapper;

    private CombatTypeService service;

    @BeforeEach
    void setUp() {
        CombatDataSupport support = new CombatDataSupport(new ObjectMapper(), gamesMapper, revisionService);
        service = new CombatTypeService(
            support,
            revisionService,
            imagesMapper,
            progressionSchemaMapper,
            attributeDefinitionsMapper,
            typesMapper,
            typeRelationsMapper
        );
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listAttributeDefinitionsReturnsEnvelope() {
        when(revisionService.getCurrentRevision(GAME_ID)).thenReturn(6L);
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("attrKey", "atk");
        row.put("changeRevision", 6L);
        when(attributeDefinitionsMapper.list(GAME_ID)).thenReturn(List.of(row));

        ObjectNode response = service.listAttributeDefinitions(GAME_ID);

        assertEquals(6L, response.get("currentRevision").asLong());
        assertTrue(response.get("data").isArray());
        assertEquals("atk", response.get("data").get(0).get("attrKey").asText());
    }

    @Test
    void putAttributeDefinitionIncrementsRevisionOnce() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(12L);
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("attrKey", "atk");
        row.put("changeRevision", 12L);
        when(attributeDefinitionsMapper.findById(GAME_ID, "atk")).thenReturn(row);

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("valueKind", "scalar");
        body.put("sortOrder", 1);

        ObjectNode response = service.putAttributeDefinition(GAME_ID, "atk", body);

        assertEquals(12L, response.get("currentRevision").asLong());
        verify(revisionService, times(1)).nextRevision(GAME_ID);
        verify(attributeDefinitionsMapper).upsert(
            eq(GAME_ID),
            eq(12L),
            eq("atk"),
            eq(1),
            eq(null),
            eq(null),
            eq(null),
            eq("scalar"),
            eq(null),
            eq(null),
            eq(null),
            isNull()
        );
    }

    @Test
    void putAttributeDefinitionAcceptsValidImageUriReference() {
        when(imagesMapper.findImageByUri(GAME_ID, IMAGE_URI)).thenReturn(Map.of("uri", IMAGE_URI));
        when(revisionService.nextRevision(GAME_ID)).thenReturn(13L);
        Map<String, Object> row = attrRow("atk", 13L, IMAGE_URI);
        when(attributeDefinitionsMapper.findById(GAME_ID, "atk")).thenReturn(row);

        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("valueKind", "scalar");
        body.put("imageUri", IMAGE_URI);

        service.putAttributeDefinition(GAME_ID, "atk", body);

        verify(attributeDefinitionsMapper).upsert(
            eq(GAME_ID),
            eq(13L),
            eq("atk"),
            eq(0),
            eq(null),
            eq(null),
            eq(null),
            eq("scalar"),
            eq(null),
            eq(null),
            eq(null),
            eq(IMAGE_URI)
        );
    }

    @Test
    void putAttributeDefinitionRejectsMissingImageBeforeRevision() {
        when(imagesMapper.findImageByUri(GAME_ID, IMAGE_URI)).thenReturn(null);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("imageUri", IMAGE_URI);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putAttributeDefinition(GAME_ID, "atk", body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/imageUri", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevision(any());
        verify(attributeDefinitionsMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        );
    }

    @Test
    void putAttributeDefinitionOmissionPreservesExistingImageUri() {
        when(attributeDefinitionsMapper.findById(GAME_ID, "atk")).thenReturn(attrRow("atk", 10L, IMAGE_URI));
        when(revisionService.nextRevision(GAME_ID)).thenReturn(11L);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("valueKind", "scalar");

        service.putAttributeDefinition(GAME_ID, "atk", body);

        verify(imagesMapper, never()).findImageByUri(any(), any());
        verify(attributeDefinitionsMapper).upsert(
            eq(GAME_ID),
            eq(11L),
            eq("atk"),
            eq(0),
            eq(null),
            eq(null),
            eq(null),
            eq("scalar"),
            eq(null),
            eq(null),
            eq(null),
            eq(IMAGE_URI)
        );
    }

    @Test
    void putAttributeDefinitionNullImageUriClearsAssociation() {
        when(attributeDefinitionsMapper.findById(GAME_ID, "atk")).thenReturn(attrRow("atk", 10L, IMAGE_URI));
        when(revisionService.nextRevision(GAME_ID)).thenReturn(11L);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.putNull("imageUri");

        service.putAttributeDefinition(GAME_ID, "atk", body);

        verify(attributeDefinitionsMapper).upsert(
            eq(GAME_ID),
            eq(11L),
            eq("atk"),
            eq(0),
            eq(null),
            eq(null),
            eq(null),
            eq("scalar"),
            eq(null),
            eq(null),
            eq(null),
            isNull()
        );
    }

    @Test
    void putAttributeDefinitionBlankImageUriClearsAssociation() {
        when(attributeDefinitionsMapper.findById(GAME_ID, "atk")).thenReturn(attrRow("atk", 10L, IMAGE_URI));
        when(revisionService.nextRevision(GAME_ID)).thenReturn(11L);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("imageUri", "  ");

        service.putAttributeDefinition(GAME_ID, "atk", body);

        verify(attributeDefinitionsMapper).upsert(
            eq(GAME_ID),
            eq(11L),
            eq("atk"),
            eq(0),
            eq(null),
            eq(null),
            eq(null),
            eq("scalar"),
            eq(null),
            eq(null),
            eq(null),
            isNull()
        );
    }

    @Test
    void putAttributeDefinitionRejectsNonTextImageUriBeforeRevision() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.putArray("imageUri").add("x");

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putAttributeDefinition(GAME_ID, "atk", body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/imageUri", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevision(any());
        verify(attributeDefinitionsMapper, never()).upsert(
            any(), anyLong(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        );
    }

    private static Map<String, Object> attrRow(String attrKey, long revision, String imageUri) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("attrKey", attrKey);
        row.put("changeRevision", revision);
        row.put("imageUri", imageUri);
        return row;
    }
}
