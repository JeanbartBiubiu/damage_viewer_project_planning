package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;
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
import xyz.game.datamanage.model.skilleffect.*;
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.ShieldAbsorptionTestData;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerShieldAbsorptionConditionServiceTest {
    @Mock GamesMapper games;
    @Mock SkillMapper skills;
    @Mock SkillTriggerRuleMapper mapper;
    private SkillTriggerRuleService service;
    private static final String PATH = "conditionGroups[0].conditions[0].detail.shieldResult";

    @BeforeEach
    void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        service = service(games, skills, mapper);
        when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(shield(SkillEffectTarget.SOURCE, SkillEffectResultType.NORMAL_SHIELD)));
        when(mapper.findLifecycleScope(GAME_ID, SKILL_KEY, "barrier")).thenReturn(SkillEffectLifecycleInstanceScope.SOURCE);
    }

    @Test
    void createReadAndUpdatePreserveCompleteSelectorInActualStoredConditionJson() {
        var request = request(SkillTriggerEventType.DAMAGE_TAKEN, condition(ShieldAbsorptionTestData.selector(SKILL_KEY)));
        request = AggregateJson.read(AggregateJson.write(request), SkillTriggerRuleCreateRequest.class);
        service.create(GAME_ID, SKILL_KEY, request);
        var read = service.get(GAME_ID, SKILL_KEY, "shield_read");
        var detail = (SkillTriggerEventValueConditionDetail) read.conditionGroups().getFirst().conditions().getFirst().detail();
        assertEquals(ShieldAbsorptionTestData.selector(SKILL_KEY), detail.shieldResult());
        assertTrue(mapper.findRule(GAME_ID, SKILL_KEY, "shield_read").conditionGroupsJson().contains("shieldResult"));
        service.update(GAME_ID, SKILL_KEY, "shield_read", updateFromCreate(request));
        assertEquals(read.conditionGroups(), service.get(GAME_ID, SKILL_KEY, "shield_read").conditionGroups());
    }

    @Test
    void omittedSelectorKeepsTotalAbsorptionForTakenAndDealtAndDoesNotAddNullKey() {
        for (var event : List.of(SkillTriggerEventType.DAMAGE_TAKEN, SkillTriggerEventType.DAMAGE_DEALT)) {
            var request = request(event, condition(null));
            var saved = service.create(GAME_ID, SKILL_KEY, request);
            var detail = saved.conditionGroups().getFirst().conditions().getFirst().detail();
            assertFalse(AggregateJson.tree(AggregateJson.write(detail)).has("shieldResult"));
            service.delete(GAME_ID, SKILL_KEY, "shield_read");
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{}", "[]", "{\"skillKey\":true,\"effectKey\":\"barrier\",\"resultKey\":\"shield\"}",
        "{\"skillKey\":\"ezreal_q\",\"effectKey\":\"barrier\",\"resultKey\":\"shield\",\"extra\":null}"})
    void invalidSelectorIsA400BeforeAnyCatalogOrStorageFallback(String json) {
        var error = thrown(() -> service.create(GAME_ID, SKILL_KEY,
            request(SkillTriggerEventType.DAMAGE_TAKEN, condition(AggregateJson.tree(json)))));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertTrue(error.getDetails().toString().contains(PATH), error.getDetails().toString());
        assertNull(mapper.findRule(GAME_ID, SKILL_KEY, "shield_read"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"DAMAGE_DEALT", "DAMAGE_PENDING", "BASIC_ATTACK_HIT"})
    void selectorDoesNotExpandEventCapabilities(String name) {
        var error = thrown(() -> service.create(GAME_ID, SKILL_KEY,
            request(SkillTriggerEventType.valueOf(name), condition(ShieldAbsorptionTestData.selector(SKILL_KEY)))));
        assertField(error, PATH, "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test
    void otherEventValueCannotCarrySelectorAndOtherSkillCannotBorrowThisShield() {
        var different = new SkillTriggerEventValueConditionDetail(SkillTriggerEventValueKey.ACTUAL_HP_LOSS,
            SkillTriggerComparator.GT, SkillNumericValue.fixed(BigDecimal.ZERO), ShieldAbsorptionTestData.selector(SKILL_KEY));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(SkillTriggerEventType.DAMAGE_TAKEN, different))),
            PATH, "EVENT_VALUE_NOT_AVAILABLE");
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(SkillTriggerEventType.DAMAGE_TAKEN,
            condition(ShieldAbsorptionTestData.selector("other_skill"))))), PATH + ".skillKey", "REFERENCE_TYPE_MISMATCH");
    }

    @ParameterizedTest
    @ValueSource(strings = {"target", "spell", "missing", "scope"})
    void catalogChecksActualResultTargetTypeExistenceAndLifecycleScope(String mutation) {
        if (mutation.equals("target")) when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(shield(SkillEffectTarget.TARGET, SkillEffectResultType.NORMAL_SHIELD)));
        if (mutation.equals("spell")) when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(shield(SkillEffectTarget.SOURCE, SkillEffectResultType.SPELL_SHIELD)));
        if (mutation.equals("missing")) when(mapper.listEffectShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of());
        if (mutation.equals("scope")) when(mapper.findLifecycleScope(GAME_ID, SKILL_KEY, "barrier")).thenReturn(SkillEffectLifecycleInstanceScope.TARGET);
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY,
            request(SkillTriggerEventType.DAMAGE_TAKEN, condition(ShieldAbsorptionTestData.selector(SKILL_KEY))))),
            PATH + ".resultKey", "REFERENCE_TYPE_MISMATCH");
    }

    private static SkillTriggerEventValueConditionDetail condition(com.fasterxml.jackson.databind.JsonNode selector) {
        return new SkillTriggerEventValueConditionDetail(SkillTriggerEventValueKey.SHIELD_ABSORBED,
            SkillTriggerComparator.GT, SkillNumericValue.fixed(BigDecimal.ZERO), selector);
    }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerEventType event, SkillTriggerEventValueConditionDetail condition) {
        SkillTriggerEventDetail detail = event == SkillTriggerEventType.BASIC_ATTACK_HIT ? new SkillTriggerEmptyEventDetail()
            : new SkillTriggerDamageEventDetail(null, null, SkillTriggerDamageDeliveryKind.ANY, SkillTriggerDamageOriginKind.ANY);
        return new SkillTriggerRuleCreateRequest("shield_read", "指定盾吸收", null, 0,
            new SkillTriggerEventSource(event, detail), List.of(new SkillTriggerConditionGroup("first", "首次", 0,
            List.of(new SkillTriggerCondition("absorbed", SkillTriggerConditionType.EVENT_VALUE_COMPARE, 0, condition)))),
            List.of(executeAction("grant", "barrier")), null, null, null);
    }

    private static SkillTriggerEffectShapeRow shield(SkillEffectTarget target, SkillEffectResultType type) {
        return new SkillTriggerEffectShapeRow("barrier", "shield", type, target, true,
            SkillNumericValue.fixed(BigDecimal.TEN), null, null, null, null, SkillEffectLifecycleMoment.PERSISTENT,
            null, null, true, null, SkillNumericValue.fixed(BigDecimal.ONE), SkillNumericValue.fixed(BigDecimal.ONE),
            null, SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY);
    }
}
