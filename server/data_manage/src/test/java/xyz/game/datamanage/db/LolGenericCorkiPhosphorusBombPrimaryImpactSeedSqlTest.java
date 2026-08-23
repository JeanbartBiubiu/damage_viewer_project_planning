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
 * Static contract for {@code lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_corki",
        "provider_hero_corki_q_phosphorus_bomb_primary_impact",
        "ability_hero_corki_q_phosphorus_bomb_primary_impact",
        "phosphorus_bomb_primary_impact",
        "phase_hero_corki_q_phosphorus_bomb_primary_impact_impact",
        "sequence_hero_corki_q_phosphorus_bomb_primary_impact_impact",
        "step_hero_corki_q_phosphorus_bomb_primary_impact_damage",
        "cooldown_hero_corki_q_phosphorus_bomb_primary_impact",
        "phosphorus_bomb_primary_impact_damage",
        "q_mana_cost",
        "q_cooldown_ms",
        "hero_corki_q_phosphorus_bomb_primary_impact");

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

    private static final String PHOSPHORUS_BOMB_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":240},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.25},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_selected_primary_champion_single_magic_impact_hit; "
            + "immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; "
            + "no_cast_time_location_targeting_range_radius_geometry_projectile_travel_"
            + "minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_"
            + "impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_"
            + "other_ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365";

    private static final String NORMALIZED_SHA =
        "3c4584b2e8442e7ff2ae1d2d4c4d8dff4613efa98bf7ba4cd3ab44ef05c8572d";

    private static final String PAGES_SHA =
        "bff7e3533e2bba561c03e91da5d7c07ffc095e07a0669b321cc7fd480d18f42a";

    private static final String LOCAL_RAW_SHA =
        "c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6";

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
    void documentsSourceIdentityLocalCaveatBoundaryTagsAndBonusAdApWording() {
        assertContains("hero_skill|hero_corki|Q|磷光炸弹");
        assertContains("wasm-generic-corki-phosphorus-bomb-primary-impact");
        assertContains("corki-q-phosphorus-bomb-primary-impact-phase-a-v1");
        assertContains("Template:Data Corki/Q");
        assertContains("Template:Data Corki/Phosphorus Bomb");
        assertContains("1306953");
        assertContains("4007588");
        assertContains("2026-04-12T06:50:59Z");
        assertContains("1531");
        assertContains(CANONICAL_SHA);
        assertContains("2148");
        assertContains(NORMALIZED_SHA);
        assertContains("691");
        assertContains(PAGES_SHA);
        assertContains("1529");
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
        assertContains("normalized/generic/corki-q.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertTrue(
            Pattern.compile("(?i)magic|魔法").matcher(sql).find()
                && (sql.contains("240 + 125% bonus AD + 100% AP")
                    || sql.contains("240 + 1.25")
                    || sql.contains("magic 240")),
            "seed comments must document rank5 magic 240 +125% bonus AD +100% AP");
        assertTrue(
            (sql.contains("bonus AD") || sql.contains("bonus_ad"))
                && sql.contains("source.attr.ad.resolved")
                && sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD sub(resolved, base)");
        assertTrue(
            sql.contains("source.attr.ap.resolved")
                && (sql.contains("直接读取") || sql.contains("直接读") || sql.contains("AP is")),
            "seed must document direct AP resolved read");
        assertTrue(
            sql.contains("嵌套二元") || sql.contains("nested binary")
                || sql.contains("每个算术节点恰好二元"),
            "seed must document nested-binary arithmetic");
        assertTrue(
            sql.contains("不得直接读 total AD") || sql.contains("不得省略 ad.base")
                || (sql.contains("must not") && sql.contains("total AD")),
            "seed must forbid total-AD direct as bonus ratio");
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
        assertFalse(
            Pattern.compile("(?i)meta_or_non_target_dps").matcher(sqlNoComments).find(),
            "executable SQL must not add meta_or_non_target_dps tags");
        assertTrue(
            sql.contains("meta_or_non_target_dps")
                && (sql.contains("不含") || sql.contains("亦不含") || sql.contains("no ")),
            "seed comments must document absence of meta_or_non_target_dps");
    }

    @Test
    void documentsDeterministicFixturesWithoutClaimingFullFidelity() {
        assertTrue(
            sql.contains("base60/resolved60/AP0/MR0")
                && (sql.contains("raw/final240") || sql.contains("final240")),
            "seed comments must document base60/resolved60/AP0/MR0 raw/final240");
        assertTrue(
            sql.contains("base60/resolved160/AP0") && sql.contains("365"),
            "seed comments must document base60/resolved160/AP0 => 365");
        assertTrue(
            sql.contains("base60/resolved60/AP100") && sql.contains("340"),
            "seed comments must document base60/resolved60/AP100 => 340");
        assertTrue(
            sql.contains("base60/resolved160/AP100") && sql.contains("465"),
            "seed comments must document base60/resolved160/AP100 => 465");
        assertTrue(
            sql.contains("base60/resolved156/AP100/MR100")
                && (sql.contains("raw460/final230")
                    || (sql.contains("raw460") && sql.contains("final230"))),
            "seed comments must document base60/resolved156/AP100/MR100 raw460/final230");
        assertTrue(
            sql.contains("base60/resolved220/AP100/MR100")
                && (sql.contains("raw540/final270")
                    || (sql.contains("raw540") && sql.contains("final270"))),
            "seed comments must document base60/resolved220/AP100/MR100 raw540/final270");
        assertTrue(
            (sql.contains("bonusAD counterproof") || sql.contains("counterproof"))
                && sql.contains("base0/resolved100")
                && sql.contains("base60/resolved160")
                && (sql.contains("both365") || sql.contains("both 365")),
            "seed must document bonusAD counterproof both365");
        assertTrue(
            sql.contains("t0") && sql.contains("t6999") && sql.contains("t7000"),
            "seed comments must document cooldown timeline t0/t6999/t7000");
        assertTrue(
            (sql.contains("Mana240") || sql.contains("mana240"))
                && (sql.contains("mana80") || sql.contains("final mana80"))
                && (sql.contains("HP540") || sql.contains("HP1000")),
            "seed comments must document Mana240→80 / HP1000→540 fixture");
        assertTrue(
            sql.contains("two Q hits") || (sql.contains("two Q") && sql.contains("hits")),
            "seed comments must document two Q hits");
        assertTrue(
            sql.contains("automatic starts") || (sql.contains("automatic") && sql.contains("starts"))
                || (sql.contains("two") && sql.contains("ability_started")),
            "seed comments must document automatic starts / ability_started");
        assertTrue(
            sql.contains("readyAt7000") || sql.contains("readyAt 7000"),
            "seed comments must document readyAt7000");
        assertTrue(
            (sql.contains("Mana79") || sql.contains("mana79"))
                && (sql.contains("skips") || sql.contains("unchanged") || sql.contains("resource skip")),
            "seed comments must document Mana79 skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("standalone")
                || sql.contains("no P/W/E/R/basic")
                || sql.contains("不要求"),
            "seed comments must document standalone provider / no sibling synthesis");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim")
                || sql.contains("not full Q"),
            "seed must not claim full fidelity");
        assertTrue(
            sql.contains("One selected-primary") || sql.contains("one selected")
                || sql.contains("not full Q") || sql.contains("不是实际"),
            "seed must state one selected-primary single magic impact hit, not full Q");
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
            "phosphorus bomb primary-impact seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "phosphorus bomb primary-impact seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "phosphorus bomb primary-impact seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "phosphorus bomb primary-impact seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "phosphorus bomb primary-impact seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroCorkiAdApManaAndNoRepositoryMaterializer() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_corki");
        assertContains("missing entity_attribute_values hero_corki/ad");
        assertContains("missing entity_attribute_values hero_corki/ap");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed")
                || sql.contains("当前仓库无 materializer"),
            "seed must state that no current repository seed/materializer provides Corki rows");
        assertTrue(
            sql.contains("external existing-data dependency")
                || sql.contains("外部既有")
                || sql.contains("external existing-data"),
            "seed must use external existing-data identity wording");
        assertTrue(
            sql.contains("ensure-entity") || sql.contains("不以 ensure-entity")
                || sql.contains("勿以 ensure-entity"),
            "seed must reject ensure-entity legacy seeds as a reason to materialize prerequisites");
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
                        + "entity_id\\s*=\\s*'hero_corki'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_corki before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_corki/ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_corki/ap");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_corki with the Batch-B prerequisite phrase");
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
        assertContains("provider_hero_corki_q_phosphorus_bomb_primary_impact");
        assertContains("hero_corki_q_phosphorus_bomb_primary_impact");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_corki_q_phosphorus_bomb_primary_impact'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Phosphorus Bomb primary-impact provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_corki'\\s*,\\s*"
                        + "'provider_hero_corki_q_phosphorus_bomb_primary_impact'")
                .matcher(sql)
                .find(),
            "must mount Phosphorus Bomb primary-impact provider to hero_corki");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Phosphorus Bomb primary-impact provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Phosphorus Bomb primary-impact only)");
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
                    "(?s)'ability_hero_corki_q_phosphorus_bomb_primary_impact'\\s*,\\s*"
                        + "'provider_hero_corki_q_phosphorus_bomb_primary_impact'\\s*,\\s*"
                        + "'phosphorus_bomb_primary_impact'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key phosphorus_bomb_primary_impact");
        assertContains("{\"op\":\"const\",\"value\":80}");
        assertContains("{\"op\":\"const\",\"value\":7000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_corki_q_phosphorus_bomb_primary_impact'\\s*,\\s*"
                        + "'ability_hero_corki_q_phosphorus_bomb_primary_impact'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 7000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_corki_q_phosphorus_bomb_primary_impact_impact'\\s*,\\s*"
                        + "'ability_hero_corki_q_phosphorus_bomb_primary_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_corki_q_phosphorus_bomb_primary_impact_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_corki_q_phosphorus_bomb_primary_impact_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_corki_q_phosphorus_bomb_primary_impact_damage'\\s*,\\s*"
                        + "'sequence_hero_corki_q_phosphorus_bomb_primary_impact_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Phosphorus Bomb damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_corki_q_phosphorus_bomb_primary_impact_damage'"),
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
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_corki_[pwer]_|'ability_hero_corki_[pwer]_|"
                        + "'provider_hero_corki_basic_|'ability_hero_corki_basic_")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate P/W/E/R/basic rows");
    }

    @Test
    void parsesNestedBinaryBonusAdAndApMagicDamageFormulaWithExactReadPaths() throws IOException {
        assertContains(PHOSPHORUS_BOMB_DAMAGE);
        assertBinaryNestedBonusAdApDamageFormula(PHOSPHORUS_BOMB_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":240");
        assertContains("\"value\":1.25");
        assertContains("\"value\":1.00");
        assertContains("\"op\":\"sub\"");
        assertEquals(
            2,
            JSON.readTree(PHOSPHORUS_BOMB_DAMAGE).path("args").size(),
            "outer add must remain binary");
        assertEquals(
            "add",
            JSON.readTree(PHOSPHORUS_BOMB_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be nested add");
        assertEquals(
            "mul",
            JSON.readTree(PHOSPHORUS_BOMB_DAMAGE).path("args").get(1).path("op").asText(),
            "outer right child must be mul(1.00, ap.resolved)");
        assertEquals(
            1,
            countReadPathOccurrences(
                JSON.readTree(PHOSPHORUS_BOMB_DAMAGE), "source.attr.ad.resolved"),
            "ad.resolved must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(JSON.readTree(PHOSPHORUS_BOMB_DAMAGE), "source.attr.ad.base"),
            "ad.base must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(
                JSON.readTree(PHOSPHORUS_BOMB_DAMAGE), "source.attr.ap.resolved"),
            "ap.resolved must appear exactly once");
        assertFalse(
            Pattern.compile("(?i)crit|source\\.attr\\.crit")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not read crit attributes");
    }

    @Test
    void seedsMagicDamageAddPolicyCopyableFalseAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_corki_q_phosphorus_bomb_primary_impact_damage'\\s*,\\s*"
                        + "'phosphorus_bomb_primary_impact_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Phosphorus Bomb damage must be magic 20221 add policy copyable_on_hit=false");
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
        assertTrue(
            sql.contains("20230")
                && (sql.contains("forbid") || sql.contains("禁止") || sql.contains("不得")),
            "seed comments must explicitly forbid 20230");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Phosphorus Bomb primary-impact must not enable crit eligibility");
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
                    "(?i)cast.?time|location.?target|projectile|missile|travel.?time|"
                        + "minimum.?travel|explosion|spellaoe|\\baoe\\b|multitarget|"
                        + "surrounding|\\bsight\\b|reveal|six.?second|spellshield|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "\\brepeat\\b|channel")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded cast-time/location/range/radius/geometry/"
                + "projectile/travel/AOE/sight/reveal surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_corki_[pwer]_|'ability_hero_corki_[pwer]_|"
                        + "'provider_hero_corki_basic_|'ability_hero_corki_basic_")
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
            sql.contains("cast time") || sql.contains("cast_time") || sql.contains("location"),
            "seed comments must document exclusion of cast time/location targeting");
        assertTrue(
            sql.contains("range") || sql.contains("radius") || sql.contains("geometry"),
            "seed comments must document exclusion of range/radius/geometry");
        assertTrue(
            sql.contains("projectile") || sql.contains("travel") || sql.contains("minimum travel"),
            "seed comments must document exclusion of projectile/travel/minimum travel time");
        assertTrue(
            sql.contains("AOE") || sql.contains("aoe") || sql.contains("multitarget")
                || sql.contains("explosion"),
            "seed comments must document exclusion of explosion AOE/multitarget");
        assertTrue(
            sql.contains("sight") || sql.contains("reveal") || sql.contains("six-second")
                || sql.contains("six second"),
            "seed comments must document exclusion of sight/reveal/six-second duration");
        assertTrue(
            sql.contains("spellshield") || sql.contains("spell shield") || sql.contains("Spellshield"),
            "seed comments must document exclusion of spellshield");
        assertTrue(
            sql.contains("One selected-primary") || sql.contains("one selected")
                || sql.contains("not full Q") || sql.contains("不是 full Q"),
            "seed must state one selected-primary magic impact hit, not full Q");
    }

    @Test
    void rejectsAbilitySpecificTypeAndTypeRelationsForQ() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoComments)
                .find(),
            "Q must not write type_relations (no Q ability-specific type)");
        assertFalse(
            Pattern.compile("(?is)\\b62\\d{3}\\b").matcher(sqlNoComments).find(),
            "executable SQL must not introduce game-local ability-specific 62xxx types");
        assertTrue(
            sql.contains("type_relations")
                && (sql.contains("不写") || sql.contains("不新增 Q type") || sql.contains("no Q type")
                    || sql.contains("无 ability-specific")),
            "seed comments must document no Q type / no type_relations");
        assertTrue(
            sql.contains("无 Q-specific type") || sql.contains("无 Q-specific")
                || sql.contains("no Q-specific type") || sql.contains("不得新增 Q 专用"),
            "seed must document absence of Q-specific type");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesBonusAdApExclusionsStandaloneAndNoMaterializer() {
        assertTrue(
            readme.contains("lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql"),
            "README must list the Corki Q Phosphorus Bomb primary-impact seed");
        assertTrue(
            readme.contains("LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)corki.*phosphorus|磷光炸弹|Phosphorus Bomb")
                .matcher(readme)
                .find(),
            "README must name Corki Phosphorus Bomb");
        int seedIdx = readme.indexOf(
            "lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-corki-phosphorus-bomb-primary-impact"),
            "README entry must name the task key");
        assertTrue(
            section.contains("corki-q-phosphorus-bomb-primary-impact-phase-a-v1"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("magic_240_plus_1_25_bonus_ad_plus_1_00_ap"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertTrue(
            section.contains("不含 salvage") || section.contains("亦不含 salvage")
                || section.contains("no salvage") || section.contains("不含 salvage tags"),
            "README must document absence of salvage tags");
        assertFalse(
            Pattern.compile("(?i)\\bsalvage\\b")
                .matcher(section.replace("不含 salvage", "").replace("亦不含 salvage", "")
                    .replace("no salvage", "").replace("不含 salvage tags", ""))
                .find()
                && section.matches("(?is).*Ordered tags:[^\\n]*salvage.*"),
            "README ordered tags must not include salvage");
        assertTrue(
            section.contains("1306953") && section.contains("4007588")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(NORMALIZED_SHA) && section.contains("2148"),
            "README must document authoritative normalized bytes/SHA");
        assertTrue(
            section.contains(PAGES_SHA) && section.contains("691"),
            "README must document pages bytes/SHA");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("1531") && section.contains("1529"),
            "README must document canonical 1531 and local raw 1529 byte sizes");
        assertTrue(section.contains("7000"), "README must document cooldown 7000ms");
        assertTrue(
            section.contains("240") && section.contains("1.25") && section.contains("1.00")
                && (section.contains("bonus AD") || section.contains("ad.resolved-ad.base")
                    || (section.contains("ad.resolved") && section.contains("ad.base"))),
            "README must document damage formula with bonus AD + AP wording");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("无 seed") || section.contains("无 materializer")
                || section.contains("没有任何 seed") || section.contains("不负责物化")
                || section.contains("亦无 seed 负责物化"),
            "README must warn that no repository materializer exists for Corki identity/panel/resource");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|cast.?time|location|range|radius|geometry|"
                        + "projectile|AOE|sight|reveal|spellshield")
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
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_corki`|"
                    + "ensure `hero_corki` 最低必要实体|"
                    + "ensure `hero_corki`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
        assertTrue(
            section.contains("base60/resolved60") || section.contains("final230")
                || section.contains("HP540") || section.contains("Mana240")
                || section.contains("both365"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            section.contains("LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest")
                || section.contains("LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest")
                || section.contains("LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest")
                || section.contains("LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest")
                || section.contains("LolGenericLucianArdentBlazePrimaryHitSeedSqlTest")
                || section.contains("LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest")
                || section.contains("LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest"),
            "README static validation must cite adjacent magic bonusAD+AP and selected-primary precedents");
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
        // Positive tag list must not list salvage / meta_or_non_target_dps as members;
        // exclusion notes that mention those names are allowed after the numbered tags.
        int lastTagIdx = block.indexOf(ORDERED_TAGS.get(ORDERED_TAGS.size() - 1));
        String positiveList = block.substring(0, lastTagIdx + ORDERED_TAGS.get(ORDERED_TAGS.size() - 1).length());
        assertFalse(
            Pattern.compile("(?i)(?<!no )(?<!不含 )(?<!亦不含 )\\bsalvage\\b")
                .matcher(positiveList)
                .find(),
            label + " ordered tags list must not include salvage as a positive tag");
        assertFalse(
            positiveList.contains("meta_or_non_target_dps"),
            label + " ordered tags list must not include meta_or_non_target_dps as a positive tag");
    }

    /**
     * compileGenericNode only wires args[0]/args[1] for binary arithmetic/comparison ops.
     * Damage formula must use nested binary add(add(base, bonusAD), AP).
     */
    private static void assertBinaryNestedBonusAdApDamageFormula(String damageJson)
            throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be nested add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        JsonNode inner = root.path("args").get(0);
        assertEquals("add", inner.path("op").asText(), "inner damage must be nested add");
        assertEquals(2, inner.path("args").size(), "inner add must be binary");
        assertEquals(
            240,
            inner.path("args").get(0).path("value").asDouble(),
            0.0001,
            "inner add left must be const 240");
        JsonNode mulBonus = inner.path("args").get(1);
        assertEquals("mul", mulBonus.path("op").asText(), "inner right must be mul");
        assertEquals(2, mulBonus.path("args").size(), "mul must be binary");
        assertEquals(
            1.25,
            mulBonus.path("args").get(0).path("value").asDouble(),
            0.0001,
            "bonus AD mul left must be const 1.25");
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
        JsonNode mulAp = root.path("args").get(1);
        assertEquals("mul", mulAp.path("op").asText(), "outer right must be mul");
        assertEquals(2, mulAp.path("args").size(), "AP mul must be binary");
        assertEquals(
            1.00,
            mulAp.path("args").get(0).path("value").asDouble(),
            0.0001,
            "AP mul left must be const 1.00");
        assertEquals(
            "source.attr.ap.resolved",
            mulAp.path("args").get(1).path("path").asText(),
            "AP mul right must read ap.resolved");
        assertBinaryArithmeticComparisonArity(root, "phosphorus_bomb_primary_impact_damage");
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
