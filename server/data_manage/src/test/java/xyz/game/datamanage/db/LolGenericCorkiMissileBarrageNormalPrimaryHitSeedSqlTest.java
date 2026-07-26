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
 * Static contract for {@code lol_generic_corki_missile_barrage_normal_primary_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericCorkiMissileBarrageNormalPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_corki_missile_barrage_normal_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_corki",
        "provider_hero_corki_r_missile_barrage_normal_primary_hit",
        "ability_hero_corki_r_missile_barrage_normal_primary_hit",
        "missile_barrage_normal_primary_hit",
        "phase_hero_corki_r_missile_barrage_normal_primary_hit_impact",
        "sequence_hero_corki_r_missile_barrage_normal_primary_hit_impact",
        "step_hero_corki_r_missile_barrage_normal_primary_hit_ammo",
        "step_hero_corki_r_missile_barrage_normal_primary_hit_damage",
        "cost_hero_corki_r_missile_barrage_normal_primary_hit_mana",
        "cooldown_hero_corki_r_missile_barrage_normal_primary_hit",
        "missile_barrage_normal_primary_hit_damage",
        "missile_barrage_cast_condition",
        "missile_barrage_ammo_delta",
        "r_mana_cost",
        "r_cooldown_ms",
        "missile_barrage_ammo",
        "hero_corki_r_missile_barrage_normal_primary_hit");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20112, 20120, 20130, 20142, 20150, 20152, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad");

    private static final List<String> FORBIDDEN_IDENTITY_PANEL_TABLES = List.of(
        "attribute_definitions",
        "game_entities",
        "entity_attribute_values");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "ammo_gate_and_spend",
        "active_physical_damage",
        "bonus_ad_ratio",
        "immediate_impact_scaffold");

    private static final String CAST_CONDITION =
        "{\"op\":\"gte\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.resource.missile_barrage_ammo.current\"},"
            + "{\"op\":\"const\",\"value\":1}]}";

    private static final String AMMO_DELTA = "{\"op\":\"const\",\"value\":-1}";

    private static final String DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":250},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.85},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank3_normal_missile_selected_primary_champion_first_enemy_hit; "
            + "immediate_impact_scaffold; physical_250_plus_0_85_bonus_ad; "
            + "mana35_plus_one_missile_barrage_ammo_atomic_gate_and_spend; "
            + "initial_ammo_two_max_four; cooldown2000ms; "
            + "no_direction_projectile_travel_collision_explosion_aoe_multitarget_"
            + "big_one_third_shot_cycle_double_damage_range_radius_periodic_stock_"
            + "recharge_respawn_refill_basic_attack_on_hit_recharge_reduction_crit_"
            + "scaling_malignance_eclipse_interaction_other_ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "1c2da7a1ea6bd4904c498eeb823e75dbf0f1e354cf5fe22f72dee2bb09ac4845";

    private static final String NORMALIZED_SHA =
        "dcaa1352eba2fa1d6c2acfc1aba9320bccb200b5b9d00dba559373e0981adbe0";

    private static final String PAGES_SHA =
        "694cda4c4d4ee4e9606ac1ca82a7085f89b7898884b23653bf718e86bfcd5bc7";

    private static final String LOCAL_RAW_SHA =
        "3764aafcecd5ef76f619472e443869c2ef43fd5b062894f6e111172f9a5cf91a";

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
    void documentsSourceIdentityLocalCaveatBoundaryTagsAndBonusAdWording() {
        assertContains("hero_skill|hero_corki|R|火箭轰击");
        assertContains("wasm-generic-corki-missile-barrage-normal-primary-hit");
        assertContains("corki-r-missile-barrage-normal-primary-hit-phase-a-v1");
        assertContains("Template:Data Corki/R");
        assertContains("Template:Data Corki/Missile Barrage");
        assertContains("1306946");
        assertContains("4042863");
        assertContains("2026-07-14T19:35:26Z");
        assertContains("3065");
        assertContains(CANONICAL_SHA);
        assertContains("3265");
        assertContains(NORMALIZED_SHA);
        assertContains("691");
        assertContains(PAGES_SHA);
        assertContains("3063");
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
        assertContains("normalized/generic/corki-r.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("250 + 85% bonus AD")
                    || sql.contains("250 + 0.85")
                    || sql.contains("physical 250")),
            "seed comments must document rank3 physical 250 +85% bonus AD");
        assertTrue(
            (sql.contains("bonus AD") || sql.contains("bonus_ad"))
                && sql.contains("source.attr.ad.resolved")
                && sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD sub(resolved, base)");
        assertTrue(
            sql.contains("嵌套二元") || sql.contains("nested binary")
                || sql.contains("每个算术节点恰好二元"),
            "seed must document nested-binary arithmetic");
        assertTrue(
            sql.contains("不得直接读 total AD") || sql.contains("不得省略 ad.base")
                || (sql.contains("must not") && sql.contains("total AD")),
            "seed must forbid total-AD direct as bonus ratio");
        assertTrue(
            sql.contains("不要求 AP") || sql.contains("AP is not required")
                || sql.contains("不要求AP"),
            "seed must document AP is not required");
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
            sql.contains("base60/resolved60/armor0")
                && (sql.contains("raw/final250") || sql.contains("final250")),
            "seed comments must document base60/resolved60/armor0 raw/final250");
        assertTrue(
            sql.contains("base60/resolved160/armor0") && sql.contains("335"),
            "seed comments must document base60/resolved160/armor0 => 335");
        assertTrue(
            (sql.contains("bonusAD counterproof") || sql.contains("counterproof"))
                && sql.contains("base0/resolved100")
                && sql.contains("base60/resolved160")
                && (sql.contains("both335") || sql.contains("both 335")),
            "seed must document bonusAD counterproof both335");
        assertTrue(
            sql.contains("t0") && sql.contains("t1999") && sql.contains("t2000"),
            "seed comments must document cooldown timeline t0/t1999/t2000");
        assertTrue(
            (sql.contains("Mana240") || sql.contains("mana240"))
                && (sql.contains("Ammo2") || sql.contains("ammo2"))
                && (sql.contains("readyAt2000") || sql.contains("readyAt 2000")),
            "seed comments must document Mana240/Ammo2 / readyAt2000 fixture");
        assertTrue(
            sql.contains("two R hits") || (sql.contains("two R") && sql.contains("hits")),
            "seed comments must document two R hits");
        assertTrue(
            sql.contains("automatic starts") || (sql.contains("automatic") && sql.contains("starts"))
                || (sql.contains("two") && sql.contains("ability_started")),
            "seed comments must document automatic starts / ability_started");
        assertTrue(
            (sql.contains("Mana34") || sql.contains("mana34") || sql.contains("Ammo0"))
                && (sql.contains("skips") || sql.contains("unchanged") || sql.contains("cast_condition")),
            "seed comments must document Mana34/Ammo0 skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("standalone")
                || sql.contains("preserve existing")
                || sql.contains("不要求"),
            "seed comments must document standalone provider / no sibling synthesis");
        assertTrue(
            sql.contains("Corki Q") || sql.contains("phosphorus") || sql.contains("Phosphorus"),
            "seed must document coexistence with Corki Q");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim")
                || sql.contains("not full R"),
            "seed must not claim full fidelity");
        assertTrue(
            sql.contains("not full R") || sql.contains("不是 full R") || sql.contains("One normal-missile"),
            "seed must state one normal-missile primary hit, not full R");
        assertFalse(
            Pattern.compile("(?i)periodic.?stock.?recharge|respawn.?refill|Big One|"
                    + "third.?shot|full.?fidelity.?R")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not claim recharge/refill/Big One/third-shot");
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
            "missile barrage normal primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "missile barrage normal primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "missile barrage normal primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "missile barrage normal primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "missile barrage normal primary-hit seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroCorkiAdManaVersusOwnedAmmoRows() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_corki");
        assertContains("missing entity_attribute_values hero_corki/ad");
        assertContains("missing resource_definitions mana");
        assertContains("missing entity_resource_values hero_corki/mana");
        assertFalse(
            sql.contains("missing entity_attribute_values hero_corki/ap")
                || Pattern.compile("(?is)attr_key\\s*=\\s*'ap'").matcher(sqlNoComments).find(),
            "AP must not be a check-only prerequisite for this R seed");
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
        assertEquals(1, REQUIRED_ATTRS.size(), "contract expects exactly ad attr def");
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
            1,
            countOccurrences(attrsBlock, "'") / 2,
            "attr preflight array must list exactly ad");
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
            "must SELECT/EXISTS-check entity_resource_values hero_corki/mana");
        assertTrue(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.resource_definitions\\b[\\s\\S]{0,400}"
                        + "'missile_barrage_ammo'[\\s\\S]{0,200}2[\\s\\S]{0,40}4")
                .matcher(sqlNoComments)
                .find(),
            "seed must own resource_definitions missile_barrage_ammo default 2/4");
        assertTrue(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_resource_values\\b[\\s\\S]{0,400}"
                        + "'hero_corki'[\\s\\S]{0,80}'missile_barrage_ammo'[\\s\\S]{0,80}2"
                        + "[\\s\\S]{0,40}4")
                .matcher(sqlNoComments)
                .find(),
            "seed must own entity_resource_values hero_corki/missile_barrage_ammo 2/4");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.resource_definitions"),
            "must write exactly one resource_definitions INSERT (ammo only)");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_resource_values"),
            "must write exactly one entity_resource_values INSERT (ammo only)");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.resource_definitions\\b[\\s\\S]{0,300}"
                        + "'mana'")
                .matcher(sqlNoComments)
                .find(),
            "must not INSERT/overwrite mana resource_definitions");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_resource_values\\b[\\s\\S]{0,300}"
                        + "'mana'")
                .matcher(sqlNoComments)
                .find(),
            "must not INSERT/overwrite mana entity_resource_values");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_corki with the Batch-B prerequisite phrase");
    }

    @Test
    void forbidsIdentityPanelAndUnownedResourceTableWrites() {
        for (String table : FORBIDDEN_IDENTITY_PANEL_TABLES) {
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
    void mountsIsolatedProviderAbilityCostCooldownCastConditionPhaseSequenceStepsAndMount() {
        assertContains("provider_hero_corki_r_missile_barrage_normal_primary_hit");
        assertContains("hero_corki_r_missile_barrage_normal_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_corki_r_missile_barrage_normal_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Missile Barrage normal primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_corki'\\s*,\\s*"
                        + "'provider_hero_corki_r_missile_barrage_normal_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Missile Barrage normal primary-hit provider to hero_corki");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Missile Barrage normal primary-hit provider");
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
            "must define exactly one ability cost (mana only; never a second ammo cost row)");
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
            2,
            countOccurrences(sqlNoComments, "INSERT INTO public.effect_steps"),
            "must define exactly two effect steps (ammo then damage)");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.resource_effect_details"),
            "must define exactly one resource_effect_details (first LoL seed using it)");
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
                    "(?s)'ability_hero_corki_r_missile_barrage_normal_primary_hit'\\s*,\\s*"
                        + "'provider_hero_corki_r_missile_barrage_normal_primary_hit'\\s*,\\s*"
                        + "'missile_barrage_normal_primary_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key missile_barrage_normal_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'missile_barrage_cast_condition'\\s*,\\s*'champion'")
                .matcher(sql)
                .find()
                || Pattern.compile(
                        "(?s)'missile_barrage_cast_condition'[\\s\\S]{0,40}'champion'")
                    .matcher(sql)
                    .find(),
            "ability must set cast_condition_formula_key and cast_origin champion");
        assertContains(CAST_CONDITION);
        assertContains("{\"op\":\"const\",\"value\":35}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_corki_r_missile_barrage_normal_primary_hit_mana'\\s*,\\s*"
                        + "'ability_hero_corki_r_missile_barrage_normal_primary_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'r_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "R mana cost must be ability-level 35 via ability_costs only");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.ability_costs\\b[\\s\\S]{0,400}"
                        + "missile_barrage_ammo")
                .matcher(sqlNoComments)
                .find(),
            "must never add a second ability_costs row for ammo");
        assertContains("{\"op\":\"const\",\"value\":2000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_corki_r_missile_barrage_normal_primary_hit'\\s*,\\s*"
                        + "'ability_hero_corki_r_missile_barrage_normal_primary_hit'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 2000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_corki_r_missile_barrage_normal_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_corki_r_missile_barrage_normal_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_corki_r_missile_barrage_normal_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_corki_r_missile_barrage_normal_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("不写显式") || sql.contains("不写") || sql.contains("no explicit")
                    || sql.contains("不添加")),
            "seed must document automatic ability_started without explicit event step");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_corki_[pqwe]_|'ability_hero_corki_[pqwe]_|"
                        + "'provider_hero_corki_basic_|'ability_hero_corki_basic_|"
                        + "phosphorus_bomb")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate P/Q/W/E/basic or Corki Q rows");
    }

    @Test
    void assertsResourceEffectStep0AndDamageStep1DetailContract() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_corki_r_missile_barrage_normal_primary_hit_ammo'\\s*,\\s*"
                        + "'sequence_hero_corki_r_missile_barrage_normal_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20152\\s*,\\s*20112\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "step0 must be resource_change 20152 to source 20112");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_corki_r_missile_barrage_normal_primary_hit_ammo'\\s*,\\s*"
                        + "'missile_barrage_ammo'\\s*,\\s*"
                        + "'missile_barrage_ammo_delta'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "resource_effect_details must bind missile_barrage_ammo / delta / add 20170");
        assertContains(AMMO_DELTA);
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_corki_r_missile_barrage_normal_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_corki_r_missile_barrage_normal_primary_hit_impact'\\s*,\\s*"
                        + "1\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "step1 must be damage 20150 to opponent 20111");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_corki_r_missile_barrage_normal_primary_hit_damage'\\s*,\\s*"
                        + "'missile_barrage_normal_primary_hit_damage'\\s*,\\s*"
                        + "20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "damage must be physical 20220 add policy copyable_on_hit=false");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_corki_r_missile_barrage_normal_primary_hit_ammo'"),
            "ammo step must appear in effect_steps and resource_effect_details only");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_corki_r_missile_barrage_normal_primary_hit_damage'"),
            "damage step must appear in effect_steps and damage_effect_details only");
        assertTrue(
            sql.contains("resource_effect_details")
                && (sql.contains("step0") || sql.contains("step 0") || sql.contains("Step0")
                    || sql.contains("step0：") || sql.contains("step0:")),
            "seed must document resource_effect step0 pairing");
    }

    @Test
    void parsesExactCastConditionAmmoDeltaAndBinaryBonusAdDamageFormulas() throws IOException {
        assertContains(CAST_CONDITION);
        assertContains(AMMO_DELTA);
        assertContains(DAMAGE);
        JsonNode cast = JSON.readTree(CAST_CONDITION);
        assertEquals("gte", cast.path("op").asText(), "cast condition must be gte");
        assertEquals(2, cast.path("args").size(), "gte must be binary");
        assertEquals(
            "source.resource.missile_barrage_ammo.current",
            cast.path("args").get(0).path("path").asText(),
            "cast condition must read ammo.current");
        assertEquals(1, cast.path("args").get(1).path("value").asInt(), "gate const must be 1");
        assertBinaryArithmeticComparisonArity(cast, "missile_barrage_cast_condition");
        JsonNode ammo = JSON.readTree(AMMO_DELTA);
        assertEquals("const", ammo.path("op").asText());
        assertEquals(-1, ammo.path("value").asInt(), "ammo delta must be const -1");
        assertBinaryNestedBonusAdDamageFormula(DAMAGE);
        assertEquals(
            1,
            countReadPathOccurrences(JSON.readTree(DAMAGE), "source.attr.ad.resolved"),
            "ad.resolved must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(JSON.readTree(DAMAGE), "source.attr.ad.base"),
            "ad.base must appear exactly once");
        assertFalse(
            Pattern.compile("(?i)source\\.attr\\.ap|\"ap\"|ap\\.resolved")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not read AP");
        assertFalse(
            Pattern.compile("(?i)crit|source\\.attr\\.crit")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not read crit attributes");
    }

    @Test
    void seedsPhysicalDamageAddPolicyAndZeroForbiddenSurfaces() {
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
        assertTrue(
            sql.contains("20230")
                && (sql.contains("forbid") || sql.contains("禁止") || sql.contains("不得")),
            "seed comments must explicitly forbid 20230");
        assertFalse(
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Missile Barrage normal primary-hit must not enable crit eligibility");
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
                    "(?i)projectile.?travel|collision|explosion.?aoe|\\baoe\\b|multitarget|"
                        + "big.?one|third.?shot|double.?damage|periodic.?stock|"
                        + "respawn.?refill|recharge.?reduction|malignance|eclipse|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "\\brepeat\\b|channel")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded projectile/AOE/Big One/recharge/refill surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_corki_[pqwe]_|'ability_hero_corki_[pqwe]_|"
                        + "'provider_hero_corki_basic_|'ability_hero_corki_basic_")
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
            sql.contains("direction") || sql.contains("projectile") || sql.contains("collision"),
            "seed comments must document exclusion of direction/projectile/collision");
        assertTrue(
            sql.contains("AOE") || sql.contains("aoe") || sql.contains("multitarget")
                || sql.contains("explosion"),
            "seed comments must document exclusion of explosion AOE/multitarget");
        assertTrue(
            sql.contains("Big One") || sql.contains("third-shot") || sql.contains("third shot"),
            "seed comments must document exclusion of Big One / third-shot");
        assertTrue(
            sql.contains("periodic") || sql.contains("recharge") || sql.contains("respawn")
                || sql.contains("refill"),
            "seed comments must document exclusion of periodic stock recharge/respawn refill");
        assertTrue(
            sql.contains("Malignance") || sql.contains("Eclipse") || sql.contains("malignance")
                || sql.contains("eclipse"),
            "seed comments must document exclusion of Malignance/Eclipse interaction");
    }

    @Test
    void rejectsAbilitySpecificTypeAndTypeRelationsForR() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.type_relations\\b")
                .matcher(sqlNoComments)
                .find(),
            "R must not write type_relations (no R ability-specific type)");
        assertFalse(
            Pattern.compile("(?is)\\b62\\d{3}\\b").matcher(sqlNoComments).find(),
            "executable SQL must not introduce game-local ability-specific 62xxx types");
        assertTrue(
            sql.contains("type_relations")
                && (sql.contains("不写") || sql.contains("不新增 R type") || sql.contains("no R type")
                    || sql.contains("无 ability-specific")),
            "seed comments must document no R type / no type_relations");
        assertTrue(
            sql.contains("无 R-specific type") || sql.contains("无 R-specific")
                || sql.contains("no R-specific type") || sql.contains("不得新增 R 专用"),
            "seed must document absence of R-specific type");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesAmmoOwnershipExclusionsAndSiblingQ() {
        assertTrue(
            readme.contains("lol_generic_corki_missile_barrage_normal_primary_hit_seed.sql"),
            "README must list the Corki R Missile Barrage normal primary-hit seed");
        assertTrue(
            readme.contains("LolGenericCorkiMissileBarrageNormalPrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)corki.*missile.?barrage|火箭轰击|Missile Barrage")
                .matcher(readme)
                .find(),
            "README must name Corki Missile Barrage");
        int seedIdx = readme.indexOf(
            "lol_generic_corki_missile_barrage_normal_primary_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-corki-missile-barrage-normal-primary-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("corki-r-missile-barrage-normal-primary-hit-phase-a-v1"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("physical_250_plus_0_85_bonus_ad"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertTrue(
            section.contains("1306946") && section.contains("4042863")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(NORMALIZED_SHA) && section.contains("3265"),
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
            section.contains("3065") && section.contains("3063"),
            "README must document canonical 3065 and local raw 3063 byte sizes");
        assertTrue(
            Pattern.compile("(?i)35.*mana|mana.?35|35 mana").matcher(section).find()
                && section.contains("2000"),
            "README must document mana35 and cooldown 2000ms");
        assertTrue(
            section.contains("missile_barrage_ammo")
                && (section.contains("initial") || section.contains("2"))
                && section.contains("4"),
            "README must document owned ammo resource 2/4");
        assertTrue(
            section.contains("resource_effect_details")
                && (section.contains("20152") || section.contains("resource_change")),
            "README must document first-use resource_effect_details / resource_change");
        assertTrue(
            section.contains("250") && section.contains("0.85")
                && (section.contains("bonus AD") || section.contains("ad.resolved-ad.base")
                    || (section.contains("ad.resolved") && section.contains("ad.base"))),
            "README must document damage formula with bonus AD wording");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only for identity/ad/mana");
        assertTrue(
            section.contains("仅") && section.contains("missile_barrage_ammo")
                || section.contains("owns only") || section.contains("仅拥有"),
            "README must state R owns only missile_barrage_ammo rows");
        assertTrue(
            section.contains("phosphorus") || section.contains("Phosphorus")
                || section.contains("Corki Q") || section.contains("磷光炸弹"),
            "README must note coexistence with Corki Q");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|direction|projectile|AOE|Big One|recharge|refill|"
                        + "third.?shot|Malignance|Eclipse")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertFalse(
            Pattern.compile("(?i)periodic stock recharge|respawn refill|full fidelity R|"
                    + "claims? full R")
                .matcher(section)
                .find()
                && !section.contains("no_")
                && !section.contains("不"),
            "README must not claim recharge/refill/full fidelity");
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
        assertTrue(
            section.contains("LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest")
                || section.contains("LolGenericDravenWhirlingDeathPrimaryOutboundHitSeedSqlTest"),
            "README static validation must cite Corki Q and/or Draven R physical precedents");
        // Q section remains truthful: check-only identity/ad/ap/mana; does not own ammo
        int qIdx = readme.indexOf("lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql");
        assertTrue(qIdx >= 0, "Corki Q README section must remain present");
        int qStart = readme.lastIndexOf("### ", qIdx);
        int qEnd = readme.indexOf("\n### ", qIdx);
        if (qEnd < 0) {
            qEnd = readme.length();
        }
        String qSection = readme.substring(qStart, qEnd);
        assertTrue(
            Pattern.compile("(?i)check-only|外部既有|external existing").matcher(qSection).find(),
            "Q README must remain check-only");
        assertTrue(
            qSection.contains("不物化") || qSection.contains("不写")
                || qSection.contains("不负责物化"),
            "Q README must still say it does not materialize Corki identity/ad/ap/mana");
        assertFalse(
            qSection.contains("missile_barrage_ammo")
                && (qSection.contains("INSERT") || qSection.contains("物化 missile")),
            "Q README must not claim ownership of missile_barrage_ammo");
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
        int lastTagIdx = block.indexOf(ORDERED_TAGS.get(ORDERED_TAGS.size() - 1));
        String positiveList = block.substring(
            0, lastTagIdx + ORDERED_TAGS.get(ORDERED_TAGS.size() - 1).length());
        assertFalse(
            Pattern.compile("(?i)(?<!no )(?<!不含 )(?<!亦不含 )\\bsalvage\\b")
                .matcher(positiveList)
                .find(),
            label + " ordered tags list must not include salvage as a positive tag");
        assertFalse(
            positiveList.contains("meta_or_non_target_dps"),
            label + " ordered tags list must not include meta_or_non_target_dps as a positive tag");
    }

    private static void assertBinaryNestedBonusAdDamageFormula(String damageJson)
            throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        assertEquals(
            250,
            root.path("args").get(0).path("value").asDouble(),
            0.0001,
            "left must be const 250");
        JsonNode mulBonus = root.path("args").get(1);
        assertEquals("mul", mulBonus.path("op").asText(), "right must be mul");
        assertEquals(2, mulBonus.path("args").size(), "mul must be binary");
        assertEquals(
            0.85,
            mulBonus.path("args").get(0).path("value").asDouble(),
            0.0001,
            "bonus AD mul left must be const 0.85");
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
        assertBinaryArithmeticComparisonArity(root, "missile_barrage_normal_primary_hit_damage");
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
