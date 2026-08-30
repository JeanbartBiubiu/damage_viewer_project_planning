package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.EFFECT_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.FORMULA_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.GAME_ID;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.PROCESS_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.SKILL_KEY;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertCode;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.assertField;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.stubParentAndCatalogs;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.thrown;

import java.util.List;
import java.util.Map;
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
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationStackMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventMoment;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerReferenceHit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventRow;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerRuleReverseProtectionServiceTest {

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
    void reverseProtectionsUseStableConflictCodesAndExactFieldPaths() {
        when(mapper.countSourceSkillReferences(GAME_ID, SKILL_KEY)).thenReturn(1L);
        ApiException skill = thrown(() -> service.assertSourceSkillNotReferenced(GAME_ID, SKILL_KEY));
        assertEquals("409.SKILL_IN_USE", skill.getCode());
        assertField(skill, "skillKey", "CONFLICT");

        when(mapper.countEffectReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);
        List<Map<String, String>> effectIssues = service.effectDeleteIssues(GAME_ID, SKILL_KEY, EFFECT_KEY);
        assertEquals("TRIGGER_RULE_EFFECT_IN_USE", effectIssues.get(0).get("code"));
        assertEquals("effectKey", effectIssues.get(0).get("field"));
        assertCode("409.SKILL_EFFECT_IN_USE", () -> service.assertEffectDeletable(GAME_ID, SKILL_KEY, EFFECT_KEY));

        when(mapper.countProcessReferences(GAME_ID, SKILL_KEY, PROCESS_KEY)).thenReturn(1L);
        ApiException process = thrown(() -> service.assertProcessDeletable(GAME_ID, SKILL_KEY, PROCESS_KEY));
        assertEquals("409.SKILL_PROCESS_IN_USE", process.getCode());
        assertField(process, "processKey", "TRIGGER_RULE_PROCESS_IN_USE");

        when(mapper.countStepReferences(GAME_ID, SKILL_KEY, PROCESS_KEY, "windup")).thenReturn(1L);
        ApiException step = thrown(() -> service.assertStepsNotReferenced(
            GAME_ID, SKILL_KEY, PROCESS_KEY, List.of("windup")
        ));
        assertEquals("409.SKILL_PROCESS_IN_USE", step.getCode());
        assertField(step, "steps", "TRIGGER_RULE_STEP_IN_USE");

        when(mapper.countInternalStateReferences(GAME_ID, SKILL_KEY, "flag")).thenReturn(1L);
        ApiException state = thrown(() -> service.assertInternalStateDeletable(GAME_ID, SKILL_KEY, "flag"));
        assertEquals("409.SKILL_INTERNAL_STATE_IN_USE", state.getCode());
        assertField(state, "stateKey", "TRIGGER_RULE_INTERNAL_STATE_IN_USE");

        when(mapper.countOptionReferences(GAME_ID, SKILL_KEY, "stance", List.of("ranged"))).thenReturn(1L);
        ApiException option = thrown(() -> service.assertOptionsNotReferenced(
            GAME_ID, SKILL_KEY, "stance", List.of("ranged")
        ));
        assertEquals("409.SKILL_INTERNAL_STATE_OPTION_IN_USE", option.getCode());
        assertField(option, "detail.options", "TRIGGER_RULE_OPTION_IN_USE");

        when(mapper.countFormulaReferences(GAME_ID, SKILL_KEY, FORMULA_KEY)).thenReturn(1L);
        ApiException formula = thrown(() -> service.assertFormulaDeletable(GAME_ID, SKILL_KEY, FORMULA_KEY));
        assertEquals("409.SKILL_FORMULA_IN_USE", formula.getCode());
        assertField(formula, "formulaKey", "TRIGGER_RULE_FORMULA_IN_USE");

        when(mapper.countParameterReferences(GAME_ID, SKILL_KEY, "ratio")).thenReturn(1L);
        ApiException parameter = thrown(() -> service.assertParameterDeletable(GAME_ID, SKILL_KEY, "ratio"));
        assertEquals("409.SKILL_PARAMETER_IN_USE", parameter.getCode());
        assertField(parameter, "parameterKey", "TRIGGER_RULE_PARAMETER_IN_USE");

        when(mapper.countStatusReferences(GAME_ID, "poison")).thenReturn(1L);
        ApiException status = thrown(() -> service.assertStatusDeletable(GAME_ID, "poison"));
        assertEquals("409.STATUS_IN_USE", status.getCode());
        assertField(status, "statusKey", "TRIGGER_RULE_STATUS_IN_USE");
    }

    @Test
    void effectUpdateProtectsRemovedResultsAndLifecycleWithFieldPathsThenSkillCleanupDeletesAll() {
        when(mapper.listResultReferences(GAME_ID, SKILL_KEY, EFFECT_KEY, List.of(RESULT_REMOVED))).thenReturn(List.of(
            new SkillTriggerReferenceHit("on_hit", "results", RESULT_REMOVED, "in use")
        ));
        ApiException result = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, lifecycleRow(), lifecycleRequest(), List.of(damageResult()), List.of(RESULT_REMOVED)
        ));
        assertEquals("409.SKILL_EFFECT_IN_USE", result.getCode());
        assertField(result, "results", "TRIGGER_RULE_RESULT_IN_USE");

        when(mapper.listResultReferences(GAME_ID, SKILL_KEY, EFFECT_KEY, List.of())).thenReturn(List.of());
        when(mapper.countLifecycleReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(1L);
        ApiException lifecycle = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, lifecycleRow(), null, List.of(damageResult()), List.of()
        ));
        assertEquals("409.SKILL_EFFECT_IN_USE", lifecycle.getCode());
        assertField(lifecycle, "lifecycle", "TRIGGER_RULE_LIFECYCLE_IN_USE");

        when(mapper.countLifecycleReferences(GAME_ID, SKILL_KEY, EFFECT_KEY)).thenReturn(0L);
        when(mapper.listResultEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerResultEventRow(GAME_ID, SKILL_KEY, "on_hit", EFFECT_KEY, "physical_hit")
        ));
        ApiException shape = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, lifecycleRow(), lifecycleRequest(), List.of(damageResult()), List.of()
        ));
        assertEquals("409.SKILL_EFFECT_IN_USE", shape.getCode());
        assertTrue(SkillTriggerRuleTestSupport.fieldIssues(shape).stream()
            .anyMatch(issue -> "TRIGGER_RULE_SHAPE_IN_USE".equals(issue.get("code"))));

        when(mapper.listResultEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        when(mapper.listLifecycleEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerLifecycleEventRow(
                GAME_ID, SKILL_KEY, "tick", EFFECT_KEY, SkillTriggerLifecycleEventMoment.PERIODIC
            )
        ));
        ApiException periodic = thrown(() -> service.assertEffectUpdate(
            GAME_ID, SKILL_KEY, EFFECT_KEY, lifecycleRow(), lifecycleRequestWithoutPeriodic(), List.of(damageResult()), List.of()
        ));
        assertField(periodic, "lifecycle.periodicIntervalFormulaKey", "TRIGGER_RULE_SHAPE_IN_USE");

        service.deleteAllForSkill(GAME_ID, SKILL_KEY);
        verify(mapper).deleteAllForSkill(GAME_ID, SKILL_KEY);
    }

    private static final String RESULT_REMOVED = "old_hit";

    private static SkillEffectLifecycleRow lifecycleRow() {
        return new SkillEffectLifecycleRow(
            GAME_ID, SKILL_KEY, EFFECT_KEY, "duration_f", "max_stacks_f", "app_stacks_f",
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.KEEP,
            null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE, "periodic_f", null
        );
    }

    private static SkillEffectLifecycleRequest lifecycleRequest() {
        return new SkillEffectLifecycleRequest(
            "duration_f", "max_stacks_f", "app_stacks_f",
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.KEEP,
            null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE, "periodic_f", null
        );
    }

    private static SkillEffectLifecycleRequest lifecycleRequestWithoutPeriodic() {
        return new SkillEffectLifecycleRequest(
            "duration_f", "max_stacks_f", "app_stacks_f",
            SkillEffectLifecycleInstanceScope.TARGET,
            SkillEffectLifecycleReapplicationStackMode.KEEP,
            null, SkillEffectLifecycleExpiryMode.ALL_AT_ONCE, null, null
        );
    }

    private static SkillEffectResultRequest damageResult() {
        return new SkillEffectResultRequest(
            "physical_hit", "物理伤害", SkillEffectResultType.DAMAGE, SkillEffectTarget.TARGET, null, 0,
            new SkillEffectValueRuleRequest("base_damage", java.math.BigDecimal.ONE, null, null),
            new xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail("physical"),
            null
        );
    }
}
