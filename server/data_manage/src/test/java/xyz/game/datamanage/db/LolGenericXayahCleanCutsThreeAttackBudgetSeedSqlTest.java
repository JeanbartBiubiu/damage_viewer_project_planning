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
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_xayah_clean_cuts_three_attack_budget_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericXayahCleanCutsThreeAttackBudgetSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_xayah_clean_cuts_three_attack_budget_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_xayah",
        "provider_hero_xayah_p_clean_cuts_three_attack_budget",
        "ability_hero_xayah_p_clean_cuts_direct_post_cast_arm",
        "ability_hero_xayah_p_clean_cuts_basic_attack",
        "clean_cuts_direct_post_cast_arm",
        "clean_cuts_basic_attack",
        "clean_cuts_attacks_remaining",
        "phase_hero_xayah_p_clean_cuts_direct_post_cast_arm_impact",
        "sequence_hero_xayah_p_clean_cuts_direct_post_cast_arm",
        "step_hero_xayah_p_clean_cuts_direct_post_cast_arm",
        "phase_hero_xayah_p_clean_cuts_basic_attack_impact",
        "sequence_hero_xayah_p_clean_cuts_basic_attack_damage",
        "step_hero_xayah_p_clean_cuts_basic_attack_damage",
        "listener_hero_xayah_p_clean_cuts_basic_attack_damage",
        "sequence_hero_xayah_p_clean_cuts_consume_attack",
        "step_hero_xayah_p_clean_cuts_consume_attack",
        "clean_cuts_arm_amount",
        "clean_cuts_basic_attack_damage",
        "clean_cuts_has_attacks",
        "clean_cuts_consume_delta");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20160, 20170, 20172, 20181,
        20212, 20217, 20220, 20250, 20260);

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "resource_definitions",
        "game_entities",
        "entity_attribute_values",
        "entity_resource_values");

    private static final List<String> ORDERED_TAGS = List.of(
        "attack_count_budget",
        "direct_post_cast_arm_override_3",
        "basic_attack_damage_instance_consume_1",
        "untimed_max3_state_no_default_column");

    private static final String ARM_AMOUNT = "{\"op\":\"const\",\"value\":3}";

    private static final String BA_DAMAGE =
        "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"}";

    private static final String HAS_ATTACKS =
        "{\"op\":\"gt\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.clean_cuts_attacks_remaining\"},"
            + "{\"op\":\"const\",\"value\":0}]}";

    private static final String CONSUME_DELTA = "{\"op\":\"const\",\"value\":-1}";

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "attack_count_budget_only; direct_post_cast_arm_gives_3; "
            + "successful_source_ba_damage_instance_consumes_1; "
            + "state_sequence_arm_plus_4ba_0_3_2_1_0_0; "
            + "preserve_wqr_and_w_ability_type_listener_isolation; "
            + "no_true_qwer_wiring_add_refresh_max5_8s_timer_geometry_feathers_"
            + "secondary_damage_secondary_crit_e_dependency_miss_dodge_cadence_"
            + "projectile_rng_expected_crit_on_hit_proc_or_full_ba_clean_cuts_fidelity";

    private static final String CANONICAL_SHA =
        "5cfe6e5e30cdc8e6fde07791288f5a85e5ef01f543670ce2248323ccb6ead171";

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
    void documentsSourceIdentityBoundaryOrderedTagsAndWikiAuthority() {
        assertContains("hero_skill|hero_xayah|P|锐切");
        assertContains("wasm-generic-xayah-clean-cuts-three-attack-budget");
        assertContains("xayah-p-clean-cuts-three-attack-budget-phase-a-v2");
        assertContains("Template:Data Xayah/Clean Cuts");
        assertContains("1324540");
        assertContains("3967343");
        assertContains("2025-11-18T20:49:46Z");
        assertContains("4068");
        assertContains(CANONICAL_SHA);
        assertContains("normalized/generic/xayah-p.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertTrue(
            sql.contains("0→3→2→1→0→0") || sql.contains("0->3->2->1->0->0")
                || sql.contains("arm+4BA"),
            "seed comments must document arm+4BA state sequence");
        assertTrue(
            sql.contains("damage_instance")
                && (sql.contains("on-attack") || sql.contains("on_attack")
                    || sql.contains("Wiki on-attack")),
            "seed must document Wiki on-attack approximated by damage_instance");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon|meraki")
                .matcher(sqlNoComments)
                .find(),
            "must not add DDragon/Meraki provenance in executable SQL");
        assertContains("20260726");
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
            "clean cuts three-attack budget seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "clean cuts three-attack budget seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "clean cuts three-attack budget seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "clean cuts three-attack budget seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "clean cuts three-attack budget seed must not CREATE TABLE");
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
        assertContains("missing resource_definitions mana");
        assertContains("missing entity_resource_values hero_xayah/mana");
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
    void forbidsSharedIdentityPanelResourceWritesAndWqrGraphMutationFromPSeed() {
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
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_costs\\b")
                .matcher(sqlNoComments)
                .find(),
            "P arm/BA must have no ability_costs rows");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_cooldowns\\b")
                .matcher(sqlNoComments)
                .find(),
            "P arm/BA must have no ability_cooldowns rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_xayah_w_deadly_plumage'")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not write W provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_xayah_q_double_daggers_primary_two_hit'")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not write Q provider identity rows");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_xayah_r_featherstorm_primary_hit'")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not write R provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO)\\s+public\\.ability_definitions\\b"
                        + "[\\s\\S]{0,400}'ability_hero_xayah_w_deadly_plumage'")
                .matcher(sqlNoComments)
                .find(),
            "P seed must not INSERT/UPDATE W ability_definitions rows");
        assertFalse(
            Pattern.compile(
                    "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO)\\s+public\\.provider_definitions\\b"
                        + "[\\s\\S]{0,400}'provider_hero_xayah_w_deadly_plumage'")
                .matcher(sqlNoComments)
                .find(),
            "P seed must not INSERT/UPDATE W provider_definitions rows");
        assertFalse(
            Pattern.compile(
                    "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO)\\s+public\\.type_relations\\b"
                        + "[\\s\\S]{0,200}62012")
                .matcher(sqlNoComments)
                .find(),
            "P seed must not mutate W type_relations / shared Xayah spell relations");
        assertFalse(
            Pattern.compile("(?is)default_value").matcher(sqlNoComments).find(),
            "must not invent/store a fake default_value column");
    }

    @Test
    void mountsIsolatedProviderStateArmBaListenerAndSingleMount() {
        assertContains("provider_hero_xayah_p_clean_cuts_three_attack_budget");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_xayah_p_clean_cuts_three_attack_budget'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Clean Cuts budget provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_xayah'\\s*,\\s*"
                        + "'provider_hero_xayah_p_clean_cuts_three_attack_budget'")
                .matcher(sql)
                .find(),
            "must mount Clean Cuts budget provider to hero_xayah");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated P provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider");
        assertEquals(
            2,
            countOccurrences(sqlNoComments, "INSERT INTO public.ability_definitions"),
            "must define exactly two abilities (arm + BA)");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_state_fields"),
            "must define exactly one provider_state_fields insert");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_listeners"),
            "must define exactly one provider listener");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_xayah_p_clean_cuts_direct_post_cast_arm'\\s*,\\s*"
                        + "'provider_hero_xayah_p_clean_cuts_three_attack_budget'\\s*,\\s*"
                        + "'clean_cuts_direct_post_cast_arm'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "arm must be active ability with stable key clean_cuts_direct_post_cast_arm");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_xayah_p_clean_cuts_basic_attack'\\s*,\\s*"
                        + "'provider_hero_xayah_p_clean_cuts_three_attack_budget'\\s*,\\s*"
                        + "'clean_cuts_basic_attack'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "BA must be active ability with stable key clean_cuts_basic_attack");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            sql.contains("无 cost/CD") || sql.contains("no cost/CD") || sql.contains("无 cost"),
            "seed must document arm/BA have no cost/CD");
    }

    @Test
    void encodesUntimedMax3StateArmOverride3AndBaAdPhysicalNoncritRelation() {
        assertTrue(
            Pattern.compile(
                    "(?s)'clean_cuts_attacks_remaining'\\s*,\\s*20100\\s*,\\s*3\\s*,\\s*"
                        + "NULL\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "state must be max_value=3 with duration_ms NULL and refresh NULL");
        assertContains(ARM_AMOUNT);
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_p_clean_cuts_direct_post_cast_arm'\\s*,\\s*"
                        + "20250\\s*,\\s*'clean_cuts_attacks_remaining'\\s*,\\s*"
                        + "'clean_cuts_arm_amount'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "arm step must provider-scope override via 20172 amount const3");
        assertContains(BA_DAMAGE);
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_p_clean_cuts_basic_attack_damage'\\s*,\\s*"
                        + "'clean_cuts_basic_attack_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*"
                        + "false\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "BA damage must be physical 20220 add policy copyable=false crit_eligible=false");
        assertContains("62003");
        assertContains("ability/basic_attack");
        assertTrue(
            Pattern.compile("(?is)type_id=62003 already bound").matcher(sql).find(),
            "must fail-closed on 62003 identity collision");
        assertTrue(
            Pattern.compile("(?is)type_key=ability/basic_attack already bound")
                .matcher(sql)
                .find(),
            "must fail-closed on ability/basic_attack key collision");
        assertTrue(
            Pattern.compile(
                    "(?is)62003[\\s\\S]{0,400}ability/basic_attack[\\s\\S]{0,400}NULL")
                .matcher(sql)
                .find(),
            "type 62003 must set reserved_type_id NULL");
        assertTrue(
            Pattern.compile(
                    "(?s)62003\\s*,\\s*'ability'\\s*,\\s*"
                        + "'ability_hero_xayah_p_clean_cuts_basic_attack'")
                .matcher(sql)
                .find(),
            "must relate 62003 to ability_hero_xayah_p_clean_cuts_basic_attack");
        assertFalse(
            Pattern.compile(
                    "(?is)ability_kind_type_id\\s*,?[\\s\\S]{0,80}62003|62003[\\s\\S]{0,80}"
                        + "ability_kind")
                .matcher(sqlNoComments)
                .find(),
            "must not put 62003 into ability_kind_type_id");
        assertTrue(
            Pattern.compile("(?i)conflicting existing Xayah basic_attack").matcher(sql).find()
                || sql.contains("conflicting existing Xayah basic_attack"),
            "must fail-closed on pre-existing Xayah BA conflict");
    }

    @Test
    void encodesListenerAllSetMax1GuardAndDecrement() throws IOException {
        assertContains(HAS_ATTACKS);
        assertContains(CONSUME_DELTA);
        JsonNode guard = JSON.readTree(HAS_ATTACKS);
        assertEquals("gt", guard.path("op").asText(), "guard must be binary gt");
        assertEquals(2, guard.path("args").size(), "gt must be binary");
        assertEquals(
            "provider.state.clean_cuts_attacks_remaining",
            guard.path("args").get(0).path("path").asText());
        assertEquals(0, guard.path("args").get(1).path("value").asInt());
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_xayah_p_clean_cuts_basic_attack_damage'[\\s\\S]{0,240}"
                        + "20217[\\s\\S]{0,80}NULL[\\s\\S]{0,40}1")
                .matcher(sql)
                .find(),
            "listener must be damage_instance 20217 with ability_id NULL and max_triggers=1");
        assertTrue(
            sql.contains(
                "'listener_hero_xayah_p_clean_cuts_basic_attack_damage', 20181, 20217"));
        assertTrue(
            sql.contains(
                "'listener_hero_xayah_p_clean_cuts_basic_attack_damage', 20181, 62003"));
        assertTrue(
            sql.contains(
                "'listener_hero_xayah_p_clean_cuts_basic_attack_damage', 20181, 20212"));
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_p_clean_cuts_consume_attack'\\s*,\\s*"
                        + "'sequence_hero_xayah_p_clean_cuts_consume_attack'\\s*,\\s*"
                        + "0\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*'clean_cuts_has_attacks'")
                .matcher(sql)
                .find(),
            "consume step must be guarded state_change on self");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_xayah_p_clean_cuts_consume_attack'\\s*,\\s*"
                        + "20250\\s*,\\s*'clean_cuts_attacks_remaining'\\s*,\\s*"
                        + "'clean_cuts_consume_delta'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "consume detail must provider-scope add -1 via 20170");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_xayah_p_clean_cuts_basic_attack_damage'\\s*,\\s*"
                        + "'sequence_hero_xayah_p_clean_cuts_consume_attack'")
                .matcher(sql)
                .find(),
            "listener must bind consume sequence");
    }

    @Test
    void documentsForbiddenScopeAndPreservesExistingXayahGraphs() {
        assertTrue(
            sql.contains("true Q/W/E/R") || sql.contains("true Q/W/E/R wiring")
                || sql.contains("no_true_qwer_wiring"),
            "seed must exclude true Q/W/E/R wiring");
        assertTrue(
            sql.contains("8s") || sql.contains("8 s") || sql.contains("timer"),
            "seed must exclude 8s timer");
        assertTrue(
            sql.contains("feather") || sql.contains("Feather"),
            "seed must exclude feather behavior");
        assertTrue(
            sql.contains("miss") || sql.contains("dodge"),
            "seed must exclude miss/dodge");
        assertTrue(
            sql.contains("max5") || sql.contains("max 5") || sql.contains("add/refresh"),
            "seed must exclude add/refresh/max5");
        assertTrue(
            sql.contains("on-hit") || sql.contains("on_hit") || sql.contains("proc")
                || sql.contains("expected crit"),
            "seed must exclude on-hit/proc/expected crit");
        assertTrue(
            sql.contains("preserve") || sql.contains("保留") || sql.contains("永不更新"),
            "seed must document W/Q/R preservation");
    }

    @Test
    void readmeEntryDocumentsOrderingContractPrerequisitesPreservationExclusionsAndNoLive() {
        assertTrue(
            readme.contains("lol_generic_xayah_clean_cuts_three_attack_budget_seed.sql"),
            "README must list the Xayah P Clean Cuts three-attack budget seed");
        assertTrue(
            readme.contains("LolGenericXayahCleanCutsThreeAttackBudgetSeedSqlTest"),
            "README must list the focused JUnit class");
        int wIdx = readme.indexOf("lol_generic_xayah_deadly_plumage_seed.sql");
        int pIdx = readme.indexOf("lol_generic_xayah_clean_cuts_three_attack_budget_seed.sql");
        assertTrue(wIdx >= 0 && pIdx >= 0, "README must contain both Xayah W and P seed paths");
        assertTrue(wIdx < pIdx, "README must place corrected Xayah W entry before Xayah P entry");
        int sectionStart = readme.lastIndexOf("### ", pIdx);
        int sectionEnd = readme.indexOf("\n### ", pIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-xayah-clean-cuts-three-attack-budget"),
            "README entry must name the task key");
        assertTrue(
            section.contains("xayah-p-clean-cuts-three-attack-budget-phase-a-v2"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("attack_count_budget_only"),
            "README must include frozen boundary");
        for (String tag : ORDERED_TAGS) {
            assertTrue(section.contains(tag), "README ordered tags must include " + tag);
        }
        assertTrue(
            section.contains("1324540") && section.contains("3967343")
                && section.contains(CANONICAL_SHA) && section.contains("4068"),
            "README must document Wiki page/rev/canonical SHA/bytes");
        assertTrue(
            section.contains("provider_hero_xayah_p_clean_cuts_three_attack_budget")
                && section.contains("ability_hero_xayah_p_clean_cuts_direct_post_cast_arm")
                && section.contains("ability_hero_xayah_p_clean_cuts_basic_attack"),
            "README must name the three primary P identities");
        assertTrue(
            section.contains("62003") && section.contains("ability/basic_attack"),
            "README must document game-local basic_attack type 62003");
        assertTrue(
            section.contains("clean_cuts_attacks_remaining")
                && (section.contains("max") || section.contains("max_value")
                    || section.contains("max3") || section.contains("max=3")),
            "README must document untimed max3 state");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|feather|miss|dodge|8s|max5|q/w/e/r|on-hit|projectile")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertTrue(
            section.contains("LolGenericXayahCleanCutsThreeAttackBudgetSeedSqlTest")
                && (section.contains("LolGenericXayahDeadlyPlumageSeedSqlTest")
                    || section.contains("DeadlyPlumage")),
            "README focused Maven command should include P test (and preferably W)");
        assertFalse(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_xayah`|"
                    + "ensure `hero_xayah` 最低必要实体|"
                    + "P self-contained|self-contained P")
                .matcher(section)
                .find(),
            "README must not call P self-contained");
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "expected seed to contain: " + needle);
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

    private static Path resolveRelative(String relative) {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        Path direct = cwd.resolve(relative).normalize();
        if (Files.isRegularFile(direct)) {
            return direct;
        }
        Path fromModule = cwd.resolve("../..").resolve(relative).normalize();
        if (Files.isRegularFile(fromModule)) {
            return fromModule;
        }
        Path cursor = cwd;
        for (int i = 0; i < 6; i++) {
            Path candidate = cursor.resolve(relative).normalize();
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
            cursor = cursor.getParent();
            if (cursor == null) {
                break;
            }
        }
        fail("unable to resolve " + relative + " from cwd=" + cwd);
        return direct;
    }

    /** Strip SQL line and block comments before forbidden-write checks. */
    private static String stripSqlComments(String raw) {
        String noBlock = raw.replaceAll("(?s)/\\*.*?\\*/", "\n");
        StringBuilder out = new StringBuilder(noBlock.length());
        for (String line : noBlock.split("\n", -1)) {
            int idx = line.indexOf("--");
            if (idx >= 0) {
                out.append(line, 0, idx);
            } else {
                out.append(line);
            }
            out.append('\n');
        }
        return out.toString();
    }
}
