package xyz.game.datamanage.service.character;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import xyz.game.datamanage.config.JacksonConfig;
import xyz.game.datamanage.model.character.AuthoringCheckLocation;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.ExpectValue;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.Field;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.FormulaOperand;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.KeyedChild;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.ValueChild;

class AuthoringCheckLocationResolverTest {
    @Test
    void storageWrappersAndGenericKeyBecomeActualDetailFields() throws Exception {
        var limits = AuthoringCheckLocationResolver.resolve("q", "TRIGGER", "hit", "limits.perTargetCooldown.durationValue.parameterKey",
            JSON.readTree("{\"limits\":{\"perTargetCooldown\":{\"durationValue\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"cd\"}}}}"));
        assertEquals("FIELD", limits.precision());
        assertEquals(new Field("perTargetCooldown"), limits.segments().getFirst());
        assertEquals("limits.perTargetCooldown.durationValue.parameterKey", limits.fieldPath());
        var once = AuthoringCheckLocationResolver.resolve("q", "TRIGGER", "hit", "limits.oncePerUse.scope",
            JSON.readTree("{\"limits\":{\"oncePerUse\":{\"groupKey\":\"eclipse\",\"scope\":\"SKILL\"}}}"));
        assertEquals("FIELD", once.precision());
        assertEquals(new Field("oncePerUse"), once.segments().getFirst());
        assertEquals("limits.oncePerUse.scope", once.fieldPath());
        var key = AuthoringCheckLocationResolver.resolve("q", "STATE", "mode", "key", JSON.readTree("{\"key\":\"mode\",\"stateType\":\"MODE\"}"));
        assertEquals(new Field("stateKey"), key.segments().getLast());
        assertEquals(new ExpectValue("stateType", "MODE"), key.segments().getFirst());
    }

    @Test
    void oversizedStoredIndexBecomesExplicitFallbackRatherThanCrashingReport() throws Exception {
        var result = AuthoringCheckLocationResolver.resolve("q", "EFFECT", "hit", "results[999999999999999999999].name",
            JSON.readTree("{\"results\":[]}"));
        assertEquals("OBJECT", result.precision());
        assertEquals("UNKNOWN_FIELD", result.degradeReason());
    }

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObjectMapper HTTP = httpMapper();
    private static final Set<String> LOCATION_KEYS = Set.of(
        "skillKey", "objectType", "objectKey", "editor", "fieldPath", "precision", "degradeReason",
        "segments", "formulaSnapshot"
    );

    @Test
    void stableKeySurvivesStorageOrderDifferentFromSortOrder() throws Exception {
        JsonNode raw = JSON.readTree("""
            {"results":[
              {"resultKey":"damage","resultType":"DAMAGE","sortOrder":30,"detail":{"attributeKey":"ad"}},
              {"resultKey":"heal","resultType":"DIRECT_HEAL","sortOrder":0,"detail":{}}
            ]}
            """);
        AuthoringCheckLocation location = resolve("EFFECT", "hit", "results[0].detail.attributeKey", raw);
        assertField(location);
        assertEquals(List.of(
            new KeyedChild("results", "resultKey", "damage"),
            new ExpectValue("resultType", "DAMAGE"),
            new Field("detail"),
            new Field("attributeKey")
        ), location.segments());
        assertStrictJson(location, HTTP);
    }

    @ParameterizedTest
    @CsvSource({
        "results,resultKey,damage",
        "steps,stepKey,wait",
        "effectBindings,bindingKey,apply",
        "stateOperations,operationKey,spend",
        "options,optionKey,ready",
        "conditionGroups,groupKey,main",
        "conditions,conditionKey,first",
        "actions,actionKey,cast",
        "runtimeInputBindings,bindingKey,strength",
        "vampOverrides,vampType,OMNIVAMP",
        "resultModifiers,resultKey,damage"
    })
    void everyKeyedCollectionUsesDeclaredIdentityAfterReorder(String collection, String keyField, String key)
        throws Exception {
        JsonNode raw = JSON.readTree("{\"" + collection + "\":[{" + quote(keyField) + ":\"other\"},{"
            + quote(keyField) + ":" + quote(key) + "}]}");
        AuthoringCheckLocation location = resolve("EFFECT", "hit", collection + "[1]", raw);
        assertField(location);
        assertEquals(List.of(new KeyedChild(collection, keyField, key)), location.segments());
        assertFalse(JSON.valueToTree(location).toString().contains("\"kind\":\"INDEX\""));
    }

