package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.EFFECT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.PROCESS_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.RESULT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertCode;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.cooldownOp;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.emptyEventExecute;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.executeAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.lifecycleFullStacks;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.processStart;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.resultAvailable;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.rule;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.ruleRow;
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
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthDirection;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventMoment;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldown;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldownRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerRuleCycleServiceTest {

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
    void directResultAvailableSelfCycleIsRejectedAndPerTargetCooldownProtects() {
        stubSelfResultCycle("loop");
        assertCode(
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            () -> service.create(
                GAME_ID, SKILL_KEY,
                rule("loop", resultAvailable(EFFECT_KEY, RESULT_KEY), List.of(executeAction("deal", EFFECT_KEY)))
            )
        );

        when(mapper.listCooldownsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerPerTargetCooldownRow(
                GAME_ID, SKILL_KEY, "loop", "cd_f", SkillTriggerTargetContext.CURRENT_TARGET
            )
        ));
        stubAssembleExecuteEffect(mapper, "loop", "loop", SkillTriggerEventType.RESULT_AVAILABLE, "deal", EFFECT_KEY);
        when(mapper.findResultEvent(GAME_ID, SKILL_KEY, "loop")).thenReturn(
            new SkillTriggerResultEventRow(GAME_ID, SKILL_KEY, "loop", EFFECT_KEY, RESULT_KEY)
        );
        service.create(
            GAME_ID,
            SKILL_KEY,
            new SkillTriggerRuleCreateRequest(
                "loop", "loop", null, 10,
                resultAvailable(EFFECT_KEY, RESULT_KEY),
                List.of(),
                List.of(executeAction("deal", EFFECT_KEY)),
                new SkillTriggerPerTargetCooldown("cd_f", SkillTriggerTargetContext.CURRENT_TARGET),
                null
            )
        );
    }

    @Test
    void processStartAndLifecycleOperationFormIndirectCycles() {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow("proc", "proc", SkillTriggerEventType.PROCESS_MOMENT)
        ));
        when(mapper.listProcessEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerProcessEventRow(GAME_ID, SKILL_KEY, "proc", PROCESS_KEY, "PROCESS_START", null)
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.startActionRow("proc", "start")
        ));
        when(mapper.listProcessActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.processActionRow("proc", "start", PROCESS_KEY)
        ));
        assertCode(
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            () -> service.create(
                GAME_ID, SKILL_KEY,
                rule("proc", processStart(PROCESS_KEY), List.of(startProcessAction("start", PROCESS_KEY)))
            )
        );

        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            lifecycleOpShape("op", "mark"),
            SkillTriggerRuleTestSupport.lifecycleShape(
                "mark", "mark_result", "duration_f", null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            )
        ));
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow("life", "life", SkillTriggerEventType.LIFECYCLE_MOMENT)
        ));
        when(mapper.listProcessEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        when(mapper.listLifecycleEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerLifecycleEventRow(
                GAME_ID, SKILL_KEY, "life", "mark", SkillTriggerLifecycleEventMoment.FULL_STACKS
            )
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("life", "apply")
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("life", "apply", "op")
        ));
        when(mapper.listProcessActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        assertCode(
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            () -> service.create(
                GAME_ID, SKILL_KEY,
                rule("life", lifecycleFullStacks("mark"), List.of(executeAction("apply", "op")))
            )
        );
    }

    @Test
    void cooldownReadyStartHasNoSelfCycleButResetDoes() {
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            SkillTriggerRuleTestSupport.state("icd", SkillInternalStateType.INTERNAL_COOLDOWN)
        ));
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow("ready", "ready", SkillTriggerEventType.INTERNAL_STATE_CHANGED)
        ));
        when(mapper.listInternalStateEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerInternalStateEventRow(
                GAME_ID, SKILL_KEY, "ready", "icd", SkillTriggerInternalStateChangeKind.COOLDOWN_READY
            )
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.startActionRow("ready", "start")
        ));
        when(mapper.listProcessActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.processActionRow("ready", "start", PROCESS_KEY)
        ));
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            cooldownOp(PROCESS_KEY, "icd", SkillProcessStateOperationKind.START)
        ));
        stubAssembleExecuteEffect(mapper, "ready", "ready", SkillTriggerEventType.INTERNAL_STATE_CHANGED, "start", PROCESS_KEY);
        when(mapper.listActions(GAME_ID, SKILL_KEY, "ready")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.startActionRow("ready", "start")
        ));
        when(mapper.listEffectActions(GAME_ID, SKILL_KEY, "ready")).thenReturn(List.of());
        when(mapper.listProcessActions(GAME_ID, SKILL_KEY, "ready")).thenReturn(List.of(
            SkillTriggerRuleTestSupport.processActionRow("ready", "start", PROCESS_KEY)
        ));
        when(mapper.findInternalStateEvent(GAME_ID, SKILL_KEY, "ready")).thenReturn(
            new SkillTriggerInternalStateEventRow(
                GAME_ID, SKILL_KEY, "ready", "icd", SkillTriggerInternalStateChangeKind.COOLDOWN_READY
            )
        );
        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "ready",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.INTERNAL_STATE_CHANGED,
                    new SkillTriggerInternalStateEventDetail("icd", SkillTriggerInternalStateChangeKind.COOLDOWN_READY)
                ),
                List.of(startProcessAction("start", PROCESS_KEY))
            )
        );

        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            cooldownOp(PROCESS_KEY, "icd", SkillProcessStateOperationKind.RESET)
        ));
        assertCode(
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            () -> service.create(
                GAME_ID,
                SKILL_KEY,
                rule(
                    "ready_reset",
                    new SkillTriggerEventSource(
                        SkillTriggerEventType.INTERNAL_STATE_CHANGED,
                        new SkillTriggerInternalStateEventDetail("icd", SkillTriggerInternalStateChangeKind.COOLDOWN_READY)
                    ),
                    List.of(startProcessAction("start", PROCESS_KEY))
                )
            )
        );
    }

    @Test
    void damageDoesNotMatchUpwardHealDoesNotMatchDownwardAndShieldDoesNotCreateHealthEdge() {
        stubHealthRule("up", SkillTriggerHealthDirection.UPWARD);
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("up", "deal")
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("up", "deal", EFFECT_KEY)
        ));
        stubAssembleExecuteEffect(mapper, "up", "up", SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED, "deal", EFFECT_KEY);
        when(mapper.findHealthEvent(GAME_ID, SKILL_KEY, "up")).thenReturn(healthRow("up", SkillTriggerHealthDirection.UPWARD));
        service.create(
            GAME_ID, SKILL_KEY,
            rule("up", healthEvent(SkillTriggerHealthDirection.UPWARD), List.of(executeAction("deal", EFFECT_KEY)))
        );

        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.healShape(EFFECT_KEY, RESULT_KEY)
        ));
        stubHealthRule("down", SkillTriggerHealthDirection.DOWNWARD);
        stubAssembleExecuteEffect(mapper, "down", "down", SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED, "heal", EFFECT_KEY);
        when(mapper.findHealthEvent(GAME_ID, SKILL_KEY, "down")).thenReturn(
            healthRow("down", SkillTriggerHealthDirection.DOWNWARD)
        );
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("down", "heal")
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("down", "heal", EFFECT_KEY)
        ));
        service.create(
            GAME_ID, SKILL_KEY,
            rule("down", healthEvent(SkillTriggerHealthDirection.DOWNWARD), List.of(executeAction("heal", EFFECT_KEY)))
        );

        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.shieldShape(EFFECT_KEY, RESULT_KEY)
        ));
        stubHealthRule("shield", SkillTriggerHealthDirection.DOWNWARD);
        stubAssembleExecuteEffect(mapper, "shield", "shield", SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED, "apply", EFFECT_KEY);
        when(mapper.findHealthEvent(GAME_ID, SKILL_KEY, "shield")).thenReturn(
            healthRow("shield", SkillTriggerHealthDirection.DOWNWARD)
        );
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("shield", "apply")
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("shield", "apply", EFFECT_KEY)
        ));
        service.create(
            GAME_ID, SKILL_KEY,
            rule("shield", healthEvent(SkillTriggerHealthDirection.DOWNWARD), List.of(executeAction("apply", EFFECT_KEY)))
        );
    }

    @Test
    void periodicAndNaturalEndStillProduceEdgesWhileExplicitOnlyDoesNotProduceNaturalEnd() {
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.lifecycleShape(
                EFFECT_KEY, RESULT_KEY, "duration_f", "periodic_f", SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            )
        ));
        stubLifecycle("periodic", SkillTriggerLifecycleEventMoment.PERIODIC);
        assertCode(
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            () -> service.create(
                GAME_ID, SKILL_KEY,
                rule(
                    "periodic",
                    new SkillTriggerEventSource(
                        SkillTriggerEventType.LIFECYCLE_MOMENT,
                        new xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail(
                            EFFECT_KEY, SkillTriggerLifecycleEventMoment.PERIODIC
                        )
                    ),
                    List.of(executeAction("deal", EFFECT_KEY))
                )
            )
        );

        stubLifecycle("natural", SkillTriggerLifecycleEventMoment.NATURAL_END);
        assertCode(
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            () -> service.create(
                GAME_ID, SKILL_KEY,
                rule(
                    "natural",
                    new SkillTriggerEventSource(
                        SkillTriggerEventType.LIFECYCLE_MOMENT,
                        new xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail(
                            EFFECT_KEY, SkillTriggerLifecycleEventMoment.NATURAL_END
                        )
                    ),
                    List.of(executeAction("deal", EFFECT_KEY))
                )
            )
        );

        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.lifecycleShape(
                EFFECT_KEY, RESULT_KEY, "duration_f", null, SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY
            )
        ));
        stubLifecycle("explicit", SkillTriggerLifecycleEventMoment.NATURAL_END);
        assertCode(
            "400.INVALID_SKILL_TRIGGER_RULE_REFERENCE",
            () -> service.create(
                GAME_ID, SKILL_KEY,
                rule(
                    "explicit",
                    new SkillTriggerEventSource(
                        SkillTriggerEventType.LIFECYCLE_MOMENT,
                        new xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail(
                            EFFECT_KEY, SkillTriggerLifecycleEventMoment.NATURAL_END
                        )
                    ),
                    List.of(executeAction("deal", EFFECT_KEY))
                )
            )
        );
    }

    @Test
    void wideExternalEventsWithoutInboundEdgesAreNotFalseCycles() {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow("used", "used", SkillTriggerEventType.SKILL_USED)
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow("used", "deal")
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow("used", "deal", EFFECT_KEY)
        ));
        stubAssembleExecuteEffect(mapper, "used", "used", SkillTriggerEventType.SKILL_USED, "deal", EFFECT_KEY);
        when(mapper.findSkillEvent(GAME_ID, SKILL_KEY, "used")).thenReturn(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventRow(
                GAME_ID, SKILL_KEY, "used", SKILL_KEY,
                xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind.ACTIVE
            )
        );
        service.create(
            GAME_ID,
            SKILL_KEY,
            rule(
                "used",
                new SkillTriggerEventSource(
                    SkillTriggerEventType.SKILL_USED,
                    new xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail(
                        SKILL_KEY, xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind.ACTIVE
                    )
                ),
                List.of(executeAction("deal", EFFECT_KEY))
            )
        );
        stubAssembleExecuteEffect(mapper, "aa", "aa", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY);
        service.create(
            GAME_ID, SKILL_KEY,
            emptyEventExecute("aa", SkillTriggerEventType.BASIC_ATTACK_HIT, "deal", EFFECT_KEY)
        );
    }

    private void stubSelfResultCycle(String ruleKey) {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow(ruleKey, ruleKey, SkillTriggerEventType.RESULT_AVAILABLE)
        ));
        when(mapper.listResultEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerResultEventRow(GAME_ID, SKILL_KEY, ruleKey, EFFECT_KEY, RESULT_KEY)
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow(ruleKey, "deal")
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow(ruleKey, "deal", EFFECT_KEY)
        ));
    }

    private void stubHealthRule(String ruleKey, SkillTriggerHealthDirection direction) {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow(ruleKey, ruleKey, SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED)
        ));
        when(mapper.listHealthEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(healthRow(ruleKey, direction)));
    }

    private void stubLifecycle(String ruleKey, SkillTriggerLifecycleEventMoment moment) {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow(ruleKey, ruleKey, SkillTriggerEventType.LIFECYCLE_MOMENT)
        ));
        when(mapper.listLifecycleEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerLifecycleEventRow(GAME_ID, SKILL_KEY, ruleKey, EFFECT_KEY, moment)
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.executeActionRow(ruleKey, "deal")
        ));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.effectActionRow(ruleKey, "deal", EFFECT_KEY)
        ));
    }

    private static SkillTriggerHealthThresholdEventRow healthRow(String ruleKey, SkillTriggerHealthDirection direction) {
        return new SkillTriggerHealthThresholdEventRow(
            GAME_ID, SKILL_KEY, ruleKey, SkillTriggerSubject.CURRENT_TARGET, "hp", "threshold_f", direction
        );
    }

    private static SkillTriggerEventSource healthEvent(SkillTriggerHealthDirection direction) {
        return new SkillTriggerEventSource(
            SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED,
            new SkillTriggerHealthThresholdEventDetail(
                SkillTriggerSubject.CURRENT_TARGET, "hp", "threshold_f", direction
            )
        );
    }

    private static SkillTriggerEffectShapeRow lifecycleOpShape(String effectKey, String targetEffectKey) {
        return new SkillTriggerEffectShapeRow(
            effectKey, "op", SkillEffectResultType.LIFECYCLE_OPERATION, SkillEffectTarget.TARGET,
            false, null, null, null, null, null, null, targetEffectKey, SkillEffectLifecycleOperation.INCREASE,
            false, null, null, null, null, null
        );
    }
}
