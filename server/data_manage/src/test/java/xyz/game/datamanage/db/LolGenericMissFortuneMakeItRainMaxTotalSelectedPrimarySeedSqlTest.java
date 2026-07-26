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
 * Static contract for
 * {@code lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericMissFortuneMakeItRainMaxTotalSelectedPrimarySeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_missfortune",
        "provider_hero_missfortune_e_make_it_rain_max_total_selected_primary",
        "ability_hero_missfortune_e_make_it_rain_max_total_selected_primary",
        "make_it_rain_max_total_selected_primary",
        "phase_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact",
        "sequence_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact",
        "step_hero_missfortune_e_make_it_rain_max_total_selected_primary_damage",
        "cost_hero_missfortune_e_make_it_rain_max_total_selected_primary_mana",
        "cooldown_hero_missfortune_e_make_it_rain_max_total_selected_primary",
        "make_it_rain_max_total_selected_primary_damage",
        "e_mana_cost",
        "e_cooldown_ms",
        "hero_missfortune_e_make_it_rain_max_total_selected_primary");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "resource_definitions",
        "game_entities",
        "entity_attribute_values",
        "entity_resource_values");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_magic_damage",
        "ap_ratio",
        "immediate_aggregated_duration_total_scaffold");

    private static final String MAKE_IT_RAIN_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":190},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.20},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_selected_primary_champion_max_duration_total_magic_damage; "
            + "immediate_aggregated_duration_total_scaffold; magic_190_plus_1_20_ap; "
            + "mana80_cooldown14000ms; exactly_one_aggregated_damage_quantum; "
            + "no_two_second_duration_eight_ticks_quarter_second_tick_schedule_"
            + "location_area_geometry_multitarget_sight_slow_dynamic_slow_refresh_"
            + "or_full_fidelity";

    private static final String CANONICAL_SHA =
        "a38b513373be3b0491f7c967af8827dbdc9196452e5feb25614af3b78ab286f7";

    private static final String NORMALIZED_GENERIC_SHA =
        "d53466f5d4e7e046620820cfd492133bcfac646e2d81d348dfcf544fe8174596";

    private static final String PAGES_SHA =
        "ac8ffb762ccb1667b7c3f955a60e418cb36553b1c653ebb6a70b613c4bf0a0dc";

    private static final String LOCAL_RAW_SHA =
        "5a8800d1ca721f1583bb3d2c5581977a2e4942d399266ca3c745cd11e6503b7f";

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
    void documentsSourceIdentityLocalCaveatBoundaryTagsAndApWording() {
        assertContains("hero_skill|hero_missfortune|E|枪林弹雨");
        assertContains("wasm-generic-miss-fortune-make-it-rain-max-total-selected-primary");
        assertContains(
            "miss-fortune-e-make-it-rain-max-total-selected-primary-phase-a-v2");
        assertContains("Template:Data Miss Fortune/E");
        assertContains("Template:Data Miss Fortune/Make It Rain");
        assertContains("1308255");
        assertContains("3936384");
        assertContains("2025-07-24T15:45:56Z");
        assertContains("1210");
        assertContains(CANONICAL_SHA);
        assertContains("1972");
        assertContains(NORMALIZED_GENERIC_SHA);
        assertContains("747");
        assertContains(PAGES_SHA);
        assertContains(LOCAL_RAW_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/missfortune-e.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertDocumentsExplicitAbsenceOfImmediateImpactScaffold(sql, "seed");
        assertTrue(
            Pattern.compile("(?i)magic|魔法").matcher(sql).find()
                && (sql.contains("190 + 120% AP")
                    || sql.contains("190 + 1.20")
                    || sql.contains("magic 190")),
            "seed comments must document rank5 magic 190 +120% AP");
        assertTrue(
            sql.contains("source.attr.ap.resolved")
                && (sql.contains("直接读取") || sql.contains("直接读") || sql.contains("AP is")),
            "seed must document direct AP resolved read");
        assertTrue(
            sql.contains("eight ticks") || sql.contains("190/8")
                || sql.contains("无 tick schedule"),
            "seed must document Wiki eight-tick derivation vs Phase-A no tick schedule");
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
        assertFalse(
            sql.contains("MissFortune.json")
                && Pattern.compile("(?i)当前真相|current truth").matcher(sql).find()
                && !sql.contains("不以"),
            "seed must reject legacy champion MissFortune.json as current truth");
        assertContains("20260726");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "seed must not use the Batch-B prerequisite phrase");
    }

    @Test
    void documentsDeterministicFixturesWithoutClaimingFullFidelity() {
        assertTrue(
            sql.contains("AP0") && sql.contains("raw190")
                && (sql.contains("final95") || (sql.contains("MR100") && sql.contains("95"))),
            "seed comments must document AP0 => raw190 / MR100 => final95");
        assertTrue(
            sql.contains("AP100") && sql.contains("raw310")
                && (sql.contains("final155") || (sql.contains("MR100") && sql.contains("155"))),
            "seed comments must document AP100 => raw310 / MR100 => final155");
        assertTrue(
            sql.contains("unrelated AD") || sql.contains("无关 AD")
                || (sql.contains("unrelated") && sql.contains("AD")),
            "seed comments must document unrelated-AD counterproof");
        assertTrue(
            sql.contains("crit") && (sql.contains("absent") || sql.contains("不读")
                || sql.contains("must not change")),
            "seed comments must document absent/unrelated crit inputs");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("standalone")
                || sql.contains("no P/Q/W/R/basic")
                || sql.contains("standalone E"),
            "seed comments must document standalone provider / no sibling synthesis");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim")
                || sql.contains("not full E") || sql.contains("不是 full E"),
            "seed must not claim full fidelity");
        assertTrue(
            (sql.contains("Phase-A") || sql.contains("aggregated"))
                && (sql.contains("不是实际") || sql.contains("not actual")
                    || sql.contains("无 tick schedule") || sql.contains("no tick")),
            "seed must clarify immediate aggregated scaffold is not actual tick schedule");
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
            "make-it-rain max-total seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "make-it-rain max-total seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "make-it-rain max-total seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "make-it-rain max-total seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "make-it-rain max-total seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroMissFortuneApManaAndNoRepositoryMaterializer() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_missfortune");
        assertContains("missing entity_attribute_values hero_missfortune/ap");
        assertContains("missing resource_definitions mana");
        assertContains("missing entity_resource_values hero_missfortune/mana");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed")
                || sql.contains("当前仓库无") && sql.contains("materializer"),
            "seed must state that no current repository seed/materializer provides Miss Fortune rows");
        assertTrue(
            sql.contains("external existing-data dependency")
                || sql.contains("外部既有")
                || sql.contains("external existing-data"),
            "seed must use external existing-data identity wording");
        assertTrue(
            sql.contains("无 Miss Fortune") && sql.contains("materializer")
                || sql.contains("不主张") && sql.contains("materializer")
                || sql.contains("勿暗示 Miss Fortune materializer"),
            "seed must not claim a Miss Fortune materializer exists");
        assertContains("INSERT INTO public.types");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_missfortune'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_missfortune before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.attribute_definitions\\b[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check attribute_definitions ap");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_missfortune/ap");
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
            "must SELECT/EXISTS-check entity_resource_values hero_missfortune/mana");
        int heroCheck = sqlNoComments.indexOf("missing game_entities hero_missfortune");
        int apCheck = sqlNoComments.indexOf("hero_missfortune/ap");
        int manaCheck = sqlNoComments.indexOf("hero_missfortune/mana");
        int graphWrite = sqlNoComments.indexOf("INSERT INTO public.provider_definitions");
        assertTrue(heroCheck >= 0 && graphWrite > heroCheck,
            "fail-closed hero_missfortune check must precede provider graph writes");
        assertTrue(apCheck >= 0 && graphWrite > apCheck,
            "fail-closed ap checks must precede provider graph writes");
        assertTrue(manaCheck >= 0 && graphWrite > manaCheck,
            "fail-closed mana checks must precede provider graph writes");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_missfortune with the Batch-B prerequisite phrase");
        assertFalse(
            Pattern.compile("(?i)sibling provider.*(create|提供|物化)|本 seed 创建.*(身份|面板|资源)")
                .matcher(sql)
                .find(),
            "must not imply sibling provider or this seed creates identity/panel/resource rows");
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
        assertContains("provider_hero_missfortune_e_make_it_rain_max_total_selected_primary");
        assertContains("hero_missfortune_e_make_it_rain_max_total_selected_primary");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Make It Rain max-total provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_missfortune'\\s*,\\s*"
                        + "'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary'")
                .matcher(sql)
                .find(),
            "must mount Make It Rain max-total provider to hero_missfortune");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Make It Rain max-total provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (E Make It Rain max-total only)");
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
                    "(?s)'ability_hero_missfortune_e_make_it_rain_max_total_selected_primary'\\s*,\\s*"
                        + "'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary'\\s*,\\s*"
                        + "'make_it_rain_max_total_selected_primary'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "E must be active ability with stable key make_it_rain_max_total_selected_primary");
        assertContains("{\"op\":\"const\",\"value\":80}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_missfortune_e_make_it_rain_max_total_selected_primary_mana'\\s*,\\s*"
                        + "'ability_hero_missfortune_e_make_it_rain_max_total_selected_primary'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'e_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "E mana cost must be ability-level 80 via ability_costs");
        assertContains("{\"op\":\"const\",\"value\":14000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_missfortune_e_make_it_rain_max_total_selected_primary'\\s*,\\s*"
                        + "'ability_hero_missfortune_e_make_it_rain_max_total_selected_primary'\\s*,\\s*"
                        + "'e_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "E cooldown must be 14000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact'\\s*,\\s*"
                        + "'ability_hero_missfortune_e_make_it_rain_max_total_selected_primary'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_missfortune_e_make_it_rain_max_total_selected_primary_damage'\\s*,\\s*"
                        + "'sequence_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Make It Rain damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_missfortune_e_make_it_rain_max_total_selected_primary_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("不写显式") || sql.contains("不写") || sql.contains("no explicit")
                    || sql.contains("不添加")),
            "seed must document automatic ability_started without explicit event step");
    }

    @Test
    void parsesBinaryApMagicDamageFormulaApReadOnceAndNoForbiddenReads() throws IOException {
        assertContains(MAKE_IT_RAIN_DAMAGE);
        assertBinaryApDamageFormula(MAKE_IT_RAIN_DAMAGE);
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":190");
        assertContains("\"value\":1.20");
        JsonNode root = JSON.readTree(MAKE_IT_RAIN_DAMAGE);
        assertEquals(
            2,
            root.path("args").size(),
            "outer add must remain binary");
        assertEquals(
            "const",
            root.path("args").get(0).path("op").asText(),
            "outer left child must be const 190");
        assertEquals(
            "mul",
            root.path("args").get(1).path("op").asText(),
            "outer right child must be mul(1.20, AP)");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ap.resolved"),
            "ap.resolved must appear exactly once");
        assertEquals(
            0,
            countReadPathOccurrences(root, "source.attr.ad.resolved"),
            "ad.resolved must not appear");
        assertEquals(
            0,
            countReadPathOccurrences(root, "source.attr.ad.base"),
            "ad.base must not appear");
        assertEquals(
            0,
            countReadPathOccurrences(root, "source.attr.crit_chance.resolved"),
            "crit_chance must not appear");
        assertEquals(
            0,
            countReadPathOccurrences(root, "source.attr.crit_damage.resolved"),
            "crit_damage must not appear");
        assertFalse(
            Pattern.compile("(?is)source\\.attr\\.ad\\.(resolved|base)")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not include AD scaling");
        assertFalse(
            Pattern.compile("(?is)source\\.attr\\.crit_(chance|damage)\\.")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not include crit reads");
    }

    @Test
    void assertsDeterministicFixtureArithmeticForApAndMr() {
        assertEquals(190.0, rawDamage(0), 0.0001, "AP0 raw190");
        assertEquals(310.0, rawDamage(100), 0.0001, "AP100 raw310");
        assertEquals(95.0, finalVsMr(190.0, 100), 0.0001, "AP0 MR100 final95");
        assertEquals(155.0, finalVsMr(310.0, 100), 0.0001, "AP100 MR100 final155");
        assertEquals(rawDamage(0), 190.0, 0.0001);
        assertEquals(rawDamage(100), 310.0, 0.0001);
    }

    @Test
    void seedsMagicDamageAddPolicyCopyableFalseAndZeroForbiddenSurfacesIncludingNoRMutation() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_missfortune_e_make_it_rain_max_total_selected_primary_damage'\\s*,\\s*"
                        + "'make_it_rain_max_total_selected_primary_damage'\\s*,\\s*"
                        + "20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Make It Rain damage must be magic 20221 add policy copyable_on_hit=false");
        assertFalse(
            REQUIRED_RESERVED.contains(20230),
            "required reserved list must not include provider_action/apply 20230");
        assertFalse(
            Pattern.compile("(?is)\\b20220\\b").matcher(sqlNoComments).find(),
            "executable SQL must not use physical damage type 20220");
        assertFalse(
            Pattern.compile("(?is)\\b20230\\b").matcher(sqlNoComments).find(),
            "executable SQL/graph must not use provider_action/apply 20230 "
                + "(not damage type; not in required reserved; not projected)");
        assertFalse(
            Pattern.compile(
                    "(?is)v_required_reserved\\s+int\\[\\]\\s*:=\\s*ARRAY\\[[^\\]]*\\b20230\\b")
                .matcher(sqlNoComments)
                .find(),
            "v_required_reserved must not list 20230");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Make It Rain max-total must not enable crit eligibility");
        assertTrue(
            sql.contains("CritEligible=false") || sql.contains("crit_eligible=false")
                || sql.contains("crit_eligible = false") || sql.contains("noncrit"),
            "seed must document CritEligible=false / noncrit");
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
                    "(?i)two.?second|eight.?tick|0\\.25s|quarter.?second|tick.?schedule|"
                        + "tick.?snapshot|\\bslow\\b|dynamic.?slow|spell.?effect|"
                        + "persistent.?area|\\banimation\\b|\\bcleanse\\b|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "\\brepeat\\b|projectile|scheduler")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded two-second/eight-tick/schedule/location/"
                + "slow/spell-effect/animation surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_missfortune_[pqwr]_|'ability_hero_missfortune_[pqwr]_|"
                        + "'provider_hero_missfortune_basic_|'ability_hero_missfortune_basic_")
                .matcher(sqlNoComments)
                .find(),
            "must not create P/Q/W/R/basic graph rows");
        assertFalse(
            Pattern.compile(
                    "(?is)bullet_time|provider_hero_missfortune_r_|"
                        + "ability_hero_missfortune_r_|max_channel_expected")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not mutate or duplicate existing Miss Fortune R");
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
            sql.contains("two second") || sql.contains("two-second")
                || sql.contains("eight tick") || sql.contains("eight ticks")
                || sql.contains("0.25"),
            "seed comments must document exclusion of two-second/eight-tick/0.25s schedule");
        assertTrue(
            sql.contains("slow") || sql.contains("sight") || sql.contains("geometry")
                || sql.contains("multitarget") || sql.contains("location"),
            "seed comments must document exclusion of location/area/geometry/multitarget/"
                + "sight/slow");
        assertTrue(
            sql.contains("不突变") || sql.contains("不复制") || sql.contains("并存")
                || sql.contains("coexist") || sql.contains("既有") && sql.contains("R"),
            "seed comments must document coexist-with / no-mutation of existing R");
    }

    @Test
    void rejectsAbilitySpecificGameLocalETypeAndTypeRelations() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoComments)
                .find(),
            "E must not write type_relations (no E ability-specific type)");
        assertFalse(
            Pattern.compile("(?is)\\b62\\d{3}\\b").matcher(sqlNoComments).find(),
            "executable SQL must not introduce game-local ability-specific 62xxx types");
        assertTrue(
            (sql.contains("无 ability-specific") || sql.contains("无 E 专用")
                    || sql.contains("no ability-specific") || sql.contains("不得新增 E"))
                && (sql.contains("62xxx") || sql.contains("game-local type")
                    || sql.contains("game-local")),
            "seed comments must document that E has no ability-specific game-local type");
    }

    @Test
    void enforcesStandaloneOwnershipWithoutMutatingExistingROrSiblings() {
        assertTrue(
            sql.contains("standalone")
                && (sql.contains("不突变") || sql.contains("不复制") || sql.contains("coexist")),
            "seed must document standalone ownership and R non-mutation");
        Matcher providerIds = Pattern.compile(
                "'provider_hero_missfortune_[a-z0-9_]+'")
            .matcher(sqlNoComments);
        Set<String> providers = new HashSet<>();
        while (providerIds.find()) {
            providers.add(providerIds.group());
        }
        assertEquals(
            Set.of(
                "'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary'"),
            providers,
            "executable SQL must reference exactly one Miss Fortune provider id (E only)");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesBoundaryTagsExclusionsAndNoMaterializer() {
        assertTrue(
            readme.contains(
                "lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed.sql"),
            "README must list the Miss Fortune E Make It Rain max-total seed");
        assertTrue(
            readme.contains(
                "LolGenericMissFortuneMakeItRainMaxTotalSelectedPrimarySeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)miss.?fortune.*make.?it.?rain|枪林弹雨|Make It Rain")
                .matcher(readme)
                .find(),
            "README must name Miss Fortune Make It Rain");
        int seedIdx = readme.indexOf(
            "lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains(
                "wasm-generic-miss-fortune-make-it-rain-max-total-selected-primary"),
            "README entry must name the task key");
        assertTrue(
            section.contains(
                "miss-fortune-e-make-it-rain-max-total-selected-primary-phase-a-v2"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("magic_190_plus_1_20_ap"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertDocumentsExplicitAbsenceOfImmediateImpactScaffold(section, "README");
        assertTrue(
            section.contains("1308255") && section.contains("3936384")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(NORMALIZED_GENERIC_SHA) && section.contains(PAGES_SHA),
            "README must document normalized generic + pages sibling SHAs");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言")),
            "README must document local raw caveat");
        assertTrue(
            Pattern.compile("(?i)80.*mana|mana.?80|80 mana").matcher(section).find()
                && section.contains("14000"),
            "README must document mana80 and cooldown 14000ms");
        assertTrue(
            section.contains("190") && section.contains("1.20")
                && section.contains("ap.resolved"),
            "README must document damage formula with AP resolved wording");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("无 seed") || section.contains("无 materializer")
                || section.contains("没有任何 seed") || section.contains("不负责物化")
                || section.contains("亦无") && section.contains("materializer"),
            "README must warn that no repository materializer exists for Miss Fortune");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|two.?second|eight.?tick|tick.?schedule|slow|"
                        + "geometry|multitarget|sight")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertFalse(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_missfortune`|"
                    + "ensure `hero_missfortune` 最低必要实体|"
                    + "ensure `hero_missfortune`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
        assertTrue(
            section.contains("raw190") || section.contains("AP0")
                || section.contains("final95"),
            "README must document deterministic algebra fixtures");
        assertTrue(
            section.contains("不突变") || section.contains("并存")
                || section.contains("Bullet Time") || section.contains("既有") && section.contains("R"),
            "README must document isolation from existing Miss Fortune R");
        assertTrue(
            section.contains("test-only") || section.contains("_test.go")
                || section.contains("Wasm"),
            "README must record test-only Wasm expectation");
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

    private static String orderedTagsBlock(String text) {
        int blockStart = text.indexOf("Ordered tags");
        assertTrue(blockStart >= 0, "must declare Ordered tags");
        int blockEnd = text.indexOf("契约要点", blockStart);
        if (blockEnd < 0) {
            blockEnd = text.indexOf("该 seed", blockStart);
        }
        if (blockEnd < 0) {
            blockEnd = Math.min(text.length(), blockStart + 500);
        }
        return text.substring(blockStart, blockEnd);
    }

    /**
     * Assert exact ordered-tag sequence inside the Ordered-tags declaration block,
     * ignoring earlier incidental occurrences inside the frozen boundary string.
     */
    private static void assertOrderedTagsInDeclarationBlock(String text, String label) {
        String block = orderedTagsBlock(text);
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
                    "(?:→\\s*`immediate_impact_scaffold`|`immediate_impact_scaffold`\\s*→|"
                        + "(?m)^\\s*(?:--\\s*)?\\d+\\.\\s*`?immediate_impact_scaffold`?\\b)")
                .matcher(block)
                .find(),
            label + " ordered tags must not list immediate_impact_scaffold as a declared tag");
    }

    private static void assertDocumentsExplicitAbsenceOfImmediateImpactScaffold(
        String text, String label) {
        assertTrue(
            (text.contains("不含") || text.contains("不包含") || text.contains("omit")
                    || text.contains("intentionally no") || text.contains("显式不包含")
                    || text.contains("显式不含"))
                && text.contains("immediate_impact_scaffold"),
            label + " must explicitly document absence of immediate_impact_scaffold");
    }

    private static void assertBinaryApDamageFormula(String damageJson) throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        assertEquals(
            190,
            root.path("args").get(0).path("value").asDouble(),
            0.0001,
            "left must be const 190");
        JsonNode mul = root.path("args").get(1);
        assertEquals("mul", mul.path("op").asText(), "right must be mul");
        assertEquals(2, mul.path("args").size(), "mul must be binary");
        assertEquals(
            1.20,
            mul.path("args").get(0).path("value").asDouble(),
            0.0001,
            "mul left must be const 1.20");
        assertEquals(
            "source.attr.ap.resolved",
            mul.path("args").get(1).path("path").asText(),
            "mul right must read AP resolved");
        assertBinaryArithmeticComparisonArity(
            root, "make_it_rain_max_total_selected_primary_damage");
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

    private static double rawDamage(double ap) {
        return 190.0 + 1.20 * ap;
    }

    private static double finalVsMr(double raw, double mr) {
        return raw * (100.0 / (100.0 + mr));
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