    @Test
    void stringCollectionsUseUniqueValueIdentity() throws Exception {
        JsonNode raw = JSON.readTree("{\"skillKeys\":[\"e\",\"w\",\"q\"],\"skillCategoryKeys\":[\"active\",\"basic\"]}");
        AuthoringCheckLocation skills = resolve("EFFECT", "hit", "skillKeys[1]", raw);
        assertEquals(List.of(new ValueChild("skillKeys", "w")), skills.segments());
        AuthoringCheckLocation categories = resolve("EFFECT", "hit", "skillCategoryKeys[0]", raw);
        assertEquals(List.of(new ValueChild("skillCategoryKeys", "active")), categories.segments());
        AuthoringCheckLocation duplicate = resolve("EFFECT", "hit", "skillKeys[0]",
            JSON.readTree("{\"skillKeys\":[\"w\",\"w\"]}"));
        assertEquals("OBJECT", duplicate.precision());
        assertEquals("DUPLICATE_KEY", duplicate.degradeReason());
        assertTrue(duplicate.segments().isEmpty());
    }

    @Test
    void missingDuplicateCorruptAndUnknownPathsDegradeWithoutFieldCandidates() throws Exception {
        JsonNode missing = JSON.readTree("{\"results\":[{\"detail\":{\"attributeKey\":\"ad\"}}]}");
        AuthoringCheckLocation vanished = resolve("EFFECT", "hit", "results[0].detail.attributeKey", missing);
        assertEquals("MISSING_KEY", vanished.degradeReason());
        assertTrue(vanished.segments().isEmpty());

        JsonNode duplicate = JSON.readTree("{\"results\":[{\"resultKey\":\"damage\",\"detail\":{\"attributeKey\":\"ad\"}},"
            + "{\"resultKey\":\"damage\",\"detail\":{\"attributeKey\":\"ap\"}}]}");
        AuthoringCheckLocation duplicated = resolve("EFFECT", "hit", "results[0].detail.attributeKey", duplicate);
        assertEquals("DUPLICATE_KEY", duplicated.degradeReason());
        assertTrue(duplicated.segments().isEmpty());

        JsonNode corruptChild = JSON.readTree("{\"results\":[\"broken\"]}");
        AuthoringCheckLocation corrupt = resolve("EFFECT", "hit", "results[0].detail.attributeKey", corruptChild);
        assertEquals("CORRUPT_OBJECT", corrupt.degradeReason());
        assertEquals("OBJECT", corrupt.precision());
        assertEquals("EFFECT", corrupt.editor());

        AuthoringCheckLocation unknown = resolve("EFFECT", "hit", "unknownField", JSON.readTree("{\"results\":[]}"));
        assertEquals("UNKNOWN_FIELD", unknown.degradeReason());
        assertTrue(unknown.segments().isEmpty());

        AuthoringCheckLocation unknownCollection = resolve("EFFECT", "hit", "widgets[0].name",
            JSON.readTree("{\"widgets\":[{\"name\":\"x\"}]}"));
        assertEquals("UNKNOWN_FIELD", unknownCollection.degradeReason());
        assertTrue(unknownCollection.segments().isEmpty());
    }

