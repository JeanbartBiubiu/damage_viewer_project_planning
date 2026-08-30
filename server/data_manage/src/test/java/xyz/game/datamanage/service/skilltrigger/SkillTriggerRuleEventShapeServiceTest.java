package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.EFFECT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.PROCESS_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.RESULT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertCode;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertField;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.emptyEventExecute;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.executeAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.healthDown;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.lifecycleFullStacks;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.processStart;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.resultAvailable;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.rule;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubAssembleExecuteEffect;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubParentAndCatalogs;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.thrown;

import java.util.List;
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
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCancelProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthDirection;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventDetail;
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
    void emptyDetailEventsAcceptEmptyObjectAndRejectTypedDetail() {
        for (SkillTriggerEventType type : List.of(
            SkillTriggerEventType.BASIC_ATTACK_START,
            SkillTriggerEventType.BASIC_ATTACK_HIT,
            SkillTriggerEventType.CONTROL_RECEIVED,
            SkillTriggerEventType.KILL
        )) {
            stubAssembleExecuteEffect(mapper, type.name().toLowerCase(), type.name(), type, "deal", EFFECT_KEY);
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
        stubAssembleExecuteEffect(mapper, "used", "used", SkillTriggerEventType.SKILL_USED, "deal", EFFECT_KEY);
        when(mapper.findSkillEvent(GAME_ID, SKILL_KEY, "used")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventRow(
                GAME_ID, SKILL_KEY, "used", SKILL_KEY, SkillTriggerEventUseKind.ACTIVE
            )
        );
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
        verify(mapper).insertSkillEvent(GAME_ID, SKILL_KEY, "used", SKILL_KEY, "ACTIVE");

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
    void processResultLifecycleStatusHealthInternalAndSubjectHaveValidAndInvalidShapes() {
        stubAssembleExecuteEffect(mapper, "proc", "proc", SkillTriggerEventType.PROCESS_MOMENT, "deal", EFFECT_KEY);
        when(mapper.findProcessEvent(GAME_ID, SKILL_KEY, "proc")).thenReturn(
            new SkillTriggerProcessEventRow(GAME_ID, SKILL_KEY, "proc", PROCESS_KEY, "PROCESS_START", null)
        );
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

        stubAssembleExecuteEffect(mapper, "cancel", "cancel", SkillTriggerEventType.PROCESS_CANCEL_REQUESTED, "deal", EFFECT_KEY);
        when(mapper.findProcessEvent(GAME_ID, SKILL_KEY, "cancel")).thenReturn(
            new SkillTriggerProcessEventRow(GAME_ID, SKILL_KEY, "cancel", PROCESS_KEY, null, null)
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

        stubAssembleExecuteEffect(mapper, "result", "result", SkillTriggerEventType.RESULT_AVAILABLE, "deal", EFFECT_KEY);
        when(mapper.findResultEvent(GAME_ID, SKILL_KEY, "result")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventRow(
                GAME_ID, SKILL_KEY, "result", EFFECT_KEY, RESULT_KEY
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

        stubAssembleExecuteEffect(mapper, "life", "life", SkillTriggerEventType.LIFECYCLE_MOMENT, "deal", EFFECT_KEY);
        when(mapper.findLifecycleEvent(GAME_ID, SKILL_KEY, "life")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventRow(
                GAME_ID, SKILL_KEY, "life", EFFECT_KEY,
                xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventMoment.FULL_STACKS
            )
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

        stubAssembleExecuteEffect(mapper, "status", "status", SkillTriggerEventType.STATUS_CHANGED, "deal", EFFECT_KEY);
        when(mapper.findStatusEvent(GAME_ID, SKILL_KEY, "status")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventRow(
                GAME_ID, SKILL_KEY, "status", SkillTriggerSubject.EVENT_SOURCE, "poison",
                SkillTriggerStatusChangeKind.APPLY
            )
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

        stubAssembleExecuteEffect(
            mapper, "health", "health", SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED, "deal", EFFECT_KEY
        );
        when(mapper.findHealthEvent(GAME_ID, SKILL_KEY, "health")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventRow(
                GAME_ID, SKILL_KEY, "health", SkillTriggerSubject.SOURCE, "hp", "threshold_f",
                SkillTriggerHealthDirection.DOWNWARD
            )
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
                        SkillTriggerSubject.EVENT_SOURCE, "hp", "threshold_f", SkillTriggerHealthDirection.DOWNWARD
                    )
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", healthSource.getCode());
        assertField(healthSource, "eventSource.detail.subject", "EVENT_SOURCE_NOT_AVAILABLE");

        stubAssembleExecuteEffect(
            mapper, "istate", "istate", SkillTriggerEventType.INTERNAL_STATE_CHANGED, "deal", EFFECT_KEY
        );
        when(mapper.findInternalStateEvent(GAME_ID, SKILL_KEY, "istate")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventRow(
                GAME_ID, SKILL_KEY, "istate", "flag", SkillTriggerInternalStateChangeKind.FLAG_CHANGED
            )
        );
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

        stubAssembleExecuteEffect(mapper, "died", "died", SkillTriggerEventType.ENTITY_DIED, "deal", EFFECT_KEY);
        when(mapper.findSubjectEvent(GAME_ID, SKILL_KEY, "died")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventRow(
                GAME_ID, SKILL_KEY, "died", SkillTriggerSubject.SOURCE
            )
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

        stubAssembleExecuteEffect(
            mapper, "untarget", "untarget", SkillTriggerEventType.ENTITY_UNTARGETABLE, "deal", EFFECT_KEY
        );
        when(mapper.findSubjectEvent(GAME_ID, SKILL_KEY, "untarget")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventRow(
                GAME_ID, SKILL_KEY, "untarget", SkillTriggerSubject.CURRENT_TARGET
            )
        );
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
}
