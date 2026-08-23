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
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_xayah_double_daggers_primary_two_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_xayah_double_daggers_primary_two_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_xayah",
        "provider_hero_xayah_q_double_daggers_primary_two_hit",
        "ability_hero_xayah_q_double_daggers_primary_two_hit",
        "double_daggers_primary_two_hit",
        "phase_hero_xayah_q_double_daggers_primary_two_hit_impact",
        "sequence_hero_xayah_q_double_daggers_primary_two_hit_impact",
        "step_hero_xayah_q_double_daggers_primary_two_hit_feather_left",
        "step_hero_xayah_q_double_daggers_primary_two_hit_feather_right",
        "cooldown_hero_xayah_q_double_daggers_primary_two_hit",
        "double_daggers_damage",
        "q_mana_cost",
        "q_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "game_entities",
        "entity_attribute_values");

    private static final List<String> ORDERED_TAGS = List.of(
        "active_physical_damage",
        "bonus_ad_ratio",
        "immediate_impact_scaffold");

    private static final String DOUBLE_DAGGERS_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":105},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.50},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; "
            + "two_physical_hits_each_105_plus_0_50_bonus_ad; "
            + "preserve_deadly_plumage_ability_type_listener_isolation; "
            + "no_cast_time_attack_lockout_direction_range_width_projectile_travel_"
            + "interception_spellshield_secondary_target_reduction_feather_generation_"
            + "ground_state_or_other_ranks";

    private static final String CANONICAL_SHA =
        "8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd";

    private static final String LOCAL_RAW_SHA =
        "6a1fde0a18de0b6f28e55be7df27e58f99c91d49310e79ae81a9e95384f974de";

    private static String sql;
    private static String sqlNoComments;
    private static String readme;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoComments = stripSqlComments(sql);
        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = Files.readString(readmePath, StandardCharsets.UTF_8);
    }

    @Test
    void documentsSourceIdentityLiveRedirectLocalCaveatBoundaryAndOrderedTags() {
        assertContains("hero_skill|hero_xayah|Q|双刃");
        assertContains("wasm-generic-xayah-double-daggers-primary-two-hit");
        assertContains("xayah-q-double-daggers-primary-two-hit-phase-a-v3");
        assertContains("Template:Data Xayah/Q");
        assertContains("Template:Data Xayah/Double Daggers");
        assertContains("1324541");
        assertContains("4008615");
        assertContains("2026-04-15T00:26:21Z");
        assertContains("2615");
        assertContains(CANONICAL_SHA);
        assertContains(LOCAL_RAW_SHA);
        assertContains("1324536");
        assertContains("2864045");
        assertTrue(
            sql.contains("live redirect") || sql.contains("live request"),
            "seed must record live redirect request detail");
        assertTrue(
            sql.contains("never claim") || sql.contains("never claim the local sidecar")
                || sql.contains("非本地 sidecar") || sql.contains("sidecar contains"),
            "seed must not claim local sidecar contains the live redirect page");
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/xayah-q.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertTrue(
            (sql.contains("105 + 50% bonus AD") || sql.contains("105 + 0.50")
                    || sql.contains("physical 105"))
                && sql.contains("35") && sql.contains("8000"),
            "seed comments must document rank5 physical 105 +50% bAD / mana35 / CD8000");
        assertTrue(
            sql.contains("bonus AD") || sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD via sub(resolved,base)");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon|meraki")
                .matcher(sqlNoComments)
                .find(),
            "must not add DDragon/Meraki provenance in executable SQL");
        assertContains("20260725");
    }

    @Test
    void usesTransactionLockRevisionIdempotenceAndRejectsPublishDdlDelete() {
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
                .matcher(sqlNoComments)
                .find(),
            "candidate must be locked current_revision + 1");
        assertTrue(
            Pattern.compile("(?is)IF\\s+v_changed\\s+THEN").matcher(sqlNoComments).find(),
            "must guard current_revision bump with v_changed");
        assertTrue(
            Pattern.compile("current_revision\\s*=\\s*v_candidate")
                .matcher(sqlNoComments)
                .find(),
            "must advance current_revision to candidate when changed");
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
        assertTrue(
            Pattern.compile("change_revision\\s*>\\s*v_locked_current")
                .matcher(sqlNoComments)
                .find(),
            "match/link/mount idempotent guards must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoComments).find(),
            "seed must not call publish API markers");
        assertFalse(
            Pattern.compile("(?is)\\bcurrent_revision\\s*=\\s*\\d+")
                .matcher(sqlNoComments)
                .find(),
            "seed must not hardcode revision numbers");
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoComments).find(),
            "double daggers primary two-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "double daggers primary two-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "double daggers primary two-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "double daggers primary two-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "double daggers primary two-hit seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.(heroes|items|skills)\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write legacy heroes/items/skills tables");
    }

    @Test
    void validatesCheckOnlyXayahAdManaAndCorrectedWIsolationPrerequisites() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_xayah");
        assertContains("missing entity_attribute_values hero_xayah/ad");
        assertContains("62012");
        assertContains("ability/xayah_deadly_plumage");
        assertContains("listener_hero_xayah_w_deadly_plumage_ability_started");
        assertTrue(
            sql.contains("ability_id must be NULL") || sql.contains("ability_id IS NULL")
                || sql.contains("W listener ability_id must be NULL"),
            "seed must fail-closed on corrected W listener ability_id IS NULL");
        assertTrue(
            sql.contains("{20205,20212,62012}") || (sql.contains("20205")
                && sql.contains("20212") && sql.contains("62012")),
            "seed must require W ALL matchers 20205/20212/62012");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("Deadly Plumage") || sql.contains("deadly_plumage"),
            "seed must document shared external dependency with corrected W seed");
        assertTrue(
            sql.contains("不复制") || sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("不复制其身份 bootstrap"),
            "seed must state it does not copy W identity bootstrap");
        assertContains("INSERT INTO public.types");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_xayah'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_xayah before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_xayah/ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.types\\b[\\s\\S]{0,240}type_id\\s*=\\s*62012")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check corrected W type 62012");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.type_relations\\b[\\s\\S]{0,280}"
                        + "ability_hero_xayah_w_deadly_plumage")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check W ability type_relations");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.provider_listeners\\b[\\s\\S]{0,280}"
                        + "ability_id\\s+IS\\s+NULL")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check W listener ability_id IS NULL");
    }

    @Test
    void forbidsSharedIdentityPanelResourceWritesAndWGraphMutationFromQSeed() {
        for (String table : FORBIDDEN_WRITE_TABLES) {
            assertFalse(
                Pattern.compile(
                        "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO|DELETE\\s+FROM)\\s+"
                            + "public\\." + table + "\\b")
                    .matcher(sqlNoComments)
                    .find(),
                "must not INSERT/UPDATE/MERGE/DELETE public." + table
                    + " (SELECT/EXISTS checks are allowed)");
        }
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_progressions\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write entity_attribute_progressions");
        assertFalse(
            Pattern.compile(
                    "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO|DELETE\\s+FROM)\\s+"
                        + "public\\.(provider_listeners|listener_match_types|"
                        + "listener_effect_sequences|type_relations|provider_state_fields|"
                        + "provider_modifiers|state_effect_details)\\b")
                .matcher(sqlNoComments)
                .find(),
            "Q seed must not mutate W listener/state/modifier/type_relations surfaces");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_xayah_w_deadly_plumage'")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not write W provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO)\\s+public\\.ability_definitions\\b"
                        + "[\\s\\S]{0,400}'ability_hero_xayah_w_deadly_plumage'")
                .matcher(sqlNoComments)
                .find(),
            "Q seed must not INSERT/UPDATE W ability_definitions rows");
        assertFalse(
            Pattern.compile(
                    "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO)\\s+public\\.provider_definitions\\b"
                        + "[\\s\\S]{0,400}'provider_hero_xayah_w_deadly_plumage'")
                .matcher(sqlNoComments)
                .find(),
            "Q seed must not INSERT/UPDATE W provider_definitions rows");
    }

    @Test
    void mountsIsolatedProviderAbilityCostCooldownPhaseSequenceTwoOrderedHitsAndMount() {
        assertContains("provider_hero_xayah_q_double_daggers_primary_two_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_xayah_q_double_daggers_primary_two_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Double Daggers primary two-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_xayah'\\s*,\\s*"
                        + "'provider_hero_xayah_q_double_daggers_primary_two_hit'")
                .matcher(sql)
                .find(),
            "must mount Double Daggers primary two-hit provider to hero_xayah");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Q provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Double Daggers primary two-hit only)");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.ability_definitions"),
            "must define exactly one ability");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.ability_cooldowns"),
            "must define exactly one ability cooldown");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.effect_sequences"),
            "must define exactly one effect sequence");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.effect_steps"),
            "must define exactly one effect_steps insert (two ordered VALUES)");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.damage_effect_details"),
            "must define exactly one damage_effect_details insert (two feather rows)");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.ability_phase_effect_sequences"),
            "must define exactly one phase-sequence link");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_xayah_q_double_daggers_primary_two_hit'\\s*,\\s*"
                        + "'provider_hero_xayah_q_double_daggers_primary_two_hit'\\s*,\\s*"
                        + "'double_daggers_primary_two_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key double_daggers_primary_two_hit");
        assertContains("{\"op\":\"const\",\"value\":35}");
        assertContains("{\"op\":\"const\",\"value\":8000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_xayah_q_double_daggers_primary_two_hit'\\s*,\\s*"
                        + "'ability_hero_xayah_q_double_daggers_primary_two_hit'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 8000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_xayah_q_double_daggers_primary_two_hit_impact'\\s*,\\s*"
                        + "'ability_hero_xayah_q_double_daggers_primary_two_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_xayah_q_double_daggers_primary_two_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_xayah_q_double_daggers_primary_two_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_q_double_daggers_primary_two_hit_feather_left'\\s*,\\s*"
                        + "'sequence_hero_xayah_q_double_daggers_primary_two_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "left feather must be step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_q_double_daggers_primary_two_hit_feather_right'\\s*,\\s*"
                        + "'sequence_hero_xayah_q_double_daggers_primary_two_hit_impact'\\s*,\\s*"
                        + "1\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "right feather must be step order 1 to opponent");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_xayah_q_double_daggers_primary_two_hit_feather_left'"),
            "left feather step must appear in effect_steps and damage_effect_details");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_xayah_q_double_daggers_primary_two_hit_feather_right'"),
            "right feather step must appear in effect_steps and damage_effect_details");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
    }

    @Test
    void parsesSharedBinaryDamageFormulaWithBonusAdRatio() throws IOException {
        assertContains(DOUBLE_DAGGERS_DAMAGE);
        assertBinaryDamageFormula(DOUBLE_DAGGERS_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":105");
        assertContains("\"value\":0.50");
        assertContains("\"op\":\"sub\"");
        assertEquals(
            2,
            JSON.readTree(DOUBLE_DAGGERS_DAMAGE).path("args").size(),
            "outer add must remain binary");
        assertEquals(
            "const",
            JSON.readTree(DOUBLE_DAGGERS_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be const 105");
        assertEquals(
            "mul",
            JSON.readTree(DOUBLE_DAGGERS_DAMAGE).path("args").get(1).path("op").asText(),
            "outer right child must be mul(ratio, bonusAD)");
    }

    @Test
    void seedsPhysicalDamageAddPolicyNoncopyableNoncritSharedFormulaAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_q_double_daggers_primary_two_hit_feather_left'\\s*,\\s*"
                        + "'double_daggers_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "left feather must be physical 20220 add policy copyable_on_hit=false");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_q_double_daggers_primary_two_hit_feather_right'\\s*,\\s*"
                        + "'double_daggers_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "right feather must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            3,
            countOccurrences(sqlNoComments, "'double_daggers_damage'"),
            "shared formula key must appear once in formulas and once in each damage detail");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Double Daggers primary two-hit must not enable crit eligibility");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_match_types\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write listener_match_types");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_effect_sequences\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write listener_effect_sequences");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write provider_state_fields");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.state_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write state_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write modifier_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write provider_modifiers");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.repeat_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write repeat_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.control_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write control_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.(projectile|aoe)_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write projectile/AOE effect detail surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.(movement|blink|dash)_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write movement/blink/dash effect detail surfaces");
        assertFalse(
            Pattern.compile(
                    "(?i)cast.?time|attack.?lockout|projectile|missile|travel|"
                        + "interception|spell.?shield|secondary.?target|50%|"
                        + "feather.?ground|ground.?state|emit_event|equipment|"
                        + "loadout|runes|aoe|area.?of.?effect|\\brepeat\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded cast-time/projectile/feather-ground surfaces");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoComments)
                .find(),
            "must not include live migration");
        assertTrue(
            sql.contains("cast time") || sql.contains("attack lockout"),
            "seed comments must document exclusion of cast time/attack lockout");
        assertTrue(
            sql.contains("projectile") || sql.contains("spell shield")
                || sql.contains("interception"),
            "seed comments must document exclusion of projectile/interception/spell shield");
        assertTrue(
            sql.contains("feather generation") || sql.contains("ground state")
                || sql.contains("feather-ground"),
            "seed comments must document exclusion of feather generation/ground state");
        assertTrue(
            sql.contains("Deadly Plumage") || sql.contains("deadly_plumage")
                || sql.contains("62012"),
            "seed comments must document preservation of W ability-type listener isolation");
    }

    @Test
    void readmeEntryDocumentsOrderingContractPrerequisitesPreservationExclusionsAndNoLive() {
        assertTrue(
            readme.contains("lol_generic_xayah_double_daggers_primary_two_hit_seed.sql"),
            "README must list the Xayah Q Double Daggers primary two-hit seed");
        assertTrue(
            readme.contains("LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest"),
            "README must list the focused JUnit class");
        int wIdx = readme.indexOf("lol_generic_xayah_deadly_plumage_seed.sql");
        int qIdx = readme.indexOf("lol_generic_xayah_double_daggers_primary_two_hit_seed.sql");
        assertTrue(wIdx >= 0 && qIdx >= 0, "README must contain both Xayah W and Q seed paths");
        assertTrue(wIdx < qIdx, "README must place corrected Xayah W entry before Xayah Q entry");
        int sectionStart = readme.lastIndexOf("### ", qIdx);
        int sectionEnd = readme.indexOf("\n### ", qIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-xayah-double-daggers-primary-two-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("xayah-q-double-daggers-primary-two-hit-phase-a-v3"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("two_physical_hits_each_105_plus_0_50_bonus_ad"),
            "README must include frozen boundary");
        for (String tag : ORDERED_TAGS) {
            assertTrue(section.contains(tag), "README ordered tags must include " + tag);
        }
        assertTrue(
            section.contains("1324541") && section.contains("4008615")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains("1324536") && section.contains("2864045")
                && (section.contains("live redirect") || section.contains("live request")
                    || section.contains("非本地 sidecar")),
            "README must document live redirect caveat without claiming sidecar stores it");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("8000"),
            "README must document cooldown 8000ms");
        assertTrue(
            section.contains("105") && section.contains("0.50"),
            "README must document damage formula constants/ratios");
        assertTrue(
            section.contains("62012") && section.contains("ability/xayah_deadly_plumage"),
            "README must explain ability-type listener isolation");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("baseAD60") || section.contains("resolvedAD60")
                || section.contains("mana105") || section.contains("HP1000"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            Pattern.compile("(?i)排除|exclusion|cast time|projectile|feather|spell.?shield")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertFalse(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_xayah`|"
                    + "ensure `hero_xayah` 最低必要实体|"
                    + "Q self-contained|self-contained Q")
                .matcher(section)
                .find(),
            "README must not call Q self-contained");
        int wSectionStart = readme.lastIndexOf("### ", wIdx);
        int wSectionEnd = readme.indexOf("\n### ", wIdx);
        if (wSectionEnd < 0) {
            wSectionEnd = readme.length();
        }
        String wSection = readme.substring(wSectionStart, wSectionEnd);
        assertTrue(
            wSection.contains("62012") && wSection.contains("ability/xayah_deadly_plumage")
                && (wSection.contains("ability_id") || wSection.contains("AbilityRef")
                    || wSection.contains("listener isolation")),
            "corrected W README entry must document ability-type listener isolation");
    }

    /** Strip SQL line and block comments before forbidden-write checks. */
    private static String stripSqlComments(String raw) {
        String noBlock = Pattern.compile("/\\*.*?\\*/", Pattern.DOTALL).matcher(raw).replaceAll("");
        return Pattern.compile("(?m)--[^\\n]*").matcher(noBlock).replaceAll("");
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

    private static void assertBinaryDamageFormula(String damageJson) throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        assertEquals(
            105,
            root.path("args").get(0).path("value").asDouble(),
            1e-9,
            "outer add left must be const 105");
        assertBinaryArithmeticComparisonArity(root, "double_daggers_damage");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ad.resolved")
                && nodeContainsReadPath(root, "source.attr.ad.base"),
            "bonus AD must be sub(resolved, base) under binary AST");
        JsonNode mul = root.path("args").get(1);
        assertEquals("mul", mul.path("op").asText(), "ratio branch must be mul");
        assertEquals(
            0.50,
            mul.path("args").get(0).path("value").asDouble(),
            1e-9,
            "bonus AD ratio must be 0.50");
        assertEquals("sub", mul.path("args").get(1).path("op").asText(), "bonus AD must be sub");
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
                    assertBinaryArithmeticComparisonArity(
                        child.get(i), path + "." + entry.getKey() + "[" + i + "]");
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
