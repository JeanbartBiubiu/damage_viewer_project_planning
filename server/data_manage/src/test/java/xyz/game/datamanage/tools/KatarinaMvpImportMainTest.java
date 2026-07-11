package xyz.game.datamanage.tools;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.AttributeDefinitionsMapper;
import xyz.game.datamanage.mapper.CoefficientBucketsMapper;
import xyz.game.datamanage.mapper.ControlStateProfilesMapper;
import xyz.game.datamanage.mapper.EditLogMapper;
import xyz.game.datamanage.mapper.FormulaBindingsMapper;
import xyz.game.datamanage.mapper.FormulaProfilesMapper;
import xyz.game.datamanage.mapper.GameProgressionSchemaMapper;
import xyz.game.datamanage.mapper.GameVersionsMapper;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.HeroesMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.mapper.ItemStatModifiersMapper;
import xyz.game.datamanage.mapper.ItemsMapper;
import xyz.game.datamanage.mapper.OwnerCategoriesMapper;
import xyz.game.datamanage.mapper.PublishedBundleSnapshotsMapper;
import xyz.game.datamanage.mapper.PublishedWasmCatalogSnapshotsMapper;
import xyz.game.datamanage.mapper.WasmCatalogSourcesMapper;
import xyz.game.datamanage.mapper.SkillMountsMapper;
import xyz.game.datamanage.mapper.SkillsMapper;
import xyz.game.datamanage.mapper.StatusActionControlRulesMapper;
import xyz.game.datamanage.mapper.StatusAttributeModifiersMapper;
import xyz.game.datamanage.mapper.StatusDefinitionsMapper;
import xyz.game.datamanage.mapper.StatusModifierGroupsMapper;
import xyz.game.datamanage.mapper.StatusPeriodicHpEffectsMapper;
import xyz.game.datamanage.mapper.TypeRelationsMapper;
import xyz.game.datamanage.mapper.TypesMapper;
import xyz.game.datamanage.service.PostgresJsonSupport;
import xyz.game.datamanage.service.PostgresReadStore;
import xyz.game.datamanage.service.PostgresWriteStore;
import xyz.game.datamanage.service.WasmCatalogValidator;
import xyz.game.datamanage.service.DefaultBasicAttackProvisioner;
import xyz.game.datamanage.support.error.ApiException;

class KatarinaMvpImportMainTest {

    private static final String DEFAULT_SEED_FILE = "\u5361\u7279\u7433\u5a1c-MVP\u79cd\u5b50\u6570\u636e.json";
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

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

    @Test
    void loadSeed_shouldReadV2BatchKGuinsooPhantomHit() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-K-guinsoo-phantom-hit.seed.json")
            .toAbsolutePath()
            .normalize();

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("v2_batch_k_guinsoo_phantom_hit_001", seedData.versionCode());
        assertEquals(1, seedData.ownerCategories().size());
        assertEquals(2, seedData.skills().size());
        assertEquals(1, seedData.items().size());

        JsonNode guinsooItem = findByField(seedData.items(), "itemId", "3124");
        assertEquals(1, guinsooItem.path("skillRefs").size());
        assertEquals("item_3124_guinsoos_boiling_strike_dps_v2", guinsooItem.path("skillRefs").get(0).asText());

        JsonNode supersededWrathSkill = findByField(seedData.skills(), "skillId", "item_3124_guinsoos_rageblade_wrath_dps_v2");
        assertEquals("p_wrath", supersededWrathSkill.path("skillKey").asText());
        assertEquals("item_3124_guinsoos_boiling_strike_dps_v2", supersededWrathSkill.path("params").path("supersededBy").asText());
        assertEquals(0, supersededWrathSkill.path("mechanicsConfig").path("triggers").size());
        assertEquals(0, supersededWrathSkill.path("mechanicsConfig").path("dpsPassiveEffects").size());

        JsonNode mergedSkill = findByField(seedData.skills(), "skillId", "item_3124_guinsoos_boiling_strike_dps_v2");
        assertFalse(mergedSkill.path("params").has("excludedMechanics"));

