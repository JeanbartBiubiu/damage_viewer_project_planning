package xyz.game.datamanage.service.skillinternalstate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataIntegrityViolationException;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillinternalstate.SkillInternalStateMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoRecoveryMode;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCooldownDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCooldownDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCreateRequest;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetailResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateFlagDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateFlagDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateModeDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateModeOption;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateModeOptionRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateScope;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateSummaryResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillInternalStateServiceTest {

    private static final String GAME_ID = "lol";
    private static final String SKILL_KEY = "ezreal_q";
    private static final String STATE_KEY = "mark_stacks";
    private static final String FORMULA_KEY = "base_damage";
    private static final OffsetDateTime TS = OffsetDateTime.parse("2026-08-28T00:00:00Z");

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillInternalStateMapper mapper;

    private SkillInternalStateService service;

    @BeforeEach
    void setUp() {
        service = new SkillInternalStateService(gamesMapper, skillMapper, mapper);
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> List.copyOf(invocation.getArgument(2)));
    }

    @Test
    void listsSummariesWithoutNPlusOneDetailQueries() {
        when(mapper.listSummaries(GAME_ID, SKILL_KEY)).thenReturn(List.of(summary()));
        List<SkillInternalStateSummaryResponse> items = service.list(GAME_ID, SKILL_KEY);
        assertEquals(1, items.size());
        assertEquals(STATE_KEY, items.get(0).stateKey());
        verify(mapper, never()).findCounterDetail(any(), any(), any());
        verify(mapper, never()).listModeOptions(any(), any(), any());
    }

    @Test
    void createsAndReadsFiveStateKinds() {
        stubCreate(STATE_KEY);
        when(mapper.findState(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(stateRow(
            STATE_KEY, SkillInternalStateType.COUNTER, SkillInternalStateScope.TARGET
        ));
        when(mapper.findCounterDetail(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(
            new SkillInternalStateCounterDetailRow(GAME_ID, SKILL_KEY, STATE_KEY, FORMULA_KEY, "max_stacks")
        );

        SkillInternalStateDetailResponse counter = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillInternalStateCreateRequest(
                STATE_KEY,
                "印记层数",
                SkillInternalStateType.COUNTER,
                SkillInternalStateScope.TARGET,
                null,
                0,
                new SkillInternalStateCounterDetail(FORMULA_KEY, "max_stacks")
            )
        );
        assertEquals(SkillInternalStateType.COUNTER, counter.stateType());
        assertEquals(SkillInternalStateScope.TARGET, counter.scope());
        assertInstanceOf(SkillInternalStateCounterDetail.class, counter.detail());
        verify(mapper).insertCounterDetail(GAME_ID, SKILL_KEY, STATE_KEY, FORMULA_KEY, "max_stacks");

        stubCreate("ammo_clip");
        when(mapper.findState(GAME_ID, SKILL_KEY, "ammo_clip")).thenReturn(stateRow(
            "ammo_clip", SkillInternalStateType.AMMO, SkillInternalStateScope.SKILL
        ));
        when(mapper.findAmmoDetail(GAME_ID, SKILL_KEY, "ammo_clip")).thenReturn(
            new SkillInternalStateAmmoDetailRow(
                GAME_ID, SKILL_KEY, "ammo_clip", FORMULA_KEY, "max_ammo", "reload",
                SkillInternalStateAmmoRecoveryMode.ONE_BY_ONE
            )
        );
        SkillInternalStateDetailResponse ammo = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillInternalStateCreateRequest(
                "ammo_clip",
                "弹药",
                SkillInternalStateType.AMMO,
                SkillInternalStateScope.SKILL,
                null,
                1,
                new SkillInternalStateAmmoDetail(
                    FORMULA_KEY, "max_ammo", "reload", SkillInternalStateAmmoRecoveryMode.ONE_BY_ONE
                )
            )
        );
        assertInstanceOf(SkillInternalStateAmmoDetail.class, ammo.detail());

        org.mockito.Mockito.clearInvocations(mapper);
        stubCreate("stance");
        when(mapper.findState(GAME_ID, SKILL_KEY, "stance")).thenReturn(stateRow(
            "stance", SkillInternalStateType.MODE, SkillInternalStateScope.SKILL
        ));
        when(mapper.listModeOptions(GAME_ID, SKILL_KEY, "stance")).thenReturn(List.of(
            new SkillInternalStateModeOptionRow(GAME_ID, SKILL_KEY, "stance", "melee", "近战", 0, true),
            new SkillInternalStateModeOptionRow(GAME_ID, SKILL_KEY, "stance", "ranged", "远程", 1, false)
        ));
        SkillInternalStateDetailResponse mode = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillInternalStateCreateRequest(
                "stance",
                "姿态",
                SkillInternalStateType.MODE,
                SkillInternalStateScope.SKILL,
                null,
                2,
                modeDetail()
            )
        );
        assertInstanceOf(SkillInternalStateModeDetail.class, mode.detail());
        verify(mapper, never()).lockFormulas(any(), any(), any());

        stubCreate("ready");
        when(mapper.findState(GAME_ID, SKILL_KEY, "ready")).thenReturn(stateRow(
            "ready", SkillInternalStateType.FLAG, SkillInternalStateScope.SKILL
        ));
        when(mapper.findFlagDetail(GAME_ID, SKILL_KEY, "ready")).thenReturn(
            new SkillInternalStateFlagDetailRow(GAME_ID, SKILL_KEY, "ready", true)
        );
        assertInstanceOf(
            SkillInternalStateFlagDetail.class,
            service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillInternalStateCreateRequest(
                    "ready",
                    "就绪",
                    SkillInternalStateType.FLAG,
                    SkillInternalStateScope.SKILL,
                    null,
                    3,
                    new SkillInternalStateFlagDetail(true)
                )
            ).detail()
        );

        stubCreate("internal_cd");
        when(mapper.findState(GAME_ID, SKILL_KEY, "internal_cd")).thenReturn(stateRow(
            "internal_cd", SkillInternalStateType.INTERNAL_COOLDOWN, SkillInternalStateScope.SKILL
        ));
        when(mapper.findCooldownDetail(GAME_ID, SKILL_KEY, "internal_cd")).thenReturn(
            new SkillInternalStateCooldownDetailRow(GAME_ID, SKILL_KEY, "internal_cd", FORMULA_KEY)
        );
        assertInstanceOf(
            SkillInternalStateCooldownDetail.class,
            service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillInternalStateCreateRequest(
                    "internal_cd",
                    "内部冷却",
                    SkillInternalStateType.INTERNAL_COOLDOWN,
                    SkillInternalStateScope.SKILL,
                    null,
                    4,
                    new SkillInternalStateCooldownDetail(FORMULA_KEY)
                )
            ).detail()
        );
    }

    @Test
    void rejectsNonCounterTargetScopeAndIncompleteModeOptions() {
        ApiException scope = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillInternalStateCreateRequest(
                    "ammo_clip",
                    "弹药",
                    SkillInternalStateType.AMMO,
                    SkillInternalStateScope.TARGET,
                    null,
                    0,
                    new SkillInternalStateAmmoDetail(
                        FORMULA_KEY, "max_ammo", "reload", SkillInternalStateAmmoRecoveryMode.ALL_AT_ONCE
                    )
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", scope.getCode());
        assertField(scope, "scope", "SCOPE_INVALID");
        verify(mapper, never()).insertState(any(), any(), any(), any(), any(), any(), any(), any());

        ApiException options = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillInternalStateCreateRequest(
                    "stance",
                    "姿态",
                    SkillInternalStateType.MODE,
                    SkillInternalStateScope.SKILL,
                    null,
                    0,
                    new SkillInternalStateModeDetail(List.of(
                        new SkillInternalStateModeOption("melee", "近战", 0, true)
                    ))
                )
            )
        );
        assertField(options, "detail.options", "LENGTH_INVALID");

        ApiException initial = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillInternalStateCreateRequest(
                    "stance",
                    "姿态",
                    SkillInternalStateType.MODE,
                    SkillInternalStateScope.SKILL,
                    null,
                    0,
                    new SkillInternalStateModeDetail(List.of(
                        new SkillInternalStateModeOption("melee", "近战", 0, true),
                        new SkillInternalStateModeOption("ranged", "远程", 1, true)
                    ))
                )
            )
        );
        assertField(initial, "detail.options[0].initial", "INITIAL_INVALID");
        assertField(initial, "detail.options[1].initial", "INITIAL_INVALID");
    }

    @Test
    void rejectsUnknownFormulaWithStableFieldPath() {
        when(mapper.countByKey(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(0L);
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(GAME_ID, SKILL_KEY, counterCreate())
        );
        assertEquals("400.INVALID_SKILL_INTERNAL_STATE_REFERENCE", exception.getCode());
        assertField(exception, "detail.initialValueFormulaKey", "UNKNOWN_FORMULA");
        assertField(exception, "detail.maxValueFormulaKey", "UNKNOWN_FORMULA");
        verify(mapper, never()).insertState(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsImmutableTypeScopeAndStateKey() {
        when(mapper.findStateForUpdate(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(stateRow(
            STATE_KEY, SkillInternalStateType.COUNTER, SkillInternalStateScope.TARGET
        ));

        ApiException type = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                STATE_KEY,
                new SkillInternalStateUpdateRequest(
                    null,
                    "印记层数",
                    SkillInternalStateType.FLAG,
                    SkillInternalStateScope.SKILL,
                    null,
                    0,
                    new SkillInternalStateFlagDetail(true)
                )
            )
        );
        assertField(type, "stateType", "IMMUTABLE");

        ApiException scope = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                STATE_KEY,
                new SkillInternalStateUpdateRequest(
                    null,
                    "印记层数",
                    SkillInternalStateType.COUNTER,
                    SkillInternalStateScope.SKILL,
                    null,
                    0,
                    new SkillInternalStateCounterDetail(FORMULA_KEY, "max_stacks")
                )
            )
        );
        assertField(scope, "scope", "IMMUTABLE");

        assertCode(
            "400.VALIDATION_FAILED",
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                STATE_KEY,
                new SkillInternalStateUpdateRequest(
                    STATE_KEY,
                    "印记层数",
                    SkillInternalStateType.COUNTER,
                    SkillInternalStateScope.TARGET,
                    null,
                    0,
                    new SkillInternalStateCounterDetail(FORMULA_KEY, "max_stacks")
                )
            )
        );
        verify(mapper, never()).updateState(any(), any(), any(), any(), any(), any());
    }

    @Test
    void createRollsBackWhenInsertFailsAndDoesNotLeavePartialReads() {
        stubCreate(STATE_KEY);
        when(mapper.insertCounterDetail(any(), any(), any(), any(), any()))
            .thenThrow(new DataIntegrityViolationException("violates fk_skill_internal_counter_initial_formula"));

        assertThrows(
            DataIntegrityViolationException.class,
            () -> service.create(GAME_ID, SKILL_KEY, counterCreate())
        );
        verify(mapper).insertState(
            eq(GAME_ID), eq(SKILL_KEY), eq(STATE_KEY), any(), any(), any(), any(), any()
        );
        verify(mapper, never()).findState(any(), any(), any());
    }

    @Test
    void deleteProtectsReferencedStateAndMapsExactConstraint() {
        when(mapper.findStateForUpdate(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(stateRow(
            STATE_KEY, SkillInternalStateType.COUNTER, SkillInternalStateScope.TARGET
        ));
        when(mapper.countStateOperations(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(1L);
        assertCode("409.SKILL_INTERNAL_STATE_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, STATE_KEY));
        verify(mapper, never()).deleteState(any(), any(), any());

        when(mapper.countStateOperations(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(0L);
        when(mapper.deleteState(GAME_ID, SKILL_KEY, STATE_KEY)).thenThrow(
            new DataIntegrityViolationException(
                "violates foreign key constraint fk_skill_process_state_operations_state"
            )
        );
        assertCode("409.SKILL_INTERNAL_STATE_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, STATE_KEY));
    }

    @Test
    void removingReferencedModeOptionReturnsConflict() {
        when(mapper.findStateForUpdate(GAME_ID, SKILL_KEY, "stance")).thenReturn(stateRow(
            "stance", SkillInternalStateType.MODE, SkillInternalStateScope.SKILL
        ));
        when(mapper.listModeOptionsForUpdate(GAME_ID, SKILL_KEY, "stance")).thenReturn(List.of(
            new SkillInternalStateModeOptionRow(GAME_ID, SKILL_KEY, "stance", "melee", "近战", 0, true),
            new SkillInternalStateModeOptionRow(GAME_ID, SKILL_KEY, "stance", "ranged", "远程", 1, false)
        ));
        when(mapper.countOptionOperations(eq(GAME_ID), eq(SKILL_KEY), eq("stance"), anyCollection()))
            .thenReturn(1L);

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                "stance",
                new SkillInternalStateUpdateRequest(
                    null,
                    "姿态",
                    SkillInternalStateType.MODE,
                    SkillInternalStateScope.SKILL,
                    null,
                    0,
                    new SkillInternalStateModeDetail(List.of(
                        new SkillInternalStateModeOption("melee", "近战", 0, true),
                        new SkillInternalStateModeOption("magic", "法术", 1, false)
                    ))
                )
            )
        );
        assertEquals("409.SKILL_INTERNAL_STATE_OPTION_IN_USE", exception.getCode());
        verify(mapper, never()).deleteModeOptions(any(), any(), any(), any());
    }

    @Test
    void mutexDetailFieldsReturnInvalidBody() {
        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillInternalStateCreateRequest(
                    STATE_KEY,
                    "印记层数",
                    SkillInternalStateType.COUNTER,
                    SkillInternalStateScope.TARGET,
                    null,
                    0,
                    new SkillInternalStateCounterDetail(
                        FORMULA_KEY, "max_stacks", Set.of("initialEnabled"), Set.of()
                    )
                )
            )
        );
        assertEquals("400.INVALID_BODY", exception.getCode());
        assertField(exception, "detail.initialEnabled", "FIELD_MUTEX");
        verify(mapper, never()).insertState(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void assembleReturnsInternalErrorWhenShapeIsCorrupt() {
        when(mapper.findState(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(stateRow(
            STATE_KEY, SkillInternalStateType.COUNTER, SkillInternalStateScope.TARGET
        ));

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.get(GAME_ID, SKILL_KEY, STATE_KEY)
        );
        assertEquals("500.INTERNAL_ERROR", exception.getCode());
        assertEquals(GAME_ID, exception.getDetails().get("gameId"));
        assertEquals(SKILL_KEY, exception.getDetails().get("skillKey"));
        assertEquals(STATE_KEY, exception.getDetails().get("stateKey"));
    }

    @Test
    void triggerRuleProtectsStateDeleteAndOptionRemovalWithLongConstructor() {
        xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService triggerRuleService =
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService.class);
        SkillInternalStateService guarded = new SkillInternalStateService(
            gamesMapper, skillMapper, mapper, triggerRuleService
        );
        when(mapper.findStateForUpdate(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(stateRow(
            STATE_KEY, SkillInternalStateType.COUNTER, SkillInternalStateScope.TARGET
        ));
        when(mapper.countStateOperations(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(0L);
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_INTERNAL_STATE_IN_USE",
            "内部状态仍被触发规则引用，不能删除",
            Map.of("fieldIssues", List.of(Map.of("field", "stateKey", "code", "TRIGGER_RULE_INTERNAL_STATE_IN_USE")))
        )).when(triggerRuleService).assertInternalStateDeletable(GAME_ID, SKILL_KEY, STATE_KEY);
        ApiException state = assertThrows(ApiException.class, () -> guarded.delete(GAME_ID, SKILL_KEY, STATE_KEY));
        assertEquals("409.SKILL_INTERNAL_STATE_IN_USE", state.getCode());
        assertField(state, "stateKey", "TRIGGER_RULE_INTERNAL_STATE_IN_USE");
        verify(mapper, never()).deleteState(any(), any(), any());

        when(mapper.findStateForUpdate(GAME_ID, SKILL_KEY, "stance")).thenReturn(stateRow(
            "stance", SkillInternalStateType.MODE, SkillInternalStateScope.SKILL
        ));
        when(mapper.listModeOptionsForUpdate(GAME_ID, SKILL_KEY, "stance")).thenReturn(List.of(
            new SkillInternalStateModeOptionRow(GAME_ID, SKILL_KEY, "stance", "melee", "近战", 0, true),
            new SkillInternalStateModeOptionRow(GAME_ID, SKILL_KEY, "stance", "ranged", "远程", 1, false)
        ));
        when(mapper.countOptionOperations(eq(GAME_ID), eq(SKILL_KEY), eq("stance"), anyCollection())).thenReturn(0L);
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_INTERNAL_STATE_OPTION_IN_USE",
            "模式选项仍被触发规则引用，不能移除",
            Map.of("fieldIssues", List.of(Map.of("field", "detail.options", "code", "TRIGGER_RULE_OPTION_IN_USE")))
        )).when(triggerRuleService).assertOptionsNotReferenced(eq(GAME_ID), eq(SKILL_KEY), eq("stance"), anyCollection());
        ApiException option = assertThrows(
            ApiException.class,
            () -> guarded.update(
                GAME_ID, SKILL_KEY, "stance",
                new SkillInternalStateUpdateRequest(
                    null, "姿态", SkillInternalStateType.MODE, SkillInternalStateScope.SKILL, null, 0,
                    new SkillInternalStateModeDetail(List.of(
                        new SkillInternalStateModeOption("melee", "近战", 0, true),
                        new SkillInternalStateModeOption("magic", "法术", 1, false)
                    ))
                )
            )
        );
        assertEquals("409.SKILL_INTERNAL_STATE_OPTION_IN_USE", option.getCode());
        assertField(option, "detail.options", "TRIGGER_RULE_OPTION_IN_USE");
        verify(mapper, never()).deleteModeOptions(any(), any(), any(), any());
    }

    private void stubCreate(String stateKey) {
        when(mapper.countByKey(GAME_ID, SKILL_KEY, stateKey)).thenReturn(0L);
        when(mapper.insertState(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertCounterDetail(any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertAmmoDetail(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertFlagDetail(any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertCooldownDetail(any(), any(), any(), any())).thenReturn(1);
        when(mapper.insertModeOption(any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
    }

    private static SkillInternalStateCreateRequest counterCreate() {
        return new SkillInternalStateCreateRequest(
            STATE_KEY,
            "印记层数",
            SkillInternalStateType.COUNTER,
            SkillInternalStateScope.TARGET,
            null,
            0,
            new SkillInternalStateCounterDetail(FORMULA_KEY, "max_stacks")
        );
    }

    private static SkillInternalStateModeDetail modeDetail() {
        return new SkillInternalStateModeDetail(List.of(
            new SkillInternalStateModeOption("melee", "近战", 0, true),
            new SkillInternalStateModeOption("ranged", "远程", 1, false)
        ));
    }

    private static SkillInternalStateRow stateRow(
        String stateKey,
        SkillInternalStateType type,
        SkillInternalStateScope scope
    ) {
        return new SkillInternalStateRow(
            GAME_ID, SKILL_KEY, stateKey, stateKey, type, scope, null, 0, TS, TS
        );
    }

    private static SkillInternalStateSummaryResponse summary() {
        return new SkillInternalStateSummaryResponse(
            GAME_ID, SKILL_KEY, STATE_KEY, "印记层数",
            SkillInternalStateType.COUNTER, SkillInternalStateScope.TARGET, null, 0, TS, TS
        );
    }

    private static SkillRow skill() {
        return new SkillRow(GAME_ID, SKILL_KEY, "秘术射击", null, 5, SkillStatus.ENABLED, 10, TS, TS);
    }

    private static void assertCode(String code, Runnable action) {
        ApiException exception = assertThrows(ApiException.class, action::run);
        assertEquals(code, exception.getCode());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> fieldIssues(ApiException exception) {
        return (List<Map<String, String>>) exception.getDetails().get("fieldIssues");
    }

    private static void assertField(ApiException exception, String field, String code) {
        List<Map<String, String>> issues = fieldIssues(exception);
        assertTrue(
            issues.stream().anyMatch(issue -> field.equals(issue.get("field")) && code.equals(issue.get("code"))),
            () -> "expected " + field + "/" + code + " but was " + issues
        );
    }
}