    @Test
    void typeAndParentAnchorsAreInsertedBeforeDetailAndChildRefs() throws Exception {
        JsonNode effect = JSON.readTree("""
            {"results":[{"resultKey":"damage","resultType":"DAMAGE","detail":{"attributeKey":"ad"}}]}
            """);
        AuthoringCheckLocation damage = resolve("EFFECT", "hit", "results[0].detail.attributeKey", effect);
        assertEquals(new ExpectValue("resultType", "DAMAGE"), damage.segments().get(1));
        assertEquals(new Field("detail"), damage.segments().get(2));

        JsonNode trigger = JSON.readTree("""
            {"eventSource":{"eventType":"RESULT_AVAILABLE","detail":{"effectKey":"first","resultKey":"damage"}},
             "actions":[{"actionKey":"apply","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"first"},
               "runtimeInputBindings":[{"bindingKey":"strength","sourceType":"EVENT_VALUE","source":{"eventValueKey":"HIT_INDEX"}}],
               "resultModifiers":[{"resultKey":"damage"}]}],
             "conditionGroups":[{"groupKey":"main","conditions":[{"conditionKey":"first","conditionType":"LIFECYCLE_CHECK",
               "detail":{"effectKey":"first"}}]}],
             "steps":[{"stepKey":"wait","stepType":"DELAY","detail":{"delayValue":1}}]}
            """);
        AuthoringCheckLocation event = resolve("TRIGGER", "rule", "eventSource.detail.resultKey", trigger);
        assertEquals(List.of(
            new Field("eventSource"),
            new ExpectValue("eventType", "RESULT_AVAILABLE"),
            new Field("detail"),
            new ExpectValue("effectKey", "first"),
            new Field("resultKey")
        ), event.segments());

        AuthoringCheckLocation binding = resolve("TRIGGER", "rule",
            "actions[0].runtimeInputBindings[0].source", trigger);
        assertEquals(List.of(
            new KeyedChild("actions", "actionKey", "apply"),
            new ExpectValue("actionType", "EXECUTE_EFFECT"),
            new KeyedChild("runtimeInputBindings", "bindingKey", "strength"),
            new ExpectValue("sourceType", "EVENT_VALUE"),
            new Field("source")
        ), binding.segments());

        AuthoringCheckLocation condition = resolve("TRIGGER", "rule",
            "conditionGroups[0].conditions[0].detail.effectKey", trigger);
        assertEquals(new KeyedChild("conditionGroups", "groupKey", "main"), condition.segments().getFirst());
        assertEquals(new KeyedChild("conditions", "conditionKey", "first"), condition.segments().get(1));
        assertEquals(new ExpectValue("conditionType", "LIFECYCLE_CHECK"), condition.segments().get(2));

        AuthoringCheckLocation step = resolve("PROCESS", "cast", "steps[0].detail.delayValue",
            JSON.readTree("{\"steps\":[{\"stepKey\":\"wait\",\"stepType\":\"DELAY\",\"detail\":{\"delayValue\":1}}]}"));
        assertEquals(new ExpectValue("stepType", "DELAY"), step.segments().get(1));
        assertEquals("PROCESS", step.editor());
    }

    @Test
    void legalNullParentKeysAreSerializedAndNotDropped() throws Exception {
        JsonNode raw = JSON.readTree("""
            {"eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":null,"resultKey":"damage"}}}
            """);
        AuthoringCheckLocation location = resolve("TRIGGER", "rule", "eventSource.detail.resultKey", raw);
        assertEquals(new ExpectValue("sourceSkillKey", null), location.segments().get(3));
        JsonNode json = HTTP.valueToTree(location);
        JsonNode expect = json.path("segments").get(3);
        assertEquals("EXPECT_VALUE", expect.path("kind").asText());
        assertTrue(expect.has("value"));
        assertTrue(expect.get("value").isNull());
        assertEquals(Set.of("kind", "field", "value"), keySet(expect));
        assertStrictJson(location, HTTP);
        assertStrictJson(location, JSON);
    }

