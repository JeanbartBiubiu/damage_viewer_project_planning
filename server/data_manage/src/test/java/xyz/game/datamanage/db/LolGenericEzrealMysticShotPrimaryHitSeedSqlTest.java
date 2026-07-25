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
 * Static contract for {@code lol_generic_ezreal_mystic_shot_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericEzrealMysticShotPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_ezreal_mystic_shot_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_ezreal",
        "provider_hero_ezreal_q_mystic_shot_primary_hit",
        "ability_hero_ezreal_q_mystic_shot_primary_hit",
        "mystic_shot_primary_hit",
        "phase_hero_ezreal_q_mystic_shot_primary_hit_impact",
        "sequence_hero_ezreal_q_mystic_shot_primary_hit_impact",
        "step_hero_ezreal_q_mystic_shot_primary_hit_damage",
        "cost_hero_ezreal_q_mystic_shot_primary_hit_mana",
        "cooldown_hero_ezreal_q_mystic_shot_primary_hit",
        "mystic_shot_primary_hit_damage",
        "q_mana_cost",
        "q_cooldown_ms");

    private static final List<String> PRESERVED_PROVIDER_IDS = List.of(
        "provider_hero_ezreal_rising_spell_force",
        "provider_hero_ezreal_e_arcane_shift_primary_hit",
        "provider_hero_ezreal_r_trueshot_barrage_primary_hit");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad", "ap");

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "resource_definitions",
        "game_entities",
        "entity_attribute_values",
        "entity_resource_values");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_physical_damage",
        "ap_ratio",
        "immediate_impact_scaffold");

    private static final String MYSTIC_SHOT_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":120},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.30},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.40},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_selected_primary_enemy_champion_single_physical_hit; "
            + "immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; "
            + "preserve_rising_spell_force_one_stack_on_successful_hit; "
            + "no_direction_range_projectile_travel_collision_first_enemy_acquisition_"
            + "on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_"
            + "lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533";

    private static final String NORMALIZED_SHA =
        "b7e8639d6fd82df4c66c4f883078b54274b4a1708fdca6bf2703d70a0518ab47";

    private static final String PAGES_SHA =
        "f5f133eef00f3dd4cdc95c0513d3371851b71d890a61b9e8de93716ccd107060";

    private static final String LOCAL_RAW_SHA =
        "d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd";

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
    void documentsSourceIdentityLocalCaveatBoundaryTagsAndTotalAdWording() {
        assertContains("hero_skill|hero_ezreal|Q|秘术射击");
        assertContains("wasm-generic-ezreal-mystic-shot-primary-hit");
        assertContains("ezreal-q-mystic-shot-primary-hit-phase-a-v2");
        assertContains("Template:Data Ezreal/Q");
        assertContains("Template:Data Ezreal/Mystic Shot");
        assertContains("1307107");
        assertContains("4013233");
        assertContains("2026-04-28T21:19:30Z");
        assertContains("2054");
        assertContains(CANONICAL_SHA);
        assertContains("2527");
        assertContains(NORMALIZED_SHA);
        assertContains("692");
        assertContains(PAGES_SHA);
        assertContains("2052");
        assertContains(LOCAL_RAW_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("同 size 不等于等价") || sql.contains("same size is not equivalence")
                || sql.contains("同 size") || sql.contains("不等于等价"),
            "seed comments must caveat that same size is not equivalence");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/ezreal-q.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertDocumentsExplicitAbsenceOfTotalAdRatio(sql, "seed");
        assertTrue(
            (sql.contains("不含") || sql.contains("不包含") || sql.contains("omit")
                    || sql.contains("forbids") || sql.contains("禁止")
                    || sql.contains("显式不包含") || sql.contains("亦不含"))
                && sql.contains("cooldown_or_haste_without_rotation"),
            "seed must explicitly document absence of stale tag cooldown_or_haste_without_rotation");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("120 + 130% total AD + 40% AP")
                    || sql.contains("120 + 1.30")
                    || sql.contains("physical 120")),
            "seed comments must document rank5 physical 120 +130% total AD +40% AP");
        assertTrue(
            (sql.contains("total AD") || sql.contains("totalAD"))
                && sql.contains("source.attr.ad.resolved"),
            "seed must document total-AD direct resolved read");
        assertTrue(
            sql.contains("source.attr.ap.resolved"),
            "seed must document AP resolved read");
        assertTrue(
            sql.contains("不得减 base") || sql.contains("不得称为 bonus AD")
                || sql.contains("never subtract") || sql.contains("never call it bonus AD"),
            "seed must forbid base subtraction and bonus-AD wording for AD ratio");
        assertFalse(
            Pattern.compile("source\\.attr\\.ad\\.base")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not read ad.base (total AD, not bonus AD)");
        assertFalse(
            Pattern.compile("(?i)bonus\\s*AD|bonus_ad")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not claim bonus AD");
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
        assertContains("20260726");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "seed must not use the Batch-B prerequisite phrase");
        assertFalse(
            Pattern.compile("(?i)\\bsalvage\\b").matcher(sqlNoComments).find(),
            "executable SQL must not add salvage tags");
        assertTrue(
            sql.contains("不含 salvage") || sql.contains("亦不含 salvage")
                || sql.contains("no salvage") || sql.contains("不含 salvage tags"),
            "seed comments must document absence of salvage tags");
        assertTrue(
            sql.contains("20220") && (sql.contains("显式 20220") || sql.contains("damage/physical")
                || sql.contains("physical damage type")),
            "seed must document explicit 20220 physical damage prerequisite");
    }

    @Test
    void documentsDeterministicFixturesWithoutClaimingFullFidelity() {
        assertTrue(
            (sql.contains("AD0/AP0/armor0") || sql.contains("AD0/AP0"))
                && (sql.contains("raw/final120") || sql.contains("final120")),
            "seed comments must document AD0/AP0/armor0 raw/final120");
        assertTrue(
            sql.contains("AD100/AP0") && sql.contains("250"),
            "seed comments must document AD100/AP0 => 250");
        assertTrue(
            sql.contains("AD0/AP100") && sql.contains("160"),
            "seed comments must document AD0/AP100 => 160");
        assertTrue(
            sql.contains("AD100/AP100") && sql.contains("290"),
            "seed comments must document AD100/AP100 => 290");
        assertTrue(
            (sql.contains("armor100 raw290/final145")
                    || (sql.contains("raw290") && sql.contains("final145"))),
            "seed comments must document armor100 raw290/final145");
        assertTrue(
            sql.contains("AD200/AP100/armor100")
                && (sql.contains("raw420/final210")
                    || (sql.contains("raw420") && sql.contains("final210"))),
            "seed comments must document AD200/AP100/armor100 raw420/final210");
        assertTrue(
            (sql.contains("totalAD counterproof") || sql.contains("counterproof"))
                && sql.contains("base0/resolved100")
                && sql.contains("base60/resolved100")
                && (sql.contains("both250") || sql.contains("both 250")),
            "seed must document totalAD counterproof both250");
        assertTrue(
            sql.contains("never source.attr.ad.base")
                || (sql.contains("从不读") && sql.contains("source.attr.ad.base"))
                || (sql.contains("不得") && sql.contains("ad.base"))
                || (sql.contains("不减") && sql.contains("ad.base")),
            "seed must document formula never reads source.attr.ad.base");
        assertTrue(
            sql.contains("t0") && sql.contains("t4499") && sql.contains("t4500"),
            "seed comments must document cooldown timeline t0/t4499/t4500");
        assertTrue(
            (sql.contains("Mana180") || sql.contains("mana180"))
                && (sql.contains("mana100") || sql.contains("final mana100"))
                && (sql.contains("HP710") || sql.contains("HP1000")),
            "seed comments must document Mana180→100 / HP1000→710 fixture");
        assertTrue(
            sql.contains("readyAt4500") || sql.contains("readyAt 4500"),
            "seed comments must document readyAt4500");
        assertTrue(
            sql.contains("two Q hits") || (sql.contains("two Q") && sql.contains("hits")),
            "seed comments must document two Q hits");
        assertTrue(
            sql.contains("automatic starts") || (sql.contains("automatic") && sql.contains("starts"))
                || (sql.contains("two") && sql.contains("ability_started")),
            "seed comments must document automatic starts / ability_started");
        assertTrue(
            (sql.contains("Mana39") || sql.contains("mana39"))
                && (sql.contains("skips") || sql.contains("unchanged") || sql.contains("resource skip")),
            "seed comments must document Mana39 skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim")
                || sql.contains("not full Q"),
            "seed must not claim full fidelity");
        assertTrue(
            sql.contains("One selected-primary") || sql.contains("one selected")
                || sql.contains("not full Q") || sql.contains("不是实际"),
            "seed must state one selected-primary physical hit, not full Q");
    }

    @Test
    void usesTransactionLockRevisionIdempotenceAndRejectsPublishDdlDelete() {
        assertTrue(
            sql.trim().startsWith("BEGIN;")
                || Pattern.compile("(?m)^BEGIN;\\s*$").matcher(sql).find(),
            "must BEGIN");
        assertTrue(
            sql.trim().endsWith("COMMIT;")
                || Pattern.compile("(?m)^COMMIT;\\s*$").matcher(sql).find()
                || sql.endsWith("COMMIT;\n")
                || sql.endsWith("COMMIT;\r\n"),
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
            "mystic shot primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "mystic shot primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "mystic shot primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "mystic shot primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "mystic shot primary-hit seed must not CREATE TABLE");
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
            sql.contains("Arcane Shift") || sql.contains("arcane_shift"),
            "seed must document shared external dependency with Arcane Shift seed");
        assertTrue(
            sql.contains("Trueshot Barrage") || sql.contains("trueshot_barrage"),
            "seed must document shared external dependency with Trueshot Barrage seed");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed 物化")
                || sql.contains("无 Ezreal identity materializer"),
            "seed must state that no current repository seed materializes Ezreal identity/ad/ap/mana");
        assertTrue(
            sql.contains("external existing-data dependency")
                || sql.contains("外部既有数据依赖")
                || sql.contains("external existing-data"),
            "seed must use external existing-data identity wording");
        assertTrue(
            sql.contains("does not own an Ezreal identity materializer")
                || sql.contains("无 Ezreal identity materializer")
                || sql.contains("Repository does not own"),
            "seed must record that repository does not own an Ezreal identity materializer");
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
            REQUIRED_RESERVED.contains(20220),
            "required reserved list must explicitly include physical 20220");
        assertFalse(
            REQUIRED_RESERVED.contains(20230),
            "required reserved list must not include provider_action/apply 20230");
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
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.resource_definitions\\b[\\s\\S]{0,200}"
                        + "resource_key\\s*=\\s*'mana'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check resource_definitions mana");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_resource_values\\b[\\s\\S]{0,240}"
                        + "resource_key\\s*=\\s*'mana'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_resource_values hero_ezreal/mana");
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
        assertContains("provider_hero_ezreal_q_mystic_shot_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_ezreal_q_mystic_shot_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Mystic Shot primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_ezreal'\\s*,\\s*"
                        + "'provider_hero_ezreal_q_mystic_shot_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Mystic Shot primary-hit provider to hero_ezreal");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Mystic Shot primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Mystic Shot primary-hit only)");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.ability_definitions"),
            "must define exactly one ability");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.ability_costs"),
            "must define exactly one ability cost");
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
                    "(?s)'ability_hero_ezreal_q_mystic_shot_primary_hit'\\s*,\\s*"
                        + "'provider_hero_ezreal_q_mystic_shot_primary_hit'\\s*,\\s*"
                        + "'mystic_shot_primary_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key mystic_shot_primary_hit");
        assertContains("{\"op\":\"const\",\"value\":40}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_ezreal_q_mystic_shot_primary_hit_mana'\\s*,\\s*"
                        + "'ability_hero_ezreal_q_mystic_shot_primary_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'q_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 40 via ability_costs");
        assertContains("{\"op\":\"const\",\"value\":4500}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_ezreal_q_mystic_shot_primary_hit'\\s*,\\s*"
                        + "'ability_hero_ezreal_q_mystic_shot_primary_hit'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 4500ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_ezreal_q_mystic_shot_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_ezreal_q_mystic_shot_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_ezreal_q_mystic_shot_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_ezreal_q_mystic_shot_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ezreal_q_mystic_shot_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_ezreal_q_mystic_shot_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Mystic Shot damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_ezreal_q_mystic_shot_primary_hit_damage'"),
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
                    "(?is)'provider_hero_ezreal_w_|'ability_hero_ezreal_w_|"
                        + "'phase_hero_ezreal_w_|'step_hero_ezreal_w_")
                .matcher(sqlNoComments)
                .find(),
            "must not create/mutate W graph rows");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("不添加 listener") || sql.contains("不添加 listener 行")
                    || sql.contains("without adding") || sql.contains("不添加")
                    || sql.contains("不写显式")),
            "seed must document ability_started coexistence without Q listener rows");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
    }

    @Test
    void parsesNestedBinaryTotalAdPlusApPhysicalDamageFormula() throws IOException {
        assertContains(MYSTIC_SHOT_DAMAGE);
        assertBinaryNestedTotalAdPlusApDamageFormula(MYSTIC_SHOT_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":120");
        assertContains("\"value\":1.30");
        assertContains("\"value\":0.40");
        assertFalse(
            Pattern.compile("source\\.attr\\.ad\\.base")
                .matcher(sqlNoComments)
                .find(),
            "must not interpret total AD as bonus AD via ad.base subtraction");
        assertEquals(
            2,
            JSON.readTree(MYSTIC_SHOT_DAMAGE).path("args").size(),
            "outer add must remain binary (never three-arg add)");
        assertEquals(
            "add",
            JSON.readTree(MYSTIC_SHOT_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be nested add, not flattened const");
        assertEquals(
            "mul",
            JSON.readTree(MYSTIC_SHOT_DAMAGE).path("args").get(1).path("op").asText(),
            "outer right child must be mul(0.40, AP)");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "source.attr.ad.resolved"),
            "executable formula must read source.attr.ad.resolved exactly once");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "source.attr.ap.resolved"),
            "executable formula must read source.attr.ap.resolved exactly once");
    }

    @Test
    void seedsPhysicalDamageAddPolicyCopyableFalseAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_ezreal_q_mystic_shot_primary_hit_damage'\\s*,\\s*"
                        + "'mystic_shot_primary_hit_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Mystic Shot damage must be physical 20220 add policy copyable_on_hit=false");
        assertFalse(
            Pattern.compile("(?is)\\b20221\\b").matcher(sqlNoComments).find(),
            "executable SQL must not use magic damage type 20221");
        assertFalse(
            Pattern.compile("(?is)\\b20230\\b").matcher(sqlNoComments).find(),
            "executable SQL/graph must not use provider_action/apply 20230");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Mystic Shot primary-hit must not enable crit eligibility");
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
                    "(?i)direction|\\brange\\b|projectile|missile|\\btravel\\b|collision|"
                        + "first.?enemy|acquisition|(?<!copyable_)on[_-]?hit|on[_-]?attack|"
                        + "cooldown.?reduction|dual.?tag|lifesteal|\\bvamp\\b|vampir|"
                        + "spell.?shield|spellshield|buffering|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "aoe|area.?of.?effect|\\brepeat\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded direction/range/projectile/on-hit/dual-tag/"
                + "lifesteal/vamp/spellshield/buffering surfaces");
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
            sql.contains("direction") || sql.contains("range") || sql.contains("projectile"),
            "seed comments must document exclusion of direction/range/projectile");
        assertTrue(
            sql.contains("on-hit") || sql.contains("on-attack") || sql.contains("on_hit")
                || sql.contains("on_attack"),
            "seed comments must document exclusion of on-hit/on-attack");
        assertTrue(
            sql.contains("cooldown reduction") || sql.contains("cooldown_reduction")
                || sql.contains("dual-tag") || sql.contains("dual_tag")
                || sql.contains("basic+spell"),
            "seed comments must document exclusion of CD reduction / dual-tag");
        assertTrue(
            sql.contains("lifesteal") || sql.contains("vamp") || sql.contains("spellshield")
                || sql.contains("spell shield") || sql.contains("buffering"),
            "seed comments must document exclusion of lifesteal/vamp/spellshield/buffering");
        assertTrue(
            sql.contains("Rising Spell Force") || sql.contains("rising_spell_force"),
            "seed comments must document preservation of Rising Spell Force");
        assertTrue(
            sql.contains("Arcane Shift") || sql.contains("arcane_shift"),
            "seed comments must document preservation of Arcane Shift");
        assertTrue(
            sql.contains("Trueshot Barrage") || sql.contains("trueshot_barrage"),
            "seed comments must document preservation of Trueshot Barrage");
    }

    @Test
    void rejectsAbilitySpecificGameLocalQTypeAndTypeRelations() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoComments)
                .find(),
            "Q must not write type_relations (no Q ability-specific type)");
        assertFalse(
            Pattern.compile("(?is)\\b62\\d{3}\\b").matcher(sqlNoComments).find(),
            "executable SQL must not introduce game-local ability-specific 62xxx types");
        assertTrue(
            (sql.contains("无 ability-specific") || sql.contains("无 Q 专用")
                    || sql.contains("no ability-specific") || sql.contains("不得新增 Q")
                    || sql.contains("无 Q-specific"))
                && (sql.contains("62xxx") || sql.contains("game-local type")
                    || sql.contains("Q-specific") || sql.contains("game-local")),
            "seed comments must document that Q has no ability-specific game-local type");
        assertTrue(
            sql.contains("type_relations")
                && (sql.contains("不写") || sql.contains("不新增") || sql.contains("no Q type")),
            "seed comments must document no Q type / no type_relations");
    }

    @Test
    void preservesPERWithoutMutationAndDoesNotCreateW() {
        for (String preserved : PRESERVED_PROVIDER_IDS) {
            assertTrue(
                sql.contains(preserved),
                "seed must name preserved provider " + preserved);
        }
        assertTrue(
            (sql.contains("永不更新") || sql.contains("不更新") || sql.contains("without update")
                    || sql.contains("preserve without"))
                && (sql.contains("删除") || sql.contains("delete") || sql.contains("重建")
                    || sql.contains("recreate")),
            "seed must preserve P/E/R without update/delete/recreate");
        assertTrue(
            sql.contains("不创建") && (sql.contains("W") || sql.contains("不创建/突变 W")),
            "seed must forbid creating W");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_ezreal_w_|'ability_hero_ezreal_w_")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must contain no W rows");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_ezreal_rising_spell_force'|"
                        + "'provider_hero_ezreal_e_arcane_shift_primary_hit'|"
                        + "'provider_hero_ezreal_r_trueshot_barrage_primary_hit'")
                .matcher(sqlNoComments)
                .find(),
            "must not write P/E/R provider identity rows in executable SQL");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesPreservationExclusionsAndNoLivePublish() {
        assertTrue(
            readme.contains("lol_generic_ezreal_mystic_shot_primary_hit_seed.sql"),
            "README must list the Ezreal Q Mystic Shot primary-hit seed");
        assertTrue(
            readme.contains("LolGenericEzrealMysticShotPrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)ezreal.*mystic|秘术射击|Mystic Shot")
                .matcher(readme)
                .find(),
            "README must name Ezreal Mystic Shot");
        int seedIdx = readme.indexOf("lol_generic_ezreal_mystic_shot_primary_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-ezreal-mystic-shot-primary-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("ezreal-q-mystic-shot-primary-hit-phase-a-v2"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY) || section.contains(
                "physical_120_plus_1_30_total_ad_plus_0_40_ap"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertDocumentsExplicitAbsenceOfTotalAdRatio(section, "README");
        assertTrue(
            (section.contains("不含") || section.contains("不包含") || section.contains("亦不含")
                    || section.contains("omit") || section.contains("禁止"))
                && section.contains("cooldown_or_haste_without_rotation"),
            "README must document absence of cooldown_or_haste_without_rotation");
        assertTrue(
            section.contains("1307107") && section.contains("4013233")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(NORMALIZED_SHA) && section.contains("2527"),
            "README must document authoritative normalized SHA/bytes");
        assertTrue(
            section.contains(PAGES_SHA) && section.contains("692"),
            "README must document pages SHA/bytes");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("2054") && section.contains("2052"),
            "README must document canonical 2054 and local raw 2052 byte sizes");
        assertTrue(
            Pattern.compile("(?i)40.*mana|mana.?40|40 mana").matcher(section).find()
                && section.contains("4500"),
            "README must document mana40 and cooldown 4500ms");
        assertTrue(
            section.contains("120") && section.contains("1.30") && section.contains("0.40")
                && (section.contains("total AD") || section.contains("ad.resolved"))
                && (section.contains("AP") || section.contains("ap.resolved")),
            "README must document damage formula with total-AD + AP wording");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            Pattern.compile("(?i)不连 live|不执行.*live|no.?live|不连 live DB")
                .matcher(section)
                .find(),
            "README must make the no-live claim");
        assertTrue(
            section.contains("provider_hero_ezreal_rising_spell_force")
                && section.contains("provider_hero_ezreal_e_arcane_shift_primary_hit")
                && section.contains("provider_hero_ezreal_r_trueshot_barrage_primary_hit"),
            "README must document preservation of P, E, and R providers");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|direction|projectile|on-hit|lifesteal|vamp|"
                        + "spellshield|dual.?tag|buffering")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            section.contains("not full Q") || section.contains("不是 full Q")
                || section.contains("one selected-primary")
                || section.contains("选定主敌方") || section.contains("单次物理命中"),
            "README must say one selected-primary physical hit only / not full Q");
        assertTrue(
            (section.contains("hero-named") || section.contains("hero named")
                    || section.contains("同名英雄") || section.contains("英雄命名"))
                && (section.contains("Wasm") || section.contains("wasm"))
                && (section.contains("regression") || section.contains("回归")
                    || section.contains("证据"))
                && (section.contains("planned") || section.contains("计划")
                    || section.contains("rather than") || section.contains("而非")
                    || section.contains("不是生产") || section.contains("production branching")
                    || section.contains("生产分支")),
            "README must say hero-named Wasm test planned as regression evidence "
                + "rather than production branching");
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
        // Existing Ezreal E/R documentation must remain intact.
        assertTrue(
            readme.contains("lol_generic_ezreal_arcane_shift_primary_hit_seed.sql")
                && readme.contains("LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest")
                && readme.contains("hero_skill|hero_ezreal|E|奥术跃迁"),
            "README must preserve existing Ezreal E documentation");
        assertTrue(
            readme.contains("lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql")
                && readme.contains("LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest"),
            "README must preserve existing Ezreal R documentation");
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
     * Assert exact ordered-tag sequence inside the Ordered-tags declaration block,
     * ignoring earlier incidental occurrences inside the frozen boundary string.
     */
    private static void assertOrderedTagsInDeclarationBlock(String text, String label) {
        int blockStart = text.indexOf("Ordered tags");
        assertTrue(blockStart >= 0, label + " must declare Ordered tags");
        int blockEnd = text.indexOf("契约要点", blockStart);
        if (blockEnd < 0) {
            blockEnd = text.indexOf("该 seed", blockStart);
        }
        if (blockEnd < 0) {
            blockEnd = Math.min(text.length(), blockStart + 500);
        }
        String block = text.substring(blockStart, blockEnd);
        int prev = -1;
        for (String tag : ORDERED_TAGS) {
            int idx = block.indexOf(tag);
            assertTrue(idx >= 0, label + " ordered tags must include " + tag);
            assertTrue(
                idx > prev,
                label + " ordered tags must keep exact order; out of order: " + tag);
            prev = idx;
        }
        assertFalse(
            Pattern.compile(
                    "(?:→\\s*`total_ad_ratio`|`total_ad_ratio`\\s*→|"
                        + "(?m)^\\s*(?:--\\s*)?\\d+\\.\\s*`?total_ad_ratio`?\\b)")
                .matcher(block)
                .find(),
            label + " ordered tags must not list total_ad_ratio as a declared tag");
        assertFalse(
            Pattern.compile(
                    "(?:→\\s*`cooldown_or_haste_without_rotation`"
                        + "|`cooldown_or_haste_without_rotation`\\s*→|"
                        + "(?m)^\\s*(?:--\\s*)?\\d+\\.\\s*`?cooldown_or_haste_without_rotation`?\\b)")
                .matcher(block)
                .find(),
            label + " ordered tags must not list cooldown_or_haste_without_rotation");
    }

    private static void assertDocumentsExplicitAbsenceOfTotalAdRatio(String text, String label) {
        assertTrue(
            (text.contains("不含") || text.contains("不包含") || text.contains("omit")
                    || text.contains("forbids") || text.contains("禁止")
                    || text.contains("显式不包含"))
                && text.contains("total_ad_ratio"),
            label + " must explicitly document absence of governed tag total_ad_ratio");
    }

    /**
     * compileGenericNode only wires args[0]/args[1] for binary arithmetic/comparison ops.
     * Damage formula must use nested binary add(total AD + AP), never a three-argument add.
     */
    private static void assertBinaryNestedTotalAdPlusApDamageFormula(String damageJson)
            throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be nested add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        JsonNode inner = root.path("args").get(0);
        assertEquals("add", inner.path("op").asText(), "inner damage must be nested add");
        assertEquals(2, inner.path("args").size(), "inner add must be binary");
        assertEquals(
            120,
            inner.path("args").get(0).path("value").asDouble(),
            0.0001,
            "inner add left must be const 120");
        JsonNode totalAdMul = inner.path("args").get(1);
        assertEquals("mul", totalAdMul.path("op").asText(), "inner right must be mul");
        assertEquals(2, totalAdMul.path("args").size(), "total-AD mul must be binary");
        assertEquals(
            1.30,
            totalAdMul.path("args").get(0).path("value").asDouble(),
            0.0001,
            "total-AD mul left must be const 1.30");
        assertEquals(
            "source.attr.ad.resolved",
            totalAdMul.path("args").get(1).path("path").asText(),
            "total-AD mul right must read AD resolved");
        JsonNode apMul = root.path("args").get(1);
        assertEquals("mul", apMul.path("op").asText(), "outer right must be mul");
        assertEquals(2, apMul.path("args").size(), "AP mul must be binary");
        assertEquals(
            0.40,
            apMul.path("args").get(0).path("value").asDouble(),
            0.0001,
            "AP mul left must be const 0.40");
        assertEquals(
            "source.attr.ap.resolved",
            apMul.path("args").get(1).path("path").asText(),
            "AP mul right must read AP resolved");
        assertBinaryArithmeticComparisonArity(root, "mystic_shot_primary_hit_damage");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ap.resolved"),
            "AP read must be present in nested binary damage AST");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ad.resolved"),
            "total AD read must be present in nested binary damage AST");
        assertFalse(
            nodeContainsReadPath(root, "source.attr.ad.base"),
            "must not read source.attr.ad.base");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ad.resolved"),
            "AST must read source.attr.ad.resolved exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ap.resolved"),
            "AST must read source.attr.ap.resolved exactly once");
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
        return countReadPathOccurrences(node, readPath) > 0;
    }

    private static int countReadPathOccurrences(JsonNode node, String readPath) {
        if (node == null || node.isNull()) {
            return 0;
        }
        int count = 0;
        if (node.isObject()) {
            if ("read".equals(node.path("op").asText())
                && readPath.equals(node.path("path").asText())) {
                count++;
            }
            Iterator<JsonNode> values = node.elements();
            while (values.hasNext()) {
                count += countReadPathOccurrences(values.next(), readPath);
            }
            return count;
        }
        if (node.isArray()) {
            for (JsonNode child : node) {
                count += countReadPathOccurrences(child, readPath);
            }
        }
        return count;
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
