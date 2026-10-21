package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.model.skillprocess.SkillProcessEmpoweredAttackStepDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSceneInitialParameterBindingDetail;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillScenePayloadParameterSemanticsTest {
    static final String SKILL = "scene_payload";
    static final SkillNumericSemantics.Parameter INPUT = new SkillNumericSemantics.Parameter(SKILL, "before_count",
        "INTEGER", "RUNTIME_INPUT", null, null);

    @Test void sharedInputIsOptionalAndBothOldShapesStayUnchanged() {
        var original = AggregateJson.tree("{\"minValue\":0,\"maxValue\":100}");
        var detail = AggregateJson.read(original.toString(), SkillTriggerSceneInitialParameterBindingDetail.class);
        assertEquals(original, AggregateJson.tree(AggregateJson.write(detail)));
        var shared = AggregateJson.tree("{\"minValue\":0,\"maxValue\":100,\"sharedInputKey\":\"feast_stacks\"}");
        assertEquals(shared, AggregateJson.tree(AggregateJson.write(
            AggregateJson.read(shared.toString(), SkillTriggerSceneInitialParameterBindingDetail.class))));
        var legacy = AggregateJson.tree("{\"windowValue\":{\"kind\":\"FIXED\",\"value\":6000},\"consumeMoment\":\"ATTACK_HIT\"}");
        assertEquals(legacy, AggregateJson.tree(AggregateJson.write(
            AggregateJson.read(legacy.toString(), SkillProcessEmpoweredAttackStepDetail.class))));
        var count = AggregateJson.tree("{\"windowValue\":{\"kind\":\"FIXED\",\"value\":6000},\"consumeMoment\":\"ATTACK_START\","
            + "\"maximumAttackCountValue\":{\"kind\":\"FIXED\",\"value\":3}}");
        assertEquals(count, AggregateJson.tree(AggregateJson.write(
            AggregateJson.read(count.toString(), SkillProcessEmpoweredAttackStepDetail.class))));
    }

    @ParameterizedTest @ValueSource(strings = {"null", "\"\"", "1", "\"Bad Key\"", "\"a-b\""})
    void invalidSharedKeyIsNotNormalizedOrDropped(String key) {
        String json = "{\"minValue\":0,\"maxValue\":100,\"sharedInputKey\":" + key + "}";
        assertThrows(RuntimeException.class, () -> AggregateJson.read(json, SkillTriggerSceneInitialParameterBindingDetail.class));
        assertFalse(SkillSceneInitialParameterSemantics.detailIssues(AggregateJson.tree(json), "INTEGER", "detail").isEmpty());
    }

    @Test void explicitNullAttackCountCannotBecomeLegacySingleHitMode() {
        assertThrows(RuntimeException.class, () -> AggregateJson.read("{\"windowValue\":{\"kind\":\"FIXED\",\"value\":6000},"
            + "\"consumeMoment\":\"ATTACK_START\",\"maximumAttackCountValue\":null}", SkillProcessEmpoweredAttackStepDetail.class));
    }

    @Test void realInitialProcessPayloadConsumesSceneInputAndIndexesIt() {
        var objects = objects();
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(objects, List.of(INPUT)));
        assertTrue(SkillObjectReferences.extract("game", objects).stream().anyMatch(ref ->
            ref.sourceType() == SourceType.TRIGGER && ref.fieldPath().equals("actions[0].runtimeInputBindings[0].parameterKey")
                && ref.target().key().equals("before_count")));
    }

    @Test void secondInitialProcessIsRejectedEvenWhenOnlyTheNewSiblingChanged() {
        var objects = new java.util.ArrayList<>(objects());
        var secondProcess = new Aggregate(SourceType.PROCESS, SKILL, "second", objects.get(1).data().deepCopy());
        var secondRule = new Aggregate(SourceType.TRIGGER, SKILL, "second_start", objects.get(2).data().deepCopy());
        ((ObjectNode) secondRule.data().path("actions").get(0).path("detail")).put("processKey", "second");
        objects.add(secondProcess);
        objects.add(secondRule);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, List.of(INPUT)));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(secondRule), objects,
            List.of(INPUT), java.util.Map.of(), java.util.Map.of(), java.util.Map.of()));
        // 新增入口即使没有场景绑定，也必须复核原来的场景负载合同。
        ((ObjectNode) secondRule.data().path("actions").get(0)).putArray("runtimeInputBindings");
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(secondRule), objects,
            List.of(INPUT), java.util.Map.of(), java.util.Map.of(), java.util.Map.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"WRONG_EVENT", "FOREIGN_SKILL", "RECAST", "PASSIVE", "UNUSED", "COST", "COOLDOWN",
        "STEP_TIME", "LIFECYCLE", "NON_DAMAGE", "STATE", "NON_HIT_MOMENT", "NULL_GROUP", "DEFAULT"})
    void finalDependencyChangesCannotBorrowThePayloadAuthorization(String change) {
        var objects = objects();
        ObjectNode effect = (ObjectNode) objects.get(0).data(), process = (ObjectNode) objects.get(1).data();
        ObjectNode trigger = (ObjectNode) objects.get(2).data(), event = (ObjectNode) trigger.path("eventSource");
        ObjectNode binding = (ObjectNode) trigger.path("actions").get(0).path("runtimeInputBindings").get(0);
        var input = INPUT;
        switch (change) {
            case "WRONG_EVENT" -> event.put("eventType", "BASIC_ATTACK_HIT");
            case "FOREIGN_SKILL" -> ((ObjectNode) event.path("detail")).put("sourceSkillKey", "foreign");
            case "RECAST" -> ((ObjectNode) event.path("detail")).put("castPhase", "RECAST");
            case "PASSIVE" -> process.put("activationType", "PASSIVE");
            case "UNUSED" -> ((ObjectNode) effect.path("results").get(0).path("valueRule")).set("value", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":1}"));
            case "COST" -> ((com.fasterxml.jackson.databind.node.ArrayNode) effect.path("results")).add(AggregateJson.tree("""
                {"resultKey":"cost","resultType":"RESOURCE_CHANGE","target":"SOURCE",
                 "valueRule":{"value":{"kind":"PARAMETER","parameterKey":"before_count"}},
                 "detail":{"attributeKey":"mp","operation":"CONSUME"}}
                """));
            case "COOLDOWN" -> process.set("cooldown", AggregateJson.tree("{\"durationValue\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"before_count\"}}"));
            case "STEP_TIME" -> process.set("steps", AggregateJson.tree("[{\"stepType\":\"DELAY\",\"detail\":{\"delayValue\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"before_count\"}}}]"));
            case "LIFECYCLE" -> effect.set("lifecycle", AggregateJson.tree("{\"durationValue\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"before_count\"}}"));
            case "NON_DAMAGE" -> ((ObjectNode) effect.path("results").get(0)).put("resultType", "DIRECT_HEAL");
            case "STATE" -> process.set("stateOperations", AggregateJson.tree("[{\"operation\":\"SET\",\"stateSkillKey\":\"scene_payload\",\"stateKey\":\"counter\",\"value\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"before_count\"}}]"));
            case "NON_HIT_MOMENT" -> ((ObjectNode) process.path("effectBindings").get(0).path("moment")).put("momentType", "PROCESS_START");
            case "NULL_GROUP" -> ((ObjectNode) binding.path("detail")).putNull("sharedInputKey");
            case "DEFAULT" -> input = new SkillNumericSemantics.Parameter(SKILL, "before_count", "INTEGER", "RUNTIME_INPUT", java.math.BigDecimal.ZERO, null);
        }
        var finalInput = input;
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, List.of(finalInput)));
    }

    @ParameterizedTest @ValueSource(strings = {"0", "65", "1.5", "9007199254740992", "null"})
    void countMustBeAnExplicitBoundedPositiveInteger(String count) {
        var objects = countObjects(count);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, List.of()));
    }

    @Test void countAndWindowMustBeStaticAndTheNewModeCannotReplaceOldHitSemantics() {
        for (int n : List.of(1, 3, 64)) assertDoesNotThrow(() -> SkillNumericSemantics.validate(countObjects(Integer.toString(n)), List.of()));
        var objects = countObjects("3");
        var process = (ObjectNode) objects.getFirst().data();
        var step = (ObjectNode) process.path("steps").get(0);
        var detail = (ObjectNode) step.path("detail");
        detail.put("consumeMoment", "ATTACK_HIT");
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, List.of()));
        detail.put("consumeMoment", "ATTACK_START");
        detail.set("windowValue", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"before_count\"}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, List.of(INPUT)));
        detail.set("windowValue", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":6000}"));
        step.put("occupiesAction", true);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, List.of()));
    }

    static List<Aggregate> countObjects(String count) {
        String amount = "null".equals(count) ? "null" : "{\"kind\":\"FIXED\",\"value\":" + count + "}";
        return List.of(new Aggregate(SourceType.PROCESS, SKILL, "empower", AggregateJson.tree("""
            {"activationType":"ACTIVE","steps":[{"stepKey":"window","stepType":"EMPOWERED_BASIC_ATTACK","occupiesAction":false,
              "detail":{"windowValue":{"kind":"FIXED","value":6000},"consumeMoment":"ATTACK_START","maximumAttackCountValue":%s}}],
             "effectBindings":[],"stateOperations":[]}
            """.formatted(amount))));
    }

    static List<Aggregate> objects() {
        return List.of(new Aggregate(SourceType.EFFECT, SKILL, "spike", AggregateJson.tree("""
            {"lifecycle":null,"results":[{"resultKey":"spike","resultType":"DAMAGE","target":"TARGET",
              "valueRule":{"value":{"kind":"PARAMETER","parameterKey":"before_count"}},"detail":{}}]}
            """)), new Aggregate(SourceType.PROCESS, SKILL, "empower", AggregateJson.tree("""
            {"activationType":"ACTIVE","steps":[{"stepKey":"window","stepType":"IMMEDIATE","detail":{}}],
             "costs":[],"cooldown":null,"stateOperations":[],"effectBindings":[{"effectKey":"spike",
              "moment":{"momentType":"STEP_EXECUTION","stepKey":"window"}}]}
            """)), new Aggregate(SourceType.TRIGGER, SKILL, "initial", AggregateJson.tree("""
            {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"scene_payload","useKind":"ACTIVE","castPhase":"INITIAL"}},
             "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","targetContext":"EVENT_SOURCE",
              "detail":{"processKey":"empower"},"resultModifiers":[],"runtimeInputBindings":[{"bindingKey":"before_count",
               "parameterKey":"before_count","sourceType":"SCENE_INITIAL_PARAMETER","detail":{"minValue":0,"maxValue":100,"sharedInputKey":"feast_stacks"}}]}]}
            """)));
    }
}
