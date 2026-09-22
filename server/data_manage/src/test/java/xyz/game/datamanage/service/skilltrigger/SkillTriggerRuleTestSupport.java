package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAdvanceProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCastPhase;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCatalogLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerFailProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUseScope;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldown;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthDirection;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventMoment;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerParameterRefRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessFailureReason;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleUpdateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStartProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.error.ApiException;

final class SkillTriggerRuleTestSupport {

    static final String GAME_ID = "lol";
    static final String SKILL_KEY = "ezreal_q";
    static final String EFFECT_KEY = "burst";
    static final String RESULT_KEY = "damage";
    static final String PROCESS_KEY = "cast";
    static final String FORMULA_KEY = "threshold_f";
    static final String ATTRIBUTE_KEY = "hp";
    static final OffsetDateTime TS = OffsetDateTime.parse("2026-08-29T00:00:00Z");

    private SkillTriggerRuleTestSupport() {
    }

    static SkillTriggerRuleService service(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillTriggerRuleMapper mapper
    ) {
        return new SkillTriggerRuleService(
            gamesMapper,
            skillMapper,
            mapper,
            new SkillTriggerRuleAssembler(),
            new SkillTriggerRuntimeInputAnalyzer(mapper),
            new SkillTriggerCycleValidator(mapper),
            org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class)
        );
    }

    static void stubParentAndCatalogs(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillTriggerRuleMapper mapper
    ) {
        // Capture the actual root write and deserialize those bytes for later GET/update calls.
        Map<String, SkillTriggerRuleRow> stored = new java.util.HashMap<>();
        org.mockito.stubbing.Answer<Integer> save = invocation -> {
            SkillTriggerRuleRow row = new SkillTriggerRuleRow(
                invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2),
                invocation.getArgument(3), invocation.getArgument(4), invocation.getArgument(5),
                SkillTriggerEventType.valueOf(invocation.getArgument(6)), TS, TS,
                invocation.getArgument(7), invocation.getArgument(8), invocation.getArgument(9), invocation.getArgument(10));
            stored.put(row.ruleKey(), row);
            return 1;
        };
        lenient().when(mapper.insertRule(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenAnswer(save);
        lenient().when(mapper.updateRule(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
            .thenAnswer(save);
        lenient().when(mapper.findRule(eq(GAME_ID), eq(SKILL_KEY), anyString()))
            .thenAnswer(invocation -> stored.get(invocation.getArgument(2)));
        lenient().when(mapper.findRuleForUpdate(eq(GAME_ID), eq(SKILL_KEY), anyString()))
            .thenAnswer(invocation -> stored.get(invocation.getArgument(2)));
        lenient().when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
        lenient().when(skillMapper.findById(GAME_ID, SKILL_KEY)).thenReturn(skill());
        lenient().when(skillMapper.findByIdForUpdate(GAME_ID, SKILL_KEY)).thenReturn(skill());
        lenient().when(mapper.listRulesForUpdate(GAME_ID, SKILL_KEY)).thenAnswer(invocation -> List.copyOf(stored.values()));
        lenient().when(mapper.countByKey(eq(GAME_ID), eq(SKILL_KEY), anyString())).thenReturn(0L);
        lenient().when(mapper.lockAttributes(eq(GAME_ID), anyCollection())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(1);
            List<SkillTriggerCatalogLockRow> rows = new ArrayList<>();
            for (String key : keys) {
                rows.add(new SkillTriggerCatalogLockRow(key, "ENABLED", "DECIMAL"));
            }
            return rows;
        });
        lenient().when(mapper.lockStatuses(eq(GAME_ID), anyCollection())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(1);
            List<SkillTriggerCatalogLockRow> rows = new ArrayList<>();
            for (String key : keys) {
                rows.add(new SkillTriggerCatalogLockRow(key, "ENABLED", null));
            }
            return rows;
        });
        lenient().when(mapper.lockFormulas(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> List.copyOf(invocation.getArgument(2)));
        lenient().when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        lenient().when(mapper.lockEffects(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> List.copyOf(invocation.getArgument(2)));
        lenient().when(mapper.lockProcesses(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenAnswer(invocation -> List.copyOf(invocation.getArgument(2)));
        lenient().when(mapper.lockSteps(eq(GAME_ID), eq(SKILL_KEY), anyString(), any()))
            .thenAnswer(invocation -> List.copyOf(invocation.getArgument(3)));
        lenient().when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection())).thenReturn(List.of());
        lenient().when(mapper.lockSkills(eq(GAME_ID), anyCollection())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(1);
            List<SkillTriggerCatalogLockRow> rows = new ArrayList<>();
            for (String key : keys) {
                rows.add(new SkillTriggerCatalogLockRow(key, "ENABLED", null));
            }
            return rows;
        });
        lenient().when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(damageShape(EFFECT_KEY, RESULT_KEY)));
        lenient().when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(processShape(PROCESS_KEY)));
        lenient().when(mapper.countRuntimeInputNodes(eq(GAME_ID), eq(SKILL_KEY), anyString())).thenReturn(0L);
        lenient().when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of());
        lenient().when(mapper.deleteRule(eq(GAME_ID), eq(SKILL_KEY), anyString()))
            .thenAnswer(invocation -> stored.remove(invocation.getArgument(2)) == null ? 0 : 1);
        lenient().when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        lenient().when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        lenient().when(mapper.listCooldownsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        lenient().when(mapper.listProcessLimitsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of());
    }

    static SkillTriggerRuleCreateRequest emptyEventExecute(
        String ruleKey,
        SkillTriggerEventType eventType,
        String actionKey,
        String effectKey
    ) {
        return rule(ruleKey, new SkillTriggerEventSource(eventType, new SkillTriggerEmptyEventDetail()),
            List.of(executeAction(actionKey, effectKey)));
    }

    static SkillTriggerRuleCreateRequest rule(
        String ruleKey,
        SkillTriggerEventSource eventSource,
        List<SkillTriggerAction> actions
    ) {
        return new SkillTriggerRuleCreateRequest(
            ruleKey, ruleKey, null, 10, eventSource, List.of(), actions, null, null, null
        );
    }

    static SkillTriggerOncePerUse oncePerUse(String groupKey, SkillTriggerOncePerUseScope scope) {
        return new SkillTriggerOncePerUse(groupKey, scope);
    }

    static SkillTriggerRuleCreateRequest oncePerUseRule(
        String ruleKey,
        SkillTriggerEventType eventType,
        SkillTriggerOncePerUse oncePerUse
    ) {
        return oncePerUseRule(ruleKey, eventType, oncePerUse, null, null);
    }

    static SkillTriggerRuleCreateRequest oncePerUseRule(
        String ruleKey,
        SkillTriggerEventType eventType,
        SkillTriggerOncePerUse oncePerUse,
        SkillTriggerPerTargetCooldown cooldown,
        SkillTriggerProcessLimit processLimit
    ) {
        SkillTriggerEventSource source = switch (eventType) {
            case SKILL_HIT -> new SkillTriggerEventSource(
                eventType, new SkillTriggerSkillEventDetail(SKILL_KEY, null)
            );
            case SKILL_USED -> skillUsed(SkillTriggerCastPhase.INITIAL);
            case PROCESS_MOMENT -> processStart(PROCESS_KEY);
            default -> new SkillTriggerEventSource(eventType, new SkillTriggerEmptyEventDetail());
        };
        return new SkillTriggerRuleCreateRequest(
            ruleKey, ruleKey, null, 10, source, List.of(),
            List.of(executeAction(ruleKey + "_act", EFFECT_KEY)),
            cooldown, processLimit, oncePerUse
        );
    }

    static SkillTriggerRuleUpdateRequest updateFromCreate(SkillTriggerRuleCreateRequest request) {
        return new SkillTriggerRuleUpdateRequest(
            null,
            request.name(),
            request.description(),
            request.sortOrder(),
            request.eventSource(),
            request.conditionGroups(),
            request.actions(),
            request.perTargetCooldown(),
            request.maxTriggersPerProcess(),
            request.oncePerUse()
        );
    }

    static SkillTriggerAction executeAction(String actionKey, String effectKey) {
        return new SkillTriggerAction(
            actionKey,
            "执行效果",
            SkillTriggerActionType.EXECUTE_EFFECT,
            10,
            SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail(effectKey),
            List.of(),
            List.of()
        );
    }

    static SkillTriggerAction startProcessAction(String actionKey, String processKey) {
        return new SkillTriggerAction(
            actionKey,
            "启动过程",
            SkillTriggerActionType.START_PROCESS,
            10,
            SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerStartProcessActionDetail(processKey),
            List.of(),
            List.of()
        );
    }

    static SkillTriggerAction failProcessAction(String actionKey, String processKey, SkillTriggerProcessFailureReason reason) {
        return new SkillTriggerAction(
            actionKey,
            "令过程失败",
            SkillTriggerActionType.FAIL_PROCESS,
            20,
            null,
            new SkillTriggerFailProcessActionDetail(processKey, reason),
            List.of(),
            List.of()
        );
    }

    static SkillTriggerAction advanceProcessAction(String actionKey, String processKey, String stepKey) {
        return new SkillTriggerAction(
            actionKey,
            "推进过程",
            SkillTriggerActionType.ADVANCE_PROCESS,
            10,
            null,
            new SkillTriggerAdvanceProcessActionDetail(processKey, stepKey),
            List.of(),
            List.of()
        );
    }

    static SkillTriggerEventSource skillUsed(SkillTriggerCastPhase phase) {
        return new SkillTriggerEventSource(
            SkillTriggerEventType.SKILL_USED,
            new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE, phase)
        );
    }

    static SkillTriggerProcessShapeRow recastStep(String processKey, String stepKey) {
        return new SkillTriggerProcessShapeRow(
            processKey, null, null, null, null, null, stepKey, SkillProcessStepType.RECAST,
            null, null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, SkillProcessActivationType.ACTIVE
        );
    }

    static SkillTriggerProcessShapeRow chargeStep(String processKey, String stepKey) {
        return new SkillTriggerProcessShapeRow(
            processKey, null, null, null, null, null, stepKey, SkillProcessStepType.CHARGE,
            null, null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, SkillProcessActivationType.ACTIVE
        );
    }

    static SkillTriggerProcessShapeRow processActivation(String processKey, SkillProcessActivationType activationType) {
        return new SkillTriggerProcessShapeRow(
            processKey, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, activationType
        );
    }

    static SkillTriggerEventSource healthDown() {
        return new SkillTriggerEventSource(
            SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED,
            new SkillTriggerHealthThresholdEventDetail(
                SkillTriggerSubject.SOURCE, ATTRIBUTE_KEY, SkillNumericValue.formula(FORMULA_KEY), SkillTriggerHealthDirection.DOWNWARD
            )
        );
    }

    static SkillTriggerEventSource lifecycleFullStacks(String effectKey) {
        return new SkillTriggerEventSource(
            SkillTriggerEventType.LIFECYCLE_MOMENT,
            new SkillTriggerLifecycleEventDetail(effectKey, SkillTriggerLifecycleEventMoment.FULL_STACKS)
        );
    }

    static SkillTriggerEventSource processStart(String processKey) {
        return processMoment(processKey, SkillProcessMomentType.PROCESS_START, null);
    }

    static SkillTriggerEventSource processMoment(
        String processKey,
        SkillProcessMomentType momentType,
        SkillTriggerProcessFailureReason failureReason
    ) {
        return new SkillTriggerEventSource(
            SkillTriggerEventType.PROCESS_MOMENT,
            new SkillTriggerProcessEventDetail(processKey, new SkillProcessMoment(momentType, null, failureReason))
        );
    }

    static SkillTriggerEventSource resultAvailable(String effectKey, String resultKey) {
        return new SkillTriggerEventSource(
            SkillTriggerEventType.RESULT_AVAILABLE,
            new SkillTriggerResultEventDetail(effectKey, resultKey)
        );
    }

    static SkillTriggerEffectShapeRow damageShape(String effectKey, String resultKey) {
        return damageShape(effectKey, resultKey, "base_damage");
    }

    static SkillTriggerEffectShapeRow damageShape(String effectKey, String resultKey, String formulaKey) {
        return new SkillTriggerEffectShapeRow(
            effectKey, resultKey, SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET,
            true, formulaKey == null ? null : SkillNumericValue.formula(formulaKey), null, null, null, null, null, null, null,
            false, null, null, null, null, null
        );
    }

    static SkillTriggerEffectShapeRow shieldShape(String effectKey, String resultKey) {
        return new SkillTriggerEffectShapeRow(
            effectKey, resultKey, SkillEffectResultType.NORMAL_SHIELD, SkillEffectTarget.TARGET,
            true, SkillNumericValue.formula("shield_f"), null, null, null, null, null, null, null,
            false, null, null, null, null, null
        );
    }

    static SkillTriggerEffectShapeRow healShape(String effectKey, String resultKey) {
        return new SkillTriggerEffectShapeRow(
            effectKey, resultKey, SkillEffectResultType.DIRECT_HEAL, SkillEffectTarget.TARGET,
            true, SkillNumericValue.formula("heal_f"), null, null, null, null, null, null, null,
            false, null, null, null, null, null
        );
    }

    static SkillTriggerEffectShapeRow lifecycleShape(
        String effectKey,
        String resultKey,
        String durationValue,
        String periodicValue,
        SkillEffectLifecycleExpiryMode expiryMode
    ) {
        return new SkillTriggerEffectShapeRow(
            effectKey, resultKey, SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET,
            true, SkillNumericValue.formula("base_damage"), null, null, null, null, null, null, null,
            true, durationValue == null ? null : SkillNumericValue.formula(durationValue), SkillNumericValue.formula("max_stacks_f"), SkillNumericValue.formula("app_stacks_f"), periodicValue == null ? null : SkillNumericValue.formula(periodicValue), expiryMode
        );
    }

    static SkillTriggerProcessShapeRow processShape(String processKey) {
        return processShape(processKey, null, null, null, null, null, null);
    }

    static SkillTriggerProcessShapeRow cooldownOp(
        String processKey,
        String stateKey,
        SkillProcessStateOperationKind operation
    ) {
        return processShape(processKey, null, stateKey, operation, SkillInternalStateType.INTERNAL_COOLDOWN, null, null);
    }

    static SkillTriggerProcessShapeRow bindingProcess(String processKey, String effectKey) {
        return processShape(
            processKey, effectKey, null, null, null, "hit", SkillProcessStepType.IMMEDIATE
        );
    }

    private static SkillTriggerProcessShapeRow processShape(
        String processKey,
        String bindingEffectKey,
        String operationStateKey,
        SkillProcessStateOperationKind operation,
        SkillInternalStateType stateType,
        String stepKey,
        SkillProcessStepType stepType
    ) {
        return new SkillTriggerProcessShapeRow(
            processKey, bindingEffectKey, operationStateKey, operation, null, stateType, stepKey, stepType,
            null, null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null
        );
    }

    static SkillTriggerParameterRefRow runtimeParam(String parameterKey, SkillParameterValueType type) {
        return new SkillTriggerParameterRefRow(parameterKey, type, SkillParameterValueMode.RUNTIME_INPUT.name());
    }

    static SkillTriggerInternalStateLockRow state(String stateKey, SkillInternalStateType type) {
        return new SkillTriggerInternalStateLockRow(stateKey, type, "SKILL");
    }

    static SkillTriggerRuleRow ruleRow(String ruleKey, String name, SkillTriggerEventType eventType) {
        return new SkillTriggerRuleRow(GAME_ID, SKILL_KEY, ruleKey, name, null, 10, eventType, TS, TS,
            xyz.game.datamanage.support.authoring.AggregateJson.write(
                new SkillTriggerEventSource(eventType, new SkillTriggerEmptyEventDetail())),
            "[]", "[]", "{\"perTargetCooldown\":null,\"maxTriggersPerProcess\":null,\"oncePerUse\":null}");
    }

    static SkillTriggerActionRow executeActionRow(String ruleKey, String actionKey) {
        return new SkillTriggerActionRow(
            GAME_ID, SKILL_KEY, ruleKey, actionKey, "执行", SkillTriggerActionType.EXECUTE_EFFECT, 10,
            SkillTriggerTargetContext.CURRENT_TARGET
        );
    }

    static SkillTriggerActionRow startActionRow(String ruleKey, String actionKey) {
        return new SkillTriggerActionRow(
            GAME_ID, SKILL_KEY, ruleKey, actionKey, "启动", SkillTriggerActionType.START_PROCESS, 10,
            SkillTriggerTargetContext.CURRENT_TARGET
        );
    }

    static SkillTriggerEffectActionRow effectActionRow(String ruleKey, String actionKey, String effectKey) {
        return new SkillTriggerEffectActionRow(GAME_ID, SKILL_KEY, ruleKey, actionKey, effectKey);
    }

    static SkillTriggerProcessActionRow processActionRow(String ruleKey, String actionKey, String processKey) {
        return new SkillTriggerProcessActionRow(
            GAME_ID, SKILL_KEY, ruleKey, actionKey, SkillTriggerActionType.START_PROCESS, processKey, null, null
        );
    }

    static SkillTriggerProcessActionRow failProcessActionRow(
        String ruleKey,
        String actionKey,
        String processKey,
        SkillTriggerProcessFailureReason reason
    ) {
        return new SkillTriggerProcessActionRow(
            GAME_ID, SKILL_KEY, ruleKey, actionKey, SkillTriggerActionType.FAIL_PROCESS, processKey, null, reason
        );
    }

    static SkillTriggerProcessActionRow advanceProcessActionRow(
        String ruleKey,
        String actionKey,
        String processKey,
        String stepKey
    ) {
        return new SkillTriggerProcessActionRow(
            GAME_ID, SKILL_KEY, ruleKey, actionKey, SkillTriggerActionType.ADVANCE_PROCESS, processKey, stepKey, null
        );
    }

    static SkillRow skill() {
        return new SkillRow(GAME_ID, SKILL_KEY, "秘术射击", null, 5, SkillStatus.ENABLED, 10, TS, TS);
    }

    static void assertCode(String code, Runnable action) {
        ApiException exception = assertThrows(ApiException.class, action::run);
        assertEquals(code, exception.getCode());
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, String>> fieldIssues(ApiException exception) {
        return (List<Map<String, String>>) exception.getDetails().get("fieldIssues");
    }

    static void assertField(ApiException exception, String field, String code) {
        List<Map<String, String>> issues = fieldIssues(exception);
        assertTrue(
            issues.stream().anyMatch(issue -> field.equals(issue.get("field")) && code.equals(issue.get("code"))),
            () -> "expected " + field + "/" + code + " but was " + issues
        );
    }

    static ApiException thrown(Runnable action) {
        return assertThrows(ApiException.class, action::run);
    }
}
