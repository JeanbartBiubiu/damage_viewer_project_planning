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
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoRecoveryMode;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCooldownDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCreateRequest;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetailResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateFlagDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateModeDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateModeOption;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateScope;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateSummaryResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateUpdateRequest;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.AggregateJson;
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
    private final Map<String, SkillInternalStateRow> stored = new java.util.HashMap<>();

    @BeforeEach
    void setUp() {
        when(mapper.insertState(any(), any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(inv -> {
            String key = inv.getArgument(2);
            stored.put(key, new SkillInternalStateRow(inv.getArgument(0), inv.getArgument(1), key,
                inv.getArgument(3), inv.getArgument(4), inv.getArgument(5), inv.getArgument(6),
                inv.getArgument(7), TS, TS, inv.getArgument(8)));
            return 1;
        });
        when(mapper.updateState(any(), any(), any(), any(), any(), any(), any())).thenAnswer(inv -> {
            String key = inv.getArgument(2);
            SkillInternalStateRow old = stored.get(key);
            stored.put(key, new SkillInternalStateRow(GAME_ID, SKILL_KEY, key, inv.getArgument(3),
                old.stateType(), old.scope(), inv.getArgument(4), inv.getArgument(5), TS, TS, inv.getArgument(6)));
            return 1;
        });
        when(mapper.findState(any(), any(), any())).thenAnswer(inv -> stored.get(inv.getArgument(2)));
        service = new SkillInternalStateService(gamesMapper, skillMapper, mapper, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
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
        verify(mapper, never()).findState(any(), any(), any());
    }

    @Test
    void createsAndReadsFiveStateKinds() {
        List<SkillInternalStateDetail> details = List.of(
            new SkillInternalStateCounterDetail(SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula("max_stacks")),
            new SkillInternalStateAmmoDetail(SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula("max_ammo"), SkillNumericValue.formula("reload"), SkillInternalStateAmmoRecoveryMode.ONE_BY_ONE),
            modeDetail(), new SkillInternalStateFlagDetail(true), new SkillInternalStateCooldownDetail(SkillNumericValue.formula(FORMULA_KEY))
        );
        List<SkillInternalStateType> types = List.of(SkillInternalStateType.COUNTER, SkillInternalStateType.AMMO,
            SkillInternalStateType.MODE, SkillInternalStateType.FLAG, SkillInternalStateType.INTERNAL_COOLDOWN);
        for (int i = 0; i < details.size(); i++) {
            String key = "state_" + i;
            SkillInternalStateDetailResponse created = service.create(GAME_ID, SKILL_KEY,
                new SkillInternalStateCreateRequest(key, "状态", types.get(i), SkillInternalStateScope.SKILL,
                    null, i, details.get(i)));
            assertInstanceOf(details.get(i).getClass(), created.detail());
            assertEquals(AggregateJson.tree(AggregateJson.write(details.get(i))),
                AggregateJson.tree(stored.get(key).detailJson()));
            assertEquals(created, service.get(GAME_ID, SKILL_KEY, key));
        }
    }

    @Test
    void updatesModeOptionsAsOneSortedDetailDocument() {
        service.create(GAME_ID, SKILL_KEY, new SkillInternalStateCreateRequest("stance", "姿态",
            SkillInternalStateType.MODE, SkillInternalStateScope.SKILL, null, 0, modeDetail()));
        when(mapper.findStateForUpdate(GAME_ID, SKILL_KEY, "stance")).thenReturn(stored.get("stance"));
        SkillInternalStateDetailResponse updated = service.update(GAME_ID, SKILL_KEY, "stance",
            new SkillInternalStateUpdateRequest(null, "姿态", SkillInternalStateType.MODE,
                SkillInternalStateScope.SKILL, null, 0, new SkillInternalStateModeDetail(List.of(
                    new SkillInternalStateModeOption("magic", "法术", 10, false),
                    new SkillInternalStateModeOption("melee", "近战", 0, true)
                ))));
        assertEquals(List.of("melee", "magic"), ((SkillInternalStateModeDetail) updated.detail()).options().stream()
            .map(SkillInternalStateModeOption::optionKey).toList());
        verify(mapper).countOptionOperations(GAME_ID, SKILL_KEY, "stance", List.of("ranged"));
        verify(mapper).updateState(eq(GAME_ID), eq(SKILL_KEY), eq("stance"), eq("姿态"), eq(null), eq(0), any());
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
                        SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula("max_ammo"), SkillNumericValue.formula("reload"), SkillInternalStateAmmoRecoveryMode.ALL_AT_ONCE
                    )
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", scope.getCode());
        assertField(scope, "scope", "SCOPE_INVALID");
        verify(mapper, never()).insertState(any(), any(), any(), any(), any(), any(), any(), any(), any());

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
        assertField(exception, "detail.initialValue", "UNKNOWN_FORMULA");
        assertField(exception, "detail.maxValue", "UNKNOWN_FORMULA");
        verify(mapper, never()).insertState(any(), any(), any(), any(), any(), any(), any(), any(), any());
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
                    new SkillInternalStateCounterDetail(SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula("max_stacks"))
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
                    new SkillInternalStateCounterDetail(SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula("max_stacks"))
                )
            )
        );
        verify(mapper, never()).updateState(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void createRollsBackWhenInsertFailsAndDoesNotLeavePartialReads() {
        stubCreate(STATE_KEY);
        when(mapper.insertState(any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenThrow(new DataIntegrityViolationException("root_write_failed"));

        assertThrows(
            DataIntegrityViolationException.class,
            () -> service.create(GAME_ID, SKILL_KEY, counterCreate())
        );
        verify(mapper).insertState(
            eq(GAME_ID), eq(SKILL_KEY), eq(STATE_KEY), any(), any(), any(), any(), any(), any()
        );
        verify(mapper, never()).findState(any(), any(), any());
    }

    @Test
    void deleteProtectsReferencedStateThenDeletesAfterReferencesAreRemoved() {
        when(mapper.findStateForUpdate(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(stateRow(
            STATE_KEY, SkillInternalStateType.COUNTER, SkillInternalStateScope.TARGET
        ));
        when(mapper.countStateOperations(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(1L);
        assertCode("409.SKILL_INTERNAL_STATE_IN_USE", () -> service.delete(GAME_ID, SKILL_KEY, STATE_KEY));
        verify(mapper, never()).deleteState(any(), any(), any());

        when(mapper.countStateOperations(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(0L);
        when(mapper.deleteState(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(1);
        service.delete(GAME_ID, SKILL_KEY, STATE_KEY);
        verify(mapper).deleteState(GAME_ID, SKILL_KEY, STATE_KEY);
    }

    @Test
    void removingReferencedModeOptionReturnsConflict() {
        when(mapper.findStateForUpdate(GAME_ID, SKILL_KEY, "stance")).thenReturn(stateRow(
            "stance", SkillInternalStateType.MODE, SkillInternalStateScope.SKILL
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
        verify(mapper, never()).updateState(any(), any(), any(), any(), any(), any(), any());
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
                        SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula("max_stacks"), Set.of("initialEnabled"), Set.of()
                    )
                )
            )
        );
        assertEquals("400.INVALID_BODY", exception.getCode());
        assertField(exception, "detail.initialEnabled", "FIELD_MUTEX");
        verify(mapper, never()).insertState(any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void assembleReturnsInternalErrorWhenShapeIsCorrupt() {
        when(mapper.findState(GAME_ID, SKILL_KEY, STATE_KEY)).thenReturn(new SkillInternalStateRow(
            GAME_ID, SKILL_KEY, STATE_KEY, "坏数据", SkillInternalStateType.COUNTER,
            SkillInternalStateScope.TARGET, null, 0, TS, TS, "{}"
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
        , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
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
        verify(mapper, never()).updateState(any(), any(), any(), any(), any(), any(), any());
    }

    private void stubCreate(String stateKey) {
        when(mapper.countByKey(GAME_ID, SKILL_KEY, stateKey)).thenReturn(0L);
    }

    private static SkillInternalStateCreateRequest counterCreate() {
        return new SkillInternalStateCreateRequest(
            STATE_KEY,
            "印记层数",
            SkillInternalStateType.COUNTER,
            SkillInternalStateScope.TARGET,
            null,
            0,
            new SkillInternalStateCounterDetail(SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula("max_stacks"))
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
            GAME_ID, SKILL_KEY, stateKey, stateKey, type, scope, null, 0, TS, TS,
            AggregateJson.write(type == SkillInternalStateType.MODE ? modeDetail()
                : new SkillInternalStateCounterDetail(SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula("max_stacks")))
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
