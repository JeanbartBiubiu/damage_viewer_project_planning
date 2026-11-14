package xyz.game.datamanage.service.simulation.availability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SimulationAvailabilityResourcesTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void generatedScopeContainsTheCurrentFiveBatchesAndOriginalEquipmentListWithoutProofs() {
        SimulationAvailabilityResources resources = new SimulationAvailabilityResources(json, new DefaultResourceLoader());
        var scope = resources.scope("lol");
        assertTrue(scope.valid());
        assertEquals(41, scope.value().path("characters").size());
        assertEquals(205, scope.value().path("characters").findValues("expectedSkills").stream().mapToInt(value -> value.size()).sum());
        assertFalse(scope.value().path("characters").toString().contains("champion_zyra"));
        assertEquals(198, scope.value().path("equipment").size());
        assertEquals(51, scope.value().path("equipment").findValues("requiresSkillBindings").stream().filter(value -> !value.booleanValue()).count());
        for (String key : java.util.List.of("item_1120", "item_2421", "item_3172", "item_3175")) {
            var item = java.util.stream.StreamSupport.stream(scope.value().path("equipment").spliterator(), false)
                .filter(value -> key.equals(value.path("key").asText())).findFirst().orElseThrow();
            assertFalse(item.path("requiresSkillBindings").asBoolean());
            assertFalse(item.path("attributesOnlyEvidence").path("reason").asText().isBlank());
            assertEquals("outputs/equipment-authoring-20261022-remaining-01a15ed4/范围核对.json",
                item.path("attributesOnlyEvidence").path("evidenceRefs").get(0).asText());
        }
        assertEquals("VERIFICATION_NOT_FOUND", resources.verification("another_game").issueCode());
        assertEquals("SCOPE_NOT_FOUND", resources.scope("another_game").issueCode());
    }

    @Test
    void missingAndBrokenFilesFailClosedWithoutPropagatingParsingDetails() {
        ResourceLoader loader = mock(ResourceLoader.class);
        Resource missing = mock(Resource.class);
        when(missing.exists()).thenReturn(false);
        when(loader.getResource(anyString())).thenReturn(missing);
        SimulationAvailabilityResources resources = new SimulationAvailabilityResources(json, loader);
        assertEquals("VERIFICATION_NOT_FOUND", resources.verification("lol").issueCode());
        when(loader.getResource(anyString())).thenReturn(bytes("{ broken"));
        assertEquals("VERIFICATION_INVALID", resources.verification("lol").issueCode());
        when(loader.getResource(anyString())).thenReturn(bytes("{} {}"));
        assertEquals("VERIFICATION_INVALID", resources.verification("lol").issueCode());
        when(loader.getResource(anyString())).thenReturn(bytes("{\"gameId\":\"lol\",\"gameId\":\"another_game\"}"));
        assertEquals("VERIFICATION_INVALID", resources.verification("lol").issueCode());
        assertEquals("VERIFICATION_INVALID", resources.verification("../lol").issueCode());
    }

    @Test
    void proofIdentityStatusAndEvidenceAreStrictlyParsed() throws Exception {
        ObjectNode root = proof();
        assertTrue(read(root).valid());
        root.put("gameId", "other");
        assertFalse(read(root).valid());
        root.put("gameId", "lol").put("profile", "other-profile");
        assertFalse(read(root).valid());
        root.put("profile", "combat-analysis-v1").put("digestVersion", "baseDigest");
        assertFalse(read(root).valid());
        root = proof();
        ((ObjectNode) root.path("entries").get(0)).withArray("evidenceRefs").removeAll();
        assertFalse(read(root).valid());
        root = proof();
        ((ObjectNode) root.path("entries").get(0)).put("outcome", "READY");
        assertFalse(read(root).valid());
        root = proof();
        ((ObjectNode) root.path("entries").get(0)).put("outcome", "ENGINE_UNSUPPORTED");
        assertFalse(read(root).valid(), "无具体失败问题不能生成引擎不支持状态");
        ((ObjectNode) root.path("entries").get(0)).withArray("issues").addObject().put("code", "UNIT_TEST_ONLY").put("message", "测试")
            .putNull("skillKey").putNull("fieldPath");
        assertTrue(read(root).valid());
    }

    @Test
    void duplicateProofEntriesAndSuccessfulProofWithFailureIssuesAreInvalid() throws Exception {
        ObjectNode root = proof();
        root.withArray("entries").add(root.path("entries").get(0).deepCopy());
        assertFalse(read(root).valid());
        root = proof();
        ((ObjectNode) root.path("entries").get(0)).withArray("issues").addObject().put("code", "failure").put("message", "失败")
            .putNull("skillKey").putNull("fieldPath");
        assertFalse(read(root).valid());
    }

    @Test
    void representativeSamplesDoNotNarrowTheLegalLevelsAndDoNotRewriteExistingSufficientEvidence() {
        ObjectNode required = representativeRequiredCoverage();
        ObjectNode entry = representativeEntry(required);
        assertTrue(SimulationAvailabilityResources.coverageMatches(json, required, entry));
        assertEquals(3, required.path("characterLevels").size(), "两个实际等级样本仍可支持完整合法范围");
        entry.remove("validationCases");
        ((ObjectNode) entry.path("coverage")).put("levelValidation", "each-declared-level");
        String original = entry.toString();
        assertTrue(SimulationAvailabilityResources.coverageMatches(json, required, entry));
        assertEquals(original, entry.toString(), "原逐级证据及声明不改写");
        ((ObjectNode) entry.path("coverage")).putArray("characterLevels").add(3);
        assertFalse(SimulationAvailabilityResources.coverageMatches(json, required, entry), "充分证据也不能缩窄合法范围");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidRepresentativeSamples")
    void representativeSamplesFailClosedAtTheirActualBoundary(String name, Consumer<ObjectNode> mutation) {
        ObjectNode required = representativeRequiredCoverage();
        ObjectNode entry = representativeEntry(required);
        mutation.accept(entry);
        assertFalse(SimulationAvailabilityResources.coverageMatches(json, required, entry), name);
    }

    @Test
    void validationCasesAreBoundedButTheMaximumAcceptedSetRemainsUsable() {
        ObjectNode required = representativeRequiredCoverage();
        ObjectNode entry = representativeEntry(required);
        ObjectNode source = sample(entry, 0).deepCopy(), target = sample(entry, 1).deepCopy();
        ArrayNode cases = entry.putArray("validationCases");
        for (int index = 0; index < 100; index++) cases.add((index % 2 == 0 ? source : target).deepCopy().put("caseKey", "case_" + index));
        assertTrue(SimulationAvailabilityResources.coverageMatches(json, required, entry));
        cases.add(source.deepCopy().put("caseKey", "case_100"));
        assertFalse(SimulationAvailabilityResources.coverageMatches(json, required, entry));
    }

    @Test
    void everyCaseHasABoundedSkillListWithAnAcceptedUpperBoundary() {
        ObjectNode required = representativeRequiredCoverage();
        ArrayNode requiredSkills = required.putArray("skills");
        for (int index = 0; index < 100; index++) requiredSkills.addObject().put("skillKey", "skill_" + index).putArray("levels").add(1);
        ObjectNode entry = representativeEntry(required);
        assertTrue(SimulationAvailabilityResources.coverageMatches(json, required, entry));
        ((ArrayNode) sample(entry, 0).path("skillLevels")).addObject().put("skillKey", "extra").put("level", 1);
        assertFalse(SimulationAvailabilityResources.coverageMatches(json, required, entry));
    }

    @Test
    void unsupportedEvidenceHasNoPositiveSampleRequirementAndAttributeOnlyEvidenceHasNoInventedSkill() {
        ObjectNode required = representativeRequiredCoverage();
        ObjectNode unsupported = representativeEntry(required);
        unsupported.remove("validationCases");
        unsupported.put("outcome", "ENGINE_UNSUPPORTED").putArray("issues").addObject().put("code", "UNIT_TEST_UNSUPPORTED");
        assertTrue(SimulationAvailabilityResources.coverageMatches(json, required, unsupported));
        ((ObjectNode) unsupported.path("coverage")).put("levelValidation", "unknown");
        assertFalse(SimulationAvailabilityResources.coverageMatches(json, required, unsupported));

        required.putArray("skills");
        ObjectNode attributeOnly = representativeEntry(required);
        assertTrue(SimulationAvailabilityResources.coverageMatches(json, required, attributeOnly));
        assertTrue(sample(attributeOnly, 0).path("skillLevels").isEmpty());
    }

    private ObjectNode representativeRequiredCoverage() {
        ObjectNode required = json.createObjectNode().put("scenario", "one-way-combat-analysis-v1")
            .put("levelValidation", "representative-cases").put("allRequiredSourcesEnabled", true)
            .put("sourceActiveStartedAndCompleted", true).put("relevantPassivesTriggered", true).put("equipmentMode", "none");
        required.putArray("sides").add("source").add("target");
        required.putArray("characterLevels").add(1).add(2).add(3);
        ArrayNode skills = required.putArray("skills");
        skills.addObject().put("skillKey", "attack").putArray("levels").add(1).add(2);
        skills.addObject().put("skillKey", "passive").putArray("levels").add(1);
        return required;
    }

    private ObjectNode representativeEntry(ObjectNode coverage) {
        ObjectNode entry = json.createObjectNode().put("outcome", "PASSED");
        entry.set("coverage", coverage.deepCopy());
        entry.putArray("evidenceRefs").add("unit-test-fixture-only");
        entry.putArray("issues");
        ArrayNode cases = entry.putArray("validationCases");
        for (String side : java.util.List.of("source", "target")) {
            ObjectNode sample = cases.addObject().put("caseKey", "case_" + side).put("evidenceRef", "unit-test-fixture-only")
                .put("objectSide", side).put("sourceLevel", "source".equals(side) ? 1 : 3)
                .put("targetLevel", "source".equals(side) ? 3 : 1).put("complete", true).put("released", true);
            ArrayNode skillLevels = sample.putArray("skillLevels");
            coverage.path("skills").forEach(skill -> skillLevels.addObject().put("skillKey", skill.path("skillKey").asText()).put("level", 1));
        }
        return entry;
    }

    private static Stream<Arguments> invalidRepresentativeSamples() {
        return Stream.of(
            invalid("missing cases", entry -> entry.remove("validationCases")),
            invalid("null cases", entry -> entry.putNull("validationCases")),
            invalid("non-array cases", entry -> entry.putObject("validationCases")),
            invalid("empty cases", entry -> entry.withArray("validationCases").removeAll()),
            invalid("missing target position", entry -> entry.withArray("validationCases").remove(1)),
            invalid("unknown position", entry -> sample(entry, 0).put("objectSide", "other")),
            invalid("missing required skill", entry -> entry.path("validationCases").forEach(value -> ((ArrayNode) value.path("skillLevels")).remove(1))),
            invalid("unknown skill", entry -> sampleSkill(entry).put("skillKey", "unknown")),
            invalid("unregistered evidence", entry -> sample(entry, 0).put("evidenceRef", "another-fixture")),
            invalid("incomplete", entry -> sample(entry, 0).put("complete", false)),
            invalid("unreleased", entry -> sample(entry, 0).put("released", false)),
            invalid("coerced complete", entry -> sample(entry, 0).put("complete", "true")),
            invalid("missing complete", entry -> sample(entry, 0).remove("complete")),
            invalid("null released", entry -> sample(entry, 0).putNull("released")),
            invalid("source level zero", entry -> sample(entry, 0).put("sourceLevel", 0)),
            invalid("source level outside range", entry -> sample(entry, 0).put("sourceLevel", 4)),
            invalid("target level outside range", entry -> sample(entry, 0).put("targetLevel", 4)),
            invalid("fractional level", entry -> sample(entry, 0).put("sourceLevel", 1.5)),
            invalid("overflow level", entry -> sample(entry, 0).put("sourceLevel", Long.MAX_VALUE)),
            invalid("duplicate case", entry -> sample(entry, 1).put("caseKey", sample(entry, 0).path("caseKey").asText())),
            invalid("duplicate skill", entry -> ((ArrayNode) sample(entry, 0).path("skillLevels")).add(sampleSkill(entry).deepCopy())),
            invalid("unknown case field", entry -> sample(entry, 0).put("extra", true)),
            invalid("unknown skill field", entry -> sampleSkill(entry).put("extra", true)),
            invalid("null case", entry -> entry.withArray("validationCases").set(0, (JsonNode) null)),
            invalid("missing skill level", entry -> sampleSkill(entry).remove("level")),
            invalid("coerced skill level", entry -> sampleSkill(entry).put("level", "1")),
            invalid("skill level outside range", entry -> sampleSkill(entry).put("level", 3)),
            invalid("non-array skill levels", entry -> sample(entry, 0).putObject("skillLevels")),
            invalid("case identity too long", entry -> sample(entry, 0).put("caseKey", "x".repeat(129))),
            invalid("case identity contains control", entry -> sample(entry, 0).put("caseKey", "case\nsource")),
            invalid("unknown proof mode", entry -> ((ObjectNode) entry.path("coverage")).put("levelValidation", "unknown")),
            invalid("unknown proof result", entry -> entry.put("outcome", "READY"))
        );
    }

    private static Arguments invalid(String name, Consumer<ObjectNode> mutation) { return Arguments.of(name, mutation); }
    private static ObjectNode sample(ObjectNode entry, int index) { return (ObjectNode) entry.path("validationCases").get(index); }
    private static ObjectNode sampleSkill(ObjectNode entry) { return (ObjectNode) sample(entry, 0).path("skillLevels").get(0); }

    private SimulationAvailabilityResources.Document read(ObjectNode root) throws Exception {
        ResourceLoader loader = mock(ResourceLoader.class);
        when(loader.getResource(anyString())).thenReturn(bytes(json.writeValueAsString(root)));
        return new SimulationAvailabilityResources(json, loader).verification("lol");
    }

    @Test
    void logicalSlotsMayDeclareGenericCurrentSkillIdentitiesButCannotOverlap() throws Exception {
        ObjectNode scope = currentScope();
        ObjectNode slot = (ObjectNode) scope.path("characters").get(0).path("expectedSkills").get(2);
        slot.putArray("currentSkillKeys").add("choice_blue").add("choice_red").add("choice_gold");
        assertTrue(readScope(scope).valid());
        assertEquals(5, scope.path("characters").get(0).path("expectedSkills").size());
        slot.withArray("currentSkillKeys").add("choice_blue");
        assertEquals("SCOPE_INVALID", readScope(scope).issueCode());
        slot.putArray("currentSkillKeys").add(scope.path("characters").get(0).path("expectedSkills").get(0).path("key").textValue());
        assertEquals("SCOPE_INVALID", readScope(scope).issueCode());
    }

    @Test
    void currentSkillIdentityListIsStrictAndDoesNotReplaceFiveSlotValidation() throws Exception {
        for (String invalid : java.util.List.of("null", "[]", "\"choice\"", "[null]", "[1]", "[\"Bad\"]", "[\"\"]", "[\"valid\",\"valid\"]")) {
            ObjectNode scope = currentScope();
            ObjectNode slot = (ObjectNode) scope.path("characters").get(0).path("expectedSkills").get(2);
            slot.set("currentSkillKeys", json.readTree(invalid));
            assertEquals("SCOPE_INVALID", readScope(scope).issueCode(), invalid);
        }
        ObjectNode scope = currentScope();
        ((com.fasterxml.jackson.databind.node.ArrayNode) scope.path("characters").get(0).path("expectedSkills")).remove(4);
        assertEquals("SCOPE_INVALID", readScope(scope).issueCode());
    }

    private ObjectNode currentScope() {
        return new SimulationAvailabilityResources(json, new DefaultResourceLoader()).scope("lol").value().deepCopy();
    }

    private SimulationAvailabilityResources.Document readScope(ObjectNode root) throws Exception {
        ResourceLoader loader = mock(ResourceLoader.class);
        when(loader.getResource(anyString())).thenReturn(bytes(json.writeValueAsString(root)));
        return new SimulationAvailabilityResources(json, loader).scope("lol");
    }

    private ObjectNode proof() {
        ObjectNode root = json.createObjectNode().put("schemaVersion", "simulation-verification-v1").put("gameId", "lol")
            .put("profile", "combat-analysis-v1").put("digestVersion", "simulation-availability-v1")
            .put("scopeDigest", "a".repeat(64)).put("sharedDigest", "b".repeat(64)).put("wasmSha256", "c".repeat(64)).put("adapterVersion", "unit-test");
        ObjectNode entry = root.putArray("entries").addObject().put("kind", "CHARACTER").put("key", "hero")
            .put("contentDigest", "d".repeat(64)).put("externalDigest", "e".repeat(64)).put("outcome", "PASSED");
        entry.putObject("coverage").put("unit-test-only", true);
        entry.putArray("evidenceRefs").add("unit-test-fixture-only");
        entry.putArray("issues");
        return root;
    }

    private static Resource bytes(String value) { return new ByteArrayResource(value.getBytes(StandardCharsets.UTF_8)); }
}
