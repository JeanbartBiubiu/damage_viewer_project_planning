package xyz.game.datamanage.service.simulation.availability;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

/** 发布资源只提供范围和实际运行证据；缺失或损坏时一律不产生可选对象。 */
@Component
public class SimulationAvailabilityResources {
    public static final String PROFILE = "combat-analysis-v1";
    public static final String DIGEST_VERSION = "simulation-availability-v1";
    public static final String PROOF_VERSION = "simulation-verification-v1";
    private static final int MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
    private final ObjectMapper json;
    private final ResourceLoader resources;

    public SimulationAvailabilityResources(ObjectMapper json, ResourceLoader resources) {
        this.json = json.copy().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
        this.resources = resources;
    }

    public record Document(JsonNode value, String issueCode) {
        public boolean valid() { return value != null && issueCode == null; }
    }

    public Document scope(String gameId) {
        Document result = read("simulation-scope", gameId, "SCOPE");
        if (!result.valid()) return result;
        JsonNode root = result.value();
        if (!identity(root, gameId, "simulation-priority-scope-v1") || !validScope(root)) return invalid("SCOPE_INVALID");
        return result;
    }

    public Document verification(String gameId) {
        Document result = read("simulation-verification", gameId, "VERIFICATION");
        if (!result.valid()) return result;
        JsonNode root = result.value();
        if (!identity(root, gameId, PROOF_VERSION)
            || !DIGEST_VERSION.equals(root.path("digestVersion").asText())
            || !sha(root.path("scopeDigest")) || !sha(root.path("sharedDigest")) || !sha(root.path("wasmSha256"))
            || !text(root.path("adapterVersion")) || !root.path("entries").isArray()) return invalid("VERIFICATION_INVALID");
        Set<String> identities = new HashSet<>();
        for (JsonNode entry : root.path("entries")) {
            String kind = entry.path("kind").asText();
            String outcome = entry.path("outcome").asText();
            if (!("CHARACTER".equals(kind) || "EQUIPMENT".equals(kind)) || !key(entry.path("key"))
                || !identities.add(kind + ":" + entry.path("key").asText())
                || !sha(entry.path("contentDigest")) || !sha(entry.path("externalDigest"))
                || !("PASSED".equals(outcome) || "ENGINE_UNSUPPORTED".equals(outcome))
                || !entry.path("coverage").isObject() || !strings(entry.path("evidenceRefs"), true)
                || !entry.path("issues").isArray()) return invalid("VERIFICATION_INVALID");
            if ("PASSED".equals(outcome) && !entry.path("issues").isEmpty()) return invalid("VERIFICATION_INVALID");
            if ("ENGINE_UNSUPPORTED".equals(outcome) && entry.path("issues").isEmpty()) return invalid("VERIFICATION_INVALID");
            for (JsonNode issue : entry.path("issues")) {
                if (!text(issue.path("code")) || !text(issue.path("message"))
                    || !nullableText(issue.get("skillKey")) || !nullableText(issue.get("fieldPath"))) return invalid("VERIFICATION_INVALID");
            }
        }
        return result;
    }

    private Document read(String directory, String gameId, String prefix) {
        if (gameId == null || !gameId.matches("[a-z][a-z0-9_]{0,63}")) return invalid(prefix + "_INVALID");
        Resource resource = resources.getResource("classpath:" + directory + "/" + gameId + "/combat-analysis.json");
        if (!resource.exists()) return invalid(prefix + "_NOT_FOUND");
        try (InputStream input = resource.getInputStream()) {
            byte[] bytes = input.readNBytes(MAX_RESOURCE_BYTES + 1);
            if (bytes.length > MAX_RESOURCE_BYTES) return invalid(prefix + "_INVALID");
            JsonNode root = json.readTree(bytes);
            return root != null && root.isObject() ? new Document(root, null) : invalid(prefix + "_INVALID");
        } catch (Exception exception) {
            return invalid(prefix + "_INVALID");
        }
    }

    private static boolean identity(JsonNode root, String gameId, String version) {
        return version.equals(root.path("schemaVersion").asText()) && gameId.equals(root.path("gameId").asText())
            && PROFILE.equals(root.path("profile").asText());
    }

    private static boolean validScope(JsonNode root) {
        if (!root.path("characters").isArray() || !root.path("equipment").isArray()) return false;
        Set<String> characters = new HashSet<>();
        for (JsonNode character : root.path("characters")) {
            if (!key(character.path("key")) || !characters.add(character.path("key").asText()) || !text(character.path("name"))
                || !character.path("expectedSkills").isArray() || character.path("expectedSkills").size() != 5) return false;
            Set<String> slots = new HashSet<>();
            Set<String> skills = new HashSet<>();
            Set<String> currentSkills = new HashSet<>();
            for (JsonNode skill : character.path("expectedSkills")) {
                String slot = skill.path("slot").asText();
                if (!Set.of("P", "Q", "W", "E", "R").contains(slot) || !slots.add(slot) || !key(skill.path("key"))
                    || !skills.add(skill.path("key").asText()) || !skill.path("excluded").isBoolean()) return false;
                if (skill.has("currentSkillKeys")) {
                    JsonNode current = skill.get("currentSkillKeys");
                    if (!current.isArray() || current.isEmpty()) return false;
                    for (JsonNode value : current) if (!key(value) || !currentSkills.add(value.textValue())) return false;
                } else if (!currentSkills.add(skill.path("key").asText())) return false;
                if (skill.path("excluded").booleanValue() && (!text(skill.path("exclusion").path("reason"))
                    || !strings(skill.path("exclusion").path("evidenceRefs"), true))) return false;
            }
        }
        Set<String> equipment = new HashSet<>();
        for (JsonNode item : root.path("equipment")) {
            if (!key(item.path("key")) || !equipment.add(item.path("key").asText()) || !text(item.path("name"))
                || !item.path("requiresSkillBindings").isBoolean()) return false;
            if (!item.path("requiresSkillBindings").booleanValue() && (!text(item.path("attributesOnlyEvidence").path("reason"))
                || !strings(item.path("attributesOnlyEvidence").path("evidenceRefs"), true))) return false;
        }
        return true;
    }

    /** 逻辑槽保留归档标识；声明拆分后只核对当前真实挂载身份。 */
    static List<String> currentSkillKeys(JsonNode expected) {
        if (!expected.has("currentSkillKeys")) return List.of(expected.path("key").asText());
        List<String> result = new ArrayList<>();
        expected.path("currentSkillKeys").forEach(value -> result.add(value.textValue()));
        return List.copyOf(result);
    }

    private static Document invalid(String code) { return new Document(null, code); }
    static boolean sha(JsonNode value) { return value.isTextual() && value.textValue().matches("[0-9a-f]{64}"); }
    static boolean text(JsonNode value) { return value != null && value.isTextual() && !value.textValue().isBlank(); }
    private static boolean key(JsonNode value) { return value.isTextual() && value.textValue().matches("[a-z][a-z0-9_]{0,63}"); }
    private static boolean nullableText(JsonNode value) { return value != null && (value.isNull() || value.isTextual()); }
    private static boolean strings(JsonNode values, boolean nonempty) {
        if (!values.isArray() || (nonempty && values.isEmpty())) return false;
        for (JsonNode value : values) if (!text(value)) return false;
        return true;
    }
}
