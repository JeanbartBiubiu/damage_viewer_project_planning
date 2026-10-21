package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
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
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerSceneInitialParameterServiceTest {
    @Mock GamesMapper games;
    @Mock SkillMapper skills;
    @Mock SkillTriggerRuleMapper mapper;
    SkillTriggerRuleService service;

    @BeforeEach void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any()))
            .thenReturn(List.of(runtimeParam("initial_count", SkillParameterValueType.INTEGER)));
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(AggregateJson.read("""
            {"effectKey":"burst","resultKey":"flat","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE",
             "hasValueRule":true,"value":{"kind":"PARAMETER","parameterKey":"initial_count"},
             "resultAttributeKey":"hp","attributeOperation":"INCREASE","resultMoment":"PERSISTENT","hasLifecycle":true,
             "maxStacksValue":{"kind":"FIXED","value":1},"applicationStacksValue":{"kind":"FIXED","value":1},"expiryMode":"EXPLICIT_ONLY"}
            """, SkillTriggerEffectShapeRow.class)));
        service = service(games, skills, mapper);
    }

    @Test void saveAndIndependentReadPreserveExplicitRangeWithoutAValue() {
        var input = request(new SkillTriggerSceneInitialParameterBindingDetail(BigDecimal.ZERO, new BigDecimal("150")),
            new SkillTriggerEventSource(SkillTriggerEventType.SOURCE_INITIALIZED, new SkillTriggerEmptyEventDetail()), SkillTriggerTargetContext.EVENT_SOURCE);
        var saved = service.create(GAME_ID, SKILL_KEY, input);
        assertEquals(input.actions().getFirst().runtimeInputBindings(), saved.actions().getFirst().runtimeInputBindings());
        assertEquals(saved, service.get(GAME_ID, SKILL_KEY, "initial_rule"));
    }

    @Test void sharedInputKeySurvivesSaveAndIndependentRead() {
        var input = request(new SkillTriggerSceneInitialParameterBindingDetail(BigDecimal.ZERO, new BigDecimal("150"), "feast_stacks"),
            new SkillTriggerEventSource(SkillTriggerEventType.SOURCE_INITIALIZED, new SkillTriggerEmptyEventDetail()), SkillTriggerTargetContext.EVENT_SOURCE);
        var saved = service.create(GAME_ID, SKILL_KEY, input);
        var binding = saved.actions().getFirst().runtimeInputBindings().getFirst();
        assertEquals("feast_stacks", ((SkillTriggerSceneInitialParameterBindingDetail) binding.detail()).sharedInputKey());
        assertEquals(saved, service.get(GAME_ID, SKILL_KEY, "initial_rule"));
    }

    @Test void explicitInitialActiveProcessRetainsItsSharedPayloadDeclaration() {
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(AggregateJson.read("""
            {"effectKey":"burst","resultKey":"spike","resultType":"DAMAGE","target":"TARGET",
             "hasValueRule":true,"value":{"kind":"PARAMETER","parameterKey":"initial_count"},"hasLifecycle":false}
            """, SkillTriggerEffectShapeRow.class)));
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(AggregateJson.read(
            "{\"processKey\":\"cast\",\"activationType\":\"ACTIVE\",\"bindingEffectKey\":\"burst\"}", SkillTriggerProcessShapeRow.class)));
        var input = rule("shared_payload", new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED,
            new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE, SkillTriggerCastPhase.INITIAL)), List.of(
                new SkillTriggerAction("start", "启动", SkillTriggerActionType.START_PROCESS, 0, SkillTriggerTargetContext.CURRENT_TARGET,
                    new SkillTriggerStartProcessActionDetail(PROCESS_KEY), List.of(new SkillTriggerRuntimeInputBinding("initial", "initial_count",
                        SkillTriggerRuntimeInputSourceType.SCENE_INITIAL_PARAMETER,
                        new SkillTriggerSceneInitialParameterBindingDetail(BigDecimal.ZERO, new BigDecimal("150"), "feast_stacks"))), List.of())));
        var saved = service.create(GAME_ID, SKILL_KEY, input);
        assertEquals(input.actions().getFirst().runtimeInputBindings(), saved.actions().getFirst().runtimeInputBindings());
        assertEquals(saved, service.get(GAME_ID, SKILL_KEY, "shared_payload"));
    }

    @ParameterizedTest @ValueSource(strings = {"value", "defaultValue", "subject", "stateKey"})
    void extraFieldsAreRejectedEvenWhenNull(String field) {
        var detail = AggregateJson.read("{\"minValue\":0,\"maxValue\":150,\"" + field + "\":null}", SkillTriggerSceneInitialParameterBindingDetail.class);
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            request(detail, new SkillTriggerEventSource(SkillTriggerEventType.SOURCE_INITIALIZED, new SkillTriggerEmptyEventDetail()), SkillTriggerTargetContext.EVENT_SOURCE)));
    }

    @Test void wrongEventTargetAndFractionalIntegerBoundsAreRejected() {
        var detail = new SkillTriggerSceneInitialParameterBindingDetail(BigDecimal.ZERO, new BigDecimal("150"));
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            request(detail, new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()), SkillTriggerTargetContext.EVENT_SOURCE)));
        var initial = new SkillTriggerEventSource(SkillTriggerEventType.SOURCE_INITIALIZED, new SkillTriggerEmptyEventDetail());
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY, request(detail, initial, SkillTriggerTargetContext.CURRENT_TARGET)));
        assertThrows(ApiException.class, () -> service.create(GAME_ID, SKILL_KEY,
            request(new SkillTriggerSceneInitialParameterBindingDetail(new BigDecimal("0.5"), BigDecimal.TEN), initial, SkillTriggerTargetContext.EVENT_SOURCE)));
    }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerSceneInitialParameterBindingDetail detail,
        SkillTriggerEventSource event, SkillTriggerTargetContext target) {
        return rule("initial_rule", event, List.of(new SkillTriggerAction("apply", "初始化", SkillTriggerActionType.EXECUTE_EFFECT, 0,
            target, new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY), List.of(new SkillTriggerRuntimeInputBinding("initial", "initial_count",
            SkillTriggerRuntimeInputSourceType.SCENE_INITIAL_PARAMETER, detail)), List.of())));
    }
}
