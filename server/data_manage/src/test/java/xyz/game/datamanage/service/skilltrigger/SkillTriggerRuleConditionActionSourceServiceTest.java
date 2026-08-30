package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
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
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubAssembleExecuteEffect;
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
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusCheckKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
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
                SkillTriggerComparator.LTE, FORMULA_KEY
            )
        ));
        stubAssembleExecuteEffect(mapper, "attr_ok", "attr_ok", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, withGroups("attr_ok", List.of(attribute)));

        ApiException eventSource = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            withGroups("attr_bad", List.of(group("g", condition(
                "attr",
                SkillTriggerConditionType.ATTRIBUTE_COMPARE,
                new SkillTriggerAttributeConditionDetail(
                    SkillTriggerSubject.EVENT_SOURCE, ATTRIBUTE_KEY, AttributeValueKind.CURRENT_RATIO,
                    SkillTriggerComparator.LTE, FORMULA_KEY
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
                null, null, null, null
            )
        ));
        stubAssembleExecuteEffect(mapper, "status_ok", "status_ok", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, withGroups("status_ok", List.of(present)));
        assertField(
            thrown(() -> service.create(
                GAME_ID, SKILL_KEY,
                withGroups("status_bad", List.of(group("g", condition(
                    "present",
                    SkillTriggerConditionType.STATUS_CHECK,
                    new SkillTriggerStatusConditionDetail(
                        SkillTriggerSubject.CURRENT_TARGET, "poison", SkillTriggerStatusCheckKind.PRESENT,
                        EFFECT_KEY, RESULT_KEY, SkillTriggerComparator.GTE, FORMULA_KEY
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
                "flag", SkillTriggerInternalStateValueKind.ENABLED, null, true, null, null
            )
        ));
        stubAssembleExecuteEffect(mapper, "istate_ok", "istate_ok", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, withGroups("istate_ok", List.of(flag)));
        ApiException mismatch = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            withGroups("istate_bad", List.of(group("g", condition(
                "value",
                SkillTriggerConditionType.INTERNAL_STATE_CHECK,
                new SkillTriggerInternalStateConditionDetail(
                    "flag", SkillTriggerInternalStateValueKind.VALUE, null, null, SkillTriggerComparator.GTE, FORMULA_KEY
                )
            ))))
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", mismatch.getCode());
        assertField(mismatch, "conditionGroups[0].conditions[0].detail.valueKind", "REFERENCE_TYPE_MISMATCH");

        SkillTriggerConditionGroup hitIndex = group("g", condition(
            "hit",
            SkillTriggerConditionType.EVENT_VALUE_COMPARE,
            new SkillTriggerEventValueConditionDetail(
                SkillTriggerEventValueKey.HIT_INDEX, SkillTriggerComparator.GTE, FORMULA_KEY
            )
        ));
        stubAssembleExecuteEffect(mapper, "value_ok", "value_ok", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
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
    }

    @Test
    void threeActionsAndEventSourceTargetHaveValidAndInvalidShapes() {
        stubAssembleExecuteEffect(mapper, "exec", "exec", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        service.create(GAME_ID, SKILL_KEY, emptyEventExecute("exec", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY));

        stubAssembleExecuteEffect(mapper, "start", "start", SkillTriggerEventType.BASIC_ATTACK_HIT, "start", PROCESS_KEY);
        when(mapper.listActions(GAME_ID, SKILL_KEY, "start")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.startActionRow("start", "start")
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, "start")).thenReturn(List.of());
        when(mapper.listProcessActions(GAME_ID, SKILL_KEY, "start")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.processActionRow("start", "start", PROCESS_KEY)
        ));
        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "start",
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(startProcessAction("start", PROCESS_KEY))
            )
        );

        stubAssembleExecuteEffect(mapper, "fail", "fail", SkillTriggerEventType.CONTROL_RECEIVED, "fail", PROCESS_KEY);
        when(mapper.listActions(GAME_ID, SKILL_KEY, "fail")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, "fail", "fail", "令过程失败",
                SkillTriggerActionType.FAIL_PROCESS, 20, null
            )
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, "fail")).thenReturn(List.of());
        when(mapper.listProcessActions(GAME_ID, SKILL_KEY, "fail")).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessActionRow(
                GAME_ID, SKILL_KEY, "fail", "fail", PROCESS_KEY, SkillTriggerProcessFailureReason.CONTROLLED
            )
        ));
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
        verify(mapper).insertProcessAction(GAME_ID, SKILL_KEY, "fail", "fail", PROCESS_KEY, "CONTROLLED");
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
        );
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
