package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.ATTRIBUTE_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.EFFECT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.FORMULA_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.PROCESS_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.RESULT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.TS;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertCode;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertField;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.emptyEventExecute;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.executeAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.failProcessAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.healthDown;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.lifecycleFullStacks;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.lifecycleShape;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.resultAvailable;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.startProcessAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubAssembleExecuteEffect;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubParentAndCatalogs;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.thrown;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.updateFromCreate;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataIntegrityViolationException;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skilleffect.SkillEffectAffectedSkillScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicy;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDeliveryKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationStackMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultLifecycleBehaviorRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectSkillScopeMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldBlockScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampBasisOutputKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampRule;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampType;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAttributeConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerComparator;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCondition;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroupRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageDeliveryKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageOriginKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleValueReadMode;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLinkEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputs;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerReferenceHit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSpellShieldBlockedEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerValueDomain;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerFailProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventMoment;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldown;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldownRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessFailureReason;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifier;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifierRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleSummaryResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputSourceType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusCheckKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerRuleServiceTest {

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillTriggerRuleMapper mapper;

    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(gamesMapper, skillMapper, mapper);
        service = SkillTriggerRuleTestSupport.service(gamesMapper, skillMapper, mapper);
    }

    @Test
    void listsGetsCreatesUpdatesAndDeletesWithParent404DuplicateKeyAndRoundTrip() {
        when(mapper.listSummaries(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerRuleSummaryResponse(
                "on_hit", "命中追加", null, SkillTriggerEventType.BASIC_ATTACK_HIT,
                0, 1, false, false, 10, TS
            )
        ));
        var summaries = service.list(GAME_ID, SKILL_KEY);
        assertEquals(1, summaries.size());
        assertEquals("on_hit", summaries.get(0).ruleKey());
        assertEquals(SkillTriggerEventType.BASIC_ATTACK_HIT, summaries.get(0).eventType());

        when(gamesMapper.countGames("missing")).thenReturn(0L);
        assertCode("404.GAME_NOT_FOUND", () -> service.list("missing", SKILL_KEY));
        when(skillMapper.findById(GAME_ID, "missing")).thenReturn(null);
        assertCode("404.SKILL_NOT_FOUND", () -> service.list(GAME_ID, "missing"));

        SkillTriggerRuleCreateRequest create = emptyEventExecute(
            "on_hit", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY
        );
        stubAssembleExecuteEffect(mapper, "on_hit", "on_hit", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        SkillTriggerRuleDetailResponse created = service.create(GAME_ID, SKILL_KEY, create);
        assertEquals("on_hit", created.ruleKey());
        assertEquals(SkillTriggerEventType.BASIC_ATTACK_HIT, created.eventSource().eventType());
        assertInstanceOf(SkillTriggerEmptyEventDetail.class, created.eventSource().detail());
        assertEquals(1, created.actions().size());
        assertEquals(EFFECT_KEY, ((SkillTriggerExecuteEffectActionDetail) created.actions().get(0).detail()).effectKey());
        verify(mapper).insertRule(GAME_ID, SKILL_KEY, "on_hit", "on_hit", null, 10, "BASIC_ATTACK_HIT");
        verify(mapper).insertAction(
            eq(GAME_ID), eq(SKILL_KEY), eq("on_hit"), eq("deal"), eq("执行效果"),
            eq("EXECUTE_EFFECT"), eq(10), eq("CURRENT_TARGET")
        );
        verify(mapper).forceDeferredConstraintsImmediate();

        SkillTriggerRuleDetailResponse fetched = service.get(GAME_ID, SKILL_KEY, "on_hit");
        assertEquals("on_hit", fetched.ruleKey());
        assertEquals(10, fetched.sortOrder());

        when(mapper.countByKey(GAME_ID, SKILL_KEY, "on_hit")).thenReturn(1L);
        assertCode("409.SKILL_TRIGGER_RULE_KEY_EXISTS", () -> service.create(GAME_ID, SKILL_KEY, create));

        when(mapper.findRuleForUpdate(GAME_ID, SKILL_KEY, "missing")).thenReturn(null);
        assertCode("404.SKILL_TRIGGER_RULE_NOT_FOUND", () -> service.get(GAME_ID, SKILL_KEY, "missing"));

        SkillTriggerRuleCreateRequest renamed = new SkillTriggerRuleCreateRequest(
            "on_hit", "命中追加", "命中后追加伤害", 20, create.eventSource(),
            List.of(), List.of(executeAction("deal", EFFECT_KEY)), null, null
        );
        SkillTriggerRuleDetailResponse updated = service.update(
            GAME_ID, SKILL_KEY, "on_hit", updateFromCreate(renamed)
        );
        assertEquals("on_hit", updated.ruleKey());
        InOrder order = inOrder(mapper);
        order.verify(mapper).updateRule(GAME_ID, SKILL_KEY, "on_hit", "命中追加", "命中后追加伤害", 20, "BASIC_ATTACK_HIT");
        order.verify(mapper).deleteChildren(GAME_ID, SKILL_KEY, "on_hit");
        order.verify(mapper).forceDeferredConstraintsImmediate();

        service.delete(GAME_ID, SKILL_KEY, "on_hit");
        verify(mapper).deleteRule(GAME_ID, SKILL_KEY, "on_hit");
    }

    @Test
    void duplicatePrimaryKeyMapsToStableConflictAndDoesNotLeavePartialWrite() {
        SkillTriggerRuleCreateRequest create = emptyEventExecute(
            "on_hit", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY
        );
        when(mapper.insertRule(any(), any(), any(), any(), any(), any(), any())).thenThrow(
            new DataIntegrityViolationException("violates unique constraint pk_skill_trigger_rules")
        );
        assertCode("409.SKILL_TRIGGER_RULE_KEY_EXISTS", () -> service.create(GAME_ID, SKILL_KEY, create));
        verify(mapper, never()).forceDeferredConstraintsImmediate();
    }

    @Test
    void pendingDamageEventFiltersRoundTripAndPersistAsOneAggregate() {
        when(mapper.lockDamageTypes(eq(GAME_ID), any())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(1);
            return keys.stream()
                .map(key -> new xyz.game.datamanage.model.skilltrigger.SkillTriggerCatalogLockRow(
                    key, "ENABLED", null
                ))
                .toList();
        });
        SkillTriggerRuleCreateRequest create = new SkillTriggerRuleCreateRequest(
            "before_physical_basic_damage",
            "即将受到物理普攻伤害",
            null,
            10,
            new SkillTriggerEventSource(
                SkillTriggerEventType.DAMAGE_PENDING,
                new SkillTriggerDamageEventDetail(
                    "physical",
                    SkillTriggerDamageDeliveryKind.BASIC_ATTACK,
                    SkillTriggerDamageOriginKind.DIRECT
                )
            ),
            List.of(),
            List.of(executeAction("deal", EFFECT_KEY)),
            null,
            null
        );
        stubAssembleExecuteEffect(
            mapper,
            "before_physical_basic_damage",
            "即将受到物理普攻伤害",
            SkillTriggerEventType.DAMAGE_PENDING,
            "deal",
            EFFECT_KEY
        );
        when(mapper.findDamageEvent(GAME_ID, SKILL_KEY, "before_physical_basic_damage")).thenReturn(
            new SkillTriggerDamageEventRow(
                GAME_ID,
                SKILL_KEY,
                "before_physical_basic_damage",
                "physical",
                SkillTriggerDamageDeliveryKind.BASIC_ATTACK,
                SkillTriggerDamageOriginKind.DIRECT
            )
        );

        SkillTriggerRuleDetailResponse response = service.create(GAME_ID, SKILL_KEY, create);

        SkillTriggerDamageEventDetail saved = (SkillTriggerDamageEventDetail) response.eventSource().detail();
        assertEquals("physical", saved.damageTypeKey());
        assertEquals(SkillTriggerDamageDeliveryKind.BASIC_ATTACK, saved.deliveryKind());
        assertEquals(SkillTriggerDamageOriginKind.DIRECT, saved.originKind());
        verify(mapper).insertDamageEvent(
            GAME_ID,
            SKILL_KEY,
            "before_physical_basic_damage",
            "physical",
            "BASIC_ATTACK",
            "DIRECT"
        );
    }

    @Test
    void reflectedEffectUpdateChecksRulesThatReachItThroughAProcess() {
        String ruleKey = "reflect_from_process";
        String actionKey = "start_reflect_process";
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.ruleRow(ruleKey, "启动反伤过程", SkillTriggerEventType.DAMAGE_TAKEN)
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID,
                SKILL_KEY,
                ruleKey,
                actionKey,
                "启动反伤过程",
                SkillTriggerActionType.START_PROCESS,
                10,
                SkillTriggerTargetContext.CURRENT_TARGET
            )
        ));
        when(mapper.listProcessActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.processActionRow(ruleKey, actionKey, PROCESS_KEY)
        ));
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.bindingProcess(PROCESS_KEY, EFFECT_KEY)
        ));
        when(mapper.listDamageEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerDamageEventRow(
                GAME_ID,
                SKILL_KEY,
                ruleKey,
                null,
                SkillTriggerDamageDeliveryKind.ANY,
                SkillTriggerDamageOriginKind.DIRECT
            )
        ));

        SkillEffectDamageDetail reflected = new SkillEffectDamageDetail(
            "magic",
            SkillEffectDamageDeliveryKind.SKILL,
            SkillEffectDamageOriginKind.REFLECTED,
            new SkillEffectCriticalPolicy(SkillEffectCriticalMode.DISALLOWED, null),
            List.of()
        );
        ApiException exception = thrown(() -> service.assertEffectUpdate(
            GAME_ID,
            SKILL_KEY,
            EFFECT_KEY,
            null,
            null,
            List.of(new SkillEffectResultRequest(
                "reflected_damage",
                "反伤",
                SkillEffectResultType.DAMAGE,
                SkillEffectTarget.TARGET,
                null,
                0,
                null,
                reflected
            )),
            List.of()
        ));

        assertEquals("400.TRIGGER_RULE_CYCLE_UNGUARDED", exception.getCode());
        assertField(exception, "results[0].detail.originKind", "REFLECT_LOOP_UNGUARDED");
    }

    @Test
    void interactionFormulaChangeBlocksDirectAndProcessRulesInStableOrder() {
        String directRule = "z_direct_rule";
        String processRule = "a_process_rule";
        when(mapper.listEffectInteractionFormulaKeys(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, directRule, "execute", "直接执行",
                SkillTriggerActionType.EXECUTE_EFFECT, 10, SkillTriggerTargetContext.CURRENT_TARGET
            ),
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, processRule, "start", "启动过程",
                SkillTriggerActionType.START_PROCESS, 10, SkillTriggerTargetContext.CURRENT_TARGET
            )
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow(directRule, "execute", EFFECT_KEY)
        ));
        when(mapper.listProcessActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.processActionRow(processRule, "start", PROCESS_KEY)
        ));
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.bindingProcess(PROCESS_KEY, EFFECT_KEY)
        ));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenAnswer(invocation -> {
            Collection<String> formulaKeys = invocation.getArgument(2);
            return formulaKeys.contains("interaction_formula")
                ? List.of(SkillTriggerRuleTestSupport.runtimeParam(
                    "interaction_ratio",
                    xyz.game.datamanage.model.skillparameter.SkillParameterValueType.DECIMAL
                ))
                : List.of();
        });

        SkillEffectDamageDetail candidate = new SkillEffectDamageDetail(
            "physical",
            SkillEffectDamageDeliveryKind.SKILL,
            SkillEffectDamageOriginKind.DIRECT,
            new SkillEffectCriticalPolicy(
                SkillEffectCriticalMode.SOURCE_CRIT_CHANCE,
                "interaction_formula"
            ),
            List.of()
        );
        ApiException exception = thrown(() -> service.assertEffectUpdate(
            GAME_ID,
            SKILL_KEY,
            EFFECT_KEY,
            null,
            null,
            List.of(new SkillEffectResultRequest(
                "damage",
                "伤害",
                SkillEffectResultType.DAMAGE,
                SkillEffectTarget.TARGET,
                null,
                0,
                null,
                candidate
            )),
            List.of()
        ));

        assertEquals("409.SKILL_EFFECT_IN_USE", exception.getCode());
        List<Map<String, String>> issues = SkillTriggerRuleTestSupport.fieldIssues(exception);
        assertEquals(2, issues.size());
        assertEquals("results[0].detail.critical.multiplierFormulaKey", issues.get(0).get("field"));
        assertEquals("a_process_rule", issues.get(0).get("ruleKey"));
        assertEquals("z_direct_rule", issues.get(1).get("ruleKey"));
        assertEquals("interaction_ratio", issues.get(0).get("parameterKey"));
    }

    @Test
    void emptyActionsAndEmptyConditionGroupsAndFailProcessNotLastAreRejected() {
        assertCode("400.VALIDATION_FAILED", () -> service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "bad", "坏规则", null, 0,
                new SkillTriggerEventSource(SkillTriggerEventType.CONTROL_RECEIVED, new SkillTriggerEmptyEventDetail()),
                List.of(),
                List.of(),
                null,
                null
            )
        ));
        ApiException emptyGroup = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "bad_group", "空组", null, 0,
                new SkillTriggerEventSource(SkillTriggerEventType.CONTROL_RECEIVED, new SkillTriggerEmptyEventDetail()),
                List.of(new SkillTriggerConditionGroup("g", "组", 0, List.of())),
                List.of(executeAction("deal", EFFECT_KEY)),
                null,
                null
            )
        ));
        assertEquals("400.VALIDATION_FAILED", emptyGroup.getCode());
        assertField(emptyGroup, "conditionGroups[0].conditions", "REQUIRED");

        ApiException failNotLast = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "fail_mid", "失败不在最后", null, 0,
                new SkillTriggerEventSource(SkillTriggerEventType.CONTROL_RECEIVED, new SkillTriggerEmptyEventDetail()),
                List.of(),
                List.of(
                    new SkillTriggerAction(
                        "fail",
                        "令过程失败",
                        SkillTriggerActionType.FAIL_PROCESS,
                        10,
                        null,
                        new SkillTriggerFailProcessActionDetail(
                            PROCESS_KEY, SkillTriggerProcessFailureReason.CONTROLLED
                        ),
                        List.of(),
                        List.of()
                    ),
                    new SkillTriggerAction(
                        "deal",
                        "执行效果",
                        SkillTriggerActionType.EXECUTE_EFFECT,
                        20,
                        SkillTriggerTargetContext.CURRENT_TARGET,
                        new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY),
                        List.of(),
                        List.of()
                    )
                ),
                null,
                null
            )
        ));
        assertEquals("400.VALIDATION_FAILED", failNotLast.getCode());
        assertField(failNotLast, "actions", "FAIL_PROCESS_NOT_LAST");
    }

    @Test
    void fullStackDetonationLowHealthOnHitPriorResultEmpoweredAttackAndProcessFailureRoundTrip() {
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.damageShape("focus_burst", "damage"),
            SkillTriggerRuleTestSupport.damageShape("remove_focus_mark", "remove"),
            lifecycleShape(
                "focus_mark", "mark", "duration_f", null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            ),
            SkillTriggerRuleTestSupport.shieldShape("guardian_shield", "shield"),
            SkillTriggerRuleTestSupport.damageShape("first_hit", "damage"),
            SkillTriggerRuleTestSupport.damageShape("follow_up", RESULT_KEY, "follow_damage")
        ));
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.processShape(PROCESS_KEY)
        ));

        stubAssembleExecuteEffect(mapper, "detonate_at_full_stacks", "满层引爆",
            SkillTriggerEventType.LIFECYCLE_MOMENT, "deal_burst", "focus_burst");
        when(mapper.listActions(GAME_ID, SKILL_KEY, "detonate_at_full_stacks")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("detonate_at_full_stacks", "deal_burst"),
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, "detonate_at_full_stacks", "remove_mark", "移除标记",
                SkillTriggerActionType.EXECUTE_EFFECT, 20, SkillTriggerTargetContext.CURRENT_TARGET
            )
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, "detonate_at_full_stacks")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("detonate_at_full_stacks", "deal_burst", "focus_burst"),
            SkillTriggerRuleTestSupport.effectActionRow("detonate_at_full_stacks", "remove_mark", "remove_focus_mark")
        ));
        when(mapper.findLifecycleEvent(GAME_ID, SKILL_KEY, "detonate_at_full_stacks")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventRow(
                GAME_ID, SKILL_KEY, "detonate_at_full_stacks", "focus_mark",
                SkillTriggerLifecycleEventMoment.FULL_STACKS
            )
        );
        SkillTriggerRuleDetailResponse detonate = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "detonate_at_full_stacks",
                "满层引爆",
                "达到满层后先造成伤害，再移除标记",
                10,
                lifecycleFullStacks("focus_mark"),
                List.of(),
                List.of(
                    executeAction("deal_burst", "focus_burst"),
                    new SkillTriggerAction(
                        "remove_mark", "移除标记", SkillTriggerActionType.EXECUTE_EFFECT, 20,
                        SkillTriggerTargetContext.CURRENT_TARGET,
                        new SkillTriggerExecuteEffectActionDetail("remove_focus_mark"),
                        List.of(),
                        List.of()
                    )
                ),
                null,
                null
            )
        );
        assertEquals("detonate_at_full_stacks", detonate.ruleKey());
        assertEquals(SkillTriggerLifecycleEventMoment.FULL_STACKS,
            ((SkillTriggerLifecycleEventDetail) detonate.eventSource().detail()).moment());
        assertEquals(2, detonate.actions().size());

        stubAssembleExecuteEffect(mapper, "low_health_shield", "低生命护盾",
            SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED, "apply_shield", "guardian_shield");
        when(mapper.findHealthEvent(GAME_ID, SKILL_KEY, "low_health_shield")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventRow(
                GAME_ID, SKILL_KEY, "low_health_shield", SkillTriggerSubject.SOURCE, ATTRIBUTE_KEY, FORMULA_KEY,
                xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthDirection.DOWNWARD
            )
        );
        when(mapper.listConditionGroups(GAME_ID, SKILL_KEY, "low_health_shield")).thenReturn(List.of(
            new SkillTriggerConditionGroupRow(GAME_ID, SKILL_KEY, "low_health_shield", "low", "目标低生命值", 10)
        ));
        when(mapper.listConditions(GAME_ID, SKILL_KEY, "low_health_shield")).thenReturn(List.of(
            new SkillTriggerConditionRow(
                GAME_ID, SKILL_KEY, "low_health_shield", "low", "ratio",
                SkillTriggerConditionType.ATTRIBUTE_COMPARE, 10
            )
        ));
        when(mapper.listAttributeConditions(GAME_ID, SKILL_KEY, "low_health_shield")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerAttributeConditionRow(
                GAME_ID, SKILL_KEY, "low_health_shield", "low", "ratio",
                SkillTriggerSubject.SOURCE, ATTRIBUTE_KEY, AttributeValueKind.CURRENT_RATIO,
                SkillTriggerComparator.LTE, "low_health_ratio"
            )
        ));
        when(mapper.findCooldown(GAME_ID, SKILL_KEY, "low_health_shield")).thenReturn(
            new SkillTriggerPerTargetCooldownRow(
                GAME_ID, SKILL_KEY, "low_health_shield", "per_target_cd", SkillTriggerTargetContext.CURRENT_TARGET
            )
        );
        when(mapper.listActions(GAME_ID, SKILL_KEY, "low_health_shield")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("low_health_shield", "apply_shield")
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, "low_health_shield")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("low_health_shield", "apply_shield", "guardian_shield")
        ));
        SkillTriggerRuleDetailResponse shield = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "low_health_shield",
                "低生命护盾",
                null,
                20,
                healthDown(),
                List.of(new SkillTriggerConditionGroup(
                    "low",
                    "目标低生命值",
                    10,
                    List.of(new SkillTriggerCondition(
                        "ratio",
                        SkillTriggerConditionType.ATTRIBUTE_COMPARE,
                        10,
                        new SkillTriggerAttributeConditionDetail(
                            SkillTriggerSubject.SOURCE,
                            ATTRIBUTE_KEY,
                            AttributeValueKind.CURRENT_RATIO,
                            SkillTriggerComparator.LTE,
                            "low_health_ratio"
                        )
                    ))
                )),
                List.of(executeAction("apply_shield", "guardian_shield")),
                new SkillTriggerPerTargetCooldown("per_target_cd", SkillTriggerTargetContext.CURRENT_TARGET),
                null
            )
        );
        assertEquals(SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED, shield.eventSource().eventType());
        assertEquals("per_target_cd", shield.perTargetCooldown().durationFormulaKey());
        assertEquals(1, shield.conditionGroups().size());

        SkillTriggerRuleCreateRequest onHit = new SkillTriggerRuleCreateRequest(
            "on_skill_hit",
            "命中追加",
            null,
            30,
            new SkillTriggerEventSource(
                SkillTriggerEventType.SKILL_HIT,
                new SkillTriggerSkillEventDetail(SKILL_KEY, null)
            ),
            List.of(new SkillTriggerConditionGroup(
                "has_mark",
                "存在标记",
                0,
                List.of(new SkillTriggerCondition(
                    "present",
                    SkillTriggerConditionType.STATUS_CHECK,
                    0,
                    new SkillTriggerStatusConditionDetail(
                        SkillTriggerSubject.CURRENT_TARGET,
                        "focus_mark",
                        SkillTriggerStatusCheckKind.PRESENT,
                        null,
                        null,
                        null,
                        null
                    )
                ))
            )),
            List.of(executeAction("deal", "focus_burst"), executeAction("apply", "focus_mark")),
            null,
            null
        );
        stubAssembleExecuteEffect(mapper, "on_skill_hit", "命中追加", SkillTriggerEventType.SKILL_HIT, "deal", "focus_burst");
        when(mapper.findSkillEvent(GAME_ID, SKILL_KEY, "on_skill_hit")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventRow(
                GAME_ID, SKILL_KEY, "on_skill_hit", SKILL_KEY, null
            )
        );
        service.create(GAME_ID, SKILL_KEY, onHit);
        verify(mapper).insertSkillEvent(GAME_ID, SKILL_KEY, "on_skill_hit", SKILL_KEY, null);

        SkillTriggerAction first = executeAction("deal_first", "first_hit");
        SkillTriggerAction second = new SkillTriggerAction(
            "follow",
            "后续",
            SkillTriggerActionType.EXECUTE_EFFECT,
            20,
            SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail("follow_up"),
            List.of(new SkillTriggerRuntimeInputBinding(
                "from_first",
                "previous_damage",
                SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
                new SkillTriggerPriorResultBindingDetail(
                    "deal_first", RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE
                )
            )),
            List.of(new SkillTriggerResultModifier(RESULT_KEY, new BigDecimal("1.50"), null, new BigDecimal("500")))
        );
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.runtimeParam("previous_damage", xyz.game.datamanage.model.skillparameter.SkillParameterValueType.DECIMAL)
        ));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(2);
            if (keys != null && keys.contains("follow_damage")) {
                return List.of(
                    SkillTriggerRuleTestSupport.runtimeParam(
                        "previous_damage",
                        xyz.game.datamanage.model.skillparameter.SkillParameterValueType.DECIMAL
                    )
                );
            }
            return List.of();
        });
        stubAssembleExecuteEffect(mapper, "prior_result", "前序供值", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal_first", "first_hit");
        when(mapper.listActions(GAME_ID, SKILL_KEY, "prior_result")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("prior_result", "deal_first"),
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, "prior_result", "follow", "后续",
                SkillTriggerActionType.EXECUTE_EFFECT, 20, SkillTriggerTargetContext.CURRENT_TARGET
            )
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, "prior_result")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("prior_result", "deal_first", "first_hit"),
            SkillTriggerRuleTestSupport.effectActionRow("prior_result", "follow", "follow_up")
        ));
        when(mapper.listBindings(GAME_ID, SKILL_KEY, "prior_result")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBindingRow(
                GAME_ID, SKILL_KEY, "prior_result", "follow", "from_first", "previous_damage",
                SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT
            )
        ));
        when(mapper.listPriorResultBindings(GAME_ID, SKILL_KEY, "prior_result")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingRow(
                GAME_ID, SKILL_KEY, "prior_result", "follow", "from_first",
                "deal_first", "first_hit", RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE
            )
        ));
        when(mapper.listModifiers(GAME_ID, SKILL_KEY, "prior_result")).thenReturn(List.of(
            new SkillTriggerResultModifierRow(
                GAME_ID, SKILL_KEY, "prior_result", "follow", RESULT_KEY, "follow_up",
                new BigDecimal("1.50"), null, new BigDecimal("500")
            )
        ));
        SkillTriggerRuleDetailResponse prior = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "prior_result", "前序供值", null, 40,
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(),
                List.of(first, second),
                null,
                null
            )
        );
        assertEquals(1, prior.actions().get(1).runtimeInputBindings().size());
        assertEquals(new BigDecimal("1.50"), prior.actions().get(1).resultModifiers().get(0).fixedMultiplier());
        verify(mapper).insertPriorResultBinding(any());
        verify(mapper).insertModifier(
            eq(GAME_ID), eq(SKILL_KEY), eq("prior_result"), eq("follow"), eq(RESULT_KEY),
            eq("follow_up"), eq(new BigDecimal("1.50")), eq(null), eq(new BigDecimal("500"))
        );

        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.state("empowered", xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType.FLAG)
        ));
        stubAssembleExecuteEffect(mapper, "empowered_aa", "强化普攻", SkillTriggerEventType.BASIC_ATTACK_HIT, "buff", EFFECT_KEY);
        service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "empowered_aa",
                "强化普攻",
                null,
                50,
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(new SkillTriggerConditionGroup(
                    "ready",
                    "准备标记",
                    0,
                    List.of(new SkillTriggerCondition(
                        "enabled",
                        SkillTriggerConditionType.INTERNAL_STATE_CHECK,
                        0,
                        new SkillTriggerInternalStateConditionDetail(
                            "empowered",
                            SkillTriggerInternalStateValueKind.ENABLED,
                            null,
                            true,
                            null,
                            null
                        )
                    ))
                )),
                List.of(executeAction("buff", EFFECT_KEY), startProcessAction("consume", PROCESS_KEY)),
                null,
                null
            )
        );

        stubAssembleExecuteEffect(mapper, "fail_on_control", "受控失败", SkillTriggerEventType.CONTROL_RECEIVED, "fail", PROCESS_KEY);
        when(mapper.listActions(GAME_ID, SKILL_KEY, "fail_on_control")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, "fail_on_control", "fail", "令过程失败",
                SkillTriggerActionType.FAIL_PROCESS, 20, null
            )
        ));
        when(mapper.listProcessActions(GAME_ID, SKILL_KEY, "fail_on_control")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessActionRow(
                GAME_ID, SKILL_KEY, "fail_on_control", "fail", PROCESS_KEY, SkillTriggerProcessFailureReason.CONTROLLED
            )
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, "fail_on_control")).thenReturn(List.of());
        SkillTriggerRuleDetailResponse failed = service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "fail_on_control",
                "受控失败",
                null,
                60,
                new SkillTriggerEventSource(SkillTriggerEventType.CONTROL_RECEIVED, new SkillTriggerEmptyEventDetail()),
                List.of(),
                List.of(failProcessAction("fail", PROCESS_KEY, SkillTriggerProcessFailureReason.CONTROLLED)),
                null,
                null
            )
        );
        assertEquals(SkillTriggerActionType.FAIL_PROCESS, failed.actions().get(0).actionType());
        verify(mapper).insertProcessAction(GAME_ID, SKILL_KEY, "fail_on_control", "fail", PROCESS_KEY, "CONTROLLED");
    }

    @Test
    void capabilitiesTableCoversAllTwentyOneEventsAndRejectsValueReached() {
        assertEquals(21, SkillTriggerEventType.values().length);
        assertEquals(21, xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.currentTargetBindings().size());
        assertFalse(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT));
        assertFalse(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.HIT_LINK_APPLIED));
        assertFalse(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.ATTACK_LINK_APPLIED));
        assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.DAMAGE_PENDING));
        assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.DAMAGE_TAKEN));
        assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.STATUS_CHANGED));
        assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.CONTROL_RECEIVED));
        assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.SPELL_SHIELD_BLOCKED));
        assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.eventValueAllowed(
            SkillTriggerEventType.DAMAGE_PENDING,
            xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey.PROJECTED_HEALTH_AFTER,
            null,
            null
        ));
        assertFalse(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.eventValueAllowed(
            SkillTriggerEventType.DAMAGE_TAKEN,
            xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey.PROJECTED_HEALTH_AFTER,
            null,
            null
        ));
        assertFalse(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.eventValueAllowed(
            SkillTriggerEventType.HIT_LINK_APPLIED,
            xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey.RAW_DAMAGE,
            null,
            null
        ));
        assertFalse(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.eventValueAllowed(
            SkillTriggerEventType.ATTACK_LINK_APPLIED,
            xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey.HIT_INDEX,
            null,
            null
        ));
        for (SkillTriggerEventType type : SkillTriggerEventType.values()) {
            if (type != SkillTriggerEventType.DAMAGE_PENDING
                && type != SkillTriggerEventType.DAMAGE_TAKEN
                && type != SkillTriggerEventType.STATUS_CHANGED
                && type != SkillTriggerEventType.CONTROL_RECEIVED
                && type != SkillTriggerEventType.SPELL_SHIELD_BLOCKED) {
                assertFalse(
                    xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(type),
                    () -> type + " must not expose EVENT_SOURCE"
                );
            }
        }
        assertEquals(
            4,
            xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateChangeKind.values().length
        );
        for (var kind : xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateChangeKind.values()) {
            assertFalse(kind.name().equals("VALUE_REACHED"));
        }
    }

    @Test
    void stage765EventValueMatrixIsSharedByConditionsAndBindings() {
        assertEquals(23, SkillTriggerEventValueKey.values().length);
        Set<SkillTriggerEventValueKey> integerKeys = EnumSet.of(
            SkillTriggerEventValueKey.BLOCKED,
            SkillTriggerEventValueKey.IMMUNE,
            SkillTriggerEventValueKey.KILLED,
            SkillTriggerEventValueKey.LINK_INDEX,
            SkillTriggerEventValueKey.LINK_COUNT
        );
        Set<SkillTriggerEventValueKey> amountKeys = EnumSet.of(
            SkillTriggerEventValueKey.SHIELD_ABSORBED,
            SkillTriggerEventValueKey.ACTUAL_HP_LOSS
        );
        for (SkillTriggerEventValueKey key : integerKeys) {
            assertEquals(SkillTriggerValueDomain.INTEGER, SkillTriggerEventCapabilities.valueDomain(key));
        }
        for (SkillTriggerEventValueKey key : amountKeys) {
            assertEquals(SkillTriggerValueDomain.DECIMAL, SkillTriggerEventCapabilities.valueDomain(key));
        }

        Map<SkillTriggerEventType, Set<SkillTriggerEventValueKey>> allowed = Map.of(
            SkillTriggerEventType.DAMAGE_PENDING, EnumSet.of(
                SkillTriggerEventValueKey.RAW_DAMAGE, SkillTriggerEventValueKey.POST_DEFENSE_DAMAGE,
                SkillTriggerEventValueKey.HEALTH_BEFORE, SkillTriggerEventValueKey.PROJECTED_HEALTH_AFTER
            ),
            SkillTriggerEventType.DAMAGE_DEALT, damageDealtTakenValues(),
            SkillTriggerEventType.DAMAGE_TAKEN, damageDealtTakenValues(),
            SkillTriggerEventType.HIT_LINK_APPLIED, EnumSet.of(
                SkillTriggerEventValueKey.LINK_INDEX, SkillTriggerEventValueKey.LINK_COUNT
            ),
            SkillTriggerEventType.ATTACK_LINK_APPLIED, EnumSet.of(
                SkillTriggerEventValueKey.LINK_INDEX, SkillTriggerEventValueKey.LINK_COUNT
            ),
            SkillTriggerEventType.SPELL_SHIELD_BLOCKED, EnumSet.noneOf(SkillTriggerEventValueKey.class),
            SkillTriggerEventType.BASIC_ATTACK_HIT, EnumSet.of(SkillTriggerEventValueKey.HIT_INDEX),
            SkillTriggerEventType.SKILL_HIT, EnumSet.of(SkillTriggerEventValueKey.HIT_INDEX)
        );
        for (SkillTriggerEventType eventType : SkillTriggerEventType.values()) {
            Set<SkillTriggerEventValueKey> expected = allowed.getOrDefault(
                eventType, EnumSet.noneOf(SkillTriggerEventValueKey.class)
            );
            for (SkillTriggerEventValueKey key : SkillTriggerEventValueKey.values()) {
                boolean legal = SkillTriggerEventCapabilities.eventValueAllowed(eventType, key, null, null);
                if (eventType == SkillTriggerEventType.PROCESS_MOMENT
                    || eventType == SkillTriggerEventType.LIFECYCLE_MOMENT
                    || eventType == SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED
                    || eventType == SkillTriggerEventType.INTERNAL_STATE_CHANGED) {
                    continue;
                }
                assertEquals(expected.contains(key), legal, () -> eventType + "/" + key);
            }
        }
        assertTrue(SkillTriggerEventCapabilities.eventValueAllowed(
            SkillTriggerEventType.PROCESS_MOMENT,
            SkillTriggerEventValueKey.STEP_EXECUTION_INDEX,
            SkillProcessMomentType.STEP_EXECUTION,
            SkillProcessStepType.IMMEDIATE
        ));
        assertTrue(SkillTriggerEventCapabilities.eventValueAllowed(
            SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED,
            SkillTriggerEventValueKey.THRESHOLD_VALUE,
            null,
            null
        ));

        stubDamageTypeLocks();
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY),
            spellShieldShape("aegis", "barrier")
        ));
        assertEventValueConditionAndBinding(
            SkillTriggerEventType.DAMAGE_DEALT,
            new SkillTriggerDamageEventDetail("physical", SkillTriggerDamageDeliveryKind.SKILL, SkillTriggerDamageOriginKind.DIRECT),
            SkillTriggerEventValueKey.SHIELD_ABSORBED,
            true
        );
        assertEventValueConditionAndBinding(
            SkillTriggerEventType.DAMAGE_TAKEN,
            new SkillTriggerDamageEventDetail("physical", SkillTriggerDamageDeliveryKind.SKILL, SkillTriggerDamageOriginKind.DIRECT),
            SkillTriggerEventValueKey.KILLED,
            true
        );
        assertEventValueConditionAndBinding(
            SkillTriggerEventType.DAMAGE_DEALT,
            new SkillTriggerDamageEventDetail("physical", SkillTriggerDamageDeliveryKind.SKILL, SkillTriggerDamageOriginKind.DIRECT),
            SkillTriggerEventValueKey.HIT_INDEX,
            false
        );
        assertEventValueConditionAndBinding(
            SkillTriggerEventType.HIT_LINK_APPLIED,
            new SkillTriggerLinkEventDetail((String) null),
            SkillTriggerEventValueKey.LINK_INDEX,
            true
        );
        assertEventValueConditionAndBinding(
            SkillTriggerEventType.ATTACK_LINK_APPLIED,
            new SkillTriggerLinkEventDetail((String) null),
            SkillTriggerEventValueKey.LINK_COUNT,
            true
        );
        assertEventValueConditionAndBinding(
            SkillTriggerEventType.HIT_LINK_APPLIED,
            new SkillTriggerLinkEventDetail((String) null),
            SkillTriggerEventValueKey.RAW_DAMAGE,
            false
        );
        assertEventValueConditionAndBinding(
            SkillTriggerEventType.SPELL_SHIELD_BLOCKED,
            new SkillTriggerSpellShieldBlockedEventDetail("aegis"),
            SkillTriggerEventValueKey.BLOCKED,
            false
        );
    }

    @Test
    void stage765TenOutputKindsHaveLegalSourcesAndRejectIllegal() {
        SkillTriggerPriorResultOutputs.Shape damage = SkillTriggerPriorResultOutputs.Shape.from(
            damageShape(EFFECT_KEY, RESULT_KEY, 1, null)
        );
        assertEquals(
            EnumSet.of(
                SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE,
                SkillTriggerPriorResultOutputKind.RAW_DAMAGE,
                SkillTriggerPriorResultOutputKind.POST_DEFENSE_DAMAGE,
                SkillTriggerPriorResultOutputKind.SHIELD_ABSORBED,
                SkillTriggerPriorResultOutputKind.ACTUAL_HP_LOSS,
                SkillTriggerPriorResultOutputKind.ACTUAL_HEALING,
                SkillTriggerPriorResultOutputKind.IMMUNE,
                SkillTriggerPriorResultOutputKind.KILLED
            ),
            SkillTriggerPriorResultOutputs.available(damage)
        );
        assertFalse(SkillTriggerPriorResultOutputs.available(damage, SkillTriggerPriorResultOutputKind.BLOCKED));
        assertFalse(SkillTriggerPriorResultOutputs.available(damage, SkillTriggerPriorResultOutputKind.STATUS_APPLIED));

        SkillTriggerPriorResultOutputs.Shape damageNoVamp = SkillTriggerPriorResultOutputs.Shape.from(
            SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY)
        );
        assertFalse(SkillTriggerPriorResultOutputs.available(
            damageNoVamp, SkillTriggerPriorResultOutputKind.ACTUAL_HEALING
        ));

        SkillTriggerPriorResultOutputs.Shape blockedDamage = SkillTriggerPriorResultOutputs.Shape.from(
            damageShape(EFFECT_KEY, RESULT_KEY, 0, SkillEffectSpellShieldBlockScope.RESULT)
        );
        assertTrue(SkillTriggerPriorResultOutputs.available(blockedDamage, SkillTriggerPriorResultOutputKind.BLOCKED));

        SkillTriggerPriorResultOutputs.Shape heal = SkillTriggerPriorResultOutputs.Shape.from(
            SkillTriggerRuleTestSupport.healShape(EFFECT_KEY, "heal")
        );
        assertEquals(
            EnumSet.of(
                SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE,
                SkillTriggerPriorResultOutputKind.ACTUAL_HEALING
            ),
            SkillTriggerPriorResultOutputs.available(heal)
        );

        SkillTriggerPriorResultOutputs.Shape execute = SkillTriggerPriorResultOutputs.Shape.from(
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "execute", SkillEffectResultType.EXECUTE, SkillEffectTarget.TARGET,
                true, "execute_f", "hp", null, null, null, null, null, null,
                false, null, null, null, null, null
            )
        );
        assertEquals(
            EnumSet.of(SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE, SkillTriggerPriorResultOutputKind.KILLED),
            SkillTriggerPriorResultOutputs.available(execute)
        );

        SkillTriggerPriorResultOutputs.Shape apply = SkillTriggerPriorResultOutputs.Shape.from(
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "mark", SkillEffectResultType.STATUS_OPERATION, SkillEffectTarget.TARGET,
                false, null, null, null, "poison", SkillEffectStatusOperation.APPLY, null, null, null,
                false, null, null, null, null, null
            )
        );
        assertEquals(EnumSet.of(SkillTriggerPriorResultOutputKind.STATUS_APPLIED), SkillTriggerPriorResultOutputs.available(apply));
        SkillTriggerPriorResultOutputs.Shape remove = SkillTriggerPriorResultOutputs.Shape.from(
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "mark", SkillEffectResultType.STATUS_OPERATION, SkillEffectTarget.TARGET,
                false, null, null, null, "poison", SkillEffectStatusOperation.REMOVE, null, null, null,
                false, null, null, null, null, null
            )
        );
        assertFalse(SkillTriggerPriorResultOutputs.available(remove, SkillTriggerPriorResultOutputKind.STATUS_APPLIED));

        SkillTriggerPriorResultOutputs.Shape reduce = SkillTriggerPriorResultOutputs.Shape.from(
            cooldownShape(true, "cd_f", SkillEffectCooldownChangeOperation.REDUCE)
        );
        assertEquals(EnumSet.of(SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE), SkillTriggerPriorResultOutputs.available(reduce));
        SkillTriggerPriorResultOutputs.Shape increase = SkillTriggerPriorResultOutputs.Shape.from(
            cooldownShape(true, "cd_f", SkillEffectCooldownChangeOperation.INCREASE)
        );
        assertTrue(SkillTriggerPriorResultOutputs.available(increase, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE));
        SkillTriggerPriorResultOutputs.Shape reset = SkillTriggerPriorResultOutputs.Shape.from(
            cooldownShape(false, null, SkillEffectCooldownChangeOperation.RESET)
        );
        assertTrue(SkillTriggerPriorResultOutputs.available(reset).isEmpty());

        SkillTriggerPriorResultOutputs.Shape persistentModifier = SkillTriggerPriorResultOutputs.Shape.from(
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "mod", SkillEffectResultType.DAMAGE_MODIFIER, SkillEffectTarget.SOURCE,
                true, "mod_f", null, null, null, null, SkillEffectLifecycleMoment.PERSISTENT, null, null,
                true, "duration_f", null, null, null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            )
        );
        assertFalse(SkillTriggerPriorResultOutputs.immediatelyAvailable(persistentModifier));
        assertFalse(SkillTriggerPriorResultOutputs.available(persistentModifier).contains(
            SkillTriggerPriorResultOutputKind.RAW_DAMAGE
        ));
        SkillTriggerPriorResultOutputs.Shape haste = SkillTriggerPriorResultOutputs.Shape.from(
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "haste", SkillEffectResultType.SKILL_HASTE_MODIFIER, SkillEffectTarget.SOURCE,
                true, "haste_f", null, null, null, null, SkillEffectLifecycleMoment.PERSISTENT, null, null,
                true, "duration_f", null, null, null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            )
        );
        assertFalse(SkillTriggerPriorResultOutputs.immediatelyAvailable(haste));
        assertFalse(SkillTriggerPriorResultOutputs.available(haste).contains(
            SkillTriggerPriorResultOutputKind.RAW_DAMAGE
        ));

        stubPriorFollow(damageShape(EFFECT_KEY, RESULT_KEY, 1, null), SkillParameterValueType.DECIMAL);
        stubPriorSuccessAssemble("ok_raw", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, priorRule(
            "ok_raw", SkillTriggerPriorResultOutputKind.RAW_DAMAGE, 10, 20
        ));
        verify(mapper).insertPriorResultBinding(any());

        ApiException illegalStatus = thrown(() -> service.create(
            GAME_ID, SKILL_KEY, priorRule("bad_status", SkillTriggerPriorResultOutputKind.STATUS_APPLIED, 10, 20)
        ));
        assertEquals("400.INVALID_RUNTIME_INPUT_BINDING", illegalStatus.getCode());
        assertField(illegalStatus, "actions[1].runtimeInputBindings[0].detail.outputKind", "OUTPUT_KIND_NOT_AVAILABLE");
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY),
            SkillTriggerRuleTestSupport.damageShape("follow_up", RESULT_KEY, "follow_damage")
        ));
        ApiException noVamp = thrown(() -> service.create(
            GAME_ID, SKILL_KEY, priorRule("no_vamp", SkillTriggerPriorResultOutputKind.ACTUAL_HEALING, 10, 20)
        ));
        assertField(noVamp, "actions[1].runtimeInputBindings[0].detail.outputKind", "OUTPUT_KIND_NOT_AVAILABLE");
    }

    @Test
    void stage765PriorResultRequiresEarlierImmediateSameRuleExecute() {
        stubPriorFollow(SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY), SkillParameterValueType.DECIMAL);
        ApiException later = thrown(() -> service.create(
            GAME_ID, SKILL_KEY, priorRule("later", SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE, 20, 10)
        ));
        assertEquals("400.INVALID_RUNTIME_INPUT_BINDING", later.getCode());
        assertField(later, "actions[0].runtimeInputBindings[0].detail.sourceActionKey", "RESULT_NOT_IMMEDIATELY_AVAILABLE");

        SkillTriggerAction self = new SkillTriggerAction(
            "follow", "后续", SkillTriggerActionType.EXECUTE_EFFECT, 10, SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail("follow_up"),
            List.of(new SkillTriggerRuntimeInputBinding(
                "from_first", "ratio", SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
                new SkillTriggerPriorResultBindingDetail("follow", RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE)
            )),
            List.of()
        );
        ApiException sameAction = thrown(() -> service.create(
            GAME_ID, SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "same", "same", null, 10,
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(), List.of(self), null, null
            )
        ));
        assertField(sameAction, "actions[0].runtimeInputBindings[0].detail.sourceActionKey", "RESULT_NOT_IMMEDIATELY_AVAILABLE");

        ApiException missingAction = thrown(() -> service.create(
            GAME_ID, SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "cross", "cross", null, 10,
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(),
                List.of(new SkillTriggerAction(
                    "follow", "后续", SkillTriggerActionType.EXECUTE_EFFECT, 20, SkillTriggerTargetContext.CURRENT_TARGET,
                    new SkillTriggerExecuteEffectActionDetail("follow_up"),
                    List.of(new SkillTriggerRuntimeInputBinding(
                        "from_first", "ratio", SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
                        new SkillTriggerPriorResultBindingDetail("other_rule_action", RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE)
                    )),
                    List.of()
                )),
                null, null
            )
        ));
        assertField(missingAction, "actions[0].runtimeInputBindings[0].detail.sourceActionKey", "RESULT_NOT_IMMEDIATELY_AVAILABLE");

        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.damageShape("other", RESULT_KEY),
            SkillTriggerRuleTestSupport.damageShape("follow_up", RESULT_KEY, "follow_damage")
        ));
        ApiException ownership = thrown(() -> service.create(
            GAME_ID, SKILL_KEY, priorRule("own", SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE, 10, 20)
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", ownership.getCode());
        assertField(ownership, "actions[1].runtimeInputBindings[0].detail.sourceResultKey", "UNKNOWN_RESULT");
    }

    @Test
    void stage765LifecycleMomentsGateImmediateOutputs() {
        SkillTriggerEffectShapeRow application = new SkillTriggerEffectShapeRow(
            EFFECT_KEY, RESULT_KEY, SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET,
            true, "base_damage", null, null, null, null, SkillEffectLifecycleMoment.APPLICATION, null, null,
            true, "duration_f", null, null, null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
        );
        assertTrue(SkillTriggerPriorResultOutputs.immediatelyAvailable(SkillTriggerPriorResultOutputs.Shape.from(application)));
        stubPriorFollow(application, SkillParameterValueType.DECIMAL);
        stubPriorSuccessAssemble("app", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, priorRule(
            "app", SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE, 10, 20
        ));

        for (SkillEffectLifecycleMoment moment : List.of(
            SkillEffectLifecycleMoment.PERSISTENT,
            SkillEffectLifecycleMoment.FULL_STACKS,
            SkillEffectLifecycleMoment.PERIODIC,
            SkillEffectLifecycleMoment.NATURAL_END,
            SkillEffectLifecycleMoment.EARLY_REMOVE
        )) {
            SkillTriggerEffectShapeRow delayed = new SkillTriggerEffectShapeRow(
                EFFECT_KEY, RESULT_KEY, SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET,
                true, "base_damage", null, null, null, null, moment, null, null,
                true, "duration_f", null, null, null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            );
            stubPriorFollow(delayed, SkillParameterValueType.DECIMAL);
            ApiException notImmediate = thrown(() -> service.create(
                GAME_ID, SKILL_KEY, priorRule("late_" + moment.name().toLowerCase(), SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE, 10, 20)
            ));
            assertEquals("400.INVALID_RUNTIME_INPUT_BINDING", notImmediate.getCode());
            assertField(notImmediate, "actions[1].runtimeInputBindings[0].detail.sourceResultKey", "SOURCE_RESULT_NOT_IMMEDIATE");
        }
    }

    @Test
    void stage765IntegerFeedsIntegerOrDecimalDecimalFeedsDecimalOnly() {
        stubPriorFollow(
            damageShape(EFFECT_KEY, RESULT_KEY, 0, SkillEffectSpellShieldBlockScope.RESULT),
            SkillParameterValueType.INTEGER
        );
        stubPriorSuccessAssemble("int_int", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, priorRule("int_int", SkillTriggerPriorResultOutputKind.BLOCKED, 10, 20));

        stubPriorFollow(
            damageShape(EFFECT_KEY, RESULT_KEY, 0, SkillEffectSpellShieldBlockScope.RESULT),
            SkillParameterValueType.DECIMAL
        );
        stubPriorSuccessAssemble("int_dec", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, priorRule("int_dec", SkillTriggerPriorResultOutputKind.IMMUNE, 10, 20));

        stubPriorFollow(SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY), SkillParameterValueType.DECIMAL);
        stubPriorSuccessAssemble("dec_dec", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, priorRule("dec_dec", SkillTriggerPriorResultOutputKind.RAW_DAMAGE, 10, 20));

        stubPriorFollow(SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY), SkillParameterValueType.INTEGER);
        ApiException decToInt = thrown(() -> service.create(
            GAME_ID, SKILL_KEY, priorRule("dec_int", SkillTriggerPriorResultOutputKind.RAW_DAMAGE, 10, 20)
        ));
        assertEquals("400.INVALID_RUNTIME_INPUT_BINDING", decToInt.getCode());
        assertField(decToInt, "actions[1].runtimeInputBindings[0].parameterKey", "REFERENCE_TYPE_MISMATCH");
    }

    @Test
    void stage765CooldownChangeHasSingleConfiguredValueExceptReset() {
        SkillTriggerEffectShapeRow reduce = cooldownShape(true, "cd_f", SkillEffectCooldownChangeOperation.REDUCE);
        SkillTriggerEffectShapeRow reset = cooldownShape(false, null, SkillEffectCooldownChangeOperation.RESET);
        assertEquals(1, List.of(reduce).size());
        stubPriorFollow(reduce, SkillParameterValueType.DECIMAL);
        stubPriorSuccessAssemble("cd_ok", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, priorRule("cd_ok", SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE, 10, 20));
        stubPriorFollow(reset, SkillParameterValueType.DECIMAL);
        ApiException resetValue = thrown(() -> service.create(
            GAME_ID, SKILL_KEY, priorRule("cd_reset", SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE, 10, 20)
        ));
        assertField(resetValue, "actions[1].runtimeInputBindings[0].detail.outputKind", "OUTPUT_KIND_NOT_AVAILABLE");
    }

    @Test
    void stage765ReachableFormulasAndProducedGraphCoverStage76() {
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            damageShape(EFFECT_KEY, RESULT_KEY, 1, null),
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "mod", SkillEffectResultType.DAMAGE_MODIFIER, SkillEffectTarget.SOURCE,
                true, "mod_f", null, null, null, null, SkillEffectLifecycleMoment.PERSISTENT, null, null,
                true, "duration_f", null, null, null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            ),
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "heal_mod", SkillEffectResultType.HEALING_MODIFIER, SkillEffectTarget.SOURCE,
                true, "heal_mod_f", null, null, null, null, SkillEffectLifecycleMoment.PERSISTENT, null, null,
                true, null, null, null, null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            ),
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "floor", SkillEffectResultType.HEALTH_FLOOR, SkillEffectTarget.SOURCE,
                true, "floor_f", "hp", null, null, null, SkillEffectLifecycleMoment.PERSISTENT, null, null,
                true, null, null, null, null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            ),
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "execute", SkillEffectResultType.EXECUTE, SkillEffectTarget.TARGET,
                true, "execute_f", "hp", null, null, null, null, null, null,
                false, null, null, null, null, null
            ),
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "hit_link", SkillEffectResultType.HIT_LINK_APPLICATION, SkillEffectTarget.TARGET,
                true, "hit_f", null, null, null, null, null, null, null,
                false, null, null, null, null, null
            ),
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "attack_link", SkillEffectResultType.ATTACK_LINK_APPLICATION, SkillEffectTarget.TARGET,
                true, "attack_f", null, null, null, null, null, null, null,
                false, null, null, null, null, null
            )
        ));
        when(mapper.listEffectInteractionFormulaKeys(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of(
            "crit_f", "vamp_f"
        ));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Collection<String> keys = (Collection<String>) invocation.getArgument(2);
            if (keys != null && keys.contains("execute_f") && keys.contains("mod_f")) {
                assertTrue(keys.contains("base_damage"));
                assertTrue(keys.contains("mod_f"));
                assertTrue(keys.contains("heal_mod_f"));
                assertTrue(keys.contains("floor_f"));
                assertTrue(keys.contains("execute_f"));
                assertTrue(keys.contains("hit_f"));
                assertTrue(keys.contains("attack_f"));
                assertTrue(keys.contains("crit_f"));
                assertTrue(keys.contains("vamp_f"));
                assertTrue(keys.contains("duration_f"));
            }
            return List.of();
        });
        stubAssembleExecuteEffect(mapper, "collect_all", "collect_all", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        service.create(
            GAME_ID, SKILL_KEY,
            emptyEventExecute("collect_all", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY)
        );
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of());

        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.ruleRow("shield_break", "shield_break", SkillTriggerEventType.LIFECYCLE_MOMENT)
        ));
        when(mapper.listLifecycleEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventRow(
                GAME_ID, SKILL_KEY, "shield_break", EFFECT_KEY, SkillTriggerLifecycleEventMoment.EARLY_REMOVE
            )
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("shield_break", "apply")
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("shield_break", "apply", EFFECT_KEY)
        ));
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, RESULT_KEY, SkillEffectResultType.NORMAL_SHIELD, SkillEffectTarget.TARGET,
                true, "shield_f", null, null, null, null, SkillEffectLifecycleMoment.PERSISTENT, null, null,
                true, "duration_f", null, null, null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            )
        ));
        stubAssembleExecuteEffect(
            mapper, "shield_break", "shield_break", SkillTriggerEventType.LIFECYCLE_MOMENT, "apply", EFFECT_KEY
        );
        when(mapper.findLifecycleEvent(GAME_ID, SKILL_KEY, "shield_break")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventRow(
                GAME_ID, SKILL_KEY, "shield_break", EFFECT_KEY, SkillTriggerLifecycleEventMoment.EARLY_REMOVE
            )
        );
        ApiException shieldCycle = thrown(() -> service.create(
            GAME_ID, SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "shield_break", "shield_break", null, 10,
                new SkillTriggerEventSource(
                    SkillTriggerEventType.LIFECYCLE_MOMENT,
                    new SkillTriggerLifecycleEventDetail(EFFECT_KEY, SkillTriggerLifecycleEventMoment.EARLY_REMOVE)
                ),
                List.of(),
                List.of(executeAction("apply", EFFECT_KEY)),
                null, null
            )
        ));
        assertEquals("400.TRIGGER_RULE_CYCLE_UNGUARDED", shieldCycle.getCode());
    }

    @Test
    void stage765InboundProtectsEnrichedOutputsWithStableDetails() {
        when(mapper.listResultReferences(GAME_ID, SKILL_KEY, EFFECT_KEY, List.of(RESULT_KEY))).thenReturn(List.of(
            new SkillTriggerReferenceHit("prior", "results", RESULT_KEY, "in use")
        ));
        ApiException removed = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, null, null, List.of(damageResult(List.of(), null)), List.of(RESULT_KEY)
        ));
        assertEquals("409.SKILL_EFFECT_IN_USE", removed.getCode());
        assertField(removed, "results", "TRIGGER_RULE_RESULT_IN_USE");

        when(mapper.listResultReferences(any(), any(), any(), any())).thenReturn(List.of());
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.ruleRow("prior", "prior", SkillTriggerEventType.BASIC_ATTACK_HIT)
        ));
        when(mapper.listPriorResultBindings(GAME_ID, SKILL_KEY, "prior")).thenReturn(List.of(
            new SkillTriggerPriorResultBindingRow(
                GAME_ID, SKILL_KEY, "prior", "follow", "from_first",
                "deal_first", EFFECT_KEY, RESULT_KEY, SkillTriggerPriorResultOutputKind.ACTUAL_HEALING
            )
        ));
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            damageShape(EFFECT_KEY, RESULT_KEY, 1, null)
        ));
        when(mapper.listEffectInteractionFormulaKeys(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(List.of());
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        ApiException lastVamp = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, null, null, List.of(damageResult(List.of(), null)), List.of()
        ));
        assertEquals("409.SKILL_EFFECT_IN_USE", lastVamp.getCode());
        assertField(lastVamp, "results[0].detail.vampRules", "TRIGGER_RULE_SHAPE_IN_USE");
        assertEquals("ACTUAL_HEALING", SkillTriggerRuleTestSupport.fieldIssues(lastVamp).get(0).get("outputKind"));
        assertEquals("prior", SkillTriggerRuleTestSupport.fieldIssues(lastVamp).get(0).get("ruleKey"));
        assertEquals("follow", SkillTriggerRuleTestSupport.fieldIssues(lastVamp).get(0).get("actionKey"));
        assertEquals("from_first", SkillTriggerRuleTestSupport.fieldIssues(lastVamp).get(0).get("bindingKey"));

        when(mapper.listPriorResultBindings(GAME_ID, SKILL_KEY, "prior")).thenReturn(List.of(
            new SkillTriggerPriorResultBindingRow(
                GAME_ID, SKILL_KEY, "prior", "follow", "from_first",
                "deal_first", EFFECT_KEY, RESULT_KEY, SkillTriggerPriorResultOutputKind.BLOCKED
            )
        ));
        ApiException clearedBlock = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, null, null,
            List.of(damageResult(List.of(), null)), List.of()
        ));
        assertField(clearedBlock, "results[0].spellShieldBlockScope", "TRIGGER_RULE_SHAPE_IN_USE");
        assertEquals("BLOCKED", SkillTriggerRuleTestSupport.fieldIssues(clearedBlock).get(0).get("outputKind"));

        when(mapper.listPriorResultBindings(GAME_ID, SKILL_KEY, "prior")).thenReturn(List.of(
            new SkillTriggerPriorResultBindingRow(
                GAME_ID, SKILL_KEY, "prior", "follow", "from_first",
                "deal_first", EFFECT_KEY, RESULT_KEY, SkillTriggerPriorResultOutputKind.STATUS_APPLIED
            )
        ));
        ApiException applyToRemove = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, null, null, List.of(statusResult(SkillEffectStatusOperation.REMOVE)), List.of()
        ));
        assertField(applyToRemove, "results[0].detail.operation", "TRIGGER_RULE_SHAPE_IN_USE");
        assertEquals("STATUS_APPLIED", SkillTriggerRuleTestSupport.fieldIssues(applyToRemove).get(0).get("outputKind"));

        when(mapper.listPriorResultBindings(GAME_ID, SKILL_KEY, "prior")).thenReturn(List.of(
            new SkillTriggerPriorResultBindingRow(
                GAME_ID, SKILL_KEY, "prior", "follow", "from_first",
                "deal_first", EFFECT_KEY, RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE
            )
        ));
        ApiException lostImmediate = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, null, lifecycleRequest(),
            List.of(damageResultWithMoment(SkillEffectLifecycleMoment.PERIODIC)), List.of()
        ));
        assertField(lostImmediate, "results[0].lifecycleBehavior.moment", "TRIGGER_RULE_SHAPE_IN_USE");

        when(mapper.listPriorResultBindings(GAME_ID, SKILL_KEY, "prior")).thenReturn(List.of());
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("prior", "deal")
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("prior", "deal", EFFECT_KEY)
        ));
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY)
        ));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Collection<String> keys = (Collection<String>) invocation.getArgument(2);
            if (keys != null && keys.contains("other_damage")) {
                return List.of(SkillTriggerRuleTestSupport.runtimeParam("other", SkillParameterValueType.DECIMAL));
            }
            if (keys != null && keys.contains("base_damage")) {
                return List.of(SkillTriggerRuleTestSupport.runtimeParam("ratio", SkillParameterValueType.DECIMAL));
            }
            return List.of();
        });
        ApiException formula = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, null, null,
            List.of(new SkillEffectResultRequest(
                RESULT_KEY, "伤害", SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET, null, 0,
                new SkillEffectValueRuleRequest("other_damage", BigDecimal.ONE, null, null),
                new SkillEffectDamageDetail("physical")
            )),
            List.of()
        ));
        assertEquals("409.SKILL_EFFECT_IN_USE", formula.getCode());
        assertField(formula, "results[0].valueRule.formulaKey", "TRIGGER_RULE_RUNTIME_INPUT_IN_USE");

        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        when(mapper.listPriorResultBindings(GAME_ID, SKILL_KEY, "prior")).thenReturn(List.of());
        service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, null, null,
            List.of(damageResult(List.of(), null)), List.of()
        );
        service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, null, null,
            List.of(new SkillEffectResultRequest(
                RESULT_KEY, "冷却", SkillEffectResultType.COOLDOWN_CHANGE, SkillEffectTarget.SOURCE, null, 0,
                new SkillEffectValueRuleRequest("cd_f", BigDecimal.ONE, null, null),
                new SkillEffectCooldownChangeDetail(
                    new SkillEffectAffectedSkillScope(
                        SkillEffectSkillScopeMode.SKILLS,
                        List.of("other_skill"),
                        List.of()
                    ),
                    SkillEffectCooldownChangeOperation.REDUCE
                )
            )),
            List.of()
        );
    }

    private static EnumSet<SkillTriggerEventValueKey> damageDealtTakenValues() {
        return EnumSet.of(
            SkillTriggerEventValueKey.RAW_DAMAGE,
            SkillTriggerEventValueKey.POST_DEFENSE_DAMAGE,
            SkillTriggerEventValueKey.SHIELD_ABSORBED,
            SkillTriggerEventValueKey.ACTUAL_HP_LOSS,
            SkillTriggerEventValueKey.BLOCKED,
            SkillTriggerEventValueKey.IMMUNE,
            SkillTriggerEventValueKey.KILLED
        );
    }

    private void assertEventValueConditionAndBinding(
        SkillTriggerEventType eventType,
        xyz.game.datamanage.model.skilltrigger.SkillTriggerEventDetail detail,
        SkillTriggerEventValueKey valueKey,
        boolean allowed
    ) {
        String ruleKey = ("ev_" + eventType.name() + "_" + valueKey.name()).toLowerCase();
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of());
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of());
        SkillTriggerConditionGroup group = new SkillTriggerConditionGroup(
            "g", "g", 0,
            List.of(new SkillTriggerCondition(
                "c", SkillTriggerConditionType.EVENT_VALUE_COMPARE, 0,
                new SkillTriggerEventValueConditionDetail(valueKey, SkillTriggerComparator.GTE, FORMULA_KEY)
            ))
        );
        SkillTriggerRuleCreateRequest conditionRequest = new SkillTriggerRuleCreateRequest(
            ruleKey, ruleKey, null, 10,
            new SkillTriggerEventSource(eventType, detail),
            List.of(group),
            List.of(executeAction("deal", EFFECT_KEY)),
            null, null
        );
        if (allowed) {
            stubAssembleExecuteEffect(mapper, ruleKey, ruleKey, eventType, "deal", EFFECT_KEY);
            stubEventLookup(eventType, ruleKey, detail);
            service.create(GAME_ID, SKILL_KEY, conditionRequest);
        } else {
            ApiException condition = thrown(() -> service.create(GAME_ID, SKILL_KEY, conditionRequest));
            assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", condition.getCode());
            assertField(condition, "conditionGroups[0].conditions[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");
        }

        String bindKey = "bd_" + ruleKey;
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.runtimeParam(
                "ratio",
                SkillTriggerEventCapabilities.valueDomain(valueKey) == SkillTriggerValueDomain.INTEGER
                    ? SkillParameterValueType.INTEGER
                    : SkillParameterValueType.DECIMAL
            )
        ));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.runtimeParam(
                "ratio",
                SkillTriggerEventCapabilities.valueDomain(valueKey) == SkillTriggerValueDomain.INTEGER
                    ? SkillParameterValueType.INTEGER
                    : SkillParameterValueType.DECIMAL
            )
        ));
        SkillTriggerAction boundAction = new SkillTriggerAction(
            "deal", "执行效果", SkillTriggerActionType.EXECUTE_EFFECT, 10, SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY),
            List.of(new SkillTriggerRuntimeInputBinding(
                "from_event", "ratio", SkillTriggerRuntimeInputSourceType.EVENT_VALUE,
                new SkillTriggerEventValueBindingDetail(valueKey)
            )),
            List.of()
        );
        SkillTriggerRuleCreateRequest bindingRequest = new SkillTriggerRuleCreateRequest(
            bindKey, bindKey, null, 10,
            new SkillTriggerEventSource(eventType, detail),
            List.of(), List.of(boundAction), null, null
        );
        if (allowed) {
            stubAssembleExecuteEffect(mapper, bindKey, bindKey, eventType, "deal", EFFECT_KEY);
            stubEventLookup(eventType, bindKey, detail);
            when(mapper.listBindings(GAME_ID, SKILL_KEY, bindKey)).thenReturn(List.of(
                new xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBindingRow(
                    GAME_ID, SKILL_KEY, bindKey, "deal", "from_event", "ratio",
                    SkillTriggerRuntimeInputSourceType.EVENT_VALUE
                )
            ));
            when(mapper.listEventValueBindings(GAME_ID, SKILL_KEY, bindKey)).thenReturn(List.of(
                new xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingRow(
                    GAME_ID, SKILL_KEY, bindKey, "deal", "from_event", valueKey
                )
            ));
            service.create(GAME_ID, SKILL_KEY, bindingRequest);
        } else {
            ApiException binding = thrown(() -> service.create(GAME_ID, SKILL_KEY, bindingRequest));
            assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", binding.getCode());
            assertField(binding, "actions[0].runtimeInputBindings[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");
        }
    }

    private void stubEventLookup(
        SkillTriggerEventType eventType,
        String ruleKey,
        xyz.game.datamanage.model.skilltrigger.SkillTriggerEventDetail detail
    ) {
        if (detail instanceof SkillTriggerDamageEventDetail damage) {
            when(mapper.findDamageEvent(GAME_ID, SKILL_KEY, ruleKey)).thenReturn(
                new SkillTriggerDamageEventRow(
                    GAME_ID, SKILL_KEY, ruleKey, damage.damageTypeKey(), damage.deliveryKind(), damage.originKind()
                )
            );
        } else if (detail instanceof SkillTriggerLinkEventDetail link) {
            when(mapper.findLinkEvent(GAME_ID, SKILL_KEY, ruleKey)).thenReturn(
                new xyz.game.datamanage.model.skilltrigger.SkillTriggerLinkEventRow(
                    GAME_ID, SKILL_KEY, ruleKey, link.sourceSkillKey()
                )
            );
        } else if (detail instanceof SkillTriggerSpellShieldBlockedEventDetail shield) {
            when(mapper.findSpellShieldBlockedEvent(GAME_ID, SKILL_KEY, ruleKey)).thenReturn(
                new xyz.game.datamanage.model.skilltrigger.SkillTriggerSpellShieldBlockedEventRow(
                    GAME_ID, SKILL_KEY, ruleKey, shield.shieldEffectKey()
                )
            );
        }
    }

    private void stubDamageTypeLocks() {
        when(mapper.lockDamageTypes(eq(GAME_ID), any())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(1);
            return keys.stream()
                .map(key -> new xyz.game.datamanage.model.skilltrigger.SkillTriggerCatalogLockRow(key, "ENABLED", null))
                .toList();
        });
    }

    private void stubPriorFollow(SkillTriggerEffectShapeRow source, SkillParameterValueType type) {
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            source,
            SkillTriggerRuleTestSupport.damageShape("follow_up", RESULT_KEY, "follow_damage")
        ));
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.runtimeParam("ratio", type)
        ));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(2);
            if (keys != null && keys.contains("follow_damage")) {
                return List.of(SkillTriggerRuleTestSupport.runtimeParam("ratio", type));
            }
            return List.of();
        });
    }

    private void stubPriorSuccessAssemble(String ruleKey, String sourceEffectKey) {
        stubAssembleExecuteEffect(mapper, ruleKey, ruleKey, SkillTriggerEventType.BASIC_ATTACK_HIT, "deal_first", sourceEffectKey);
        when(mapper.listActions(GAME_ID, SKILL_KEY, ruleKey)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow(ruleKey, "deal_first"),
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, ruleKey, "follow", "后续",
                SkillTriggerActionType.EXECUTE_EFFECT, 20, SkillTriggerTargetContext.CURRENT_TARGET
            )
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, ruleKey)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow(ruleKey, "deal_first", sourceEffectKey),
            SkillTriggerRuleTestSupport.effectActionRow(ruleKey, "follow", "follow_up")
        ));
    }

    private static SkillTriggerRuleCreateRequest priorRule(
        String ruleKey,
        SkillTriggerPriorResultOutputKind outputKind,
        int firstOrder,
        int secondOrder
    ) {
        SkillTriggerAction first = new SkillTriggerAction(
            "deal_first", "执行效果", SkillTriggerActionType.EXECUTE_EFFECT, firstOrder,
            SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY),
            List.of(), List.of()
        );
        SkillTriggerAction second = new SkillTriggerAction(
            "follow", "后续", SkillTriggerActionType.EXECUTE_EFFECT, secondOrder,
            SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerExecuteEffectActionDetail("follow_up"),
            List.of(priorBinding(outputKind)),
            List.of()
        );
        List<SkillTriggerAction> actions = firstOrder <= secondOrder ? List.of(first, second) : List.of(second, first);
        return new SkillTriggerRuleCreateRequest(
            ruleKey, ruleKey, null, 10,
            new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
            List.of(), actions, null, null
        );
    }

    private static SkillTriggerRuntimeInputBinding priorBinding(SkillTriggerPriorResultOutputKind outputKind) {
        return new SkillTriggerRuntimeInputBinding(
            "from_first", "ratio", SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
            new SkillTriggerPriorResultBindingDetail("deal_first", RESULT_KEY, outputKind)
        );
    }

    private static SkillTriggerEffectShapeRow damageShape(
        String effectKey,
        String resultKey,
        int vampCount,
        SkillEffectSpellShieldBlockScope blockScope
    ) {
        return new SkillTriggerEffectShapeRow(
            effectKey, resultKey, SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET,
            true, "base_damage", null, null, null, null, null, null, null,
            false, null, null, null, null, null,
            null, SkillEffectDamageDeliveryKind.SKILL, SkillEffectDamageOriginKind.DIRECT,
            blockScope, vampCount, null
        );
    }

    private static SkillTriggerEffectShapeRow cooldownShape(
        boolean hasValue,
        String formulaKey,
        SkillEffectCooldownChangeOperation operation
    ) {
        return new SkillTriggerEffectShapeRow(
            EFFECT_KEY, RESULT_KEY, SkillEffectResultType.COOLDOWN_CHANGE, SkillEffectTarget.SOURCE,
            hasValue, formulaKey, null, null, null, null, null, null, null,
            false, null, null, null, null, null,
            null, null, null, null, 0, operation
        );
    }

    private static SkillTriggerEffectShapeRow spellShieldShape(String effectKey, String resultKey) {
        return new SkillTriggerEffectShapeRow(
            effectKey, resultKey, SkillEffectResultType.SPELL_SHIELD, SkillEffectTarget.SOURCE,
            true, "shield_f", null, null, null, null, SkillEffectLifecycleMoment.PERSISTENT, null, null,
            true, "duration_f", null, null, null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
        );
    }

    private static SkillEffectResultRequest damageResult(
        List<SkillEffectVampRule> vampRules,
        SkillEffectSpellShieldBlockScope blockScope
    ) {
        return new SkillEffectResultRequest(
            RESULT_KEY, "伤害", SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET, null, 0,
            new SkillEffectValueRuleRequest("base_damage", BigDecimal.ONE, null, null),
            new SkillEffectDamageDetail(
                "physical",
                SkillEffectDamageDeliveryKind.SKILL,
                SkillEffectDamageOriginKind.DIRECT,
                new SkillEffectCriticalPolicy(SkillEffectCriticalMode.DISALLOWED, null),
                vampRules
            ),
            null,
            blockScope
        );
    }

    private static SkillEffectResultRequest damageResultWithMoment(SkillEffectLifecycleMoment moment) {
        return new SkillEffectResultRequest(
            RESULT_KEY, "伤害", SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET, null, 0,
            new SkillEffectValueRuleRequest("base_damage", BigDecimal.ONE, null, null),
            new SkillEffectDamageDetail("physical"),
            new SkillEffectResultLifecycleBehaviorRequest(
                moment, SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT, null, null, null
            ),
            null
        );
    }

    private static SkillEffectResultRequest statusResult(SkillEffectStatusOperation operation) {
        return new SkillEffectResultRequest(
            RESULT_KEY, "状态", SkillEffectResultType.STATUS_OPERATION, SkillEffectTarget.TARGET, null, 0,
            null,
            new SkillEffectStatusOperationDetail("poison", operation)
        );
    }

    private static SkillEffectLifecycleRequest lifecycleRequest() {
        return new SkillEffectLifecycleRequest(
            "duration_f", "max_stacks_f", "app_stacks_f",
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.KEEP,
            null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE, null, null
        );
    }
}
