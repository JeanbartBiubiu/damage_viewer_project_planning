package xyz.game.datamanage.service.skillrelation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.IntNode;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.mapper.equipment.EquipmentMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.SkillRelationMapper;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.equipment.EquipmentResponse;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationCreateRequest;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationCreateRequest;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.SkillRelationUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class SkillRelationServiceTest {

    @Mock private GamesMapper gamesMapper;
    @Mock private CharacterMapper characterMapper;
    @Mock private EquipmentMapper equipmentMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillRelationMapper mapper;

    private SkillRelationService service;

    @BeforeEach
    void setUp() {
        service = new SkillRelationService(gamesMapper, characterMapper, equipmentMapper, skillMapper, mapper);
        when(gamesMapper.countGames("lol")).thenReturn(1L);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void listRequiresOneFilter(boolean equipment) {
        assertCode("400.VALIDATION_FAILED", () -> list(equipment, " ", null));
        verify(mapper, never()).listCharacterRelations(any(), any(), any());
        verify(mapper, never()).listEquipmentRelations(any(), any(), any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void bothListFiltersUseSameGameAndReturnDisabledRelation(boolean equipment) {
        stubSource(equipment, false);
        when(skillMapper.findById("lol", "fire")).thenReturn(skill(SkillStatus.DISABLED));
        if (equipment) {
            var row = equipmentRelation(SkillStatus.DISABLED, 7);
            when(mapper.listEquipmentRelations("lol", "source", "fire")).thenReturn(List.of(row));
            var result = service.listEquipmentRelations("lol", " source ", " fire ");
            assertEquals(1, result.total());
            assertEquals(List.of(row), result.items());
        } else {
            var row = characterRelation(SkillStatus.DISABLED, 7);
            when(mapper.listCharacterRelations("lol", "source", "fire")).thenReturn(List.of(row));
            var result = service.listCharacterRelations("lol", " source ", " fire ");
            assertEquals(1, result.total());
            assertEquals(List.of(row), result.items());
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void reverseListChecksSkillExistsAndDoesNotRequireSource(boolean equipment) {
        when(skillMapper.findById("lol", "fire")).thenReturn(skill(SkillStatus.ENABLED));
        if (equipment) {
            assertEquals(0, service.listEquipmentRelations("lol", null, "fire").total());
            verify(mapper).listEquipmentRelations("lol", null, "fire");
        } else {
            assertEquals(0, service.listCharacterRelations("lol", null, "fire").total());
            verify(mapper).listCharacterRelations("lol", null, "fire");
        }
        verify(characterMapper, never()).findById(any(), any());
        verify(equipmentMapper, never()).findById(any(), any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void missingSourceOrSkillReturnsObjectNotFound(boolean equipment) {
        assertCode(equipment ? "404.EQUIPMENT_NOT_FOUND" : "404.CHARACTER_NOT_FOUND",
            () -> list(equipment, "source", null));
        assertCode("404.SKILL_NOT_FOUND", () -> list(equipment, null, "fire"));
    }

    @Test
    void missingGameReturnsGameNotFound() {
        when(gamesMapper.countGames("lol")).thenReturn(0L);
        assertCode("404.GAME_NOT_FOUND", () -> service.listCharacterRelations("lol", "source", null));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void createsAndReadsFullRelation(boolean equipment) {
        stubSource(equipment, true);
        when(skillMapper.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.ENABLED));
        if (equipment) {
            var row = equipmentRelation(SkillStatus.ENABLED, 0);
            when(mapper.findEquipmentRelation("lol", "source", "fire")).thenReturn(null, row);
            when(mapper.insertEquipmentRelation("lol", "source", "fire", 0)).thenReturn(1);
            assertEquals(row, create(true, IntNode.valueOf(0), Set.of()));
        } else {
            var row = characterRelation(SkillStatus.ENABLED, 0);
            when(mapper.findCharacterRelation("lol", "source", "fire")).thenReturn(null, row);
            when(mapper.insertCharacterRelation("lol", "source", "fire", 0)).thenReturn(1);
            assertEquals(row, create(false, IntNode.valueOf(0), Set.of()));
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void duplicateIsConflictAndDoesNotChangeSortOrder(boolean equipment) {
        stubSource(equipment, true);
        when(skillMapper.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.DISABLED));
        if (equipment) {
            when(mapper.findEquipmentRelation("lol", "source", "fire")).thenReturn(equipmentRelation(SkillStatus.DISABLED, 9));
        } else {
            when(mapper.findCharacterRelation("lol", "source", "fire")).thenReturn(characterRelation(SkillStatus.DISABLED, 9));
        }
        assertCode("409.RELATION_EXISTS", () -> create(equipment, IntNode.valueOf(0), Set.of()));
        verify(mapper, never()).insertCharacterRelation(any(), any(), any(), anyInt());
        verify(mapper, never()).insertEquipmentRelation(any(), any(), any(), anyInt());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void insertConflictRowCountMapsToRelationExists(boolean equipment) {
        stubSource(equipment, true);
        when(skillMapper.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.ENABLED));
        assertCode("409.RELATION_EXISTS", () -> create(equipment, IntNode.valueOf(0), Set.of()));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void disabledSkillCannotBeNewlyAttached(boolean equipment) {
        stubSource(equipment, true);
        when(skillMapper.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.DISABLED));
        assertCode("409.REFERENCE_DISABLED", () -> create(equipment, IntNode.valueOf(0), Set.of()));
        verify(mapper, never()).insertCharacterRelation(any(), any(), any(), anyInt());
        verify(mapper, never()).insertEquipmentRelation(any(), any(), any(), anyInt());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void disabledSkillCanBeReorderedAndDetached(boolean equipment) {
        stubSource(equipment, true);
        when(skillMapper.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.DISABLED));
        var request = new SkillRelationUpdateRequest(IntNode.valueOf(Integer.MAX_VALUE), Set.of());
        if (equipment) {
            var row = equipmentRelation(SkillStatus.DISABLED, Integer.MAX_VALUE);
            when(mapper.updateEquipmentRelation("lol", "source", "fire", Integer.MAX_VALUE)).thenReturn(1);
            when(mapper.findEquipmentRelation("lol", "source", "fire")).thenReturn(row);
            when(mapper.deleteEquipmentRelation("lol", "source", "fire")).thenReturn(1);
            assertEquals(row, service.updateEquipmentRelation("lol", "source", "fire", request));
            service.deleteEquipmentRelation("lol", "source", "fire");
        } else {
            var row = characterRelation(SkillStatus.DISABLED, Integer.MAX_VALUE);
            when(mapper.updateCharacterRelation("lol", "source", "fire", Integer.MAX_VALUE)).thenReturn(1);
            when(mapper.findCharacterRelation("lol", "source", "fire")).thenReturn(row);
            when(mapper.deleteCharacterRelation("lol", "source", "fire")).thenReturn(1);
            assertEquals(row, service.updateCharacterRelation("lol", "source", "fire", request));
            service.deleteCharacterRelation("lol", "source", "fire");
        }
        verify(skillMapper, never()).delete(any(), any());
        verify(characterMapper, never()).deleteCharacter(any(), any());
        verify(equipmentMapper, never()).deleteEquipment(any(), any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void missingRelationUpdateAndDeleteReturn404(boolean equipment) {
        stubSource(equipment, true);
        when(skillMapper.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.ENABLED));
        var request = new SkillRelationUpdateRequest(IntNode.valueOf(1), Set.of());
        if (equipment) {
            assertCode("404.RELATION_NOT_FOUND", () -> service.updateEquipmentRelation("lol", "source", "fire", request));
            assertCode("404.RELATION_NOT_FOUND", () -> service.deleteEquipmentRelation("lol", "source", "fire"));
        } else {
            assertCode("404.RELATION_NOT_FOUND", () -> service.updateCharacterRelation("lol", "source", "fire", request));
            assertCode("404.RELATION_NOT_FOUND", () -> service.deleteCharacterRelation("lol", "source", "fire"));
        }
    }

    @ParameterizedTest
    @MethodSource("invalidSortOrders")
    void rejectsInvalidSortOrdersBeforeAnyRelationWrite(JsonNode sortOrder) {
        ApiException error = assertThrows(ApiException.class, () -> create(false, sortOrder, Set.of()));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertEquals("sortOrder", ((List<Map<String, String>>) error.getDetails().get("fieldIssues")).getFirst().get("field"));
        verify(mapper, never()).insertCharacterRelation(any(), any(), any(), anyInt());
    }

    @Test
    void rejectsUnknownCreateAndUpdateFields() {
        assertCode("400.VALIDATION_FAILED", () -> create(true, IntNode.valueOf(1), Set.of("gameId")));
        assertCode("400.VALIDATION_FAILED", () -> service.updateCharacterRelation(
            "lol", "source", "fire", new SkillRelationUpdateRequest(IntNode.valueOf(0), Set.of("skillKey"))
        ));
    }

    private static Stream<JsonNode> invalidSortOrders() throws Exception {
        ObjectMapper json = new ObjectMapper();
        return Stream.of(null, json.readTree("null"), json.readTree("-1"), json.readTree("2147483648"),
            json.readTree("1.5"), json.readTree("1.0"), json.readTree("\"1\""), json.readTree("true"));
    }

    private Object list(boolean equipment, String sourceKey, String skillKey) {
        return equipment
            ? service.listEquipmentRelations("lol", sourceKey, skillKey)
            : service.listCharacterRelations("lol", sourceKey, skillKey);
    }

    private Object create(boolean equipment, JsonNode sortOrder, Set<String> unknownFields) {
        return equipment
            ? service.createEquipmentRelation("lol", new EquipmentSkillRelationCreateRequest(" source ", " fire ", sortOrder, unknownFields))
            : service.createCharacterRelation("lol", new CharacterSkillRelationCreateRequest(" source ", " fire ", sortOrder, unknownFields));
    }

    private void stubSource(boolean equipment, boolean lock) {
        if (equipment) {
            var row = new EquipmentResponse("lol", "source", "装备", null, null, null);
            if (lock) {
                when(equipmentMapper.findByIdForUpdate("lol", "source")).thenReturn(row);
            } else {
                when(equipmentMapper.findById("lol", "source")).thenReturn(row);
            }
        } else {
            var row = new CharacterResponse("lol", "source", "角色", null, null, null);
            if (lock) {
                when(characterMapper.findByIdForUpdate("lol", "source")).thenReturn(row);
            } else {
                when(characterMapper.findById("lol", "source")).thenReturn(row);
            }
        }
    }

    private static SkillRow skill(SkillStatus status) {
        return new SkillRow("lol", "fire", "火焰", null, 1, status, 0, null, null);
    }

    private static CharacterSkillRelationResponse characterRelation(SkillStatus status, int sortOrder) {
        return new CharacterSkillRelationResponse("lol", "source", "角色", "fire", "火焰", status, sortOrder);
    }

    private static EquipmentSkillRelationResponse equipmentRelation(SkillStatus status, int sortOrder) {
        return new EquipmentSkillRelationResponse("lol", "source", "装备", "fire", "火焰", status, sortOrder);
    }

    private static void assertCode(String code, Runnable action) {
        assertEquals(code, assertThrows(ApiException.class, action::run).getCode());
    }
}
