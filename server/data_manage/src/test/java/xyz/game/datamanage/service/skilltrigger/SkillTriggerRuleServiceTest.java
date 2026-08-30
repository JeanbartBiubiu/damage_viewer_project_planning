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
import java.util.List;
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
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAttributeConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerComparator;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCondition;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroupRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind;
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
    void capabilitiesTableCoversAllSeventeenEventsAndRejectsValueReached() {
        assertEquals(17, SkillTriggerEventType.values().length);
        assertEquals(17, xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.currentTargetBindings().size());
        assertFalse(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT));
        assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.DAMAGE_TAKEN));
        assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.STATUS_CHANGED));
        assertTrue(xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.CONTROL_RECEIVED));
        for (SkillTriggerEventType type : SkillTriggerEventType.values()) {
            if (type != SkillTriggerEventType.DAMAGE_TAKEN
                && type != SkillTriggerEventType.STATUS_CHANGED
                && type != SkillTriggerEventType.CONTROL_RECEIVED) {
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
}
