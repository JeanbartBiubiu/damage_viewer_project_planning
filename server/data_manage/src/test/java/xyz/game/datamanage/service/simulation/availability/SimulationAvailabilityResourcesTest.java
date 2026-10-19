package xyz.game.datamanage.service.simulation.availability;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
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
        assertEquals(49, scope.value().path("characters").size());
        assertEquals(245, scope.value().path("characters").findValues("expectedSkills").stream().mapToInt(value -> value.size()).sum());
        assertFalse(scope.value().path("characters").toString().contains("champion_zyra"));
        assertEquals(198, scope.value().path("equipment").size());
        assertEquals(47, scope.value().path("equipment").findValues("requiresSkillBindings").stream().filter(value -> !value.booleanValue()).count());
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
