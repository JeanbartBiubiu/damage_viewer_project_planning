package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

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
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerSourceCastResourceCostServiceTest {
    private static final String PATH = "actions[0].runtimeInputBindings[0]";
    @Mock private GamesMapper games;
    @Mock private SkillMapper skills;
    @Mock private SkillTriggerRuleMapper mapper;
    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any()))
            .thenReturn(List.of(runtimeParam("cost", SkillParameterValueType.DECIMAL)));
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any()))
            .thenReturn(List.of(runtimeParam("cost", SkillParameterValueType.DECIMAL)));
        service = service(games, skills, mapper);
    }

    @Test
    void completeParentRequestSavesAndReadsOnlyTheResourceAttribute() {
        SkillTriggerRuleCreateRequest input = AggregateJson.read(AggregateJson.write(request(
            binding(new SkillTriggerSourceCastResourceCostBindingDetail("mana")), hit("ezreal_e"))), SkillTriggerRuleCreateRequest.class);
        var saved = service.create(GAME_ID, SKILL_KEY, input);
        SkillTriggerRuntimeInputBinding actual = saved.actions().getFirst().runtimeInputBindings().getFirst();
        assertEquals(SkillTriggerRuntimeInputSourceType.SOURCE_CAST_RESOURCE_COST, actual.sourceType());
        assertEquals("mana", assertInstanceOf(SkillTriggerSourceCastResourceCostBindingDetail.class, actual.detail()).attributeKey());
        assertEquals("{\"attributeKey\":\"mana\"}", AggregateJson.write(actual.detail()));
        assertEquals(actual, service.get(GAME_ID, SKILL_KEY, "refund").actions().getFirst().runtimeInputBindings().getFirst());
    }

    @Test
    void missingAttributeAndUnknownCatalogEntryAreRejected() {
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(
            binding(new SkillTriggerSourceCastResourceCostBindingDetail(null)), hit("ezreal_e")))), PATH + ".detail.attributeKey", "REQUIRED");
        when(mapper.lockAttributes(eq(GAME_ID), any())).thenReturn(List.of());
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(
            binding(new SkillTriggerSourceCastResourceCostBindingDetail("missing")), hit("ezreal_e")))), PATH + ".detail.attributeKey", "UNKNOWN_ATTRIBUTE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"sourceSkillKey", "eventValueKey", "value"})
    void mixedFieldsSurviveParsingAndAreRejected(String field) {
        SkillTriggerSourceCastResourceCostBindingDetail detail = AggregateJson.read(
            "{\"attributeKey\":\"mana\",\"" + field + "\":null}", SkillTriggerSourceCastResourceCostBindingDetail.class);
        ApiException error = thrown(() -> service.create(GAME_ID, SKILL_KEY, request(binding(detail), hit("ezreal_e"))));
        assertEquals("400.INVALID_BODY", error.getCode());
        assertField(error, PATH + ".detail." + field, "UNKNOWN_FIELD");
    }

    @Test
    void bothSkillHitAndExplicitSourceSkillAreRequired() {
        SkillTriggerRuntimeInputBinding binding = binding(new SkillTriggerSourceCastResourceCostBindingDetail("mana"));
        for (SkillTriggerEventSource event : List.of(hit(null),
            new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()),
            new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED, new SkillTriggerSkillEventDetail("ezreal_e", SkillTriggerEventUseKind.ACTIVE, xyz.game.datamanage.model.skilltrigger.SkillTriggerCastPhase.INITIAL)))) {
            assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(binding, event))), PATH + ".sourceType", "EVENT_VALUE_NOT_AVAILABLE");
        }
    }

    @Test
    void processCompleteAndFailureOfCurrentNonPassiveProcessAreAllowed() {
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            processActivation(PROCESS_KEY, SkillProcessActivationType.ACTIVE)
        ));
        SkillTriggerRuntimeInputBinding binding = binding(new SkillTriggerSourceCastResourceCostBindingDetail("mana"));
        for (SkillProcessMomentType moment : List.of(
            SkillProcessMomentType.PROCESS_COMPLETE,
            SkillProcessMomentType.PROCESS_FAILURE
        )) {
            var saved = service.create(GAME_ID, SKILL_KEY, request(binding, processMoment(PROCESS_KEY, moment, null)));
            assertEquals("mana", assertInstanceOf(SkillTriggerSourceCastResourceCostBindingDetail.class,
                saved.actions().getFirst().runtimeInputBindings().getFirst().detail()).attributeKey());
        }
    }

    @Test
    void processStartCancelPassiveAndForeignProcessAreRejected() {
        SkillTriggerRuntimeInputBinding binding = binding(new SkillTriggerSourceCastResourceCostBindingDetail("mana"));
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            processActivation(PROCESS_KEY, SkillProcessActivationType.ACTIVE)
        ));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(binding, processStart(PROCESS_KEY)))),
            PATH + ".sourceType", "EVENT_VALUE_NOT_AVAILABLE");
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(binding,
            new SkillTriggerEventSource(SkillTriggerEventType.PROCESS_CANCEL_REQUESTED,
                new SkillTriggerCancelProcessEventDetail(PROCESS_KEY))))),
            PATH + ".sourceType", "EVENT_VALUE_NOT_AVAILABLE");

        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(
            processActivation(PROCESS_KEY, SkillProcessActivationType.PASSIVE)
        ));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(
            binding, processMoment(PROCESS_KEY, SkillProcessMomentType.PROCESS_COMPLETE, null)))),
            PATH + ".sourceType", "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test
    void integerOrUnreachableTargetIsRejected() {
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any()))
            .thenReturn(List.of(runtimeParam("cost", SkillParameterValueType.INTEGER)));
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any()))
            .thenReturn(List.of(runtimeParam("cost", SkillParameterValueType.INTEGER)));
        var input = request(binding(new SkillTriggerSourceCastResourceCostBindingDetail("mana")), hit("ezreal_e"));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, input)), PATH + ".parameterKey", "REFERENCE_TYPE_MISMATCH");
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of());
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, input)), PATH + ".parameterKey", "BINDING_EXTRA");
    }

    @Test
    void existingBindingKeyCannotChangeSourceType() {
        var original = request(binding(new SkillTriggerSourceCastResourceCostBindingDetail("mana")), hit("ezreal_e"));
        service.create(GAME_ID, SKILL_KEY, original);
        var replacement = new SkillTriggerRuntimeInputBinding("source_cost", "cost", SkillTriggerRuntimeInputSourceType.EVENT_VALUE,
            new SkillTriggerEventValueBindingDetail(SkillTriggerEventValueKey.HIT_INDEX));
        assertField(thrown(() -> service.update(GAME_ID, SKILL_KEY, "refund", updateFromCreate(request(replacement, hit("ezreal_e"))))),
            PATH + ".sourceType", "IMMUTABLE");
    }

    private static SkillTriggerRuntimeInputBinding binding(SkillTriggerSourceCastResourceCostBindingDetail detail) {
        return new SkillTriggerRuntimeInputBinding("source_cost", "cost", SkillTriggerRuntimeInputSourceType.SOURCE_CAST_RESOURCE_COST, detail);
    }

    private static SkillTriggerEventSource hit(String skill) {
        return new SkillTriggerEventSource(SkillTriggerEventType.SKILL_HIT, new SkillTriggerSkillEventDetail(skill, null));
    }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerRuntimeInputBinding binding, SkillTriggerEventSource event) {
        return rule("refund", event, List.of(new SkillTriggerAction("refund_cost", "返还资源", SkillTriggerActionType.EXECUTE_EFFECT, 0,
            SkillTriggerTargetContext.CURRENT_TARGET, new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY), List.of(binding), List.of())));
    }
}
