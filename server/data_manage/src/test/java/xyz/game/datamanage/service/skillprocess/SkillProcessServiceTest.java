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
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
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
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillProcessServiceTest {
    @Mock private xyz.game.datamanage.service.skilltrigger.SkillTriggerCycleValidator triggerCycles;

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

    @Test
    void candidateProjectionUsesTheSameNestedStorageOrderWithoutAnyDatabaseAccess() {
        var request = new SkillProcessCreateRequest(PROCESS_KEY, "施放", SkillProcessActivationType.ACTIVE,
            null, 0, null,
            List.of(new SkillProcessStepRequest("second", "后一步", SkillProcessStepType.IMMEDIATE, null, 20, false, new SkillProcessImmediateStepDetail()),
                new SkillProcessStepRequest("first", "前一步", SkillProcessStepType.IMMEDIATE, null, 10, false, new SkillProcessImmediateStepDetail())),
            List.of(new SkillProcessEffectBindingRequest("later", EFFECT_KEY, new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null), 20),
                new SkillProcessEffectBindingRequest("earlier", EFFECT_KEY, new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null), 10)),
            List.of());
        var projected = service.projectPrepared(GAME_ID, SKILL_KEY, service.prepareConfigurationCreate(request), null);
        assertEquals(List.of("first", "second"), projected.steps().stream().map(step -> step.stepKey()).toList());
        assertEquals(List.of("earlier", "later"), projected.effectBindings().stream().map(binding -> binding.bindingKey()).toList());
        org.mockito.Mockito.verifyNoInteractions(gamesMapper, skillMapper, mapper, triggerCycles);
    }

    @BeforeEach
    void setUp() {
        service = new SkillProcessService(
            gamesMapper,
            skillMapper,
            mapper,
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceGuard.class),
            triggerCycles,
            org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class)
        );
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
    void channelWindowCollectsBothFormulaReferencesAndPreservesAggregateReadback() {
        SkillProcessChannelStepDetail detail = new SkillProcessChannelStepDetail(
            SkillNumericValue.fixed(new java.math.BigDecimal("20")), SkillNumericValue.fixed(new java.math.BigDecimal("4")),
            SkillProcessFirstExecution.CUSTOM_WINDOW, SkillNumericValue.formula("first_window"), SkillNumericValue.formula("last_window"));
        SkillProcessCreateRequest request = new SkillProcessCreateRequest(PROCESS_KEY, "指定窗口", SkillProcessActivationType.ACTIVE,
            null, 0, null, List.of(new SkillProcessStepRequest("channel", "引导", SkillProcessStepType.CHANNEL, null, 0, true, detail)),
            List.of(processStartBinding()), List.of());
        SkillProcessDetailResponse response = service.create(GAME_ID, SKILL_KEY, request);
        verify(mapper).lockFormulas(GAME_ID, SKILL_KEY, List.of("first_window", "last_window"));
        assertEquals(detail, response.steps().getFirst().detail());
    }

    @Test
    void recastIntervalCollectsFormulaAndPreservesAggregateReadback() {
        var detail = new SkillProcessRecastStepDetail(SkillNumericValue.fixed(new java.math.BigDecimal("15000")),
            SkillNumericValue.fixed(new java.math.BigDecimal("2")), SkillNumericValue.formula("recast_interval"));
        var request = new SkillProcessCreateRequest(PROCESS_KEY, "有限重施", SkillProcessActivationType.ACTIVE, null, 0, null,
            List.of(new SkillProcessStepRequest("again", "重施窗口", SkillProcessStepType.RECAST, null, 0, false, detail)),
            List.of(processStartBinding()), List.of());
        var response = service.create(GAME_ID, SKILL_KEY, request);
        verify(mapper).lockFormulas(GAME_ID, SKILL_KEY, List.of("recast_interval"));
        assertEquals(detail, response.steps().getFirst().detail());
        assertEquals(response, service.get(GAME_ID, SKILL_KEY, PROCESS_KEY));
    }

    @Test
    void countedEmpoweredCollectsCountFormulaAndPreservesIndependentRead() {
        var detail = new SkillProcessEmpoweredAttackStepDetail(SkillNumericValue.fixed(new java.math.BigDecimal("6000")),
            SkillProcessEmpoweredConsumeMoment.ATTACK_START, SkillNumericValue.formula("maximum_attacks"));
        var request = new SkillProcessCreateRequest(PROCESS_KEY, "次数强化", SkillProcessActivationType.ACTIVE, null, 0, null,
            List.of(new SkillProcessStepRequest("empower", "次数窗口", SkillProcessStepType.EMPOWERED_BASIC_ATTACK, null, 0, false, detail)),
            List.of(processStartBinding()), List.of());
        var response = service.create(GAME_ID, SKILL_KEY, request);
        verify(mapper).lockFormulas(GAME_ID, SKILL_KEY, List.of("maximum_attacks"));
        assertEquals(detail, response.steps().getFirst().detail());
        assertEquals(response, service.get(GAME_ID, SKILL_KEY, PROCESS_KEY));
    }

    @Test
    void channelWindowMissingEndpointAndPeriodicCustomWindowRejectBeforeWrites() {
        SkillProcessChannelStepDetail detail = new SkillProcessChannelStepDetail(
            SkillNumericValue.fixed(java.math.BigDecimal.TEN), SkillNumericValue.fixed(java.math.BigDecimal.ONE),
            SkillProcessFirstExecution.CUSTOM_WINDOW, SkillNumericValue.fixed(java.math.BigDecimal.ZERO), null);
        SkillProcessCreateRequest request = new SkillProcessCreateRequest(PROCESS_KEY, "指定窗口", SkillProcessActivationType.ACTIVE,
            null, 0, null, List.of(new SkillProcessStepRequest("channel", "引导", SkillProcessStepType.CHANNEL, null, 0, true, detail)),
            List.of(processStartBinding()), List.of());
        ApiException error = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY, request));
        assertField(error, "steps[0].detail.lastExecutionOffsetValue", "REQUIRED");
        SkillProcessCreateRequest periodic = new SkillProcessCreateRequest(PROCESS_KEY, "周期", SkillProcessActivationType.ACTIVE,
            null, 0, null, List.of(new SkillProcessStepRequest("periodic", "周期", SkillProcessStepType.PERIODIC, null, 0, false,
                new SkillProcessPeriodicStepDetail(SkillNumericValue.fixed(java.math.BigDecimal.ONE),
                    SkillNumericValue.fixed(java.math.BigDecimal.ONE), SkillProcessFirstExecution.CUSTOM_WINDOW))),
            List.of(processStartBinding()), List.of());
        ApiException periodicError = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY, periodic));
        assertField(periodicError, "steps[0].detail.firstExecution", "TYPE_MISMATCH");
        verify(mapper, never()).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void legacyChannelRejectsExplicitNullEndpointsBeforeWrites() {
        SkillProcessStepRequest step = AggregateJson.read("""
            {"stepKey":"channel","name":"引导","stepType":"CHANNEL","sortOrder":0,
             "detail":{"durationValue":{"kind":"FIXED","value":20},"executionCountValue":{"kind":"FIXED","value":4},
              "firstExecution":"IMMEDIATE","firstExecutionOffsetValue":null}}
            """, SkillProcessStepRequest.class);
        SkillProcessCreateRequest request = new SkillProcessCreateRequest(PROCESS_KEY, "引导", SkillProcessActivationType.ACTIVE,
            null, 0, null, List.of(step), List.of(processStartBinding()), List.of());
        ApiException error = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY, request));
        assertEquals("400.INVALID_BODY", error.getCode());
        assertField(error, "steps[0].detail.firstExecutionOffsetValue", "FIELD_MUTEX");
        verify(mapper, never()).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void passiveDelayShapeDefersItsBehaviorToTheCompleteConfiguration() {
        var request = new SkillProcessCreateRequest("deferred", "延后检查", SkillProcessActivationType.PASSIVE,
            null, 0, null,
            List.of(new SkillProcessStepRequest("wait", "等待", SkillProcessStepType.DELAY, null, 0, false,
                new SkillProcessDelayStepDetail(SkillNumericValue.fixed(new java.math.BigDecimal("300"))))),
            List.of(), List.of());
        var prepared = service.prepareConfigurationCreate(request);
        var projected = service.projectPrepared(GAME_ID, SKILL_KEY, prepared, null);
        assertEquals("deferred", projected.processKey());
        assertEquals(1, projected.steps().size());
        verify(mapper, never()).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
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
    void createsCooldownOnlyProcessWithoutInventingResourceOrHitEffects() {
        SkillProcessCooldown cooldown = new SkillProcessCooldown(
            SkillNumericValue.fixed(new java.math.BigDecimal("90000")),
            new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null)
        );
        SkillProcessDetailResponse created = service.create(GAME_ID, SKILL_KEY,
            new SkillProcessCreateRequest(PROCESS_KEY, "无消耗施放", SkillProcessActivationType.ACTIVE,
                null, 0, cooldown, List.of(immediateStep()), List.of(), List.of()));

        assertEquals(cooldown, created.cooldown());
        assertEquals(1, created.steps().size());
        assertTrue(created.effectBindings().isEmpty());
        assertTrue(created.stateOperations().isEmpty());
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(booleans = {true, false})
    void savesReadsAndUpdatesActionOccupationWithoutChangingDelayOrCooldown(Boolean occupiesAction) {
        SkillProcessCooldown cooldown = new SkillProcessCooldown(
            SkillNumericValue.fixed(new java.math.BigDecimal("9000")),
            new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null)
        );
        SkillProcessDelayStepDetail delay = new SkillProcessDelayStepDetail(
            SkillNumericValue.fixed(new java.math.BigDecimal("250"))
        );
        SkillProcessStepRequest step = new SkillProcessStepRequest(
            "windup", "延时", SkillProcessStepType.DELAY, null, 0, occupiesAction, delay
        );
        var created = service.create(GAME_ID, SKILL_KEY, new SkillProcessCreateRequest(
            PROCESS_KEY, "施放", SkillProcessActivationType.ACTIVE, null, 0,
            cooldown, List.of(step), List.of(), List.of()
        ));
        assertEquals(occupiesAction, created.steps().getFirst().occupiesAction());
        assertEquals(created, service.get(GAME_ID, SKILL_KEY, PROCESS_KEY));
        assertEquals(occupiesAction, AggregateJson.readList(stored.stepsJson(),
            SkillProcessStepRequest.class).getFirst().occupiesAction());

        when(mapper.findProcessForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenAnswer(invocation -> stored);
        when(mapper.listStepsForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY))
            .thenReturn(List.of(stepRow("windup", SkillProcessStepType.DELAY)));
        Boolean updatedOccupation = occupiesAction == null ? Boolean.FALSE : !occupiesAction;
        var updated = service.update(GAME_ID, SKILL_KEY, PROCESS_KEY, new SkillProcessUpdateRequest(
            null, "施放", SkillProcessActivationType.ACTIVE, null, 0, cooldown,
            List.of(new SkillProcessStepRequest("windup", "延时", SkillProcessStepType.DELAY,
                null, 0, updatedOccupation, delay)), List.of(), List.of()
        ));
        assertEquals(updatedOccupation, updated.steps().getFirst().occupiesAction());
        assertEquals(delay, updated.steps().getFirst().detail());
        assertEquals(cooldown, updated.cooldown());
        assertEquals(updated, service.get(GAME_ID, SKILL_KEY, PROCESS_KEY));
    }

    @Test
    void cooldownOnlyProcessStillRejectsMissingDurationReference() {
        when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        SkillProcessCooldown cooldown = new SkillProcessCooldown(
            SkillNumericValue.formula("missing_cooldown"),
            new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null)
        );
        ApiException exception = assertThrows(ApiException.class,
            () -> service.create(GAME_ID, SKILL_KEY,
                new SkillProcessCreateRequest(PROCESS_KEY, "无消耗施放", SkillProcessActivationType.ACTIVE,
                    null, 0, cooldown, List.of(immediateStep()), List.of(), List.of())));

        assertEquals("400.INVALID_SKILL_PROCESS_REFERENCE", exception.getCode());
        assertField(exception, "cooldown.durationValue", "UNKNOWN_FORMULA");
        verify(mapper, never()).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
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
        assertEquals(SkillNumericValue.formula(FORMULA_KEY), created.cooldown().durationValue());
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
    void failureReasonIsOnlyAllowedOnProcessFailureMoments() {
        when(mapper.countByKey(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(0L);
        SkillProcessCreateRequest allowed = new SkillProcessCreateRequest(
            PROCESS_KEY, "失败时点", SkillProcessActivationType.ACTIVE, null, 0,
            new SkillProcessCooldown(
                SkillNumericValue.formula(FORMULA_KEY),
                new SkillProcessMoment(
                    SkillProcessMomentType.PROCESS_FAILURE,
                    null,
                    xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessFailureReason.ACTIVE_CANCELLED
                )
            ),
            List.of(immediateStep()),
            List.of(),
            List.of()
        );
        SkillProcessDetailResponse created = service.create(GAME_ID, SKILL_KEY, allowed);
        assertEquals(
            xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessFailureReason.ACTIVE_CANCELLED,
            created.cooldown().startMoment().failureReason()
        );

        ApiException forbidden = assertThrows(ApiException.class, () -> service.create(
            GAME_ID, SKILL_KEY,
            new SkillProcessCreateRequest(
                PROCESS_KEY, "完成时点", SkillProcessActivationType.ACTIVE, null, 0,
                new SkillProcessCooldown(
                    SkillNumericValue.formula(FORMULA_KEY),
                    new SkillProcessMoment(
                        SkillProcessMomentType.PROCESS_COMPLETE,
                        null,
                        xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessFailureReason.SOURCE_DIED
                    )
                ),
                List.of(immediateStep()),
                List.of(),
                List.of()
            )
        ));
        assertField(forbidden, "cooldown.startMoment.failureReason", "FORBIDDEN");

        SkillProcessMoment noisy = xyz.game.datamanage.support.authoring.AggregateJson.read(
            "{\"momentType\":\"PROCESS_FAILURE\",\"unexpected\":true}", SkillProcessMoment.class);
        ApiException unknown = assertThrows(ApiException.class, () -> service.create(
            GAME_ID, SKILL_KEY,
            new SkillProcessCreateRequest(
                PROCESS_KEY, "未知字段", SkillProcessActivationType.ACTIVE, null, 0,
                new SkillProcessCooldown(SkillNumericValue.formula(FORMULA_KEY), noisy),
                List.of(immediateStep()),
                List.of(),
                List.of()
            )
        ));
        assertField(unknown, "cooldown.startMoment.unexpected", "UNKNOWN_FIELD");
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
                        SkillNumericValue.formula("other_skill_formula"),
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
                        SKILL_KEY,
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
        assertField(exception, "cooldown.durationValue", "UNKNOWN_FORMULA");
        assertField(exception, "effectBindings[0].effectKey", "UNKNOWN_EFFECT");
        assertField(exception, "effectBindings[0].moment.stepKey", "UNKNOWN_STEP");
        assertField(exception, "stateOperations[0].stateKey", "UNKNOWN_INTERNAL_STATE");
        assertField(exception, "stateOperations[0].optionKey", "UNKNOWN_MODE_OPTION");
        verify(mapper, never()).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void stateOperationResolvesExplicitTargetSkillAndReadsItBack() {
        String otherSkill = "other_skill";
        SkillProcessStateOperationRequest cross = new SkillProcessStateOperationRequest(
            "add_mark", "叠层", otherSkill, "mark_stacks", SkillProcessStateOperationKind.INCREASE,
            SkillNumericValue.fixed(java.math.BigDecimal.ONE), null,
            new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null), 0);
        SkillProcessCreateRequest request = new SkillProcessCreateRequest(PROCESS_KEY, "施放",
            SkillProcessActivationType.ACTIVE, null, 0, null, List.of(immediateStep()), List.of(), List.of(cross));
        ApiException absent = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY, request));
        assertField(absent, "stateOperations[0].stateKey", "UNKNOWN_INTERNAL_STATE");

        when(mapper.lockInternalStates(eq(GAME_ID), eq(otherSkill), anyCollection()))
            .thenReturn(List.of(new SkillProcessInternalStateLockRow("mark_stacks", SkillInternalStateType.COUNTER)));
        var saved = service.create(GAME_ID, SKILL_KEY, request);
        assertEquals(otherSkill, saved.stateOperations().get(0).stateSkillKey());
        assertEquals("mark_stacks", saved.stateOperations().get(0).stateKey());
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
                GAME_ID, SKILL_KEY, PROCESS_KEY, "add_mark", "叠层", SKILL_KEY, "mark_stacks",
                SkillProcessStateOperationKind.INCREASE, SkillNumericValue.formula(FORMULA_KEY), null,
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
                        null,
                        new SkillProcessDelayStepDetail(SkillNumericValue.formula(FORMULA_KEY))
                    )),
                    List.of(),
                    List.of(new SkillProcessStateOperationRequest(
                        "add_mark",
                        "叠层",
                        SKILL_KEY,
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
                        null,
                        new SkillProcessImmediateStepDetail(Set.of("delayValue"), Set.of())
                    )),
                    List.of(processStartBinding()),
                    List.of()
                )
            )
        );
        assertEquals("400.INVALID_BODY", exception.getCode());
        assertField(exception, "steps[0].detail.delayValue", "FIELD_MUTEX");
        verify(mapper, never()).insertProcess(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void triggerRuleProtectsProcessDeleteStepRemovalAndCycleWithLongConstructor() {
        xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceGuard triggerReferences =
            org.mockito.Mockito.mock(xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceGuard.class);
        SkillProcessService guarded = new SkillProcessService(
            gamesMapper,
            skillMapper,
            mapper,
            triggerReferences,
            triggerCycles,
            org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class)
        );
        when(mapper.findProcessForUpdate(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(processRow());
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "409.SKILL_PROCESS_IN_USE",
            "技能过程仍被触发规则引用，不能删除",
            Map.of("fieldIssues", List.of(Map.of("field", "processKey", "code", "TRIGGER_RULE_PROCESS_IN_USE")))
        )).when(triggerReferences).assertProcessDeletable(GAME_ID, SKILL_KEY, PROCESS_KEY);
        ApiException deletable = assertThrows(ApiException.class, () -> guarded.delete(GAME_ID, SKILL_KEY, PROCESS_KEY));
        assertEquals("409.SKILL_PROCESS_IN_USE", deletable.getCode());
        assertField(deletable, "processKey", "TRIGGER_RULE_PROCESS_IN_USE");
        verify(mapper, never()).deleteProcess(any(), any(), any());

        org.mockito.Mockito.reset(triggerReferences);
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
        )).when(triggerReferences).assertStepsNotReferenced(eq(GAME_ID), eq(SKILL_KEY), eq(PROCESS_KEY), anyCollection());
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

        org.mockito.Mockito.reset(triggerReferences);
        org.mockito.Mockito.doThrow(new ApiException(
            org.springframework.http.HttpStatus.BAD_REQUEST,
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            "触发规则存在未受保护的循环",
            Map.of()
        )).when(triggerCycles).validateCurrentSkill(GAME_ID, SKILL_KEY);
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
                SkillNumericValue.formula(FORMULA_KEY),
                new SkillProcessMoment(SkillProcessMomentType.PROCESS_COMPLETE, null)
            ),
            List.of(
                immediateStep(),
                new SkillProcessStepRequest(
                    "delay", "延迟", SkillProcessStepType.DELAY, null, 1, null,
                    new SkillProcessDelayStepDetail(SkillNumericValue.formula(FORMULA_KEY))
                ),
                new SkillProcessStepRequest(
                    "multi", "多段", SkillProcessStepType.MULTI_HIT, null, 2, null,
                    new SkillProcessMultiHitStepDetail(SkillNumericValue.formula(FORMULA_KEY), null)
                ),
                new SkillProcessStepRequest(
                    "tick", "周期", SkillProcessStepType.PERIODIC, null, 3, null,
                    new SkillProcessPeriodicStepDetail(
                        SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula(FORMULA_KEY), SkillProcessFirstExecution.IMMEDIATE
                    )
                ),
                new SkillProcessStepRequest(
                    "channel", "引导", SkillProcessStepType.CHANNEL, null, 4, null,
                    new SkillProcessChannelStepDetail(
                        SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula(FORMULA_KEY), SkillProcessFirstExecution.AFTER_INTERVAL
                    )
                ),
                new SkillProcessStepRequest(
                    "charge", "蓄力", SkillProcessStepType.CHARGE, null, 5, null,
                    new SkillProcessChargeStepDetail(SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula(FORMULA_KEY), true)
                ),
                new SkillProcessStepRequest(
                    "recast", "重施", SkillProcessStepType.RECAST, null, 6, null,
                    new SkillProcessRecastStepDetail(SkillNumericValue.formula(FORMULA_KEY), SkillNumericValue.formula(FORMULA_KEY))
                ),
                new SkillProcessStepRequest(
                    "empower", "强化普攻", SkillProcessStepType.EMPOWERED_BASIC_ATTACK, null, 7, null,
                    new SkillProcessEmpoweredAttackStepDetail(
                        SkillNumericValue.formula(FORMULA_KEY), SkillProcessEmpoweredConsumeMoment.ATTACK_HIT
                    )
                )
            ),
            List.of(processStartBinding()),
            List.of(new SkillProcessStateOperationRequest(
                "add_mark",
                "叠层",
                SKILL_KEY,
                "mark_stacks",
                SkillProcessStateOperationKind.INCREASE,
                SkillNumericValue.formula(FORMULA_KEY),
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
            "cast", "立即", SkillProcessStepType.IMMEDIATE, null, 0, null, new SkillProcessImmediateStepDetail()
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
