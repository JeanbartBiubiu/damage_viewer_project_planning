package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.error.ApiException;

class WasmLegacyAdcBootstrapAdapterTest {

    private final WasmLegacyAdcBootstrapAdapter adapter = new WasmLegacyAdcBootstrapAdapter();

    @Test
    void convertsNineTemplatesDeterministicallyWithResourceAndAttributeMapping() throws Exception {
        ObjectNode bundle = fixtureBundle();
        WasmLegacyAdcBootstrapAdapter.Result result = adapter.convert(bundle, "v2_batch_b_hero_passives_002");

        ObjectNode source = result.source();
        ArrayNode templates = (ArrayNode) source.path("combatantTemplates");
        assertEquals(9, templates.size());

        List<String> expectedKeys = List.of(
            "champion:vayne",
            "champion:teemo",
            "champion:varus",
            "champion:kaisa",
            "champion:twitch",
            "champion:kogmaw",
            "training_dummy:squishy",
            "training_dummy:fighter",
            "training_dummy:tank"
        );
        List<String> actualKeys = new ArrayList<>();
        for (JsonNode template : templates) {
            actualKeys.add(template.path("templateKey").asText());
        }
        assertEquals(expectedKeys, actualKeys);

        ObjectNode vayne = (ObjectNode) templates.get(0);
        assertEquals("薇恩", vayne.path("displayName").asText());
        assertEquals(List.of("role/marksman"), toTextList(vayne.path("types")));
        assertEquals(List.of("legacy-bootstrap", "legacy-adc"), toTextList(vayne.path("tags")));
        assertEquals(0, vayne.path("providers").size());
        assertEquals(550, vayne.path("attributes").path("hp").path("base").asInt());
        assertEquals(550, vayne.path("attributes").path("hp").path("current").asInt());
        assertEquals(550, vayne.path("attributes").path("hp").path("max").asInt());
        assertEquals(550, vayne.path("attributes").path("hp").path("resolved").asInt());
        assertEquals(232, vayne.path("resources").path("mana").path("current").asInt());
        assertEquals(232, vayne.path("resources").path("mana").path("max").asInt());
        assertFalse(vayne.path("attributes").has("mana"));
        assertFalse(vayne.has("statsByLevel"));

        ObjectNode dummy = (ObjectNode) templates.get(6);
        assertEquals(List.of("role/training_dummy"), toTextList(dummy.path("types")));
        assertEquals(List.of("legacy-bootstrap", "training-dummy"), toTextList(dummy.path("tags")));

        assertEquals(2, source.path("typeCatalog").path("types").size());
        assertEquals("role/marksman", source.path("typeCatalog").path("types").get(0).path("key").asText());
        assertEquals("role/training_dummy", source.path("typeCatalog").path("types").get(1).path("key").asText());
        assertEquals(0, source.path("typeCatalog").path("relations").size());
        assertFalse(source.path("typeCatalog").path("types").get(0).has("group"));
        assertEquals(0, source.path("sharedProviders").size());
        assertEquals(0, source.path("formulas").size());
        assertEquals(0, source.path("rules").path("operations").size());
        assertEquals(0, source.path("rules").path("modifiers").size());
        assertEquals(0, source.path("rules").path("listeners").size());
        assertEquals(0, source.path("rules").path("triggerRules").size());
        assertTrue(source.path("settings").isObject());
        assertEquals(0, source.path("settings").size());

        ObjectNode report = result.importReport();
        assertEquals("v2_batch_b_hero_passives_002", report.path("sourceVersionCode").asText());
        assertEquals(WasmLegacyAdcBootstrapAdapter.HERO_IDS, toTextList(report.path("importedHeroIds")));
        assertEquals(WasmLegacyAdcBootstrapAdapter.DUMMY_IDS, toTextList(report.path("importedDummyIds")));
        assertEquals(expectedKeys, toTextList(report.path("templateKeys")));
        assertEquals(expectedUnmappedSkillIds(), toTextList(report.path("unmappedLegacySkillIds")));
        assertFalse(source.toString().contains("skillMounts"));
        assertFalse(source.toString().contains("mechanicsConfig"));
        assertFalse(source.toString().contains("dpsPassiveEffects"));
    }

