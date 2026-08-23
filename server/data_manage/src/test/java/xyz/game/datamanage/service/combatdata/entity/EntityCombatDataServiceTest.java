package xyz.game.datamanage.service.combatdata.entity;

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
import com.fasterxml.jackson.databind.node.ArrayNode;
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
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeStageValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityAttributeValuesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatEntityProviderMountsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatGameEntitiesMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class EntityCombatDataServiceTest {

    private static final String GAME_ID = "lol";
    private static final String ENTITY_ID = "e1";
    private static final String IMAGE_URI = "icons/hero.png";

    @Mock private GamesMapper gamesMapper;
    @Mock private ImagesMapper imagesMapper;
    @Mock private GameDataRevisionService revisionService;
    @Mock private CombatGameEntitiesMapper entitiesMapper;
    @Mock private CombatEntityAttributeValuesMapper attributeValuesMapper;
    @Mock private CombatEntityAttributeStageValuesMapper attributeStageValuesMapper;
    @Mock private CombatEntityProviderMountsMapper providerMountsMapper;

    private EntityCombatDataService service;

    @BeforeEach
    void setUp() {
        CombatDataSupport support = new CombatDataSupport(new ObjectMapper(), gamesMapper, revisionService);
        service = new EntityCombatDataService(
            support,
            revisionService,
            imagesMapper,
            entitiesMapper,
            attributeValuesMapper,
            attributeStageValuesMapper,
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
        verify(entitiesMapper).upsert(eq(GAME_ID), eq(5L), eq("e1"), eq("Hero"), isNull(), isNull());
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

    @Test
    void putEntityAcceptsValidImageUriReference() {
        when(imagesMapper.findImageByUri(GAME_ID, IMAGE_URI)).thenReturn(Map.of("uri", IMAGE_URI));
        when(revisionService.nextRevision(GAME_ID)).thenReturn(6L);
        when(entitiesMapper.findById(GAME_ID, "e1")).thenReturn(entityRow("e1", "Hero", 6L, IMAGE_URI));
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("displayName", "Hero");
        body.put("imageUri", IMAGE_URI);

        service.putEntity(GAME_ID, "e1", body);

        verify(entitiesMapper).upsert(eq(GAME_ID), eq(6L), eq("e1"), eq("Hero"), isNull(), eq(IMAGE_URI));
    }

    @Test
    void putEntityRejectsMissingImageBeforeRevision() {
        when(imagesMapper.findImageByUri(GAME_ID, IMAGE_URI)).thenReturn(null);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("displayName", "Hero");
        body.put("imageUri", IMAGE_URI);

        ApiException ex = assertThrows(ApiException.class, () -> service.putEntity(GAME_ID, "e1", body));
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/imageUri", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevision(any());
        verify(entitiesMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any());
    }

    @Test
    void putEntityOmissionPreservesExistingImageUri() {
        when(entitiesMapper.findById(GAME_ID, "e1")).thenReturn(entityRow("e1", "Hero", 4L, IMAGE_URI));
        when(revisionService.nextRevision(GAME_ID)).thenReturn(5L);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("displayName", "Hero");

        service.putEntity(GAME_ID, "e1", body);

        verify(imagesMapper, never()).findImageByUri(any(), any());
        verify(entitiesMapper).upsert(eq(GAME_ID), eq(5L), eq("e1"), eq("Hero"), isNull(), eq(IMAGE_URI));
    }

    @Test
    void putEntityNullImageUriClearsAssociation() {
        when(entitiesMapper.findById(GAME_ID, "e1")).thenReturn(entityRow("e1", "Hero", 4L, IMAGE_URI));
        when(revisionService.nextRevision(GAME_ID)).thenReturn(5L);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("displayName", "Hero");
        body.putNull("imageUri");

        service.putEntity(GAME_ID, "e1", body);

        verify(entitiesMapper).upsert(eq(GAME_ID), eq(5L), eq("e1"), eq("Hero"), isNull(), isNull());
    }

    @Test
    void putEntityBlankImageUriClearsAssociation() {
        when(entitiesMapper.findById(GAME_ID, "e1")).thenReturn(entityRow("e1", "Hero", 4L, IMAGE_URI));
        when(revisionService.nextRevision(GAME_ID)).thenReturn(5L);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("displayName", "Hero");
        body.put("imageUri", "   ");

        service.putEntity(GAME_ID, "e1", body);

        verify(entitiesMapper).upsert(eq(GAME_ID), eq(5L), eq("e1"), eq("Hero"), isNull(), isNull());
    }

    @Test
    void putEntityRejectsNonTextImageUriBeforeRevision() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("displayName", "Hero");
        body.put("imageUri", 12);

        ApiException ex = assertThrows(ApiException.class, () -> service.putEntity(GAME_ID, "e1", body));
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/imageUri", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevision(any());
        verify(entitiesMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any());
    }

    @Test
    void putEntityBatchFailsValidationBeforeRevisionAllocation() {
        ObjectNode body = validBatchBody();
        body.put("extraField", "nope");

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putEntityBatch(GAME_ID, ENTITY_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/extraField", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevisionIfExpected(any(), anyLong());
        verify(revisionService, never()).nextRevision(any());
        verify(entitiesMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any());
    }

    @Test
    void putEntityBatchRejectsIncompleteStagesBeforeRevisionAllocation() {
        ObjectNode body = validBatchBody();
        ArrayNode stages = JsonNodeFactory.instance.arrayNode();
        stages.addObject().put("stage", 1).put("value", 100);
        ((ObjectNode) body.get("attributes").get(0)).set("stages", stages);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putEntityBatch(GAME_ID, ENTITY_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(revisionService, never()).nextRevisionIfExpected(any(), anyLong());
        verify(attributeValuesMapper, never()).upsert(any(), anyLong(), any(), any(), any());
    }

    @Test
    void putEntityBatchUsesOneRevisionForAllMapperCalls() {
        when(revisionService.nextRevisionIfExpected(GAME_ID, 42L)).thenReturn(43L);
        when(entitiesMapper.findById(GAME_ID, ENTITY_ID)).thenReturn(entityRow(ENTITY_ID, "Example", 43L));
        when(attributeValuesMapper.findById(GAME_ID, ENTITY_ID, "hp"))
            .thenReturn(attrRow("hp", new BigDecimal("600"), 43L));
        when(attributeStageValuesMapper.list(GAME_ID, ENTITY_ID, "hp"))
            .thenReturn(List.of(attrStageRow("hp", 1, new BigDecimal("600"), 43L)));
        when(providerMountsMapper.findById(GAME_ID, ENTITY_ID, "provider_example"))
            .thenReturn(mountRow("provider_example", 43L));

        ObjectNode response = service.putEntityBatch(GAME_ID, ENTITY_ID, validBatchBody());

        assertEquals(GAME_ID, response.get("gameId").asText());
        assertEquals(ENTITY_ID, response.get("entityId").asText());
        assertEquals(43L, response.get("currentRevision").asLong());
        assertEquals(1, response.get("attributes").size());
        assertEquals(1, response.get("providerMounts").size());

        verify(revisionService, times(1)).nextRevisionIfExpected(GAME_ID, 42L);
        verify(revisionService, never()).nextRevision(any());
        verify(entitiesMapper).upsert(
            eq(GAME_ID), eq(43L), eq(ENTITY_ID), eq("Example"), eq("optional"), isNull()
        );
        verify(attributeValuesMapper).upsert(
            eq(GAME_ID), eq(43L), eq(ENTITY_ID), eq("hp"), eq(new BigDecimal("600"))
        );
        verify(attributeStageValuesMapper, times(18)).upsert(
            eq(GAME_ID), eq(43L), eq(ENTITY_ID), eq("hp"), any(), any()
        );
        verify(providerMountsMapper).upsert(eq(GAME_ID), eq(43L), eq(ENTITY_ID), eq("provider_example"));
    }

    @Test
    void putEntityBatchStaleExpectedRevisionNeitherIncrementsNorWrites() {
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
            () -> service.putEntityBatch(GAME_ID, ENTITY_ID, validBatchBody())
        );
        assertEquals("409.REVISION_CONFLICT", ex.getCode());
        verify(revisionService, times(1)).nextRevisionIfExpected(GAME_ID, 42L);
        verify(entitiesMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any());
        verify(attributeValuesMapper, never()).upsert(any(), anyLong(), any(), any(), any());
        verify(providerMountsMapper, never()).upsert(any(), anyLong(), any(), any());
    }

    @Test
    void putEntityBatchAcceptsValidImageUriReference() {
        when(imagesMapper.findImageByUri(GAME_ID, IMAGE_URI)).thenReturn(Map.of("uri", IMAGE_URI));
        when(revisionService.nextRevisionIfExpected(GAME_ID, 42L)).thenReturn(43L);
        when(entitiesMapper.findById(GAME_ID, ENTITY_ID)).thenReturn(entityRow(ENTITY_ID, "Example", 43L));
        ObjectNode body = validBatchBody();
        body.put("imageUri", IMAGE_URI);

        service.putEntityBatch(GAME_ID, ENTITY_ID, body);

        verify(entitiesMapper).upsert(
            eq(GAME_ID), eq(43L), eq(ENTITY_ID), eq("Example"), eq("optional"), eq(IMAGE_URI)
        );
    }

    @Test
    void putEntityBatchRejectsMissingImageBeforeRevision() {
        when(imagesMapper.findImageByUri(GAME_ID, IMAGE_URI)).thenReturn(null);
        ObjectNode body = validBatchBody();
        body.put("imageUri", IMAGE_URI);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putEntityBatch(GAME_ID, ENTITY_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/imageUri", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevisionIfExpected(any(), anyLong());
        verify(entitiesMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any());
    }

    @Test
    void putEntityBatchOmissionPreservesExistingImageUri() {
        when(entitiesMapper.findById(GAME_ID, ENTITY_ID))
            .thenReturn(entityRow(ENTITY_ID, "Example", 42L, IMAGE_URI));
        when(revisionService.nextRevisionIfExpected(GAME_ID, 42L)).thenReturn(43L);

        service.putEntityBatch(GAME_ID, ENTITY_ID, validBatchBody());

        verify(imagesMapper, never()).findImageByUri(any(), any());
        verify(entitiesMapper).upsert(
            eq(GAME_ID), eq(43L), eq(ENTITY_ID), eq("Example"), eq("optional"), eq(IMAGE_URI)
        );
    }

    @Test
    void putEntityBatchNullImageUriClearsAssociation() {
        when(entitiesMapper.findById(GAME_ID, ENTITY_ID))
            .thenReturn(entityRow(ENTITY_ID, "Example", 42L, IMAGE_URI));
        when(revisionService.nextRevisionIfExpected(GAME_ID, 42L)).thenReturn(43L);
        ObjectNode body = validBatchBody();
        body.putNull("imageUri");

        service.putEntityBatch(GAME_ID, ENTITY_ID, body);

        verify(entitiesMapper).upsert(
            eq(GAME_ID), eq(43L), eq(ENTITY_ID), eq("Example"), eq("optional"), isNull()
        );
    }

    @Test
    void putEntityBatchBlankImageUriClearsAssociation() {
        when(entitiesMapper.findById(GAME_ID, ENTITY_ID))
            .thenReturn(entityRow(ENTITY_ID, "Example", 42L, IMAGE_URI));
        when(revisionService.nextRevisionIfExpected(GAME_ID, 42L)).thenReturn(43L);
        ObjectNode body = validBatchBody();
        body.put("imageUri", " ");

        service.putEntityBatch(GAME_ID, ENTITY_ID, body);

        verify(entitiesMapper).upsert(
            eq(GAME_ID), eq(43L), eq(ENTITY_ID), eq("Example"), eq("optional"), isNull()
        );
    }

    @Test
    void putEntityBatchRejectsNonTextImageUriBeforeRevision() {
        ObjectNode body = validBatchBody();
        body.put("imageUri", true);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> service.putEntityBatch(GAME_ID, ENTITY_ID, body)
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        assertEquals("/imageUri", ex.getDetails().get("path"));
        verify(revisionService, never()).nextRevisionIfExpected(any(), anyLong());
        verify(entitiesMapper, never()).upsert(any(), anyLong(), any(), any(), any(), any());
    }

    private static ObjectNode validBatchBody() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("expectedCurrentRevision", 42);
        body.put("displayName", "Example");
        body.put("description", "optional");

        ObjectNode attr = body.putArray("attributes").addObject();
        attr.put("attrKey", "hp");
        attr.put("baseValue", 600);
        attr.set("stages", exactAttributeStages(600));

        body.putArray("providerMounts").addObject().put("providerId", "provider_example");
        return body;
    }

    private static ArrayNode exactAttributeStages(int value) {
        ArrayNode stages = JsonNodeFactory.instance.arrayNode();
        for (int stage = 1; stage <= 18; stage++) {
            stages.addObject().put("stage", stage).put("value", value);
        }
        return stages;
    }

    private static Map<String, Object> entityRow(String entityId, String displayName, long revision) {
        return entityRow(entityId, displayName, revision, null);
    }

    private static Map<String, Object> entityRow(
        String entityId,
        String displayName,
        long revision,
        String imageUri
    ) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("entityId", entityId);
        row.put("displayName", displayName);
        row.put("description", null);
        row.put("imageUri", imageUri);
        row.put("changeRevision", revision);
        return row;
    }

    private static Map<String, Object> attrRow(String attrKey, BigDecimal baseValue, long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("entityId", ENTITY_ID);
        row.put("attrKey", attrKey);
        row.put("baseValue", baseValue);
        row.put("changeRevision", revision);
        return row;
    }

    private static Map<String, Object> attrStageRow(String attrKey, int stage, BigDecimal value, long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("entityId", ENTITY_ID);
        row.put("attrKey", attrKey);
        row.put("stage", stage);
        row.put("value", value);
        row.put("changeRevision", revision);
        return row;
    }

    private static Map<String, Object> mountRow(String providerId, long revision) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("entityId", ENTITY_ID);
        row.put("providerId", providerId);
        row.put("changeRevision", revision);
        return row;
    }
}
