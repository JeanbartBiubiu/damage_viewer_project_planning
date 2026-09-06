package xyz.game.datamanage.service.equipment;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.equipment.EquipmentMapper;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.equipment.EquipmentAttributeDefinition;
import xyz.game.datamanage.model.equipment.EquipmentAttributesRequest;
import xyz.game.datamanage.model.equipment.EquipmentCreateRequest;
import xyz.game.datamanage.model.equipment.EquipmentResponse;
import xyz.game.datamanage.model.equipment.EquipmentUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class EquipmentServiceTest {

    private static final String GAME_ID = "lol";
    private static final String EQUIPMENT_KEY = "long_sword";

    @Mock private GamesMapper gamesMapper;
    @Mock private ImageRelationMapper imageRelationMapper;
    @Mock private EquipmentMapper equipmentMapper;

    private ObjectMapper objectMapper;
    private EquipmentService service;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new EquipmentService(gamesMapper, equipmentMapper, objectMapper, imageRelationMapper);
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void createNormalizesFieldsAndCreatesEmptyAttributeMap() {
        when(equipmentMapper.countByKey(GAME_ID, EQUIPMENT_KEY)).thenReturn(0L);
        when(equipmentMapper.countByNormalizedName(GAME_ID, "长剑", null)).thenReturn(0L);
        when(equipmentMapper.insertEquipment(GAME_ID, EQUIPMENT_KEY, "长剑", null)).thenReturn(1);
        when(equipmentMapper.insertAttributeValues(GAME_ID, EQUIPMENT_KEY, "{}")).thenReturn(1);
        when(equipmentMapper.findById(GAME_ID, EQUIPMENT_KEY)).thenReturn(equipment());

        assertEquals(
            equipment(),
            service.create(GAME_ID, new EquipmentCreateRequest(" long_sword ", " 长剑 ", " "))
        );
        verify(equipmentMapper).insertAttributeValues(GAME_ID, EQUIPMENT_KEY, "{}");
    }

    @Test
    void updateAttributesStoresOnlyConfiguredDirectValues() throws Exception {
        when(equipmentMapper.findByIdForUpdate(GAME_ID, EQUIPMENT_KEY)).thenReturn(equipment());
        when(equipmentMapper.listAttributeDefinitions(GAME_ID)).thenReturn(definitions());
        when(equipmentMapper.updateAttributeValues(eq(GAME_ID), eq(EQUIPMENT_KEY), anyString())).thenReturn(1);

        service.updateAttributes(
            GAME_ID,
            EQUIPMENT_KEY,
            new EquipmentAttributesRequest(objectMapper.readTree("{\"hp\":250,\"armor_pen_percent\":30}"))
        );

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(equipmentMapper).updateAttributeValues(eq(GAME_ID), eq(EQUIPMENT_KEY), json.capture());
        JsonNode stored = objectMapper.readTree(json.getValue());
        assertEquals(250, stored.path("hp").intValue());
        assertEquals(30, stored.path("armor_pen_percent").intValue());
        assertFalse(stored.has("armor"));
        verify(equipmentMapper, never()).insertAttributeValues(eq(GAME_ID), eq(EQUIPMENT_KEY), anyString());
    }

    @Test
    void rejectsUnknownNonNumericFractionalIntegerAndOutOfRangeValues() throws Exception {
        when(equipmentMapper.findByIdForUpdate(GAME_ID, EQUIPMENT_KEY)).thenReturn(equipment());
        when(equipmentMapper.listAttributeDefinitions(GAME_ID)).thenReturn(definitions());

        assertCode("400.UNKNOWN_ATTRIBUTE", () -> updateAttributes("{\"bad\":1}"));
        assertCode("400.ATTRIBUTE_VALUE_INVALID", () -> updateAttributes("{\"hp\":\"250\"}"));
        assertCode("400.ATTRIBUTE_VALUE_INVALID", () -> updateAttributes("{\"armor\":1.5}"));
        assertCode("400.ATTRIBUTE_VALUE_INVALID", () -> updateAttributes("{\"hp\":20000}"));
        verify(equipmentMapper, never()).updateAttributeValues(eq(GAME_ID), eq(EQUIPMENT_KEY), anyString());
    }

    @Test
    void basicUpdateDoesNotTouchAttributesAndDeleteIsHardDelete() {
        when(equipmentMapper.findByIdForUpdate(GAME_ID, EQUIPMENT_KEY)).thenReturn(equipment());
        when(equipmentMapper.countByNormalizedName(GAME_ID, "长剑改", EQUIPMENT_KEY)).thenReturn(0L);
        when(equipmentMapper.updateEquipment(GAME_ID, EQUIPMENT_KEY, "长剑改", null)).thenReturn(1);
        when(equipmentMapper.findById(GAME_ID, EQUIPMENT_KEY)).thenReturn(equipment());

        service.update(GAME_ID, EQUIPMENT_KEY, new EquipmentUpdateRequest(null, "长剑改", null));

        verify(equipmentMapper, never()).findAttributeValuesJson(GAME_ID, EQUIPMENT_KEY);
        verify(equipmentMapper, never()).updateAttributeValues(eq(GAME_ID), eq(EQUIPMENT_KEY), anyString());

        when(equipmentMapper.deleteEquipment(GAME_ID, EQUIPMENT_KEY)).thenReturn(1);
        service.delete(GAME_ID, EQUIPMENT_KEY);
        verify(equipmentMapper).deleteEquipment(GAME_ID, EQUIPMENT_KEY);
    }

    @Test
    void duplicateAndMissingErrorsAreStable() {
        when(equipmentMapper.countByKey(GAME_ID, EQUIPMENT_KEY)).thenReturn(1L);
        assertCode(
            "409.EQUIPMENT_KEY_EXISTS",
            () -> service.create(GAME_ID, new EquipmentCreateRequest(EQUIPMENT_KEY, "长剑", null))
        );

        when(equipmentMapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.EQUIPMENT_NOT_FOUND", () -> service.get(GAME_ID, "missing"));
    }

    private void updateAttributes(String json) throws Exception {
        service.updateAttributes(
            GAME_ID,
            EQUIPMENT_KEY,
            new EquipmentAttributesRequest(objectMapper.readTree(json))
        );
    }

    private static List<EquipmentAttributeDefinition> definitions() {
        return List.of(
            new EquipmentAttributeDefinition("hp", AttributeValueType.DECIMAL, BigDecimal.ZERO, new BigDecimal("10000")),
            new EquipmentAttributeDefinition("armor", AttributeValueType.INTEGER, BigDecimal.ZERO, new BigDecimal("1000")),
            new EquipmentAttributeDefinition("armor_pen_percent", AttributeValueType.DECIMAL, BigDecimal.ZERO, null)
        );
    }

    private static EquipmentResponse equipment() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-23T08:00:00Z");
        return new EquipmentResponse(GAME_ID, EQUIPMENT_KEY, "长剑", null, timestamp, timestamp);
    }

    private static void assertCode(String code, ThrowingAction action) {
        ApiException ex = assertThrows(ApiException.class, action::run);
        assertEquals(code, ex.getCode());
    }

    @FunctionalInterface
    private interface ThrowingAction {
        void run() throws Exception;
    }
}
