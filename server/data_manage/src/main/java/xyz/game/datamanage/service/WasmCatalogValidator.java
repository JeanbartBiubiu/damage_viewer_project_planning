package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.support.error.ApiException;

/**
 * Structural (400) and P0 semantic (422) validation for WasmCatalogSourceV1.
 */
@Component
public class WasmCatalogValidator {

    public static final String SCHEMA_VERSION = WasmCatalogCanonicalHash.SCHEMA_VERSION;

    private static final Set<String> ALLOWED_ROOT_FIELDS = Set.of(
        "schemaVersion",
        "typeCatalog",
        "combatantTemplates",
        "sharedProviders",
        "rules",
        "formulas",
        "settings"
    );

    private static final Set<String> FORBIDDEN_ROOT_FIELDS = Set.of(
        "meta",
        "schemaHash",
        "rulesHash",
        "updatedAt"
    );

    private static final Set<String> FORBIDDEN_VERSION_FIELDS = Set.of(
        "startversionid",
        "endversionid",
        "versionid",
        "versioncode",
        "iscurrent",
        "datahash",
        "start_version_id",
        "end_version_id",
        "version_id",
        "version_code",
        "is_current",
        "data_hash",
        "publishedat",
        "generatedat",
        "published_at",
        "generated_at"
    );

    private static final Set<String> FORBIDDEN_LEGACY_KEYS = Set.of(
        "EngineBundleV2",
        "ActionTemplateV2",
        "skillMounts",
        "definitionKey",
        "setHpRaw",
        "set_hp_raw"
    );

    private static final Set<String> RULES_ARRAY_FIELDS = Set.of(
        "operations",
        "modifiers",
        "listeners",
        "triggerRules"
    );

    private static final Pattern TYPE_KEY_PATTERN = Pattern.compile("^([a-z0-9_]+)/([a-z0-9_]+)$");
    private static final Pattern PROVIDER_REF_PATTERN = Pattern.compile("^[^:]+:.+$");
    private static final Pattern ABILITY_REF_PATTERN = Pattern.compile(
        "^\\$(owner|opponent)\\.provider\\[([^\\]]+)\\]\\.ability\\[([^\\]]+)\\]$"
    );
    private static final Pattern ATTR_PATH_PATTERN = Pattern.compile("^\\$(owner|opponent)\\.attr\\.([a-zA-Z0-9_.]+)$");
    private static final Pattern RESOURCE_PATH_PATTERN = Pattern.compile(
        "^\\$(owner|opponent)\\.resource\\.([a-zA-Z0-9_.]+)$"
    );
    private static final Pattern ABILITY_PARAM_PATH_PATTERN = Pattern.compile("^ability\\.param\\.([a-zA-Z0-9_.]+)$");
    private static final Pattern DIRECT_RUNTIME_PATH_PATTERN = Pattern.compile("^(source|target)(\\.|$)");