    @Test
    void mapsEnergyToResourcesAndRejectsNegativeResource() {
        ObjectNode bundle = minimalValidBundle();
        ObjectNode hero = findHero(bundle, "hero_teemo");
        ObjectNode baseStats = (ObjectNode) hero.get("baseStats");
        baseStats.remove("mana");
        baseStats.put("energy", 200);

        ObjectNode teemoTemplate = (ObjectNode) adapter.convert(bundle, "v1").source()
            .path("combatantTemplates").get(1);
        assertEquals(200, teemoTemplate.path("resources").path("energy").path("current").asInt());
        assertFalse(teemoTemplate.path("attributes").has("energy"));

        baseStats.put("energy", -1);
        ApiException ex = assertThrows(ApiException.class, () -> adapter.convert(bundle, "v1"));
        assertEquals("422.SEMANTIC_ERROR", ex.getCode());
    }

    @Test
    void rejectsMissingHeroAndNonNumericBaseStat() {
        ObjectNode missingHero = minimalValidBundle();
        ArrayNode heroes = (ArrayNode) missingHero.get("heroes");
        for (int i = heroes.size() - 1; i >= 0; i--) {
            if ("hero_vayne".equals(heroes.get(i).path("heroId").asText())) {
                heroes.remove(i);
            }
        }
        ApiException missing = assertThrows(ApiException.class, () -> adapter.convert(missingHero, "v1"));
        assertEquals("422.SEMANTIC_ERROR", missing.getCode());

        ObjectNode badStat = minimalValidBundle();
        ((ObjectNode) findHero(badStat, "hero_vayne").get("baseStats")).put("hp", "nope");
        ApiException bad = assertThrows(ApiException.class, () -> adapter.convert(badStat, "v1"));
        assertEquals("422.SEMANTIC_ERROR", bad.getCode());
    }

    @Test
    void rejectsDuplicateRequiredEntityAndMissingSkillsArray() {
        ObjectNode dup = minimalValidBundle();
        ((ArrayNode) dup.get("heroes")).add(findHero(dup, "hero_vayne").deepCopy());
        ApiException duplicate = assertThrows(ApiException.class, () -> adapter.convert(dup, "v1"));
        assertEquals("422.SEMANTIC_ERROR", duplicate.getCode());

        ObjectNode noSkills = minimalValidBundle();
        noSkills.remove("skills");
        ApiException missingSkills = assertThrows(ApiException.class, () -> adapter.convert(noSkills, "v1"));
        assertEquals("422.SEMANTIC_ERROR", missingSkills.getCode());
    }

    @Test
    void ignoresItemOwnedAndNullOwnerSkillsInUnmappedReport() throws Exception {
        ObjectNode bundle = minimalValidBundle();
        ArrayNode skills = (ArrayNode) bundle.get("skills");
        skills.removeAll();
        skills.addObject()
            .put("skillId", "skill_z_adc")
            .put("ownerType", "hero")
            .put("ownerId", "hero_vayne");
        skills.addObject()
            .put("skillId", "skill_a_adc")
            .put("ownerType", "hero")
            .put("ownerId", "hero_vayne");
        skills.addObject()
            .put("skillId", "skill_item_only")
            .put("ownerType", "item")
            .put("ownerId", "item_x");
        skills.addObject()
            .put("skillId", "skill_lol_basic_attack_default")
            .putNull("ownerType")
            .putNull("ownerId");
        skills.addObject()
            .put("skillId", "skill_other_hero")
            .put("ownerType", "hero")
            .put("ownerId", "hero_ahri");

        List<String> unmapped = toTextList(adapter.convert(bundle, "v1").importReport().path("unmappedLegacySkillIds"));
        assertEquals(List.of("skill_a_adc", "skill_z_adc"), unmapped);
    }

    private ObjectNode fixtureBundle() throws Exception {
        ObjectNode bundle = minimalValidBundle();
        ArrayNode skills = (ArrayNode) bundle.get("skills");
        skills.removeAll();
        for (String skillId : expectedUnmappedSkillIds()) {
            String ownerId = ownerIdForFixtureSkill(skillId);
            skills.addObject()
                .put("skillId", skillId)
                .put("ownerType", "hero")
                .put("ownerId", ownerId)
                .putObject("mechanicsConfig")
                .putArray("dpsPassiveEffects");
        }
        skills.addObject()
            .put("skillId", "skill_item_blade")
            .put("ownerType", "item")
            .put("ownerId", "item_blade");
        skills.addObject()
            .put("skillId", "skill_lol_basic_attack_default")
            .putNull("ownerType")
            .putNull("ownerId");
        return bundle;
    }

