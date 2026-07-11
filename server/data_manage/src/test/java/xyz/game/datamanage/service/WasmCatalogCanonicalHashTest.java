package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class WasmCatalogCanonicalHashTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void schemaHashIsStableSha256OfFingerprint() {
        String hash = WasmCatalogCanonicalHash.schemaHash();
        assertTrue(hash.startsWith("sha256:"));
        assertEquals(WasmCatalogCanonicalHash.schemaHash(), hash);
        assertEquals(71, hash.length()); // sha256: + 64 hex
    }

    @Test
    void rulesHashStableForReorderedObjectKeysAndNumericSpellings() throws Exception {
        ObjectNode a = (ObjectNode) objectMapper.readTree("""
            {
              "schemaVersion": "generic-p0",
              "settings": {"maxEvents": 1.0, "z": -0.0, "a": 2},
              "rules": {"operations": [], "modifiers": [], "listeners": [], "triggerRules": []},
              "formulas": [],
              "sharedProviders": [],
              "combatantTemplates": [],
              "typeCatalog": {"types": [], "relations": []}
            }
            """);
        ObjectNode b = (ObjectNode) objectMapper.readTree("""
            {
              "typeCatalog": {"relations": [], "types": []},
              "combatantTemplates": [],
              "sharedProviders": [],
              "rules": {"triggerRules": [], "listeners": [], "modifiers": [], "operations": []},
              "formulas": [],
              "settings": {"a": 2.00, "maxEvents": 1, "z": 0},
              "schemaVersion": "generic-p0"
            }
            """);

        String hashA = WasmCatalogCanonicalHash.rulesHash(a);
        String hashB = WasmCatalogCanonicalHash.rulesHash(b);
        assertEquals(hashA, hashB);
        assertTrue(hashA.startsWith("sha256:"));
    }

    @Test
    void buildHashPayloadExcludesMetaAndUsesStoredBodyRoots() throws Exception {
        ObjectNode catalogBody = (ObjectNode) objectMapper.readTree("""
            {
              "typeCatalog": {"types": [], "relations": []},
              "combatantTemplates": [],
              "sharedProviders": [],
              "rules": {"operations": [], "modifiers": [], "listeners": [], "triggerRules": []},
              "formulas": [],
              "settings": {"maxEvents": 1}
            }
            """);
        ObjectNode payload = WasmCatalogCanonicalHash.buildHashPayload("generic-p0", catalogBody);
        assertEquals("generic-p0", payload.path("schemaVersion").asText());
        assertTrue(payload.has("typeCatalog"));
        assertTrue(!payload.has("meta"));
        assertTrue(!payload.has("updatedAt"));

        ObjectNode reordered = catalogBody.deepCopy();
        // Field insertion order differs; hash payload must still be stable after canonicalization.
        ObjectNode settings = reordered.putObject("settings");
        settings.put("maxEvents", 1.0);
        String hashA = WasmCatalogCanonicalHash.rulesHash(
            WasmCatalogCanonicalHash.buildHashPayload("generic-p0", catalogBody)
        );
        String hashB = WasmCatalogCanonicalHash.rulesHash(
            WasmCatalogCanonicalHash.buildHashPayload("generic-p0", reordered)
        );
        assertEquals(hashA, hashB);
    }

    @Test
    void canonicalizeNumberNormalizesTrailingZerosAndNegativeZero() {
        assertEquals("1", WasmCatalogCanonicalHash.canonicalizeNumber(objectMapper.getNodeFactory().numberNode(1.0)));
        assertEquals("0", WasmCatalogCanonicalHash.canonicalizeNumber(objectMapper.getNodeFactory().numberNode(-0.0)));
        assertEquals("2.5", WasmCatalogCanonicalHash.canonicalizeNumber(objectMapper.getNodeFactory().numberNode(2.50)));
    }
}
