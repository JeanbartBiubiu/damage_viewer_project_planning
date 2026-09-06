package xyz.game.datamanage.service.skillparameter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillparameter.SkillParameterMapper;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillparameter.SkillParameterCreateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterRow;
import xyz.game.datamanage.model.skillparameter.SkillParameterUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class SkillParameterServiceTest {

    private static final String GAME_ID = "lol";
    private static final String SKILL_KEY = "ezreal_q";
    private static final String PARAMETER_KEY = "base_damage";

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillParameterMapper parameterMapper;

    private SkillParameterLevelService levelService;
    private SkillParameterService service;

    @BeforeEach
    void setUp() {
        levelService = new SkillParameterLevelService(new ObjectMapper());
        service = new SkillParameterService(gamesMapper, skillMapper, parameterMapper, levelService, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void listsRequiresParentGameAndSkillAndReturnsCompleteValues() {
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill(5));
        when(parameterMapper.list(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            row(
                PARAMETER_KEY,
                SkillParameterValueType.DECIMAL,
                SkillParameterValueMode.SKILL_LEVEL,
                null,
                "{\"1\":20,\"2\":45,\"3\":70,\"4\":95,\"5\":120}"
            ),
            row(
                "current_stacks",
                SkillParameterValueType.INTEGER,
                SkillParameterValueMode.RUNTIME_INPUT,
                null,
                null
            )
        ));

        List<SkillParameterResponse> items = service.list(GAME_ID, SKILL_KEY);
        assertEquals(2, items.size());
        assertEquals(new BigDecimal("20"), items.get(0).levelValues().get("1"));
        assertNull(items.get(1).fixedValue());
        assertNull(items.get(1).levelValues());

        when(gamesMapper.countGames("missing")).thenReturn(0L);
        assertCode("404.GAME_NOT_FOUND", () -> service.list("missing", SKILL_KEY));

        when(skillMapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.SKILL_NOT_FOUND", () -> service.list(GAME_ID, "missing"));
        verify(parameterMapper, never()).list(eq(GAME_ID), eq("missing"));
    }

    @Test
    void createsFixedSkillLevelRuntimeAndCharacterLevelModes() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill(5));
        when(parameterMapper.countByKey(GAME_ID, SKILL_KEY, "total_ad_ratio")).thenReturn(0L);
        when(parameterMapper.insert(
            eq(GAME_ID), eq(SKILL_KEY), eq("total_ad_ratio"), eq("总攻击力系数"),
            eq("DECIMAL"), eq("FIXED"), eq(new BigDecimal("1.3")), isNull(), isNull(), eq(20)
        )).thenReturn(1);
        when(parameterMapper.findById(GAME_ID, SKILL_KEY, "total_ad_ratio"))
            .thenReturn(row(
                "total_ad_ratio",
                SkillParameterValueType.DECIMAL,
                SkillParameterValueMode.FIXED,
                new BigDecimal("1.3"),
                null
            ));

        SkillParameterResponse fixed = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillParameterCreateRequest(
                "total_ad_ratio",
                "总攻击力系数",
                SkillParameterValueType.DECIMAL,
                SkillParameterValueMode.FIXED,
                new BigDecimal("1.3"),
                null,
                null,
                20
            )
        );
        assertEquals(new BigDecimal("1.3"), fixed.fixedValue());
        assertNull(fixed.levelValues());

        when(parameterMapper.countByKey(GAME_ID, SKILL_KEY, PARAMETER_KEY)).thenReturn(0L);
        when(parameterMapper.insert(
            eq(GAME_ID), eq(SKILL_KEY), eq(PARAMETER_KEY), eq("基础伤害"),
            eq("DECIMAL"), eq("SKILL_LEVEL"), isNull(), eq("{\"1\":20,\"2\":45,\"3\":70,\"4\":95,\"5\":120}"), isNull(), eq(10)
        )).thenReturn(1);
        when(parameterMapper.findById(GAME_ID, SKILL_KEY, PARAMETER_KEY)).thenReturn(row(
            PARAMETER_KEY,
            SkillParameterValueType.DECIMAL,
            SkillParameterValueMode.SKILL_LEVEL,
            null,
            "{\"1\":20,\"2\":45,\"3\":70,\"4\":95,\"5\":120}"
        ));

        SkillParameterResponse skillLevel = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillParameterCreateRequest(
                PARAMETER_KEY,
                "基础伤害",
                SkillParameterValueType.DECIMAL,
                SkillParameterValueMode.SKILL_LEVEL,
                null,
                levelMap(20, 45, 70, 95, 120),
                null,
                10
            )
        );
        assertEquals(5, skillLevel.levelValues().size());

        when(parameterMapper.countByKey(GAME_ID, SKILL_KEY, "current_stacks")).thenReturn(0L);
        when(parameterMapper.insert(
            eq(GAME_ID), eq(SKILL_KEY), eq("current_stacks"), eq("当前层数"),
            eq("INTEGER"), eq("RUNTIME_INPUT"), isNull(), isNull(), isNull(), eq(30)
        )).thenReturn(1);
        when(parameterMapper.findById(GAME_ID, SKILL_KEY, "current_stacks")).thenReturn(row(
            "current_stacks",
            SkillParameterValueType.INTEGER,
            SkillParameterValueMode.RUNTIME_INPUT,
            null,
            null
        ));

        SkillParameterResponse runtime = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillParameterCreateRequest(
                "current_stacks",
                "当前层数",
                SkillParameterValueType.INTEGER,
                SkillParameterValueMode.RUNTIME_INPUT,
                null,
                null,
                null,
                30
            )
        );
        assertEquals(SkillParameterValueMode.RUNTIME_INPUT, runtime.valueMode());
        assertNull(runtime.fixedValue());
        assertNull(runtime.levelValues());
    }

    @Test
    void characterLevelCreateLocksGameThenConfigThenSkill() {
        when(parameterMapper.lockGame(GAME_ID)).thenReturn(1);
        when(parameterMapper.findLevelConfigForUpdate(GAME_ID))
            .thenReturn(new LevelConfigResponse(GAME_ID, 1, 2));
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill(5));
        when(parameterMapper.countByKey(GAME_ID, SKILL_KEY, "by_level")).thenReturn(0L);
        when(parameterMapper.insert(
            eq(GAME_ID), eq(SKILL_KEY), eq("by_level"), eq("按角色等级"),
            eq("INTEGER"), eq("CHARACTER_LEVEL"), isNull(), eq("{\"1\":1,\"2\":2}"), isNull(), eq(1)
        )).thenReturn(1);
        when(parameterMapper.findById(GAME_ID, SKILL_KEY, "by_level")).thenReturn(row(
            "by_level",
            SkillParameterValueType.INTEGER,
            SkillParameterValueMode.CHARACTER_LEVEL,
            null,
            "{\"1\":1,\"2\":2}"
        ));

        service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillParameterCreateRequest(
                "by_level",
                "按角色等级",
                SkillParameterValueType.INTEGER,
                SkillParameterValueMode.CHARACTER_LEVEL,
                null,
                Map.of("1", BigDecimal.ONE, "2", new BigDecimal("2")),
                null,
                1
            )
        );

        InOrder order = inOrder(parameterMapper, skillMapper);
        order.verify(parameterMapper).lockGame(GAME_ID);
        order.verify(parameterMapper).findLevelConfigForUpdate(GAME_ID);
        order.verify(skillMapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
    }

    @Test
    void rejectsIncompleteMapsIntegersModeMismatchAndRuntimeValues() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill(5));

        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillParameterCreateRequest(
                    PARAMETER_KEY,
                    "基础伤害",
                    SkillParameterValueType.DECIMAL,
                    SkillParameterValueMode.SKILL_LEVEL,
                    null,
                    Map.of("1", BigDecimal.ONE, "2", BigDecimal.TEN),
                    null,
                    10
                )
            )
        );

        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillParameterCreateRequest(
                    "stacks",
                    "层数",
                    SkillParameterValueType.INTEGER,
                    SkillParameterValueMode.FIXED,
                    new BigDecimal("1.5"),
                    null,
                    null,
                    1
                )
            )
        );

        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillParameterCreateRequest(
                    "current_stacks",
                    "当前层数",
                    SkillParameterValueType.INTEGER,
                    SkillParameterValueMode.RUNTIME_INPUT,
                    BigDecimal.ONE,
                    null,
                    null,
                    1
                )
            )
        );

        when(parameterMapper.lockGame(GAME_ID)).thenReturn(1);
        when(parameterMapper.findLevelConfigForUpdate(GAME_ID)).thenReturn(null);
        assertCode(
            "409.LEVEL_CONFIG_REQUIRED",
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillParameterCreateRequest(
                    "by_level",
                    "按角色等级",
                    SkillParameterValueType.INTEGER,
                    SkillParameterValueMode.CHARACTER_LEVEL,
                    null,
                    Map.of("1", BigDecimal.ONE),
                    null,
                    1
                )
            )
        );
    }

    @Test
    void updateSwitchesModeWithFullReplacementAndRejectsImmutableKey() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill(5));
        when(parameterMapper.findByIdForUpdate(GAME_ID, SKILL_KEY, PARAMETER_KEY))
            .thenReturn(row(
                PARAMETER_KEY,
                SkillParameterValueType.DECIMAL,
                SkillParameterValueMode.SKILL_LEVEL,
                null,
                "{\"1\":20,\"2\":45,\"3\":70,\"4\":95,\"5\":120}"
            ));
        when(parameterMapper.update(
            eq(GAME_ID), eq(SKILL_KEY), eq(PARAMETER_KEY), eq("固定伤害"),
            eq("DECIMAL"), eq("FIXED"), eq(new BigDecimal("8")), isNull(), isNull(), eq(10)
        )).thenReturn(1);
        when(parameterMapper.findById(GAME_ID, SKILL_KEY, PARAMETER_KEY)).thenReturn(row(
            PARAMETER_KEY,
            SkillParameterValueType.DECIMAL,
            SkillParameterValueMode.FIXED,
            new BigDecimal("8"),
            null
        ));

        SkillParameterResponse updated = service.update(
            GAME_ID,
            SKILL_KEY,
            PARAMETER_KEY,
            new SkillParameterUpdateRequest(
                null,
                "固定伤害",
                SkillParameterValueType.DECIMAL,
                SkillParameterValueMode.FIXED,
                new BigDecimal("8"),
                null,
                null,
                10
            )
        );
        assertEquals(SkillParameterValueMode.FIXED, updated.valueMode());
        assertEquals(new BigDecimal("8"), updated.fixedValue());

        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                PARAMETER_KEY,
                new SkillParameterUpdateRequest(
                    PARAMETER_KEY,
                    "固定伤害",
                    SkillParameterValueType.DECIMAL,
                    SkillParameterValueMode.FIXED,
                    new BigDecimal("8"),
                    null,
                    null,
                    10
                )
            )
        );
    }

    @Test
    void deleteChecksReferencesAndMapsConstraintConflicts() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill(5));
        when(parameterMapper.findByIdForUpdate(GAME_ID, SKILL_KEY, PARAMETER_KEY))
            .thenReturn(row(
                PARAMETER_KEY,
                SkillParameterValueType.DECIMAL,
                SkillParameterValueMode.FIXED,
                BigDecimal.ONE,
                null
            ));
        when(parameterMapper.countFormulaReferences(GAME_ID, SKILL_KEY, PARAMETER_KEY)).thenReturn(1L);
        assertCode("409.SKILL_PARAMETER_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, PARAMETER_KEY));
        verify(parameterMapper, never()).delete(anyString(), anyString(), anyString());

        when(parameterMapper.countFormulaReferences(GAME_ID, SKILL_KEY, PARAMETER_KEY)).thenReturn(0L);
        when(parameterMapper.delete(GAME_ID, SKILL_KEY, PARAMETER_KEY)).thenReturn(1);
        service.delete(GAME_ID, SKILL_KEY, PARAMETER_KEY);

        InOrder order = inOrder(skillMapper, parameterMapper);
        order.verify(skillMapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(parameterMapper).findByIdForUpdate(GAME_ID, SKILL_KEY, PARAMETER_KEY);
        order.verify(parameterMapper).countFormulaReferences(GAME_ID, SKILL_KEY, PARAMETER_KEY);
        order.verify(parameterMapper).delete(GAME_ID, SKILL_KEY, PARAMETER_KEY);

        when(parameterMapper.countByKey(GAME_ID, SKILL_KEY, "dup")).thenReturn(0L);
        when(parameterMapper.insert(
            anyString(), anyString(), anyString(), anyString(),
            anyString(), anyString(), any(), any(), any(), anyInt()
        )).thenThrow(new DataIntegrityViolationException("violates pk_skill_parameters"));
        assertCode(
            "409.SKILL_PARAMETER_KEY_EXISTS",
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillParameterCreateRequest(
                    "dup",
                    "重复",
                    SkillParameterValueType.DECIMAL,
                    SkillParameterValueMode.FIXED,
                    BigDecimal.ONE,
                    null,
                    null,
                    1
                )
            )
        );
    }

    @Test
    void nonCharacterWritesLockParentSkillFirst() {
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill(5));
        when(parameterMapper.countByKey(GAME_ID, SKILL_KEY, "ratio")).thenReturn(0L);
        when(parameterMapper.insert(
            eq(GAME_ID), eq(SKILL_KEY), eq("ratio"), eq("系数"),
            eq("DECIMAL"), eq("FIXED"), eq(BigDecimal.ONE), isNull(), isNull(), eq(1)
        )).thenReturn(1);
        when(parameterMapper.findById(GAME_ID, SKILL_KEY, "ratio")).thenReturn(row(
            "ratio",
            SkillParameterValueType.DECIMAL,
            SkillParameterValueMode.FIXED,
            BigDecimal.ONE,
            null
        ));

        service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillParameterCreateRequest(
                "ratio",
                "系数",
                SkillParameterValueType.DECIMAL,
                SkillParameterValueMode.FIXED,
                BigDecimal.ONE,
                null,
                null,
                1
            )
        );

        InOrder order = inOrder(skillMapper, parameterMapper);
        order.verify(skillMapper).findByIdForUpdate(GAME_ID, SKILL_KEY);
        order.verify(parameterMapper).insert(
            eq(GAME_ID), eq(SKILL_KEY), eq("ratio"), eq("系数"),
            eq("DECIMAL"), eq("FIXED"), eq(BigDecimal.ONE), isNull(), isNull(), eq(1)
        );
        verify(parameterMapper, never()).lockGame(anyString());
    }

    @Test
    void triggerRuleProtectsParameterDeleteAfterFormulaCheckWithLongConstructor() {
        xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService triggerRuleService =
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService.class);
        SkillParameterService guarded = new SkillParameterService(
            gamesMapper, skillMapper, parameterMapper, levelService, triggerRuleService
        , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill(5));
        when(parameterMapper.findByIdForUpdate(GAME_ID, SKILL_KEY, PARAMETER_KEY)).thenReturn(row(
            PARAMETER_KEY, SkillParameterValueType.DECIMAL, SkillParameterValueMode.FIXED, java.math.BigDecimal.ONE, null
        ));
        when(parameterMapper.countFormulaReferences(GAME_ID, SKILL_KEY, PARAMETER_KEY)).thenReturn(0L);
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_PARAMETER_IN_USE",
            "技能参数仍被触发规则引用，不能删除",
            Map.of("fieldIssues", List.of(Map.of("field", "parameterKey", "code", "TRIGGER_RULE_PARAMETER_IN_USE")))
        )).when(triggerRuleService).assertParameterDeletable(GAME_ID, SKILL_KEY, PARAMETER_KEY);
        assertCode("409.SKILL_PARAMETER_IN_USE", () -> guarded.delete(GAME_ID, SKILL_KEY, PARAMETER_KEY));
        verify(parameterMapper, never()).delete(anyString(), anyString(), anyString());
    }

    private static Map<String, BigDecimal> levelMap(int... values) {
        Map<String, BigDecimal> map = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i++) {
            map.put(Integer.toString(i + 1), BigDecimal.valueOf(values[i]));
        }
        return map;
    }

    private static SkillRow skill(int maxLevel) {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillRow(
            GAME_ID, SKILL_KEY, "秘术射击", null, maxLevel, SkillStatus.ENABLED, 10, timestamp, timestamp
        );
    }

    private static SkillParameterRow row(
        String parameterKey,
        SkillParameterValueType valueType,
        SkillParameterValueMode valueMode,
        BigDecimal fixedValue,
        String levelValuesJson
    ) {
        OffsetDateTime timestamp = OffsetDateTime.parse("2026-08-26T08:00:00Z");
        return new SkillParameterRow(
            GAME_ID,
            SKILL_KEY,
            parameterKey,
            parameterKey,
            valueType,
            valueMode,
            fixedValue,
            levelValuesJson,
            null,
            10,
            timestamp,
            timestamp
        );
    }

    private static void assertCode(String code, Runnable action) {
        ApiException exception = assertThrows(ApiException.class, action::run);
        assertEquals(code, exception.getCode());
    }
}