    private ObjectNode minimalValidBundle() {
        ObjectNode bundle = JsonNodeFactory.instance.objectNode();
        ArrayNode heroes = bundle.putArray("heroes");
        for (String heroId : WasmLegacyAdcBootstrapAdapter.HERO_IDS) {
            heroes.add(hero(heroId, displayName(heroId), true));
        }
        for (String dummyId : WasmLegacyAdcBootstrapAdapter.DUMMY_IDS) {
            heroes.add(hero(dummyId, displayName(dummyId), false));
        }
        // Extra unrelated hero must be ignored.
        heroes.add(hero("hero_ahri", "阿狸", true));
        bundle.putArray("skills");
        bundle.putArray("skillMounts");
        return bundle;
    }

    private ObjectNode hero(String heroId, String name, boolean withMana) {
        ObjectNode hero = JsonNodeFactory.instance.objectNode();
        hero.put("heroId", heroId);
        hero.put("name", name);
        ObjectNode baseStats = hero.putObject("baseStats");
        baseStats.put("hp", heroId.contains("tank") ? 3000 : 550);
        baseStats.put("ad", 60);
        baseStats.put("attack_speed", 0.658);
        if (withMana) {
            baseStats.put("mana", 232);
        }
        ObjectNode statsByLevel = hero.putObject("statsByLevel");
        statsByLevel.putArray("hp").add(0).add(10);
        return hero;
    }

    private ObjectNode findHero(ObjectNode bundle, String heroId) {
        for (JsonNode node : bundle.path("heroes")) {
            if (heroId.equals(node.path("heroId").asText())) {
                return (ObjectNode) node;
            }
        }
        throw new IllegalStateException("missing " + heroId);
    }

    private static List<String> expectedUnmappedSkillIds() {
        return List.of(
            "skill_kaisa_p_plasma_dps_v2",
            "skill_kogmaw_q_caustic_spittle_passive_dps_v2",
            "skill_kogmaw_w_bio_arcane_barrage_dps_v2",
            "skill_teemo_e_toxic_shot_dps_v2",
            "skill_teemo_p_guerrilla_warfare_attack_speed_dps_v2",
            "skill_twitch_p_deadly_venom_dps_v2",
            "skill_twitch_q_ambush_attack_speed_dps_v2",
            "skill_varus_p_revenge_champion_takedown_attack_speed_dps_v2",
            "skill_varus_p_revenge_minion_kill_attack_speed_dps_v2",
            "skill_varus_w_blighted_quiver_dps_v2",
            "skill_vayne_w_silver_bolts_dps_v2"
        );
    }

    private static String ownerIdForFixtureSkill(String skillId) {
        if (skillId.contains("vayne")) {
            return "hero_vayne";
        }
        if (skillId.contains("teemo")) {
            return "hero_teemo";
        }
        if (skillId.contains("varus")) {
            return "hero_varus";
        }
        if (skillId.contains("kaisa")) {
            return "hero_kaisa";
        }
        if (skillId.contains("twitch")) {
            return "hero_twitch";
        }
        return "hero_kogmaw";
    }

    private static String displayName(String id) {
        return switch (id) {
            case "hero_vayne" -> "薇恩";
            case "hero_teemo" -> "提莫";
            case "hero_varus" -> "韦鲁斯";
            case "hero_kaisa" -> "卡莎";
            case "hero_twitch" -> "图奇";
            case "hero_kogmaw" -> "克格莫";
            case "target_dummy_squishy" -> "脆皮假人";
            case "target_dummy_fighter" -> "战士假人";
            case "target_dummy_tank" -> "坦克假人";
            default -> id;
        };
    }

    private static List<String> toTextList(JsonNode node) {
        List<String> out = new ArrayList<>();
        for (JsonNode child : node) {
            out.add(child.asText());
        }
        return out;
    }
}
