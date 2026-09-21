package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

import java.lang.reflect.Method;
import java.util.Collection;
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
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerLifecycleOnlyEffectServiceTest {
    @Mock private GamesMapper gamesMapper;
    @Mock private SkillMapper skillMapper;
    @Mock private SkillTriggerRuleMapper mapper;
    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(gamesMapper, skillMapper, mapper);
        service = service(gamesMapper, skillMapper, mapper);
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(lifecycleOnly(EFFECT_KEY, true)));
    }

    @Test
    void lifecycleOnlySelfCyclesRetainApplicationFullStacksAndNaturalEndEdges() {
        for (SkillTriggerLifecycleEventMoment moment : List.of(SkillTriggerLifecycleEventMoment.APPLICATION,
            SkillTriggerLifecycleEventMoment.FULL_STACKS, SkillTriggerLifecycleEventMoment.NATURAL_END)) {
            stubLifecycleLoop(moment);
            assertCode("400.TRIGGER_RULE_CYCLE_UNGUARDED", () -> service.create(GAME_ID, SKILL_KEY,
                rule("loop", lifecycleEvent(EFFECT_KEY, moment), List.of(executeAction("apply", EFFECT_KEY)))));
        }
    }

    @Test
    void lifecycleOnlyCanTriggerAnotherEffectWithoutAReverseEdge() {
        stubLifecycleLoop(SkillTriggerLifecycleEventMoment.NATURAL_END);
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            lifecycleOnly(EFFECT_KEY, true), lifecycleOnly("other", true)));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            effectActionRow("loop", "apply", "other")));
        var created = service.create(GAME_ID, SKILL_KEY,
            rule("loop", lifecycleEvent(EFFECT_KEY, SkillTriggerLifecycleEventMoment.NATURAL_END),
                List.of(executeAction("apply", "other"))));
        assertEquals("other", ((SkillTriggerExecuteEffectActionDetail) created.actions().get(0).detail()).effectKey());
    }

    @Test
    void lifecycleOnlyHasNeitherResultAvailableNorDamageEdges() {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            ruleRow("result", "result", SkillTriggerEventType.RESULT_AVAILABLE),
            ruleRow("damage", "damage", SkillTriggerEventType.DAMAGE_DEALT)));
        when(mapper.listResultEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerResultEventRow(GAME_ID, SKILL_KEY, "result", EFFECT_KEY, null)));
        when(mapper.listDamageEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerDamageEventRow(GAME_ID, SKILL_KEY, "damage", null,
                SkillTriggerDamageDeliveryKind.ANY, SkillTriggerDamageOriginKind.ANY)));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            executeActionRow("result", "apply"), executeActionRow("damage", "apply")));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            effectActionRow("result", "apply", EFFECT_KEY), effectActionRow("damage", "apply", EFFECT_KEY)));
        assertDoesNotThrow(() -> new SkillTriggerCycleValidator(mapper).validateCurrentSkill(GAME_ID, SKILL_KEY));
    }

    @Test
    void indefiniteLifecycleHasApplicationAndFullStacksButRejectsNaturalEndAndPeriodicEvents() {
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(lifecycleOnly(EFFECT_KEY, false)));
        for (SkillTriggerLifecycleEventMoment moment : List.of(
            SkillTriggerLifecycleEventMoment.APPLICATION, SkillTriggerLifecycleEventMoment.FULL_STACKS)) {
            stubLifecycleLoop(moment);
            assertCode("400.TRIGGER_RULE_CYCLE_UNGUARDED", () -> service.create(GAME_ID, SKILL_KEY,
                rule("loop", lifecycleEvent(EFFECT_KEY, moment), List.of(executeAction("apply", EFFECT_KEY)))));
        }
        for (SkillTriggerLifecycleEventMoment moment : List.of(
            SkillTriggerLifecycleEventMoment.NATURAL_END, SkillTriggerLifecycleEventMoment.PERIODIC)) {
            ApiException ex = thrown(() -> service.create(GAME_ID, SKILL_KEY,
                rule("invalid", lifecycleEvent(EFFECT_KEY, moment), List.of(executeAction("apply", EFFECT_KEY)))));
            assertField(ex, "eventSource.detail.moment", "REFERENCE_TYPE_MISMATCH");
        }
    }

    @Test
    void nullResultKeysCannotMatchMetadataAndMetadataOffersNoPriorOutputs() throws Exception {
        Method find = SkillTriggerRuleService.class.getDeclaredMethod("findResult", Map.class, String.class, String.class);
        find.setAccessible(true);
        var metadata = lifecycleOnly(EFFECT_KEY, true);
        Map<String, List<SkillTriggerEffectShapeRow>> catalog = Map.of(EFFECT_KEY, List.of(metadata));
        assertNull(find.invoke(null, catalog, EFFECT_KEY, null));
        assertNull(find.invoke(null, catalog, EFFECT_KEY, RESULT_KEY));
        var shape = SkillTriggerPriorResultOutputs.Shape.from(metadata);
        assertFalse(SkillTriggerPriorResultOutputs.immediatelyAvailable(shape));
        assertTrue(SkillTriggerPriorResultOutputs.available(shape).isEmpty());
        ApiException unknown = thrown(() -> service.create(GAME_ID, SKILL_KEY,
            rule("unknown", resultAvailable(EFFECT_KEY, RESULT_KEY), List.of(executeAction("apply", EFFECT_KEY)))));
        assertField(unknown, "eventSource.detail.resultKey", "UNKNOWN_RESULT");
        ApiException missing = thrown(() -> service.create(GAME_ID, SKILL_KEY,
            rule("missing", resultAvailable(EFFECT_KEY, null), List.of(executeAction("apply", EFFECT_KEY)))));
        assertField(missing, "eventSource.detail.resultKey", "REQUIRED");
    }

    @Test
    void lifecycleOnlyStillCollectsItsFormulaInputsAndRejectsFabricatedPriorResult() {
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            lifecycleOnly(EFFECT_KEY, true), damageShape("follow_up", RESULT_KEY, "follow_damage")));
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            runtimeParam("ratio", SkillParameterValueType.DECIMAL)));
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenAnswer(invocation -> {
            Collection<String> keys = invocation.getArgument(2);
            if (keys.contains("duration_f")) {
                assertTrue(keys.containsAll(List.of("duration_f", "max_f", "apply_f")));
            }
            return keys.contains("follow_damage") ? List.of(runtimeParam("ratio", SkillParameterValueType.DECIMAL)) : List.of();
        });
        service.create(GAME_ID, SKILL_KEY,
            emptyEventExecute("apply_only", SkillTriggerEventType.BASIC_ATTACK_HIT, "apply", EFFECT_KEY));
        SkillTriggerAction follow = new SkillTriggerAction("follow", "后续", SkillTriggerActionType.EXECUTE_EFFECT,
            20, SkillTriggerTargetContext.CURRENT_TARGET, new SkillTriggerExecuteEffectActionDetail("follow_up"),
            List.of(new SkillTriggerRuntimeInputBinding("prior", "ratio", SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
                new SkillTriggerPriorResultBindingDetail("apply", RESULT_KEY, SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE))),
            List.of());
        ApiException ex = thrown(() -> service.create(GAME_ID, SKILL_KEY,
            rule("prior", new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
                List.of(executeAction("apply", EFFECT_KEY), follow))));
        assertField(ex, "actions[1].runtimeInputBindings[0].detail.sourceResultKey", "UNKNOWN_RESULT");
    }

    private void stubLifecycleLoop(SkillTriggerLifecycleEventMoment moment) {
        when(mapper.listRules(GAME_ID, SKILL_KEY)).thenReturn(List.of(ruleRow("loop", "loop", SkillTriggerEventType.LIFECYCLE_MOMENT)));
        when(mapper.listLifecycleEventsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            new SkillTriggerLifecycleEventRow(GAME_ID, SKILL_KEY, "loop", EFFECT_KEY, moment)));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(executeActionRow("loop", "apply")));
        when(mapper.listEffectActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(effectActionRow("loop", "apply", EFFECT_KEY)));
    }

    private static SkillTriggerEventSource lifecycleEvent(String effectKey, SkillTriggerLifecycleEventMoment moment) {
        return new SkillTriggerEventSource(SkillTriggerEventType.LIFECYCLE_MOMENT,
            new SkillTriggerLifecycleEventDetail(effectKey, moment));
    }

    private static SkillTriggerEffectShapeRow lifecycleOnly(String effectKey, boolean timed) {
        return new SkillTriggerEffectShapeRow(effectKey, null, null, null, false, null,
            null, null, null, null, null, null, null, true,
            timed ? SkillNumericValue.formula("duration_f") : null,
            SkillNumericValue.formula("max_f"), SkillNumericValue.formula("apply_f"), null,
            timed ? SkillEffectLifecycleExpiryMode.ALL_AT_ONCE : SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY);
    }
}
