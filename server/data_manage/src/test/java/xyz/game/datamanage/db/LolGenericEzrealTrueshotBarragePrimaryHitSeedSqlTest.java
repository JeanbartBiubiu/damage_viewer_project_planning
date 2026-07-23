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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_ezreal",
        "provider_hero_ezreal_r_trueshot_barrage_primary_hit",
        "ability_hero_ezreal_r_trueshot_barrage_primary_hit",
        "trueshot_barrage",
        "phase_hero_ezreal_r_trueshot_barrage_primary_hit_impact",
        "sequence_hero_ezreal_r_trueshot_barrage_primary_hit_impact",
        "step_hero_ezreal_r_trueshot_barrage_primary_hit_damage",
        "cost_hero_ezreal_r_trueshot_barrage_primary_hit_mana",
        "cooldown_hero_ezreal_r_trueshot_barrage_primary_hit",
        "trueshot_barrage_damage",
        "r_mana_cost",
        "r_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad", "ap");

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "resource_definitions",
        "game_entities",
        "entity_attribute_values",
        "entity_resource_values");

    private static final String TRUESHOT_BARRAGE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":750},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.10},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final String FROZEN_BOUNDARY =
        "rank3_primary_champion_single_hit; immediate_impact_scaffold; "
            + "magic_750_plus_1_00_bonus_ad_plus_1_10_ap; "
            + "no_cast_delay_queue_projectile_travel_collision_geometry_direction_"
            + "multitarget_sight_minion_or_monster_modified_damage";

    private static final String CANONICAL_SHA =
        "e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0";

    private static final String LOCAL_RAW_SHA =
        "ddc984665670fe9aee859ec740d63c101b04c7f504f610952f94fe67a014f943";

    private static final String TRIM_LF_SHA =
        "57a04bc0b2e42505bd9ec1b324fed4192aecb213ea22dade56f4e77ed553f3ce";

    private static final String BOM_PREPEND_SHA =
        "27fbea33e254bd4b139e49ca0bbface059f490d25fa74cd33b19846596a1c639";

    private static String sql;
    private static String sqlNoLineComments;
    private static String readme;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = Files.readString(readmePath, StandardCharsets.UTF_8);
    }

    @Test
    void documentsSourceIdentityRevisionHashRawCaveatAndFrozenBoundary() {
        assertContains("hero_skill|hero_ezreal|R|精准弹幕");
        assertContains("wasm-generic-ezreal-trueshot-barrage-primary-hit");
        assertContains("ezreal-r-trueshot-barrage-primary-hit-phase-a-v2");
        assertContains("Template:Data Ezreal/R");
        assertContains("Template:Data Ezreal/Trueshot Barrage");
        assertContains("1307113");
        assertContains("4013235");
        assertContains("2026-04-28T21:20:36Z");
        assertContains("1453");
        assertContains(CANONICAL_SHA);
        assertContains("1450");
        assertContains(LOCAL_RAW_SHA);
        assertContains("1449");
        assertContains(TRIM_LF_SHA);
        assertContains(BOM_PREPEND_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("trim") || sql.contains("末端 LF") || sql.contains("LF"),
            "seed comments must record trim-LF local raw materialization");
        assertTrue(
            sql.contains("BOM") || sql.contains("前置 BOM"),
            "seed comments must record BOM-prepend local raw materialization");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/ezreal-r.json");
        assertContains(FROZEN_BOUNDARY);
        assertTrue(
            Pattern.compile("(?i)magic|魔法").matcher(sql).find()
                && (sql.contains("750 + 100% bonus AD + 110% AP")
                    || sql.contains("750 + 1.00")
                    || sql.contains("magic 750")),
            "seed comments must document source magic wording and rank3 750 +100% bAD +110% AP");
        assertTrue(
            sql.contains("bonus AD") || sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD via sub(resolved,base)");
        assertTrue(
            sql.contains("baseAD60") || sql.contains("baseAD 60")
                || (sql.contains("raw1020") && sql.contains("60")),
            "seed comments must document fixture baseAD60");
        assertTrue(
            sql.contains("raw1020") && (sql.contains("510") || sql.contains("mitigated510")),
            "seed comments must document fixture raw1020 / mitigated510");
        assertTrue(
            sql.contains("t0") && sql.contains("t89999") && sql.contains("t90000"),
            "seed comments must document cooldown timeline t0/t89999/t90000");
        assertTrue(
            sql.contains("mana300") || sql.contains("mana300->100")
                || (sql.contains("300") && sql.contains("100") && sql.contains("1500")
                    && sql.contains("480")),
            "seed comments must document terminal mana300->100 and HP1500->480");
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
            Pattern.compile("(?i)ddragon|data.?dragon|meraki")
                .matcher(sqlNoLineComments)
                .find(),
            "must not add DDragon/Meraki provenance in executable SQL");
        assertContains("20260723");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "seed must not use the Batch-B prerequisite phrase");
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
            "trueshot barrage primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "trueshot barrage primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "trueshot barrage primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "trueshot barrage primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "trueshot barrage primary-hit seed must not CREATE TABLE");
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
    void validatesCheckOnlyPrerequisitesAndProjectsOnlyReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_ezreal");
        assertContains("missing entity_attribute_values hero_ezreal/ad");
        assertContains("missing entity_attribute_values hero_ezreal/ap");
        assertContains("missing resource_definitions mana");
        assertContains("missing entity_resource_values hero_ezreal/mana");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("Rising Spell Force") || sql.contains("rising_spell_force"),
            "seed must document shared external dependency with Rising Spell Force seed");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed 物化"),
            "seed must state that no current repository seed materializes Ezreal ad/ap/mana");
        assertContains("INSERT INTO public.types");
        assertEquals(2, REQUIRED_ATTRS.size(), "contract expects exactly ad+ap attr defs");
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
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_ezreal before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_ezreal/ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_ezreal/ap");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.resource_definitions\\b[\\s\\S]{0,200}"
                        + "resource_key\\s*=\\s*'mana'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check resource_definitions mana");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_resource_values\\b[\\s\\S]{0,240}"
                        + "resource_key\\s*=\\s*'mana'")
                .matcher(sqlNoLineComments)
                .find(),
            "must SELECT/EXISTS-check entity_resource_values hero_ezreal/mana");
        for (String table : FORBIDDEN_WRITE_TABLES) {
            assertFalse(
                Pattern.compile(
                        "(?is)(?:INSERT\\s+INTO|UPDATE|MERGE\\s+INTO|DELETE\\s+FROM)\\s+"
                            + "public\\." + table + "\\b")
                    .matcher(sqlNoLineComments)
                    .find(),
                "must not INSERT/UPDATE/MERGE/DELETE public." + table
                    + " (SELECT/EXISTS checks are allowed)");
        }
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_ezreal with the Batch-B prerequisite phrase");
    }

    @Test
    void mountsDedicatedTrueshotBarragePrimaryHitWithoutMutatingRisingSpellForceOrQwe() {
        assertContains("provider_hero_ezreal_r_trueshot_barrage_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_ezreal_r_trueshot_barrage_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Trueshot Barrage primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_ezreal'\\s*,\\s*"
                        + "'provider_hero_ezreal_r_trueshot_barrage_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Trueshot Barrage primary-hit provider to hero_ezreal");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Trueshot Barrage primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Trueshot Barrage primary-hit only)");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertTrue(
            sql.contains("provider_hero_ezreal_rising_spell_force"),
            "seed must document coexistence / non-mutation of Rising Spell Force provider");
        assertFalse(
            Pattern.compile("(?is)'provider_hero_ezreal_rising_spell_force'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write / replace Rising Spell Force provider identity rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'listener_hero_ezreal_rising_spell_force|"
                        + "sequence_hero_ezreal_rising_spell_force|"
                        + "step_hero_ezreal_rising_spell_force|"
                        + "modifier_hero_ezreal_rising_spell_force|"
                        + "rising_spell_force_stacks'")
                .matcher(sqlNoLineComments)
                .find(),
            "must not mutate Rising Spell Force graph rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_ezreal_[qwe]_|'ability_hero_ezreal_[qwe]_|"
                        + "'phase_hero_ezreal_[qwe]_|'step_hero_ezreal_[qwe]_")
                .matcher(sqlNoLineComments)
                .find(),
            "must not create/mutate Q/W/E graph rows");
    }

    @Test
    void seedsActiveTrueshotBarrageWithMana100AndCooldown90000Ms() {
        assertContains("ability_hero_ezreal_r_trueshot_barrage_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_ezreal_r_trueshot_barrage_primary_hit'\\s*,\\s*"
                        + "'provider_hero_ezreal_r_trueshot_barrage_primary_hit'\\s*,\\s*"
                        + "'trueshot_barrage'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key trueshot_barrage");
        assertContains("cost_hero_ezreal_r_trueshot_barrage_primary_hit_mana");
        assertContains("INSERT INTO public.ability_costs");
        assertContains("r_mana_cost");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_ezreal_r_trueshot_barrage_primary_hit_mana'\\s*,\\s*"
                        + "'ability_hero_ezreal_r_trueshot_barrage_primary_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'r_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "R mana cost must be ability-level 100 via ability_costs");
        assertContains("INSERT INTO public.ability_cooldowns");
        assertContains("cooldown_hero_ezreal_r_trueshot_barrage_primary_hit");
        assertContains("r_cooldown_ms");
        assertContains("{\"op\":\"const\",\"value\":90000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_ezreal_r_trueshot_barrage_primary_hit'\\s*,\\s*"
                        + "'ability_hero_ezreal_r_trueshot_barrage_primary_hit'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 90000ms via ability_cooldowns");
    }

    @Test
    void seedsExactlyOneNullDurationImpactPhaseAndMagicBonusAdApDamage() {
        assertContains(TRUESHOT_BARRAGE_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":750");
        assertContains("\"value\":1.00");
        assertContains("\"value\":1.10");
        assertContains("\"op\":\"sub\"");
        assertFalse(
            Pattern.compile("(?is)\\b20220\\b").matcher(sqlNoLineComments).find(),
            "executable SQL must not use physical damage type 20220");
        assertContains("phase_hero_ezreal_r_trueshot_barrage_primary_hit_impact");
        assertContains("sequence_hero_ezreal_r_trueshot_barrage_primary_hit_impact");
        assertContains("step_hero_ezreal_r_trueshot_barrage_primary_hit_damage");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_phases"),
            "must define exactly one ability phase (null-duration impact)");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_ezreal_r_trueshot_barrage_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_ezreal_r_trueshot_barrage_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_ezreal_r_trueshot_barrage_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_ezreal_r_trueshot_barrage_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ezreal_r_trueshot_barrage_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_ezreal_r_trueshot_barrage_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Trueshot Barrage damage must be sole step order 0 to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ezreal_r_trueshot_barrage_primary_hit_damage'\\s*,\\s*"
                        + "'trueshot_barrage_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Trueshot Barrage damage must be magic 20221 add policy copyable_on_hit=false");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.damage_effect_details"),
            "must have exactly one damage_effect_details insert block");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_ezreal_r_trueshot_barrage_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoLineComments).find(),
            "Trueshot Barrage primary-hit must not enable crit eligibility");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void excludesCastDelayQueueProjectileGeometryMultitargetSightMinionAndForbiddenSurfaces() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_listeners");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_state_fields");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.state_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write state_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write modifier_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.modifier_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write modifier_definitions");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_modifiers\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_modifiers");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.repeat_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write repeat_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.control_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write control_effect_details");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.(projectile|aoe)_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write projectile/AOE effect detail surfaces");
        assertFalse(
            Pattern.compile(
                    "(?i)cast.?duration|cast.?delay|cast.?time|"
                        + "phase_hero_ezreal_r_trueshot_barrage_primary_hit_cast|"
                        + "queue.?0\\.5|queue\\s*=\\s*0\\.5|"
                        + "projectile|missile|travel|collision|geometry|direction|"
                        + "target.?location|spellshield|interception|"
                        + "multi.?target|多目标|pass.?through|minimap|"
                        + "minion.?modified|monster.?modified|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "aoe|area.?of.?effect|"
                        + "\\brepeat\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model excluded cast-delay/queue/projectile/geometry/"
                + "direction/multitarget/sight/minion surfaces");
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
            sql.contains("cast time") || sql.contains("cast-delay") || sql.contains("Wiki cast"),
            "seed comments must document exclusion of cast time/delay");
        assertTrue(
            sql.contains("queue") || sql.contains("0.5s"),
            "seed comments must document exclusion of queue");
        assertTrue(
            sql.contains("projectile") || sql.contains("travel") || sql.contains("collision"),
            "seed comments must document exclusion of projectile/travel/collision");
        assertTrue(
            sql.contains("minion") || sql.contains("monster") || sql.contains("300+1.00"),
            "seed comments must document exclusion of minion/monster modified damage");
        assertTrue(
            sql.contains("Rising Spell Force") || sql.contains("rising_spell_force"),
            "seed comments must document non-mutation of Rising Spell Force");
    }

    @Test
    void readmeEntryDocumentsExternalExistingDataCheckOnlyWithoutMaterialization() {
        assertTrue(
            readme.contains("lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql"),
            "README must list the Ezreal R Trueshot Barrage primary-hit seed");
        assertTrue(
            readme.contains("LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile(
                    "(?is)ezreal.*trueshot|精准弹幕|Trueshot Barrage")
                .matcher(readme)
                .find(),
            "README must name Ezreal Trueshot Barrage");
        int seedIdx = readme.indexOf("lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            Pattern.compile("(?i)不物化|no .*materializ|不.*身份|不.*面板|不.*资源值|"
                    + "identity/panel|resource-value")
                .matcher(section)
                .find(),
            "README entry must say no identity/panel/resource-value materialization");
        assertFalse(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_ezreal`|"
                    + "ensure `hero_ezreal` 最低必要实体|"
                    + "ensure `hero_ezreal`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not imitate self-contained hero/panel/mana seed wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
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
