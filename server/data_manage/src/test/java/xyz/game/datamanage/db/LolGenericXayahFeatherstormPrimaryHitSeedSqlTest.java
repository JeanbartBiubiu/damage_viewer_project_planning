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
 * Static contract for {@code lol_generic_xayah_featherstorm_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericXayahFeatherstormPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_xayah_featherstorm_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_xayah",
        "provider_hero_xayah_r_featherstorm_primary_hit",
        "ability_hero_xayah_r_featherstorm_primary_hit",
        "featherstorm_primary_hit",
        "phase_hero_xayah_r_featherstorm_primary_hit_impact",
        "sequence_hero_xayah_r_featherstorm_primary_hit_impact",
        "step_hero_xayah_r_featherstorm_primary_hit_damage",
        "cooldown_hero_xayah_r_featherstorm_primary_hit",
        "featherstorm_primary_hit_damage",
        "r_mana_cost",
        "r_cooldown_ms");

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

    private static final String FEATHERSTORM_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":400},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; "
            + "quantum_amount_400_plus_1_00_bonus_ad; "
            + "preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; "
            + "no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; "
            + "no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_"
            + "attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_"
            + "generation_ground_state_e_dependency_other_ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077";

    private static final String LOCAL_RAW_SHA =
        "debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1";

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
    void documentsSourceIdentityRevisionHashCaveatBoundaryQuantumAndOrderedTags() {
        assertContains("hero_skill|hero_xayah|R|暴风羽刃");
        assertContains("wasm-generic-xayah-featherstorm-primary-hit");
        assertContains("xayah-r-featherstorm-primary-hit-phase-a-v2");
        assertContains("Template:Data Xayah/R");
        assertContains("Template:Data Xayah/Featherstorm");
        assertContains("1324544");
        assertContains("4008617");
        assertContains("2026-04-15T00:26:44Z");
        assertContains("1761");
        assertContains(CANONICAL_SHA);
        assertContains(LOCAL_RAW_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/xayah-r.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertTrue(
            sql.contains("damage quantum") || sql.contains("damage_quantum")
                || sql.contains("物理 damage quantum"),
            "seed must frame Phase-A as one selected damage quantum");
        assertTrue(
            sql.contains("no_claim_of_whole_r_single_total_hit")
                || sql.contains("不证明完整 Featherstorm")
                || sql.contains("Wiki-proven once-only")
                || sql.contains("wiki_proven_once_only"),
            "seed must not claim whole-R single total hit / Wiki-proven once-only");
        assertTrue(
            (sql.contains("400 + 100% bonus AD") || sql.contains("400 + 1.00")
                    || sql.contains("physical 400") || sql.contains("quantum_amount_400"))
                && sql.contains("100") && sql.contains("100000"),
            "seed comments must document rank3 physical 400 +100% bAD / mana100 / CD100000");
        assertTrue(
            sql.contains("bonus AD") || sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD via sub(resolved,base)");
        assertTrue(
            sql.contains("baseAD60") || sql.contains("resolvedAD60") || sql.contains("raw400"),
            "seed comments must document fixture baseAD60/resolved60 => raw400");
        assertTrue(
            sql.contains("armor100=200") || (sql.contains("armor100") && sql.contains("200")),
            "seed comments must document armor100=200 for zero-bonus fixture");
        assertTrue(
            sql.contains("raw450") && (sql.contains("armor100=225") || sql.contains("225")),
            "seed comments must document resolved110 => raw450 / armor100=225");
        assertTrue(
            sql.contains("t0") && sql.contains("t99999") && sql.contains("t100000"),
            "seed comments must document cooldown timeline t0/t99999/t100000");
        assertTrue(
            (sql.contains("mana300") || sql.contains("mana300/"))
                && (sql.contains("mana100") || sql.contains("final mana100"))
                && (sql.contains("HP550") || sql.contains("HP1000")),
            "seed comments must document mana300→100 / HP1000→550 fixture");
        assertTrue(
            sql.contains("mana99") && (sql.contains("resource skip") || sql.contains("unchanged")),
            "seed comments must document mana99 resource skip");
        assertTrue(
            sql.contains("two total R damage-quantum")
                || sql.contains("two total R damage-quantum items")
                || (sql.contains("damage-quantum") && sql.contains("two")),
            "seed comments must document two total R damage-quantum items");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
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
            "featherstorm primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "featherstorm primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "featherstorm primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "featherstorm primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "featherstorm primary-hit seed must not CREATE TABLE");
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
    void forbidsSharedIdentityPanelResourceWritesAndWQGraphMutationFromRSeed() {
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
            "R seed must not mutate W listener/state/modifier/type_relations surfaces");
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
            "R seed must not INSERT/UPDATE W ability_definitions rows");
        assertFalse(
            Pattern.compile(
                    "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO)\\s+public\\.provider_definitions\\b"
                        + "[\\s\\S]{0,400}'provider_hero_xayah_w_deadly_plumage'")
                .matcher(sqlNoComments)
                .find(),
            "R seed must not INSERT/UPDATE W provider_definitions rows");
        assertTrue(
            sql.contains("optional") || sql.contains("可选") || sql.contains("independent sibling")
                || sql.contains("独立 sibling"),
            "seed must document Q as optional independent sibling");
        assertTrue(
            sql.contains("Never require") || sql.contains("never require")
                || sql.contains("不要求 Q"),
            "seed must state Q is never required");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_xayah_q_double_daggers_primary_two_hit'")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not reference/mutate Q provider identity");
        assertFalse(
            Pattern.compile("(?is)'ability_hero_xayah_q_double_daggers_primary_two_hit'")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not reference/mutate Q ability identity");
        assertFalse(
            Pattern.compile(
                    "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO|DELETE\\s+FROM)\\s+"
                        + "public\\.[\\w]+\\b[\\s\\S]{0,200}double_daggers")
                .matcher(sqlNoComments)
                .find(),
            "R seed must not INSERT/UPDATE/DELETE any double_daggers / Q rows");
        assertFalse(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.[\\w]+\\b[\\s\\S]{0,200}"
                        + "double_daggers|provider_hero_xayah_q_")
                .matcher(sqlNoComments)
                .find(),
            "R seed must not EXISTS-require Q rows");
    }

    @Test
    void mountsIsolatedProviderAbilityCostCooldownPhaseSequenceOneDamageQuantumAndMount() {
        assertContains("provider_hero_xayah_r_featherstorm_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_xayah_r_featherstorm_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Featherstorm primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_xayah'\\s*,\\s*"
                        + "'provider_hero_xayah_r_featherstorm_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Featherstorm primary-hit provider to hero_xayah");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated R provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Featherstorm primary-hit only)");
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
            "must define exactly one effect_steps insert");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.damage_effect_details"),
            "must define exactly one damage_effect_details insert");
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
                    "(?s)'ability_hero_xayah_r_featherstorm_primary_hit'\\s*,\\s*"
                        + "'provider_hero_xayah_r_featherstorm_primary_hit'\\s*,\\s*"
                        + "'featherstorm_primary_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key featherstorm_primary_hit");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertContains("{\"op\":\"const\",\"value\":100000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_xayah_r_featherstorm_primary_hit'\\s*,\\s*"
                        + "'ability_hero_xayah_r_featherstorm_primary_hit'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 100000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_xayah_r_featherstorm_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_xayah_r_featherstorm_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_xayah_r_featherstorm_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_xayah_r_featherstorm_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_r_featherstorm_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_xayah_r_featherstorm_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "damage quantum step must be order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_xayah_r_featherstorm_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write explicit event_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?i)five.?damage|five.?hit|five.?projectile|5.?damage.?op|"
                        + "五个投射物|五次 damage")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not model five damage ops / projectile identities");
    }

    @Test
    void parsesBinaryDamageFormulaWithBonusAdRatio() throws IOException {
        assertContains(FEATHERSTORM_DAMAGE);
        assertBinaryDamageFormula(FEATHERSTORM_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":400");
        assertContains("\"value\":1.00");
        assertContains("\"op\":\"sub\"");
        assertEquals(
            2,
            JSON.readTree(FEATHERSTORM_DAMAGE).path("args").size(),
            "outer add must remain binary");
        assertEquals(
            "const",
            JSON.readTree(FEATHERSTORM_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be const 400");
        assertEquals(
            "mul",
            JSON.readTree(FEATHERSTORM_DAMAGE).path("args").get(1).path("op").asText(),
            "outer right child must be mul(ratio, bonusAD)");
    }

    @Test
    void seedsPhysicalDamageAddPolicyNoncopyableNoncritAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_r_featherstorm_primary_hit_damage'\\s*,\\s*"
                        + "'featherstorm_primary_hit_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "damage quantum must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            2,
            countOccurrences(sqlNoComments, "'featherstorm_primary_hit_damage'"),
            "formula key must appear once in formulas and once in damage detail");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Featherstorm primary-hit must not enable crit eligibility");
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
                    "(?i)untargetable|ghosted|leap|one.?second.?delay|emit_event|"
                        + "feather.?ground|ground.?state|equipment|loadout|runes|"
                        + "aoe|area.?of.?effect|\\brepeat\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded leap/ghosted/untargetable/feather-ground surfaces");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[12]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)migration|live\\s+migration")
                .matcher(sqlNoComments)
                .find(),
            "must not include live migration");
        assertTrue(
            sql.contains("multi-feather") || sql.contains("same-target stacking")
                || sql.contains("same_target_stacking")
                || sql.contains("同目标多羽"),
            "seed comments must document exclusion of multi-feather same-target stacking");
        assertTrue(
            sql.contains("projectile") || sql.contains("five projectile")
                || sql.contains("五个投射物"),
            "seed comments must document exclusion of five projectile identities");
        assertTrue(
            sql.contains("leap") || sql.contains("ghosted") || sql.contains("untargetable"),
            "seed comments must document exclusion of leap/ghosted/untargetable");
        assertTrue(
            sql.contains("feather generation") || sql.contains("ground state")
                || sql.contains("feather-ground") || sql.contains("E dependency"),
            "seed comments must document exclusion of feather generation/ground state/E");
        assertTrue(
            sql.contains("Deadly Plumage") || sql.contains("deadly_plumage")
                || sql.contains("62012"),
            "seed comments must document preservation of W ability-type listener isolation");
        assertTrue(
            sql.contains("Double Daggers") || sql.contains("double_daggers")
                || sql.contains("double daggers isolation"),
            "seed comments must document preservation of Double Daggers isolation");
    }

    @Test
    void readmeEntryDocumentsOrderingQuantumFramingPrerequisitesExclusionsAndNoLive() {
        assertTrue(
            readme.contains("lol_generic_xayah_featherstorm_primary_hit_seed.sql"),
            "README must list the Xayah R Featherstorm primary-hit seed");
        assertTrue(
            readme.contains("LolGenericXayahFeatherstormPrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        int wIdx = readme.indexOf("lol_generic_xayah_deadly_plumage_seed.sql");
        int qIdx = readme.indexOf("lol_generic_xayah_double_daggers_primary_two_hit_seed.sql");
        int rIdx = readme.indexOf("lol_generic_xayah_featherstorm_primary_hit_seed.sql");
        assertTrue(
            wIdx >= 0 && qIdx >= 0 && rIdx >= 0,
            "README must contain Xayah W, Q, and R seed paths");
        assertTrue(wIdx < qIdx, "README must place corrected Xayah W entry before Xayah Q entry");
        assertTrue(qIdx < rIdx, "README must place Xayah Q entry before Xayah R entry");
        int sectionStart = readme.lastIndexOf("### ", rIdx);
        int sectionEnd = readme.indexOf("\n### ", rIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-xayah-featherstorm-primary-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("xayah-r-featherstorm-primary-hit-phase-a-v2"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("rank3_primary_champion_one_physical_damage_quantum"),
            "README must include frozen boundary");
        for (String tag : ORDERED_TAGS) {
            assertTrue(section.contains(tag), "README ordered tags must include " + tag);
        }
        assertTrue(
            section.contains("1324544") && section.contains("4008617")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("damage quantum") || section.contains("damage_quantum")
                || section.contains("物理 damage quantum"),
            "README must distinguish one selected damage quantum vs whole-R single hit");
        assertTrue(
            section.contains("no_claim_of_whole_r_single_total_hit")
                || section.contains("不证明") || section.contains("Wiki-proven once-only")
                || section.contains("wiki_proven_once_only")
                || section.contains("whole-R") || section.contains("whole R"),
            "README must not claim Wiki-proven whole-R once-only");
        assertTrue(
            section.contains("100000"),
            "README must document cooldown 100000ms");
        assertTrue(
            section.contains("400") && section.contains("1.00"),
            "README must document damage formula constants/ratios");
        assertTrue(
            section.contains("62012") && section.contains("ability/xayah_deadly_plumage"),
            "README must explain ability-type listener isolation");
        assertTrue(
            section.contains("optional") || section.contains("可选")
                || section.contains("independent sibling") || section.contains("独立 sibling")
                || section.contains("独立兄弟"),
            "README must state Q/R are independent siblings and Q is optional");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("baseAD60") || section.contains("resolvedAD60")
                || section.contains("mana300") || section.contains("HP1000")
                || section.contains("raw400"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|multi-feather|projectile|untargetable|leap|ghosted|"
                        + "feather|cast lockout")
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
                    + "R self-contained|self-contained R")
                .matcher(section)
                .find(),
            "README must not call R self-contained");
        assertTrue(
            section.contains("LolGenericXayahFeatherstormPrimaryHitSeedSqlTest")
                && (section.contains("LolGenericXayahDeadlyPlumageSeedSqlTest")
                    || section.contains("DeadlyPlumage")),
            "README focused Maven command should include R test (and preferably W)");
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
            400,
            root.path("args").get(0).path("value").asDouble(),
            1e-9,
            "outer add left must be const 400");
        assertBinaryArithmeticComparisonArity(root, "featherstorm_primary_hit_damage");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ad.resolved")
                && nodeContainsReadPath(root, "source.attr.ad.base"),
            "bonus AD must be sub(resolved, base) under binary AST");
        JsonNode mul = root.path("args").get(1);
        assertEquals("mul", mul.path("op").asText(), "ratio branch must be mul");
        assertEquals(
            1.00,
            mul.path("args").get(0).path("value").asDouble(),
            1e-9,
            "bonus AD ratio must be 1.00");
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
