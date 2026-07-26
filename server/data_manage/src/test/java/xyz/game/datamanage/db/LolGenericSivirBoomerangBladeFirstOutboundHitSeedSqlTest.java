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
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final int EXPECTED_SEED_BYTES = 32326;

    private static final String EXPECTED_SEED_SHA256 =
        "4ba04a00c1d67a67fd581eaa1cd4edfbb08eeb9699d9e3c8da8eed3f03dbf189";

    private static final List<String> STABLE_IDS = List.of(
        "hero_sivir",
        "provider_hero_sivir_q_boomerang_blade_first_outbound_hit",
        "ability_hero_sivir_q_boomerang_blade_first_outbound_hit",
        "boomerang_blade_first_outbound_hit",
        "phase_hero_sivir_q_boomerang_blade_first_outbound_hit_impact",
        "sequence_hero_sivir_q_boomerang_blade_first_outbound_hit_impact",
        "step_hero_sivir_q_boomerang_blade_first_outbound_hit_damage",
        "cost_hero_sivir_q_boomerang_blade_first_outbound_hit_mana",
        "cooldown_hero_sivir_q_boomerang_blade_first_outbound_hit",
        "boomerang_blade_first_outbound_hit_damage",
        "q_mana_cost",
        "q_cooldown_ms",
        "hero_sivir_q_boomerang_blade_first_outbound_hit");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad", "ap", "crit_chance");

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "resource_definitions",
        "game_entities",
        "entity_attribute_values",
        "entity_resource_values");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_physical_damage",
        "bonus_ad_ratio",
        "ap_ratio",
        "crit_scaling",
        "immediate_impact_scaffold");

    private static final String BOOMERANG_BLADE_DAMAGE =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":["
            + "{\"op\":\"const\",\"value\":160},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.70},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.60},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.40},"
            + "{\"op\":\"min\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0.00},"
            + "{\"op\":\"read\",\"path\":\"source.attr.crit_chance.resolved\"}]}]}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "min", "max", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; "
            + "immediate_impact_and_cooldown_scaffold; "
            + "physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_"
            + "formula_clamped_crit_chance; "
            + "no_cast_time_bonus_attack_speed_direction_range_width_geometry_"
            + "projectile_travel_speed_nonchampion_hit_reduction_return_pass_"
            + "damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_"
            + "full_fidelity";

    private static final String CANONICAL_SHA =
        "0adcf3916b63e8b0ae6c2c7ad74d1796e3362a3a22682c58ef92aaccfae43e5e";

    private static final String NORMALIZED_SHA =
        "2320f7ada83cceee979c52cd314395c6b41e2f50c50e3114e9bca0d39386ff02";

    private static final String PAGES_SHA =
        "adeab85889a4208b52f0b6cd3bcc3aef022a986dcad5168e1c817e3ab3323fa9";

    private static final String LOCAL_RAW_SHA =
        "b8d46412519f211b27f2575684693f407806cbbca337a80e775a1baf4c2396a4";

    private static String sql;
    private static String sqlNoComments;
    private static String readme;
    private static byte[] seedBytes;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        seedBytes = Files.readAllBytes(seedPath);
        sql = new String(seedBytes, StandardCharsets.UTF_8);
        assertEquals(
            sql,
            Files.readString(seedPath, StandardCharsets.UTF_8),
            "seed must be valid UTF-8 without replacement");
        assertFalse(sql.contains("\uFFFD"), "seed must not contain UTF-8 replacement char");
        sqlNoComments = stripSqlComments(sql);
        Path readmePath = resolveRelative(README_RELATIVE);
        assertTrue(Files.isRegularFile(readmePath), "README missing: " + readmePath);
        readme = Files.readString(readmePath, StandardCharsets.UTF_8);
    }

    @Test
    void locksExactSeedBytesAndShaWithoutBlobLockingReadme() throws NoSuchAlgorithmException {
        assertEquals(EXPECTED_SEED_BYTES, seedBytes.length, "seed exact UTF-8 byte length");
        assertEquals(EXPECTED_SEED_SHA256, sha256Hex(seedBytes), "seed exact SHA-256");
        assertFalse(
            readme.contains(EXPECTED_SEED_SHA256),
            "README must not blob-lock the seed SHA (append-only README is semantic-only)");
        assertFalse(
            Pattern.compile("(?i)README.*SHA-?256|blob.?lock.*README|lock.*README.*bytes")
                .matcher(sql)
                .find(),
            "seed must not claim README blob-lock");
    }

    @Test
    void documentsSourceIdentityLocalCaveatBoundaryTagsAndCritScalingWording() {
        assertContains("hero_skill|hero_sivir|Q|回旋之刃");
        assertContains("wasm-generic-sivir-boomerang-blade-first-outbound-hit");
        assertContains("sivir-q-boomerang-blade-first-outbound-hit-phase-a-v3");
        assertContains("Template:Data Sivir/Q");
        assertContains("Template:Data Sivir/Boomerang Blade");
        assertContains("1308837");
        assertContains("4016378");
        assertContains("2026-05-11T05:05:57Z");
        assertContains("2745");
        assertContains("3018");
        assertContains("691");
        assertContains(CANONICAL_SHA);
        assertContains(NORMALIZED_SHA);
        assertContains(PAGES_SHA);
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
        assertTrue(
            sql.contains("materialization") || sql.contains("serialization caveat")
                || sql.contains("serialization"),
            "seed must frame local raw difference as materialization/serialization caveat only");
        assertContains("normalized/generic/sivir-q.json");
        assertContains("pages/sivir-q.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("160 + 70% bonus AD + 60% AP")
                    || sql.contains("physical 160")
                    || sql.contains("160 + 0.70")),
            "seed comments must document rank5 physical 160 +70% bonus AD +60% AP");
        assertTrue(
            (sql.contains("critScaling") || sql.contains("crit_scaling")
                    || sql.contains("0–40%") || sql.contains("0-40%")
                    || sql.contains("0–40") || sql.contains("linearly 0–40"))
                && sql.contains("source.attr.crit_chance.resolved"),
            "seed must document crit-chance linear 0–40% scaling");
        assertTrue(
            (sql.contains("bonus AD") || sql.contains("bonus_ad") || sql.contains("bonusAD"))
                && sql.contains("source.attr.ad.resolved")
                && sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD sub(resolved, base)");
        assertTrue(
            sql.contains("source.attr.ap.resolved")
                && (sql.contains("直接读取") || sql.contains("直接读") || sql.contains("AP is")),
            "seed must document direct AP resolved read");
        assertTrue(
            (sql.contains("formula-local clamp") || sql.contains("公式内")
                    || sql.contains("min(const 1.00") || sql.contains("min(1.00"))
                && (sql.contains("不检视") || sql.contains("不断言") || sql.contains("DB min/max")
                    || sql.contains("不检视/不断言")),
            "seed must document formula-local clamp and no DB min/max metadata claim");
        assertTrue(
            sql.contains("noncritical") || sql.contains("非 crit")
                || sql.contains("确定性缩放"),
            "seed must document noncritical deterministic amount scaling");
        assertTrue(
            sql.contains("嵌套二元") || sql.contains("nested binary")
                || sql.contains("每个算术节点恰好二元")
                || sql.contains("每个算术/min/max 节点恰好二元"),
            "seed must document nested-binary arithmetic including min/max");
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
    }

    @Test
    void documentsDeterministicFixturesIncludingCritClampAndManaSchedule() {
        assertTrue(
            sql.contains("raw290/final145")
                || (sql.contains("raw290") && sql.contains("final145")),
            "seed must document crit0 / clamped0 armor100 raw290/final145");
        assertTrue(
            sql.contains("raw348/final174")
                || (sql.contains("raw348") && sql.contains("final174")),
            "seed must document crit0.5 armor100 raw348/final174");
        assertTrue(
            sql.contains("raw406/final203")
                || (sql.contains("raw406") && sql.contains("final203")),
            "seed must document crit1 / clamped1 armor100 raw406/final203");
        assertTrue(
            (sql.contains("crit-0.25") || sql.contains("crit -0.25"))
                && (sql.contains("clamps0") || sql.contains("clamps 0")),
            "seed must document crit-0.25 clamps to 0");
        assertTrue(
            (sql.contains("crit1.25") || sql.contains("crit 1.25"))
                && (sql.contains("clamps1") || sql.contains("clamps 1")),
            "seed must document crit1.25 clamps to 1");
        assertTrue(
            sql.contains("base0/resolved100")
                && sql.contains("base60/resolved160")
                && (sql.contains("both290") || sql.contains("both 290")
                    || sql.contains("both290/145")),
            "seed must document bonusAD counterproof both290/145");
        assertTrue(
            (sql.contains("AP0 vs") || sql.contains("AP0 vs AP100") || sql.contains("raw230 vs290"))
                && sql.contains("230") && sql.contains("290"),
            "seed must document AP counterproof raw230 vs290");
        assertTrue(
            sql.contains("t0") && sql.contains("t7999") && sql.contains("t8000"),
            "seed comments must document cooldown timeline t0/t7999/t8000");
        assertTrue(
            (sql.contains("mana225") || sql.contains("mana225/"))
                && (sql.contains("mana75") || sql.contains("final mana75"))
                && (sql.contains("HP652") || sql.contains("HP1000")),
            "seed comments must document mana225→75 / HP1000→652 fixture");
        assertTrue(
            sql.contains("exactly two Q hits") || sql.contains("two Q hits")
                || (sql.contains("exactly two Q") && sql.contains("hit")),
            "seed comments must document exactly two Q hits");
        assertTrue(
            sql.contains("automatic starts") || sql.contains("automatic Q")
                || (sql.contains("automatic") && sql.contains("ability_started")),
            "seed comments must document automatic Q ability_started");
        assertTrue(
            sql.contains("readyAt8000"),
            "seed comments must document readyAt8000");
        assertTrue(
            sql.contains("mana74") && (sql.contains("resource skip") || sql.contains("unchanged")),
            "seed comments must document mana74 resource skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            (sql.contains("standalone") || sql.contains("standalone isolation"))
                && (sql.contains("synthesizes no P/W/E/R")
                    || sql.contains("no P/W/E/R/basic")
                    || sql.contains("不合成")
                    || sql.contains("sibling absence")),
            "seed comments must document standalone isolation / sibling absence");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim"),
            "seed must not claim full fidelity");
        assertTrue(
            sql.contains("Phase-A")
                && (sql.contains("scaffold") || sql.contains("impact scaffold")
                    || sql.contains("damage/CD scaffold"))
                && (sql.contains("不是实际") || sql.contains("not actual")
                    || sql.contains("not full Q") || sql.contains("One selected")),
            "seed must clarify primary hit is Phase-A scaffold not full Q");
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
            "first-outbound-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "first-outbound-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "first-outbound-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "first-outbound-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "first-outbound-hit seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?i)single_attacker_dps").matcher(sqlNoComments).find(),
            "must not write legacy single_attacker_dps");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.(heroes|items|skills)\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write legacy heroes/items/skills tables");
    }

    @Test
    void validatesCheckOnlyExternalHeroSivirAdApCritChanceManaAndNoIdentityMaterialization() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_sivir");
        assertContains("missing entity_attribute_values hero_sivir/ad");
        assertContains("missing entity_attribute_values hero_sivir/ap");
        assertContains("missing entity_attribute_values hero_sivir/crit_chance");
        assertContains("missing resource_definitions mana");
        assertContains("missing entity_resource_values hero_sivir/mana");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized by this seed")
                || sql.contains("本脚本不物化"),
            "seed must state that this seed does not materialize Sivir identity/panel/resource");
        assertTrue(
            sql.contains("external existing-data dependency")
                || sql.contains("外部既有")
                || sql.contains("external existing-data"),
            "seed must use external existing-data identity wording");
        assertTrue(
            sql.contains("ensure-entity") || sql.contains("不以 ensure-entity")
                || sql.contains("勿以 ensure-entity"),
            "seed must reject ensure-entity legacy seeds as a reason to materialize prerequisites");
        assertTrue(
            sql.contains("没有任何 seed") || sql.contains("无 Sivir")
                || sql.contains("无 materializer") || sql.contains("sibling absence")
                || sql.contains("当前仓库无 Sivir identity"),
            "seed must clarify no Sivir identity/panel/resource materializer in this repo");
        assertTrue(
            sql.contains("publication guard") || sql.contains("publication")
                || sql.contains("Backend prerequisite")
                || sql.contains("generic runtime")
                || sql.contains("读为 0"),
            "seed must clarify backend prereq is publication guard; missing-attr reads remain zero");
        assertContains("INSERT INTO public.types");
        assertEquals(3, REQUIRED_ATTRS.size(), "contract expects exactly ad+ap+crit_chance");
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
            3,
            countOccurrences(attrsBlock, "'") / 2,
            "attr preflight array must list exactly ad, ap, crit_chance");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_sivir'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_sivir before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_sivir/ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_sivir/ap");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'crit_chance'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_sivir/crit_chance");
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
            "must SELECT/EXISTS-check entity_resource_values hero_sivir/mana");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_sivir with the Batch-B prerequisite phrase");
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
        assertContains("provider_hero_sivir_q_boomerang_blade_first_outbound_hit");
        assertContains("hero_sivir_q_boomerang_blade_first_outbound_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_sivir_q_boomerang_blade_first_outbound_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Boomerang Blade first-outbound-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_sivir'\\s*,\\s*"
                        + "'provider_hero_sivir_q_boomerang_blade_first_outbound_hit'")
                .matcher(sql)
                .find(),
            "must mount first-outbound-hit provider to hero_sivir");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated first-outbound-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider");
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
                    "(?s)'ability_hero_sivir_q_boomerang_blade_first_outbound_hit'\\s*,\\s*"
                        + "'provider_hero_sivir_q_boomerang_blade_first_outbound_hit'\\s*,\\s*"
                        + "'boomerang_blade_first_outbound_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key boomerang_blade_first_outbound_hit");
        assertContains("{\"op\":\"const\",\"value\":75}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_sivir_q_boomerang_blade_first_outbound_hit_mana'\\s*,\\s*"
                        + "'ability_hero_sivir_q_boomerang_blade_first_outbound_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'q_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 75 via ability_costs");
        assertContains("{\"op\":\"const\",\"value\":8000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_sivir_q_boomerang_blade_first_outbound_hit'\\s*,\\s*"
                        + "'ability_hero_sivir_q_boomerang_blade_first_outbound_hit'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 8000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_sivir_q_boomerang_blade_first_outbound_hit_impact'\\s*,\\s*"
                        + "'ability_hero_sivir_q_boomerang_blade_first_outbound_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_sivir_q_boomerang_blade_first_outbound_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_sivir_q_boomerang_blade_first_outbound_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_sivir_q_boomerang_blade_first_outbound_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_sivir_q_boomerang_blade_first_outbound_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "first-outbound-hit damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_sivir_q_boomerang_blade_first_outbound_hit_damage'"),
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
    void parsesExactNestedBinaryCritClampedPhysicalDamageFormulaWithExactReadPaths()
        throws IOException {
        assertContains(BOOMERANG_BLADE_DAMAGE);
        assertBinaryNestedCritClampedDamageFormula(BOOMERANG_BLADE_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("source.attr.ap.resolved");
        assertContains("source.attr.crit_chance.resolved");
        assertContains("\"value\":160");
        assertContains("\"value\":0.70");
        assertContains("\"value\":0.60");
        assertContains("\"value\":1.00");
        assertContains("\"value\":0.40");
        assertContains("\"value\":0.00");
        assertContains("\"op\":\"sub\"");
        assertContains("\"op\":\"min\"");
        assertContains("\"op\":\"max\"");
        JsonNode root = JSON.readTree(BOOMERANG_BLADE_DAMAGE);
        assertEquals("mul", root.path("op").asText(), "outer op must be mul");
        assertEquals(2, root.path("args").size(), "outer mul must remain binary");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ad.resolved"),
            "ad.resolved must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ad.base"),
            "ad.base must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ap.resolved"),
            "ap.resolved must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.crit_chance.resolved"),
            "crit_chance.resolved must appear exactly once");
        assertFalse(
            Pattern.compile("(?i)crit_damage|crit_eligible|random\\s*crit|crit_roll")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not model crit pipeline / random crit / crit_damage");
        assertFalse(
            Pattern.compile("(?i)min_value|max_value|attribute_definitions[\\s\\S]{0,80}crit")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not inspect DB min/max metadata for crit_chance");
    }

    @Test
    void assertsDeterministicFixtureArithmeticForCritClampBonusAdAndAp() {
        assertEquals(290.0, rawDamage(60, 160, 100, 0.0), 0.0001);
        assertEquals(348.0, rawDamage(60, 160, 100, 0.5), 0.0001);
        assertEquals(406.0, rawDamage(60, 160, 100, 1.0), 0.0001);
        assertEquals(290.0, rawDamage(60, 160, 100, -0.25), 0.0001);
        assertEquals(406.0, rawDamage(60, 160, 100, 1.25), 0.0001);
        assertEquals(145.0, finalVsArmor(290.0, 100), 0.0001);
        assertEquals(174.0, finalVsArmor(348.0, 100), 0.0001);
        assertEquals(203.0, finalVsArmor(406.0, 100), 0.0001);
        assertEquals(
            rawDamage(0, 100, 100, 0.0),
            rawDamage(60, 160, 100, 0.0),
            0.0001,
            "equal bonus AD must yield equal raw");
        assertEquals(230.0, rawDamage(60, 160, 0, 0.0), 0.0001);
        assertEquals(290.0, rawDamage(60, 160, 100, 0.0), 0.0001);
        assertEquals(75.0, 225.0 - 75.0 - 75.0, 0.0001);
        assertEquals(652.0, 1000.0 - 174.0 - 174.0, 0.0001);
    }

    @Test
    void seedsPhysicalDamageAddPolicyCopyableFalseAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_sivir_q_boomerang_blade_first_outbound_hit_damage'\\s*,\\s*"
                        + "'boomerang_blade_first_outbound_hit_damage'\\s*,\\s*"
                        + "20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "first-outbound-hit damage must be physical 20220 add policy copyable_on_hit=false");
        assertFalse(
            REQUIRED_RESERVED.contains(20230),
            "required reserved list must not include provider_action/apply 20230");
        assertFalse(
            Pattern.compile("(?is)\\b20221\\b").matcher(sqlNoComments).find(),
            "executable SQL must not use magic damage type 20221");
        assertFalse(
            Pattern.compile("(?is)\\b20230\\b").matcher(sqlNoComments).find(),
            "executable SQL/graph must not use provider_action/apply 20230");
        assertFalse(
            Pattern.compile(
                    "(?is)v_required_reserved\\s+int\\[\\]\\s*:=\\s*ARRAY\\[[^\\]]*\\b20230\\b")
                .matcher(sqlNoComments)
                .find(),
            "v_required_reserved must not list 20230");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "first-outbound-hit must not enable crit eligibility");
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
                    "(?i)\\bcast.?time\\b|bonus.?attack.?speed|effect.?at.?cast.?end|"
                        + "direction|range|width|geometry|projectile|travel|speed|"
                        + "nonchampion|return.?pass|once.?per.?pass|spellshield|"
                        + "basic_attack_hit|emit_event|equipment|loadout|\\brepeat\\b|"
                        + "missile|channel|homing")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded cast/geometry/projectile/return/spellshield surfaces");
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
            sql.contains("cast time") || sql.contains("bonus attack speed")
                || sql.contains("direction") || sql.contains("geometry"),
            "seed comments must document exclusion of cast/AS/direction/geometry");
        assertTrue(
            sql.contains("projectile") || sql.contains("return")
                || sql.contains("nonchampion") || sql.contains("once-per-pass")
                || sql.contains("spellshield"),
            "seed comments must document exclusion of projectile/return/nonchampion/spellshield");
        assertTrue(
            sql.contains("One selected-primary") || sql.contains("one selected")
                || sql.contains("not full Q") || sql.contains("不是 full Q"),
            "seed must state one selected-primary first-outbound hit, not full Q");
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
                    || sql.contains("no ability-specific") || sql.contains("不得新增 Q"))
                && (sql.contains("62xxx") || sql.contains("game-local type")
                    || sql.contains("game-local")),
            "seed comments must document that Q has no ability-specific game-local type");
        assertTrue(
            sql.contains("type_relations")
                && (sql.contains("不写") || sql.contains("不新增") || sql.contains("no Q type")),
            "seed comments must document no Q type / no type_relations");
    }

    @Test
    void enforcesStandaloneSiblingAbsenceWithoutSynthesizingPweRBasic() {
        assertTrue(
            sql.contains("standalone sibling absence")
                || sql.contains("standalone isolation")
                || (sql.contains("synthesizes no P/W/E/R")
                    && sql.contains("standalone")),
            "seed must document standalone sibling absence");
        assertTrue(
            (sql.contains("不创建") || sql.contains("不合成") || sql.contains("synthesiz")
                    || sql.contains("no P/W/E/R"))
                && (sql.contains("P/W/E/R") || sql.contains("P / W / E / R")),
            "seed must forbid synthesizing P/W/E/R/basic");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_sivir_[pwer]_|'ability_hero_sivir_[pwer]_|"
                        + "'provider_hero_sivir_basic|'ability_hero_sivir_basic")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate P/W/E/R/basic graph rows");
        Matcher providerIds = Pattern.compile(
                "'provider_hero_sivir_[a-z0-9_]+'")
            .matcher(sqlNoComments);
        Set<String> providers = new HashSet<>();
        while (providerIds.find()) {
            providers.add(providerIds.group());
        }
        assertEquals(
            Set.of("'provider_hero_sivir_q_boomerang_blade_first_outbound_hit'"),
            providers,
            "executable SQL must reference exactly one Sivir provider id (Q only)");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesFormulaClampExclusionsAndHeroTestGoCaveat() {
        assertTrue(
            readme.contains("lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql"),
            "README must list the Sivir Q Boomerang Blade first-outbound-hit seed");
        assertTrue(
            readme.contains("LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)sivir.*boomerang|回旋之刃|Boomerang Blade")
                .matcher(readme)
                .find(),
            "README must name Sivir Boomerang Blade");
        int seedIdx = readme.indexOf(
            "lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-sivir-boomerang-blade-first-outbound-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("sivir-q-boomerang-blade-first-outbound-hit-phase-a-v3"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains(
                    "physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_"
                        + "formula_clamped_crit_chance"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertTrue(
            section.contains("1308837") && section.contains("4016378")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(NORMALIZED_SHA) && section.contains(PAGES_SHA)
                && section.contains("3018") && section.contains("691"),
            "README must document normalized/pages bytes and SHAs");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("2745"),
            "README must document canonical/local raw 2745 byte size");
        assertTrue(
            Pattern.compile("(?i)75.*mana|mana.?75|75 mana").matcher(section).find()
                && section.contains("8000"),
            "README must document mana75 and cooldown 8000ms");
        assertTrue(
            section.contains("160") && section.contains("0.70") && section.contains("0.60")
                && section.contains("0.40")
                && (section.contains("crit_chance") || section.contains("crit chance")
                    || section.contains("暴击")),
            "README must document damage formula with bonus AD + AP + crit_chance scaling");
        assertTrue(
            section.contains("min") && section.contains("max")
                && (section.contains("formula-local") || section.contains("公式内")
                    || section.contains("clamp")),
            "README must document formula-local clamp");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            (section.contains("不物化") || section.contains("本 seed 不物化")
                    || (section.contains("不做") && section.contains("自包含")))
                && (section.contains("无 Sivir") || section.contains("无 materializer")
                    || section.contains("no Sivir") || section.contains("no owning")),
            "README must warn no Sivir materializer / this seed does not materialize");
        assertTrue(
            section.contains("immediate") || section.contains("impact")
                && (section.contains("scaffold") || section.contains("cooldown")),
            "README must document immediate impact/CD scaffold");
        assertTrue(
            section.contains("standalone")
                && (section.contains("sibling absence") || section.contains("不合成")
                    || section.contains("no P/W/E/R")),
            "README must document standalone sibling absence");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|cast.?time|bonus.?attack.?speed|direction|"
                        + "geometry|projectile|return|spellshield|once.?per.?pass")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertTrue(
            Pattern.compile("(?i)不连 live|不执行.*live|no.?live|不连 live DB")
                .matcher(section)
                .find(),
            "README must make the no-live claim");
        assertFalse(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_sivir`|"
                    + "ensure `hero_sivir` 最低必要实体|"
                    + "ensure `hero_sivir`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
        assertTrue(
            section.contains("raw290") || section.contains("HP652")
                || section.contains("mana225") || section.contains("both290")
                || section.contains("raw348"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            (section.contains("hero-named") || section.contains("hero named")
                    || section.contains("同名英雄") || section.contains("英雄命名")
                    || section.contains("_test.go"))
                && (section.contains("Wasm") || section.contains("wasm")
                    || section.contains("_test.go"))
                && (section.contains("regression") || section.contains("回归")
                    || section.contains("证据") || section.contains("governance")
                    || section.contains("治理"))
                && (section.contains("planned") || section.contains("计划")
                    || section.contains("rather than") || section.contains("而非")
                    || section.contains("不是生产") || section.contains("production"))
                && (section.contains("generic") || section.contains("生产 runtime")
                    || section.contains("production runtime")
                    || section.contains("仍为 generic")),
            "README must say hero _test.go planned as regression/governance evidence only "
                + "and production runtime remains generic");
        assertFalse(
            section.contains(EXPECTED_SEED_SHA256),
            "README must not blob-lock seed SHA");
        assertTrue(
            section.contains("LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest")
                && (section.contains("LolGenericTristanaBusterShotPrimaryHitSeedSqlTest")
                    || section.contains("LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest")
                    || section.contains("LolGenericEssenceReaverSpellbladeSeedSqlTest")
                    || section.contains("LolGenericSennaDawningShadowPrimaryHitSeedSqlTest")),
            "README static validation must cite required focused neighbor tests");
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

    private static void assertOrderedTagsInDeclarationBlock(String text, String label) {
        int blockStart = text.indexOf("Ordered tags");
        assertTrue(blockStart >= 0, label + " must declare Ordered tags");
        int blockEnd = text.indexOf("契约要点", blockStart);
        if (blockEnd < 0) {
            blockEnd = text.indexOf("该 seed", blockStart);
        }
        if (blockEnd < 0) {
            blockEnd = Math.min(text.length(), blockStart + 600);
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
    }

    private static void assertBinaryNestedCritClampedDamageFormula(String damageJson)
        throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("mul", root.path("op").asText(), "outer damage must be mul");
        assertEquals(2, root.path("args").size(), "outer mul must be binary");
        JsonNode baseAdd = root.path("args").get(0);
        assertEquals("add", baseAdd.path("op").asText(), "outer left must be nested add");
        assertEquals(2, baseAdd.path("args").size(), "outer-left add must be binary");
        JsonNode innerAdd = baseAdd.path("args").get(0);
        assertEquals("add", innerAdd.path("op").asText(), "inner left must be nested add");
        assertEquals(2, innerAdd.path("args").size(), "inner add must be binary");
        assertEquals(
            160,
            innerAdd.path("args").get(0).path("value").asDouble(),
            0.0001,
            "inner add left must be const 160");
        JsonNode mulBonus = innerAdd.path("args").get(1);
        assertEquals("mul", mulBonus.path("op").asText(), "inner add right must be mul");
        assertEquals(2, mulBonus.path("args").size(), "mul must be binary");
        assertEquals(
            0.70,
            mulBonus.path("args").get(0).path("value").asDouble(),
            0.0001,
            "bonus AD mul left must be const 0.70");
        JsonNode sub = mulBonus.path("args").get(1);
        assertEquals("sub", sub.path("op").asText(), "mul right must be sub(resolved, base)");
        assertEquals(2, sub.path("args").size(), "sub must be binary");
        assertEquals(
            "source.attr.ad.resolved",
            sub.path("args").get(0).path("path").asText(),
            "sub left must read ad.resolved");
        assertEquals(
            "source.attr.ad.base",
            sub.path("args").get(1).path("path").asText(),
            "sub right must read ad.base");
        JsonNode mulAp = baseAdd.path("args").get(1);
        assertEquals("mul", mulAp.path("op").asText(), "outer-left right must be AP mul");
        assertEquals(2, mulAp.path("args").size(), "AP mul must be binary");
        assertEquals(
            0.60,
            mulAp.path("args").get(0).path("value").asDouble(),
            0.0001,
            "AP mul left must be const 0.60");
        assertEquals(
            "source.attr.ap.resolved",
            mulAp.path("args").get(1).path("path").asText(),
            "AP mul right must read ap.resolved");
        JsonNode scaleAdd = root.path("args").get(1);
        assertEquals("add", scaleAdd.path("op").asText(), "outer right must be scale add");
        assertEquals(2, scaleAdd.path("args").size(), "scale add must be binary");
        assertEquals(
            1.00,
            scaleAdd.path("args").get(0).path("value").asDouble(),
            0.0001,
            "scale add left must be const 1.00");
        JsonNode mulScale = scaleAdd.path("args").get(1);
        assertEquals("mul", mulScale.path("op").asText(), "scale add right must be mul");
        assertEquals(
            0.40,
            mulScale.path("args").get(0).path("value").asDouble(),
            0.0001,
            "crit scale mul left must be const 0.40");
        JsonNode minNode = mulScale.path("args").get(1);
        assertEquals("min", minNode.path("op").asText(), "crit scale must use min");
        assertEquals(2, minNode.path("args").size(), "min must be binary");
        assertEquals(
            1.00,
            minNode.path("args").get(0).path("value").asDouble(),
            0.0001,
            "min left must be const 1.00");
        JsonNode maxNode = minNode.path("args").get(1);
        assertEquals("max", maxNode.path("op").asText(), "crit scale must use max under min");
        assertEquals(2, maxNode.path("args").size(), "max must be binary");
        assertEquals(
            0.00,
            maxNode.path("args").get(0).path("value").asDouble(),
            0.0001,
            "max left must be const 0.00");
        assertEquals(
            "source.attr.crit_chance.resolved",
            maxNode.path("args").get(1).path("path").asText(),
            "max right must read crit_chance.resolved");
        assertBinaryArithmeticComparisonArity(root, "boomerang_blade_first_outbound_hit_damage");
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

    private static double rawDamage(double baseAd, double resolvedAd, double ap, double crit) {
        double bonusAd = resolvedAd - baseAd;
        double base = 160.0 + 0.70 * bonusAd + 0.60 * ap;
        double clamped = Math.min(1.00, Math.max(0.00, crit));
        return base * (1.00 + 0.40 * clamped);
    }

    private static double finalVsArmor(double raw, double armor) {
        return raw * (100.0 / (100.0 + armor));
    }

    private static String sha256Hex(byte[] bytes) throws NoSuchAlgorithmException {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            sb.append(String.format(Locale.ROOT, "%02x", b));
        }
        return sb.toString();
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
