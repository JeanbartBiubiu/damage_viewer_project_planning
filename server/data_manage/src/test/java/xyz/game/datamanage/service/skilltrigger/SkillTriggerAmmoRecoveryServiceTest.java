package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerAmmoRecoveryServiceTest {
    @Mock GamesMapper games;
    @Mock SkillMapper skills;
    @Mock SkillTriggerRuleMapper mapper;
    SkillTriggerRuleService service;

    @BeforeEach void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(new SkillTriggerInternalStateLockRow("ammo", SkillInternalStateType.AMMO, "SKILL")));
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(runtimeParam("refund_ms", SkillParameterValueType.DECIMAL)));
        service = service(games, skills, mapper);
    }

    @Test void savedActionIsReadBackWithTheSameStaticNumericReferenceAndNoBinding() {
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
            .thenReturn(List.of(new SkillTriggerParameterRefRow("refund_ms", SkillParameterValueType.DECIMAL, "FIXED")));
        var request = request(SkillTriggerEventType.BASIC_ATTACK_HIT, SkillTriggerTargetContext.EVENT_SOURCE,
            new SkillTriggerModifyInternalStateActionDetail(SKILL_KEY, "ammo", SkillTriggerInternalStateOperation.REDUCE_RECOVERY,
                SkillNumericValue.parameter("refund_ms")), false);
        var saved = create(request);
        assertEquals(request.actions(), saved.actions());
        assertEquals(saved, service.get(GAME_ID, SKILL_KEY, "refund_rule"));
        assertEquals(request.actions().getFirst(), AggregateJson.read(AggregateJson.write(saved.actions().getFirst()), SkillTriggerAction.class));
    }

    @Test void aStaticZeroRefundDoesNotRequireAnyInputOrCreateAnArtificialEventCycle() {
        var request = request(SkillTriggerEventType.BASIC_ATTACK_HIT, SkillTriggerTargetContext.EVENT_SOURCE,
            new SkillTriggerModifyInternalStateActionDetail(SKILL_KEY, "ammo", SkillTriggerInternalStateOperation.REDUCE_RECOVERY,
                SkillNumericValue.fixed(BigDecimal.ZERO)), false);
        assertDoesNotThrow(() -> create(request));
        when(mapper.listActionsForSkill(GAME_ID, SKILL_KEY)).thenReturn(List.of(new SkillTriggerActionRow(GAME_ID, SKILL_KEY, "refund_rule", "refund", "减时",
            SkillTriggerActionType.MODIFY_INTERNAL_STATE, 0, SkillTriggerTargetContext.EVENT_SOURCE)));
        assertDoesNotThrow(() -> new SkillTriggerCycleValidator(mapper).validateCurrentSkill(GAME_ID, SKILL_KEY));
    }

    @Test void ownAmmoExceptionDoesNotAuthorizeOldEffectActionsForBasicAttackHitEventSource() {
        var oldAction = new SkillTriggerAction("effect", "效果", SkillTriggerActionType.EXECUTE_EFFECT, 0,
            SkillTriggerTargetContext.EVENT_SOURCE, new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY), List.of(), List.of());
        var failure = assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            rule("old_effect", new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()), List.of(oldAction))));
        assertField(failure, "actions[0].targetContext", "EVENT_SOURCE_NOT_AVAILABLE");
        assertFalse(SkillTriggerEventCapabilities.hasEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT));
    }

    @ParameterizedTest @ValueSource(strings = {"EVENT", "RECEIVED_EVENT", "TARGET", "FOREIGN_STATE", "COUNTER", "TARGET_STATE", "NEGATIVE", "RUNTIME_VALUE", "EXTRA_BINDING", "NULL_OPERATION", "MODIFIER", "OTHER_BINDING"})
    void rejectsUnsupportedShapeOwnershipAndInputsBeforeWriting(String change) {
        var detail = new SkillTriggerModifyInternalStateActionDetail(SKILL_KEY, "ammo", SkillTriggerInternalStateOperation.REDUCE_RECOVERY,
            SkillNumericValue.fixed(BigDecimal.ZERO));
        var event = SkillTriggerEventType.BASIC_ATTACK_HIT;
        var target = SkillTriggerTargetContext.EVENT_SOURCE;
        boolean bound = false;
        switch (change) {
            case "EVENT" -> event = SkillTriggerEventType.BASIC_ATTACK_START;
            case "RECEIVED_EVENT" -> event = SkillTriggerEventType.BASIC_ATTACK_RECEIVED;
            case "TARGET" -> target = SkillTriggerTargetContext.CURRENT_TARGET;
            case "FOREIGN_STATE" -> detail = new SkillTriggerModifyInternalStateActionDetail("other", "ammo", SkillTriggerInternalStateOperation.REDUCE_RECOVERY, detail.value());
            case "COUNTER" -> when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
                .thenReturn(List.of(new SkillTriggerInternalStateLockRow("ammo", SkillInternalStateType.COUNTER, "SKILL")));
            case "TARGET_STATE" -> when(mapper.lockInternalStates(eq(GAME_ID), eq(SKILL_KEY), anyCollection()))
                .thenReturn(List.of(new SkillTriggerInternalStateLockRow("ammo", SkillInternalStateType.AMMO, "TARGET")));
            case "NEGATIVE" -> { detail = new SkillTriggerModifyInternalStateActionDetail(SKILL_KEY, "ammo", SkillTriggerInternalStateOperation.REDUCE_RECOVERY, SkillNumericValue.fixed(BigDecimal.ONE.negate())); bound = false; }
            case "RUNTIME_VALUE" -> detail = new SkillTriggerModifyInternalStateActionDetail(SKILL_KEY, "ammo", SkillTriggerInternalStateOperation.REDUCE_RECOVERY, SkillNumericValue.parameter("refund_ms"));
            case "EXTRA_BINDING", "OTHER_BINDING" -> bound = true;
            case "NULL_OPERATION" -> detail = new SkillTriggerModifyInternalStateActionDetail(SKILL_KEY, "ammo", null, detail.value());
            default -> { }
        }
        var input = request(event, target, detail, bound);
        if (change.equals("MODIFIER") || change.equals("OTHER_BINDING")) {
            var tree = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree(AggregateJson.write(input));
            var action = (com.fasterxml.jackson.databind.node.ObjectNode) tree.path("actions").get(0);
            if (change.equals("MODIFIER")) action.withArray("resultModifiers").addObject().put("resultKey", "damage").put("fixedMultiplier", 1);
            else ((com.fasterxml.jackson.databind.node.ObjectNode) action.path("runtimeInputBindings").get(0)).put("sourceType", "COMBAT_ELAPSED_TIME").set("detail", AggregateJson.tree("{\"subject\":\"SOURCE\"}"));
            input = AggregateJson.read(tree.toString(), SkillTriggerRuleCreateRequest.class);
        }
        var finalInput = input;
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY, finalInput));
        verify(mapper, never()).insertRule(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @ParameterizedTest @ValueSource(strings = {"processKey", "effectKey", "defaultValue", "durationValue"})
    void newActionDoesNotDiscardUnknownFieldsIncludingExplicitNull(String field) {
        var detail = AggregateJson.read("{\"stateSkillKey\":\"" + SKILL_KEY + "\",\"stateKey\":\"ammo\",\"operation\":\"REDUCE_RECOVERY\",\"value\":{\"kind\":\"FIXED\",\"value\":0},\"" + field + "\":null}", SkillTriggerModifyInternalStateActionDetail.class);
        assertTrue(detail.unknownFields().contains(field));
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            request(SkillTriggerEventType.BASIC_ATTACK_HIT, SkillTriggerTargetContext.EVENT_SOURCE, detail, false)));
    }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerEventType event, SkillTriggerTargetContext target,
        SkillTriggerModifyInternalStateActionDetail detail, boolean bound) {
        return rule("refund_rule", new SkillTriggerEventSource(event, new SkillTriggerEmptyEventDetail()), List.of(
            new SkillTriggerAction("refund", "减少下一枚回充", SkillTriggerActionType.MODIFY_INTERNAL_STATE, 0, target, detail,
                bound ? List.of(new SkillTriggerRuntimeInputBinding("refund", "refund_ms", SkillTriggerRuntimeInputSourceType.SCENE_INITIAL_PARAMETER,
                    new SkillTriggerSceneInitialParameterBindingDetail(BigDecimal.ZERO, new BigDecimal("20000")))) : List.of(), List.of())));
    }

    private SkillTriggerRuleDetailResponse create(SkillTriggerRuleCreateRequest request) {
        try { return service.create(GAME_ID, SKILL_KEY, request); }
        catch (ApiException failure) { throw new AssertionError(failure.getDetails().toString(), failure); }
    }
}