        JsonNode operations = mergedSkill
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0)
            .path("operations");
        assertEquals(4, operations.size());

        JsonNode wrathDamage = findOperationByKind(operations, "damage");
        assertEquals("guinsoos_wrath_on_hit", wrathDamage.path("source").asText());
        assertEquals("magic", wrathDamage.path("damageType").asText());
        assertEquals(30.0, wrathDamage.path("amount").asDouble(), 0.001);
        assertTrue(wrathDamage.path("phantomHitCopyable").asBoolean());

        JsonNode addStack = findOperationByKind(operations, "add_stack");
        assertEquals("guinsoos_boiling_strike", addStack.path("stackKey").asText());
        assertEquals(4, addStack.path("maxStacks").asInt());
        assertEquals(3000, addStack.path("durationMs").asInt());
        assertEquals("refresh", addStack.path("refreshMode").asText());

        JsonNode attackSpeed = findOperationByKind(operations, "stat_modifier");
        assertEquals("guinsoos_boiling_strike", attackSpeed.path("stackKey").asText());
        assertEquals("attack_speed", attackSpeed.path("attrKey").asText());
        assertEquals(0.08, attackSpeed.path("value").asDouble(), 0.001);
        assertTrue(attackSpeed.path("perStack").asBoolean());

        JsonNode phantomHit = findOperationByKind(operations, "phantom_hit_on_hit_repeat");
        assertEquals("guinsoos_phantom_hit", phantomHit.path("source").asText());
        assertEquals("guinsoos_boiling_strike", phantomHit.path("stackKey").asText());
        assertEquals(4, phantomHit.path("triggerStacks").asInt());
        assertEquals(1, phantomHit.path("repeatCount").asInt());
        assertEquals("phantom_hit", phantomHit.path("repeatTag").asText());
        assertEquals("copyable_on_hit", phantomHit.path("repeatScope").asText());
    }

    @Test
    void loadSeed_shouldReadV2BatchPTargetEquipmentLinkedEffects() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-P-target-equipment-linked-effects.seed.json")
            .toAbsolutePath()
            .normalize();

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("v2_batch_p_target_equipment_linked_effects_002", seedData.versionCode());
        assertEquals(2, seedData.skills().size());
        assertEquals(3, seedData.items().size());

        JsonNode blackCleaver = findByField(seedData.items(), "itemId", "3071");
        assertEquals("item_3071_black_cleaver_carve_dps_v2", blackCleaver.path("skillRefs").get(0).asText());

        JsonNode thornmail = findByField(seedData.items(), "itemId", "3075");
        assertEquals("item_3075_thornmail_thorns_dps_v2", thornmail.path("skillRefs").get(0).asText());

        JsonNode randuin = findByField(seedData.items(), "itemId", "3143");
        assertEquals(0, randuin.path("skillRefs").size());

        JsonNode blackCleaverPassive = findByField(seedData.skills(), "skillId", "item_3071_black_cleaver_carve_dps_v2")
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0);
        assertEquals("attacker", blackCleaverPassive.path("ownerRole").asText());
        assertEquals("black_cleaver_carve_physical_damage_dealt", blackCleaverPassive.path("triggerId").asText());
        assertEquals("on_damage_dealt", blackCleaverPassive.path("trigger").path("event").asText());
        assertEquals("physical", blackCleaverPassive.path("trigger").path("matcher").path("damageTypes").get(0).asText());
        JsonNode blackCleaverOperations = blackCleaverPassive.path("operations");
        assertEquals("add_stack", blackCleaverOperations.get(0).path("kind").asText());
        assertEquals("stat_modifier", blackCleaverOperations.get(1).path("kind").asText());
        assertEquals("target", blackCleaverOperations.get(1).path("targetRole").asText());
        assertEquals("armor", blackCleaverOperations.get(1).path("attrKey").asText());

        JsonNode thornmailPassive = findByField(seedData.skills(), "skillId", "item_3075_thornmail_thorns_dps_v2")
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0);
        assertEquals("target", thornmailPassive.path("ownerRole").asText());
        assertEquals("thornmail_thorns_damage_taken", thornmailPassive.path("triggerId").asText());
        assertEquals("on_damage_taken", thornmailPassive.path("trigger").path("event").asText());
        JsonNode thornmailDamage = thornmailPassive.path("operations").get(0);
        assertEquals("damage", thornmailDamage.path("kind").asText());
        assertEquals("attacker", thornmailDamage.path("targetRole").asText());
        assertEquals("thornmail_reflect", thornmailDamage.path("source").asText());
    }

    @Test
    void verifyPublishedResult_shouldDetectBatchPPassthroughMutations() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-P-target-equipment-linked-effects.seed.json")
            .toAbsolutePath()
            .normalize();
        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);
        ObjectNode current = OBJECT_MAPPER.createObjectNode().put("versionCode", seedData.versionCode());
        ObjectNode bundle = buildPublishedBundleFromSeed(seedData);

        assertDoesNotThrow(() -> KatarinaMvpImportMain.verifyPublishedResult(current, bundle, seedData.versionCode(), seedData));

        ObjectNode mutatedDpsPassive = bundle.deepCopy();
        ObjectNode thornmailPassive = (ObjectNode) findByField(mutatedDpsPassive.path("skills"), "skillId", "item_3075_thornmail_thorns_dps_v2")
            .path("mechanicsConfig")
            .path("dpsPassiveEffects")
            .get(0);
        thornmailPassive.put("ownerRole", "attacker");
        IllegalStateException dpsPassiveFailure = assertThrows(
            IllegalStateException.class,
            () -> KatarinaMvpImportMain.verifyPublishedResult(current, mutatedDpsPassive, seedData.versionCode(), seedData)
        );
        assertTrue(dpsPassiveFailure.getMessage().contains("skills"));
        assertTrue(dpsPassiveFailure.getMessage().contains("item_3075_thornmail_thorns_dps_v2"));
        assertTrue(dpsPassiveFailure.getMessage().contains("dpsPassiveEffects"));

        ObjectNode mutatedSkillRefs = bundle.deepCopy();
        ((ObjectNode) findByField(mutatedSkillRefs.path("items"), "itemId", "3143"))
            .putArray("skillRefs")
            .add("item_3143_fake_passive_dps_v2");
        IllegalStateException skillRefsFailure = assertThrows(
            IllegalStateException.class,
            () -> KatarinaMvpImportMain.verifyPublishedResult(current, mutatedSkillRefs, seedData.versionCode(), seedData)
        );
        assertTrue(skillRefsFailure.getMessage().contains("items"));
        assertTrue(skillRefsFailure.getMessage().contains("3143"));
        assertTrue(skillRefsFailure.getMessage().contains("skillRefs"));
    }

    @Test
    void loadSeed_itemOwnedAttackerDpsPassives_shouldDeclareExplicitOwnerRole() throws Exception {
        List<String> seedFileNames = List.of(
            "V2-Batch-D-adc-item-passives.seed.json",
            "V2-Batch-G-adc-passives-ready.seed.json",
            "V2-Batch-H-stacking-stat-passives.seed.json",
            "V2-Batch-K-guinsoo-phantom-hit.seed.json",
            "V2-Batch-L-spellblade-next-attack.seed.json",
            "V2-Batch-M-attr-read-trinity-base-ad.seed.json",
            "V2-Batch-N-energized-charge-and-consume.seed.json"
        );

        for (String seedFileName : seedFileNames) {
            Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", seedFileName)
                .toAbsolutePath()
                .normalize();
            KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

            for (JsonNode skill : seedData.skills()) {
                if (!"item".equals(skill.path("ownerType").asText())) {
                    continue;
                }
                JsonNode dpsPassiveEffects = skill.path("mechanicsConfig").path("dpsPassiveEffects");
                if (!dpsPassiveEffects.isArray() || dpsPassiveEffects.isEmpty()) {
                    continue;
                }
                for (JsonNode passive : dpsPassiveEffects) {
                    assertEquals(
                        "attacker",
                        passive.path("ownerRole").asText(),
                        seedFileName + " skill " + skill.path("skillId").asText()
                            + " passive " + passive.path("passiveId").asText()
                            + " must declare ownerRole=attacker"
                    );
                }
            }
        }
    }

    @Test
    void loadSeed_shouldReadV2BatchNEnergizedChargeAndConsume() throws Exception {
        Path seedFile = Path.of("..", "..", "\u6700\u5c0f\u9a8c\u8bc1", "V2-Batch-N-energized-charge-and-consume.seed.json")
            .toAbsolutePath()
            .normalize();

        KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(seedFile);

        assertEquals("lol", seedData.gameId());
        assertEquals("v2_batch_n_energized_charge_001", seedData.versionCode());
        assertEquals(1, seedData.ownerCategories().size());
        assertEquals(1, seedData.skills().size());
        assertEquals(1, seedData.items().size());

        JsonNode voltaicItem = findByField(seedData.items(), "itemId", "6699");
        assertEquals("item_6699_voltaic_cyclosword_energized_dps_v2", voltaicItem.path("skillRefs").get(0).asText());

        JsonNode mergedSkill = findByField(seedData.skills(), "skillId", "item_6699_voltaic_cyclosword_energized_dps_v2");
        JsonNode mechanicsConfig = mergedSkill.path("mechanicsConfig");
        assertEquals("item_6699_energized", mechanicsConfig.path("dpsScenarioStates").get(0).path("stateId").asText());
        assertEquals(
            "assumed_charge_before_start",
            mechanicsConfig.path("dpsScenarioStates").get(0).path("activation").asText()
        );

        JsonNode energizedEffect = mechanicsConfig.path("dpsPassiveEffects").get(0);
        assertEquals("energized_charge_and_consume", energizedEffect.path("triggerKind").asText());
        assertEquals("item_6699_energized", energizedEffect.path("chargeKey").asText());
        assertEquals(25, energizedEffect.path("chargeGainPerBasicAttack").asInt());
        assertEquals(100, energizedEffect.path("chargeThreshold").asInt());
        assertEquals(100, energizedEffect.path("chargeCap").asInt());
        assertEquals("next_basic_attack_after_threshold_reached", energizedEffect.path("chargeReadyPolicy").asText());
        assertTrue(energizedEffect.path("consumeChargeOnTrigger").asBoolean());
        assertEquals("real_basic_attack_only", energizedEffect.path("procScope").asText());

        JsonNode energizedDamage = findOperationByKind(energizedEffect.path("operations"), "damage");
        assertEquals("voltaic_cyclosword_energized", energizedDamage.path("source").asText());
        assertEquals("physical", energizedDamage.path("damageType").asText());
        assertEquals(100.0, energizedDamage.path("amount").asDouble(), 0.001);
    }

    private static ObjectNode buildPublishedBundleFromSeed(KatarinaMvpImportMain.SeedData seedData) {
        ObjectNode bundle = OBJECT_MAPPER.createObjectNode();
        bundle.putObject("meta").put("versionCode", seedData.versionCode());
        putEntityArray(bundle, "attributeDefinitions", seedData.attributeDefinitions());
        putEntityArray(bundle, "types", seedData.types());
        putEntityArray(bundle, "heroes", seedData.heroes());
        putEntityArray(bundle, "skills", seedData.skills());
        putEntityArray(bundle, "items", seedData.items());
        putEntityArray(bundle, "formulaProfiles", seedData.formulaProfiles());
        putEntityArray(bundle, "formulaBindings", seedData.formulaBindings());
        putEntityArray(bundle, "statusDefinitions", seedData.statusDefinitions());
        putEntityArray(bundle, "statusModifierGroups", seedData.statusModifierGroups());
        putEntityArray(bundle, "statusPeriodicHpEffects", seedData.statusPeriodicHpEffects());
        putEntityArray(bundle, "typeRelations", seedData.typeRelations());
        return bundle;
    }

    private static void putEntityArray(ObjectNode bundle, String fieldName, Iterable<ObjectNode> entities) {
        ArrayNode arrayNode = bundle.putArray(fieldName);
        for (ObjectNode entity : entities) {
            arrayNode.add(entity.deepCopy());
        }
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

    private static JsonNode findOperationByKind(JsonNode operations, String kind) {
        for (JsonNode operation : operations) {
            if (kind.equals(operation.path("kind").asText())) {
                return operation;
            }
        }
        throw new AssertionError("Cannot find operation where kind=" + kind);
    }

    @Nested
    @ExtendWith(MockitoExtension.class)
    class DpsPassiveEffectsValidationTest {

        private static final Path BATCH_P_SEED_FILE = Path.of(
            "..",
            "..",
            "\u6700\u5c0f\u9a8c\u8bc1",
            "V2-Batch-P-target-equipment-linked-effects.seed.json"
        ).toAbsolutePath().normalize();

        @Mock
        private HeroesMapper heroesMapper;
        @Mock
        private SkillsMapper skillsMapper;
        @Mock
        private SkillMountsMapper skillMountsMapper;
        @Mock
        private DefaultBasicAttackProvisioner defaultBasicAttackProvisioner;
        @Mock
        private ItemsMapper itemsMapper;
        @Mock
        private ItemStatModifiersMapper itemStatModifiersMapper;
        @Mock
        private FormulaProfilesMapper formulaProfilesMapper;
        @Mock
        private FormulaBindingsMapper formulaBindingsMapper;
        @Mock
        private CoefficientBucketsMapper coefficientBucketsMapper;
        @Mock
        private StatusActionControlRulesMapper statusActionControlRulesMapper;
        @Mock
        private StatusDefinitionsMapper statusDefinitionsMapper;
        @Mock
        private StatusModifierGroupsMapper statusModifierGroupsMapper;
        @Mock
        private StatusAttributeModifiersMapper statusAttributeModifiersMapper;
        @Mock
        private StatusPeriodicHpEffectsMapper statusPeriodicHpEffectsMapper;
        @Mock
        private ControlStateProfilesMapper controlStateProfilesMapper;
        @Mock
        private AttributeDefinitionsMapper attributeDefinitionsMapper;
        @Mock
        private TypesMapper typesMapper;
        @Mock
        private TypeRelationsMapper typeRelationsMapper;
        @Mock
        private ImagesMapper imagesMapper;
        @Mock
        private OwnerCategoriesMapper ownerCategoriesMapper;
        @Mock
        private PublishedBundleSnapshotsMapper publishedBundleSnapshotsMapper;
        @Mock
        private PublishedWasmCatalogSnapshotsMapper publishedWasmCatalogSnapshotsMapper;
        @Mock
        private WasmCatalogSourcesMapper wasmCatalogSourcesMapper;
        @Mock
        private GamesMapper gamesMapper;
        @Mock
        private GameProgressionSchemaMapper gameProgressionSchemaMapper;
        @Mock
        private GameVersionsMapper gameVersionsMapper;
        @Mock
        private EditLogMapper editLogMapper;
        @Mock
        private PostgresReadStore readStore;

        private PostgresWriteStore writeStore;

        @BeforeEach
        void setUp() {
            ObjectMapper objectMapper = new ObjectMapper();
            writeStore = new PostgresWriteStore(
                heroesMapper,
                skillsMapper,
                skillMountsMapper,
                defaultBasicAttackProvisioner,
                itemsMapper,
                itemStatModifiersMapper,
                formulaProfilesMapper,
                formulaBindingsMapper,
                statusActionControlRulesMapper,
                statusDefinitionsMapper,
                statusModifierGroupsMapper,
                statusAttributeModifiersMapper,
                statusPeriodicHpEffectsMapper,
                controlStateProfilesMapper,
                coefficientBucketsMapper,
                attributeDefinitionsMapper,
                typesMapper,
                typeRelationsMapper,
                imagesMapper,
                ownerCategoriesMapper,
                publishedBundleSnapshotsMapper,
                publishedWasmCatalogSnapshotsMapper,
                wasmCatalogSourcesMapper,
                gamesMapper,
                gameProgressionSchemaMapper,
                gameVersionsMapper,
                editLogMapper,
                objectMapper,
                readStore,
                new PostgresJsonSupport(objectMapper),
                new WasmCatalogValidator()
            );
            lenient().when(readStore.findVersionByCode("lol", "__workspace__"))
                .thenReturn(new PostgresReadStore.VersionRecord(9L, "__workspace__", null, Instant.now(), null));
            lenient().when(ownerCategoriesMapper.countOwnerCategory("lol", "item")).thenReturn(1L);
            lenient().when(readStore.loadItem(eq("lol"), anyString())).thenReturn(OBJECT_MAPPER.createObjectNode());
            lenient().when(gamesMapper.ensureGamePartitions("lol")).thenReturn(1);
        }

        @Test
        void upsertSkill_acceptsBatchPSeedDpsPassiveEffects() throws Exception {
            KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(BATCH_P_SEED_FILE);

            for (ObjectNode skill : seedData.skills()) {
                assertDoesNotThrow(() -> writeStore.upsertSkill(
                    "lol",
                    skill.path("skillId").asText(),
                    skill.deepCopy()
                ));
            }
        }

        @Test
        void upsertSkill_rejectsDpsPassiveEffectsWhenNotArray() throws Exception {
            ObjectNode skill = loadBatchPSkill("item_3071_black_cleaver_carve_dps_v2");
            ((ObjectNode) skill.path("mechanicsConfig")).set("dpsPassiveEffects", OBJECT_MAPPER.createObjectNode());

            ApiException ex = assertThrows(
                ApiException.class,
                () -> writeStore.upsertSkill("lol", "item_3071_black_cleaver_carve_dps_v2", skill)
            );

            assertEquals("400.INVALID_BODY", ex.getCode());
            assertTrue(ex.getMessage().contains("dpsPassiveEffects"));
            assertEquals("/mechanicsConfig/dpsPassiveEffects", ex.getDetails().get("path"));
        }

        @Test
        void upsertSkill_rejectsInvalidOwnerRole() throws Exception {
            ObjectNode skill = loadBatchPSkill("item_3071_black_cleaver_carve_dps_v2");
            ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0)).put("ownerRole", "ally");

            ApiException ex = assertThrows(
                ApiException.class,
                () -> writeStore.upsertSkill("lol", "item_3071_black_cleaver_carve_dps_v2", skill)
            );

            assertEquals("400.INVALID_BODY", ex.getCode());
            assertTrue(ex.getMessage().contains("ownerRole"));
            assertEquals("/mechanicsConfig/dpsPassiveEffects/0/ownerRole", ex.getDetails().get("path"));
        }

        @Test
        void upsertSkill_rejectsInvalidTriggerEvent() throws Exception {
            ObjectNode skill = loadBatchPSkill("item_3071_black_cleaver_carve_dps_v2");
            ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0).path("trigger"))
                .put("event", "on_unknown_event");

            ApiException ex = assertThrows(
                ApiException.class,
                () -> writeStore.upsertSkill("lol", "item_3071_black_cleaver_carve_dps_v2", skill)
            );

            assertEquals("400.INVALID_BODY", ex.getCode());
            assertTrue(ex.getMessage().contains("trigger.event"));
            assertEquals("/mechanicsConfig/dpsPassiveEffects/0/trigger/event", ex.getDetails().get("path"));
        }

        @Test
        void upsertSkill_rejectsOperationsWhenNotArray() throws Exception {
            ObjectNode skill = loadBatchPSkill("item_3071_black_cleaver_carve_dps_v2");
            ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0))
                .set("operations", OBJECT_MAPPER.createObjectNode());

            ApiException ex = assertThrows(
                ApiException.class,
                () -> writeStore.upsertSkill("lol", "item_3071_black_cleaver_carve_dps_v2", skill)
            );

            assertEquals("400.INVALID_BODY", ex.getCode());
            assertTrue(ex.getMessage().contains("operations"));
            assertEquals("/mechanicsConfig/dpsPassiveEffects/0/operations", ex.getDetails().get("path"));
        }

        @Test
        void upsertSkill_rejectsInvalidOperationTargetRole() throws Exception {
            ObjectNode skill = loadBatchPSkill("item_3075_thornmail_thorns_dps_v2");
            ((ObjectNode) skill.path("mechanicsConfig").path("dpsPassiveEffects").get(0).path("operations").get(0))
                .put("targetRole", "source");

            ApiException ex = assertThrows(
                ApiException.class,
                () -> writeStore.upsertSkill("lol", "item_3075_thornmail_thorns_dps_v2", skill)
            );

            assertEquals("400.INVALID_BODY", ex.getCode());
            assertTrue(ex.getMessage().contains("targetRole"));
            assertEquals("/mechanicsConfig/dpsPassiveEffects/0/operations/0/targetRole", ex.getDetails().get("path"));
        }

        private ObjectNode loadBatchPSkill(String skillId) throws Exception {
            KatarinaMvpImportMain.SeedData seedData = KatarinaMvpImportMain.loadSeed(BATCH_P_SEED_FILE);
            return findByField(seedData.skills(), "skillId", skillId).deepCopy();
        }
    }
}
