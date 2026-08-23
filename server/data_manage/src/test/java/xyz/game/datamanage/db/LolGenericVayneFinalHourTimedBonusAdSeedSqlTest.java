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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericVayneFinalHourTimedBonusAdSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_vayne",
        "provider_hero_vayne_r_final_hour_timed_bonus_ad",
        "ability_hero_vayne_r_final_hour_timed_bonus_ad",
        "final_hour",
        "phase_hero_vayne_r_final_hour_timed_bonus_ad_impact",
        "sequence_hero_vayne_r_final_hour_timed_bonus_ad_impact",
        "step_hero_vayne_r_final_hour_timed_bonus_ad_active_arm",
        "cooldown_hero_vayne_r_final_hour_timed_bonus_ad",
        "modifier_hero_vayne_r_final_hour_timed_bonus_ad",
        "final_hour_active",
        "final_hour_active_arm",
        "final_hour_bonus_ad",
        "r_mana_cost",
        "r_cooldown_ms",
        "hero_vayne_r_final_hour_timed_bonus_ad");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20130, 20142, 20160, 20170, 20172, 20190, 20250,
        20260);

    private static final List<String> FORBIDDEN_IDENTITY_PANEL_WRITES = List.of(
        "games",
        "game_entities",
        "attribute_definitions",
        "entity_attribute_values");

    private static final List<String> PRESERVED_PROVIDER_IDS = List.of(
        "provider_hero_vayne_basic_attack",
        "provider_hero_vayne_silver_bolts",
        "provider_hero_vayne_tumble",
        "provider_hero_vayne_e_condemn_primary_hit");

    private static final List<String> ORDERED_TAGS = List.of(
        "cast_triggered_timed_bonus_ad",
        "flat_ad_add",
        "timed_provider_state");

    private static final String BONUS_AD =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":65},"
            + "{\"op\":\"read\",\"path\":\"provider.state.final_hour_active\"}]}";

    private static final String FROZEN_BOUNDARY =
        "rank3_timed_bonus_ad_self_buff; direct_provider_state_change; "
            + "flat_ad_plus_65_for_12000ms; "
            + "no_night_hunter_move_speed_tumble_cooldown_invisibility_"
            + "takedown_extension_stealth_or_movement";

    private static final String CANONICAL_SHA =
        "e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d";

    private static final String LOCAL_RAW_SHA =
        "343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642";

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
        assertContains("hero_skill|hero_vayne|R|终极时刻");
        assertFalse(
            sql.contains("hero_skill|hero_vayne|R|最终时刻"),
            "stable key must reject typo 最终时刻; require exactly 终极时刻");
        assertFalse(
            sql.contains("最终时刻"),
            "seed sql must not contain typo 最终时刻 anywhere");
        assertContains("vayne-r-final-hour-timed-bonus-ad-phase-a-v2");
        assertContains("Template:Data Vayne/R");
        assertContains("Template:Data Vayne/Final Hour");
        assertContains("1309991");
        assertContains("3807995");
        assertContains("2024-11-05T22:07:10Z");
        assertContains("2015");
        assertContains(CANONICAL_SHA);
        assertContains("2012");
        assertContains(LOCAL_RAW_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/vayne-r.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertTrue(
            sql.indexOf(ORDERED_TAGS.get(0)) < sql.indexOf(ORDERED_TAGS.get(1))
                && sql.indexOf(ORDERED_TAGS.get(1)) < sql.indexOf(ORDERED_TAGS.get(2)),
            "ordered tags must appear in frozen order");
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
        assertTrue(
            sql.contains("mana300") && (sql.contains("Wasm") || sql.contains("wasm")),
            "seed comments must note fixture mana300 belongs to future Wasm tests only");
        assertTrue(
            sql.contains("232/232") || (sql.contains("232") && sql.contains("Backend")),
            "seed comments must keep Backend mana at 232/232");
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
            "final hour timed bonus-AD seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bTRUNCATE\\b").matcher(sqlNoLineComments).find(),
            "final hour timed bonus-AD seed must not TRUNCATE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "final hour timed bonus-AD seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "final hour timed bonus-AD seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "final hour timed bonus-AD seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "final hour timed bonus-AD seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoLineComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoLineComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.(heroes|items|skills)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write legacy heroes/items/skills tables");
    }

    @Test
    void validatesBatchBPrerequisitesCheckOnlyAndFailClosedManaEnsure232() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing game_entities hero_vayne");
        assertContains("missing attribute_definitions");
        assertContains("attr_key=ad");
        assertContains("attr_key=mana");
        assertContains("missing entity_attribute_values hero_vayne/ad");
        assertContains("missing entity_attribute_values hero_vayne/mana");
        assertContains("lol_batch_b_adc_entities_seed.sql");
        assertTrue(
            sql.contains("Batch-B") || sql.contains("Batch-B prerequisite"),
            "seed must document Batch-B prerequisite");
        assertTrue(
            sql.contains("basic") && sql.contains("Condemn")
                && (sql.contains("不是") || sql.contains("非"))
                && sql.contains("前置"),
            "seed must state Vayne basic/Tumble/Silver Bolts/Condemn are not prerequisites");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_vayne'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_vayne before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.attribute_definitions\\b[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check attribute_definitions ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.attribute_definitions\\b[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'mana'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check attribute_definitions mana");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_vayne/ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'mana'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_vayne/mana");
        for (String table : FORBIDDEN_IDENTITY_PANEL_WRITES) {
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
                    "(?is)missing provider_hero_vayne_basic_attack|"
                        + "missing provider_hero_vayne_silver_bolts|"
                        + "missing provider_hero_vayne_tumble|"
                        + "missing provider_hero_vayne_e_condemn|"
                        + "condemn.*prerequisite|"
                        + "tumble.*prerequisite|"
                        + "silver_bolts.*prerequisite")
                .matcher(sqlNoLineComments)
                .find(),
            "must not require existing Vayne skill providers as hard prerequisites");
    }

    @Test
    void mountsIndependentFinalHourProviderCoexistingWithExistingVayneProviders() {
        assertContains("provider_hero_vayne_r_final_hour_timed_bonus_ad");
        assertContains("hero_vayne_r_final_hour_timed_bonus_ad");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_vayne_r_final_hour_timed_bonus_ad'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Final Hour provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_vayne'\\s*,\\s*"
                        + "'provider_hero_vayne_r_final_hour_timed_bonus_ad'")
                .matcher(sql)
                .find(),
            "must mount Final Hour provider to hero_vayne");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Final Hour provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Final Hour timed bonus AD only)");
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
                    "(?is)'ability_hero_vayne_e_condemn|"
                        + "'ability_hero_vayne_tumble|"
                        + "'ability_hero_vayne_basic_attack|"
                        + "'phase_hero_vayne_e_|"
                        + "'step_hero_vayne_e_|"
                        + "'step_hero_vayne_basic_attack|"
                        + "'listener_hero_vayne")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write basic/Tumble/Silver Bolts/Condemn ability/listener/effect rows");
    }

    @Test
    void seedsActiveFinalHourWithMana80Cooldown70000MsTimedStateAndAdAdd65() {
        assertContains("ability_hero_vayne_r_final_hour_timed_bonus_ad");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_vayne_r_final_hour_timed_bonus_ad'\\s*,\\s*"
                        + "'provider_hero_vayne_r_final_hour_timed_bonus_ad'\\s*,\\s*"
                        + "'final_hour'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key final_hour");
        assertContains("r_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":80}");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_vayne_r_final_hour_timed_bonus_ad");
        assertContains("r_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":70000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_vayne_r_final_hour_timed_bonus_ad'\\s*,\\s*"
                        + "'ability_hero_vayne_r_final_hour_timed_bonus_ad'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 70000ms via ability_cooldowns");
        assertContains("INSERT INTO public.provider_state_fields");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_vayne_r_final_hour_timed_bonus_ad'\\s*,\\s*"
                        + "'final_hour_active'\\s*,\\s*20100\\s*,\\s*1\\s*,\\s*12000\\s*,\\s*"
                        + "20190")
                .matcher(sql)
                .find(),
            "final_hour_active must be number / max1 / 12000ms / refresh_on_write 20190");
        assertTrue(
            Pattern.compile("(?i)default0|文档契约.*default0|explicit default0|运行时缺省\\s*0")
                .matcher(sql)
                .find(),
            "must document explicit default0 for final_hour_active");
        assertTrue(
            Pattern.compile("(?i)refresh_on_write").matcher(sql).find(),
            "must document refresh_on_write");
        assertContains(BONUS_AD);
        assertContains("provider.state.final_hour_active");
        assertContains("\"value\":65");
        assertContains("INSERT INTO public.provider_modifiers");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_vayne_r_final_hour_timed_bonus_ad'\\s*,\\s*"
                        + "'provider_hero_vayne_r_final_hour_timed_bonus_ad'\\s*,\\s*"
                        + "'final_hour_bonus_ad'\\s*,\\s*NULL\\s*,\\s*20110\\s*,\\s*'ad'"
                        + "[\\s\\S]{0,120}20170\\s*,\\s*'final_hour_bonus_ad'")
                .matcher(sql)
                .find(),
            "AD modifier must be self/source selector with value_policy/add 20170");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define exactly one provider modifier (flat AD add)");
    }

    @Test
    void seedsExactlyOneDirectProviderScopeOverrideConst1StateChangeGraph() {
        assertContains("phase_hero_vayne_r_final_hour_timed_bonus_ad_impact");
        assertContains("sequence_hero_vayne_r_final_hour_timed_bonus_ad_impact");
        assertContains("step_hero_vayne_r_final_hour_timed_bonus_ad_active_arm");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_vayne_r_final_hour_timed_bonus_ad_impact'\\s*,\\s*"
                        + "'ability_hero_vayne_r_final_hour_timed_bonus_ad'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_vayne_r_final_hour_timed_bonus_ad_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_vayne_r_final_hour_timed_bonus_ad_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_r_final_hour_timed_bonus_ad_active_arm'\\s*,\\s*"
                        + "'sequence_hero_vayne_r_final_hour_timed_bonus_ad_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "state_change must be sole step order 0 targeting source/self");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_r_final_hour_timed_bonus_ad_active_arm'\\s*,\\s*"
                        + "20250\\s*,\\s*'final_hour_active'\\s*,\\s*"
                        + "'final_hour_active_arm'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "state_effect_details must be provider-scope override final_hour_active");
        assertContains("{\"op\":\"const\",\"value\":1}");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.state_effect_details"),
            "must have exactly one state_effect_details insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_steps"),
            "must have exactly one effect_steps insert block");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            sql.contains("direct") || sql.contains("直写") || sql.contains("直接"),
            "seed must document direct provider-state write (no ability_started listener)");
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
    void excludesDamageControlMovementProjectileStealthAndForbiddenExecutableSurfaces() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write damage_effect_details");
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
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.(projectile|aoe)_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write projectile/AOE effect detail surfaces");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_control_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_control_effect_details / cooldown-change ops");
        assertFalse(
            Pattern.compile("(?is)\\b20150\\b").matcher(sqlExecutable).find(),
            "executable SQL must not use operation/damage 20150");
        assertFalse(
            Pattern.compile("(?is)\\b20159\\b").matcher(sqlExecutable).find(),
            "executable SQL must not use operation/cooldown_change 20159");
        assertFalse(
            Pattern.compile(
                    "(?i)night.?hunter|move_speed|tumble.?cooldown|invisibility|"
                        + "takedown|stealth|\\bdash\\b|projectile|missile|"
                        + "geometry|multitarget|multi-target|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes")
                .matcher(sqlExecutable)
                .find(),
            "executable topology must not encode excluded R-scoped "
                + "Night Hunter/movement/stealth/damage/geometry surfaces");
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
            sql.contains("Night Hunter") || sql.contains("移速") || sql.contains("move_speed"),
            "seed comments must document exclusion of Night Hunter move speed");
        assertTrue(
            sql.contains("Tumble") || sql.contains("tumble"),
            "seed comments must document exclusion of Tumble cooldown");
        assertTrue(
            sql.contains("invisibility") || sql.contains("stealth") || sql.contains("隐身"),
            "seed comments must document exclusion of invisibility/stealth");
        assertTrue(
            sql.contains("takedown") || sql.contains("extension"),
            "seed comments must document exclusion of takedown/extension");
        assertTrue(
            sql.contains("damage") || sql.contains("伤害"),
            "seed comments must document exclusion of R damage");
    }

    @Test
    void readmeEntryDocumentsPhaseARank3DirectTimedBonusAdBoundary() {
        assertTrue(
            readme.contains("lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql"),
            "README must list the Vayne R Final Hour timed bonus-AD seed");
        assertTrue(
            readme.contains("LolGenericVayneFinalHourTimedBonusAdSeedSqlTest"),
            "README must list the focused JUnit class");
        int seedIdx =
            readme.indexOf("lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("hero_skill|hero_vayne|R|终极时刻"),
            "README entry must document exact stable key hero_skill|hero_vayne|R|终极时刻");
        assertFalse(
            section.contains("hero_skill|hero_vayne|R|最终时刻")
                || section.contains("最终时刻"),
            "README entry must reject typo 最终时刻");
        assertTrue(
            Pattern.compile("(?i)Batch-B|lol_batch_b_adc_entities_seed")
                .matcher(section)
                .find(),
            "README entry must list Batch-B prerequisite");
        assertTrue(
            Pattern.compile("(?i)reserved_types_seed").matcher(section).find(),
            "README entry must list reserved types prerequisite");
        assertTrue(
            Pattern.compile("(?i)direct|直写|state_change|timed.?bonus|bonus.?AD|65|12000")
                .matcher(section)
                .find(),
            "README entry must state Phase-A rank3 direct timed bonus-AD boundary");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("flat_ad_plus_65_for_12000ms")
                || section.contains("rank3_timed_bonus_ad_self_buff"),
            "README entry must document frozen Phase-A boundary");
        assertTrue(
            Pattern.compile(
                    "(?i)Night Hunter|移速|Tumble|invisibility|stealth|takedown|隐身")
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
            "README must not claim full Vayne R fidelity");
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
    }

    /** Strip single-quoted SQL literals so exclusion keywords in metadata are ignored. */
    private static String stripSqlStringLiterals(String raw) {
        return Pattern.compile("'([^']|'')*'").matcher(raw).replaceAll("''");
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
