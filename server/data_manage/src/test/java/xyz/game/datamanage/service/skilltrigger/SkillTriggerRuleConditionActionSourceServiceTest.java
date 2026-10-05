package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.ATTRIBUTE_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.EFFECT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.FORMULA_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.PROCESS_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.RESULT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertField;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.emptyEventExecute;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.executeAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.failProcessAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.rule;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.startProcessAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubParentAndCatalogs;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.thrown;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAttributeConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerComparator;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCondition;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessFailureReason;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusCheckKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerRuleConditionActionSourceServiceTest {

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillTriggerRuleMapper mapper;

    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(gamesMapper, skillMapper, mapper);
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.state("flag", SkillInternalStateType.FLAG),
            SkillTriggerRuleTestSupport.state("stacks", SkillInternalStateType.COUNTER)
        ));
        service = SkillTriggerRuleTestSupport.service(gamesMapper, skillMapper, mapper);
    }

    @Test
    void fourConditionKindsHaveValidAndInvalidShapesWithExactFieldPaths() {
        SkillTriggerConditionGroup attribute = group("g", condition(
            "attr",
            SkillTriggerConditionType.ATTRIBUTE_COMPARE,
            new SkillTriggerAttributeConditionDetail(
                SkillTriggerSubject.SOURCE, ATTRIBUTE_KEY, AttributeValueKind.CURRENT_RATIO,
                SkillTriggerComparator.LTE, SkillNumericValue.formula(FORMULA_KEY)
            )
        ));
        service.create(GAME_ID, SKILL_KEY, withGroups("attr_ok", List.of(attribute)));

        ApiException eventSource = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            withGroups("attr_bad", List.of(group("g", condition(
                "attr",
                SkillTriggerConditionType.ATTRIBUTE_COMPARE,
                new SkillTriggerAttributeConditionDetail(
                    SkillTriggerSubject.EVENT_SOURCE, ATTRIBUTE_KEY, AttributeValueKind.CURRENT_RATIO,
                    SkillTriggerComparator.LTE, SkillNumericValue.formula(FORMULA_KEY)
                )
            ))))
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", eventSource.getCode());
        assertField(eventSource, "conditionGroups[0].conditions[0].detail.subject", "EVENT_SOURCE_NOT_AVAILABLE");

        SkillTriggerConditionGroup present = group("g", condition(
            "present",
            SkillTriggerConditionType.STATUS_CHECK,
            new SkillTriggerStatusConditionDetail(
                SkillTriggerSubject.CURRENT_TARGET, "poison", SkillTriggerStatusCheckKind.PRESENT,
                null, null, null, null, null
            )
        ));
        service.create(GAME_ID, SKILL_KEY, withGroups("status_ok", List.of(present)));
        assertField(
            thrown(() -> service.create(
                GAME_ID, SKILL_KEY,
                withGroups("status_bad", List.of(group("g", condition(
                    "present",
                    SkillTriggerConditionType.STATUS_CHECK,
                    new SkillTriggerStatusConditionDetail(
                        SkillTriggerSubject.CURRENT_TARGET, "poison", SkillTriggerStatusCheckKind.PRESENT,
                        null, EFFECT_KEY, RESULT_KEY, SkillTriggerComparator.GTE, SkillNumericValue.formula(FORMULA_KEY)
                    )
                ))))
            )),
            "conditionGroups[0].conditions[0].detail.sourceEffectKey",
            "FORBIDDEN"
        );

        SkillTriggerConditionGroup flag = group("g", condition(
            "enabled",
            SkillTriggerConditionType.INTERNAL_STATE_CHECK,
            new SkillTriggerInternalStateConditionDetail(
                SKILL_KEY, "flag", SkillTriggerInternalStateValueKind.ENABLED, null, true, null, null
            )
        ));
        service.create(GAME_ID, SKILL_KEY, withGroups("istate_ok", List.of(flag)));
        ApiException mismatch = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            withGroups("istate_bad", List.of(group("g", condition(
                "value",
                SkillTriggerConditionType.INTERNAL_STATE_CHECK,
                new SkillTriggerInternalStateConditionDetail(
                    SKILL_KEY, "flag", SkillTriggerInternalStateValueKind.VALUE, null, null, SkillTriggerComparator.GTE, SkillNumericValue.formula(FORMULA_KEY)
                )
            ))))
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", mismatch.getCode());
        assertField(mismatch, "conditionGroups[0].conditions[0].detail.valueKind", "REFERENCE_TYPE_MISMATCH");

        SkillTriggerConditionGroup hitIndex = group("g", condition(
            "hit",
            SkillTriggerConditionType.EVENT_VALUE_COMPARE,
            new SkillTriggerEventValueConditionDetail(
                SkillTriggerEventValueKey.HIT_INDEX, SkillTriggerComparator.GTE, SkillNumericValue.formula(FORMULA_KEY)
            )
        ));
        service.create(GAME_ID, SKILL_KEY, withGroups("value_ok", List.of(hitIndex)));
        ApiException unavailable = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            withGroupsOn(
                "value_bad",
                new SkillTriggerEventSource(SkillTriggerEventType.CONTROL_RECEIVED, new SkillTriggerEmptyEventDetail()),
                List.of(hitIndex)
            )
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", unavailable.getCode());
        assertField(unavailable, "conditionGroups[0].conditions[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");

        ApiException takedownValue = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            withGroupsOn(
                "takedown_value_bad",
                new SkillTriggerEventSource(SkillTriggerEventType.TAKEDOWN, new SkillTriggerEmptyEventDetail()),
                List.of(hitIndex)
            )
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", takedownValue.getCode());
        assertField(takedownValue, "conditionGroups[0].conditions[0].detail.eventValueKey", "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test
    void crossSkillReadChecksTargetOwnerEvenWhenLocalKeysMatch() {
        String otherSkill = "other_skill";
        SkillTriggerCondition externalFlag = condition("external_flag", SkillTriggerConditionType.INTERNAL_STATE_CHECK,
            new SkillTriggerInternalStateConditionDetail(otherSkill, "flag",
                SkillTriggerInternalStateValueKind.ENABLED, null, true, null, null));
        ApiException missingState = thrown(() -> service.create(GAME_ID, SKILL_KEY,
            withGroups("missing_external_state", List.of(group("g", externalFlag)))));
        assertField(missingState, "conditionGroups[0].conditions[0].detail.stateKey", "UNKNOWN_INTERNAL_STATE");
        when(mapper.lockInternalStates(eq(GAME_ID), eq(otherSkill), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.state("flag", SkillInternalStateType.FLAG)));
        service.create(GAME_ID, SKILL_KEY,
            withGroups("external_state", List.of(group("g", externalFlag))));

        SkillTriggerCondition externalStatus = condition("external_status", SkillTriggerConditionType.STATUS_CHECK,
            new SkillTriggerStatusConditionDetail(SkillTriggerSubject.CURRENT_TARGET, "poison",
                SkillTriggerStatusCheckKind.STACKS_COMPARE, otherSkill, EFFECT_KEY, RESULT_KEY,
                SkillTriggerComparator.GTE, SkillNumericValue.fixed(java.math.BigDecimal.ONE)));
        ApiException missingEffect = thrown(() -> service.create(GAME_ID, SKILL_KEY,
            withGroups("missing_external_effect", List.of(group("g", externalStatus)))));
        assertField(missingEffect, "conditionGroups[0].conditions[0].detail.sourceEffectKey", "UNKNOWN_EFFECT");
        when(mapper.lockEffects(eq(GAME_ID), eq(otherSkill), any())).thenReturn(List.of(EFFECT_KEY));
        when(mapper.countStatusApplyPersistent(GAME_ID, otherSkill, EFFECT_KEY, RESULT_KEY, "poison"))
            .thenReturn(1L);
        service.create(GAME_ID, SKILL_KEY,
            withGroups("external_effect", List.of(group("g", externalStatus))));
    }

    @Test
    void threeActionsAndEventSourceTargetHaveValidAndInvalidShapes() {
        service.create(GAME_ID, SKILL_KEY, emptyEventExecute("exec", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY));

        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "start",
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(startProcessAction("start", PROCESS_KEY))
            )
        );

        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "fail",
                new SkillTriggerEventSource(SkillTriggerEventType.CONTROL_RECEIVED, new SkillTriggerEmptyEventDetail()),
                List.of(failProcessAction("fail", PROCESS_KEY, SkillTriggerProcessFailureReason.CONTROLLED))
            )
        );

        assertField(
            thrown(() -> service.create(
                GAME_ID, SKILL_KEY,
                rule(
                    "fail_ctx",
                    new SkillTriggerEventSource(SkillTriggerEventType.CONTROL_RECEIVED, new SkillTriggerEmptyEventDetail()),
                    List.of(new SkillTriggerAction(
                        "fail", "失败", SkillTriggerActionType.FAIL_PROCESS, 20,
                        SkillTriggerTargetContext.CURRENT_TARGET,
                        new xyz.game.datamanage.model.skilltrigger.SkillTriggerFailProcessActionDetail(
                            PROCESS_KEY, SkillTriggerProcessFailureReason.CONTROLLED
                        ),
                        List.of(),
                        List.of()
                    ))
                )
            )),
            "actions[0].targetContext",
            "FORBIDDEN"
        );

        ApiException eventSourceTarget = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "src_bad",
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(new SkillTriggerAction(
                    "deal", "执行效果", SkillTriggerActionType.EXECUTE_EFFECT, 10,
                    SkillTriggerTargetContext.EVENT_SOURCE,
                    new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY),
                    List.of(),
                    List.of()
                ))
            )
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", eventSourceTarget.getCode());
        assertField(eventSourceTarget, "actions[0].targetContext", "EVENT_SOURCE_NOT_AVAILABLE");
    }

    @Test
    void attackStartAmmoValueIsSavedAndReadBackWithoutChangingItsMeaning() {
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.state("ammo", SkillInternalStateType.AMMO)));
        SkillTriggerCondition ammo = attackStartAmmoCondition(SKILL_KEY, "ammo");
        service.create(GAME_ID, SKILL_KEY, withGroupsOn("fourth_shot",
            new SkillTriggerEventSource(SkillTriggerEventType.SKILL_HIT, new SkillTriggerSkillEventDetail(null, null)),
            List.of(group("g", ammo))));
        assertEquals(ammo, service.get(GAME_ID, SKILL_KEY, "fourth_shot").conditionGroups().get(0).conditions().get(0));
    }

    @Test
    void attackStartValueRejectsCounterAndOtherSkillState() {
        SkillTriggerEventSource hit = new SkillTriggerEventSource(SkillTriggerEventType.SKILL_HIT,
            new SkillTriggerSkillEventDetail(null, null));
        ApiException counter = thrown(() -> service.create(GAME_ID, SKILL_KEY, withGroupsOn("counter",
            hit, List.of(group("g", attackStartAmmoCondition(SKILL_KEY, "stacks"))))));
        assertField(counter, "conditionGroups[0].conditions[0].detail.valueKind", "REFERENCE_TYPE_MISMATCH");
        when(mapper.lockInternalStates(eq(GAME_ID), eq("other_skill"), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.state("ammo", SkillInternalStateType.AMMO)));
        ApiException foreign = thrown(() -> service.create(GAME_ID, SKILL_KEY, withGroupsOn("foreign",
            hit, List.of(group("g", attackStartAmmoCondition("other_skill", "ammo"))))));
        assertField(foreign, "conditionGroups[0].conditions[0].detail.stateSkillKey", "REFERENCE_TYPE_MISMATCH");
    }

    @Test
    void attackStartValueRejectsEventsWithoutTheOriginalAmmoCapture() {
        ApiException ordinary = thrown(() -> service.create(GAME_ID, SKILL_KEY,
            withGroups("ordinary", List.of(group("g", attackStartAmmoCondition(SKILL_KEY, "ammo"))))));
        assertField(ordinary, "conditionGroups[0].conditions[0].detail.valueKind", "EVENT_VALUE_NOT_AVAILABLE");
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.state("ammo", SkillInternalStateType.AMMO)));
        ApiException foreignHit = thrown(() -> service.create(GAME_ID, SKILL_KEY, withGroupsOn("foreign_hit",
            new SkillTriggerEventSource(SkillTriggerEventType.SKILL_HIT, new SkillTriggerSkillEventDetail("other_skill", null)),
            List.of(group("g", attackStartAmmoCondition(SKILL_KEY, "ammo"))))));
        assertField(foreignHit, "conditionGroups[0].conditions[0].detail.valueKind", "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test
    void statusPresenceDoesNotRequireAnEffectOriginWhenAnEffectChanges() {
        for (SkillTriggerStatusCheckKind checkKind : List.of(SkillTriggerStatusCheckKind.PRESENT, SkillTriggerStatusCheckKind.ABSENT)) {
            String ruleKey = "status_" + checkKind.name().toLowerCase(java.util.Locale.ROOT);
            SkillTriggerCondition status = condition("target_frost", SkillTriggerConditionType.STATUS_CHECK,
                new SkillTriggerStatusConditionDetail(SkillTriggerSubject.CURRENT_TARGET, "frost",
                    checkKind, null, null, null, null, null));
            service.create(GAME_ID, SKILL_KEY, withGroups(ruleKey, List.of(group("frost", status))));
            var savedRule = mapper.findRule(GAME_ID, SKILL_KEY, ruleKey);
            when(mapper.listRulesForGame(GAME_ID)).thenReturn(List.of(savedRule));
            assertDoesNotThrow(() -> service.validateAffectedConfigurationFinal(GAME_ID, SKILL_KEY,
                List.of(EFFECT_KEY), List.of(), List.of()));
        }
    }

    private static SkillTriggerCondition attackStartAmmoCondition(String stateSkillKey, String stateKey) {
        return condition("last_ammo", SkillTriggerConditionType.INTERNAL_STATE_CHECK,
            new SkillTriggerInternalStateConditionDetail(stateSkillKey, stateKey,
                SkillTriggerInternalStateValueKind.ATTACK_START_VALUE, null, null,
                SkillTriggerComparator.EQ, SkillNumericValue.fixed(java.math.BigDecimal.ONE)));
    }

    private static SkillTriggerRuleCreateRequest withGroups(String ruleKey, List<SkillTriggerConditionGroup> groups) {
        return withGroupsOn(
            ruleKey,
            new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
            groups
        );
    }

    private static SkillTriggerRuleCreateRequest withGroupsOn(
        String ruleKey,
        SkillTriggerEventSource eventSource,
        List<SkillTriggerConditionGroup> groups
    ) {
        return new SkillTriggerRuleCreateRequest(
            ruleKey, ruleKey, null, 10, eventSource, groups, List.of(executeAction("deal", EFFECT_KEY)), null, null
        , null);
    }

    private static SkillTriggerConditionGroup group(String groupKey, SkillTriggerCondition condition) {
        return new SkillTriggerConditionGroup(groupKey, groupKey, 0, List.of(condition));
    }

    private static SkillTriggerCondition condition(
        String conditionKey,
        SkillTriggerConditionType type,
        xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionDetail detail
    ) {
        return new SkillTriggerCondition(conditionKey, type, 0, detail);
    }
}
