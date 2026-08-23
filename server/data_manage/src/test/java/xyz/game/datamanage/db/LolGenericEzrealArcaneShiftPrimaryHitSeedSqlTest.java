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
 * Static contract for {@code lol_generic_ezreal_arcane_shift_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_ezreal_arcane_shift_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_ezreal",
        "provider_hero_ezreal_e_arcane_shift_primary_hit",
        "ability_hero_ezreal_e_arcane_shift_primary_hit",
        "arcane_shift_primary_hit",
        "phase_hero_ezreal_e_arcane_shift_primary_hit_impact",
        "sequence_hero_ezreal_e_arcane_shift_primary_hit_impact",
        "step_hero_ezreal_e_arcane_shift_primary_hit_damage",
        "cooldown_hero_ezreal_e_arcane_shift_primary_hit",
        "arcane_shift_damage",
        "e_mana_cost",
        "e_cooldown_ms");

    private static final List<String> PRESERVED_PROVIDER_IDS = List.of(
        "provider_hero_ezreal_rising_spell_force",
        "provider_hero_ezreal_r_trueshot_barrage_primary_hit");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad", "ap");

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "game_entities",
        "entity_attribute_values"
    );

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_magic_damage",
        "bonus_ad_ratio",
        "ap_ratio",
        "immediate_impact_scaffold");

    private static final String ARCANE_SHIFT_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":280},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.60},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.75},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_champion_single_hit; immediate_impact_scaffold; "
            + "magic_280_plus_0_60_bonus_ad_plus_0_75_ap; "
            + "preserve_rising_spell_force_one_stack_on_successful_hit; "
            + "no_blink_homing_target_selection_visibility_essence_flux_priority_"
            + "projectile_travel_reveal_or_other_ranks";

    private static final String CANONICAL_SHA =
        "7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347";

    private static final String LOCAL_RAW_SHA =
        "f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792";

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
    void documentsSourceIdentityLocalCaveatBoundaryAndOrderedTags() {
        assertContains("hero_skill|hero_ezreal|E|奥术跃迁");
        assertContains("wasm-generic-ezreal-arcane-shift-primary-hit");
        assertContains("ezreal-e-arcane-shift-primary-hit-phase-a-v3");
        assertContains("Template:Data Ezreal/E");
        assertContains("Template:Data Ezreal/Arcane Shift");
        assertContains("1307111");
        assertContains("3989862");
        assertContains("2026-02-03T23:19:20Z");
        assertContains("1661");
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
        assertContains("normalized/generic/ezreal-e.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertTrue(
            Pattern.compile("(?i)magic|魔法").matcher(sql).find()
                && (sql.contains("280 + 60% bonus AD + 75% AP")
                    || sql.contains("280 + 0.60")
                    || sql.contains("magic 280")),
            "seed comments must document rank5 magic 280 +60% bAD +75% AP");
        assertTrue(
            sql.contains("bonus AD") || sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD via sub(resolved,base)");
        assertTrue(
            sql.contains("嵌套二元") || sql.contains("nested binary")
                || sql.contains("永不复制历史 Ezreal R 三元"),
            "seed must document nested-binary add and forbid historical R three-arg add");
        assertTrue(
            Pattern.compile("(?i)无截图|无.*OCR|screenshot|OCR").matcher(sql).find()
                && Pattern.compile("(?i)无截图|不含截图|无.*OCR|不.*OCR|without.*screenshot|"
                    + "no screenshot|无截图 / OCR")
                    .matcher(sql)
                    .find(),
            "seed comments must explicitly disclaim screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)screenshot|ocr|截图识别|光学字符")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not cite screenshot/OCR provenance");
        assertFalse(
            Pattern.compile("(?i)ddragon|data.?dragon|meraki")
                .matcher(sqlNoComments)
                .find(),
            "must not add DDragon/Meraki provenance in executable SQL");
        assertContains("20260724");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "seed must not use the Batch-B prerequisite phrase");
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
            "arcane shift primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "arcane shift primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "arcane shift primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "arcane shift primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "arcane shift primary-hit seed must not CREATE TABLE");
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
    void validatesCheckOnlyPrerequisitesAndExternalIdentityWording() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_ezreal");
        assertContains("missing entity_attribute_values hero_ezreal/ad");
        assertContains("missing entity_attribute_values hero_ezreal/ap");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("Rising Spell Force") || sql.contains("rising_spell_force"),
            "seed must document shared external dependency with Rising Spell Force seed");
        assertTrue(
            sql.contains("Trueshot Barrage") || sql.contains("trueshot_barrage"),
            "seed must document shared external dependency with Trueshot Barrage seed");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed 物化"),
            "seed must state that no current repository seed materializes Ezreal identity/ad/ap/mana");
        assertTrue(
            sql.contains("external existing-data dependency")
                || sql.contains("外部既有数据依赖"),
            "seed must use external existing-data identity wording");
        assertContains("INSERT INTO public.types");
        assertEquals(2, REQUIRED_ATTRS.size(), "contract expects exactly ad+ap attr defs");
        Matcher attrsArray = Pattern.compile(
                "(?is)v_required_attrs\\s+text\\[\\]\\s*:=\\s*ARRAY\\[(.*?)]")
            .matcher(sqlNoComments);
        assertTrue(attrsArray.find(), "must declare v_required_attrs array");
        String attrsBlock = attrsArray.group(1);
        for (String attr : REQUIRED_ATTRS) {
            assertTrue(
                attrsBlock.contains("'" + attr + "'"),
                "attr preflight must include: " + attr);
        }
        assertEquals(
            2,
            countOccurrences(attrsBlock, "'") / 2,
            "attr preflight array must list exactly ad and ap");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_ezreal'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_ezreal before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_ezreal/ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_ezreal/ap");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_ezreal with the Batch-B prerequisite phrase");
    }

    @Test
    void forbidsSharedIdentityPanelAndResourceTableWrites() {
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
    }

    @Test
    void mountsIsolatedProviderAbilityCostCooldownPhaseSequenceStepDetailAndMount() {
        assertContains("provider_hero_ezreal_e_arcane_shift_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_ezreal_e_arcane_shift_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Arcane Shift primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_ezreal'\\s*,\\s*"
                        + "'provider_hero_ezreal_e_arcane_shift_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Arcane Shift primary-hit provider to hero_ezreal");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Arcane Shift primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (E Arcane Shift primary-hit only)");
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
            "must define exactly one effect step");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.damage_effect_details"),
            "must define exactly one damage_effect_details");
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
                    "(?s)'ability_hero_ezreal_e_arcane_shift_primary_hit'\\s*,\\s*"
                        + "'provider_hero_ezreal_e_arcane_shift_primary_hit'\\s*,\\s*"
                        + "'arcane_shift_primary_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "E must be active ability with stable key arcane_shift_primary_hit");
        assertContains("{\"op\":\"const\",\"value\":70}");
        assertContains("{\"op\":\"const\",\"value\":14000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_ezreal_e_arcane_shift_primary_hit'\\s*,\\s*"
                        + "'ability_hero_ezreal_e_arcane_shift_primary_hit'\\s*,\\s*"
                        + "'e_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "E cooldown must be 14000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_ezreal_e_arcane_shift_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_ezreal_e_arcane_shift_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_ezreal_e_arcane_shift_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_ezreal_e_arcane_shift_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ezreal_e_arcane_shift_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_ezreal_e_arcane_shift_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Arcane Shift damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_ezreal_e_arcane_shift_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        for (String preserved : PRESERVED_PROVIDER_IDS) {
            assertTrue(
                sql.contains(preserved),
                "seed must document coexistence / non-mutation of " + preserved);
            assertFalse(
                Pattern.compile("(?is)'" + preserved + "'")
                    .matcher(sqlNoComments)
                    .find(),
                "must not write / replace preserved provider identity rows: " + preserved);
        }
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_ezreal_[qw]_|'ability_hero_ezreal_[qw]_|"
                        + "'phase_hero_ezreal_[qw]_|'step_hero_ezreal_[qw]_")
                .matcher(sqlNoComments)
                .find(),
            "must not create/mutate Q/W graph rows");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("不添加 listener") || sql.contains("不添加 listener 行")
                    || sql.contains("without adding") || sql.contains("不添加")),
            "seed must document ability_started coexistence without E listener rows");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void parsesNestedBinaryDamageFormulaWithBonusAdAndApRatios() throws IOException {
        assertContains(ARCANE_SHIFT_DAMAGE);
        assertBinaryNestedDamageFormula(ARCANE_SHIFT_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":280");
        assertContains("\"value\":0.60");
        assertContains("\"value\":0.75");
        assertContains("\"op\":\"sub\"");
        assertEquals(
            2,
            JSON.readTree(ARCANE_SHIFT_DAMAGE).path("args").size(),
            "outer add must remain binary (never historical R three-arg add)");
        assertEquals(
            "add",
            JSON.readTree(ARCANE_SHIFT_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be nested add, not flattened const");
    }

    @Test
    void seedsMagicDamageAddPolicyCopyableFalseAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ezreal_e_arcane_shift_primary_hit_damage'\\s*,\\s*"
                        + "'arcane_shift_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Arcane Shift damage must be magic 20221 add policy copyable_on_hit=false");
        assertFalse(
            Pattern.compile("(?is)\\b20220\\b").matcher(sqlNoComments).find(),
            "executable SQL must not use physical damage type 20220");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Arcane Shift primary-hit must not enable crit eligibility");
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
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_definitions\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write modifier_definitions");
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
                    "(?i)blink|displacement|homing|nearest.?enemy|visibility|unseen|"
                        + "essence.?flux|projectile|missile|travel|collision|"
                        + "interception|spell.?shield|reveal|target.?location|"
                        + "cast.?time|terrain|geometry|direction|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "aoe|area.?of.?effect|\\brepeat\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded blink/homing/visibility/Essence Flux/"
                + "projectile/travel/reveal surfaces");
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
            sql.contains("blink") || sql.contains("displacement"),
            "seed comments must document exclusion of blink/displacement");
        assertTrue(
            sql.contains("Essence Flux") || sql.contains("essence_flux")
                || sql.contains("homing"),
            "seed comments must document exclusion of homing/Essence Flux");
        assertTrue(
            sql.contains("projectile") || sql.contains("travel") || sql.contains("reveal"),
            "seed comments must document exclusion of projectile/travel/reveal");
        assertTrue(
            sql.contains("Rising Spell Force") || sql.contains("rising_spell_force"),
            "seed comments must document preservation of Rising Spell Force");
        assertTrue(
            sql.contains("Trueshot Barrage") || sql.contains("trueshot_barrage"),
            "seed comments must document preservation of Trueshot Barrage");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesPreservationExclusionsAndNoLivePublish() {
        assertTrue(
            readme.contains("lol_generic_ezreal_arcane_shift_primary_hit_seed.sql"),
            "README must list the Ezreal E Arcane Shift primary-hit seed");
        assertTrue(
            readme.contains("LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)ezreal.*arcane|奥术跃迁|Arcane Shift")
                .matcher(readme)
                .find(),
            "README must name Ezreal Arcane Shift");
        int seedIdx = readme.indexOf("lol_generic_ezreal_arcane_shift_primary_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-ezreal-arcane-shift-primary-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("ezreal-e-arcane-shift-primary-hit-phase-a-v3"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY) || section.contains(
                "magic_280_plus_0_60_bonus_ad_plus_0_75_ap"),
            "README must include frozen boundary");
        for (String tag : ORDERED_TAGS) {
            String expectedTag = "ability_cost_cooldown".equals(tag)
                ? "ability_cooldown"
                : tag;
            assertTrue(section.contains(expectedTag), "README ordered tags must include " + expectedTag);
        }
        assertTrue(
            section.contains("1307111") && section.contains("3989862")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言")),
            "README must document local raw caveat");
        assertTrue(section.contains("14000"), "README must document cooldown 14000ms");
        assertTrue(
            section.contains("280") && section.contains("0.60") && section.contains("0.75"),
            "README must document damage formula constants/ratios");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("provider_hero_ezreal_rising_spell_force")
                && section.contains("provider_hero_ezreal_r_trueshot_barrage_primary_hit"),
            "README must document preservation of P and R providers");
        assertTrue(
            Pattern.compile("(?i)排除|exclusion|blink|homing|Essence Flux|projectile|reveal")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertFalse(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_ezreal`|"
                    + "ensure `hero_ezreal` 最低必要实体|"
                    + "ensure `hero_ezreal`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
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

    /**
     * compileGenericNode only wires args[0]/args[1] for binary arithmetic/comparison ops.
     * Damage formula must use nested binary add, never a three-argument add.
     */
    private static void assertBinaryNestedDamageFormula(String damageJson) throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be nested add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        JsonNode inner = root.path("args").get(0);
        assertEquals("add", inner.path("op").asText(), "inner damage must be nested add");
        assertEquals(2, inner.path("args").size(), "inner add must be binary");
        assertEquals(
            280,
            inner.path("args").get(0).path("value").asInt(),
            "inner add left must be const 280");
        assertBinaryArithmeticComparisonArity(root, "arcane_shift_damage");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ap.resolved"),
            "AP read must be present in nested binary damage AST");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ad.resolved")
                && nodeContainsReadPath(root, "source.attr.ad.base"),
            "bonus AD must be sub(resolved, base) under nested binary AST");
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
