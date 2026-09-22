package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.EFFECT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.PROCESS_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.TS;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.advanceProcessAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertField;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.chargeStep;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.executeAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.processActivation;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.recastStep;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.rule;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.skillUsed;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.startProcessAction;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubParentAndCatalogs;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.thrown;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.updateFromCreate;

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
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAdvanceProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCastPhase;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessFailureReason;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleUpdateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerCastingPhaseServiceTest {

    @Mock private GamesMapper games;
    @Mock private SkillMapper skills;
    @Mock private SkillTriggerRuleMapper mapper;
    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            processActivation(PROCESS_KEY, SkillProcessActivationType.ACTIVE),
            recastStep(PROCESS_KEY, "recast"),
            chargeStep(PROCESS_KEY, "charge")
        ));
        service = SkillTriggerRuleTestSupport.service(games, skills, mapper);
    }

    @Test
    void getReturnsMissingCastPhaseWithoutDefaultingInitial() {
        when(mapper.findRule(GAME_ID, SKILL_KEY, "legacy")).thenReturn(legacyUsedRow("legacy", "旧名"));
        SkillTriggerSkillEventDetail detail = (SkillTriggerSkillEventDetail) service.get(GAME_ID, SKILL_KEY, "legacy")
            .eventSource().detail();
        assertNull(detail.castPhase());
        assertEquals(SKILL_KEY, detail.sourceSkillKey());
    }

    @Test
    void renameOnlyStillRequiresCastPhase() {
        when(mapper.findRuleForUpdate(GAME_ID, SKILL_KEY, "legacy")).thenReturn(legacyUsedRow("legacy", "旧名"));
        SkillTriggerRuleUpdateRequest rename = new SkillTriggerRuleUpdateRequest(
            null,
            "新名字",
            null,
            10,
            new SkillTriggerEventSource(
                SkillTriggerEventType.SKILL_USED,
                new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE)
            ),
            List.of(),
            List.of(executeAction("deal", EFFECT_KEY)),
            null,
            null
        );
        assertField(thrown(() -> service.update(GAME_ID, SKILL_KEY, "legacy", rename)),
            "eventSource.detail.castPhase", "REQUIRED");
    }

    @Test
    void recastAdvancePersistsAndChargeReleaseMatchesChargeStep() {
        var recast = service.create(GAME_ID, SKILL_KEY, rule(
            "recast",
            skillUsed(SkillTriggerCastPhase.RECAST),
            List.of(advanceProcessAction("advance", PROCESS_KEY, "recast"))
        ));
        assertEquals(SkillTriggerActionType.ADVANCE_PROCESS, recast.actions().getFirst().actionType());
        assertEquals("recast", ((SkillTriggerAdvanceProcessActionDetail) recast.actions().getFirst().detail()).stepKey());

        var release = service.create(GAME_ID, SKILL_KEY, rule(
            "release",
            skillUsed(SkillTriggerCastPhase.CHARGE_RELEASE),
            List.of(advanceProcessAction("advance", PROCESS_KEY, "charge"))
        ));
        assertEquals("charge", ((SkillTriggerAdvanceProcessActionDetail) release.actions().getFirst().detail()).stepKey());
    }

    @Test
    void advanceRejectsInitialPassiveMismatchAndControlShell() {
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, rule(
            "initial_advance",
            skillUsed(SkillTriggerCastPhase.INITIAL),
            List.of(advanceProcessAction("advance", PROCESS_KEY, "recast"))
        ))), "eventSource.detail.castPhase", "REFERENCE_TYPE_MISMATCH");

        SkillTriggerAction shelled = new SkillTriggerAction(
            "advance",
            "推进过程",
            SkillTriggerActionType.ADVANCE_PROCESS,
            10,
            SkillTriggerTargetContext.CURRENT_TARGET,
            new SkillTriggerAdvanceProcessActionDetail(PROCESS_KEY, "recast"),
            List.of(),
            List.of()
        );
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, rule(
            "shell",
            skillUsed(SkillTriggerCastPhase.RECAST),
            List.of(shelled)
        ))), "actions[0].targetContext", "FORBIDDEN");

        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, rule(
            "type_mismatch",
            skillUsed(SkillTriggerCastPhase.RECAST),
            List.of(advanceProcessAction("advance", PROCESS_KEY, "charge"))
        ))), "actions[0].detail.stepKey", "REFERENCE_TYPE_MISMATCH");

        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            processActivation(PROCESS_KEY, SkillProcessActivationType.PASSIVE),
            recastStep(PROCESS_KEY, "recast")
        ));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, rule(
            "passive_advance",
            skillUsed(SkillTriggerCastPhase.RECAST),
            List.of(advanceProcessAction("advance", PROCESS_KEY, "recast"))
        ))), "actions[0].detail.processKey", "REFERENCE_TYPE_MISMATCH");

        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            processActivation(PROCESS_KEY, SkillProcessActivationType.ACTIVE),
            recastStep(PROCESS_KEY, "recast"),
            chargeStep(PROCESS_KEY, "charge")
        ));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, rule(
            "other_skill",
            new SkillTriggerEventSource(
                SkillTriggerEventType.SKILL_USED,
                new SkillTriggerSkillEventDetail("other_skill", SkillTriggerEventUseKind.ACTIVE, SkillTriggerCastPhase.RECAST)
            ),
            List.of(advanceProcessAction("advance", PROCESS_KEY, "recast"))
        ))), "eventSource.detail.sourceSkillKey", "REFERENCE_TYPE_MISMATCH");
    }

    @Test
    void startProcessOnExplicitRecastIsRejectedWhileInitialStillStarts() {
        service.create(GAME_ID, SKILL_KEY, rule(
            "start_initial",
            skillUsed(SkillTriggerCastPhase.INITIAL),
            List.of(startProcessAction("start", PROCESS_KEY))
        ));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, rule(
            "start_recast",
            skillUsed(SkillTriggerCastPhase.RECAST),
            List.of(startProcessAction("start", PROCESS_KEY))
        ))), "actions[0].actionType", "REFERENCE_TYPE_MISMATCH");
    }

    @Test
    void processFailureReasonIsForbiddenOnOtherMomentsAndUnknownFieldsAreRejected() {
        SkillTriggerEventSource complete = new SkillTriggerEventSource(
            SkillTriggerEventType.PROCESS_MOMENT,
            new SkillTriggerProcessEventDetail(
                PROCESS_KEY,
                new SkillProcessMoment(
                    SkillProcessMomentType.PROCESS_COMPLETE,
                    null,
                    SkillTriggerProcessFailureReason.ACTIVE_CANCELLED
                )
            )
        );
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, rule(
            "complete_reason", complete, List.of(executeAction("deal", EFFECT_KEY))
        ))), "eventSource.detail.moment.failureReason", "FORBIDDEN");

        SkillProcessMoment noisy = AggregateJson.read(
            "{\"momentType\":\"PROCESS_FAILURE\",\"unexpected\":1}", SkillProcessMoment.class);
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, rule(
            "unknown_moment",
            new SkillTriggerEventSource(
                SkillTriggerEventType.PROCESS_MOMENT,
                new SkillTriggerProcessEventDetail(PROCESS_KEY, noisy)
            ),
            List.of(executeAction("deal", EFFECT_KEY))
        ))), "eventSource.detail.moment.unexpected", "UNKNOWN_FIELD");
    }

    @Test
    void unrelatedExecuteOnHitDoesNotRequireCastPhase() {
        service.create(GAME_ID, SKILL_KEY, rule(
            "hit",
            new SkillTriggerEventSource(
                SkillTriggerEventType.SKILL_HIT,
                new SkillTriggerSkillEventDetail(SKILL_KEY, null)
            ),
            List.of(executeAction("deal", EFFECT_KEY))
        ));
    }

    private static SkillTriggerRuleRow legacyUsedRow(String ruleKey, String name) {
        return new SkillTriggerRuleRow(
            GAME_ID,
            SKILL_KEY,
            ruleKey,
            name,
            null,
            10,
            SkillTriggerEventType.SKILL_USED,
            TS,
            TS,
            "{\"eventType\":\"SKILL_USED\",\"detail\":{\"sourceSkillKey\":\"ezreal_q\",\"useKind\":\"ACTIVE\"}}",
            "[]",
            "[{\"actionKey\":\"deal\",\"name\":\"执行效果\",\"actionType\":\"EXECUTE_EFFECT\",\"sortOrder\":10,"
                + "\"targetContext\":\"CURRENT_TARGET\",\"detail\":{\"effectKey\":\"burst\"},"
                + "\"runtimeInputBindings\":[],\"resultModifiers\":[]}]",
            "{\"perTargetCooldown\":null,\"maxTriggersPerProcess\":null}"
        );
    }
}
