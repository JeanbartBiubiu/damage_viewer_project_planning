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
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCondition;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExplicitTargetIsSourceConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerExplicitTargetIsSourceConditionServiceTest {
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

    @Test
    void skillUsedConditionSurvivesParentRequestStorageAndExactReadBack() {
        SkillTriggerRuleCreateRequest input = request(
            new SkillTriggerExplicitTargetIsSourceConditionDetail(),
            SkillTriggerEventType.SKILL_USED
        );
        input = AggregateJson.read(AggregateJson.write(input), SkillTriggerRuleCreateRequest.class);

        var saved = service.create(GAME_ID, SKILL_KEY, input);
        var savedDetail = assertInstanceOf(
            SkillTriggerExplicitTargetIsSourceConditionDetail.class,
            saved.conditionGroups().getFirst().conditions().getFirst().detail()
        );
        assertEquals("{}", AggregateJson.write(savedDetail));

        var read = service.get(GAME_ID, SKILL_KEY, "self_cast");
        assertEquals(saved.conditionGroups(), read.conditionGroups());
        assertEquals("{}", AggregateJson.write(read.conditionGroups().getFirst().conditions().getFirst().detail()));
    }

    @ParameterizedTest
    @EnumSource(value = SkillTriggerEventType.class, names = {"SKILL_HIT", "BASIC_ATTACK_START"})
    void eventsOtherThanSkillUsedCannotUseExplicitSelfTarget(SkillTriggerEventType eventType) {
        ApiException error = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            request(new SkillTriggerExplicitTargetIsSourceConditionDetail(), eventType)
        ));
        assertEquals("400.INVALID_SKILL_TRIGGER_RULE_REFERENCE", error.getCode());
        assertField(error, PATH, "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test
    void nullDetailIsRejectedInsteadOfBecomingAnEmptyDetail() {
        var parent = requestJson();
        condition(parent).putNull("detail");
        SkillTriggerRuleCreateRequest input = AggregateJson.read(parent.toString(), SkillTriggerRuleCreateRequest.class);
        ApiException error = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            input
        ));
        assertEquals("400.VALIDATION_FAILED", error.getCode());
        assertField(error, PATH, "REQUIRED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"[]", "true", "0", "\"self\""})
    void nonObjectDetailIsRejectedByConditionDeserializer(String json) {
        var parent = requestJson();
        condition(parent).set("detail", AggregateJson.tree(json));
        assertThrows(
            IllegalStateException.class,
            () -> AggregateJson.read(parent.toString(), SkillTriggerRuleCreateRequest.class)
        );
    }

    @Test
    void unknownDetailFieldIsRejected() {
        var parent = requestJson();
        ((com.fasterxml.jackson.databind.node.ObjectNode) condition(parent).path("detail")).putNull("targetKey");
        SkillTriggerRuleCreateRequest input = AggregateJson.read(parent.toString(), SkillTriggerRuleCreateRequest.class);
        ApiException error = thrown(() -> service.create(
            GAME_ID,
            SKILL_KEY,
            input
        ));
        assertEquals("400.INVALID_BODY", error.getCode());
        assertField(error, PATH + ".targetKey", "UNKNOWN_FIELD");
    }

    private static com.fasterxml.jackson.databind.node.ObjectNode requestJson() {
        return (com.fasterxml.jackson.databind.node.ObjectNode) AggregateJson.tree(AggregateJson.write(request(
            new SkillTriggerExplicitTargetIsSourceConditionDetail(),
            SkillTriggerEventType.SKILL_USED
        )));
    }

    private static com.fasterxml.jackson.databind.node.ObjectNode condition(
        com.fasterxml.jackson.databind.node.ObjectNode parent
    ) {
        return (com.fasterxml.jackson.databind.node.ObjectNode) parent.path("conditionGroups")
            .get(0)
            .path("conditions")
            .get(0);
    }

    private static SkillTriggerRuleCreateRequest request(
        SkillTriggerConditionDetail detail,
        SkillTriggerEventType eventType
    ) {
        SkillTriggerEventDetail eventDetail = switch (eventType) {
            case SKILL_USED -> new SkillTriggerSkillEventDetail(null, SkillTriggerEventUseKind.ANY, xyz.game.datamanage.model.skilltrigger.SkillTriggerCastPhase.INITIAL);
            case SKILL_HIT -> new SkillTriggerSkillEventDetail(null, null);
            default -> new SkillTriggerEmptyEventDetail();
        };
        return new SkillTriggerRuleCreateRequest(
            "self_cast",
            "显式自施目标",
            null,
            0,
            new SkillTriggerEventSource(eventType, eventDetail),
            List.of(new SkillTriggerConditionGroup(
                "g",
                "条件",
                0,
                List.of(new SkillTriggerCondition(
                    "explicit_self",
                    SkillTriggerConditionType.EXPLICIT_TARGET_IS_SOURCE,
                    0,
                    detail
                ))
            )),
            List.of(executeAction("shield", EFFECT_KEY)),
            null,
            null
        );
    }
}