    @Test
    void formulaKeepsStructuralSlotsAndFullSnapshot() throws Exception {
        JsonNode expression = JSON.readTree("""
            {"nodeType":"OPERATION","operation":"ADD","operands":[
              {"nodeType":"PARAMETER","parameterKey":"left"},
              {"nodeType":"PARAMETER","parameterKey":"right"}
            ]}
            """);
        JsonNode raw = JSON.createObjectNode().set("expression", expression);
        AuthoringCheckLocation location = resolve("FORMULA", "total", "expression.operands[1].parameterKey", raw);
        assertField(location);
        assertEquals("FORMULA", location.editor());
        assertEquals(expression, location.formulaSnapshot());
        assertEquals(List.of(
            new Field("expression"),
            new ExpectValue("nodeType", "OPERATION"),
            new ExpectValue("operation", "ADD"),
            new FormulaOperand(1),
            new ExpectValue("nodeType", "PARAMETER"),
            new Field("parameterKey")
        ), location.segments());

        JsonNode repeated = JSON.readTree("""
            {"expression":{"nodeType":"OPERATION","operation":"ADD","operands":[
              {"nodeType":"PARAMETER","parameterKey":"left"},
              {"nodeType":"PARAMETER","parameterKey":"left"}
            ]}}
            """);
        AuthoringCheckLocation sameContent = resolve("FORMULA", "total", "expression.operands[1].parameterKey", repeated);
        assertEquals(1, ((FormulaOperand) sameContent.segments().get(3)).operand());
        assertEquals(repeated.get("expression"), sameContent.formulaSnapshot());

        AuthoringCheckLocation illegal = resolve("FORMULA", "total", "expression.operands[2].parameterKey",
            JSON.readTree("{\"expression\":{\"nodeType\":\"OPERATION\",\"operation\":\"ADD\",\"operands\":[{\"nodeType\":\"PARAMETER\"},{\"nodeType\":\"PARAMETER\"},{\"nodeType\":\"PARAMETER\"}]}}"));
        assertEquals("TYPE_CHANGED", illegal.degradeReason());
        assertTrue(illegal.segments().stream().noneMatch(segment -> segment instanceof FormulaOperand));
        assertEquals(illegal.formulaSnapshot(), JSON.readTree(
            "{\"nodeType\":\"OPERATION\",\"operation\":\"ADD\",\"operands\":[{\"nodeType\":\"PARAMETER\"},{\"nodeType\":\"PARAMETER\"},{\"nodeType\":\"PARAMETER\"}]}"));

        AuthoringCheckLocation name = resolve("FORMULA", "total", "name",
            JSON.readTree("{\"name\":\"总伤\",\"sortOrder\":3,\"expression\":{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"x\"}}"));
        assertNull(name.formulaSnapshot());
        assertEquals(List.of(new Field("name")), name.segments());
        assertStrictJson(location, HTTP);
    }

    @Test
    void characterAndBasicObjectEntriesMapExistingEditors() throws Exception {
        AuthoringCheckLocation character = AuthoringCheckLocationResolver.resolve(null, "CHARACTER", "hero", "name",
            JSON.readTree("{\"name\":\"测试角色\",\"characterKey\":\"hero\"}"));
        assertEquals(null, character.skillKey());
        assertEquals("CHARACTER_BASIC", character.editor());
        assertEquals(List.of(new Field("name")), character.segments());

        AuthoringCheckLocation relations = AuthoringCheckLocationResolver.resolve(null, "CHARACTER", "hero", "skills",
            JSON.readTree("{\"skills\":[]}"));
        assertEquals("CHARACTER_RELATIONS", relations.editor());
        assertEquals(List.of(new Field("skills")), relations.segments());

        AuthoringCheckLocation attributes = AuthoringCheckLocationResolver.resolve(null, "CHARACTER_ATTRIBUTES", "hero",
            "levelValues", JSON.readTree("{\"levelValues\":{\"1\":{\"hp\":0}}}"));
        assertEquals("CHARACTER_ATTRIBUTES", attributes.editor());
        assertEquals(List.of(new Field("levelValues")), attributes.segments());

        AuthoringCheckLocation nestedLevel = AuthoringCheckLocationResolver.resolve(null, "CHARACTER_ATTRIBUTES", "hero",
            "levelValues.1.hp", JSON.readTree("{\"levelValues\":{\"1\":{\"hp\":0}}}"));
        assertEquals("OBJECT", nestedLevel.precision());
        assertEquals("UNKNOWN_FIELD", nestedLevel.degradeReason());
        assertEquals(List.of(new Field("levelValues")), nestedLevel.segments());

        AuthoringCheckLocation skill = resolve("SKILL", "q", "maxLevel",
            JSON.readTree("{\"maxLevel\":5,\"name\":\"Q\",\"sortOrder\":1}"));
        assertEquals("SKILL_BASIC", skill.editor());

        AuthoringCheckLocation emptyPath = resolve("EFFECT", "hit", "", JSON.readTree("{\"results\":[]}"));
        assertEquals("OBJECT", emptyPath.precision());
        assertEquals("UNKNOWN_FIELD", emptyPath.degradeReason());
        assertTrue(emptyPath.segments().isEmpty());

        AuthoringCheckLocation none = AuthoringCheckLocationResolver.resolve(null, "LEVEL_CONFIG", "lol", "levelConfig",
            JSON.readTree("{}"));
        assertEquals("NONE", none.precision());
        assertNull(none.editor());
        assertEquals("OBJECT_MISSING", none.degradeReason());
    }

