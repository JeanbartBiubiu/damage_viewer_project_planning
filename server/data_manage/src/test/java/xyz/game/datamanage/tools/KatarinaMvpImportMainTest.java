package xyz.game.datamanage.tools;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class KatarinaMvpImportMainTest {

    private static final String DEFAULT_SEED_FILE = "\u5361\u7279\u7433\u5a1c-MVP\u79cd\u5b50\u6570\u636e.json";

    @Test
    void parseArgs_shouldApplyOverrides() {
        KatarinaMvpImportMain.ImportOptions options = KatarinaMvpImportMain.parseArgs(
            new String[]{
                "--apiBaseUrl=http://localhost:18080",
                "--seedFile=seed.json",
                "--gameId=lol",
                "--gameName=League of Legends CN",
                "--versionCode=mvp_override_001",
                "--adminToken=token-value",
                "--bootstrapDb",
                "--skipPublish",
                "--dryRun",
                "--dbUrl=jdbc:postgresql://127.0.0.1:5432/test",
                "--dbUsername=postgres",
                "--dbPassword=postgres"
            }
        );

        assertEquals("http://localhost:18080", options.apiBaseUrl());
        assertEquals("seed.json", options.seedFile());
        assertEquals("lol", options.gameId());
        assertEquals("League of Legends CN", options.gameName());
        assertEquals("mvp_override_001", options.versionCode());
        assertEquals("token-value", options.adminToken());
        assertTrue(options.bootstrapDb());
        assertFalse(options.publish());
        assertTrue(options.dryRun());
        assertEquals("jdbc:postgresql://127.0.0.1:5432/test", options.dbUrl());
    }

    @Test
    void parseArgs_shouldAllowMissingAdminToken() {
        KatarinaMvpImportMain.ImportOptions options = KatarinaMvpImportMain.parseArgs(
            new String[]{
                "--dryRun"
            }
        );

        assertEquals(null, options.adminToken());
        assertTrue(options.dryRun());
    }

    @Test
    void resolveSeedFile_shouldFindRepositorySeed() {
        Path seedFile = KatarinaMvpImportMain.resolveSeedFile(null);

        assertTrue(Files.isRegularFile(seedFile));
        assertEquals(DEFAULT_SEED_FILE, seedFile.getFileName().toString());
    }

    @Test
    void loadSeed_shouldReadActualKatarinaMvpCounts() throws Exception {
        Path seedFile = KatarinaMvpImportMain.resolveSeedFile(null);

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("mvp_katarina_001", seedData.versionCode());
        assertEquals(2, seedData.ownerCategories().size());
        assertEquals(10, seedData.attributeDefinitions().size());
        assertEquals(2, seedData.heroes().size());
        assertEquals(2, seedData.skills().size());
        assertEquals(2, seedData.items().size());
        assertEquals(0, seedData.types().size());
        assertEquals(0, seedData.typeRelations().size());
        assertEquals(2, seedData.scenarios().size());
    }

    @Test
    void loadSeed_shouldReadV2BatchATargetDummies() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-A-target-dummies.seed.json")
            .toAbsolutePath()
            .normalize();

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("v2_batch_a_target_dummies_001", seedData.versionCode());
        assertEquals(1, seedData.types().size());
        assertEquals(3, seedData.heroes().size());
        assertEquals(3, seedData.typeRelations().size());
        assertEquals("target_dummy_fighter", seedData.heroes().get(1).path("heroId").asText());
        assertEquals(3000, seedData.heroes().get(1).path("baseStats").path("hp").asInt());
        assertEquals(100, seedData.heroes().get(1).path("baseStats").path("armor").asInt());
        assertEquals(80, seedData.heroes().get(1).path("baseStats").path("magic_resist").asInt());
    }

    @Test
    void loadSeed_shouldReadV2BatchBHeroPassives() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-B-hero-passives.seed.json")
            .toAbsolutePath()
            .normalize();

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("v2_batch_b_hero_passives_002", seedData.versionCode());
        assertEquals(2, seedData.ownerCategories().size());
        assertEquals(30, seedData.attributeDefinitions().size());
        assertEquals(1, seedData.types().size());
        assertEquals(9, seedData.heroes().size());
        assertEquals(11, seedData.skills().size());
        assertEquals(3, seedData.typeRelations().size());
        assertEquals("target_dummy", seedData.types().get(0).path("name").asText());
        assertEquals(3000, findByField(seedData.heroes(), "heroId", "target_dummy_fighter")
            .path("baseStats")
            .path("hp")
            .asInt());
        Set<String> heroIds = collectText(seedData.heroes(), "heroId");
        assertTrue(heroIds.contains("hero_vayne"));
        assertTrue(heroIds.contains("hero_teemo"));
        assertTrue(heroIds.contains("hero_varus"));
        assertTrue(heroIds.contains("hero_kaisa"));
        assertTrue(heroIds.contains("hero_twitch"));
        assertTrue(heroIds.contains("hero_kogmaw"));
        for (JsonNode skill : seedData.skills()) {
            if ("hero".equals(skill.path("ownerType").asText())) {
                assertTrue(heroIds.contains(skill.path("ownerId").asText()), "missing hero owner for " + skill.path("skillId").asText());
            }
        }
        assertEquals("skill_vayne_w_silver_bolts_dps_v2", seedData.skills().get(0).path("skillId").asText());
        assertEquals("every_n_basic_attack_hit", seedData.skills().get(0)
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0)
            .path("triggerKind")
            .asText());
        assertEquals(0.05, findByField(seedData.skills(), "skillId", "skill_kogmaw_q_caustic_spittle_passive_dps_v2")
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0)
            .path("operations")
            .get(0)
            .path("value")
            .asDouble());
        assertEquals("kogmaw_w_pre_enabled", findByField(seedData.skills(), "skillId", "skill_kogmaw_w_bio_arcane_barrage_dps_v2")
            .path("mechanicsConfig")
            .path("dpsScenarioStates")
            .get(0)
            .path("stateId")
            .asText());
        assertEquals("teemo_p_after_stealth_attack_speed", findByField(seedData.skills(), "skillId", "skill_teemo_p_guerrilla_warfare_attack_speed_dps_v2")
            .path("mechanicsConfig")
            .path("dpsScenarioStates")
            .get(0)
            .path("stateId")
            .asText());
        JsonNode kaisaOperations = findByField(seedData.skills(), "skillId", "skill_kaisa_p_plasma_dps_v2")
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0)
            .path("operations");
        assertEquals("kaisa_p_plasma_on_hit", kaisaOperations.get(1).path("source").asText());
        assertEquals(0.15, kaisaOperations.get(2).path("targetMissingHpRatio").asDouble());
        assertEquals("attack_start", kaisaOperations.get(2).path("targetMissingHpBasis").asText());
    }

    @Test
    void loadSeed_shouldReadV2BatchCAdcCompletedItems() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-C-adc-items.seed.json")
            .toAbsolutePath()
            .normalize();

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("v2_batch_c_adc_items_001", seedData.versionCode());
        assertEquals(2, seedData.ownerCategories().size());
        assertEquals(16, seedData.attributeDefinitions().size());
        assertEquals(1, seedData.types().size());
        assertEquals(0, seedData.heroes().size());
        assertEquals(0, seedData.skills().size());
        assertEquals(53, seedData.items().size());
        assertEquals(53, seedData.typeRelations().size());
        assertEquals("adc_completed_item", seedData.types().get(0).path("name").asText());
        assertEquals(62002, seedData.types().get(0).path("typeId").asInt());

        Set<String> itemIds = collectText(seedData.items(), "itemId");
        assertTrue(itemIds.contains("3031"));
        assertTrue(itemIds.contains("3153"));
        assertTrue(itemIds.contains("6672"));
        assertFalse(itemIds.contains("3172"));
        assertFalse(itemIds.contains("1001"));

        JsonNode infinityEdge = findByField(seedData.items(), "itemId", "3031");
        assertEquals(75.0, findByField(infinityEdge.path("statModifiers"), "attrKey", "ad").path("value").asDouble(), 0.001);
        assertEquals(0.25, findByField(infinityEdge.path("statModifiers"), "attrKey", "crit_chance").path("value").asDouble(), 0.001);
        assertEquals(0.3, findByField(infinityEdge.path("statModifiers"), "attrKey", "crit_damage").path("value").asDouble(), 0.001);

        JsonNode bork = findByField(seedData.items(), "itemId", "3153");
        assertEquals(40.0, findByField(bork.path("statModifiers"), "attrKey", "ad").path("value").asDouble(), 0.001);
        assertEquals(0.25, findByField(bork.path("statModifiers"), "attrKey", "attack_speed").path("value").asDouble(), 0.001);
        assertEquals(0.1, findByField(bork.path("statModifiers"), "attrKey", "life_steal").path("value").asDouble(), 0.001);

        for (JsonNode relation : seedData.typeRelations()) {
            assertEquals(62002, relation.path("typeId").asInt());
            assertEquals("equipment", relation.path("targetCategory").asText());
            assertTrue(itemIds.contains(relation.path("targetId").asText()));
        }
    }

    @Test
    void loadSeed_shouldReadV2BatchJStatusDamageSeed() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-J-status-damage-migration.seed.json")
            .toAbsolutePath()
            .normalize();

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("v2_batch_j_status_damage_001", seedData.versionCode());
        assertEquals(1, seedData.formulaProfiles().size());
        assertEquals(1, seedData.statusDefinitions().size());
        assertEquals(1, seedData.statusModifierGroups().size());
        assertEquals(1, seedData.statusPeriodicHpEffects().size());
        assertEquals(1, seedData.skills().size());
        assertEquals(
            "apply_status",
            findByField(seedData.skills(), "skillId", "skill_malzahar_e")
                .path("mechanicsConfig")
                .path("triggers")
                .get(0)
                .path("actions")
                .get(0)
                .path("type")
                .asText()
        );
        assertEquals(
            "none",
            seedData.statusPeriodicHpEffects().get(0).path("critChanceSource").asText()
        );
    }

    @Test
    void loadSeed_shouldReadV2BatchDAdcItemPassives() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-D-adc-item-passives.seed.json")
            .toAbsolutePath()
            .normalize();

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("v2_batch_d_item_passives_002", seedData.versionCode());
        assertEquals(1, seedData.ownerCategories().size());
        assertEquals(0, seedData.attributeDefinitions().size());
        assertEquals(0, seedData.types().size());
        assertEquals(0, seedData.heroes().size());
        assertEquals(3, seedData.skills().size());
        assertEquals(3, seedData.items().size());
        assertEquals(0, seedData.typeRelations().size());

        Set<String> skillIds = collectText(seedData.skills(), "skillId");
        assertTrue(skillIds.contains("item_3124_guinsoos_rageblade_wrath_dps_v2"));
        assertTrue(skillIds.contains("item_3153_blade_of_the_ruined_king_mists_edge_dps_v2"));
        assertTrue(skillIds.contains("item_6672_kraken_slayer_bring_it_down_dps_v2"));

        for (JsonNode skill : seedData.skills()) {
            assertEquals("item", skill.path("ownerType").asText());
            assertTrue(Set.of("3124", "3153", "6672").contains(skill.path("ownerId").asText()));
        }

        JsonNode guinsoo = findByField(seedData.items(), "itemId", "3124");
        assertEquals("item_3124_guinsoos_rageblade_wrath_dps_v2", guinsoo.path("skillRefs").get(0).asText());
        assertEquals(30.0, findByField(seedData.skills(), "skillId", "item_3124_guinsoos_rageblade_wrath_dps_v2")
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0)
            .path("operations")
            .get(0)
            .path("amount")
            .asDouble(), 0.001);

        JsonNode borkOperation = findByField(seedData.skills(), "skillId", "item_3153_blade_of_the_ruined_king_mists_edge_dps_v2")
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0)
            .path("operations")
            .get(0);
        assertEquals(0.06, borkOperation.path("targetCurrentHpRatio").asDouble(), 0.001);
        assertEquals("attack_start", borkOperation.path("targetCurrentHpBasis").asText());

        JsonNode krakenEffect = findByField(seedData.skills(), "skillId", "item_6672_kraken_slayer_bring_it_down_dps_v2")
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0);
        assertEquals("every_n_basic_attack_hit", krakenEffect.path("triggerKind").asText());
        assertEquals(3, krakenEffect.path("everyN").asInt());
        assertEquals(120.0, krakenEffect.path("operations").get(0).path("amount").asDouble(), 0.001);
        assertEquals(0.75, krakenEffect.path("operations").get(0).path("targetMissingHpAmp").asDouble(), 0.001);
        assertEquals("attack_start", krakenEffect.path("operations").get(0).path("targetMissingHpBasis").asText());
    }

    private static Set<String> collectText(Iterable<? extends JsonNode> nodes, String fieldName) {
        Set<String> result = new HashSet<>();
        for (JsonNode node : nodes) {
            result.add(node.path(fieldName).asText());
        }
        return result;
    }

    private static JsonNode findByField(Iterable<? extends JsonNode> nodes, String fieldName, String expectedValue) {
        for (JsonNode node : nodes) {
            if (expectedValue.equals(node.path(fieldName).asText())) {
                return node;
            }
        }
        throw new AssertionError("Cannot find item where " + fieldName + "=" + expectedValue);
    }
}