    public ValidatedSource validateAndNormalize(ObjectNode body) {
        if (body == null || body.isNull() || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        rejectForbiddenRootsAndUnknown(body);
        rejectVersionFields(body, "");
        rejectForbiddenLegacy(body, "");

        String schemaVersion = requireText(body, "schemaVersion", "/schemaVersion");
        if (!SCHEMA_VERSION.equals(schemaVersion)) {
            throw badRequest(
                "schemaVersion must be generic-p0",
                Map.of("path", "/schemaVersion", "reason", "unsupported schemaVersion: " + schemaVersion)
            );
        }

        ObjectNode typeCatalog = requireObject(body, "typeCatalog", "/typeCatalog");
        ArrayNode combatantTemplates = requireArray(body, "combatantTemplates", "/combatantTemplates");
        ArrayNode sharedProviders = requireArray(body, "sharedProviders", "/sharedProviders");
        ObjectNode rules = requireObject(body, "rules", "/rules");
        ArrayNode formulas = requireArray(body, "formulas", "/formulas");
        ObjectNode settings = requireObject(body, "settings", "/settings");

        validateTypeCatalog(typeCatalog);
        Set<String> providerKeys = validateSharedProviders(sharedProviders);
        Set<String> formulaKeys = validateFormulas(formulas, providerKeys);
        validateCombatantTemplates(combatantTemplates, providerKeys);
        validateRulesEmpty(rules);
        validateSettings(settings);
        validateProviderSemantics(sharedProviders, providerKeys, formulaKeys);

        ObjectNode catalogBody = body.deepCopy();
        catalogBody.remove("schemaVersion");

        return new ValidatedSource(schemaVersion, catalogBody);
    }

    public void validateStoredSource(String schemaVersion, ObjectNode catalogBody) {
        ObjectNode reconstructed = catalogBody.deepCopy();
        reconstructed.put("schemaVersion", schemaVersion == null ? "" : schemaVersion);
        validateAndNormalize(reconstructed);
    }

    private void rejectForbiddenRootsAndUnknown(ObjectNode body) {
        Iterator<String> names = body.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (FORBIDDEN_ROOT_FIELDS.contains(name)) {
                throw badRequest(
                    "Field is forbidden in Wasm catalog source",
                    Map.of("path", "/" + name, "reason", "field not allowed: " + name)
                );
            }
            if (!ALLOWED_ROOT_FIELDS.contains(name)) {
                throw badRequest(
                    "Request body contains unsupported field",
                    Map.of("path", "/" + name, "reason", "field not allowed: " + name)
                );
            }
        }
    }

