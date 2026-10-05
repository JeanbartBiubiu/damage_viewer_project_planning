package xyz.game.datamanage.service.skillconfiguration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Validation;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skill.SkillUpdateRequest;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationChange;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationSaveRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterCreateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skillformula.SkillFormulaDetailResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaCreateRequest;
import xyz.game.datamanage.model.skillformula.SkillFormulaUpdateRequest;
import xyz.game.datamanage.model.skillformula.SkillFormulaParameterNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetailResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateFlagDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateScope;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateSummaryResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessCreateRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessCooldown;
import xyz.game.datamanage.model.skillprocess.SkillProcessDetailResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessImmediateStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skillprocess.SkillProcessSummaryResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessUpdateRequest;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.service.skill.SkillService;
import xyz.game.datamanage.service.skillparameter.SkillParameterService;
import xyz.game.datamanage.service.skillformula.SkillFormulaService;
import xyz.game.datamanage.service.skilleffect.SkillEffectService;
import xyz.game.datamanage.service.skillprocess.SkillProcessService;
import xyz.game.datamanage.service.skillinternalstate.SkillInternalStateService;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class SkillConfigurationServiceTest {

    private static final String GAME = "lol";
    private static final String SKILL = "ezreal_q";
    private static final OffsetDateTime TIME = OffsetDateTime.parse("2026-09-01T00:00:00Z");

    @Mock private GameConfigurationWriteGuard guard;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillService skillService;
    @Mock private SkillParameterService parameterService;
    @Mock private SkillFormulaService formulaService;
    @Mock private SkillEffectService effectService;
    @Mock private SkillProcessService processService;
    @Mock private SkillInternalStateService internalStateService;
    @Mock private SkillTriggerRuleService triggerRuleService;

    private ObjectMapper json;
    private SkillConfigurationService service;

    @BeforeEach
    void setUp() {
        json = new ObjectMapper().findAndRegisterModules();
        service = new SkillConfigurationService(guard, skillMapper, skillService, parameterService,
            formulaService, effectService, processService, internalStateService, triggerRuleService,
            json, Validation.buildDefaultValidatorFactory().getValidator());
        lenient().when(skillService.get(GAME, SKILL)).thenReturn(skill(5));
        lenient().when(parameterService.list(GAME, SKILL)).thenReturn(List.of());
        lenient().when(formulaService.list(GAME, SKILL)).thenReturn(List.of());
        lenient().when(effectService.list(GAME, SKILL)).thenReturn(List.of());
        lenient().when(processService.list(GAME, SKILL)).thenReturn(List.of());
        lenient().when(internalStateService.list(GAME, SKILL)).thenReturn(List.of());
        lenient().when(triggerRuleService.list(GAME, SKILL)).thenReturn(List.of());
    }

    @Test
    void digestTracksChildBusinessChangesButIgnoresAuditTimesAndCatalogDisplayOrder() {
        var original = service.get(GAME, SKILL);
        when(parameterService.list(GAME, SKILL)).thenReturn(List.of(parameter("base", Map.of("1", BigDecimal.ONE))));
        var changed = service.get(GAME, SKILL);
        assertNotEquals(original.baseDigest(), changed.baseDigest());

        when(parameterService.list(GAME, SKILL)).thenReturn(List.of(parameter("base", Map.of("1", BigDecimal.ONE),
            TIME.plusDays(1))));
        when(skillService.get(GAME, SKILL)).thenReturn(new SkillResponse(GAME, SKILL, "秘术射击", null,
            5, SkillStatus.ENABLED, 10, List.of("secondary", "active"), TIME.plusDays(1), TIME.plusDays(1)));
        var reordered = service.get(GAME, SKILL);
        when(skillService.get(GAME, SKILL)).thenReturn(new SkillResponse(GAME, SKILL, "秘术射击", null,
            5, SkillStatus.ENABLED, 10, List.of("active", "secondary"), TIME, TIME));
        assertEquals(reordered.baseDigest(), service.get(GAME, SKILL).baseDigest());
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(booleans = {true, false})
    void completeConfigurationPreservesOccupationOnCreateUpdateReadAndDigest(Boolean occupiesAction) throws Exception {
        var prepared = mock(SkillProcessService.Prepared.class);
        var summary = new SkillProcessSummaryResponse(GAME, SKILL, "cast", "施放",
            SkillProcessActivationType.ACTIVE, null, 0, 1, 0, 0, TIME, TIME);
        when(processService.prepareConfigurationCreate(any(SkillProcessCreateRequest.class)))
            .thenAnswer(invocation -> {
                SkillProcessCreateRequest request = invocation.getArgument(0);
                assertEquals(occupiesAction, request.steps().getFirst().occupiesAction());
                return prepared;
            });
        doAnswer(invocation -> {
            when(processService.list(GAME, SKILL)).thenReturn(List.of(summary));
            when(processService.get(GAME, SKILL, "cast")).thenReturn(process(occupiesAction));
            return null;
        }).when(processService).writePreparedWithinConfiguration(GAME, SKILL, prepared);
        JsonNode value = json.readTree("""
            {"processKey":"cast","name":"施放","activationType":"ACTIVE","description":null,
             "sortOrder":0,"cooldown":{"durationValue":{"kind":"FIXED","value":1000},
               "startMoment":{"momentType":"PROCESS_START"}},
             "steps":[{"stepKey":"cast","name":"立即","stepType":"IMMEDIATE","sortOrder":0,
               "occupiesAction":%s,"detail":{}}],"effectBindings":[],"stateOperations":[]}
            """.formatted(occupiesAction));
        var created = service.create(GAME, SKILL, new SkillConfigurationSaveRequest(null,
            skillValue(5), List.of(new SkillConfigurationChange("PROCESS", "CREATE", "cast", value))));
        assertEquals(occupiesAction, created.processes().getFirst().steps().getFirst().occupiesAction());
        assertEquals(created.baseDigest(), service.get(GAME, SKILL).baseDigest());

        Boolean updatedOccupation = occupiesAction == null ? Boolean.TRUE : null;
        when(processService.prepareConfigurationUpdate(eq("cast"), any(SkillProcessUpdateRequest.class),
            any(SkillProcessDetailResponse.class))).thenAnswer(invocation -> {
                SkillProcessUpdateRequest request = invocation.getArgument(1);
                assertEquals(updatedOccupation, request.steps().getFirst().occupiesAction());
                return prepared;
            });
        doAnswer(invocation -> {
            when(processService.get(GAME, SKILL, "cast")).thenReturn(process(updatedOccupation));
            return null;
        }).when(processService).writePreparedWithinConfiguration(GAME, SKILL, prepared);
        ((com.fasterxml.jackson.databind.node.ObjectNode) value).remove("processKey");
        ((com.fasterxml.jackson.databind.node.ObjectNode) value.path("steps").get(0))
            .set("occupiesAction", json.valueToTree(updatedOccupation));
        var updated = service.update(GAME, SKILL, new SkillConfigurationSaveRequest(created.baseDigest(),
            null, List.of(new SkillConfigurationChange("PROCESS", "UPDATE", "cast", value))));
        assertEquals(updatedOccupation, updated.processes().getFirst().steps().getFirst().occupiesAction());
        assertNotEquals(created.baseDigest(), updated.baseDigest());
        assertEquals(updated.baseDigest(), service.get(GAME, SKILL).baseDigest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"\"true\"", "\"false\"", "0", "1", "[]", "{}"})
    void completeConfigurationRejectsNonBooleanOccupationBeforeAnyWrite(String authorValue) throws Exception {
        JsonNode value = json.readTree("""
            {"processKey":"cast","name":"施放","activationType":"ACTIVE","description":null,
             "sortOrder":0,"cooldown":{"durationValue":{"kind":"FIXED","value":1000},
               "startMoment":{"momentType":"PROCESS_START"}},
             "steps":[{"stepKey":"cast","name":"立即","stepType":"IMMEDIATE","sortOrder":0,
               "occupiesAction":%s,"detail":{}}],"effectBindings":[],"stateOperations":[]}
            """.formatted(authorValue));
        ApiException error = assertThrows(ApiException.class, () -> service.create(GAME, SKILL,
            new SkillConfigurationSaveRequest(null, skillValue(5),
                List.of(new SkillConfigurationChange("PROCESS", "CREATE", "cast", value)))));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        verify(processService, never()).prepareConfigurationCreate(any());
        verify(processService, never()).writePreparedWithinConfiguration(any(), any(), any());
        verify(skillService, never()).createWithinConfiguration(any(), any(), any());
    }

    @Test
    void staleDigestConflictsAfterLockBeforeAnyWrite() {
        String oldDigest = service.get(GAME, SKILL).baseDigest();
        when(parameterService.list(GAME, SKILL)).thenReturn(List.of(parameter("base", Map.of("1", BigDecimal.ONE))));
        ApiException error = assertThrows(ApiException.class, () -> service.update(GAME, SKILL,
            new SkillConfigurationSaveRequest(oldDigest, null, List.of())));
        assertEquals(HttpStatus.CONFLICT, error.getStatus());
        assertEquals("409.SKILL_CONFIGURATION_CHANGED", error.getCode());
        InOrder order = inOrder(guard, skillService);
        order.verify(guard).begin(GAME);
        order.verify(skillService).get(GAME, SKILL);
        verify(skillService, never()).updateWithinConfiguration(any(), any(), any());
    }

    @Test
    void createsSkillAndParameterInOneEntry() throws Exception {
        SkillConfigurationChange parameter = new SkillConfigurationChange("PARAMETER", "CREATE", "base",
            json.readTree("""
                {"parameterKey":"base","name":"基础值","valueType":"DECIMAL","valueMode":"FIXED",
                 "fixedValue":10,"levelValues":null,"description":null,"sortOrder":1}
                """));
        when(parameterService.list(GAME, SKILL)).thenReturn(List.of(parameter("base", null)));
        var result = service.create(GAME, SKILL, new SkillConfigurationSaveRequest(null,
            skillValue(5), List.of(parameter)));
        assertEquals("base", result.parameters().getFirst().parameterKey());
        assertEquals(64, result.baseDigest().length());
        InOrder order = inOrder(guard, skillService, parameterService);
        order.verify(guard).begin(GAME);
        order.verify(parameterService).validateConfigurationCreate(eq(GAME), any(), eq(5));
        order.verify(skillService).createWithinConfiguration(eq(GAME), eq(SKILL), any(SkillUpdateRequest.class));
        order.verify(parameterService).createWithinConfiguration(eq(GAME), eq(SKILL),
            any(SkillParameterCreateRequest.class), eq(5));
    }

    @Test
    void createsParameterBeforeFormulaEvenWhenRequestListsFormulaFirst() throws Exception {
        SkillConfigurationChange formula = new SkillConfigurationChange("FORMULA", "CREATE", "damage",
            json.readTree("""
                {"formulaKey":"damage","name":"伤害","description":null,"sortOrder":1,
                 "expression":{"nodeType":"PARAMETER","parameterKey":"base"}}
                """));
        SkillConfigurationChange parameter = new SkillConfigurationChange("PARAMETER", "CREATE", "base",
            json.readTree("""
                {"parameterKey":"base","name":"基础值","valueType":"DECIMAL","valueMode":"FIXED",
                 "fixedValue":1,"levelValues":null,"description":null,"sortOrder":1}
                """));
        service.create(GAME, SKILL, new SkillConfigurationSaveRequest(null,
            skillValue(5), List.of(formula, parameter)));
        InOrder order = inOrder(guard, skillService, parameterService, formulaService);
        order.verify(guard).begin(GAME);
        order.verify(formulaService).validateConfigurationCreate(eq(GAME), eq(SKILL),
            any(SkillFormulaCreateRequest.class), eq(Set.of("base")));
        order.verify(skillService).createWithinConfiguration(eq(GAME), eq(SKILL), any());
        order.verify(parameterService).createWithinConfiguration(eq(GAME), eq(SKILL), any(), eq(5));
        order.verify(formulaService).createWithinConfiguration(eq(GAME), eq(SKILL),
            any(SkillFormulaCreateRequest.class), eq(Set.of("base")));
    }

    @Test
    void createsParameterFormulaStateAndEffectFromOneFinalCandidate() throws Exception {
        SkillConfigurationChange effect = new SkillConfigurationChange("EFFECT", "CREATE", "window",
            json.readTree("""
                {"effectKey":"window","name":"持续窗口","description":null,"sortOrder":1,
                 "lifecycle":{"durationValue":{"kind":"FORMULA","formulaKey":"duration"},
                   "maxStacksValue":{"kind":"FIXED","value":1},
                   "applicationStacksValue":{"kind":"FIXED","value":1},
                   "instanceScope":"SKILL","reapplicationStackMode":"KEEP",
                   "reapplicationDurationMode":"KEEP_REMAINING","expiryMode":"ALL_AT_ONCE",
                   "periodicIntervalValue":null,"firstPeriodicExecution":null,
                   "endWhenShieldEndsResultKey":null},"results":[]}
                """));
        SkillConfigurationChange state = new SkillConfigurationChange("INTERNAL_STATE", "CREATE", "ammo",
            json.readTree("""
                {"stateKey":"ammo","name":"弹药","stateType":"AMMO","scope":"SKILL",
                 "description":null,"sortOrder":1,
                 "detail":{"initialValue":{"kind":"FIXED","value":1},
                   "maxValue":{"kind":"FIXED","value":1},
                   "recoveryIntervalValue":{"kind":"FORMULA","formulaKey":"duration"},
                   "recoveryMode":"ONE_BY_ONE","recoveryStartCondition":"AFTER_CONSUME"}}
                """));
        SkillConfigurationChange formula = new SkillConfigurationChange("FORMULA", "CREATE", "duration",
            json.readTree("""
                {"formulaKey":"duration","name":"恢复间隔","description":null,"sortOrder":1,
                 "expression":{"nodeType":"PARAMETER","parameterKey":"base"}}
                """));
        SkillConfigurationChange parameter = new SkillConfigurationChange("PARAMETER", "CREATE", "base",
            json.readTree("""
                {"parameterKey":"base","name":"基础值","valueType":"DECIMAL","valueMode":"FIXED",
                 "fixedValue":1,"levelValues":null,"description":null,"sortOrder":1}
                """));

        service.create(GAME, SKILL, new SkillConfigurationSaveRequest(null, skillValue(5),
            List.of(effect, state, formula, parameter)));

        InOrder order = inOrder(guard, skillService, parameterService, formulaService,
            internalStateService, effectService);
        order.verify(guard).begin(GAME);
        order.verify(formulaService).validateConfigurationCreate(eq(GAME), eq(SKILL),
            any(SkillFormulaCreateRequest.class), eq(Set.of("base")));
        order.verify(internalStateService).validateConfigurationCreate(eq(GAME), eq(SKILL),
            any(), eq(Set.of("duration")));
        order.verify(effectService).validateConfigurationCreate(eq(GAME), eq(SKILL),
            any(), eq(Set.of("duration")), eq(Set.of()), any());
        order.verify(skillService).createWithinConfiguration(eq(GAME), eq(SKILL), any());
        order.verify(parameterService).createWithinConfiguration(eq(GAME), eq(SKILL), any(), eq(5));
        order.verify(formulaService).createWithinConfiguration(eq(GAME), eq(SKILL), any(), eq(Set.of("base")));
        order.verify(internalStateService).createWithinConfiguration(eq(GAME), eq(SKILL),
            any(), eq(Set.of("duration")));
        order.verify(effectService).createWithinConfiguration(eq(GAME), eq(SKILL), any(),
            eq(Set.of("duration")), eq(Set.of()), any());
    }

    @Test
    void updatesStateAndDeletesEffectInOneTransaction() throws Exception {
        existingStateAndEffect();
        String digest = service.get(GAME, SKILL).baseDigest();
        SkillConfigurationChange deleteEffect = new SkillConfigurationChange("EFFECT", "DELETE", "old_effect", null);
        SkillConfigurationChange updateState = new SkillConfigurationChange("INTERNAL_STATE", "UPDATE", "flag",
            json.readTree("""
                {"name":"新标记","stateType":"FLAG","scope":"SKILL","description":null,
                 "sortOrder":2,"detail":{"initialEnabled":false}}
                """));
        service.update(GAME, SKILL, new SkillConfigurationSaveRequest(digest, null,
            List.of(deleteEffect, updateState)));
        verify(internalStateService).validateConfigurationUpdate(eq(GAME), eq(SKILL), eq("flag"),
            any(), eq(Set.of()), eq(false));
        InOrder order = inOrder(internalStateService, effectService);
        order.verify(internalStateService).updateWithinConfiguration(eq(GAME), eq(SKILL), eq("flag"),
            any(), eq(Set.of()), eq(false));
        order.verify(effectService).deleteWithinConfiguration(GAME, SKILL, "old_effect");
    }

    @Test
    void updatesEffectAndDeletesStateInOneTransaction() throws Exception {
        existingStateAndEffect();
        String digest = service.get(GAME, SKILL).baseDigest();
        SkillConfigurationChange updateEffect = new SkillConfigurationChange("EFFECT", "UPDATE", "old_effect",
            json.readTree("""
                {"name":"新窗口","description":null,"sortOrder":2,
                 "lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},
                   "applicationStacksValue":{"kind":"FIXED","value":1},
                   "instanceScope":"SKILL","reapplicationStackMode":"KEEP",
                   "reapplicationDurationMode":null,"expiryMode":"EXPLICIT_ONLY",
                   "periodicIntervalValue":null,"firstPeriodicExecution":null,
                   "endWhenShieldEndsResultKey":null},"results":[]}
                """));
        SkillConfigurationChange deleteState = new SkillConfigurationChange("INTERNAL_STATE", "DELETE", "flag", null);
        service.update(GAME, SKILL, new SkillConfigurationSaveRequest(digest, null,
            List.of(deleteState, updateEffect)));
        verify(effectService).validateConfigurationUpdate(eq(GAME), eq(SKILL), eq("old_effect"),
            any(), eq(Set.of()), eq(Set.of()), any(), eq(false));
        InOrder order = inOrder(effectService, internalStateService);
        order.verify(effectService).updateWithinConfiguration(eq(GAME), eq(SKILL), eq("old_effect"),
            any(), eq(Set.of()), eq(Set.of()), any(), eq(false));
        order.verify(internalStateService).deleteWithinConfiguration(GAME, SKILL, "flag");
    }

    @Test
    void writesProcessBeforeRuleAndValidatesOnlyAfterFinalRowsExist() throws Exception {
        var preparedProcess = mock(SkillProcessService.Prepared.class);
        var preparedRule = mock(SkillTriggerRuleService.Prepared.class);
        when(processService.prepareConfigurationCreate(any(SkillProcessCreateRequest.class)))
            .thenReturn(preparedProcess);
        when(triggerRuleService.prepareConfigurationCreate(any(SkillTriggerRuleCreateRequest.class)))
            .thenReturn(preparedRule);
        SkillConfigurationChange rule = new SkillConfigurationChange("TRIGGER_RULE", "CREATE", "on_hit",
            json.readTree("""
                {"ruleKey":"on_hit","name":"命中追加","description":null,"sortOrder":1,
                 "eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},
                 "conditionGroups":[],"actions":[{"actionKey":"apply","name":"执行效果",
                   "actionType":"EXECUTE_EFFECT","sortOrder":1,"targetContext":"CURRENT_TARGET",
                   "detail":{"effectKey":"new_effect"},"runtimeInputBindings":[],"resultModifiers":[]}],
                 "perTargetCooldown":null,"maxTriggersPerProcess":null,"oncePerUse":null}
                """));
        SkillConfigurationChange process = new SkillConfigurationChange("PROCESS", "CREATE", "cast",
            json.readTree("""
                {"processKey":"cast","name":"施放","activationType":"ACTIVE","description":null,
                 "sortOrder":1,"cooldown":{"durationValue":{"kind":"FIXED","value":1000},
                   "startMoment":{"momentType":"PROCESS_START"}},
                 "steps":[{"stepKey":"start","name":"开始","stepType":"IMMEDIATE",
                   "description":null,"sortOrder":1,"detail":{}}],
                 "effectBindings":[],"stateOperations":[]}
                """));
        service.create(GAME, SKILL, new SkillConfigurationSaveRequest(null, skillValue(5),
            List.of(rule, process)));
        InOrder order = inOrder(skillService, processService, triggerRuleService);
        order.verify(triggerRuleService).prepareConfigurationCreate(any(SkillTriggerRuleCreateRequest.class));
        order.verify(processService).prepareConfigurationCreate(any(SkillProcessCreateRequest.class));
        order.verify(skillService).createWithinConfiguration(eq(GAME), eq(SKILL), any());
        order.verify(processService).writePreparedWithinConfiguration(GAME, SKILL, preparedProcess);
        order.verify(triggerRuleService).writePreparedWithinConfiguration(GAME, SKILL, preparedRule);
        order.verify(processService).validatePreparedAgainstFinalDatabase(GAME, SKILL, preparedProcess);
        order.verify(triggerRuleService).validatePreparedAgainstFinalDatabase(GAME, SKILL, preparedRule);
    }

    private void existingStateAndEffect() {
        when(effectService.list(GAME, SKILL)).thenReturn(List.of(new SkillEffectSummaryResponse(
            GAME, SKILL, "old_effect", "窗口", null, 1, 0, false, TIME, TIME)));
        when(effectService.get(GAME, SKILL, "old_effect")).thenReturn(new SkillEffectDetailResponse(
            GAME, SKILL, "old_effect", "窗口", null, 1, null, List.of(), TIME, TIME));
        when(internalStateService.list(GAME, SKILL)).thenReturn(List.of(new SkillInternalStateSummaryResponse(
            GAME, SKILL, "flag", "标记", SkillInternalStateType.FLAG, SkillInternalStateScope.SKILL,
            null, 1, TIME, TIME)));
        when(internalStateService.get(GAME, SKILL, "flag")).thenReturn(new SkillInternalStateDetailResponse(
            GAME, SKILL, "flag", "标记", SkillInternalStateType.FLAG, SkillInternalStateScope.SKILL,
            null, 1, new SkillInternalStateFlagDetail(true), TIME, TIME));
    }

    @Test
    void deletingParameterAfterRewritingFormulaUsesFinalCandidate() throws Exception {
        when(parameterService.list(GAME, SKILL)).thenReturn(List.of(parameter("old", null), parameter("new", null)));
        var oldFormula = new SkillFormulaDetailResponse(GAME, SKILL, "damage", "伤害", null, 1,
            new SkillFormulaParameterNode("old"), TIME, TIME);
        when(formulaService.list(GAME, SKILL)).thenReturn(List.of(new SkillFormulaSummaryResponse(
            GAME, SKILL, "damage", "伤害", null, 1, TIME, TIME)));
        when(formulaService.get(GAME, SKILL, "damage")).thenReturn(oldFormula);
        String digest = service.get(GAME, SKILL).baseDigest();
        SkillConfigurationChange delete = new SkillConfigurationChange("PARAMETER", "DELETE", "old", null);
        SkillConfigurationChange rewrite = new SkillConfigurationChange("FORMULA", "UPDATE", "damage",
            json.readTree("""
                {"name":"伤害","description":null,"sortOrder":1,
                 "expression":{"nodeType":"PARAMETER","parameterKey":"new"}}
                """));
        service.update(GAME, SKILL, new SkillConfigurationSaveRequest(digest, null, List.of(delete, rewrite)));
        verify(formulaService).validateFinalParameterReferences(eq(GAME), eq(SKILL),
            eq(Map.of("damage", new SkillFormulaParameterNode("new"))), eq(Set.of("new")));
        InOrder order = inOrder(formulaService, parameterService);
        order.verify(formulaService).updateWithinConfiguration(eq(GAME), eq(SKILL), eq("damage"),
            any(SkillFormulaUpdateRequest.class), eq(Set.of("new")));
        order.verify(parameterService).deleteWithinConfiguration(GAME, SKILL, "old");
        verify(formulaService, never()).update(eq(GAME), eq(SKILL), eq("damage"), any());
    }

    @Test
    void formulaWriteRequiresEveryWritableFieldAndPreservesOtherRoots() throws Exception {
        String digest = service.get(GAME, SKILL).baseDigest();
        JsonNode incomplete = json.readTree("""
            {"formulaKey":"damage","name":"伤害","sortOrder":1,
             "expression":{"nodeType":"PARAMETER","parameterKey":"base"}}
            """);
        ApiException error = assertThrows(ApiException.class, () -> service.update(GAME, SKILL,
            new SkillConfigurationSaveRequest(digest, null,
                List.of(new SkillConfigurationChange("FORMULA", "CREATE", "damage", incomplete)))));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        assertTrue(error.getDetails().toString().contains("changes/0/value/description"));
        verify(formulaService, never()).createWithinConfiguration(any(), any(), any(), any());
    }

    @Test
    void maxLevelChangeRequiresExplicitCompleteParameterAndNeverCallsLegacyUpdate() throws Exception {
        when(parameterService.list(GAME, SKILL)).thenReturn(List.of(parameter("base", levels(1, 5))));
        String digest = service.get(GAME, SKILL).baseDigest();
        SkillConfigurationSaveRequest omitted = new SkillConfigurationSaveRequest(digest, skillValue(6), List.of());
        ApiException error = assertThrows(ApiException.class, () -> service.update(GAME, SKILL, omitted));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertTrue(error.getDetails().toString().contains("SKILL_LEVEL_UPDATE_REQUIRED"));
        verify(skillService, never()).updateWithinConfiguration(any(), any(), any());

        SkillConfigurationChange complete = new SkillConfigurationChange("PARAMETER", "UPDATE", "base",
            json.readTree("""
                {"name":"基础值","valueType":"DECIMAL","valueMode":"SKILL_LEVEL",
                 "fixedValue":null,"levelValues":{"1":1,"2":2,"3":3,"4":4,"5":5,"6":6},
                 "description":null,"sortOrder":1}
                """));
        service.update(GAME, SKILL, new SkillConfigurationSaveRequest(digest, skillValue(6), List.of(complete)));
        verify(parameterService).validateConfigurationUpdate(eq(GAME), eq("base"),
            any(SkillParameterUpdateRequest.class), eq(6));
        verify(parameterService).updateWithinConfiguration(eq(GAME), eq(SKILL), eq("base"),
            any(SkillParameterUpdateRequest.class), eq(6));
        verify(skillService, never()).update(eq(GAME), eq(SKILL), any());
    }

    @Test
    void parameterOnlyUpdateKeepsUnsubmittedFormulaDetailInResponse() throws Exception {
        SkillFormulaSummaryResponse summary = new SkillFormulaSummaryResponse(GAME, SKILL, "damage",
            "伤害", null, 1, TIME, TIME);
        SkillFormulaDetailResponse detail = new SkillFormulaDetailResponse(GAME, SKILL, "damage",
            "伤害", null, 1, null, TIME, TIME);
        when(formulaService.list(GAME, SKILL)).thenReturn(List.of(summary));
        when(formulaService.get(GAME, SKILL, "damage")).thenReturn(detail);
        when(parameterService.list(GAME, SKILL)).thenReturn(List.of(parameter("base", null)));
        String digest = service.get(GAME, SKILL).baseDigest();
        SkillConfigurationChange change = new SkillConfigurationChange("PARAMETER", "UPDATE", "base",
            json.readTree("""
                {"name":"基础值","valueType":"DECIMAL","valueMode":"FIXED",
                 "fixedValue":2,"levelValues":null,"description":null,"sortOrder":1}
                """));
        var response = service.update(GAME, SKILL, new SkillConfigurationSaveRequest(digest, null, List.of(change)));
        assertSame(detail, response.formulas().getFirst());
        verify(skillService, never()).updateWithinConfiguration(any(), any(), any());
        verify(parameterService).updateWithinConfiguration(eq(GAME), eq(SKILL), eq("base"), any(), eq(5));
    }

    @Test
    void unsupportedTypeIsRejectedWithStableObjectKey() {
        String digest = service.get(GAME, SKILL).baseDigest();
        ApiException error = assertThrows(ApiException.class, () -> service.update(GAME, SKILL,
            new SkillConfigurationSaveRequest(digest, null,
                List.of(new SkillConfigurationChange("FORMULA", "CREATE", "damage", json.createObjectNode())))));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertTrue(error.getDetails().toString().contains("damage"));
        verify(skillService, never()).updateWithinConfiguration(any(), any(), any());
    }

    @Test
    void missingObjectTypeAndMissingNullableFieldsAreLocatedBeforeWriting() throws Exception {
        String initialDigest = service.get(GAME, SKILL).baseDigest();
        ApiException missingType = assertThrows(ApiException.class, () -> service.update(GAME, SKILL,
            new SkillConfigurationSaveRequest(initialDigest, null,
                List.of(new SkillConfigurationChange(null, "CREATE", "base", json.createObjectNode())))));
        assertEquals(HttpStatus.BAD_REQUEST, missingType.getStatus());
        assertTrue(missingType.getDetails().toString().contains("changes/0/objectType"));

        JsonNode incompleteSkill = json.readTree("""
            {"name":"秘术射击","maxLevel":5,"status":"ENABLED","sortOrder":10,
             "skillCategoryKeys":["active"]}
            """);
        ApiException missingSkillDescription = assertThrows(ApiException.class, () -> service.update(GAME, SKILL,
            new SkillConfigurationSaveRequest(initialDigest, incompleteSkill, List.of())));
        assertTrue(missingSkillDescription.getDetails().toString().contains("skill/description"));

        when(parameterService.list(GAME, SKILL)).thenReturn(List.of(parameter("base", null)));
        String digest = service.get(GAME, SKILL).baseDigest();
        JsonNode incompleteParameter = json.readTree("""
            {"name":"基础值","valueType":"DECIMAL","valueMode":"FIXED",
             "fixedValue":1,"levelValues":null,"sortOrder":1}
            """);
        String currentDigest = digest;
        ApiException missingParameterDescription = assertThrows(ApiException.class, () -> service.update(GAME, SKILL,
            new SkillConfigurationSaveRequest(currentDigest, null,
                List.of(new SkillConfigurationChange("PARAMETER", "UPDATE", "base", incompleteParameter)))));
        assertTrue(missingParameterDescription.getDetails().toString().contains("changes/0/value/description"));

        JsonNode incompleteCreate = json.readTree("""
            {"parameterKey":"new_base","name":"新基础值","valueType":"DECIMAL","valueMode":"FIXED",
             "fixedValue":1,"description":null,"sortOrder":1}
            """);
        ApiException missingCreateLevels = assertThrows(ApiException.class, () -> service.create(GAME, SKILL,
            new SkillConfigurationSaveRequest(null, skillValue(5),
                List.of(new SkillConfigurationChange("PARAMETER", "CREATE", "new_base", incompleteCreate)))));
        assertTrue(missingCreateLevels.getDetails().toString().contains("changes/0/value/levelValues"));
        verify(skillService, never()).updateWithinConfiguration(any(), any(), any());
        verify(skillService, never()).createWithinConfiguration(any(), any(), any());
        verify(parameterService, never()).updateWithinConfiguration(any(), any(), any(), any(), anyInt());
    }

    @Test
    void writeFailureRollsBackOuterTransaction() throws Exception {
        PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
        TransactionStatus status = mock(TransactionStatus.class);
        when(manager.getTransaction(any(TransactionDefinition.class))).thenReturn(status);
        ProxyFactory factory = new ProxyFactory(service);
        factory.addAdvice(new TransactionInterceptor(manager, new AnnotationTransactionAttributeSource()));
        SkillConfigurationService transactional = (SkillConfigurationService) factory.getProxy();
        SkillConfigurationChange change = new SkillConfigurationChange("PARAMETER", "CREATE", "base",
            json.readTree("""
                {"parameterKey":"base","name":"基础值","valueType":"DECIMAL","valueMode":"FIXED",
                 "fixedValue":1,"levelValues":null,"description":null,"sortOrder":1}
                """));
        RuntimeException failure = new IllegalStateException("write failed");
        doThrow(failure).when(parameterService).createWithinConfiguration(eq(GAME), eq(SKILL),
            any(SkillParameterCreateRequest.class), eq(5));
        RuntimeException thrown = assertThrows(RuntimeException.class, () -> transactional.create(GAME, SKILL,
            new SkillConfigurationSaveRequest(null, skillValue(5), List.of(change))));
        assertSame(failure, thrown);
        verify(manager).rollback(status);
        verify(manager, never()).commit(status);
    }

    private JsonNode skillValue(int maxLevel) throws Exception {
        return json.readTree("""
            {"name":"秘术射击","description":null,"maxLevel":%d,"status":"ENABLED",
             "sortOrder":10,"skillCategoryKeys":["active"]}
            """.formatted(maxLevel));
    }

    private static SkillProcessDetailResponse process(Boolean occupiesAction) {
        return new SkillProcessDetailResponse(GAME, SKILL, "cast", "施放", SkillProcessActivationType.ACTIVE,
            null, 0, new SkillProcessCooldown(SkillNumericValue.fixed(new BigDecimal("1000")),
                new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null)),
            List.of(new SkillProcessStepResponse("cast", "立即", SkillProcessStepType.IMMEDIATE,
                null, 0, occupiesAction, new SkillProcessImmediateStepDetail())),
            List.of(), List.of(), TIME, TIME);
    }

    private static SkillResponse skill(int maxLevel) {
        return new SkillResponse(GAME, SKILL, "秘术射击", null, maxLevel,
            SkillStatus.ENABLED, 10, List.of("active"), TIME, TIME);
    }

    private static SkillParameterResponse parameter(String key, Map<String, BigDecimal> levels) {
        return parameter(key, levels, TIME);
    }

    private static SkillParameterResponse parameter(
        String key, Map<String, BigDecimal> levels, OffsetDateTime updatedAt
    ) {
        return new SkillParameterResponse(GAME, SKILL, key, "基础值", SkillParameterValueType.DECIMAL,
            levels == null ? SkillParameterValueMode.FIXED : SkillParameterValueMode.SKILL_LEVEL,
            levels == null ? BigDecimal.ONE : null, levels, null, 1, TIME, updatedAt);
    }

    private static Map<String, BigDecimal> levels(int first, int last) {
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (int i = first; i <= last; i++) {
            result.put(Integer.toString(i), BigDecimal.valueOf(i));
        }
        return result;
    }
}
