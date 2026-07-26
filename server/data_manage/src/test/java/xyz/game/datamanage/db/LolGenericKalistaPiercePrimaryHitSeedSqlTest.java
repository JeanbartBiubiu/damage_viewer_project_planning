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
 * Static contract for {@code lol_generic_kalista_pierce_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericKalistaPiercePrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_kalista_pierce_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_kalista",
        "provider_hero_kalista_q_pierce_primary_hit",
        "ability_hero_kalista_q_pierce_primary_hit",
        "pierce_primary_hit",
        "phase_hero_kalista_q_pierce_primary_hit_impact",
        "sequence_hero_kalista_q_pierce_primary_hit_impact",
        "step_hero_kalista_q_pierce_primary_hit_damage",
        "cost_hero_kalista_q_pierce_primary_hit_mana",
        "cooldown_hero_kalista_q_pierce_primary_hit",
        "pierce_damage",
        "q_mana_cost",
        "q_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "resource_definitions",
        "game_entities",
        "entity_attribute_values",
        "entity_resource_values");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_physical_damage",
        "immediate_impact_scaffold");

    private static final String PIERCE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":270},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.05},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; "
            + "physical_270_plus_1_05_total_ad; "
            + "no_cast_timing_martial_poise_dash_cancel_direction_range_width_"
            + "line_geometry_multitarget_first_enemy_collision_projectile_"
            + "interception_spell_shield_kill_continuation_rend_stack_transfer_"
            + "other_ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67";

    private static final String LOCAL_RAW_SHA =
        "0b8dd9cf9b40aae52fb6180ecabae7e459970f2f7c4d05711463df25fdbd1c94";

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
        assertContains("hero_skill|hero_kalista|Q|穿刺");
        assertContains("wasm-generic-kalista-pierce-primary-hit");
        assertContains("kalista-q-pierce-primary-hit-phase-a-v1");
        assertContains("Template:Data Kalista/Q");
        assertContains("Template:Data Kalista/Pierce");
        assertContains("1307666");
        assertContains("3997075");
        assertContains("2026-03-06T15:53:18Z");
        assertContains("1625");
        assertContains(CANONICAL_SHA);
        assertContains("1623");
        assertContains(LOCAL_RAW_SHA);
        assertContains("local raw materialization caveat");
        assertTrue(
            sql.contains("sidecar/pages") || sql.contains("canonical 身份以"),
            "seed comments must record that sidecar/pages own canonical identity");
        assertTrue(
            sql.contains("不断言") || sql.contains("不等价") || sql.contains("no equivalence")
                || sql.contains("亦不主张源矛盾"),
            "seed comments must disclaim local-raw equivalence and source contradiction");
        assertContains("normalized/generic/kalista-q.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        assertFalse(
            Pattern.compile("(?im)^\\s*[-*]?\\s*4\\.\\s*total[_\\s-]?ad\\b|"
                    + "(?i)ordered tags[\\s\\S]{0,400}total[_\\s-]?ad")
                .matcher(sql)
                .find(),
            "must not add a total-AD ordered tag");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("270 + 105% AD")
                    || sql.contains("270 + 1.05")
                    || sql.contains("physical 270")),
            "seed comments must document rank5 physical 270 +105% AD");
        assertTrue(
            (sql.contains("total AD") || sql.contains("totalAD"))
                && sql.contains("source.attr.ad.resolved"),
            "seed must document total-AD direct resolved read");
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
        assertContains("20260725");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "seed must not use the Batch-B prerequisite phrase");
    }

    @Test
    void documentsDeterministicFixturesWithoutClaimingFullFidelity() {
        assertTrue(
            sql.contains("(AD0,A0)=(270,270)") || (sql.contains("AD0") && sql.contains("270")),
            "seed comments must document (AD0,A0)=(270,270)");
        assertTrue(
            sql.contains("(AD0,A100)=(270,135)")
                || (sql.contains("AD0") && sql.contains("A100") && sql.contains("135")),
            "seed comments must document (AD0,A100)=(270,135)");
        assertTrue(
            sql.contains("(AD100,A0)=(375,375)")
                || (sql.contains("AD100") && sql.contains("375")),
            "seed comments must document (AD100,A0)=(375,375)");
        assertTrue(
            sql.contains("(AD100,A100)=(375,187.5)")
                || (sql.contains("187.5") && sql.contains("375")),
            "seed comments must document (AD100,A100)=(375,187.5)");
        assertTrue(
            sql.contains("(AD200,A100)=(480,240)")
                || (sql.contains("AD200") && sql.contains("480") && sql.contains("240")),
            "seed comments must document (AD200,A100)=(480,240)");
        assertTrue(
            sql.contains("t0") && sql.contains("t8999") && sql.contains("t9000"),
            "seed comments must document cooldown timeline t0/t8999/t9000");
        assertTrue(
            (sql.contains("mana240") || sql.contains("mana240/"))
                && (sql.contains("mana80") || sql.contains("final mana80"))
                && (sql.contains("HP625") || sql.contains("HP1000")),
            "seed comments must document mana240→80 / HP1000→625 fixture");
        assertTrue(
            sql.contains("two Q damage") || sql.contains("two Q damage items")
                || (sql.contains("two") && sql.contains("damage")),
            "seed comments must document two Q damage items");
        assertTrue(
            sql.contains("mana79") && (sql.contains("resource skip") || sql.contains("unchanged")),
            "seed comments must document mana79 resource skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("standalone") || sql.contains("no P/W/E/R/basic"),
            "seed comments must document standalone provider / no sibling synthesis");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim"),
            "seed must not claim full fidelity");
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
            "pierce primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "pierce primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "pierce primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "pierce primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "pierce primary-hit seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroKalistaAdManaAndNoRepositoryMaterializer() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_kalista");
        assertContains("missing entity_attribute_values hero_kalista/ad");
        assertContains("missing resource_definitions mana");
        assertContains("missing entity_resource_values hero_kalista/mana");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed")
                || sql.contains("当前仓库无 materializer"),
            "seed must state that no current repository seed/materializer provides Kalista rows");
        assertTrue(
            sql.contains("external existing-data dependency")
                || sql.contains("外部既有")
                || sql.contains("external existing-data"),
            "seed must use external existing-data identity wording");
        assertContains("INSERT INTO public.types");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_kalista'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_kalista before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.attribute_definitions\\b[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check attribute_definitions ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_kalista/ad");
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
            "must SELECT/EXISTS-check entity_resource_values hero_kalista/mana");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_kalista with the Batch-B prerequisite phrase");
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
        assertContains("provider_hero_kalista_q_pierce_primary_hit");
        assertContains("hero_kalista_q_pierce_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_kalista_q_pierce_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Pierce primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_kalista'\\s*,\\s*"
                        + "'provider_hero_kalista_q_pierce_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Pierce primary-hit provider to hero_kalista");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Pierce primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Pierce primary-hit only)");
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
                    "(?s)'ability_hero_kalista_q_pierce_primary_hit'\\s*,\\s*"
                        + "'provider_hero_kalista_q_pierce_primary_hit'\\s*,\\s*"
                        + "'pierce_primary_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key pierce_primary_hit");
        assertContains("{\"op\":\"const\",\"value\":80}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_kalista_q_pierce_primary_hit_mana'\\s*,\\s*"
                        + "'ability_hero_kalista_q_pierce_primary_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'q_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 80 via ability_costs");
        assertContains("{\"op\":\"const\",\"value\":9000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_kalista_q_pierce_primary_hit'\\s*,\\s*"
                        + "'ability_hero_kalista_q_pierce_primary_hit'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 9000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_kalista_q_pierce_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_kalista_q_pierce_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_kalista_q_pierce_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_kalista_q_pierce_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kalista_q_pierce_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_kalista_q_pierce_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Pierce damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_kalista_q_pierce_primary_hit_damage'"),
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
    void parsesBinaryTotalAdPhysicalDamageFormula() throws IOException {
        assertContains(PIERCE_DAMAGE);
        assertBinaryTotalAdDamageFormula(PIERCE_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("\"value\":270");
        assertContains("\"value\":1.05");
        assertFalse(
            Pattern.compile("source\\.attr\\.ad\\.base")
                .matcher(sqlNoComments)
                .find(),
            "must not interpret total AD as bonus AD via ad.base subtraction");
        assertEquals(
            2,
            JSON.readTree(PIERCE_DAMAGE).path("args").size(),
            "outer add must remain binary");
        assertEquals(
            "const",
            JSON.readTree(PIERCE_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be const 270");
        assertEquals(
            "mul",
            JSON.readTree(PIERCE_DAMAGE).path("args").get(1).path("op").asText(),
            "outer right child must be mul(1.05, total AD)");
    }

    @Test
    void seedsPhysicalDamageAddPolicyCopyableFalseAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_kalista_q_pierce_primary_hit_damage'\\s*,\\s*"
                        + "'pierce_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Pierce damage must be physical 20220 add policy copyable_on_hit=false");
        assertFalse(
            REQUIRED_RESERVED.contains(20230),
            "required reserved list must not include provider_action/apply 20230");
        assertFalse(
            Pattern.compile("(?is)\\b20221\\b").matcher(sqlNoComments).find(),
            "executable SQL must not use magic damage type 20221");
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
            "Pierce primary-hit must not enable crit eligibility");
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
                    "(?i)cast.?timing|cast.?time|effect at cast time|"
                        + "martial.?poise|dash.?cancel|\\bdash\\b|"
                        + "direction|range|width|geometry|multitarget|first.?enemy|"
                        + "projectile|missile|travel|collision|interception|spell.?shield|"
                        + "kill.?continuation|\\brend\\b|stack.?transfer|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "aoe|area.?of.?effect|\\brepeat\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded cast-timing/Martial Poise/dash/direction/range/"
                + "width/line/multitarget/first-enemy/projectile/collision/"
                + "spell-shield/kill/Rend surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_kalista_[pwer]_|'ability_hero_kalista_[pwer]_|"
                        + "'provider_hero_kalista_basic_|'ability_hero_kalista_basic_")
                .matcher(sqlNoComments)
                .find(),
            "must not create P/W/E/R/basic graph rows");
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
            sql.contains("cast timing") || sql.contains("Effect at cast time end")
                || sql.contains("cast-time"),
            "seed comments must document exclusion of cast timing");
        assertTrue(
            sql.contains("Martial Poise") || sql.contains("dash cancel") || sql.contains("dash"),
            "seed comments must document exclusion of Martial Poise / dash cancel");
        assertTrue(
            sql.contains("projectile") || sql.contains("collision")
                || sql.contains("spell shield") || sql.contains("spellshield")
                || sql.contains("interception"),
            "seed comments must document exclusion of projectile/collision/spell shield");
        assertTrue(
            sql.contains("kill continuation") || sql.contains("Rend")
                || sql.contains("rend stack") || sql.contains("Rend stack"),
            "seed comments must document exclusion of kill continuation / Rend transfer");
        assertTrue(
            sql.contains("direction") || sql.contains("range") || sql.contains("width")
                || sql.contains("line geometry") || sql.contains("multitarget")
                || sql.contains("first-enemy"),
            "seed comments must document exclusion of direction/range/width/line/multitarget/first-enemy");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesTotalAdExclusionsAndNoMaterializer() {
        assertTrue(
            readme.contains("lol_generic_kalista_pierce_primary_hit_seed.sql"),
            "README must list the Kalista Q Pierce primary-hit seed");
        assertTrue(
            readme.contains("LolGenericKalistaPiercePrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)kalista.*pierce|穿刺|Pierce")
                .matcher(readme)
                .find(),
            "README must name Kalista Pierce");
        int seedIdx = readme.indexOf("lol_generic_kalista_pierce_primary_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-kalista-pierce-primary-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("kalista-q-pierce-primary-hit-phase-a-v1"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("physical_270_plus_1_05_total_ad"),
            "README must include frozen boundary");
        for (String tag : ORDERED_TAGS) {
            assertTrue(section.contains(tag), "README ordered tags must include " + tag);
        }
        assertFalse(
            Pattern.compile("(?i)ordered tags[^\\n]*total[_\\s-]?ad|"
                    + "→\\s*total[_\\s-]?ad|total[_\\s-]?ad\\s*→")
                .matcher(section)
                .find(),
            "README must not add a total-AD ordered tag");
        assertTrue(
            section.contains("1307666") && section.contains("3997075")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言")),
            "README must document local raw caveat");
        assertTrue(
            Pattern.compile("(?i)80.*mana|mana.?80|80 mana").matcher(section).find()
                && section.contains("9000"),
            "README must document mana80 and cooldown 9000ms");
        assertTrue(
            section.contains("270") && section.contains("1.05")
                && (section.contains("total AD") || section.contains("ad.resolved")),
            "README must document damage formula with total AD wording");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("无 seed") || section.contains("无 materializer")
                || section.contains("没有任何 seed") || section.contains("不负责物化")
                || section.contains("亦无 seed 负责物化"),
            "README must warn that no repository materializer exists for Kalista identity/panel/resource");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|cast|projectile|martial|rend|direction|range|"
                        + "first.?enemy|kill")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertFalse(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_kalista`|"
                    + "ensure `hero_kalista` 最低必要实体|"
                    + "ensure `hero_kalista`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
        assertTrue(
            section.contains("187.5") || section.contains("HP625")
                || section.contains("(AD100,A100)") || section.contains("mana240"),
            "README must document deterministic runtime fixtures");
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

    private static void assertBinaryTotalAdDamageFormula(String damageJson) throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        assertEquals(
            270,
            root.path("args").get(0).path("value").asDouble(),
            0.0001,
            "left must be const 270");
        JsonNode mul = root.path("args").get(1);
        assertEquals("mul", mul.path("op").asText(), "right must be mul");
        assertEquals(2, mul.path("args").size(), "mul must be binary");
        assertEquals(
            1.05,
            mul.path("args").get(0).path("value").asDouble(),
            0.0001,
            "mul left must be const 1.05");
        assertEquals(
            "source.attr.ad.resolved",
            mul.path("args").get(1).path("path").asText(),
            "mul right must read total AD resolved");
        assertBinaryArithmeticComparisonArity(root, "pierce_damage");
        assertFalse(
            nodeContainsReadPath(root, "source.attr.ad.base"),
            "damage AST must not read ad.base");
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
