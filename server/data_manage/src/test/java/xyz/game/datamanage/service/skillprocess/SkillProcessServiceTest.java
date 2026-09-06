package xyz.game.datamanage.service.skillprocess;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import xyz.game.datamanage.support.authoring.AggregateJson;
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
import xyz.game.datamanage.mapper.skillprocess.SkillProcessMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessChannelStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessChargeStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessCooldown;
import xyz.game.datamanage.model.skillprocess.SkillProcessCreateRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessDelayStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessDetailResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessEffectBindingRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessEmpoweredAttackStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessEmpoweredConsumeMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessFirstExecution;
import xyz.game.datamanage.model.skillprocess.SkillProcessImmediateStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessInternalStateLockRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMultiHitStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessPeriodicStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessRecastStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skillprocess.SkillProcessUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillProcessServiceTest {

    private static final String GAME_ID = "lol";
    private static final String SKILL_KEY = "ezreal_q";
    private static final String PROCESS_KEY = "cast";
    private static final String FORMULA_KEY = "base_damage";
    private static final String EFFECT_KEY = "on_hit_results";
    private static final OffsetDateTime TS = OffsetDateTime.parse("2026-08-28T00:00:00Z");

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillProcessMapper mapper;

    private SkillProcessService service;
    private SkillProcessRow stored;

    @BeforeEach
    void setUp() {
        service = new SkillProcessService(gamesMapper, skillMapper, mapper, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
        when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> List.copyOf(invocation.getArgument(2)));
        when(mapper.lockEffects(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> List.copyOf(invocation.getArgument(2)));
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(new SkillProcessInternalStateLockRow("mark_stacks", SkillInternalStateType.COUNTER)));
        when(mapper.insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(inv -> {
            stored = new SkillProcessRow(inv.getArgument(0), inv.getArgument(1), inv.getArgument(2),
                inv.getArgument(3), inv.getArgument(4), inv.getArgument(5), inv.getArgument(6), TS, TS,
                inv.getArgument(7), inv.getArgument(8), inv.getArgument(9), inv.getArgument(10));
            return 1;
        });
        when(mapper.updateProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(inv -> {
            stored = new SkillProcessRow(inv.getArgument(0), inv.getArgument(1), inv.getArgument(2),
                inv.getArgument(3), inv.getArgument(4), inv.getArgument(5), inv.getArgument(6), TS, TS,
                inv.getArgument(7), inv.getArgument(8), inv.getArgument(9), inv.getArgument(10));
            return 1;
        });
        when(mapper.findProcess(any(), any(), any())).thenAnswer(inv -> stored);
    }

    @Test
    void emptyBindingsAndOperationsReturnDualFieldErrorBeforeDatabaseWrites() {
        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillProcessCreateRequest(
                    PROCESS_KEY,
                    "施放",
                    SkillProcessActivationType.ACTIVE,
                    null,
                    0,
                    null,
                    List.of(immediateStep()),
                    List.of(),
                    List.of()
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", exception.getCode());
        assertField(exception, "effectBindings", "PROCESS_BEHAVIOR_REQUIRED");
        assertField(exception, "stateOperations", "PROCESS_BEHAVIOR_REQUIRED");
        verify(skillMapper, never()).findByIdForUpdate(any(), any());
        verify(mapper, never()).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
        verify(mapper, never()).lockFormulas(any(), any(), any());
        verify(mapper, never()).lockEffects(any(), any(), any());
    }

    @Test
    void createsEightStepKindsWithCooldownBindingAndOperation() {
        SkillProcessDetailResponse created = service.create(GAME_ID, SKILL_KEY, eightStepCreate());
        assertEquals(8, created.steps().size());
        assertEquals(SkillProcessStepType.IMMEDIATE, created.steps().get(0).stepType());
        assertInstanceOf(SkillProcessImmediateStepDetail.class, created.steps().get(0).detail());
        assertInstanceOf(SkillProcessDelayStepDetail.class, created.steps().get(1).detail());
        assertInstanceOf(SkillProcessMultiHitStepDetail.class, created.steps().get(2).detail());
        assertInstanceOf(SkillProcessPeriodicStepDetail.class, created.steps().get(3).detail());
        assertInstanceOf(SkillProcessChannelStepDetail.class, created.steps().get(4).detail());
        assertInstanceOf(SkillProcessChargeStepDetail.class, created.steps().get(5).detail());
        assertInstanceOf(SkillProcessRecastStepDetail.class, created.steps().get(6).detail());
        assertInstanceOf(SkillProcessEmpoweredAttackStepDetail.class, created.steps().get(7).detail());
        assertEquals(FORMULA_KEY, created.cooldown().durationFormulaKey());
        assertEquals(SkillProcessMomentType.PROCESS_COMPLETE, created.cooldown().startMoment().momentType());
        assertNull(created.cooldown().startMoment().stepKey());
        assertEquals(1, created.effectBindings().size());
        assertEquals(1, created.stateOperations().size());
        verify(mapper).insertProcess(
            eq(GAME_ID), eq(SKILL_KEY), eq(PROCESS_KEY), eq("完整过程"), eq(SkillProcessActivationType.ACTIVE), eq(null), eq(0),
            any(), any(), any(), any()
        );
        assertEquals(AggregateJson.tree(AggregateJson.write(eightStepCreate().steps())), AggregateJson.tree(stored.stepsJson()));
        assertEquals(created, service.get(GAME_ID, SKILL_KEY, PROCESS_KEY));
    }

    @Test
    void rejectsCorruptStoredStepDetailAndUnresolvedLocalMoment() {
        stored = new SkillProcessRow(GAME_ID, SKILL_KEY, PROCESS_KEY, "施放", SkillProcessActivationType.ACTIVE,
            null, 0, TS, TS,
            "[{\"stepKey\":\"cast\",\"name\":\"延迟\",\"stepType\":\"DELAY\",\"sortOrder\":0,\"detail\":{}}]",
            null, AggregateJson.write(immediateCreate().effectBindings()), "[]");
        ApiException detail = assertThrows(ApiException.class, () -> service.get(GAME_ID, SKILL_KEY, PROCESS_KEY));
        assertEquals("500.INTERNAL_ERROR", detail.getCode());
        stored = new SkillProcessRow(GAME_ID, SKILL_KEY, PROCESS_KEY, "施放", SkillProcessActivationType.ACTIVE,
            null, 0, TS, TS, AggregateJson.write(immediateCreate().steps()), null,
            AggregateJson.write(List.of(new SkillProcessEffectBindingRequest("hit", EFFECT_KEY,
                new SkillProcessMoment(SkillProcessMomentType.STEP_COMPLETE, "missing_step"), 0))), "[]");
        ApiException moment = assertThrows(ApiException.class, () -> service.get(GAME_ID, SKILL_KEY, PROCESS_KEY));
        assertEquals("500.INTERNAL_ERROR", moment.getCode());
    }

    @Test
    void returnsAllUnknownReferencesTogetherAndRejectsCrossSkillKeys() {
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        when(mapper.lockEffects(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        when(mapper.lockModeOptions(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        when(mapper.countByKey(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(0L);

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillProcessCreateRequest(
                    PROCESS_KEY,
                    "施放",
                    SkillProcessActivationType.ACTIVE,
                    null,
                    0,
                    new SkillProcessCooldown(
                        "other_skill_formula",
                        new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null)
                    ),
                    List.of(immediateStep()),
                    List.of(new SkillProcessEffectBindingRequest(
                        "hit",
                        "other_skill_effect",
                        new SkillProcessMoment(SkillProcessMomentType.STEP_START, "missing_step"),
                        0
                    )),
                    List.of(new SkillProcessStateOperationRequest(
                        "select_mode",
                        "切姿态",
                        "other_state",
                        SkillProcessStateOperationKind.SELECT,
                        null,
                        "missing_option",
                        new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null),
                        0
                    ))
                )
            )
        );
        assertEquals("400.INVALID_SKILL_PROCESS_REFERENCE", exception.getCode());
        assertField(exception, "cooldown.durationFormulaKey", "UNKNOWN_FORMULA");
        assertField(exception, "effectBindings[0].effectKey", "UNKNOWN_EFFECT");
        assertField(exception, "effectBindings[0].moment.stepKey", "UNKNOWN_STEP");
        assertField(exception, "stateOperations[0].stateKey", "UNKNOWN_INTERNAL_STATE");
        assertField(exception, "stateOperations[0].optionKey", "UNKNOWN_MODE_OPTION");
        verify(mapper, never()).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void updateRejectsRemovedStepStillReferencedByMoment() {
        when(mapper.findProcessForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(processRow());
        when(mapper.listStepsForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(List.of(
            stepRow("cast", SkillProcessStepType.IMMEDIATE),
            stepRow("windup", SkillProcessStepType.DELAY)
        ));
        when(mapper.listOperationsForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(List.of());

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                PROCESS_KEY,
                new SkillProcessUpdateRequest(
                    null,
                    "施放",
                    SkillProcessActivationType.ACTIVE,
                    null,
                    0,
                    null,
                    List.of(immediateStep()),
                    List.of(new SkillProcessEffectBindingRequest(
                        "hit",
                        EFFECT_KEY,
                        new SkillProcessMoment(SkillProcessMomentType.STEP_COMPLETE, "windup"),
                        0
                    )),
                    List.of()
                )
            )
        );
        assertEquals("400.INVALID_SKILL_PROCESS_REFERENCE", exception.getCode());
        assertField(exception, "effectBindings[0].moment.stepKey", "UNKNOWN_STEP");
        verify(mapper, never()).updateProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void updateReplacesCompleteAggregateInOneWrite() {
        when(mapper.findProcessForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(processRow());
        when(mapper.listStepsForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(List.of(
            stepRow("cast", SkillProcessStepType.IMMEDIATE),
            stepRow("windup", SkillProcessStepType.DELAY)
        ));
        when(mapper.listOperationsForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(List.of());

        service.update(
            GAME_ID,
            SKILL_KEY,
            PROCESS_KEY,
            new SkillProcessUpdateRequest(
                null,
                "施放",
                SkillProcessActivationType.ACTIVE,
                null,
                1,
                null,
                List.of(immediateStep()),
                List.of(processStartBinding()),
                List.of()
            )
        );

        verify(mapper).updateProcess(eq(GAME_ID), eq(SKILL_KEY), eq(PROCESS_KEY), eq("施放"),
            eq(SkillProcessActivationType.ACTIVE), eq(null), eq(1), any(), eq(null), any(), any());
        assertEquals(1, AggregateJson.tree(stored.stepsJson()).size());
        assertEquals("cast", AggregateJson.tree(stored.stepsJson()).get(0).get("stepKey").asText());
        assertNull(stored.cooldownJson());
        assertEquals("[]", stored.stateOperationsJson());
    }

    @Test
    void rejectsImmutableStepTypeAndOperationKind() {
        when(mapper.findProcessForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(processRow());
        when(mapper.listStepsForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(List.of(
            stepRow("cast", SkillProcessStepType.IMMEDIATE)
        ));
        when(mapper.listOperationsForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(List.of(
            new xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationRow(
                GAME_ID, SKILL_KEY, PROCESS_KEY, "add_mark", "叠层", "mark_stacks",
                SkillProcessStateOperationKind.INCREASE, FORMULA_KEY, null,
                SkillProcessMomentType.PROCESS_START, null, 0
            )
        ));

        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.update(
                GAME_ID,
                SKILL_KEY,
                PROCESS_KEY,
                new SkillProcessUpdateRequest(
                    null,
                    "施放",
                    SkillProcessActivationType.ACTIVE,
                    null,
                    0,
                    null,
                    List.of(new SkillProcessStepRequest(
                        "cast",
                        "延迟",
                        SkillProcessStepType.DELAY,
                        null,
                        0,
                        new SkillProcessDelayStepDetail(FORMULA_KEY)
                    )),
                    List.of(),
                    List.of(new SkillProcessStateOperationRequest(
                        "add_mark",
                        "叠层",
                        "mark_stacks",
                        SkillProcessStateOperationKind.RESET,
                        null,
                        null,
                        new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null),
                        0
                    ))
                )
            )
        );
        assertEquals("400.VALIDATION_FAILED", exception.getCode());
        assertField(exception, "steps[0].stepType", "IMMUTABLE");
        assertField(exception, "stateOperations[0].operation", "IMMUTABLE");
        verify(mapper, never()).updateProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void createRollsBackWhenInsertFails() {
        when(mapper.countByKey(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(0L);
        when(mapper.insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenThrow(new DataIntegrityViolationException("root_write_failed"));

        assertThrows(
            DataIntegrityViolationException.class,
            () -> service.create(GAME_ID, SKILL_KEY, immediateCreate())
        );
        verify(mapper).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
        verify(mapper, never()).findProcess(any(), any(), any());
    }

    @Test
    void mutexDetailFieldsReturnInvalidBodyBeforeWrites() {
        ApiException exception = assertThrows(
            ApiException.class,
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                new SkillProcessCreateRequest(
                    PROCESS_KEY,
                    "施放",
                    SkillProcessActivationType.ACTIVE,
                    null,
                    0,
                    null,
                    List.of(new SkillProcessStepRequest(
                        "cast",
                        "立即",
                        SkillProcessStepType.IMMEDIATE,
                        null,
                        0,
                        new SkillProcessImmediateStepDetail(Set.of("delayFormulaKey"), Set.of())
                    )),
                    List.of(processStartBinding()),
                    List.of()
                )
            )
        );
        assertEquals("400.INVALID_BODY", exception.getCode());
        assertField(exception, "steps[0].detail.delayFormulaKey", "FIELD_MUTEX");
        verify(mapper, never()).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void triggerRuleProtectsProcessDeleteStepRemovalAndCycleWithLongConstructor() {
        xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService triggerRuleService =
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService.class);
        SkillProcessService guarded = new SkillProcessService(gamesMapper, skillMapper, mapper, triggerRuleService, org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(mapper.findProcessForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(processRow());
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_PROCESS_IN_USE",
            "技能过程仍被触发规则引用，不能删除",
            Map.of("fieldIssues", List.of(Map.of("field", "processKey", "code", "TRIGGER_RULE_PROCESS_IN_USE")))
        )).when(triggerRuleService).assertProcessDeletable(GAME_ID, SKILL_KEY, PROCESS_KEY);
        ApiException deletable = assertThrows(ApiException.class, () -> guarded.delete(GAME_ID, SKILL_KEY, PROCESS_KEY));
        assertEquals("409.SKILL_PROCESS_IN_USE", deletable.getCode());
        assertField(deletable, "processKey", "TRIGGER_RULE_PROCESS_IN_USE");
        verify(mapper, never()).deleteProcess(any(), any(), any());

        org.mockito.Mockito.reset(triggerRuleService);
        when(mapper.listStepsForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(List.of(
            stepRow("cast", SkillProcessStepType.IMMEDIATE),
            stepRow("windup", SkillProcessStepType.DELAY)
        ));
        when(mapper.listOperationsForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(List.of());
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_PROCESS_IN_USE",
            "技能过程或步骤仍被触发规则引用",
            Map.of("fieldIssues", List.of(Map.of("field", "steps", "code", "TRIGGER_RULE_STEP_IN_USE")))
        )).when(triggerRuleService).assertStepsNotReferenced(eq(GAME_ID), eq(SKILL_KEY), eq(PROCESS_KEY), anyCollection());
        ApiException steps = assertThrows(
            ApiException.class,
            () -> guarded.update(
                GAME_ID, SKILL_KEY, PROCESS_KEY,
                new SkillProcessUpdateRequest(
                    null, "施放", SkillProcessActivationType.ACTIVE, null, 1, null,
                    List.of(immediateStep()), List.of(processStartBinding()), List.of()
                )
            )
        );
        assertEquals("409.SKILL_PROCESS_IN_USE", steps.getCode());
        assertField(steps, "steps", "TRIGGER_RULE_STEP_IN_USE");

        org.mockito.Mockito.reset(triggerRuleService);
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.BAD_REQUEST,
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            "触发规则存在未受保护的循环",
            Map.of()
        )).when(triggerRuleService).assertCurrentSkillCycle(GAME_ID, SKILL_KEY);
        ApiException cycle = assertThrows(
            ApiException.class,
            () -> guarded.update(
                GAME_ID, SKILL_KEY, PROCESS_KEY,
                new SkillProcessUpdateRequest(
                    null, "施放", SkillProcessActivationType.ACTIVE, null, 1, null,
                    List.of(immediateStep()), List.of(processStartBinding()), List.of()
                )
            )
        );
        assertEquals("400.TRIGGER_RULE_CYCLE_UNGUARDED", cycle.getCode());
    }

    private SkillProcessCreateRequest eightStepCreate() {
        when(mapper.countByKey(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(0L);
        return new SkillProcessCreateRequest(
            PROCESS_KEY,
            "完整过程",
            SkillProcessActivationType.ACTIVE,
            null,
            0,
            new SkillProcessCooldown(
                FORMULA_KEY,
                new SkillProcessMoment(SkillProcessMomentType.PROCESS_COMPLETE, null)
            ),
            List.of(
                immediateStep(),
                new SkillProcessStepRequest(
                    "delay", "延迟", SkillProcessStepType.DELAY, null, 1,
                    new SkillProcessDelayStepDetail(FORMULA_KEY)
                ),
                new SkillProcessStepRequest(
                    "multi", "多段", SkillProcessStepType.MULTI_HIT, null, 2,
                    new SkillProcessMultiHitStepDetail(FORMULA_KEY, null)
                ),
                new SkillProcessStepRequest(
                    "tick", "周期", SkillProcessStepType.PERIODIC, null, 3,
                    new SkillProcessPeriodicStepDetail(
                        FORMULA_KEY, FORMULA_KEY, SkillProcessFirstExecution.IMMEDIATE
                    )
                ),
                new SkillProcessStepRequest(
                    "channel", "引导", SkillProcessStepType.CHANNEL, null, 4,
                    new SkillProcessChannelStepDetail(
                        FORMULA_KEY, FORMULA_KEY, SkillProcessFirstExecution.AFTER_INTERVAL
                    )
                ),
                new SkillProcessStepRequest(
                    "charge", "蓄力", SkillProcessStepType.CHARGE, null, 5,
                    new SkillProcessChargeStepDetail(FORMULA_KEY, FORMULA_KEY, true)
                ),
                new SkillProcessStepRequest(
                    "recast", "重施", SkillProcessStepType.RECAST, null, 6,
                    new SkillProcessRecastStepDetail(FORMULA_KEY, FORMULA_KEY)
                ),
                new SkillProcessStepRequest(
                    "empower", "强化普攻", SkillProcessStepType.EMPOWERED_BASIC_ATTACK, null, 7,
                    new SkillProcessEmpoweredAttackStepDetail(
                        FORMULA_KEY, SkillProcessEmpoweredConsumeMoment.ATTACK_HIT
                    )
                )
            ),
            List.of(processStartBinding()),
            List.of(new SkillProcessStateOperationRequest(
                "add_mark",
                "叠层",
                "mark_stacks",
                SkillProcessStateOperationKind.INCREASE,
                FORMULA_KEY,
                null,
                new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null),
                0
            ))
        );
    }

    private static SkillProcessCreateRequest immediateCreate() {
        return new SkillProcessCreateRequest(
            PROCESS_KEY,
            "施放",
            SkillProcessActivationType.ACTIVE,
            null,
            0,
            null,
            List.of(immediateStep()),
            List.of(processStartBinding()),
            List.of()
        );
    }

    private static SkillProcessStepRequest immediateStep() {
        return new SkillProcessStepRequest(
            "cast", "立即", SkillProcessStepType.IMMEDIATE, null, 0, new SkillProcessImmediateStepDetail()
        );
    }

    private static SkillProcessEffectBindingRequest processStartBinding() {
        return new SkillProcessEffectBindingRequest(
            "hit",
            EFFECT_KEY,
            new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null),
            0
        );
    }

    private static SkillProcessStepRow stepRow(String stepKey, SkillProcessStepType type) {
        return new SkillProcessStepRow(GAME_ID, SKILL_KEY, PROCESS_KEY, stepKey, stepKey, type, null, 0);
    }

    private static SkillProcessRow processRow() {
        return new SkillProcessRow(
            GAME_ID, SKILL_KEY, PROCESS_KEY, "施放", SkillProcessActivationType.ACTIVE, null, 0, TS, TS,
            AggregateJson.write(immediateCreate().steps()), null,
            AggregateJson.write(immediateCreate().effectBindings()), "[]"
        );
    }

    private static SkillRow skill() {
        return new SkillRow(GAME_ID, SKILL_KEY, "秘术射击", null, 5, SkillStatus.ENABLED, 10, TS, TS);
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