    @Test
    void missingSkillFallbackDoesNotInferDeletionFromEmptyJson() throws Exception {
        AuthoringCheckLocation emptyJson = resolve("SKILL", "gone", "skillKey", JSON.readTree("{}"));
        assertEquals("SKILL_BASIC", emptyJson.editor());
        assertEquals("UNKNOWN_FIELD", emptyJson.degradeReason());

        AuthoringCheckLocation missing = AuthoringCheckLocationResolver.missingSkill("gone", "gone", "skillKey");
        assertEquals("CHARACTER_RELATIONS", missing.editor());
        assertEquals("OBJECT", missing.precision());
        assertEquals("OBJECT_MISSING", missing.degradeReason());
        assertEquals("SKILL", missing.objectType());
        assertStrictJson(missing, HTTP);
    }

    @Test
    void zeroFalseAndNullRemainActualExpectedValues() throws Exception {
        for (String raw : List.of("{\"mode\":0,\"value\":0}", "{\"mode\":false,\"value\":false}",
            "{\"mode\":null,\"value\":null}")) {
            AuthoringCheckLocation location = resolve("EFFECT", "hit", "value", JSON.readTree(raw));
            assertField(location);
            assertInstanceOf(ExpectValue.class, location.segments().getFirst());
            JsonNode json = HTTP.valueToTree(location);
            assertTrue(json.path("segments").get(0).has("value"));
        }
    }

    @ParameterizedTest
    @MethodSource("corruptRoots")
    void damagedRootsOpenObjectEntry(JsonNode raw, String reason) {
        AuthoringCheckLocation location = resolve("EFFECT", "hit", "results[0].name", raw);
        assertEquals("OBJECT", location.precision());
        assertEquals(reason, location.degradeReason());
        assertEquals("EFFECT", location.editor());
        assertTrue(location.segments().isEmpty());
    }

    static Stream<Arguments> corruptRoots() {
        return Stream.of(
            Arguments.of(null, "OBJECT_MISSING"),
            Arguments.of(JSON.createArrayNode(), "CORRUPT_OBJECT")
        );
    }

    @Test
    void serializedLocationMatchesFrontendExactKeysIncludingNulls() throws Exception {
        AuthoringCheckLocation location = new AuthoringCheckLocation(null, "CHARACTER", "hero", "CHARACTER_BASIC",
            "name", "FIELD", null, List.of(new Field("name")), null);
        JsonNode json = HTTP.valueToTree(location);
        assertEquals(LOCATION_KEYS, keySet(json));
        assertTrue(json.get("skillKey").isNull());
        assertTrue(json.get("degradeReason").isNull());
        assertTrue(json.get("formulaSnapshot").isNull());
        assertEquals(Set.of("kind", "field"), keySet(json.path("segments").get(0)));
        assertStrictJson(location, HTTP);
        assertStrictJson(location, JSON);
    }

