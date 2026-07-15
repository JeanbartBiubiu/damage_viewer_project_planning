package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_batch_b_adc_entities_seed.sql}.
 * Does not connect to a live database.
 */
class LolBatchBAdcEntitiesSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql";

    private static final List<String> ADC_IDS = List.of(
        "hero_vayne",
        "hero_teemo",
        "hero_varus",
        "hero_kaisa",
        "hero_twitch",
        "hero_kogmaw");

    private static final List<String> DUMMY_IDS = List.of(
        "target_dummy_squishy",
        "target_dummy_fighter",
        "target_dummy_tank");

    /** ADC entity_attribute_values keys (13). */
    private static final List<String> ADC_BASE_ATTRS = List.of(
        "hp",
        "ad",
        "ap",
        "attack_speed",
        "attack_range",
        "armor",
        "magic_resist",
        "mana",
        "mana_regen",
        "hp_regen",
        "move_speed",
        "crit_chance",
        "crit_damage");

    /** Source JSON baseStats keys for each target dummy (10). */
    private static final List<String> DUMMY_BASE_ATTRS = List.of(
        "hp",
        "ad",
        "ap",
        "attack_speed",
        "armor",
        "magic_resist",
        "ability_haste",
        "physical_pen",
        "magic_pen",
        "hp_regen");

    /** Required attribute_definitions union: ADC 13 + dummy-only 3 = 16. */
    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp",
        "ad",
        "ap",
        "attack_speed",
        "attack_range",
        "armor",
        "magic_resist",
        "mana",
        "mana_regen",
        "hp_regen",
        "move_speed",
        "crit_chance",
        "crit_damage",
        "ability_haste",
        "physical_pen",
        "magic_pen");

    private static final List<String> GROWTH_ATTRS = List.of(
        "hp",
        "mana",
        "ad",
        "armor",
        "magic_resist",
        "hp_regen",
        "mana_regen",
        "attack_speed");

    private static final int EXPECTED_BASE_ATTR_ROWS = 6 * 13 + 3 * 10;
    private static final int EXPECTED_STAGE_ROWS = 6 * 8 * 18;

    private static String sql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path path = resolveSeedSql();
        assertTrue(Files.isRegularFile(path), "seed sql missing: " + path);
        sql = Files.readString(path, StandardCharsets.UTF_8);
    }

    @Test
    void seedsNineEntitiesWithSourceDisplayNames() {
        for (String id : ADC_IDS) {
            assertContains(id);
        }
        for (String id : DUMMY_IDS) {
            assertContains(id);
        }
        assertContains("薇恩");
        assertContains("提莫");
        assertContains("韦鲁斯");
        assertContains("卡莎");
        assertContains("图奇");
        assertContains("克格莫");
        assertContains("Target Dummy Squishy");
        assertContains("Target Dummy Fighter");
        assertContains("Target Dummy Tank");
        assertContains("game_entities");
    }

    @Test
    void seedsThirteenBaseAttributesForAdcsAndTenForDummies() {
        assertContains("entity_attribute_values");
        for (String attr : ADC_BASE_ATTRS) {
            assertTrue(
                Pattern.compile("'hero_vayne'\\s*,\\s*'" + Pattern.quote(attr) + "'")
                    .matcher(sql)
                    .find(),
                "hero_vayne must seed base attr " + attr);
        }
        for (String dummy : DUMMY_IDS) {
            for (String attr : DUMMY_BASE_ATTRS) {
                assertTrue(
                    Pattern.compile("'" + Pattern.quote(dummy) + "'\\s*,\\s*'" + Pattern.quote(attr) + "'")
                        .matcher(sql)
                        .find(),
                    dummy + " must seed source baseStats key " + attr);
            }
        }
        assertContains("'hp'");
        assertContains("'crit_damage'");
        assertContains("'ability_haste'");
        assertContains("'physical_pen'");
        assertContains("'magic_pen'");
        assertContains("550");
        assertContains("3000");
        assertContains("2000");
        assertContains("5000");

        Matcher baseRowMatcher =
            Pattern.compile(
                    "\\(v_game_id,\\s*'(?:hero_[a-z]+|target_dummy_[a-z]+)',\\s*'[a-z_]+',\\s*[0-9.]+,\\s*v_candidate,\\s*NOW\\(\\)\\)")
                .matcher(sql);
        int baseRows = 0;
        while (baseRowMatcher.find()) {
            baseRows++;
        }
        assertEquals(
            EXPECTED_BASE_ATTR_ROWS,
            baseRows,
            "must seed 6 ADC × 13 + 3 dummy × 10 = 108 entity_attribute_values rows");
    }

    @Test
    void seedsStageAbsoluteValuesWithStage1AndL18Anchors() {
        assertContains("entity_attribute_stage_values");

        for (String hero : ADC_IDS) {
            for (String attr : GROWTH_ATTRS) {
                assertTrue(
                    Pattern.compile(
                            "\\('"
                                + Pattern.quote(hero)
                                + "',\\s*'"
                                + Pattern.quote(attr)
                                + "',\\s*1,")
                        .matcher(sql)
                        .find(),
                    hero + "/" + attr + " must include stage 1");
                assertTrue(
                    Pattern.compile(
                            "\\('"
                                + Pattern.quote(hero)
                                + "',\\s*'"
                                + Pattern.quote(attr)
                                + "',\\s*18,")
                        .matcher(sql)
                        .find(),
                    hero + "/" + attr + " must include stage 18");
            }
        }

        assertContains("('hero_vayne', 'hp', 1, 550)");
        assertContains("('hero_vayne', 'hp', 18, 2301)");
        assertContains("('hero_vayne', 'mana', 18, 827)");
        assertContains("('hero_vayne', 'ad', 18, 99.95)");
        assertContains("('hero_vayne', 'attack_speed', 18, 1.027138)");
        assertContains("('hero_vayne', 'armor', 18, 101.2)");
        assertContains("('hero_vayne', 'magic_resist', 18, 52.1)");
        assertContains("('hero_vayne', 'hp_regen', 18, 2.57)");
        assertContains("('hero_vayne', 'mana_regen', 18, 2.76)");

        assertContains("('hero_teemo', 'hp', 18, 2383)");
        assertContains("('hero_teemo', 'mana', 18, 759)");
        assertContains("('hero_teemo', 'ad', 18, 105)");
        assertContains("('hero_teemo', 'attack_speed', 18, 1.086474)");

        assertContains("('hero_varus', 'hp', 18, 2385)");
        assertContains("('hero_varus', 'mana', 18, 1000)");
        assertContains("('hero_varus', 'ad', 18, 116.8)");
        assertContains("('hero_varus', 'attack_speed', 18, 1.04951)");

        assertContains("('hero_kaisa', 'hp', 18, 2374)");
        assertContains("('hero_kaisa', 'mana', 18, 1025)");
        assertContains("('hero_kaisa', 'ad', 18, 103.2)");
        assertContains("('hero_kaisa', 'attack_speed', 18, 0.841064)");

        assertContains("('hero_twitch', 'hp', 18, 2296)");
        assertContains("('hero_twitch', 'mana', 18, 980)");
        assertContains("('hero_twitch', 'ad', 18, 110)");
        assertContains("('hero_twitch', 'attack_speed', 18, 1.02529)");

        assertContains("('hero_kogmaw', 'hp', 18, 2318)");
        assertContains("('hero_kogmaw', 'mana', 18, 1005)");
        assertContains("('hero_kogmaw', 'ad', 18, 113.7)");
        assertContains("('hero_kogmaw', 'attack_speed', 18, 0.964583)");

        Matcher stageRowMatcher =
            Pattern.compile(
                    "\\('(hero_[a-z]+)',\\s*'(hp|mana|ad|armor|magic_resist|hp_regen|mana_regen|attack_speed)',\\s*(\\d+),\\s*([0-9.]+)\\)")
                .matcher(sql);
        int stageRows = 0;
        int minStage = Integer.MAX_VALUE;
        int maxStage = Integer.MIN_VALUE;
        while (stageRowMatcher.find()) {
            stageRows++;
            int stage = Integer.parseInt(stageRowMatcher.group(3));
            minStage = Math.min(minStage, stage);
            maxStage = Math.max(maxStage, stage);
        }
        assertEquals(EXPECTED_STAGE_ROWS, stageRows, "must seed 6 ADC × 8 growth attrs × 18 stages = 864");
        assertEquals(1, minStage, "stage range must start at 1");
        assertEquals(18, maxStage, "stage range must end at 18");

        assertFalse(sql.contains("attack_speed_growth"), "must not migrate attack_speed_growth");
    }

    @Test
    void seedsSixAdcBasicAttackProviderGraphsAndMounts() {
        for (String hero : ADC_IDS) {
            assertContains("provider_" + hero + "_basic_attack");
            assertContains("ability_" + hero + "_basic_attack");
            assertContains("phase_" + hero + "_basic_attack_impact");
            assertContains("sequence_" + hero + "_basic_attack_damage");
            assertContains("step_" + hero + "_basic_attack_damage");
        }
        assertContains("basic_attack_damage");
        assertContains("damage_effect_details");
        assertContains("entity_provider_mounts");
        assertContains("ability_phase_effect_sequences");
        assertContains("\"$owner.attr.ad\"");
        assertContains("provider_definitions");
        assertContains("provider_formulas");
        assertContains("ability_definitions");
        assertContains("ability_phases");
        assertContains("effect_sequences");
        assertContains("effect_steps");

        for (String dummy : DUMMY_IDS) {
            assertFalse(
                sql.contains("provider_" + dummy),
                "dummy must not get provider: " + dummy);
        }
    }

    @Test
    void requiresReservedTypesAndSixteenAttributeDefinitions() {
        for (int typeId : List.of(20110, 20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260)) {
            assertContains(Integer.toString(typeId));
        }
        assertContains("v_required_attrs");
        assertEquals(16, REQUIRED_ATTRS.size(), "required attribute_definitions union must be 16");
        for (String attr : REQUIRED_ATTRS) {
            assertTrue(
                sql.contains("'" + attr + "'"),
                "required attrs array must include " + attr);
        }
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("RAISE EXCEPTION");
    }

    @Test
    void usesTransactionLockEnsureAndIdempotentRevisionGuard() {
        assertTrue(sql.trim().startsWith("BEGIN;") || sql.contains("\nBEGIN;\n"), "must BEGIN");
        assertTrue(sql.trim().endsWith("COMMIT;") || sql.contains("\nCOMMIT;\n") || sql.endsWith("COMMIT;\n"),
            "must COMMIT");
        assertContains("ensure_game_partitions");
        assertContains("FOR UPDATE");
        assertContains("v_candidate := v_locked_current + 1");
        assertContains("IF v_changed THEN");
        assertContains("current_revision = v_candidate");
        assertContains("IS DISTINCT FROM");
        assertContains("ON CONFLICT");
        assertTrue(
            sql.contains("change_revision > v_locked_current"),
            "relation/mount upsert must guard stale out-of-bound revision");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
    }

    @Test
    void doesNotReferenceLegacyBundleCatalogOrEntityTypeRelations() {
        assertNotContainsIgnoreCase("public.heroes");
        assertNotContainsIgnoreCase("public.items");
        assertNotContainsIgnoreCase("public.skills");
        assertNotContainsIgnoreCase("owner_categories");
        assertNotContainsIgnoreCase("ownerCategories");
        assertNotContainsIgnoreCase("single_attacker_dps");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sql).find(),
            "must not reference bundle");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sql).find(),
            "must not reference catalog");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b").matcher(sql).find(),
            "must not INSERT type_relations");
        assertFalse(
            Pattern.compile("(?is)target_category\\s*=\\s*'entity'").matcher(sql).find(),
            "must not reference entity type_relations writes");
    }

    @Test
    void doesNotDeleteRows() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sql).find(),
            "batch-b seed must not DELETE");
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "seed sql must contain: " + needle);
    }

    private static void assertNotContainsIgnoreCase(String needle) {
        assertFalse(
            Pattern.compile(Pattern.quote(needle), Pattern.CASE_INSENSITIVE).matcher(sql).find(),
            "seed sql must not contain: " + needle);
    }

    private static Path resolveSeedSql() {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        List<Path> candidates = List.of(
            cwd.resolve("../../" + SEED_RELATIVE).normalize(),
            cwd.resolve("../" + SEED_RELATIVE).normalize(),
            cwd.resolve(SEED_RELATIVE).normalize());
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        fail("unable to resolve " + SEED_RELATIVE + " from cwd=" + cwd);
        return null;
    }
}
