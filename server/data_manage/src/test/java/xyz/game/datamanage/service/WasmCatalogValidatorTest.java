package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.error.ApiException;

class WasmCatalogValidatorTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final WasmCatalogValidator validator = new WasmCatalogValidator();

    @Test
    void validMinimalSourcePasses() throws Exception {
        ObjectNode body = minimalValidSource();
        WasmCatalogValidator.ValidatedSource validated = validator.validateAndNormalize(body);
        assertEquals("generic-p0", validated.schemaVersion());
        assertTrue(validated.catalogBody().has("typeCatalog"));
        assertTrue(!validated.catalogBody().has("schemaVersion"));
    }

    @Test
    void unknownTopLevelFieldIsInvalidBody() throws Exception {
        ObjectNode body = minimalValidSource();
        body.put("extra", "nope");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    @Test
    void metaFieldIsInvalidBody() throws Exception {
        ObjectNode body = minimalValidSource();
        body.putObject("meta").put("gameId", "lol");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    @Test
    void versionCodeFieldIsInvalidBody() throws Exception {
        ObjectNode body = minimalValidSource();
        body.put("versionCode", "14.1");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    @Test
    void wrongSchemaVersionIsInvalidBody() throws Exception {
        ObjectNode body = minimalValidSource();
        body.put("schemaVersion", "legacy-v2");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    @Test
    void missingDefinitionRefIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ((ObjectNode) body.path("combatantTemplates").get(0).path("providers").get(0))
            .put("definitionRef", "missing_provider");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void nonEmptyTopLevelRulesIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ((ObjectNode) body.get("rules")).putArray("operations").addObject().put("target", "self");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void forbiddenLegacySkillMountsIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ((ObjectNode) body.path("settings")).put("skillMounts", true);
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void arrayFormAttributesIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ObjectNode template = (ObjectNode) body.path("combatantTemplates").get(0);
        template.remove("attributes");
        template.putArray("attributes").addObject().put("key", "ad");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void typeRelationCycleIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ArrayNode types = ((ObjectNode) body.get("typeCatalog")).putArray("types");
        types.addObject().put("key", "role/a").put("domain", "role");
        types.addObject().put("key", "role/b").put("domain", "role");
        ArrayNode relations = ((ObjectNode) body.get("typeCatalog")).putArray("relations");
        relations.addObject().put("parent", "role/a").put("child", "role/b");
        relations.addObject().put("parent", "role/b").put("child", "role/a");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void typeRelationDepthOverTwoIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ArrayNode types = ((ObjectNode) body.get("typeCatalog")).putArray("types");
        types.addObject().put("key", "role/a").put("domain", "role");
        types.addObject().put("key", "role/b").put("domain", "role");
        types.addObject().put("key", "role/c").put("domain", "role");
        types.addObject().put("key", "role/d").put("domain", "role");
        ArrayNode relations = ((ObjectNode) body.get("typeCatalog")).putArray("relations");
        relations.addObject().put("parent", "role/a").put("child", "role/b");
        relations.addObject().put("parent", "role/b").put("child", "role/c");
        relations.addObject().put("parent", "role/c").put("child", "role/d");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void providerKeyWithSlotSeparatorIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ((ObjectNode) body.path("sharedProviders").get(0)).put("providerKey", "source::provider_ahri_q");
        ((ObjectNode) body.path("combatantTemplates").get(0).path("providers").get(0))
            .put("definitionRef", "source::provider_ahri_q");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void nonEmptyInitialAbilityStateIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ((ObjectNode) body.path("combatantTemplates").get(0).path("providers").get(0))
            .putObject("initialAbilityState")
            .put("q", true);
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void directRuntimeFormulaPathIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ObjectNode formula = body.putArray("formulas").addObject();
        formula.put("key", "dmg");
        formula.putObject("expression").put("op", "path").put("path", "source.attr.ad");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void ownerAttrFormulaPathAndSelfOperationTargetPass() throws Exception {
        ObjectNode body = minimalValidSource();
        ObjectNode formula = body.putArray("formulas").addObject();
        formula.put("key", "dmg");
        ObjectNode expr = formula.putObject("expression");
        expr.put("op", "add");
        ArrayNode args = expr.putArray("args");
        args.addObject().put("op", "path").put("path", "$owner.attr.ad");
        args.addObject().put("op", "path").put("path", "$opponent.resource.mana");
        args.addObject().put("op", "path").put("path", "ability.param.rank");
        args.addObject().put("op", "ref").put("ref", "dmg");

        ObjectNode provider = (ObjectNode) body.path("sharedProviders").get(0);
        ObjectNode operation = provider.putArray("operations").addObject();
        operation.put("target", "self");
        operation.put("kind", "apply_provider");
        operation.put("providerDefinitionRef", "provider_ahri_q");
        ObjectNode modifier = provider.putArray("modifiers").addObject();
        modifier.put("target", "$owner.attr.ad");
        ObjectNode listener = provider.putArray("listeners").addObject();
        listener.put("abilityRef", "$owner.provider[skill:ahri_q].ability[cast]");

        WasmCatalogValidator.ValidatedSource validated = validator.validateAndNormalize(body);
        assertEquals("generic-p0", validated.schemaVersion());
    }

    @Test
    void operationTargetSourceIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ObjectNode provider = (ObjectNode) body.path("sharedProviders").get(0);
        ObjectNode operation = provider.putArray("operations").addObject();
        operation.put("target", "source");
        operation.put("kind", "damage");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void unresolvedFormulaRefIsSemanticError() throws Exception {
        ObjectNode body = minimalValidSource();
        ObjectNode formula = body.putArray("formulas").addObject();
        formula.put("key", "dmg");
        formula.putObject("expression").put("op", "ref").put("ref", "missing_formula");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void missingResolvedAttributeSlotIsInvalidBody() throws Exception {
        ObjectNode body = minimalValidSource();
        ObjectNode ad = (ObjectNode) body.path("combatantTemplates").get(0).path("attributes").path("ad");
        ad.remove("resolved");
        ApiException ex = assertThrows(ApiException.class, () -> validator.validateAndNormalize(body));
        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    private ObjectNode minimalValidSource() throws Exception {
        return (ObjectNode) objectMapper.readTree("""
            {
              "schemaVersion": "generic-p0",
              "typeCatalog": {
                "types": [
                  {"key": "role/assassin", "domain": "role"}
                ],
                "relations": []
              },
              "combatantTemplates": [
                {
                  "templateKey": "champion:ahri",
                  "attributes": {
                    "ad": {"base": 50, "current": 50, "max": 50, "resolved": 50}
                  },
                  "resources": {
                    "mana": {"current": 100, "max": 100}
                  },
                  "providers": [
                    {
                      "providerRef": "skill:ahri_q",
                      "definitionRef": "provider_ahri_q"
                    }
                  ]
                }
              ],
              "sharedProviders": [
                {"providerKey": "provider_ahri_q"}
              ],
              "rules": {
                "operations": [],
                "modifiers": [],
                "listeners": [],
                "triggerRules": []
              },
              "formulas": [],
              "settings": {}
            }
            """);
    }
}