    private static AuthoringCheckLocation resolve(String objectType, String objectKey, String fieldPath, JsonNode raw) {
        return AuthoringCheckLocationResolver.resolve("q", objectType, objectKey, fieldPath, raw);
    }

    private static void assertField(AuthoringCheckLocation location) {
        assertEquals("FIELD", location.precision());
        assertNull(location.degradeReason());
    }

    private static void assertStrictJson(AuthoringCheckLocation location, ObjectMapper mapper) throws Exception {
        JsonNode json = mapper.readTree(mapper.writeValueAsString(location));
        assertEquals(LOCATION_KEYS, keySet(json));
        assertEquals(location.skillKey(), json.get("skillKey").isNull() ? null : json.get("skillKey").asText());
        assertEquals(location.objectType(), json.get("objectType").asText());
        assertEquals(location.objectKey(), json.get("objectKey").asText());
        assertEquals(location.fieldPath(), json.get("fieldPath").asText());
        if (location.editor() == null) assertTrue(json.get("editor").isNull());
        else assertEquals(location.editor(), json.get("editor").asText());
        assertTrue(Set.of("FIELD", "OBJECT", "NONE").contains(json.get("precision").asText()));
        boolean none = "NONE".equals(json.get("precision").asText());
        assertEquals(none, json.get("editor").isNull());
        if ("FIELD".equals(json.get("precision").asText())) assertTrue(json.get("degradeReason").isNull());
        else assertFalse(json.get("degradeReason").isNull());
        if (!json.get("formulaSnapshot").isNull()) {
            assertTrue(json.get("formulaSnapshot").isObject());
            assertEquals("FORMULA", json.get("editor").asText());
        }
        assertTrue(json.get("segments").isArray());
        boolean hasOperand = false;
        for (JsonNode segment : json.get("segments")) {
            assertTrue(segment.isObject());
            switch (segment.path("kind").asText()) {
                case "FIELD" -> {
                    assertEquals(Set.of("kind", "field"), keySet(segment));
                    assertTrue(AuthoringCheckLocation.validField(segment.get("field").asText()));
                }
                case "KEYED_CHILD" -> {
                    assertEquals(Set.of("kind", "collection", "keyField", "key"), keySet(segment));
                    assertEquals(AuthoringCheckLocation.COLLECTION_KEYS.get(segment.get("collection").asText()),
                        segment.get("keyField").asText());
                    assertFalse(segment.get("key").asText().isEmpty());
                }
                case "VALUE_CHILD" -> {
                    assertEquals(Set.of("kind", "collection", "value"), keySet(segment));
                    assertTrue(AuthoringCheckLocation.VALUE_COLLECTIONS.contains(segment.get("collection").asText()));
                    assertFalse(segment.get("value").asText().isEmpty());
                }
                case "FORMULA_OPERAND" -> {
                    assertEquals(Set.of("kind", "operand"), keySet(segment));
                    int operand = segment.get("operand").intValue();
                    assertTrue(operand == 0 || operand == 1);
                    hasOperand = true;
                }
                case "EXPECT_VALUE" -> {
                    assertEquals(Set.of("kind", "field", "value"), keySet(segment));
                    assertTrue(segment.has("value"));
                    JsonNode value = segment.get("value");
                    assertTrue(value.isNull() || value.isTextual() || value.isBoolean()
                        || value.isNumber() && Double.isFinite(value.doubleValue()));
                }
                default -> throw new AssertionError("未知段: " + segment);
            }
        }
        if (hasOperand) assertFalse(json.get("formulaSnapshot").isNull());
    }

    private static Set<String> keySet(JsonNode node) {
        Set<String> keys = new java.util.LinkedHashSet<>();
        node.fieldNames().forEachRemaining(keys::add);
        return keys;
    }

    private static String quote(String value) {
        return "\"" + value + "\"";
    }

    private static ObjectMapper httpMapper() {
        Jackson2ObjectMapperBuilder builder = Jackson2ObjectMapperBuilder.json()
            .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        new JacksonConfig().jsonCustomizer().customize(builder);
        return builder.build();
    }
}
