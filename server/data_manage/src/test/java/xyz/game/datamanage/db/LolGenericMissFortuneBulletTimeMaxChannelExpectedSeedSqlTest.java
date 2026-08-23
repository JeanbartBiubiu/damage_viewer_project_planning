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
 * Static contract for {@code lol_generic_miss_fortune_bullet_time_max_channel_expected_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericMissFortuneBulletTimeMaxChannelExpectedSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_miss_fortune_bullet_time_max_channel_expected_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final int EXPECTED_SEED_BYTES = 31115;

    private static final String EXPECTED_SEED_SHA256 =
        "4f04671dcf1741cca1aab350a29ba3fd703ea58bf3d94efa1822159d37dddc74";

    private static final List<String> STABLE_IDS = List.of(
        "hero_missfortune",
        "provider_hero_missfortune_r_bullet_time_max_channel_expected",
        "ability_hero_missfortune_r_bullet_time_max_channel_expected",
        "bullet_time_max_channel_expected",
        "phase_hero_missfortune_r_bullet_time_max_channel_expected_impact",
        "sequence_hero_missfortune_r_bullet_time_max_channel_expected_impact",
        "step_hero_missfortune_r_bullet_time_max_channel_expected_damage",
        "cooldown_hero_missfortune_r_bullet_time_max_channel_expected",
        "bullet_time_max_channel_expected_damage",
        "r_mana_cost",
        "r_cooldown_ms",
        "hero_missfortune_r_bullet_time_max_channel_expected");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad", "ap", "crit_chance");

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "game_entities",
        "entity_attribute_values"
    );

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_physical_damage",
        "ap_ratio",
        "crit_scaling",
        "immediate_aggregated_channel_total_scaffold");

    private static final String BULLET_TIME_DAMAGE =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":18},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":["
            + "{\"op\":\"const\",\"value\":40},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.60},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.25},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]},"
            + "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.30},"
            + "{\"op\":\"min\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0.00},"
            + "{\"op\":\"read\",\"path\":\"source.attr.crit_chance.resolved\"}]}]}]}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "min", "max", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank3_max_full_channel_selected_primary_champion_expected_total_physical_damage; "
            + "immediate_aggregated_channel_total_scaffold; eighteen_waves; "
            + "per_wave_40_plus_0_60_total_ad_plus_0_25_ap; "
            + "base_wave_crit_multiplier_1_30; "
            + "expected_factor_one_plus_0_30_times_formula_clamped_crit_chance; "
            + "mana100_cooldown100000ms; exactly_one_aggregated_damage_quantum; "
            + "phase_a_excludes_wiki_ie_crit_ratio_30; "
            + "no_channel_timing_tick_schedule_interruption_cancel_direction_cone_"
            + "six_projectiles_per_wave_collision_geometry_multitarget_wave_by_wave_"
            + "snapshot_dynamic_stats_sight_reveal_spellshield_rng_on_crit_basic_"
            + "attack_other_ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "354cac88f79defa26369f485743f697bf61b50a814b008a8aa6c308b7e394d8a";

    private static final String NORMALIZED_SHA =
        "b275bcc7fb13855cf3fb5a7a8ca0cddce4964ed5713dc521eceb573e69b78c49";

    private static final String PAGES_SHA =
        "43bb41feafeaa7a8416bd91b81f51f4be73d3bf30ff78ccb2190fc317f3084d6";

    private static final String LOCAL_RAW_SHA =
        "19ba845fd99a0da526b34e55c833f9902c0ce9feb55ad486a1d18c12b55a1049";

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
    void documentsSourceIdentityLocalCaveatBoundaryTagsIeExclusionAndCritScaling() {
        assertContains("hero_skill|hero_missfortune|R|弹幕时间");
        assertContains("wasm-generic-miss-fortune-bullet-time-max-channel-expected");
        assertContains("miss-fortune-r-bullet-time-max-channel-expected-phase-a-v3");
        assertContains("Template:Data Miss Fortune/R");
        assertContains("Template:Data Miss Fortune/Bullet Time");
        assertContains("1308257");
        assertContains("3987215");
        assertContains("2026-01-25T03:47:11Z");
        assertContains("3021");
        assertContains("3550");
        assertContains("743");
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
        assertContains("normalized/generic/missfortune-r.json");
        assertContains("pages/missfortune-r.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertDocumentsExplicitAbsenceOfTotalAdRatio(sql, "seed");
        assertTrue(
            (sql.contains("critical damage|130|30") || sql.contains("{{critical damage|130|30}}")
                    || sql.contains("130|30"))
                && (sql.contains("Infinity Edge") || sql.contains("IE ratio")
                    || sql.contains("IE crit") || sql.contains("wiki_ie")),
            "seed must document Wiki critical damage|130|30 / Infinity Edge ratio presence");
        assertTrue(
            (sql.contains("排除") || sql.contains("excludes") || sql.contains("排除 IE")
                    || sql.contains("phase_a_excludes_wiki_ie"))
                && (sql.contains("IE") || sql.contains("Infinity Edge") || sql.contains("ie_crit")),
            "seed must explicitly exclude Wiki IE ratio in Phase-A");
        assertTrue(
            sql.contains("绝不主张 Wiki 省略 IE")
                || sql.contains("绝不主张") && sql.contains("省略 IE")
                || sql.contains("never claim Wiki omits IE")
                || (sql.contains("Wiki 含") && sql.contains("IE")),
            "seed must never claim Wiki omits IE; Wiki contains IE ratio");
        assertTrue(
            sql.contains("Maximum Total Physical Damage")
                && (sql.contains("noncrit") || sql.contains("非暴击") || sql.contains("non-crit")),
            "seed must note Wiki Maximum Total Physical Damage is noncrit");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("40 + 60% total AD + 25% AP")
                    || sql.contains("40 + 0.60")
                    || sql.contains("per-wave physical 40")),
            "seed comments must document rank3 per-wave physical 40 +60% total AD +25% AP");
        assertTrue(
            (sql.contains("18 waves") || sql.contains("eighteen_waves") || sql.contains("18 *"))
                && sql.contains("const\",\"value\":18"),
            "seed must document eighteen waves / const 18");
        assertTrue(
            (sql.contains("total AD") || sql.contains("totalAD"))
                && sql.contains("source.attr.ad.resolved")
                && (sql.contains("直接读取") || sql.contains("直接读") || sql.contains("不得减 base")),
            "seed must document total-AD direct resolved read");
        assertFalse(
            Pattern.compile("source\\.attr\\.ad\\.base").matcher(sqlNoComments).find(),
            "executable SQL must not read ad.base (total AD only)");
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
                || sql.contains("确定性缩放") || sql.contains("crit_eligible=false"),
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
        assertTrue(
            sql.contains("MissFortune.json")
                && (sql.contains("不以") || sql.contains("勿以") || sql.contains("legacy")
                    || sql.contains("不为") || sql.contains("不是")),
            "seed must reject legacy champion MissFortune.json as current truth");
        assertContains("20260726");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "seed must not use the Batch-B prerequisite phrase");
    }

    @Test
    void documentsDeterministicAlgebraFixturesIncludingCritClampEndpoints() {
        assertTrue(
            sql.contains("raw1800") || (sql.contains("1800") && sql.contains("crit0")),
            "seed must document crit0 raw1800");
        assertTrue(
            sql.contains("raw2070") || (sql.contains("2070") && sql.contains("crit0.5")),
            "seed must document crit0.5 raw2070");
        assertTrue(
            sql.contains("raw2340") || (sql.contains("2340") && sql.contains("crit1")),
            "seed must document crit1 raw2340");
        assertTrue(
            sql.contains("1035")
                && (sql.contains("armor100") || sql.contains("final1035")),
            "seed must document armor100 final1035");
        assertTrue(
            sql.contains("2587.5") || sql.contains("raw2587.5"),
            "seed must document AP100 crit0.5 raw2587.5");
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
                && (sql.contains("both1800") || sql.contains("both 1800")),
            "seed must document total-AD counterproof both1800");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            (sql.contains("standalone") || sql.contains("standalone isolation"))
                && (sql.contains("synthesizes no P/Q/W/E")
                    || sql.contains("no P/Q/W/E/basic")
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
                && (sql.contains("scaffold") || sql.contains("aggregated")
                    || sql.contains("期望"))
                && (sql.contains("不是实际") || sql.contains("not actual")
                    || sql.contains("not full R") || sql.contains("One aggregated")),
            "seed must clarify aggregate is Phase-A scaffold not full R");
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
            "max-channel expected seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "max-channel expected seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "max-channel expected seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "max-channel expected seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "max-channel expected seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroMissFortuneAdApCritChanceManaAndNoIdentityMaterialization() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_missfortune");
        assertContains("missing entity_attribute_values hero_missfortune/ad");
        assertContains("missing entity_attribute_values hero_missfortune/ap");
        assertContains("missing entity_attribute_values hero_missfortune/crit_chance");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized by this seed")
                || sql.contains("本脚本不物化"),
            "seed must state that this seed does not materialize Miss Fortune identity/panel/resource");
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
            sql.contains("没有任何 seed") || sql.contains("无 Miss Fortune")
                || sql.contains("无 materializer") || sql.contains("sibling absence")
                || sql.contains("当前仓库无 Miss Fortune identity"),
            "seed must clarify no Miss Fortune identity/panel/resource materializer in this repo");
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
                        + "entity_id\\s*=\\s*'hero_missfortune'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_missfortune before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_missfortune/ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_missfortune/ap");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'crit_chance'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_missfortune/crit_chance");
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
        assertContains("provider_hero_missfortune_r_bullet_time_max_channel_expected");
        assertContains("hero_missfortune_r_bullet_time_max_channel_expected");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_missfortune_r_bullet_time_max_channel_expected'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Bullet Time max-channel expected provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_missfortune'\\s*,\\s*"
                        + "'provider_hero_missfortune_r_bullet_time_max_channel_expected'")
                .matcher(sql)
                .find(),
            "must mount max-channel expected provider to hero_missfortune");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated max-channel expected provider");
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
                    "(?s)'ability_hero_missfortune_r_bullet_time_max_channel_expected'\\s*,\\s*"
                        + "'provider_hero_missfortune_r_bullet_time_max_channel_expected'\\s*,\\s*"
                        + "'bullet_time_max_channel_expected'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key bullet_time_max_channel_expected");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertContains("{\"op\":\"const\",\"value\":100000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_missfortune_r_bullet_time_max_channel_expected'\\s*,\\s*"
                        + "'ability_hero_missfortune_r_bullet_time_max_channel_expected'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 100000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_missfortune_r_bullet_time_max_channel_expected_impact'\\s*,\\s*"
                        + "'ability_hero_missfortune_r_bullet_time_max_channel_expected'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_missfortune_r_bullet_time_max_channel_expected_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_missfortune_r_bullet_time_max_channel_expected_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_missfortune_r_bullet_time_max_channel_expected_damage'\\s*,\\s*"
                        + "'sequence_hero_missfortune_r_bullet_time_max_channel_expected_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "max-channel expected damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_missfortune_r_bullet_time_max_channel_expected_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail")
                || sql.contains("exactly_one_aggregated_damage_quantum"),
            "seed must document deferred exactly-one-detail / aggregated quantum pairing");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("不写显式") || sql.contains("不写") || sql.contains("no explicit")
                    || sql.contains("不添加")),
            "seed must document automatic ability_started without explicit event step");
    }

    @Test
    void parsesExactNestedBinaryCritClampedPhysicalDamageFormulaWithExactReadPaths()
        throws IOException {
        assertContains(BULLET_TIME_DAMAGE);
        assertBinaryNestedCritClampedDamageFormula(BULLET_TIME_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ap.resolved");
        assertContains("source.attr.crit_chance.resolved");
        assertContains("\"value\":18");
        assertContains("\"value\":40");
        assertContains("\"value\":0.60");
        assertContains("\"value\":0.25");
        assertContains("\"value\":1.00");
        assertContains("\"value\":0.30");
        assertContains("\"value\":0.00");
        assertContains("\"op\":\"min\"");
        assertContains("\"op\":\"max\"");
        JsonNode root = JSON.readTree(BULLET_TIME_DAMAGE);
        assertEquals("mul", root.path("op").asText(), "outer op must be mul");
        assertEquals(2, root.path("args").size(), "outer mul must remain binary");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ad.resolved"),
            "ad.resolved must appear exactly once");
        assertEquals(
            0,
            countReadPathOccurrences(root, "source.attr.ad.base"),
            "ad.base must not appear");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ap.resolved"),
            "ap.resolved must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.crit_chance.resolved"),
            "crit_chance.resolved must appear exactly once");
        assertEquals(
            0,
            countReadPathOccurrences(root, "source.attr.crit_damage.resolved"),
            "crit_damage must not be read");
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
        assertFalse(
            Pattern.compile("(?i)total_ad_ratio").matcher(sqlNoComments).find(),
            "executable SQL must not introduce governed tag total_ad_ratio");
    }

    @Test
    void assertsDeterministicFixtureArithmeticForCritClampTotalAdAndAp() {
        assertEquals(1800.0, rawDamage(100, 0, 0.0), 0.0001);
        assertEquals(2070.0, rawDamage(100, 0, 0.5), 0.0001);
        assertEquals(2340.0, rawDamage(100, 0, 1.0), 0.0001);
        assertEquals(1800.0, rawDamage(100, 0, -0.25), 0.0001);
        assertEquals(2340.0, rawDamage(100, 0, 1.25), 0.0001);
        assertEquals(1035.0, finalVsArmor(2070.0, 100), 0.0001);
        assertEquals(2587.5, rawDamage(100, 100, 0.5), 0.0001);
        assertEquals(
            rawDamage(100, 0, 0.0),
            1800.0,
            0.0001,
            "totalAD100/AP0/crit0 must be 1800");
        assertEquals(1800.0, rawDamage(100, 0, 0.0), 0.0001);
    }

    @Test
    void seedsPhysicalDamageAddPolicyCopyableFalseAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_missfortune_r_bullet_time_max_channel_expected_damage'\\s*,\\s*"
                        + "'bullet_time_max_channel_expected_damage'\\s*,\\s*"
                        + "20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "max-channel expected damage must be physical 20220 add policy copyable_on_hit=false");
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
            "max-channel expected must not enable crit eligibility");
        assertTrue(
            sql.contains("crit_eligible=false") || sql.contains("crit_eligible = false")
                || sql.contains("noncritical"),
            "seed must document crit_eligible=false");
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
                    "(?i)tick.?schedule|wave.?by.?wave|six.?projectiles|"
                        + "basic_attack_hit|emit_event|equipment|loadout|\\brepeat\\b|"
                        + "missile.?barrage.?ammo|spellshield.?row")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded tick/wave/projectile/basic surfaces");
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
            sql.contains("channel timing") || sql.contains("tick schedule")
                || sql.contains("interruption") || sql.contains("direction"),
            "seed comments must document exclusion of channel timing/tick/direction");
        assertTrue(
            sql.contains("six projectiles") || sql.contains("collision")
                || sql.contains("geometry") || sql.contains("spellshield")
                || sql.contains("wave-by-wave"),
            "seed comments must document exclusion of projectile/geometry/spellshield/wave");
        assertTrue(
            sql.contains("One aggregated") || sql.contains("one aggregated")
                || sql.contains("not full R") || sql.contains("不是 full R")
                || sql.contains("exactly_one_aggregated"),
            "seed must state one aggregated quantum, not full R");
    }

    @Test
    void rejectsAbilitySpecificGameLocalRTypeAndTypeRelations() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoComments)
                .find(),
            "R must not write type_relations (no R ability-specific type)");
        assertFalse(
            Pattern.compile("(?is)\\b62\\d{3}\\b").matcher(sqlNoComments).find(),
            "executable SQL must not introduce game-local ability-specific 62xxx types");
        assertTrue(
            (sql.contains("无 ability-specific") || sql.contains("无 R 专用")
                    || sql.contains("no ability-specific") || sql.contains("不得新增 R"))
                && (sql.contains("62xxx") || sql.contains("game-local type")
                    || sql.contains("game-local")),
            "seed comments must document that R has no ability-specific game-local type");
        assertTrue(
            sql.contains("type_relations")
                && (sql.contains("不写") || sql.contains("不新增") || sql.contains("no R type")),
            "seed comments must document no R type / no type_relations");
    }

    @Test
    void enforcesStandaloneSiblingAbsenceWithoutSynthesizingPqeWBasic() {
        assertTrue(
            sql.contains("standalone sibling absence")
                || sql.contains("standalone isolation")
                || (sql.contains("synthesizes no P/Q/W/E")
                    && sql.contains("standalone")),
            "seed must document standalone sibling absence");
        assertTrue(
            (sql.contains("不创建") || sql.contains("不合成") || sql.contains("synthesiz")
                    || sql.contains("no P/Q/W/E"))
                && (sql.contains("P/Q/W/E") || sql.contains("P / Q / W / E")),
            "seed must forbid synthesizing P/Q/W/E/basic");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_missfortune_[pqwe]_|'ability_hero_missfortune_[pqwe]_|"
                        + "'provider_hero_missfortune_basic|'ability_hero_missfortune_basic")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate P/Q/W/E/basic graph rows");
        Matcher providerIds = Pattern.compile(
                "'provider_hero_missfortune_[a-z0-9_]+'")
            .matcher(sqlNoComments);
        Set<String> providers = new HashSet<>();
        while (providerIds.find()) {
            providers.add(providerIds.group());
        }
        assertEquals(
            Set.of("'provider_hero_missfortune_r_bullet_time_max_channel_expected'"),
            providers,
            "executable SQL must reference exactly one Miss Fortune provider id (R only)");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesFormulaIeExclusionAndHeroTestGoCaveat() {
        assertTrue(
            readme.contains(
                "lol_generic_miss_fortune_bullet_time_max_channel_expected_seed.sql"),
            "README must list the Miss Fortune R Bullet Time max-channel expected seed");
        assertTrue(
            readme.contains("LolGenericMissFortuneBulletTimeMaxChannelExpectedSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)miss.?fortune.*bullet|弹幕时间|Bullet Time")
                .matcher(readme)
                .find(),
            "README must name Miss Fortune Bullet Time");
        int seedIdx = readme.indexOf(
            "lol_generic_miss_fortune_bullet_time_max_channel_expected_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-miss-fortune-bullet-time-max-channel-expected"),
            "README entry must name the task key");
        assertTrue(
            section.contains("miss-fortune-r-bullet-time-max-channel-expected-phase-a-v3"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("phase_a_excludes_wiki_ie_crit_ratio_30"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertDocumentsExplicitAbsenceOfTotalAdRatio(section, "README");
        assertTrue(
            section.contains("1308257") && section.contains("3987215")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(NORMALIZED_SHA) && section.contains(PAGES_SHA)
                && section.contains("3550") && section.contains("743"),
            "README must document normalized/pages bytes and SHAs");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("3021"),
            "README must document canonical/local raw 3021 byte size");
        assertTrue(section.contains("100000"), "README must document cooldown 100000ms");
        assertTrue(
            section.contains("40") && section.contains("0.60") && section.contains("0.25")
                && section.contains("0.30")
                && (section.contains("crit_chance") || section.contains("crit chance")
                    || section.contains("暴击")),
            "README must document damage formula with total AD + AP + crit_chance scaling");
        assertTrue(
            section.contains("min") && section.contains("max")
                && (section.contains("formula-local") || section.contains("公式内")
                    || section.contains("clamp")),
            "README must document formula-local clamp");
        assertTrue(
            (section.contains("Infinity Edge") || section.contains("IE"))
                && (section.contains("排除") || section.contains("exclud"))
                && (section.contains("130|30") || section.contains("critical damage")
                    || section.contains("ie_crit")),
            "README must document Wiki IE ratio presence and Phase-A exclusion");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            (section.contains("不物化") || section.contains("本 seed 不物化")
                    || (section.contains("不做") && section.contains("自包含")))
                && (section.contains("无 Miss Fortune") || section.contains("无 materializer")
                    || section.contains("no Miss Fortune") || section.contains("no owning")),
            "README must warn no Miss Fortune materializer / this seed does not materialize");
        assertTrue(
            section.contains("MissFortune.json")
                && (section.contains("不以") || section.contains("勿以") || section.contains("legacy")
                    || section.contains("不为")),
            "README must reject legacy MissFortune.json as truth");
        assertTrue(
            section.contains("immediate") || section.contains("aggregated")
                || section.contains("scaffold"),
            "README must document immediate aggregated channel total scaffold");
        assertTrue(
            section.contains("standalone")
                && (section.contains("sibling absence") || section.contains("不合成")
                    || section.contains("no P/Q/W/E")),
            "README must document standalone sibling absence");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|channel.?timing|tick|direction|geometry|"
                        + "spellshield|wave.?by.?wave|IE")
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
            section.contains("raw1800") || section.contains("2070")
                || section.contains("2340") || section.contains("2587.5")
                || section.contains("1035"),
            "README must document deterministic algebra fixtures");
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
                    || section.contains("不是生产") || section.contains("production")
                    || section.contains("test-only") || section.contains("测试"))
                && (section.contains("generic") || section.contains("生产 runtime")
                    || section.contains("production runtime")
                    || section.contains("仍为 generic")),
            "README must say hero _test.go planned as test-only regression/governance evidence "
                + "and production runtime remains generic");
        assertFalse(
            section.contains(EXPECTED_SEED_SHA256),
            "README must not blob-lock seed SHA");
        assertTrue(
            section.contains("LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest")
                || section.contains("LolGenericCritModifierSeedSqlTest"),
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
            String expectedTag = "README".equals(label) && "ability_cost_cooldown".equals(tag)
                ? "ability_cooldown"
                : tag;
            int idx = block.indexOf(expectedTag);
            assertTrue(idx >= 0, label + " ordered tags must include " + expectedTag);
            assertTrue(
                idx > prev,
                label + " ordered tags must keep exact order; out of order: " + expectedTag);
            prev = idx;
        }
        assertFalse(
            Pattern.compile(
                    "(?:→\\s*`total_ad_ratio`|`total_ad_ratio`\\s*→|"
                        + "(?m)^\\s*(?:--\\s*)?\\d+\\.\\s*`?total_ad_ratio`?\\b)")
                .matcher(block)
                .find(),
            label + " ordered tags must not list total_ad_ratio as a declared tag");
    }

    private static void assertDocumentsExplicitAbsenceOfTotalAdRatio(String text, String label) {
        assertTrue(
            (text.contains("不含") || text.contains("不包含") || text.contains("omit")
                    || text.contains("forbids") || text.contains("禁止")
                    || text.contains("显式不包含"))
                && text.contains("total_ad_ratio"),
            label + " must explicitly document absence of governed tag total_ad_ratio");
    }

    private static void assertBinaryNestedCritClampedDamageFormula(String damageJson)
        throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("mul", root.path("op").asText(), "outer damage must be mul");
        assertEquals(2, root.path("args").size(), "outer mul must be binary");
        assertEquals(
            18,
            root.path("args").get(0).path("value").asDouble(),
            0.0001,
            "outer mul left must be const 18");
        JsonNode innerMul = root.path("args").get(1);
        assertEquals("mul", innerMul.path("op").asText(), "outer right must be mul");
        assertEquals(2, innerMul.path("args").size(), "inner mul must be binary");
        JsonNode baseAdd = innerMul.path("args").get(0);
        assertEquals("add", baseAdd.path("op").asText(), "wave base must be nested add");
        assertEquals(2, baseAdd.path("args").size(), "wave add must be binary");
        JsonNode innerAdd = baseAdd.path("args").get(0);
        assertEquals("add", innerAdd.path("op").asText(), "inner left must be nested add");
        assertEquals(2, innerAdd.path("args").size(), "inner add must be binary");
        assertEquals(
            40,
            innerAdd.path("args").get(0).path("value").asDouble(),
            0.0001,
            "inner add left must be const 40");
        JsonNode mulAd = innerAdd.path("args").get(1);
        assertEquals("mul", mulAd.path("op").asText(), "inner add right must be mul");
        assertEquals(2, mulAd.path("args").size(), "AD mul must be binary");
        assertEquals(
            0.60,
            mulAd.path("args").get(0).path("value").asDouble(),
            0.0001,
            "total AD mul left must be const 0.60");
        assertEquals(
            "source.attr.ad.resolved",
            mulAd.path("args").get(1).path("path").asText(),
            "total AD mul right must read ad.resolved");
        JsonNode mulAp = baseAdd.path("args").get(1);
        assertEquals("mul", mulAp.path("op").asText(), "wave add right must be AP mul");
        assertEquals(2, mulAp.path("args").size(), "AP mul must be binary");
        assertEquals(
            0.25,
            mulAp.path("args").get(0).path("value").asDouble(),
            0.0001,
            "AP mul left must be const 0.25");
        assertEquals(
            "source.attr.ap.resolved",
            mulAp.path("args").get(1).path("path").asText(),
            "AP mul right must read ap.resolved");
        JsonNode scaleAdd = innerMul.path("args").get(1);
        assertEquals("add", scaleAdd.path("op").asText(), "inner mul right must be scale add");
        assertEquals(2, scaleAdd.path("args").size(), "scale add must be binary");
        assertEquals(
            1.00,
            scaleAdd.path("args").get(0).path("value").asDouble(),
            0.0001,
            "scale add left must be const 1.00");
        JsonNode mulScale = scaleAdd.path("args").get(1);
        assertEquals("mul", mulScale.path("op").asText(), "scale add right must be mul");
        assertEquals(
            0.30,
            mulScale.path("args").get(0).path("value").asDouble(),
            0.0001,
            "crit scale mul left must be const 0.30");
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
        assertBinaryArithmeticComparisonArity(root, "bullet_time_max_channel_expected_damage");
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

    private static double rawDamage(double totalAd, double ap, double crit) {
        double wave = 40.0 + 0.60 * totalAd + 0.25 * ap;
        double clamped = Math.min(1.00, Math.max(0.00, crit));
        return 18.0 * wave * (1.00 + 0.30 * clamped);
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
        fail("cannot resolve relative path: " + relative + " from cwd=" + cwd);
        return null;
    }
}
