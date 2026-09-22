package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
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
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.AggregateJson;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerSkillHitShieldValueServiceTest {
    private static final SkillTriggerEventValueKey FLAG = SkillTriggerEventValueKey.SKILL_HIT_SPELL_SHIELD_BLOCKED;
    private static final String CONDITION_PATH = "conditionGroups[0].conditions[0].detail.eventValueKey";
    private static final String BINDING_PATH = "actions[0].runtimeInputBindings[0].detail.eventValueKey";
    @Mock private GamesMapper games;
    @Mock private SkillMapper skills;
    @Mock private SkillTriggerRuleMapper mapper;
    private SkillTriggerRuleService service;

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        service = service(games, skills, mapper);
    }

    @ParameterizedTest
    @EnumSource(SkillParameterValueType.class)
    void conditionsAndBindingsRoundTripAndIntegerSourceAcceptsBothNumericParameterTypes(SkillParameterValueType type) {
        runtime(type);
        var input = request(SkillTriggerEventType.SKILL_HIT, condition(), binding());
        input = AggregateJson.read(AggregateJson.write(input), SkillTriggerRuleCreateRequest.class);
        var saved = service.create(GAME_ID, SKILL_KEY, input);
        var read = service.get(GAME_ID, SKILL_KEY, "shield_hit");
        assertEquals(saved.conditionGroups(), read.conditionGroups());
        assertEquals(saved.actions(), read.actions());
        var comparison = (SkillTriggerEventValueConditionDetail) read.conditionGroups().getFirst().conditions().getFirst().detail();
        assertEquals(FLAG, comparison.eventValueKey());
        assertEquals(new BigDecimal("-0.5"), comparison.comparisonValue().value());
        assertEquals(FLAG, ((SkillTriggerEventValueBindingDetail) read.actions().getFirst().runtimeInputBindings().getFirst().detail()).eventValueKey());
    }

    @ParameterizedTest
    @EnumSource(value = SkillTriggerEventType.class, names = {"BASIC_ATTACK_HIT", "CONTROL_RECEIVED", "SKILL_USED"})
    void unsupportedEventsRejectConditionsAndBindingsWithTheirOwnPaths(SkillTriggerEventType event) {
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(event, condition(), null))), CONDITION_PATH, "EVENT_VALUE_NOT_AVAILABLE");
        runtime(SkillParameterValueType.INTEGER);
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(event, null, binding()))), BINDING_PATH, "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test
    void changingFromSkillHitCannotKeepTheShieldConditionOrBinding() {
        runtime(SkillParameterValueType.INTEGER);
        service.create(GAME_ID, SKILL_KEY, request(SkillTriggerEventType.SKILL_HIT, condition(), binding()));
        var changed = request(SkillTriggerEventType.BASIC_ATTACK_HIT, condition(), binding());
        var error = thrown(() -> service.update(GAME_ID, SKILL_KEY, "shield_hit", updateFromCreate(changed)));
        assertField(error, CONDITION_PATH, "EVENT_VALUE_NOT_AVAILABLE");
        assertField(error, BINDING_PATH, "EVENT_VALUE_NOT_AVAILABLE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"23", "true", "\"UNKNOWN_VALUE\""})
    void parentParsingRejectsEventValueOrdinalsAndUnknownKeys(String value) {
        var conditionRequest = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree(AggregateJson.write(
            request(SkillTriggerEventType.SKILL_HIT, condition(), null)));
        ((com.fasterxml.jackson.databind.node.ObjectNode) conditionRequest.path("conditionGroups").get(0).path("conditions").get(0).path("detail"))
            .set("eventValueKey", AggregateJson.tree(value));
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(conditionRequest.toString(), SkillTriggerRuleCreateRequest.class));
        var bindingRequest = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree(AggregateJson.write(
            request(SkillTriggerEventType.SKILL_HIT, null, binding())));
        ((com.fasterxml.jackson.databind.node.ObjectNode) bindingRequest.path("actions").get(0).path("runtimeInputBindings").get(0).path("detail"))
            .set("eventValueKey", AggregateJson.tree(value));
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(bindingRequest.toString(), SkillTriggerRuleCreateRequest.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"subject", "unknownFields", "foreignFields"})
    void eventValueDetailsDoNotHideExtraFields(String field) {
        String json = "{\"eventValueKey\":\"SKILL_HIT_SPELL_SHIELD_BLOCKED\",\"" + field + "\":null";
        var condition = AggregateJson.read(json + ",\"comparator\":\"EQ\",\"comparisonValue\":{\"kind\":\"FIXED\",\"value\":0}}",
            SkillTriggerEventValueConditionDetail.class);
        assertEquals("400.INVALID_BODY", thrown(() -> service.create(GAME_ID, SKILL_KEY,
            request(SkillTriggerEventType.SKILL_HIT, condition, null))).getCode());
        runtime(SkillParameterValueType.INTEGER);
        var binding = AggregateJson.read(json + "}", SkillTriggerEventValueBindingDetail.class);
        assertEquals("400.INVALID_BODY", thrown(() -> service.create(GAME_ID, SKILL_KEY,
            request(SkillTriggerEventType.SKILL_HIT, null, binding))).getCode());
    }

    @ParameterizedTest
    @EnumSource(SkillTriggerEventType.class)
    void newValueIsAvailableOnlyForSkillHit(SkillTriggerEventType event) {
        assertEquals(event == SkillTriggerEventType.SKILL_HIT,
            SkillTriggerEventCapabilities.eventValueAllowed(event, FLAG, null, null));
        assertEquals(SkillTriggerValueDomain.INTEGER, SkillTriggerEventCapabilities.valueDomain(FLAG));
    }

    private void runtime(SkillParameterValueType type) {
        when(mapper.listRuntimeInputParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(runtimeParam("shield_flag", type)));
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(runtimeParam("shield_flag", type)));
    }

    private static SkillTriggerEventValueConditionDetail condition() {
        return new SkillTriggerEventValueConditionDetail(FLAG, SkillTriggerComparator.GT, SkillNumericValue.fixed(new BigDecimal("-0.5")));
    }

    private static SkillTriggerEventValueBindingDetail binding() { return new SkillTriggerEventValueBindingDetail(FLAG); }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerEventType event,
            SkillTriggerEventValueConditionDetail condition, SkillTriggerEventValueBindingDetail binding) {
        SkillTriggerEventDetail detail = switch (event) {
            case SKILL_HIT -> new SkillTriggerSkillEventDetail(null, null);
            case SKILL_USED -> new SkillTriggerSkillEventDetail(null, SkillTriggerEventUseKind.ANY, xyz.game.datamanage.model.skilltrigger.SkillTriggerCastPhase.INITIAL);
            default -> new SkillTriggerEmptyEventDetail();
        };
        return new SkillTriggerRuleCreateRequest("shield_hit", "护盾命中", null, 0, new SkillTriggerEventSource(event, detail),
            condition == null ? List.of() : List.of(new SkillTriggerConditionGroup("g", "条件", 0, List.of(
                new SkillTriggerCondition("shield_condition", SkillTriggerConditionType.EVENT_VALUE_COMPARE, 0, condition)))),
            List.of(new SkillTriggerAction("deal", "执行效果", SkillTriggerActionType.EXECUTE_EFFECT, 0,
                SkillTriggerTargetContext.CURRENT_TARGET, new SkillTriggerExecuteEffectActionDetail(EFFECT_KEY),
                binding == null ? List.of() : List.of(new SkillTriggerRuntimeInputBinding("shield", "shield_flag", SkillTriggerRuntimeInputSourceType.EVENT_VALUE, binding)), List.of())),
            null, null);
    }
}
