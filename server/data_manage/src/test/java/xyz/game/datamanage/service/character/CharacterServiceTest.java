package xyz.game.datamanage.service.character;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
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
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.mapper.skillparameter.SkillParameterMapper;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.character.CharacterAttributeDefinition;
import xyz.game.datamanage.model.character.CharacterAttributesRequest;
import xyz.game.datamanage.model.character.CharacterAttributesResponse;
import xyz.game.datamanage.model.character.CharacterCreateRequest;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.CharacterUpdateRequest;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.character.LevelConfigUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterRow;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.service.skillparameter.SkillParameterLevelService;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class CharacterServiceTest {

    private static final String GAME_ID = "lol";
    private static final String CHARACTER_KEY = "ashe";

    @Mock private GamesMapper gamesMapper;
    @Mock private ImageRelationMapper imageRelationMapper;
    @Mock private CharacterMapper characterMapper;
    @Mock private SkillParameterMapper parameterMapper;

    private ObjectMapper objectMapper;
    private CharacterService service;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        SkillParameterLevelService levelService = new SkillParameterLevelService(objectMapper);
        service = new CharacterService(
            gamesMapper,
            characterMapper,
            parameterMapper,
            levelService,
            objectMapper,
            imageRelationMapper
        );
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
        lenient().when(characterMapper.findLevelConfig(GAME_ID)).thenReturn(new LevelConfigResponse(GAME_ID, 1, 2));
        lenient().when(characterMapper.lockGame(GAME_ID)).thenReturn(1);
        lenient().when(characterMapper.findLevelConfigForUpdate(GAME_ID))
            .thenReturn(new LevelConfigResponse(GAME_ID, 1, 2));
    }

    @Test
    void createStoresCompleteLevelKeysWithoutInventingConfiguredAttributes() throws Exception {
        when(characterMapper.countByKey(GAME_ID, CHARACTER_KEY)).thenReturn(0L);
        when(characterMapper.countByNormalizedName(GAME_ID, "寒冰射手", null)).thenReturn(0L);
        when(characterMapper.listAttributeDefinitions(GAME_ID)).thenReturn(definitions());
        when(characterMapper.insertCharacter(GAME_ID, CHARACTER_KEY, "寒冰射手", null)).thenReturn(1);
        when(characterMapper.insertLevelValues(eq(GAME_ID), eq(CHARACTER_KEY), anyString())).thenReturn(1);
        when(characterMapper.findById(GAME_ID, CHARACTER_KEY)).thenReturn(character());

        assertEquals(
            character(),
            service.create(GAME_ID, new CharacterCreateRequest(CHARACTER_KEY, " 寒冰射手 ", " "))
        );

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(characterMapper).insertLevelValues(eq(GAME_ID), eq(CHARACTER_KEY), json.capture());
        JsonNode stored = objectMapper.readTree(json.getValue());
        assertEquals(0, stored.path("1").size());
        assertEquals(0, stored.path("2").size());
        assertEquals(2, stored.size());

        InOrder order = inOrder(characterMapper);
        order.verify(characterMapper).lockGame(GAME_ID);
        order.verify(characterMapper).findLevelConfigForUpdate(GAME_ID);
    }

    @Test
    void updateAttributesStoresOnlyCompleteConfiguredAttributeRows() throws Exception {
        when(characterMapper.findByIdForUpdate(GAME_ID, CHARACTER_KEY)).thenReturn(character());
        when(characterMapper.listAttributeDefinitions(GAME_ID)).thenReturn(definitions());
        when(characterMapper.updateLevelValues(eq(GAME_ID), eq(CHARACTER_KEY), anyString())).thenReturn(1);
        JsonNode input = objectMapper.readTree("""
            {"1":{"hp":600},"2":{"hp":630}}
            """);

        CharacterAttributesResponse response = service.updateAttributes(
            GAME_ID,
            CHARACTER_KEY,
            new CharacterAttributesRequest(input)
        );

        assertFalse(response.levelValues().path("1").has("armor"));
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(characterMapper).updateLevelValues(eq(GAME_ID), eq(CHARACTER_KEY), json.capture());
        assertFalse(objectMapper.readTree(json.getValue()).path("1").has("armor"));
        verify(characterMapper, never()).insertLevelValues(eq(GAME_ID), eq(CHARACTER_KEY), anyString());

        InOrder order = inOrder(characterMapper);
        order.verify(characterMapper).lockGame(GAME_ID);
        order.verify(characterMapper).findLevelConfigForUpdate(GAME_ID);
        order.verify(characterMapper).findByIdForUpdate(GAME_ID, CHARACTER_KEY);
    }

    @Test
    void getAttributesMaterializesCurrentDefinitionsAndConfiguredLevels() {
        when(characterMapper.findById(GAME_ID, CHARACTER_KEY)).thenReturn(character());
        when(characterMapper.listAttributeDefinitions(GAME_ID)).thenReturn(definitions());
        when(characterMapper.findLevelValuesJson(GAME_ID, CHARACTER_KEY))
            .thenReturn("{\"1\":{\"hp\":580},\"2\":{\"hp\":610,\"old_attribute\":9}}");

        CharacterAttributesResponse response = service.getAttributes(GAME_ID, CHARACTER_KEY);

        assertEquals(580, response.levelValues().path("1").path("hp").intValue());
        assertFalse(response.levelValues().path("1").has("armor"));
        assertEquals(610, response.levelValues().path("2").path("hp").intValue());
        assertFalse(response.levelValues().path("2").has("old_attribute"));
    }

    @Test
    void rejectsIncompleteLevelsUnknownAttributesAndInvalidNumericValues() throws Exception {
        when(characterMapper.findByIdForUpdate(GAME_ID, CHARACTER_KEY)).thenReturn(character());
        when(characterMapper.listAttributeDefinitions(GAME_ID)).thenReturn(definitions());

        assertCode(
            "400.LEVEL_VALUES_INVALID",
            () -> updateAttributes("{\"1\":{\"hp\":600}}")
        );
        assertCode(
            "400.UNKNOWN_ATTRIBUTE",
            () -> updateAttributes("{\"1\":{\"bad\":1},\"2\":{}}")
        );
        assertCode(
            "400.LEVEL_VALUES_INVALID",
            () -> updateAttributes("{\"1\":{\"armor\":18},\"2\":{}}")
        );
        assertCode(
            "400.ATTRIBUTE_VALUE_INVALID",
            () -> updateAttributes("{\"1\":{\"armor\":1.5},\"2\":{\"armor\":20}}")
        );
        assertCode(
            "400.ATTRIBUTE_VALUE_INVALID",
            () -> updateAttributes("{\"1\":{\"hp\":20000},\"2\":{\"hp\":630}}")
        );
    }

    @Test
    void basicUpdateDoesNotReadOrWriteAttributeMapAndDeleteUsesHardDelete() {
        when(characterMapper.findByIdForUpdate(GAME_ID, CHARACTER_KEY)).thenReturn(character());
        when(characterMapper.countByNormalizedName(GAME_ID, "艾希", CHARACTER_KEY)).thenReturn(0L);
        when(characterMapper.updateCharacter(GAME_ID, CHARACTER_KEY, "艾希", "远程角色")).thenReturn(1);
        when(characterMapper.findById(GAME_ID, CHARACTER_KEY)).thenReturn(character());

        service.update(
            GAME_ID,
            CHARACTER_KEY,
            new CharacterUpdateRequest(null, "艾希", "远程角色")
        );

        verify(characterMapper, never()).findLevelValuesJson(GAME_ID, CHARACTER_KEY);
        verify(characterMapper, never()).updateLevelValues(eq(GAME_ID), eq(CHARACTER_KEY), anyString());

        when(characterMapper.deleteCharacter(GAME_ID, CHARACTER_KEY)).thenReturn(1);
        service.delete(GAME_ID, CHARACTER_KEY);
        verify(characterMapper).deleteCharacter(GAME_ID, CHARACTER_KEY);
    }

    @Test
    void levelConfigurationIsRequiredAndCharacterMissingIsStable() {
        when(characterMapper.findLevelConfigForUpdate(GAME_ID)).thenReturn(null);
        assertCode(
            "409.LEVEL_CONFIG_REQUIRED",
            () -> service.create(GAME_ID, new CharacterCreateRequest(CHARACTER_KEY, "寒冰射手", null))
        );

        when(characterMapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.CHARACTER_NOT_FOUND", () -> service.get(GAME_ID, "missing"));
    }

    @Test
    void levelConfigurationChangeRebuildsAttributesAndCharacterLevelParametersInLockOrder()
        throws Exception {
        LevelConfigResponse previous = new LevelConfigResponse(GAME_ID, 1, 3);
        LevelConfigResponse changed = new LevelConfigResponse(GAME_ID, 2, 4);
        when(characterMapper.findLevelConfigForUpdate(GAME_ID)).thenReturn(previous);
        when(characterMapper.lockGame(GAME_ID)).thenReturn(1);
        when(parameterMapper.lockSkillsForGame(GAME_ID)).thenReturn(List.of("ezreal_q"));
        when(parameterMapper.lockCharacterLevelParamsForGame(GAME_ID)).thenReturn(List.of(
            characterLevelParam("{\"1\":1,\"2\":2,\"3\":3}")
        ));
        when(characterMapper.lockCharactersForGame(GAME_ID)).thenReturn(List.of(CHARACTER_KEY));
        when(characterMapper.lockCharacterAttributesForGame(GAME_ID)).thenReturn(List.of(CHARACTER_KEY));
        when(characterMapper.listAttributeDefinitions(GAME_ID)).thenReturn(definitions());
        when(characterMapper.findLevelValuesJson(GAME_ID, CHARACTER_KEY)).thenReturn(
            "{\"1\":{\"hp\":580,\"armor\":18},\"2\":{\"hp\":610,\"armor\":20},\"3\":{\"hp\":640,\"armor\":22}}"
        );
        when(characterMapper.updateLevelValues(eq(GAME_ID), eq(CHARACTER_KEY), anyString())).thenReturn(1);
        when(parameterMapper.updateLevelValuesJson(
            eq(GAME_ID), eq("ezreal_q"), eq("by_level"), anyString()
        )).thenReturn(1);
        when(characterMapper.upsertLevelConfig(GAME_ID, 2, 4)).thenReturn(1);
        when(characterMapper.findLevelConfig(GAME_ID)).thenReturn(changed);

        assertEquals(changed, service.updateLevelConfig(GAME_ID, new LevelConfigUpdateRequest(2, 4)));

        ArgumentCaptor<String> attrJson = ArgumentCaptor.forClass(String.class);
        verify(characterMapper).updateLevelValues(eq(GAME_ID), eq(CHARACTER_KEY), attrJson.capture());
        JsonNode stored = objectMapper.readTree(attrJson.getValue());
        assertFalse(stored.has("1"));
        assertEquals(610, stored.path("2").path("hp").intValue());
        assertEquals(640, stored.path("3").path("hp").intValue());
        assertEquals(0, stored.path("4").path("hp").intValue());

        ArgumentCaptor<String> paramJson = ArgumentCaptor.forClass(String.class);
        verify(parameterMapper).updateLevelValuesJson(
            eq(GAME_ID), eq("ezreal_q"), eq("by_level"), paramJson.capture()
        );
        assertEquals("{\"2\":2,\"3\":3,\"4\":0}", paramJson.getValue());

        InOrder order = inOrder(characterMapper, parameterMapper);
        order.verify(characterMapper).lockGame(GAME_ID);
        order.verify(characterMapper).findLevelConfigForUpdate(GAME_ID);
        order.verify(parameterMapper).lockSkillsForGame(GAME_ID);
        order.verify(parameterMapper).lockCharacterLevelParamsForGame(GAME_ID);
        order.verify(characterMapper).lockCharactersForGame(GAME_ID);
        order.verify(characterMapper).lockCharacterAttributesForGame(GAME_ID);
        order.verify(characterMapper).updateLevelValues(eq(GAME_ID), eq(CHARACTER_KEY), anyString());
        order.verify(parameterMapper).updateLevelValuesJson(
            eq(GAME_ID), eq("ezreal_q"), eq("by_level"), anyString()
        );
        order.verify(characterMapper).upsertLevelConfig(GAME_ID, 2, 4);
    }

    @Test
    void unchangedLevelRangeDoesNotRewriteMaps() {
        LevelConfigResponse current = new LevelConfigResponse(GAME_ID, 1, 2);
        when(characterMapper.findLevelConfigForUpdate(GAME_ID)).thenReturn(current);
        when(characterMapper.upsertLevelConfig(GAME_ID, 1, 2)).thenReturn(1);
        when(characterMapper.findLevelConfig(GAME_ID)).thenReturn(current);

        assertEquals(current, service.updateLevelConfig(GAME_ID, new LevelConfigUpdateRequest(1, 2)));

        verify(parameterMapper, never()).lockSkillsForGame(anyString());
        verify(parameterMapper, never()).lockCharacterLevelParamsForGame(anyString());
        verify(characterMapper, never()).updateLevelValues(anyString(), anyString(), anyString());
        verify(parameterMapper, never()).updateLevelValuesJson(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void firstLevelConfigFailsWhenCharacterLevelDataAlreadyExists() {
        when(characterMapper.findLevelConfigForUpdate(GAME_ID)).thenReturn(null);
        when(characterMapper.countCharacterAttributes(GAME_ID)).thenReturn(1L);

        assertCode(
            "409.LEVEL_CONFIG_REQUIRED",
            () -> service.updateLevelConfig(GAME_ID, new LevelConfigUpdateRequest(1, 18))
        );
        verify(characterMapper, never()).upsertLevelConfig(GAME_ID, 1, 18);
    }

    @Test
    void levelConfigurationRejectsAnInvertedRangeBeforeWriting() {
        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.updateLevelConfig(GAME_ID, new LevelConfigUpdateRequest(18, 1))
        );
        verify(characterMapper, never()).upsertLevelConfig(GAME_ID, 18, 1);
    }

    private void updateAttributes(String json) throws Exception {
        service.updateAttributes(
            GAME_ID,
            CHARACTER_KEY,
            new CharacterAttributesRequest(objectMapper.readTree(json))
        );
    }

    private static List<CharacterAttributeDefinition> definitions() {
        return List.of(
            new CharacterAttributeDefinition("hp", AttributeValueType.DECIMAL, BigDecimal.ZERO, new BigDecimal("10000")),
            new CharacterAttributeDefinition("armor", AttributeValueType.INTEGER, BigDecimal.ZERO, new BigDecimal("1000"))
        );
    }

    private static CharacterResponse character() {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-23T08:00:00Z");
        return new CharacterResponse(GAME_ID, CHARACTER_KEY, "寒冰射手", null, timestamp, timestamp);
    }

    private static SkillParameterRow characterLevelParam(String levelValuesJson) {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillParameterRow(
            GAME_ID,
            "ezreal_q",
            "by_level",
            "按角色等级",
            SkillParameterValueType.INTEGER,
            SkillParameterValueMode.CHARACTER_LEVEL,
            null,
            levelValuesJson,
            null,
            1,
            timestamp,
            timestamp
        );
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
