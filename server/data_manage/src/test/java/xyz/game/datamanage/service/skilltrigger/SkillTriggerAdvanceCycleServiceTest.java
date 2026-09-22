package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.PROCESS_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertCode;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.recastStep;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.ruleRow;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubParentAndCatalogs;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessFailureReason;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerAdvanceCycleServiceTest {

    @Mock private GamesMapper games;
    @Mock private SkillMapper skills;
    @Mock private SkillTriggerRuleMapper mapper;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.processActivation(PROCESS_KEY, SkillProcessActivationType.ACTIVE),
            recastStep(PROCESS_KEY, "recast")
        ));
    }

    @Test
    void advanceToProcessCompleteIsACycleAndFailureReasonDoesNotExemptIt() {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow("complete", "complete", SkillTriggerEventType.PROCESS_MOMENT)
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, "complete", "advance", "推进", SkillTriggerActionType.ADVANCE_PROCESS, 10, null
            )
        ));
        when(mapper.listProcessActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            SkillTriggerRuleTestSupport.advanceProcessActionRow("complete", "advance", PROCESS_KEY, "recast")
        ));
        when(mapper.listProcessEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerProcessEventRow(
                GAME_ID, SKILL_KEY, "complete", PROCESS_KEY, "PROCESS_COMPLETE", null, "ACTIVE_CANCELLED"
            )
        ));
        assertCode("400.TRIGGER_RULE_CYCLE_UNGUARDED", () ->
            new SkillTriggerCycleValidator(mapper).validateCurrentSkill(GAME_ID, SKILL_KEY));
    }

    @Test
    void missingAdvanceDetailStillProducesCycleEdges() {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow("complete", "complete", SkillTriggerEventType.PROCESS_MOMENT)
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow(
                GAME_ID, SKILL_KEY, "complete", "advance", "推进", SkillTriggerActionType.ADVANCE_PROCESS, 10, null
            )
        ));
        when(mapper.listProcessActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        when(mapper.listProcessEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerProcessEventRow(
                GAME_ID, SKILL_KEY, "complete", PROCESS_KEY, "PROCESS_COMPLETE", null, null
            )
        ));
        assertCode("400.TRIGGER_RULE_CYCLE_UNGUARDED", () ->
            new SkillTriggerCycleValidator(mapper).validateCurrentSkill(GAME_ID, SKILL_KEY));
    }

    @Test
    void advanceDoesNotProduceProcessStartCycle() {
        stubProcessMomentAction(SkillTriggerActionType.ADVANCE_PROCESS, "PROCESS_START", null, null);
        assertDoesNotThrow(() -> new SkillTriggerCycleValidator(mapper).validateCurrentSkill(GAME_ID, SKILL_KEY));
    }

    @ParameterizedTest
    @CsvSource({"CONTROLLED, ACTIVE_CANCELLED", "ACTIVE_CANCELLED, CONTROLLED"})
    void explicitDifferentFailureReasonsDoNotFormASelfCycle(
        SkillTriggerProcessFailureReason actionReason,
        SkillTriggerProcessFailureReason filterReason
    ) {
        stubProcessMomentAction(
            SkillTriggerActionType.FAIL_PROCESS, "PROCESS_FAILURE", filterReason.name(), actionReason
        );
        assertDoesNotThrow(() -> new SkillTriggerCycleValidator(mapper).validateCurrentSkill(GAME_ID, SKILL_KEY));
    }

    @ParameterizedTest
    @EnumSource(SkillTriggerProcessFailureReason.class)
    void matchingFailureReasonStillFormsASelfCycle(SkillTriggerProcessFailureReason reason) {
        stubProcessMomentAction(SkillTriggerActionType.FAIL_PROCESS, "PROCESS_FAILURE", reason.name(), reason);
        assertCode("400.TRIGGER_RULE_CYCLE_UNGUARDED", () ->
            new SkillTriggerCycleValidator(mapper).validateCurrentSkill(GAME_ID, SKILL_KEY));
    }

    @ParameterizedTest
    @EnumSource(SkillTriggerProcessFailureReason.class)
    void unfilteredFailureStillFormsASelfCycle(SkillTriggerProcessFailureReason reason) {
        stubProcessMomentAction(SkillTriggerActionType.FAIL_PROCESS, "PROCESS_FAILURE", null, reason);
        assertCode("400.TRIGGER_RULE_CYCLE_UNGUARDED", () ->
            new SkillTriggerCycleValidator(mapper).validateCurrentSkill(GAME_ID, SKILL_KEY));
    }

    @ParameterizedTest
    @EnumSource(value = SkillTriggerActionType.class, names = {"START_PROCESS", "ADVANCE_PROCESS"})
    void lifecycleWithUnknownFailureReasonStillMatchesEveryFailureFilter(SkillTriggerActionType actionType) {
        for (SkillTriggerProcessFailureReason reason : SkillTriggerProcessFailureReason.values()) {
            stubProcessMomentAction(actionType, "PROCESS_FAILURE", reason.name(), null);
            assertCode("400.TRIGGER_RULE_CYCLE_UNGUARDED", () ->
                new SkillTriggerCycleValidator(mapper).validateCurrentSkill(GAME_ID, SKILL_KEY));
        }
    }

    private void stubProcessMomentAction(
        SkillTriggerActionType actionType,
        String momentType,
        String filterFailureReason,
        SkillTriggerProcessFailureReason actionFailureReason
    ) {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow("loop", "loop", SkillTriggerEventType.PROCESS_MOMENT)
        ));
        when(mapper.listProcessEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerProcessEventRow(
                GAME_ID, SKILL_KEY, "loop", PROCESS_KEY, momentType, null, filterFailureReason
            )
        ));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerActionRow(GAME_ID, SKILL_KEY, "loop", "action", "动作", actionType, 10, null)
        ));
        when(mapper.listProcessActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerProcessActionRow(
                GAME_ID, SKILL_KEY, "loop", "action", actionType, PROCESS_KEY,
                actionType == SkillTriggerActionType.ADVANCE_PROCESS ? "recast" : null, actionFailureReason
            )
        ));
    }
}