    private void rejectVersionFields(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String currentPath = path.isBlank() ? "/" + field.getKey() : path + "/" + field.getKey();
                if (FORBIDDEN_VERSION_FIELDS.contains(field.getKey().toLowerCase(Locale.ROOT))) {
                    throw badRequest(
                        "Version fields are forbidden in this request body",
                        Map.of("path", currentPath, "reason", "field not allowed: " + field.getKey())
                    );
                }
                rejectVersionFields(field.getValue(), currentPath);
            }
            return;
        }
        if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                rejectVersionFields(node.get(i), path + "/" + i);
            }
        }
    }

    private void rejectForbiddenLegacy(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String key = field.getKey();
                String currentPath = path.isBlank() ? "/" + key : path + "/" + key;
                if (FORBIDDEN_LEGACY_KEYS.contains(key)) {
                    throw semantic(
                        "Legacy ABI field is forbidden",
                        Map.of("path", currentPath, "reason", "forbidden field: " + key)
                    );
                }
                if (("attributes".equals(key) || "resources".equals(key)) && field.getValue().isArray()) {
                    throw semantic(
                        key + " must be an object map, not an array",
                        Map.of("path", currentPath, "reason", "array-form " + key + " is forbidden")
                    );
                }
                rejectForbiddenLegacy(field.getValue(), currentPath);
            }
            return;
        }
        if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                rejectForbiddenLegacy(node.get(i), path + "/" + i);
            }
            return;
        }
        if (node.isTextual()) {
            String text = node.asText();
            if (FORBIDDEN_LEGACY_KEYS.contains(text)
                || "EngineBundleV2".equals(text)
                || "ActionTemplateV2".equals(text)
                || "setHpRaw".equals(text)
                || "set_hp_raw".equals(text)) {
                throw semantic(
                    "Legacy ABI term is forbidden",
                    Map.of("path", path, "reason", "forbidden value: " + text)
                );
            }
        }
    }

    private void validateTypeCatalog(ObjectNode typeCatalog) {
        ArrayNode types = requireArray(typeCatalog, "types", "/typeCatalog/types");
        ArrayNode relations = requireArray(typeCatalog, "relations", "/typeCatalog/relations");

        Set<String> typeKeys = new LinkedHashSet<>();
        for (int i = 0; i < types.size(); i++) {
            String path = "/typeCatalog/types/" + i;
            ObjectNode type = requireObjectAt(types.get(i), path);
            String key = requireText(type, "key", path + "/key");
            String domain = requireText(type, "domain", path + "/domain");
            Matcher matcher = TYPE_KEY_PATTERN.matcher(key);
            if (!matcher.matches()) {
                throw semantic(
                    "typeCatalog.types[].key must be lowercase domain/name",
                    Map.of("path", path + "/key", "reason", "invalid key format: " + key)
                );
            }
            if (!domain.equals(matcher.group(1))) {
                throw semantic(
                    "typeCatalog.types[].domain must equal key domain part",
                    Map.of("path", path + "/domain", "reason", "domain mismatch")
                );
            }
            if (key.contains("::")) {
                throw semantic(
                    "catalog keys must not contain ::",
                    Map.of("path", path + "/key", "reason", "contains ::")
                );
            }
            if (!typeKeys.add(key)) {
                throw semantic("duplicate type key", Map.of("path", path + "/key", "reason", "duplicate: " + key));
            }
            if (type.has("group") && !type.get("group").isTextual()) {
                throw badRequest("typeCatalog.types[].group must be string", Map.of("path", path + "/group"));
            }
        }

        Map<String, List<String>> children = new HashMap<>();
        Map<String, Integer> indegree = new HashMap<>();
        for (String key : typeKeys) {
            children.put(key, new ArrayList<>());
            indegree.put(key, 0);
        }
        for (int i = 0; i < relations.size(); i++) {
            String path = "/typeCatalog/relations/" + i;
            ObjectNode relation = requireObjectAt(relations.get(i), path);
            String parent = requireText(relation, "parent", path + "/parent");
            String child = requireText(relation, "child", path + "/child");
            if (!typeKeys.contains(parent)) {
                throw semantic("relation parent does not exist", Map.of("path", path + "/parent", "reason", parent));
            }
            if (!typeKeys.contains(child)) {
                throw semantic("relation child does not exist", Map.of("path", path + "/child", "reason", child));
            }
            children.get(parent).add(child);
            indegree.put(child, indegree.get(child) + 1);
        }

        // Acyclicity via Kahn; also enforce max depth <= 2 from any root.
        Deque<String> queue = new ArrayDeque<>();
        for (Map.Entry<String, Integer> entry : indegree.entrySet()) {
            if (entry.getValue() == 0) {
                queue.add(entry.getKey());
            }
        }
        int visited = 0;
        Map<String, Integer> depth = new HashMap<>();
        for (String root : queue) {
            depth.put(root, 0);
        }
        while (!queue.isEmpty()) {
            String node = queue.removeFirst();
            visited++;
            int nodeDepth = depth.getOrDefault(node, 0);
            for (String child : children.getOrDefault(node, List.of())) {
                int childDepth = nodeDepth + 1;
                if (childDepth > 2) {
                    throw semantic(
                        "type relation depth must be <= 2",
                        Map.of("path", "/typeCatalog/relations", "reason", "depth exceeded at " + child)
                    );
                }
                depth.merge(child, childDepth, Math::max);
                int next = indegree.get(child) - 1;
                indegree.put(child, next);
                if (next == 0) {
                    queue.add(child);
                }
            }
        }
        if (visited != typeKeys.size()) {
            throw semantic("type relations contain a cycle", Map.of("path", "/typeCatalog/relations"));
        }
    }

    private Set<String> validateSharedProviders(ArrayNode sharedProviders) {
        Set<String> providerKeys = new LinkedHashSet<>();
        for (int i = 0; i < sharedProviders.size(); i++) {
            String path = "/sharedProviders/" + i;
            ObjectNode provider = requireObjectAt(sharedProviders.get(i), path);
            String providerKey = requireText(provider, "providerKey", path + "/providerKey");
            rejectCatalogKeyWithSlot(providerKey, path + "/providerKey");
            if (!providerKeys.add(providerKey)) {
                throw semantic("duplicate providerKey", Map.of("path", path + "/providerKey", "reason", providerKey));
            }
        }
        return providerKeys;
    }

    private Set<String> validateFormulas(ArrayNode formulas, Set<String> providerKeys) {
        Set<String> formulaKeys = new LinkedHashSet<>();
        for (int i = 0; i < formulas.size(); i++) {
            String path = "/formulas/" + i;
            ObjectNode formula = requireObjectAt(formulas.get(i), path);
            String key = requireText(formula, "key", path + "/key");
            rejectCatalogKeyWithSlot(key, path + "/key");
            if (!formulaKeys.add(key)) {
                throw semantic("duplicate formula key", Map.of("path", path + "/key", "reason", key));
            }
            if (!formula.has("expression")) {
                throw badRequest("formulas[].expression is required", Map.of("path", path + "/expression"));
            }
            validateExpressionTree(formula.get("expression"), path + "/expression", formulaKeys, true);
        }
        // Second pass: refs must resolve (allow forward refs within formulas list).
        for (int i = 0; i < formulas.size(); i++) {
            String path = "/formulas/" + i;
            validateExpressionTree(formulas.get(i).get("expression"), path + "/expression", formulaKeys, false);
        }
        return formulaKeys;
    }

    private void validateCombatantTemplates(ArrayNode templates, Set<String> providerKeys) {
        if (templates.isEmpty()) {
            throw semantic(
                "combatantTemplates must contain at least one template",
                Map.of("path", "/combatantTemplates", "reason", "empty")
            );
        }
        Set<String> templateKeys = new HashSet<>();
        for (int i = 0; i < templates.size(); i++) {
            String path = "/combatantTemplates/" + i;
            ObjectNode template = requireObjectAt(templates.get(i), path);
            String templateKey = requireText(template, "templateKey", path + "/templateKey");
            rejectCatalogKeyWithSlot(templateKey, path + "/templateKey");
            if (!templateKeys.add(templateKey)) {
                throw semantic("duplicate templateKey", Map.of("path", path + "/templateKey", "reason", templateKey));
            }

            ObjectNode attributes = requireObject(template, "attributes", path + "/attributes");
            Iterator<Map.Entry<String, JsonNode>> attrIt = attributes.fields();
            while (attrIt.hasNext()) {
                Map.Entry<String, JsonNode> entry = attrIt.next();
                String attrPath = path + "/attributes/" + entry.getKey();
                ObjectNode slot = requireObjectAt(entry.getValue(), attrPath);
                requireFiniteNumber(slot, "base", attrPath + "/base");
                requireFiniteNumber(slot, "current", attrPath + "/current");
                requireFiniteNumber(slot, "max", attrPath + "/max");
                requireFiniteNumber(slot, "resolved", attrPath + "/resolved");
            }

            ObjectNode resources = requireObject(template, "resources", path + "/resources");
            Iterator<Map.Entry<String, JsonNode>> resIt = resources.fields();
            while (resIt.hasNext()) {
                Map.Entry<String, JsonNode> entry = resIt.next();
                String resPath = path + "/resources/" + entry.getKey();
                ObjectNode slot = requireObjectAt(entry.getValue(), resPath);
                requireFiniteNumber(slot, "current", resPath + "/current");
                requireFiniteNumber(slot, "max", resPath + "/max");
            }

            ArrayNode providers = requireArray(template, "providers", path + "/providers");
            for (int j = 0; j < providers.size(); j++) {
                String mountPath = path + "/providers/" + j;
                ObjectNode mount = requireObjectAt(providers.get(j), mountPath);
                String providerRef = requireText(mount, "providerRef", mountPath + "/providerRef");
                if (!PROVIDER_REF_PATTERN.matcher(providerRef).matches() || providerRef.contains("::")) {
                    throw semantic(
                        "providerRef must be kind:stableId",
                        Map.of("path", mountPath + "/providerRef", "reason", providerRef)
                    );
                }
                String definitionRef = requireText(mount, "definitionRef", mountPath + "/definitionRef");
                rejectCatalogKeyWithSlot(definitionRef, mountPath + "/definitionRef");
                if (!providerKeys.contains(definitionRef)) {
                    throw semantic(
                        "definitionRef must reference sharedProviders[].providerKey",
                        Map.of("path", mountPath + "/definitionRef", "reason", definitionRef)
                    );
                }
                if (mount.has("initialState") && !mount.get("initialState").isObject()) {
                    throw badRequest("initialState must be object", Map.of("path", mountPath + "/initialState"));
                }
                if (mount.has("initialAbilityState")) {
                    JsonNode abilityState = mount.get("initialAbilityState");
                    if (!abilityState.isObject()) {
                        throw badRequest(
                            "initialAbilityState must be object",
                            Map.of("path", mountPath + "/initialAbilityState")
                        );
                    }
                    if (!abilityState.isEmpty()) {
                        throw semantic(
                            "initialAbilityState must be empty or absent in P0",
                            Map.of("path", mountPath + "/initialAbilityState", "reason", "non-empty")
                        );
                    }
                }
            }

            if (template.has("types") && !template.get("types").isArray()) {
                throw badRequest("types must be array", Map.of("path", path + "/types"));
            }
            if (template.has("tags") && !template.get("tags").isArray()) {
                throw badRequest("tags must be array", Map.of("path", path + "/tags"));
            }
            if (template.has("displayName") && !template.get("displayName").isTextual()) {
                throw badRequest("displayName must be string", Map.of("path", path + "/displayName"));
            }
        }
    }

    private void validateRulesEmpty(ObjectNode rules) {
        for (String field : RULES_ARRAY_FIELDS) {
            ArrayNode array = requireArray(rules, field, "/rules/" + field);
            if (!array.isEmpty()) {
                throw semantic(
                    "P0 requires rules." + field + " to be an empty array",
                    Map.of("path", "/rules/" + field, "reason", "must be empty")
                );
            }
        }
    }

    private void validateSettings(ObjectNode settings) {
        for (String field : List.of("maxEvents", "maxCommandsPerEvent", "maxQueueEvents", "maxChainDepth")) {
            if (!settings.has(field) || settings.get(field).isNull()) {
                continue;
            }
            JsonNode value = settings.get(field);
            if (!value.isIntegralNumber() && !value.isFloatingPointNumber()) {
                throw badRequest("settings." + field + " must be number", Map.of("path", "/settings/" + field));
            }
        }
    }

    private void validateProviderSemantics(
        ArrayNode sharedProviders,
        Set<String> providerKeys,
        Set<String> formulaKeys
    ) {
        for (int i = 0; i < sharedProviders.size(); i++) {
            String path = "/sharedProviders/" + i;
            ObjectNode provider = (ObjectNode) sharedProviders.get(i);
            walkProviderNode(provider, path, providerKeys, formulaKeys);
        }
    }

    private void walkProviderNode(
        JsonNode node,
        String path,
        Set<String> providerKeys,
        Set<String> formulaKeys
    ) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isObject()) {
            ObjectNode object = (ObjectNode) node;
            if (object.has("abilityRef") && object.get("abilityRef").isTextual()) {
                validateAbilityRef(object.get("abilityRef").asText(), path + "/abilityRef");
            }
            if (object.has("target") && object.get("target").isTextual()) {
                String target = object.get("target").asText();
                // Distinguish operation.target (self/opponent) vs modifier.target ($owner.attr.*)
                if ("self".equals(target) || "opponent".equals(target)) {
                    // ok for operations
                } else if (ATTR_PATH_PATTERN.matcher(target).matches()) {
                    // ok for attribute modifiers
                } else if (DIRECT_RUNTIME_PATH_PATTERN.matcher(target).find()
                    || "source".equals(target)
                    || "target".equals(target)) {
                    throw semantic(
                        "direct runtime source/target selectors are forbidden in catalog",
                        Map.of("path", path + "/target", "reason", target)
                    );
                } else if (object.has("op") || object.has("kind") || looksLikeOperation(object)) {
                    throw semantic(
                        "operation.target must be self or opponent",
                        Map.of("path", path + "/target", "reason", target)
                    );
                } else {
                    // Preflight: unknown target shape — reject direct runtime, otherwise leave to Wasm.
                    if (DIRECT_RUNTIME_PATH_PATTERN.matcher(target).find()) {
                        throw semantic(
                            "direct runtime source/target paths are forbidden",
                            Map.of("path", path + "/target", "reason", target)
                        );
                    }
                }
            }
            if (object.has("providerDefinitionRef") && object.get("providerDefinitionRef").isTextual()) {
                String ref = object.get("providerDefinitionRef").asText();
                rejectCatalogKeyWithSlot(ref, path + "/providerDefinitionRef");
                if (!providerKeys.contains(ref)) {
                    throw semantic(
                        "apply_provider.providerDefinitionRef must reference catalog provider key",
                        Map.of("path", path + "/providerDefinitionRef", "reason", ref)
                    );
                }
            }
            if (object.has("path") && object.get("path").isTextual()) {
                validateFormulaPath(object.get("path").asText(), path + "/path");
            }
            if (object.has("expression")) {
                validateExpressionTree(object.get("expression"), path + "/expression", formulaKeys, false);
            }
            if (object.has("op") && object.get("op").isTextual() && "ref".equals(object.get("op").asText())) {
                if (object.has("ref") && object.get("ref").isTextual()) {
                    String ref = object.get("ref").asText();
                    rejectCatalogKeyWithSlot(ref, path + "/ref");
                    if (!formulaKeys.contains(ref)) {
                        throw semantic(
                            "formula ref must resolve to formulas[].key",
                            Map.of("path", path + "/ref", "reason", ref)
                        );
                    }
                }
            }

            Iterator<Map.Entry<String, JsonNode>> fields = object.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                walkProviderNode(field.getValue(), path + "/" + field.getKey(), providerKeys, formulaKeys);
            }
            return;
        }
        if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                walkProviderNode(node.get(i), path + "/" + i, providerKeys, formulaKeys);
            }
        }
    }

    private boolean looksLikeOperation(ObjectNode object) {
        return object.has("ops")
            || object.has("operations")
            || (object.has("kind") && object.path("kind").asText("").toLowerCase(Locale.ROOT).contains("op"));
    }

    private void validateAbilityRef(String abilityRef, String path) {
        if (DIRECT_RUNTIME_PATH_PATTERN.matcher(abilityRef).find()
            || abilityRef.startsWith("self.")
            || abilityRef.startsWith("opponent.")
            || !abilityRef.contains(".")) {
            // bare ability key or runtime prefix
            if (!ABILITY_REF_PATTERN.matcher(abilityRef).matches()) {
                throw semantic(
                    "abilityRef must use $owner/$opponent.provider[...].ability[...] form",
                    Map.of("path", path, "reason", abilityRef)
                );
            }
        }
        if (!ABILITY_REF_PATTERN.matcher(abilityRef).matches()) {
            throw semantic(
                "abilityRef must use $owner/$opponent.provider[...].ability[...] form",
                Map.of("path", path, "reason", abilityRef)
            );
        }
    }

    private void validateFormulaPath(String formulaPath, String path) {
        if (DIRECT_RUNTIME_PATH_PATTERN.matcher(formulaPath).find()) {
            throw semantic(
                "direct runtime source/target catalog paths are forbidden",
                Map.of("path", path, "reason", formulaPath)
            );
        }
        if (ATTR_PATH_PATTERN.matcher(formulaPath).matches()
            || RESOURCE_PATH_PATTERN.matcher(formulaPath).matches()
            || ABILITY_PARAM_PATH_PATTERN.matcher(formulaPath).matches()) {
            // resource path must not have .current/.max suffix beyond resource key
            if (formulaPath.matches("^\\$(owner|opponent)\\.resource\\.[^.]+\\.(current|max)$")) {
                throw semantic(
                    "resource path must be $owner/$opponent.resource.<resourceKey> without .current/.max",
                    Map.of("path", path, "reason", formulaPath)
                );
            }
            return;
        }
        throw semantic(
            "formula path must use allowed $owner/$opponent/ability.param vocabulary",
            Map.of("path", path, "reason", formulaPath)
        );
    }

    private void validateExpressionTree(
        JsonNode node,
        String path,
        Set<String> formulaKeys,
        boolean allowUnresolvedRefs
    ) {
        if (node == null || node.isNull()) {
            return;
        }
        if (!node.isObject() && !node.isArray() && !node.isNumber() && !node.isTextual() && !node.isBoolean()) {
            throw badRequest("invalid expression node", Map.of("path", path));
        }
        if (node.isObject()) {
            ObjectNode object = (ObjectNode) node;
            if (object.has("path") && object.get("path").isTextual()) {
                validateFormulaPath(object.get("path").asText(), path + "/path");
            }
            if (object.has("op") && object.get("op").isTextual() && "ref".equals(object.get("op").asText())) {
                if (!object.has("ref") || !object.get("ref").isTextual()) {
                    throw badRequest("op=ref requires textual ref", Map.of("path", path + "/ref"));
                }
                String ref = object.get("ref").asText();
                rejectCatalogKeyWithSlot(ref, path + "/ref");
                if (!allowUnresolvedRefs && !formulaKeys.contains(ref)) {
                    throw semantic(
                        "formula ref must resolve to formulas[].key",
                        Map.of("path", path + "/ref", "reason", ref)
                    );
                }
            }
            for (String child : List.of("args", "expr", "min", "max")) {
                if (object.has(child)) {
                    JsonNode childNode = object.get(child);
                    if ("args".equals(child)) {
                        if (!childNode.isArray()) {
                            throw badRequest("expression.args must be array", Map.of("path", path + "/args"));
                        }
                        for (int i = 0; i < childNode.size(); i++) {
                            validateExpressionTree(childNode.get(i), path + "/args/" + i, formulaKeys, allowUnresolvedRefs);
                        }
                    } else {
                        validateExpressionTree(childNode, path + "/" + child, formulaKeys, allowUnresolvedRefs);
                    }
                }
            }
            // Recurse remaining object fields for nested expressions (preflight).
            Iterator<Map.Entry<String, JsonNode>> fields = object.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String name = field.getKey();
                if (Set.of("args", "expr", "min", "max", "path", "op", "ref", "value", "const").contains(name)) {
                    continue;
                }
                if (field.getValue().isObject() || field.getValue().isArray()) {
                    validateExpressionTree(field.getValue(), path + "/" + name, formulaKeys, allowUnresolvedRefs);
                }
            }
            return;
        }
        if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                validateExpressionTree(node.get(i), path + "/" + i, formulaKeys, allowUnresolvedRefs);
            }
        }
    }

    private void rejectCatalogKeyWithSlot(String key, String path) {
        if (key != null && key.contains("::")) {
            throw semantic(
                "catalog keys must not contain ::",
                Map.of("path", path, "reason", "contains ::")
            );
        }
    }

    private String requireText(ObjectNode node, String field, String path) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            throw badRequest(field + " is required and must be non-empty string", Map.of("path", path));
        }
        return value.asText();
    }

    private ObjectNode requireObject(ObjectNode node, String field, String path) {
        JsonNode value = node.get(field);
        if (value == null || !value.isObject()) {
            throw badRequest(field + " is required and must be object", Map.of("path", path));
        }
        return (ObjectNode) value;
    }

    private ArrayNode requireArray(ObjectNode node, String field, String path) {
        JsonNode value = node.get(field);
        if (value == null || !value.isArray()) {
            throw badRequest(field + " is required and must be array", Map.of("path", path));
        }
        return (ArrayNode) value;
    }

    private ObjectNode requireObjectAt(JsonNode value, String path) {
        if (value == null || !value.isObject()) {
            throw badRequest("expected object", Map.of("path", path));
        }
        return (ObjectNode) value;
    }

    private void requireFiniteNumber(ObjectNode node, String field, String path) {
        JsonNode value = node.get(field);
        if (value == null || !value.isNumber()) {
            throw badRequest(field + " must be a finite number", Map.of("path", path));
        }
        double number = value.asDouble();
        if (!Double.isFinite(number)) {
            throw semantic(field + " must be a finite number", Map.of("path", path, "reason", "non-finite"));
        }
    }

    private ApiException badRequest(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_BODY", message, details);
    }

    private ApiException semantic(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "422.SEMANTIC_ERROR", message, details);
    }

    public record ValidatedSource(String schemaVersion, ObjectNode catalogBody) {
    }
}
