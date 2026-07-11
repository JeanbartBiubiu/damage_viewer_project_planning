package xyz.game.datamanage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.error.ApiException;

/**
 * Pure boundary: convert a selected legacy published Bundle snapshot into the first
 * unpublished WasmCatalogSourceV1 draft for the fixed LoL ADC + training-dummy set.
 * Does not invent generic Wasm providers from legacy DPS mechanics.
 */
public final class WasmLegacyAdcBootstrapAdapter {

    public static final List<String> HERO_IDS = List.of(
        "hero_vayne",
        "hero_teemo",
        "hero_varus",
        "hero_kaisa",
        "hero_twitch",
        "hero_kogmaw"
    );

    public static final List<String> DUMMY_IDS = List.of(
        "target_dummy_squishy",
        "target_dummy_fighter",
        "target_dummy_tank"
    );

    private static final Set<String> HERO_ID_SET = Set.copyOf(HERO_IDS);
    private static final Set<String> REQUIRED_IDS;
    private static final Set<String> RESOURCE_KEYS = Set.of("mana", "energy");

    static {
        Set<String> required = new HashSet<>();
        required.addAll(HERO_IDS);
        required.addAll(DUMMY_IDS);
        REQUIRED_IDS = Set.copyOf(required);
    }

    public record Result(ObjectNode source, ObjectNode importReport) {}

    public Result convert(ObjectNode legacyBundle, String sourceVersionCode) {
        if (legacyBundle == null || !legacyBundle.isObject()) {
            throw semantic("Legacy bundle snapshot must be an object", Map.of("path", "/"));
        }
        if (sourceVersionCode == null || sourceVersionCode.isBlank()) {
            throw semantic("sourceVersionCode is required", Map.of("path", "/sourceVersionCode"));
        }

        JsonNode heroesNode = legacyBundle.get("heroes");
        if (heroesNode == null || !heroesNode.isArray()) {
            throw semantic("Legacy bundle heroes must be an array", Map.of("path", "/heroes"));
        }
        JsonNode skillsNode = legacyBundle.get("skills");
        if (skillsNode == null || !skillsNode.isArray()) {
            throw semantic("Legacy bundle skills must be an array", Map.of("path", "/skills"));
        }

        Map<String, ObjectNode> selectedHeroes = indexRequiredHeroesExactlyOnce((ArrayNode) heroesNode);
        List<String> unmappedSkillIds = collectUnmappedSkillIds((ArrayNode) skillsNode);

        ObjectNode source = JsonNodeFactory.instance.objectNode();
        source.put("schemaVersion", WasmCatalogCanonicalHash.SCHEMA_VERSION);

        ObjectNode typeCatalog = source.putObject("typeCatalog");
        ArrayNode types = typeCatalog.putArray("types");
        types.addObject().put("key", "role/marksman").put("domain", "role");
        types.addObject().put("key", "role/training_dummy").put("domain", "role");
        typeCatalog.putArray("relations");

        ArrayNode templates = source.putArray("combatantTemplates");
        List<String> templateKeys = new ArrayList<>();
        List<String> importedHeroIds = new ArrayList<>();
        List<String> importedDummyIds = new ArrayList<>();

        for (String heroId : HERO_IDS) {
            ObjectNode hero = selectedHeroes.get(heroId);
            String templateKey = templateKeyForHero(heroId);
            templates.add(buildTemplate(hero, templateKey, true));
            templateKeys.add(templateKey);
            importedHeroIds.add(heroId);
        }
        for (String dummyId : DUMMY_IDS) {
            ObjectNode dummy = selectedHeroes.get(dummyId);
            String templateKey = templateKeyForDummy(dummyId);
            templates.add(buildTemplate(dummy, templateKey, false));
            templateKeys.add(templateKey);
            importedDummyIds.add(dummyId);
        }

        source.putArray("sharedProviders");
        ObjectNode rules = source.putObject("rules");
        rules.putArray("operations");
        rules.putArray("modifiers");
        rules.putArray("listeners");
        rules.putArray("triggerRules");
        source.putArray("formulas");
        source.putObject("settings");

        ObjectNode importReport = JsonNodeFactory.instance.objectNode();
        importReport.put("sourceVersionCode", sourceVersionCode);
        ArrayNode heroIdsOut = importReport.putArray("importedHeroIds");
        importedHeroIds.forEach(heroIdsOut::add);
        ArrayNode dummyIdsOut = importReport.putArray("importedDummyIds");
        importedDummyIds.forEach(dummyIdsOut::add);
        ArrayNode templateKeysOut = importReport.putArray("templateKeys");
        templateKeys.forEach(templateKeysOut::add);
        ArrayNode unmappedOut = importReport.putArray("unmappedLegacySkillIds");
        unmappedSkillIds.forEach(unmappedOut::add);

        return new Result(source, importReport);
    }

