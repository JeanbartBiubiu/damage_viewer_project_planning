package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_kogmaw_living_artillery_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKogmawLivingArtillerySeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kogmaw_living_artillery_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_kogmaw",
        "provider_hero_kogmaw_r_living_artillery",
        "ability_hero_kogmaw_r_living_artillery",
        "living_artillery",
        "phase_hero_kogmaw_r_living_artillery_impact",
        "sequence_hero_kogmaw_r_living_artillery_impact",
        "step_hero_kogmaw_r_living_artillery_damage",
        "step_hero_kogmaw_r_living_artillery_stack_add",
        "cooldown_hero_kogmaw_r_living_artillery",
        "living_artillery_stacks",
        "living_artillery_damage",
        "living_artillery_stack_add",
        "r_mana_cost",
        "r_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20160, 20170, 20190,
        20221, 20250, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of(
        "hp", "ad", "ap", "mana", "magic_resist");

    private static final List<String> FORBIDDEN_IDENTITY_PANEL_RESOURCE_WRITES = List.of(
        "games",
        "game_entities",
        "attribute_definitions",
        "entity_attribute_values",
        "entity_attribute_progressions");

    private static final List<String> PRESERVED_PROVIDER_IDS = List.of(
        "provider_hero_kogmaw_basic_attack",
        "provider_hero_kogmaw_bio_arcane_barrage",
        "provider_hero_kogmaw_caustic_spittle",
        "provider_hero_kogmaw_e_void_ooze_primary_hit");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_magic_damage",
        "bonus_ad_and_ap_ratio",
        "missing_health_damage_multiplier",
        "stack_escalating_mana_cost",
        "timed_provider_state");

    private static final String MANA_COST =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":40},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"read\",\"path\":\"provider.state.living_artillery_stacks\"}]}]}";

    private static final String LIVING_ARTILLERY_DAMAGE =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":180},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.75},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.45},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"mul\",\"args\":[{\"op\":\"lt\",\"args\":["
            + "{\"op\":\"clamp\",\"expr\":{\"op\":\"div\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.current\"},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.max\"}]}]},"
            + "\"min\":{\"op\":\"const\",\"value\":0},\"max\":{\"op\":\"const\",\"value\":1}},"
            + "{\"op\":\"const\",\"value\":0.4}]},{\"op\":\"const\",\"value\":2}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"gte\",\"args\":["
            + "{\"op\":\"clamp\",\"expr\":{\"op\":\"div\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.current\"},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.max\"}]}]},"
            + "\"min\":{\"op\":\"const\",\"value\":0},\"max\":{\"op\":\"const\",\"value\":1}},"
            + "{\"op\":\"const\",\"value\":0.4}]},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"min\",\"args\":[{\"op\":\"const\",\"value\":0.5},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"div\",\"args\":["
            + "{\"op\":\"const\",\"value\":5},{\"op\":\"const\",\"value\":6}]},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0},"
            + "{\"op\":\"sub\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"clamp\",\"expr\":{\"op\":\"div\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.current\"},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":1},"
            + "{\"op\":\"read\",\"path\":\"target.attr.hp.max\"}]}]},"
            + "\"min\":{\"op\":\"const\",\"value\":0},"
            + "\"max\":{\"op\":\"const\",\"value\":1}}]}]}]}]}]}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank3_primary_target_living_artillery; immediate_impact_scaffold; "
            + "magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; "
            + "escalating_mana_40_plus_40_per_stack_max9_for_8000ms; "
            + "no_delay_location_geometry_multitarget_sight_reveal_or_stealth";

    private static final String CANONICAL_SHA =
        "32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641";

    private static final String LOCAL_RAW_SHA =
        "11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447";

    private static String sql;
    private static String sqlNoLineComments;
    private static String sqlExecutable;
    private static String readme;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        sqlExecutable = stripSqlStringLiterals(sqlNoLineComments);
        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = Files.readString(readmePath, StandardCharsets.UTF_8);
    }

    @Test
    void documentsSourceIdentityBoundaryOrderedTagsAndLocalRawCaveat() {
        assertContains("hero_skill|hero_kogmaw|R|活体大炮");
        assertContains("wasm-generic-kogmaw-living-artillery");
        assertContains("kogmaw-r-living-artillery-phase-a-v2");
        assertContains("Template:Data Kog'Maw/R");
        assertContains("Template:Data Kog'Maw/Living Artillery");
        assertContains("1307963");
        assertContains("4007636");
        assertContains("2026-04-12T08:34:32Z");
        assertContains("2453");
        assertContains(CANONICAL_SHA);
        assertContains("2452");
        assertContains(LOCAL_RAW_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/kogmaw-r.json");
        assertContains("pages/kogmaw-r.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertTrue(
            sql.indexOf(ORDERED_TAGS.get(0)) < sql.indexOf(ORDERED_TAGS.get(1))
                && sql.indexOf(ORDERED_TAGS.get(1)) < sql.indexOf(ORDERED_TAGS.get(2))
                && sql.indexOf(ORDERED_TAGS.get(2)) < sql.indexOf(ORDERED_TAGS.get(3))
                && sql.indexOf(ORDERED_TAGS.get(3)) < sql.indexOf(ORDERED_TAGS.get(4))
                && sql.indexOf(ORDERED_TAGS.get(4)) < sql.indexOf(ORDERED_TAGS.get(5)),
            "ordered tags must appear in frozen order");
        assertTrue(
            sql.contains("Exactly40%") || sql.contains("exactly 40%")
                || (sql.contains("1.5") && sql.contains("40%")),
            "seed comments must document Exactly40% HP uses 1.5");
        assertTrue(
            sql.contains("strictly below") || sql.contains("strictly below40%")
                || (sql.contains("below") && sql.contains("2")),
            "seed comments must document strictly below40% uses 2");
        assertTrue(
            Pattern.compile("(?i)无截图|无.*OCR|screenshot|OCR").matcher(sql).find()
                && Pattern.compile("(?i)无截图|不含截图|无.*OCR|不.*OCR|without.*screenshot|"
                    + "no screenshot|无截图 / OCR")
                    .matcher(sql)
                    .find(),
            "seed comments must explicitly disclaim screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)screenshot|ocr|截图识别|光学字符")
                .matcher(sqlNoLineComments)
                .find(),
            "executable SQL must not cite screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon")
                .matcher(sqlNoLineComments)
                .find(),
            "must not add DDragon provenance in executable SQL");
        assertContains("20260723");
    }

    @Test
    void usesTransactionLockCandidateAndIdempotentRevisionGuard() {
        assertTrue(sql.trim().startsWith("BEGIN;") || sql.contains("\nBEGIN;\n"), "must BEGIN");
        assertTrue(
            sql.trim().endsWith("COMMIT;")
                || sql.contains("\nCOMMIT;\n")
                || sql.endsWith("COMMIT;\n"),
            "must COMMIT");
        assertContains("DO $$");
        assertContains("ensure_game_partitions");
        assertContains("FOR UPDATE");
        assertContains("game_data_state");
        assertTrue(
            Pattern.compile("v_candidate\\s*:=\\s*v_locked_current\\s*\\+\\s*1")
                .matcher(sqlNoLineComments)
                .find(),
            "candidate must be locked current_revision + 1");
        assertTrue(
            Pattern.compile("(?is)IF\\s+v_changed\\s+THEN").matcher(sqlNoLineComments).find(),
            "must guard current_revision bump with v_changed");
        assertTrue(
            Pattern.compile("current_revision\\s*=\\s*v_candidate")
                .matcher(sqlNoLineComments)
                .find(),
            "must advance current_revision to candidate when changed");
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
        assertTrue(
            Pattern.compile("change_revision\\s*>\\s*v_locked_current")
                .matcher(sqlNoLineComments)
                .find(),
            "match/link/mount idempotent guards must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoLineComments).find(),
            "seed must not call publish API markers");
        assertFalse(
            Pattern.compile("(?is)\\bcurrent_revision\\s*=\\s*\\d+")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not hardcode revision numbers");
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "living artillery seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bTRUNCATE\\b").matcher(sqlNoLineComments).find(),
            "living artillery seed must not TRUNCATE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "living artillery seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "living artillery seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "living artillery seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "living artillery seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoLineComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoLineComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?i)single_attacker_dps").matcher(sqlNoLineComments).find(),
            "must not write single_attacker_dps surfaces");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.(heroes|items|skills)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write legacy heroes/items/skills tables");
    }

    @Test
    void validatesBatchBAndManaResourcePrerequisitesCheckOnly() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing game_entities hero_kogmaw");
        assertContains("missing attribute_definitions");
        assertContains("missing entity_attribute_values hero_kogmaw");
        assertContains("lol_batch_b_adc_entities_seed.sql");
        assertTrue(
            sql.contains("Batch-B") || sql.contains("Batch-B prerequisite"),
            "seed must document Batch-B prerequisite");
        assertTrue(
            sql.contains("check-only") || sql.contains("check only"),
            "seed must document check-only prerequisites");
        Matcher attrsArray = Pattern.compile(
                "(?is)v_required_attrs\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]")
            .matcher(sqlNoLineComments);
        assertTrue(attrsArray.find(), "must declare v_required_attrs array");
        String attrsBlock = attrsArray.group(1);
        for (String attr : REQUIRED_ATTRS) {
            assertTrue(
                attrsBlock.contains("'" + attr + "'"),
                "attr preflight must include: " + attr);
        }
        assertEquals(
            5,
            countOccurrences(attrsBlock, "'") / 2,
            "attr preflight array must list exactly five keys");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_kogmaw'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_kogmaw before graph writes");
        for (String table : FORBIDDEN_IDENTITY_PANEL_RESOURCE_WRITES) {
            assertFalse(
                Pattern.compile(
                        "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO|DELETE\\s+FROM)\\s+"
                            + "public\\." + table + "\\b")
                    .matcher(sqlNoLineComments)
                    .find(),
                "must not INSERT/UPDATE/MERGE/DELETE public." + table
                    + " (SELECT/EXISTS checks are allowed)");
        }
        assertContains("INSERT INTO public.types");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertFalse(
            Pattern.compile(
                    "(?is)missing provider_hero_kogmaw_basic_attack|"
                        + "missing provider_hero_kogmaw_bio_arcane|"
                        + "missing provider_hero_kogmaw_caustic|"
                        + "missing provider_hero_kogmaw_e_void|"
                        + "void_ooze.*prerequisite|"
                        + "caustic_spittle.*prerequisite|"
                        + "bio_arcane.*prerequisite")
                .matcher(sqlNoLineComments)
                .find(),
            "must not require existing Kog'Maw skill providers as hard prerequisites");
    }

    @Test
    void mountsIndependentLivingArtilleryProviderCoexistingWithExistingKogmawProviders() {
        assertContains("provider_hero_kogmaw_r_living_artillery");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kogmaw_r_living_artillery'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Living Artillery provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kogmaw'\\s*,\\s*'provider_hero_kogmaw_r_living_artillery'")
                .matcher(sql)
                .find(),
            "must mount Living Artillery provider to hero_kogmaw");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Living Artillery provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Living Artillery only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        for (String preserved : PRESERVED_PROVIDER_IDS) {
            assertTrue(
                sql.contains(preserved),
                "seed comments/guards must mention preserved provider: " + preserved);
            assertFalse(
                Pattern.compile("(?is)'" + Pattern.quote(preserved) + "'")
                    .matcher(sqlNoLineComments)
                    .find(),
                "must not write / replace preserved provider identity rows: " + preserved);
        }
        assertFalse(
            Pattern.compile(
                    "(?is)'ability_hero_kogmaw_e_void_ooze|"
                        + "'ability_hero_kogmaw_q_caustic|"
                        + "'ability_hero_kogmaw_basic_attack|"
                        + "'listener_hero_kogmaw|"
                        + "'step_hero_kogmaw_e_|"
                        + "'step_hero_kogmaw_bio_|"
                        + "'step_hero_kogmaw_caustic")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write basic/Q/W/E ability/listener/effect rows");
    }

    @Test
    void seedsActiveLivingArtilleryWithDynamicManaCostCooldown1000MsAndTimedStacks() {
        assertContains("ability_hero_kogmaw_r_living_artillery");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_kogmaw_r_living_artillery'\\s*,\\s*"
                        + "'provider_hero_kogmaw_r_living_artillery'\\s*,\\s*"
                        + "'living_artillery'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key living_artillery");
        assertContains("r_mana_cost");
        assertContains(MANA_COST);
        assertContains("provider.state.living_artillery_stacks");
        assertFalse(
            Pattern.compile(
                    "(?s)'r_mana_cost'\\s*,\\s*'\\{\"op\":\"const\",\"value\":40\\}'")
                .matcher(sql)
                .find(),
            "must not flatten dynamic mana cost to a constant 40");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_kogmaw_r_living_artillery");
        assertContains("r_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":1000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_kogmaw_r_living_artillery'\\s*,\\s*"
                        + "'ability_hero_kogmaw_r_living_artillery'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 1000ms via ability_cooldowns");
        assertContains("INSERT INTO public.provider_state_fields");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kogmaw_r_living_artillery'\\s*,\\s*"
                        + "'living_artillery_stacks'\\s*,\\s*20100\\s*,\\s*9\\s*,\\s*"
                        + "8000\\s*,\\s*20190")
                .matcher(sql)
                .find(),
            "living_artillery_stacks must be number / max9 / 8000ms / refresh_on_write 20190");
        assertTrue(
            Pattern.compile("(?i)default0|文档契约.*default0|explicit default0|运行时缺省\\s*0")
                .matcher(sql)
                .find(),
            "must document explicit default0 for living_artillery_stacks");
        assertTrue(
            Pattern.compile("(?i)refresh_on_write").matcher(sql).find(),
            "must document refresh_on_write");
    }

    @Test
    void seedsExactOrderedDamageThenProviderStateAddGraph() throws Exception {
        assertContains(LIVING_ARTILLERY_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("source.attr.ap.resolved");
        assertContains("target.attr.hp.current");
        assertContains("target.attr.hp.max");
        assertContains("\"value\":180");
        assertContains("\"value\":0.75");
        assertContains("\"value\":0.45");
        assertContains("\"op\":\"clamp\"");
        assertContains("\"op\":\"lt\"");
        assertContains("\"op\":\"gte\"");
        assertBinaryGenericAstAndApUnderCompiledBase(LIVING_ARTILLERY_DAMAGE);
        assertContains("phase_hero_kogmaw_r_living_artillery_impact");
        assertContains("sequence_hero_kogmaw_r_living_artillery_impact");
        assertContains("step_hero_kogmaw_r_living_artillery_damage");
        assertContains("step_hero_kogmaw_r_living_artillery_stack_add");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_kogmaw_r_living_artillery_impact'\\s*,\\s*"
                        + "'ability_hero_kogmaw_r_living_artillery'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_kogmaw_r_living_artillery_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_kogmaw_r_living_artillery_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_r_living_artillery_damage'\\s*,\\s*"
                        + "'sequence_hero_kogmaw_r_living_artillery_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "damage must be step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_r_living_artillery_stack_add'\\s*,\\s*"
                        + "'sequence_hero_kogmaw_r_living_artillery_impact'\\s*,\\s*"
                        + "1\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "state_change must be step order 1 targeting source/self");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_r_living_artillery_damage'\\s*,\\s*"
                        + "'living_artillery_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*"
                        + "false")
                .matcher(sql)
                .find(),
            "Living Artillery damage must be magic 20221 add policy copyable_on_hit=false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kogmaw_r_living_artillery_stack_add'\\s*,\\s*"
                        + "20250\\s*,\\s*'living_artillery_stacks'\\s*,\\s*"
                        + "'living_artillery_stack_add'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "state_effect_details must be provider-scope add living_artillery_stacks");
        assertContains("{\"op\":\"const\",\"value\":1}");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.state_effect_details"),
            "must have exactly one state_effect_details insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_steps"),
            "must have exactly one effect_steps insert block (two ordered rows)");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Living Artillery must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void createsZeroListenersAndZeroAbilityStartedSourceOwnerDependency() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_match_types\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write listener_match_types");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_effect_sequences\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write listener_effect_sequences");
        assertFalse(
            Pattern.compile("\\b20205\\b").matcher(sqlExecutable).find(),
            "executable SQL must not depend on event/ability_started 20205");
        assertFalse(
            Pattern.compile("\\b20212\\b").matcher(sqlExecutable).find(),
            "executable SQL must not depend on event/source_owner 20212");
        assertFalse(
            Pattern.compile("(?i)ability_started|source_owner")
                .matcher(sqlExecutable)
                .find(),
            "executable SQL must not embed ability_started/source_owner scaffold tokens");
        assertTrue(
            sql.contains("ability_started") || sql.contains("source_owner")
                || sql.contains("20205") || sql.contains("20212"),
            "comments may document exclusion of ability_started/source_owner scaffold");
    }

    @Test
    void excludesDelayGeometryMultitargetSightRevealStealthAndForbiddenSurfaces() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.control_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write control_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.repeat_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write repeat_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_modifiers");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.(projectile|aoe)_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write projectile/AOE effect detail surfaces");
        assertFalse(
            Pattern.compile(
                    "(?i)0\\.6s|landing.?delay|cast.?delay|"
                        + "target.?location|\\bradius\\b|projectile|missile|"
                        + "\\barc\\b|collision|travel|geometry|multitarget|"
                        + "multi-target|sight|reveal|stealth|spell.?shield|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "animation|\\bcombo")
                .matcher(sqlExecutable)
                .find(),
            "executable topology must not encode excluded delay/geometry/"
                + "multitarget/sight/reveal/stealth surfaces");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[12]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
        assertTrue(
            sql.contains("0.6s") || sql.contains("landing delay") || sql.contains("delay"),
            "seed comments must document exclusion of landing delay");
        assertTrue(
            sql.contains("geometry") || sql.contains("projectile") || sql.contains("location"),
            "seed comments must document exclusion of location/geometry");
        assertTrue(
            sql.contains("multi-target") || sql.contains("multitarget")
                || sql.contains("多目标"),
            "seed comments must document exclusion of multitarget");
        assertTrue(
            sql.contains("sight") || sql.contains("reveal") || sql.contains("stealth"),
            "seed comments must document exclusion of sight/reveal/stealth");
    }

    @Test
    void readmeEntryDocumentsPhaseARank3LivingArtilleryBoundary() {
        assertTrue(
            readme.contains("lol_generic_kogmaw_living_artillery_seed.sql"),
            "README must list the Kog'Maw R Living Artillery seed");
        assertTrue(
            readme.contains("LolGenericKogmawLivingArtillerySeedSqlTest"),
            "README must list the focused JUnit class");
        int seedIdx = readme.indexOf("lol_generic_kogmaw_living_artillery_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("hero_skill|hero_kogmaw|R|活体大炮"),
            "README entry must document exact stable key");
        assertTrue(
            section.contains("wasm-generic-kogmaw-living-artillery"),
            "README entry must document task key");
        assertTrue(
            Pattern.compile("(?i)Batch-B|lol_batch_b_adc_entities_seed")
                .matcher(section)
                .find(),
            "README entry must list Batch-B prerequisite");
        assertTrue(
            Pattern.compile("(?i)reserved_types_seed").matcher(section).find(),
            "README entry must list reserved types prerequisite");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|既有.*mana|mana.*既有|mana.*资源")
                .matcher(section)
                .find(),
            "README entry must document check-only mana resource prerequisite");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("rank3_primary_target_living_artillery")
                || section.contains("missing_health_multiplier"),
            "README entry must document frozen Phase-A boundary");
        assertTrue(
            Pattern.compile(
                    "(?i)0\\.6s|landing|geometry|multitarget|sight|reveal|stealth|"
                        + "弹道|几何|多目标|视野|隐身")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertTrue(
            Pattern.compile("(?i)全保真|full fidelity|完整.*保真").matcher(section).find()
                && Pattern.compile("(?i)不|non|no|排除|并非").matcher(section).find(),
            "README must not claim full Kog'Maw R fidelity");
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    /** Strip single-quoted SQL literals so exclusion keywords in metadata are ignored. */
    private static String stripSqlStringLiterals(String raw) {
        StringBuilder stripped = new StringBuilder(raw.length());
        boolean inLiteral = false;
        for (int index = 0; index < raw.length(); index++) {
            char current = raw.charAt(index);
            if (!inLiteral) {
                if (current == '\'') {
                    inLiteral = true;
                    stripped.append("''");
                } else {
                    stripped.append(current);
                }
                continue;
            }
            if (current == '\'') {
                if (index + 1 < raw.length() && raw.charAt(index + 1) == '\'') {
                    index++;
                } else {
                    inLiteral = false;
                }
            }
        }
        return stripped.toString();
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int idx = haystack.indexOf(needle, from);
            if (idx < 0) {
                return count;
            }
            count++;
            from = idx + needle.length();
        }
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "seed sql must contain: " + needle);
    }

    /**
     * compileGenericNode only wires args[0]/args[1] for binary arithmetic/comparison ops.
     * Nested binary add keeps AP under the compiled base (mul.args[0]) branch.
     */
    private static void assertBinaryGenericAstAndApUnderCompiledBase(String damageJson)
        throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("mul", root.path("op").asText(), "outer damage must be mul");
        assertEquals(2, root.path("args").size(), "outer mul must be binary");
        JsonNode compiledBase = root.get("args").get(0);
        JsonNode missingHealthMultiplier = root.get("args").get(1);
        assertEquals("add", compiledBase.path("op").asText(), "compiled base must be add");
        assertTrue(
            nodeContainsReadPath(compiledBase, "source.attr.ap.resolved"),
            "AP read must remain under compiled base branch (mul.args[0])");
        assertFalse(
            nodeContainsReadPath(missingHealthMultiplier, "source.attr.ap.resolved"),
            "AP read must not live only under the missing-health multiplier branch");
        assertBinaryArithmeticComparisonArity(root, "living_artillery_damage");
    }

    private static void assertBinaryArithmeticComparisonArity(JsonNode node, String path) {
        if (node == null || !node.isObject()) {
            return;
        }
        String op = node.path("op").asText(null);
        if (op != null && BINARY_ARITHMETIC_COMPARISON_OPS.contains(op)) {
            JsonNode args = node.get("args");
            assertTrue(args != null && args.isArray(), path + " op=" + op + " must have args array");
            assertEquals(
                2,
                args.size(),
                path + " op=" + op + " must be binary (exactly 2 args; compileGenericNode drops extras)");
        }
        Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            JsonNode child = entry.getValue();
            if (child.isObject()) {
                assertBinaryArithmeticComparisonArity(child, path + "." + entry.getKey());
            } else if (child.isArray()) {
                for (int i = 0; i < child.size(); i++) {
                    assertBinaryArithmeticComparisonArity(child.get(i), path + "." + entry.getKey() + "[" + i + "]");
                }
            }
        }
    }

    private static boolean nodeContainsReadPath(JsonNode node, String readPath) {
        if (node == null || node.isNull()) {
            return false;
        }
        if (node.isObject()) {
            if ("read".equals(node.path("op").asText())
                && readPath.equals(node.path("path").asText())) {
                return true;
            }
            Iterator<JsonNode> values = node.elements();
            while (values.hasNext()) {
                if (nodeContainsReadPath(values.next(), readPath)) {
                    return true;
                }
            }
            return false;
        }
        if (node.isArray()) {
            for (JsonNode child : node) {
                if (nodeContainsReadPath(child, readPath)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        List<Path> candidates = List.of(
            cwd.resolve("../../" + relative).normalize(),
            cwd.resolve("../" + relative).normalize(),
            cwd.resolve(relative).normalize());
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        fail("unable to resolve " + relative + " from cwd=" + cwd);
        return null;
    }
}
