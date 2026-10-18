package xyz.game.datamanage.service.skilltrigger;

import static org.junit.jupiter.api.Assertions.*;
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
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.support.authoring.AggregateJson;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SkillTriggerSceneAttributeSnapshotServiceTest {
    private static final String PATH = "actions[0].runtimeInputBindings[0]";
    @Mock private GamesMapper games;
    @Mock private SkillMapper skills;
    @Mock private SkillTriggerRuleMapper mapper;
    private SkillTriggerRuleService service;

    @BeforeEach void setUp() {
        stubParentAndCatalogs(games, skills, mapper);
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any()))
            .thenReturn(List.of(runtimeParam("snapshot_input", SkillParameterValueType.DECIMAL)));
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(process("ACTIVE")));
        service = service(games, skills, mapper);
    }

    @Test void savesAndReadsTheExactExplicitSourceSubsetForBothNumericParameterTypes() {
        for (var type : SkillParameterValueType.values()) {
            when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any()))
                .thenReturn(List.of(runtimeParam("snapshot_input", type)));
            var input = request(detail(), active());
            var saved = service.create(GAME_ID, SKILL_KEY, input);
            assertEquals(input.actions().getFirst().runtimeInputBindings(), saved.actions().getFirst().runtimeInputBindings());
            assertEquals(saved, service.get(GAME_ID, SKILL_KEY, "snapshot_rule"));
        }
    }

    @Test void missingDisabledOrNonNumericAttributesAreRejected() {
        when(mapper.lockAttributes(eq(GAME_ID), any())).thenReturn(List.of());
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail(), active()))), PATH + ".detail.attributeKey", "UNKNOWN_ATTRIBUTE");
        for (String status : List.of("DISABLED", "ENABLED")) {
            when(mapper.lockAttributes(eq(GAME_ID), any())).thenReturn(List.of(new SkillTriggerCatalogLockRow("authored_stat", status,
                "ENABLED".equals(status) ? "BOOLEAN" : "DECIMAL")));
            assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail(), active()))),
                PATH + ".detail.attributeKey", "ENABLED".equals(status) ? "REFERENCE_TYPE_MISMATCH" : "ATTRIBUTE_DISABLED");
        }
    }

    @Test void emptyAndDuplicateSourcesAreRejected() {
        for (var sources : List.of(List.<SkillTriggerSceneAttributeSource>of(),
                List.of(SkillTriggerSceneAttributeSource.CHARACTER_LEVEL, SkillTriggerSceneAttributeSource.CHARACTER_LEVEL))) {
            var detail = new SkillTriggerSceneAttributeSnapshotBindingDetail(SkillTriggerSceneAttributeSubject.SOURCE, "authored_stat", sources);
            assertThrows(xyz.game.datamanage.support.error.ApiException.class,
                () -> service.create(GAME_ID, SKILL_KEY, request(detail, active())));
        }
    }

    @ParameterizedTest @ValueSource(strings = {"sourceSkillKey", "value", "eventValueKey", "stateKey"})
    void foreignAndUnknownFieldsAreRejectedEvenWhenNull(String field) {
        var detail = AggregateJson.read("{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":[\"EQUIPMENT_DIRECT\"],\""
            + field + "\":null}", SkillTriggerSceneAttributeSnapshotBindingDetail.class);
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail, active()))), PATH + ".detail." + field, "UNKNOWN_FIELD");
    }

    @Test void entryMustIdentifyThisSkillAndAnExplicitInitialActiveUse() {
        for (var event : List.of(
                new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED, new SkillTriggerSkillEventDetail(null, SkillTriggerEventUseKind.ACTIVE, SkillTriggerCastPhase.INITIAL)),
                new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED, new SkillTriggerSkillEventDetail("other_skill", SkillTriggerEventUseKind.ACTIVE, SkillTriggerCastPhase.INITIAL)),
                new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED, new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ANY, SkillTriggerCastPhase.INITIAL)),
                new SkillTriggerEventSource(SkillTriggerEventType.BASIC_ATTACK_HIT, new SkillTriggerEmptyEventDetail()))) {
            assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail(), event))), PATH + ".sourceType", "EVENT_VALUE_NOT_AVAILABLE");
        }
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail(),
            new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED, new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE))))),
            "eventSource.detail.castPhase", "REQUIRED");
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(process("PASSIVE")));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail(), active()))), PATH + ".sourceType", "EVENT_VALUE_NOT_AVAILABLE");
    }

    @Test void unusedAndNonRuntimeParametersAreRejected() {
        when(mapper.listProcessShapes(GAME_ID, SKILL_KEY)).thenReturn(List.of(process("ACTIVE", "{\"kind\":\"FIXED\",\"value\":0}")));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail(), active()))), PATH + ".parameterKey", "BINDING_EXTRA");
        when(mapper.lockParameters(eq(GAME_ID), eq(SKILL_KEY), any())).thenReturn(List.of(
            new SkillTriggerParameterRefRow("snapshot_input", SkillParameterValueType.DECIMAL, "FIXED")));
        assertField(thrown(() -> service.create(GAME_ID, SKILL_KEY, request(detail(), active()))), PATH + ".parameterKey", "UNKNOWN_PARAMETER");
    }

    private static SkillTriggerSceneAttributeSnapshotBindingDetail detail() {
        return new SkillTriggerSceneAttributeSnapshotBindingDetail(SkillTriggerSceneAttributeSubject.TARGET, "authored_stat",
            List.of(SkillTriggerSceneAttributeSource.EQUIPMENT_DIRECT));
    }

    private static SkillTriggerEventSource active() {
        return new SkillTriggerEventSource(SkillTriggerEventType.SKILL_USED,
            new SkillTriggerSkillEventDetail(SKILL_KEY, SkillTriggerEventUseKind.ACTIVE, SkillTriggerCastPhase.INITIAL));
    }

    private static SkillTriggerProcessShapeRow process(String activation) {
        return process(activation, "{\"kind\":\"PARAMETER\",\"parameterKey\":\"snapshot_input\"}");
    }

    private static SkillTriggerProcessShapeRow process(String activation, String value) {
        return AggregateJson.read("{\"processKey\":\"cast\",\"activationType\":\"" + activation + "\",\"delayValue\":" + value + "}",
            SkillTriggerProcessShapeRow.class);
    }

    private static SkillTriggerRuleCreateRequest request(SkillTriggerSceneAttributeSnapshotBindingDetail detail, SkillTriggerEventSource event) {
        return rule("snapshot_rule", event, List.of(new SkillTriggerAction("start", "启动", SkillTriggerActionType.START_PROCESS, 0,
            SkillTriggerTargetContext.CURRENT_TARGET, new SkillTriggerStartProcessActionDetail(PROCESS_KEY), List.of(
                new SkillTriggerRuntimeInputBinding("snapshot", "snapshot_input", SkillTriggerRuntimeInputSourceType.SCENE_ATTRIBUTE_SNAPSHOT, detail)), List.of())));
    }
}