    private Map<String, ObjectNode> indexRequiredHeroesExactlyOnce(ArrayNode heroes) {
        Map<String, ObjectNode> selected = new HashMap<>();
        for (int i = 0; i < heroes.size(); i++) {
            JsonNode node = heroes.get(i);
            if (node == null || !node.isObject()) {
                throw semantic("Legacy hero entry must be an object", Map.of("path", "/heroes/" + i));
            }
            ObjectNode hero = (ObjectNode) node;
            JsonNode heroIdNode = hero.get("heroId");
            if (heroIdNode == null || !heroIdNode.isTextual() || heroIdNode.asText().isBlank()) {
                throw semantic("Legacy hero.heroId is required", Map.of("path", "/heroes/" + i + "/heroId"));
            }
            String heroId = heroIdNode.asText();
            if (!REQUIRED_IDS.contains(heroId)) {
                continue;
            }
            if (selected.containsKey(heroId)) {
                throw semantic(
                    "Legacy bootstrap entity must appear exactly once",
                    Map.of("path", "/heroes", "heroId", heroId, "reason", "duplicate")
                );
            }
            selected.put(heroId, hero);
        }
        for (String requiredId : REQUIRED_IDS) {
            if (!selected.containsKey(requiredId)) {
                throw semantic(
                    "Legacy bootstrap entity is missing from selected snapshot",
                    Map.of("path", "/heroes", "heroId", requiredId, "reason", "missing")
                );
            }
        }
        return selected;
    }

    private List<String> collectUnmappedSkillIds(ArrayNode skills) {
        TreeSet<String> ids = new TreeSet<>();
        for (int i = 0; i < skills.size(); i++) {
            JsonNode node = skills.get(i);
            if (node == null || !node.isObject()) {
                continue;
            }
            JsonNode ownerType = node.get("ownerType");
            JsonNode ownerId = node.get("ownerId");
            JsonNode skillId = node.get("skillId");
            if (ownerType == null || !ownerType.isTextual() || !"hero".equals(ownerType.asText())) {
                continue;
            }
            if (ownerId == null || !ownerId.isTextual() || !HERO_ID_SET.contains(ownerId.asText())) {
                continue;
            }
            if (skillId == null || !skillId.isTextual() || skillId.asText().isBlank()) {
                continue;
            }
            ids.add(skillId.asText());
        }
        return new ArrayList<>(ids);
    }

    private ObjectNode buildTemplate(ObjectNode hero, String templateKey, boolean adc) {
        ObjectNode template = JsonNodeFactory.instance.objectNode();
        template.put("templateKey", templateKey);
        JsonNode name = hero.get("name");
        if (name != null && name.isTextual()) {
            template.put("displayName", name.asText());
        }

        ArrayNode types = template.putArray("types");
        types.add(adc ? "role/marksman" : "role/training_dummy");
        ArrayNode tags = template.putArray("tags");
        tags.add("legacy-bootstrap");
        tags.add(adc ? "legacy-adc" : "training-dummy");

        ObjectNode attributes = template.putObject("attributes");
        ObjectNode resources = template.putObject("resources");
        mapBaseStats(hero, attributes, resources, templateKey);
        template.putArray("providers");
        return template;
    }

    private void mapBaseStats(
        ObjectNode hero,
        ObjectNode attributes,
        ObjectNode resources,
        String templateKey
    ) {
        JsonNode baseStatsNode = hero.get("baseStats");
        if (baseStatsNode == null || !baseStatsNode.isObject()) {
            throw semantic(
                "Legacy hero.baseStats is required and must be object",
                Map.of("path", "/heroes/" + templateKey + "/baseStats")
            );
        }
        ObjectNode baseStats = (ObjectNode) baseStatsNode;
        Iterator<Map.Entry<String, JsonNode>> fields = baseStats.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            String key = field.getKey();
            JsonNode value = field.getValue();
            if (value == null || value.isNull() || !value.isNumber()) {
                throw semantic(
                    "Legacy baseStats value must be a finite number",
                    Map.of("path", "/baseStats/" + key, "templateKey", templateKey)
                );
            }
            double numeric = value.asDouble();
            if (!Double.isFinite(numeric)) {
                throw semantic(
                    "Legacy baseStats value must be a finite number",
                    Map.of("path", "/baseStats/" + key, "templateKey", templateKey)
                );
            }
            if (RESOURCE_KEYS.contains(key)) {
                if (numeric < 0) {
                    throw semantic(
                        "Legacy resource baseStats value must be non-negative",
                        Map.of("path", "/baseStats/" + key, "templateKey", templateKey)
                    );
                }
                ObjectNode resource = resources.putObject(key);
                resource.set("current", value);
                resource.set("max", value);
                continue;
            }
            ObjectNode slot = attributes.putObject(key);
            slot.set("base", value);
            slot.set("current", value);
            slot.set("max", value);
            slot.set("resolved", value);
        }
    }

    private static String templateKeyForHero(String heroId) {
        if (!heroId.startsWith("hero_")) {
            throw semantic("Unexpected hero id prefix", Map.of("heroId", heroId));
        }
        return "champion:" + heroId.substring("hero_".length());
    }

    private static String templateKeyForDummy(String dummyId) {
        if (!dummyId.startsWith("target_dummy_")) {
            throw semantic("Unexpected dummy id prefix", Map.of("heroId", dummyId));
        }
        return "training_dummy:" + dummyId.substring("target_dummy_".length());
    }

    private static ApiException semantic(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "422.SEMANTIC_ERROR", message, details);
    }
}
