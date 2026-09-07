package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.EFFECT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.PROCESS_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.RESULT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertField;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.emptyEventExecute;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.executeAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.healthDown;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.lifecycleFullStacks;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.processStart;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.resultAvailable;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.rule;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubParentAndCatalogs;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.thrown;

import java.util.List;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Set;
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
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCancelProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthDirection;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLinkEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSpellShieldBlockedEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerRuleEventShapeServiceTest {

    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillTriggerRuleMapper mapper;

    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(gamesMapper, skillMapper, mapper);
        service = SkillTriggerRuleTestSupport.service(gamesMapper, skillMapper, mapper);
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.state("icd", SkillInternalStateType.INTERNAL_COOLDOWN),
            SkillTriggerRuleTestSupport.state("flag", SkillInternalStateType.FLAG)
        ));
    }

    @Test
    void initializationPreservesSelfEventSourceAndStrictEmptyDetail() throws Exception {
        ObjectMapper json = new ObjectMapper();
        var event = json.readValue("{\"eventType\":\"SOURCE_INITIALIZED\",\"detail\":{}}", SkillTriggerEventSource.class);
        var originalAction = executeAction("apply_passive", EFFECT_KEY);
        var action = new SkillTriggerAction(originalAction.actionKey(), originalAction.name(), originalAction.actionType(),
            originalAction.sortOrder(), SkillTriggerTargetContext.EVENT_SOURCE, originalAction.detail(),
            originalAction.runtimeInputBindings(), originalAction.resultModifiers());
        service.create(GAME_ID, SKILL_KEY, rule("initialize", event, List.of(action)));
        var saved = service.get(GAME_ID, SKILL_KEY, "initialize");
        assertEquals(SkillTriggerEventType.SOURCE_INITIALIZED, saved.eventSource().eventType());
        assertEquals(SkillTriggerTargetContext.EVENT_SOURCE, saved.actions().get(0).targetContext());
        assertEquals("{}", json.writeValueAsString(saved.eventSource().detail()));
        for (String detail : List.of("null", "{\"sourceSkillKey\":\"other\"}", "{\"unexpected\":1}")) {
            var invalidEvent = json.readValue("{\"eventType\":\"SOURCE_INITIALIZED\",\"detail\":" + detail + "}", SkillTriggerEventSource.class);
            thrown(() -> service.create(GAME_ID, SKILL_KEY, rule("invalid_initialize", invalidEvent, List.of(action))));
        }
        for (String detail : List.of("[]", "1", "\"text\"")) {
            assertThrows(JsonProcessingException.class, () -> json.readValue(
                "{\"eventType\":\"SOURCE_INITIALIZED\",\"detail\":" + detail + "}", SkillTriggerEventSource.class));
        }
    }

    @Test
    void emptyDetailEventsAcceptEmptyObjectAndRejectTypedDetail() {
        for (SkillTriggerEventType type : List.of(
            SkillTriggerEventType.SOURCE_INITIALIZED,
            SkillTriggerEventType.BASIC_ATTACK_START,
            SkillTriggerEventType.BASIC_ATTACK_HIT,
            SkillTriggerEventType.CONTROL_RECEIVED,
            SkillTriggerEventType.KILL
        )) {
            service.create(GAME_ID, SKILL_KEY, emptyEventExecute(type.name().toLowerCase(), type, "deal", EFFECT_KEY));
            ApiException invalid = thrown(() -> service.create(
                GAME_ID,
                SKILL_KEY,
                rule(
                    "bad_" + type.name().toLowerCase(),
                    new SkillTriggerEventSource(
                        type,
                        new SkillTriggerProcessEventDetail(
                            PROCESS_KEY, new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null)
                        )
                    ),
                    List.of(executeAction("deal", EFFECT_KEY))
                )
            ));
            assertField(invalid, "eventSource.detail", "TYPE_MISMATCH");
        }
    }

    @Test
    void skillUsedRequiresUseKindAndSkillHitForbidsIt() {
        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "used",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.SKILL_USED,
                    new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );

        assertEquals(new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE),
            service.get(GAME_ID, SKILL_KEY, "used").eventSource().detail());

        ApiException missingKind = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "used_bad",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.SKILL_USED,
                    new SkillTriggerSkillEventDetail(SKILL_KEY, null)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        ));
        assertField(missingKind, "eventSource.detail.useKind", "REQUIRED");

        ApiException hitKind = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "hit_bad",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.SKILL_HIT,
                    new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        ));
        assertField(hitKind, "eventSource.detail.useKind", "FORBIDDEN");
    }

    @Test
    void spellShieldBlockedRequiresPersistentSpellShieldEffect() {
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerEffectShapeRow(
                EFFECT_KEY, "spell_shield", SkillEffectResultType.SPELL_SHIELD,
                SkillEffectTarget.SOURCE, false, null, null, null, null, null,
                SkillEffectLifecycleMoment.PERSISTENT, null, null, true,
                SkillNumericValue.formula("duration_f"), SkillNumericValue.formula("max_stacks_f"), SkillNumericValue.formula("app_stacks_f"), null,
                SkillEffectLifecycleExpiryMode.ALL_AT_ONCE,
                null, null, null, null
            )
        ));

        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "shield_blocked",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.SPELL_SHIELD_BLOCKED,
                    new SkillTriggerSpellShieldBlockedEventDetail(EFFECT_KEY)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );

        assertEquals(new SkillTriggerSpellShieldBlockedEventDetail(EFFECT_KEY),
            service.get(GAME_ID, SKILL_KEY, "shield_blocked").eventSource().detail());
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.damageShape(EFFECT_KEY, RESULT_KEY)
        ));
        ApiException invalid = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "shield_blocked_bad",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.SPELL_SHIELD_BLOCKED,
                    new SkillTriggerSpellShieldBlockedEventDetail(EFFECT_KEY)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        ));
        assertField(
            invalid,
            "eventSource.detail.shieldEffectKey",
            "REFERENCE_TYPE_MISMATCH"
        );
    }

    @Test
    void processResultLifecycleStatusHealthInternalAndSubjectHaveValidAndInvalidShapes() {
        service.create(GAME_ID, SKILL_KEY, rule("proc", processStart(PROCESS_KEY), List.of(executeAction("deal", EFFECT_KEY))));

        assertField(
            thrown(() -> service.create(
                GAME_ID, SKILL_KEY,
                rule(
                    "proc_bad",
                    new SkillTriggerEventSource(
                        SkillTriggerEventType.PROCESS_MOMENT,
                        new SkillTriggerProcessEventDetail(null, new SkillProcessMoment(SkillProcessMomentType.PROCESS_START, null))
                    ),
                    List.of(executeAction("deal", EFFECT_KEY))
                )
            )),
            "eventSource.detail.processKey",
            "REQUIRED"
        );

        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "cancel",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.PROCESS_CANCEL_REQUESTED,
                    new SkillTriggerCancelProcessEventDetail(PROCESS_KEY)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );

        service.create(
            GAME_ID, SKILL_KEY,
            rule("result", resultAvailable(EFFECT_KEY, RESULT_KEY), List.of(executeAction("deal", EFFECT_KEY)))
        );
        assertField(
            thrown(() -> service.create(
                GAME_ID, SKILL_KEY,
                rule(
                    "result_bad",
                    new SkillTriggerEventSource(
                        SkillTriggerEventType.RESULT_AVAILABLE,
                        new SkillTriggerResultEventDetail(EFFECT_KEY, null)
                    ),
                    List.of(executeAction("deal", EFFECT_KEY))
                )
            )),
            "eventSource.detail.resultKey",
            "REQUIRED"
        );

        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.lifecycleShape(
                EFFECT_KEY, RESULT_KEY, "duration_f", null,
                xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            )
        ));
        service.create(
            GAME_ID, SKILL_KEY,
            rule("life", lifecycleFullStacks(EFFECT_KEY), List.of(executeAction("deal", EFFECT_KEY)))
        );
        assertField(
            thrown(() -> service.create(
                GAME_ID, SKILL_KEY,
                rule(
                    "life_bad",
                    new SkillTriggerEventSource(
                        SkillTriggerEventType.LIFECYCLE_MOMENT,
                        new SkillTriggerLifecycleEventDetail(EFFECT_KEY, null)
                    ),
                    List.of(executeAction("deal", EFFECT_KEY))
                )
            )),
            "eventSource.detail.moment",
            "REQUIRED"
        );

        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "status",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.STATUS_CHANGED,
                    new SkillTriggerStatusEventDetail(SkillTriggerSubject.EVENT_SOURCE, "poison", SkillTriggerStatusChangeKind.APPLY)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );
        assertField(
            thrown(() -> service.create(
                GAME_ID, SKILL_KEY,
                rule(
                    "status_bad",
                    new SkillTriggerEventSource(
                        SkillTriggerEventType.STATUS_CHANGED,
                        new SkillTriggerStatusEventDetail(SkillTriggerSubject.SOURCE, null, SkillTriggerStatusChangeKind.APPLY)
                    ),
                    List.of(executeAction("deal", EFFECT_KEY))
                )
            )),
            "eventSource.detail.statusKey",
            "REQUIRED"
        );

        service.create(GAME_ID, SKILL_KEY, rule("health", healthDown(), List.of(executeAction("deal", EFFECT_KEY))));
        ApiException healthSource = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "health_bad",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED,
                    new SkillTriggerHealthThresholdEventDetail(
                        SkillTriggerSubject.EVENT_SOURCE, "hp", SkillNumericValue.formula("threshold_f"), SkillTriggerHealthDirection.DOWNWARD
                    )
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", healthSource.getCode());
        assertField(healthSource, "eventSource.detail.subject", "EVENT_SOURCE_NOT_AVAILABLE");

        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "istate",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.INTERNAL_STATE_CHANGED,
                    new SkillTriggerInternalStateEventDetail("flag", SkillTriggerInternalStateChangeKind.FLAG_CHANGED)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );
        assertField(
            thrown(() -> service.create(
                GAME_ID, SKILL_KEY,
                rule(
                    "istate_bad",
                    new SkillTriggerEventSource(
                        SkillTriggerEventType.INTERNAL_STATE_CHANGED,
                        new SkillTriggerInternalStateEventDetail("flag", null)
                    ),
                    List.of(executeAction("deal", EFFECT_KEY))
                )
            )),
            "eventSource.detail.changeKind",
            "REQUIRED"
        );

        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "died",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.ENTITY_DIED, new SkillTriggerSubjectEventDetail(SkillTriggerSubject.SOURCE)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );
        ApiException diedSource = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "died_bad",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.ENTITY_DIED,
                    new SkillTriggerSubjectEventDetail(SkillTriggerSubject.EVENT_SOURCE)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        ));
        assertField(diedSource, "eventSource.detail.subject", "EVENT_SOURCE_NOT_AVAILABLE");

        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "untarget",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.ENTITY_UNTARGETABLE,
                    new SkillTriggerSubjectEventDetail(SkillTriggerSubject.CURRENT_TARGET)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );
    }

    @Test
    void unknownEventDetailFieldIsRejectedAsInvalidBody() {
        ApiException exception = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "noise",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.BASIC_ATTACK_HIT,
                    new SkillTriggerEmptyEventDetail(Set.of(), Set.of("effectKey"))
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        ));
        assertField(exception, "eventSource.detail.effectKey", "UNKNOWN_FIELD");
    }

    @Test
    void hitAndAttackLinkEventsAcceptNullableSourceSkillAndRejectEventSource() {
        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "hit_link",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.HIT_LINK_APPLIED,
                    new SkillTriggerLinkEventDetail((String) null)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );

        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "attack_link",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.ATTACK_LINK_APPLIED,
                    new SkillTriggerLinkEventDetail(SKILL_KEY)
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );

        ApiException eventSource = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "hit_link_source",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.HIT_LINK_APPLIED,
                    new SkillTriggerLinkEventDetail((String) null)
                ),
                List.of(new xyz.game.datamanage.model.skilltrigger.SkillTriggerAction(
                    "deal",
                    "执行效果",
                    xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType.EXECUTE_EFFECT,
                    10,
                    xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext.EVENT_SOURCE,
                    new xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail(EFFECT_KEY),
                    List.of(),
                    List.of()
                ))
            )
        ));
        assertField(eventSource, "actions[0].targetContext", "EVENT_SOURCE_NOT_AVAILABLE");

        when(mapper.lockSkills(eq(GAME_ID), any())).thenReturn(List.of());
        ApiException missing = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "missing_source",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.HIT_LINK_APPLIED,
                    new SkillTriggerLinkEventDetail("missing_skill")
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        ));
        assertField(missing, "eventSource.detail.sourceSkillKey", "UNKNOWN_SKILL");
    }
}
