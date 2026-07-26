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
 * Static contract for {@code lol_generic_tristana_buster_shot_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericTristanaBusterShotPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_tristana_buster_shot_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_tristana",
        "provider_hero_tristana_r_buster_shot_primary_hit",
        "ability_hero_tristana_r_buster_shot_primary_hit",
        "buster_shot_primary_hit",
        "phase_hero_tristana_r_buster_shot_primary_hit_impact",
        "sequence_hero_tristana_r_buster_shot_primary_hit_impact",
        "step_hero_tristana_r_buster_shot_primary_hit_damage",
        "cost_hero_tristana_r_buster_shot_primary_hit_mana",
        "cooldown_hero_tristana_r_buster_shot_primary_hit",
        "buster_shot_primary_hit_damage",
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

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_magic_damage",
        "bonus_ad_ratio",
        "ap_ratio",
        "immediate_impact_scaffold");

    private static final String BUSTER_SHOT_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":325},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.70},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank3_selected_primary_champion_single_magic_hit; "
            + "immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; "
            + "no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_"
            + "geometry_displacement_immunity_unit_target_cancel_post_basic_attack_"
            + "explosive_charge_other_ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058";

    private static final String LOCAL_RAW_SHA =
        "42e07f07f3188aada86d18d782c05d291f031dbbf92171e4a1120e828ebf8c7b";

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
        assertContains("hero_skill|hero_tristana|R|毁灭射击");
        assertContains("wasm-generic-tristana-buster-shot-primary-hit");
        assertContains("tristana-r-buster-shot-primary-hit-phase-a-v1");
        assertContains("Template:Data Tristana/R");
        assertContains("Template:Data Tristana/Buster Shot");
        assertContains("1308525");
        assertContains("4008205");
        assertContains("2026-04-14T05:37:16Z");
        assertContains("2385");
        assertContains("2382");
        assertContains(CANONICAL_SHA);
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
        assertContains("normalized/generic/tristana-r.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertTrue(
            Pattern.compile("(?i)magic|魔法").matcher(sql).find()
                && (sql.contains("325 + 70% bonus AD + 100% AP")
                    || sql.contains("325 + 0.70")
                    || sql.contains("magic 325")),
            "seed comments must document rank3 magic 325 +70% bonus AD +100% AP");
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
            sql.contains("baseAD0/resolvedAD0/AP0/MR0")
                && (sql.contains("raw/final325") || sql.contains("final325")),
            "seed comments must document baseAD0/resolvedAD0/AP0/MR0 raw/final325");
        assertTrue(
            sql.contains("baseAD60/resolvedAD60/AP0/MR0")
                && (sql.contains("raw/final325") || sql.contains("final325")),
            "seed comments must document baseAD60/resolvedAD60/AP0/MR0 raw/final325");
        assertTrue(
            sql.contains("baseAD60/resolvedAD160/AP0/MR0")
                && (sql.contains("raw/final395") || sql.contains("final395")),
            "seed comments must document baseAD60/resolvedAD160/AP0/MR0 raw/final395");
        assertTrue(
            sql.contains("baseAD60/resolvedAD160/AP100/MR0")
                && (sql.contains("raw/final495") || sql.contains("final495")),
            "seed comments must document baseAD60/resolvedAD160/AP100/MR0 raw/final495");
        assertTrue(
            sql.contains("baseAD60/resolvedAD160/AP100/MR100")
                && (sql.contains("raw495/final247.5")
                    || (sql.contains("raw495") && sql.contains("final247.5"))),
            "seed comments must document baseAD60/resolvedAD160/AP100/MR100 raw495/final247.5");
        assertTrue(
            sql.contains("baseAD60/resolvedAD260/AP200/MR100")
                && (sql.contains("raw665/final332.5")
                    || (sql.contains("raw665") && sql.contains("final332.5"))),
            "seed comments must document baseAD60/resolvedAD260/AP200/MR100 raw665/final332.5");
        assertTrue(
            sql.contains("baseAD0/resolvedAD100/AP100")
                && sql.contains("baseAD60/resolvedAD160/AP100")
                && (sql.contains("both495") || sql.contains("both 495")),
            "seed must document baseAD0/resolvedAD100/AP100 vs baseAD60/resolvedAD160/AP100 both495");
        assertTrue(
            sql.contains("t0") && sql.contains("t99999") && sql.contains("t100000"),
            "seed comments must document cooldown timeline t0/t99999/t100000");
        assertTrue(
            (sql.contains("mana300") || sql.contains("mana300/"))
                && (sql.contains("mana100") || sql.contains("final mana100"))
                && (sql.contains("HP505") || sql.contains("HP1000")),
            "seed comments must document mana300→100 / HP1000→505 fixture");
        assertTrue(
            sql.contains("exactly two R damage") || sql.contains("two R damage items")
                || (sql.contains("exactly two R") && sql.contains("damage")),
            "seed comments must document exactly two R damage items");
        assertTrue(
            sql.contains("two automatic R") || sql.contains("two automatic R ability_started")
                || (sql.contains("two automatic") && sql.contains("ability_started")),
            "seed comments must document two automatic R ability_started");
        assertTrue(
            sql.contains("mana99") && (sql.contains("resource skip") || sql.contains("unchanged")),
            "seed comments must document mana99 resource skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("standalone")
                || sql.contains("no P/Q/W/E/basic")
                || sql.contains("Explosive Charge"),
            "seed comments must document standalone provider / no sibling synthesis");
        assertTrue(
            sql.contains("Explosive Charge")
                && (sql.contains("不要求") || sql.contains("no") || sql.contains("不合成")),
            "seed comments must document no Explosive Charge dependency/synthesis");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim"),
            "seed must not claim full fidelity");
        assertTrue(
            sql.contains("Phase-A") && (sql.contains("scaffold") || sql.contains("impact scaffold"))
                && (sql.contains("不是实际") || sql.contains("not actual")
                    || sql.contains("not full R") || sql.contains("One selected-target")),
            "seed must clarify immediate magic hit is Phase-A scaffold not full R");
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
            "buster-shot primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "buster-shot primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "buster-shot primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "buster-shot primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "buster-shot primary-hit seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroTristanaAdApManaAndNoRepositoryMaterializer() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_tristana");
        assertContains("missing entity_attribute_values hero_tristana/ad");
        assertContains("missing entity_attribute_values hero_tristana/ap");
        assertContains("missing resource_definitions mana");
        assertContains("missing entity_resource_values hero_tristana/mana");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed")
                || sql.contains("当前仓库无 materializer"),
            "seed must state that no current repository seed/materializer provides Tristana rows");
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
                        + "entity_id\\s*=\\s*'hero_tristana'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_tristana before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_tristana/ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ap'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_tristana/ap");
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
            "must SELECT/EXISTS-check entity_resource_values hero_tristana/mana");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_tristana with the Batch-B prerequisite phrase");
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
        assertContains("provider_hero_tristana_r_buster_shot_primary_hit");
        assertContains("hero_tristana_r_buster_shot_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_tristana_r_buster_shot_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Buster Shot primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_tristana'\\s*,\\s*"
                        + "'provider_hero_tristana_r_buster_shot_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Buster Shot primary-hit provider to hero_tristana");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Buster Shot primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Buster Shot primary-hit only)");
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
                    "(?s)'ability_hero_tristana_r_buster_shot_primary_hit'\\s*,\\s*"
                        + "'provider_hero_tristana_r_buster_shot_primary_hit'\\s*,\\s*"
                        + "'buster_shot_primary_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key buster_shot_primary_hit");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_tristana_r_buster_shot_primary_hit_mana'\\s*,\\s*"
                        + "'ability_hero_tristana_r_buster_shot_primary_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'r_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "R mana cost must be ability-level 100 via ability_costs");
        assertContains("{\"op\":\"const\",\"value\":100000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_tristana_r_buster_shot_primary_hit'\\s*,\\s*"
                        + "'ability_hero_tristana_r_buster_shot_primary_hit'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 100000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_tristana_r_buster_shot_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_tristana_r_buster_shot_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_tristana_r_buster_shot_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_tristana_r_buster_shot_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_tristana_r_buster_shot_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_tristana_r_buster_shot_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Buster Shot damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_tristana_r_buster_shot_primary_hit_damage'"),
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
                    "(?is)'provider_hero_tristana_[pqwe]_|'ability_hero_tristana_[pqwe]_|"
                        + "'provider_hero_tristana_basic_|'ability_hero_tristana_basic_|"
                        + "explosive_charge")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate P/Q/W/E/basic/Explosive Charge rows");
    }

    @Test
    void parsesNestedBinaryBonusAdAndApMagicDamageFormulaWithExactReadPaths() throws IOException {
        assertContains(BUSTER_SHOT_DAMAGE);
        assertBinaryNestedBonusAdApDamageFormula(BUSTER_SHOT_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":325");
        assertContains("\"value\":0.70");
        assertContains("\"value\":1.00");
        assertContains("\"op\":\"sub\"");
        assertEquals(
            2,
            JSON.readTree(BUSTER_SHOT_DAMAGE).path("args").size(),
            "outer add must remain binary");
        assertEquals(
            "add",
            JSON.readTree(BUSTER_SHOT_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be nested add");
        assertEquals(
            "mul",
            JSON.readTree(BUSTER_SHOT_DAMAGE).path("args").get(1).path("op").asText(),
            "outer right child must be mul(1.00, ap.resolved)");
        assertEquals(
            1,
            countReadPathOccurrences(JSON.readTree(BUSTER_SHOT_DAMAGE), "source.attr.ad.resolved"),
            "ad.resolved must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(JSON.readTree(BUSTER_SHOT_DAMAGE), "source.attr.ad.base"),
            "ad.base must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(JSON.readTree(BUSTER_SHOT_DAMAGE), "source.attr.ap.resolved"),
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
                    "(?s)'step_hero_tristana_r_buster_shot_primary_hit_damage'\\s*,\\s*"
                        + "'buster_shot_primary_hit_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Buster Shot damage must be magic 20221 add policy copyable_on_hit=false");
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
            "Buster Shot primary-hit must not enable crit eligibility");
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
                    "(?i)cast.?time|knockback|airborne|stun|reveal|secondary|"
                        + "terrain|geometry|displacement|immunity|"
                        + "turret.?aggro|explosive.?charge|post.?cast|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "\\brepeat\\b|projectile|missile|channel")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded cast-time/knockback/stun/reveal/secondary/"
                + "terrain/geometry/displacement/Explosive Charge surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_tristana_[pqwe]_|'ability_hero_tristana_[pqwe]_|"
                        + "'provider_hero_tristana_basic_|'ability_hero_tristana_basic_")
                .matcher(sqlNoComments)
                .find(),
            "must not create P/Q/W/E/basic graph rows");
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
            sql.contains("cast time") || sql.contains("cast_time"),
            "seed comments must document exclusion of cast time");
        assertTrue(
            sql.contains("knockback") || sql.contains("airborne") || sql.contains("stun"),
            "seed comments must document exclusion of knockback/airborne/stun");
        assertTrue(
            sql.contains("reveal") || sql.contains("secondary") || sql.contains("turret"),
            "seed comments must document exclusion of reveal/secondary/turret");
        assertTrue(
            sql.contains("terrain") || sql.contains("geometry") || sql.contains("displacement")
                || sql.contains("immunity"),
            "seed comments must document exclusion of terrain/geometry/displacement/immunity");
        assertTrue(
            sql.contains("unit-target") || sql.contains("cancel") || sql.contains("post-cast")
                || sql.contains("basic attack"),
            "seed comments must document exclusion of unit-target cancel / post-cast basic attack");
        assertTrue(
            sql.contains("Explosive Charge"),
            "seed comments must document exclusion of Explosive Charge");
        assertTrue(
            sql.contains("One selected-target") || sql.contains("one selected-target")
                || sql.contains("not full R") || sql.contains("不是 full R"),
            "seed must state one selected-target magic hit, not full R");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesBonusAdApExclusionsStandaloneAndNoMaterializer() {
        assertTrue(
            readme.contains("lol_generic_tristana_buster_shot_primary_hit_seed.sql"),
            "README must list the Tristana R Buster Shot primary-hit seed");
        assertTrue(
            readme.contains("LolGenericTristanaBusterShotPrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)tristana.*buster|毁灭射击|Buster Shot")
                .matcher(readme)
                .find(),
            "README must name Tristana Buster Shot");
        int seedIdx = readme.indexOf(
            "lol_generic_tristana_buster_shot_primary_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-tristana-buster-shot-primary-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("tristana-r-buster-shot-primary-hit-phase-a-v1"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("magic_325_plus_0_70_bonus_ad_plus_1_00_ap"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertTrue(
            section.contains("1308525") && section.contains("4008205")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("2385") && section.contains("2382"),
            "README must document canonical 2385 and local raw 2382 byte sizes");
        assertTrue(
            Pattern.compile("(?i)100.*mana|mana.?100|100 mana").matcher(section).find()
                && section.contains("100000"),
            "README must document mana100 and cooldown 100000ms");
        assertTrue(
            section.contains("325") && section.contains("0.70") && section.contains("1.00")
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
            "README must warn that no repository materializer exists for Tristana identity/panel/resource");
        assertTrue(
            section.contains("Explosive Charge")
                && (section.contains("不要求") || section.contains("不合成")
                    || section.contains("standalone") || section.contains("不创建")),
            "README must document no Explosive Charge / sibling synthesis");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|cast.?time|knockback|stun|reveal|secondary|"
                        + "terrain|geometry|displacement|Explosive Charge")
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
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_tristana`|"
                    + "ensure `hero_tristana` 最低必要实体|"
                    + "ensure `hero_tristana`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
        assertTrue(
            section.contains("baseAD0/resolvedAD0") || section.contains("final247.5")
                || section.contains("HP505") || section.contains("mana300")
                || section.contains("both495"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            section.contains("LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest")
                || section.contains("LolGenericLucianArdentBlazePrimaryHitSeedSqlTest")
                || section.contains("LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest")
                || section.contains("LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest"),
            "README static validation must cite adjacent check-only / mixed bonusAD+AP precedents");
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
            325,
            inner.path("args").get(0).path("value").asDouble(),
            0.0001,
            "inner add left must be const 325");
        JsonNode mulBonus = inner.path("args").get(1);
        assertEquals("mul", mulBonus.path("op").asText(), "inner right must be mul");
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
        assertBinaryArithmeticComparisonArity(root, "buster_shot_primary_hit_damage");
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
