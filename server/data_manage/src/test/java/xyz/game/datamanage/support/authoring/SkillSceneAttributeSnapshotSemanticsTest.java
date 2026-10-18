package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class SkillSceneAttributeSnapshotSemanticsTest {
    static final String SKILL = "authored_skill";
    static final String DETAIL = """
        {"subject":"SOURCE","attributeKey":"authored_stat","sources":["CHARACTER_LEVEL","EQUIPMENT_DIRECT"]}
        """;
    static final SkillNumericSemantics.Parameter INPUT = parameter("DECIMAL", "RUNTIME_INPUT");

    @ParameterizedTest
    @ValueSource(strings = {"[\"CHARACTER_LEVEL\"]", "[\"EQUIPMENT_DIRECT\"]", "[\"EQUIPMENT_DIRECT\",\"CHARACTER_LEVEL\"]"})
    void explicitSubsetsAndFixedSlotsAcceptNumericParametersWithoutGuessingTheirSceneValue(String sources) {
        for (String subject : List.of("SOURCE", "TARGET")) for (String type : List.of("INTEGER", "DECIMAL")) {
            String detail = "{\"subject\":\"" + subject + "\",\"attributeKey\":\"authored_stat\",\"sources\":" + sources + "}";
            assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects(detail), List.of(parameter(type, "RUNTIME_INPUT"))));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "{}", "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":[]}",
        "{\"subject\":\"CURRENT_TARGET\",\"attributeKey\":\"authored_stat\",\"sources\":[\"CHARACTER_LEVEL\"]}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":17,\"sources\":[\"CHARACTER_LEVEL\"]}",
        "{\"subject\":0,\"attributeKey\":\"authored_stat\",\"sources\":[\"CHARACTER_LEVEL\"]}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":\"CHARACTER_LEVEL\"}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":[null]}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":[\"CHARACTER_LEVEL\",\"CHARACTER_LEVEL\"]}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":[\"CURRENT_ATTRIBUTE\"]}",
        "{\"subject\":\"SOURCE\",\"attributeKey\":\"authored_stat\",\"sources\":[\"CHARACTER_LEVEL\"],\"value\":null}"
    })
    void finalBindingRejectsMissingMixedAndInvalidSourceDetails(String detail) {
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects(detail), List.of(INPUT)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"EVENT", "FOREIGN", "MISSING_SOURCE", "ANY", "MISSING_PHASE", "RECAST", "ACTION", "PASSIVE", "NO_PROCESS"})
    void finalChangesCannotRetainAFalseActiveEntry(String change) {
        var objects = objects(DETAIL);
        ObjectNode process = (ObjectNode) objects.getFirst().data();
        ObjectNode rule = (ObjectNode) objects.get(1).data();
        ObjectNode event = (ObjectNode) rule.path("eventSource");
        ObjectNode eventDetail = (ObjectNode) event.path("detail");
        switch (change) {
            case "EVENT" -> event.put("eventType", "SKILL_HIT");
            case "FOREIGN" -> eventDetail.put("sourceSkillKey", "foreign_skill");
            case "MISSING_SOURCE" -> eventDetail.remove("sourceSkillKey");
            case "ANY" -> eventDetail.put("useKind", "ANY");
            case "MISSING_PHASE" -> eventDetail.remove("castPhase");
            case "RECAST" -> eventDetail.put("castPhase", "RECAST");
            case "ACTION" -> ((ObjectNode) rule.path("actions").get(0)).put("actionType", "EXECUTE_EFFECT");
            case "PASSIVE" -> process.put("activationType", "PASSIVE");
            case "NO_PROCESS" -> objects = List.of(objects.get(1));
        }
        var finalObjects = objects;
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(finalObjects, List.of(INPUT)));
    }

    @Test
    void parameterMustRemainRuntimeAndActuallyConsumedByTheStartedProcess() {
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects(DETAIL), List.of()));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects(DETAIL), List.of(parameter("DECIMAL", "FIXED"))));
        var objects = objects(DETAIL);
        ((ObjectNode) objects.getFirst().data().path("steps").get(0).path("detail"))
            .set("delayValue", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":0}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, List.of(INPUT)));
    }

    @Test
    void referenceIndexIncludesTheAttributeAndRejectsItsRemoval() {
        var objects = objects(DETAIL);
        Set<Target> catalog = Set.of(new Target(TargetType.SKILL, "", SKILL, ""),
            new Target(TargetType.PARAMETER, SKILL, "snapshot_input", ""),
            new Target(TargetType.ATTRIBUTE, "", "authored_stat", ""));
        var refs = SkillObjectReferences.extractAndValidate("game", objects, catalog);
        assertTrue(refs.stream().anyMatch(ref -> ref.fieldPath().equals("actions[0].runtimeInputBindings[0].detail.attributeKey")
            && ref.target().type() == TargetType.ATTRIBUTE && ref.target().key().equals("authored_stat")));
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("game", objects,
            catalog.stream().filter(target -> target.type() != TargetType.ATTRIBUTE).collect(java.util.stream.Collectors.toSet())));
    }

    @Test
    void finalAttributeMustRemainEnabledAndNumeric() {
        var objects = objects(DETAIL);
        for (var invalid : List.of(new SkillSceneAttributeSnapshotSemantics.Attribute("DISABLED", "DECIMAL"),
                new SkillSceneAttributeSnapshotSemantics.Attribute("ENABLED", "BOOLEAN"))) {
            assertThrows(ApiException.class, () -> SkillSceneAttributeSnapshotSemantics.validateAttributes(objects, Map.of("authored_stat", invalid)));
        }
        assertThrows(ApiException.class, () -> SkillSceneAttributeSnapshotSemantics.validateAttributes(objects, Map.of()));
        assertDoesNotThrow(() -> SkillSceneAttributeSnapshotSemantics.validateAttributes(objects,
            Map.of("authored_stat", new SkillSceneAttributeSnapshotSemantics.Attribute("ENABLED", "DECIMAL"))));
    }

    static SkillNumericSemantics.Parameter parameter(String type, String mode) {
        return new SkillNumericSemantics.Parameter(SKILL, "snapshot_input", type, mode, null, AggregateJson.tree("{}"));
    }

    static List<Aggregate> objects(String detail) {
        return List.of(
            new Aggregate(SourceType.PROCESS, SKILL, "authored_process", AggregateJson.tree("""
                {"activationType":"ACTIVE","steps":[{"stepKey":"wait","stepType":"DELAY",
                 "detail":{"delayValue":{"kind":"PARAMETER","parameterKey":"snapshot_input"}}}],
                 "cooldown":null,"effectBindings":[],"stateOperations":[]}
                """)),
            new Aggregate(SourceType.TRIGGER, SKILL, "authored_rule", AggregateJson.tree("""
                {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"authored_skill","useKind":"ACTIVE","castPhase":"INITIAL"}},
                 "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","targetContext":"CURRENT_TARGET",
                 "detail":{"processKey":"authored_process"},"runtimeInputBindings":[{"bindingKey":"snapshot","parameterKey":"snapshot_input",
                 "sourceType":"SCENE_ATTRIBUTE_SNAPSHOT","detail":%s}],"resultModifiers":[]}]}
                """.formatted(detail)))
        );
    }
}
