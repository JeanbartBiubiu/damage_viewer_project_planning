package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleTestSupport.*;

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
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerTargetCategoryConditionServiceTest {
    private static final String PATH = "conditionGroups[0].conditions[0].detail";
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
    @EnumSource(value = SkillTriggerEventType.class, names = {"SKILL_HIT", "BASIC_ATTACK_HIT", "KILL", "TAKEDOWN", "DAMAGE_PENDING", "DAMAGE_DEALT", "DAMAGE_TAKEN"})
    void allFiveOpponentCategoriesSurviveParentRequestStorageAndReadBack(SkillTriggerEventType event) {
        List<SkillTriggerTargetCategory> categories = List.of(SkillTriggerTargetCategory.STRUCTURE,
            SkillTriggerTargetCategory.CHAMPION, SkillTriggerTargetCategory.EPIC_MONSTER,
            SkillTriggerTargetCategory.MINION, SkillTriggerTargetCategory.NON_EPIC_MONSTER);
        SkillTriggerRuleCreateRequest input = request(new SkillTriggerTargetCategoryConditionDetail(categories), event);
        input = AggregateJson.read(AggregateJson.write(input), SkillTriggerRuleCreateRequest.class);
        var saved = service.create(GAME_ID, SKILL_KEY, input);
        assertEquals(categories, assertInstanceOf(SkillTriggerTargetCategoryConditionDetail.class,
            saved.conditionGroups().getFirst().conditions().getFirst().detail()).categories());
        var read = service.get(GAME_ID, SKILL_KEY, "targets");
        assertEquals(saved.conditionGroups(), read.conditionGroups());
        assertEquals("{\"categories\":[\"STRUCTURE\",\"CHAMPION\",\"EPIC_MONSTER\",\"MINION\",\"NON_EPIC_MONSTER\"]}",
            AggregateJson.write(read.conditionGroups().getFirst().conditions().getFirst().detail()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"categories\":null}", "{\"categories\":[]}"})
    void missingOrEmptyCategoryListIsRejected(String json) {
        SkillTriggerTargetCategoryConditionDetail detail = AggregateJson.read(json, SkillTriggerTargetCategoryConditionDetail.class);
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail, SkillTriggerEventType.SKILL_HIT))), PATH + ".categories", "REQUIRED");
    }

    @Test
    void duplicateCategoryIsRejectedWithoutSilentlyDeduplicating() {
        SkillTriggerTargetCategoryConditionDetail detail = AggregateJson.read("{\"categories\":[\"CHAMPION\",\"CHAMPION\"]}", SkillTriggerTargetCategoryConditionDetail.class);
        assertEquals(2, detail.categories().size());
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail, SkillTriggerEventType.SKILL_HIT))), PATH + ".categories[1]", "DUPLICATE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"[\"PET\"]", "[0]", "[true]", "[null]", "\"CHAMPION\"", "[\"champion\"]"})
    void unknownCategoriesOrdinalsAndScalarArraysAreRejectedDuringParentParsing(String categories) {
        String json = AggregateJson.write(request(validDetail(), SkillTriggerEventType.SKILL_HIT));
        var parent = (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree(json);
        var detail = (com.fasterxml.jackson.databind.node.ObjectNode) parent.path("conditionGroups").get(0).path("conditions").get(0).path("detail");
        detail.set("categories", AggregateJson.tree(categories));
        assertThrows(IllegalStateException.class, () -> AggregateJson.read(parent.toString(), SkillTriggerRuleCreateRequest.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"subject", "attributeKey", "comparisonValue", "unknownFields", "foreignFields"})
    void extraFieldsIncludingInternalCaptureNamesCannotBeHidden(String field) {
        SkillTriggerTargetCategoryConditionDetail detail = AggregateJson.read(
            "{\"categories\":[\"CHAMPION\"],\"" + field + "\":null}", SkillTriggerTargetCategoryConditionDetail.class);
        ApiException error = thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail, SkillTriggerEventType.SKILL_HIT)));
        assertEquals("400.INVALID_BODY", error.getCode());
        assertField(error, PATH + "." + field, "UNKNOWN_FIELD");
    }

    @ParameterizedTest
    @EnumSource(value = SkillTriggerEventType.class, names = {"SKILL_USED", "BASIC_ATTACK_START", "CONTROL_RECEIVED"})
    void unsupportedEventsCannotReadTargetCategories(SkillTriggerEventType event) {
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(validDetail(), event))),
            PATH + ".categories", "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test
    void changingEventCannotRetainAnInvalidCategoryCondition() {
        service.create(GAME_ID, SKILL_KEY, request(validDetail(), SkillTriggerEventType.SKILL_HIT));
        assertField(thrown(() -> service.update(GAME_ID, SKILL_KEY, "targets",
            updateFromCreate(request(validDetail(), SkillTriggerEventType.BASIC_ATTACK_START)))), PATH + ".categories", "EVENT_VALUE_NOT_AVAILABLE");
    }

    private static SkillTriggerTargetCategoryConditionDetail validDetail() {
        return new SkillTriggerTargetCategoryConditionDetail(List.of(SkillTriggerTargetCategory.CHAMPION));
    }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerTargetCategoryConditionDetail detail, SkillTriggerEventType event) {
        SkillTriggerEventDetail eventDetail = switch (event) {
            case SKILL_HIT -> new SkillTriggerSkillEventDetail(null, null);
            case SKILL_USED -> new SkillTriggerSkillEventDetail(null, SkillTriggerEventUseKind.ANY);
            case DAMAGE_PENDING, DAMAGE_DEALT, DAMAGE_TAKEN ->
                new SkillTriggerDamageEventDetail(null, SkillTriggerDamageDeliveryKind.ANY, SkillTriggerDamageOriginKind.ANY);
            default -> new SkillTriggerEmptyEventDetail();
        };
        return new SkillTriggerRuleCreateRequest("targets", "事件对方类别", null, 0,
            new SkillTriggerEventSource(event, eventDetail),
            List.of(new SkillTriggerConditionGroup("g", "条件", 0, List.of(
                new SkillTriggerCondition("target_category", SkillTriggerConditionType.TARGET_CATEGORY_CHECK, 0, detail)))),
            List.of(executeAction("deal", EFFECT_KEY)), null, null);
    }
}
