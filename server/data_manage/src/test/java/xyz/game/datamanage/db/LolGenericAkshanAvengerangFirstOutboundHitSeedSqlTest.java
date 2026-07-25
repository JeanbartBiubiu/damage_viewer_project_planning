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
 * Static contract for {@code lol_generic_akshan_avengerang_first_outbound_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_akshan_avengerang_first_outbound_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_akshan",
        "provider_hero_akshan_q_avengerang_first_outbound_hit",
        "ability_hero_akshan_q_avengerang_first_outbound_hit",
        "avengerang_first_outbound_hit",
        "phase_hero_akshan_q_avengerang_first_outbound_hit_impact",
        "sequence_hero_akshan_q_avengerang_first_outbound_hit_impact",
        "step_hero_akshan_q_avengerang_first_outbound_hit_damage",
        "cost_hero_akshan_q_avengerang_first_outbound_hit_mana",
        "cooldown_hero_akshan_q_avengerang_first_outbound_hit",
        "avengerang_first_outbound_hit_damage",
        "q_mana_cost",
        "q_cooldown_ms",
        "hero_akshan_q_avengerang_first_outbound_hit");

    private static final List<String> PRESERVED_PROVIDER_IDS = List.of(
        "provider_hero_akshan_basic_attack");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad", "mana");

    private static final List<String> FORBIDDEN_SHARED_WRITE_TABLES = List.of(
        "attribute_definitions",
        "game_entities",
        "entity_attribute_values");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_physical_damage",
        "bonus_ad_ratio",
        "immediate_impact_scaffold");

    private static final String FIRST_OUTBOUND_HIT_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":165},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.70},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; "
            + "immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; "
            + "no_direction_range_extension_return_pass_homing_projectile_travel_"
            + "cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_"
            + "damage_spellshield_other_ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b";

    private static final String NORMALIZED_SHA =
        "f6b0dd492d80c49a2259d366230f7d8f4c6d43a70688b42d0d0780e4866d9a1a";

    private static final String PAGES_SHA =
        "11d2da87557737fed487fb106a9ffb7b4a6d7f1d32391ce3a5c142f9128509e0";

    private static final String LOCAL_RAW_SHA =
        "407e4671cc05e87edcd0038a9efe614ad98f65cd57ce339c2c9d69afe5b8c973";

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
        assertContains("hero_skill|hero_akshan|Q|去而复还");
        assertContains("wasm-generic-akshan-avengerang-first-outbound-hit");
        assertContains("akshan-q-avengerang-first-outbound-hit-phase-a-v2");
        assertContains("Template:Data Akshan/Q");
        assertContains("Template:Data Akshan/Avengerang");
        assertContains("1502462");
        assertContains("4007510");
        assertContains("2026-04-11T22:35:01Z");
        assertContains("2570");
        assertContains(CANONICAL_SHA);
        assertContains("2948");
        assertContains(NORMALIZED_SHA);
        assertContains("688");
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
        assertContains("normalized/generic/akshan-q.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("165 + 70% bonus AD")
                    || sql.contains("165 + 0.70")
                    || sql.contains("physical 165")),
            "seed comments must document rank5 physical 165 +70% bonus AD");
        assertTrue(
            (sql.contains("bonus AD") || sql.contains("bonus_ad") || sql.contains("bonusAD"))
                && sql.contains("source.attr.ad.resolved")
                && sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD sub(resolved, base)");
        assertTrue(
            sql.contains("嵌套二元") || sql.contains("nested binary")
                || sql.contains("每个算术节点恰好二元"),
            "seed must document nested-binary arithmetic");
        assertTrue(
            sql.contains("cooldown start after return")
                || sql.contains("Starts after the boomerang returns")
                || sql.contains("CD-start-after-return")
                || sql.contains("cooldown-start-after-return"),
            "seed must document real Wiki CD-start-after-return as excluded");
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
        assertTrue(
            sql.contains("20220") && sql.contains("20170"),
            "seed must document explicit 20220 physical and 20170 add policy prerequisites");
        assertTrue(
            sql.contains("material-change-only") || sql.contains("仅业务数据实际插入/变化时推进"),
            "seed must document newest material-change-only revision shape");
    }

    @Test
    void documentsDeterministicFixturesWithoutClaimingFullFidelity() {
        assertTrue(
            sql.contains("base0/resolved0/armor0")
                && (sql.contains("raw/final165") || sql.contains("final165")),
            "seed comments must document base0/resolved0/armor0 raw/final165");
        assertTrue(
            sql.contains("base52/resolved52/armor0")
                && (sql.contains("raw/final165") || sql.contains("final165")),
            "seed comments must document base52/resolved52/armor0 raw/final165");
        assertTrue(
            sql.contains("base52/resolved152/armor0")
                && (sql.contains("raw/final235") || sql.contains("final235")),
            "seed comments must document base52/resolved152/armor0 raw/final235");
        assertTrue(
            (sql.contains("same armor100") || sql.contains("armor100 raw235"))
                && (sql.contains("raw235/final117.5")
                    || (sql.contains("raw235") && sql.contains("final117.5"))),
            "seed comments must document armor100 raw235/final117.5");
        assertTrue(
            sql.contains("base52/resolved252/armor100")
                && (sql.contains("raw305/final152.5")
                    || (sql.contains("raw305") && sql.contains("final152.5"))),
            "seed comments must document base52/resolved252/armor100 raw305/final152.5");
        assertTrue(
            sql.contains("base0/resolved100")
                && sql.contains("base52/resolved152")
                && (sql.contains("both raw/final235") || sql.contains("both235")
                    || sql.contains("both raw/final235")),
            "seed must document bonusAD counterproof both 235");
        assertTrue(
            sql.contains("t0") && sql.contains("t4999") && sql.contains("t5000"),
            "seed comments must document cooldown timeline t0/t4999/t5000");
        assertTrue(
            (sql.contains("mana240") || sql.contains("mana240/"))
                && (sql.contains("mana80") || sql.contains("final mana80"))
                && (sql.contains("HP765") || sql.contains("HP1000")),
            "seed comments must document mana240→80 / HP1000→765 fixture");
        assertTrue(
            sql.contains("exactly two Q hits") || sql.contains("two Q hits")
                || (sql.contains("exactly two Q") && sql.contains("hit")),
            "seed comments must document exactly two Q hits");
        assertTrue(
            sql.contains("automatic starts") || sql.contains("automatic Q")
                || (sql.contains("automatic") && sql.contains("ability_started")),
            "seed comments must document automatic Q ability_started");
        assertTrue(
            sql.contains("readyAt5000"),
            "seed comments must document readyAt5000");
        assertTrue(
            sql.contains("mana79") && (sql.contains("resource skip") || sql.contains("unchanged")),
            "seed comments must document mana79 resource skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("standalone")
                || sql.contains("preserve provider_hero_akshan_basic_attack")
                || sql.contains("不要求"),
            "seed comments must document standalone provider / Dirty Fighting preservation");
        assertTrue(
            (sql.contains("Dirty Fighting") || sql.contains("dirty_fighting"))
                && (sql.contains("zero") || sql.contains("零") || sql.contains("contains zero")
                    || sql.contains("不含")),
            "seed comments must document zero Dirty Fighting stack graph in Q seed");
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
                    || sql.contains("not full Q") || sql.contains("One selected-primary")),
            "seed must clarify first-outbound-hit is Phase-A scaffold not full Q");
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
    void validatesFailClosedPrerequisitesHeroAdManaPanelAndDirtyFightingOwnership() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_akshan");
        assertContains("missing entity_attribute_values hero_akshan/ad");
        assertContains("missing entity_attribute_values hero_akshan/mana");
        assertContains("lol_generic_akshan_dirty_fighting_seed.sql");
        assertTrue(
            sql.contains("mana panel") || sql.contains("面板 EAV") || sql.contains("mana 面板"),
            "seed must document mana panel EAV as hard prerequisite");
        assertTrue(
            sql.contains("无") && (sql.contains("resource_definitions")
                    || sql.contains("entity_resource_values") || sql.contains("资源表")),
            "seed must document that Dirty Fighting seed owns no mana resource table rows");
        assertTrue(
            sql.contains("Frozen option A") || sql.contains("option A")
                || sql.contains("仅缺席时"),
            "seed must document Frozen option A absent-only mana ensure");
        assertContains("INSERT INTO public.types");
        assertEquals(2, REQUIRED_ATTRS.size(), "contract expects exactly ad+mana attr defs");
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
            "attr preflight array must list exactly ad and mana");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            REQUIRED_RESERVED.contains(20220) && REQUIRED_RESERVED.contains(20170),
            "required reserved list must include 20220 and 20170");
        assertFalse(
            REQUIRED_RESERVED.contains(20230),
            "required reserved list must not include provider_action/apply 20230");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_akshan'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_akshan before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_akshan/ad");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'mana'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_akshan/mana panel EAV");
        assertFalse(
            Pattern.compile(
                    "(?is)RAISE\\s+EXCEPTION[\\s\\S]{0,200}missing resource_definitions mana")
                .matcher(sqlNoComments)
                .find(),
            "must not fail-closed require pre-existing resource_definitions mana "
                + "(absent-only ensure instead)");
        assertFalse(
            Pattern.compile(
                    "(?is)RAISE\\s+EXCEPTION[\\s\\S]{0,240}"
                        + "missing entity_resource_values hero_akshan/mana")
                .matcher(sqlNoComments)
                .find(),
            "must not fail-closed require pre-existing entity_resource_values "
                + "(absent-only ensure instead)");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_akshan with the Batch-B prerequisite phrase");
    }

    @Test
    void insertsAbsentOnlyManaResourceWithoutOverwritePaths() {
        assertTrue(
            Pattern.compile("(?s)'mana'\\s*,\\s*'法力'\\s*,\\s*0\\s*,\\s*0")
                .matcher(sql)
                .find(),
            "must ensure resource_definitions.mana with neutral defaults");
        assertTrue(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.resource_definitions\\b[\\s\\S]{0,320}"
                        + "ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*resource_key\\s*\\)"
                        + "\\s*DO\\s+NOTHING")
                .matcher(sqlNoComments)
                .find(),
            "resource_definitions.mana must DO NOTHING on conflict");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.resource_definitions\\b[\\s\\S]{0,400}"
                        + "ON\\s+CONFLICT[\\s\\S]{0,120}DO\\s+UPDATE")
                .matcher(sqlNoComments)
                .find(),
            "resource_definitions insert must have no DO UPDATE path");
        assertTrue(
            Pattern.compile(
                    "(?is)SELECT\\s+eav\\.base_value\\s+INTO\\s+v_mana_attr[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'mana'")
                .matcher(sqlNoComments)
                .find(),
            "entity_resource_values must derive initial/max from existing Akshan mana attr");
        assertTrue(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_resource_values\\b[\\s\\S]{0,280}"
                        + "'hero_akshan'\\s*,\\s*'mana'\\s*,\\s*v_mana_attr\\s*,\\s*"
                        + "v_mana_attr[\\s\\S]{0,160}"
                        + "ON\\s+CONFLICT\\s*\\(\\s*game_id\\s*,\\s*entity_id\\s*,\\s*"
                        + "resource_key\\s*\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoComments)
                .find(),
            "entity_resource_values must insert derived mana via DO NOTHING");
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_resource_values\\b[\\s\\S]{0,400}"
                        + "ON\\s+CONFLICT[\\s\\S]{0,120}DO\\s+UPDATE")
                .matcher(sqlNoComments)
                .find(),
            "entity_resource_values insert must have no DO UPDATE path");
        assertFalse(
            Pattern.compile(
                    "(?is)'hero_akshan'\\s*,\\s*'mana'\\s*,\\s*350\\s*,\\s*350")
                .matcher(sqlNoComments)
                .find(),
            "must not hard-code mana350 into entity_resource_values");
        assertFalse(
            Pattern.compile("(?is)\\bUPDATE\\s+public\\.resource_definitions\\b")
                .matcher(sqlNoComments)
                .find(),
            "must never UPDATE resource_definitions");
        assertFalse(
            Pattern.compile("(?is)\\bUPDATE\\s+public\\.entity_resource_values\\b")
                .matcher(sqlNoComments)
                .find(),
            "must never UPDATE entity_resource_values");
        assertFalse(
            Pattern.compile(
                    "(?is)\\bDELETE\\s+FROM\\s+public\\.(resource_definitions|"
                        + "entity_resource_values)\\b")
                .matcher(sqlNoComments)
                .find(),
            "must never DELETE resource definition/value rows");
    }

    @Test
    void forbidsSharedIdentityAndPanelAttributeWrites() {
        for (String table : FORBIDDEN_SHARED_WRITE_TABLES) {
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
        assertContains("provider_hero_akshan_q_avengerang_first_outbound_hit");
        assertContains("hero_akshan_q_avengerang_first_outbound_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_akshan_q_avengerang_first_outbound_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Avengerang first outbound-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_akshan'\\s*,\\s*"
                        + "'provider_hero_akshan_q_avengerang_first_outbound_hit'")
                .matcher(sql)
                .find(),
            "must mount first outbound-hit provider to hero_akshan");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated first outbound-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q first outbound-hit only)");
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
                    "(?s)'ability_hero_akshan_q_avengerang_first_outbound_hit'\\s*,\\s*"
                        + "'provider_hero_akshan_q_avengerang_first_outbound_hit'\\s*,\\s*"
                        + "'avengerang_first_outbound_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key avengerang_first_outbound_hit");
        assertContains("{\"op\":\"const\",\"value\":80}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_akshan_q_avengerang_first_outbound_hit_mana'\\s*,\\s*"
                        + "'ability_hero_akshan_q_avengerang_first_outbound_hit'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'q_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 80 via ability_costs");
        assertContains("{\"op\":\"const\",\"value\":5000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_akshan_q_avengerang_first_outbound_hit'\\s*,\\s*"
                        + "'ability_hero_akshan_q_avengerang_first_outbound_hit'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 5000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_akshan_q_avengerang_first_outbound_hit_impact'\\s*,\\s*"
                        + "'ability_hero_akshan_q_avengerang_first_outbound_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_akshan_q_avengerang_first_outbound_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_akshan_q_avengerang_first_outbound_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_q_avengerang_first_outbound_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_akshan_q_avengerang_first_outbound_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "first outbound-hit damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_akshan_q_avengerang_first_outbound_hit_damage'"),
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
    }

    @Test
    void parsesBinaryBonusAdPhysicalDamageFormulaWithExactReadPaths() throws IOException {
        assertContains(FIRST_OUTBOUND_HIT_DAMAGE);
        assertBinaryBonusAdDamageFormula(FIRST_OUTBOUND_HIT_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":165");
        assertContains("\"value\":0.70");
        assertContains("\"op\":\"sub\"");
        assertEquals(
            2,
            JSON.readTree(FIRST_OUTBOUND_HIT_DAMAGE).path("args").size(),
            "outer add must remain binary");
        assertEquals(
            1,
            countReadPathOccurrences(
                JSON.readTree(FIRST_OUTBOUND_HIT_DAMAGE), "source.attr.ad.resolved"),
            "ad.resolved must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(
                JSON.readTree(FIRST_OUTBOUND_HIT_DAMAGE), "source.attr.ad.base"),
            "ad.base must appear exactly once");
        assertEquals(
            0,
            countReadPathOccurrences(
                JSON.readTree(FIRST_OUTBOUND_HIT_DAMAGE), "source.attr.ap.resolved"),
            "AP must not appear in first-outbound-hit damage formula");
        assertFalse(
            Pattern.compile("(?i)crit|source\\.attr\\.crit")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not read crit attributes");
    }

    @Test
    void seedsPhysicalDamageAddPolicyCopyableFalseAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_akshan_q_avengerang_first_outbound_hit_damage'\\s*,\\s*"
                        + "'avengerang_first_outbound_hit_damage'\\s*,\\s*"
                        + "20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "first outbound-hit damage must be physical 20220 add policy copyable_on_hit=false");
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
            "first outbound-hit must not enable crit eligibility");
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
            Pattern.compile("(?is)'dirty_fighting_stacks'|dirty_fighting_stacks")
                .matcher(sqlNoComments)
                .find(),
            "must not read/write Dirty Fighting stacks in executable SQL");
        assertFalse(
            Pattern.compile(
                    "(?is)'step_hero_akshan_dirty_fighting|"
                        + "'dirty_fighting_proc_damage'|"
                        + "'dirty_fighting_stacks_add'|"
                        + "'dirty_fighting_stacks_reset'|"
                        + "'ability_hero_akshan_basic_attack'")
                .matcher(sqlNoComments)
                .find(),
            "must not create/mutate Dirty Fighting / basic graph rows");
        assertFalse(
            Pattern.compile(
                    "(?i)\\bdirection\\b|\\brange\\b|extension|homing|projectile|travel|"
                        + "cooldown.?start.?after.?return|\\bsight\\b|reveal|"
                        + "movement.?speed|non.?champion|spellshield|"
                        + "basic_attack_hit|emit_event|equipment|loadout|\\brepeat\\b|"
                        + "missile|channel")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded direction/range/return/projectile/reveal surfaces");
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
            sql.contains("direction") || sql.contains("range") || sql.contains("extension"),
            "seed comments must document exclusion of direction/range/extension");
        assertTrue(
            sql.contains("return pass") || sql.contains("homing")
                || sql.contains("projectile travel") || sql.contains("return"),
            "seed comments must document exclusion of return/homing/projectile travel");
        assertTrue(
            sql.contains("cooldown start after return")
                || sql.contains("cooldown-start-after-return")
                || sql.contains("Starts after the boomerang returns"),
            "seed comments must document exclusion of CD-start-after-return");
        assertTrue(
            sql.contains("sight") || sql.contains("reveal") || sql.contains("movement speed"),
            "seed comments must document exclusion of sight/reveal/movement speed");
        assertTrue(
            sql.contains("spellshield") || sql.contains("non-champion")
                || sql.contains("nonchampion"),
            "seed comments must document exclusion of spellshield/non-champion damage");
        assertTrue(
            sql.contains("One selected-primary") || sql.contains("one selected-primary")
                || sql.contains("not full Q") || sql.contains("不是 full Q"),
            "seed must state one selected-primary first-outbound physical hit, not full Q");
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
    void preservesDirtyFightingAndBasicWithoutMutatingOrCopyingThem() {
        assertTrue(
            sql.contains("provider_hero_akshan_basic_attack"),
            "seed comments must name preserved basic/Dirty Fighting provider");
        assertTrue(
            sql.contains("Dirty Fighting") || sql.contains("dirty_fighting")
                || sql.contains("无所不用"),
            "seed comments must name Dirty Fighting for preservation evidence");
        assertTrue(
            sql.contains("lol_generic_akshan_dirty_fighting_seed.sql"),
            "seed comments must cite Dirty Fighting seed as prerequisite owner");
        assertTrue(
            (sql.contains("永不更新") || sql.contains("不更新") || sql.contains("without update")
                    || sql.contains("never update"))
                && (sql.contains("删除") || sql.contains("delete"))
                && (sql.contains("重建") || sql.contains("recreate")),
            "seed must preserve Dirty Fighting/basic without update/delete/recreate");
        assertFalse(
            Pattern.compile("(?is)'dirty_fighting_stacks'")
                .matcher(sqlNoComments)
                .find(),
            "must not read/write dirty_fighting_stacks in executable SQL");
        assertFalse(
            Pattern.compile(
                    "(?is)missing provider_hero_akshan_basic_attack")
                .matcher(sqlNoComments)
                .find(),
            "must not hard-require basic provider presence in executable SQL "
                + "(preserve without requiring)");
    }

    @Test
    void readmeEntryDocumentsImmediateDamageCdScaffoldExclusionsAndRegressionEvidence() {
        assertTrue(
            readme.contains("lol_generic_akshan_avengerang_first_outbound_hit_seed.sql"),
            "README must list the Akshan Q Avengerang first outbound-hit seed");
        assertTrue(
            readme.contains("LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)akshan.*avengerang|去而复还|Avengerang")
                .matcher(readme)
                .find(),
            "README must name Akshan Avengerang");
        int seedIdx = readme.indexOf(
            "lol_generic_akshan_avengerang_first_outbound_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-akshan-avengerang-first-outbound-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("akshan-q-avengerang-first-outbound-hit-phase-a-v2"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("physical_165_plus_0_70_bonus_ad"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertTrue(
            section.contains("1502462") && section.contains("4007510")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(NORMALIZED_SHA) && section.contains(PAGES_SHA)
                && section.contains(LOCAL_RAW_SHA),
            "README must document normalized/pages/local-raw SHAs");
        assertTrue(
            section.contains("2570") && section.contains("2948") && section.contains("688"),
            "README must document canonical/normalized/pages byte sizes");
        assertTrue(
            Pattern.compile("(?i)80.*mana|mana.?80|80 mana").matcher(section).find()
                && section.contains("5000"),
            "README must document mana80 and cooldown 5000ms");
        assertTrue(
            section.contains("165") && section.contains("0.70")
                && (section.contains("bonus AD") || section.contains("ad.resolved-ad.base")
                    || (section.contains("ad.resolved") && section.contains("ad.base"))),
            "README must document damage formula with bonus AD wording");
        assertTrue(
            (section.contains("immediate") || section.contains("立即"))
                && (section.contains("damage") || section.contains("伤害")
                    || section.contains("physical"))
                && (section.contains("cooldown") || section.contains("CD")
                    || section.contains("冷却"))
                && (section.contains("scaffold") || section.contains("脚手架")),
            "README must state immediate damage/CD scaffold");
        assertTrue(
            section.contains("cooldown start after return")
                || section.contains("cooldown-start-after-return")
                || section.contains("CD-start-after-return")
                || section.contains("Starts after the boomerang returns")
                || (section.contains("return") && section.contains("排除")),
            "README must state real CD-start-after-return is excluded / not fidelity");
        assertTrue(
            section.contains("not full Q") || section.contains("不是 full Q")
                || section.contains("one selected-primary")
                || section.contains("恰好一次") || section.contains("单次物理命中")
                || section.contains("首段出站"),
            "README must say exactly one outbound selected-primary hit / not full Q");
        assertTrue(
            section.contains("lol_generic_akshan_dirty_fighting_seed.sql")
                || section.contains("Dirty Fighting")
                || section.contains("provider_hero_akshan_basic_attack"),
            "README must document Dirty Fighting / basic preservation prerequisite");
        assertTrue(
            (section.contains("absent") || section.contains("仅缺席") || section.contains("DO NOTHING")
                    || section.contains("option A"))
                && (section.contains("resource_definitions")
                    || section.contains("entity_resource_values")
                    || section.contains("mana 资源")),
            "README must document absent-only mana resource ensure");
        assertTrue(
            Pattern.compile("(?i)不连 live|不执行.*live|no.?live|不连 live DB")
                .matcher(section)
                .find(),
            "README must make the no-live claim");
        assertTrue(
            (section.contains("hero-named") || section.contains("hero named")
                    || section.contains("同名英雄") || section.contains("英雄命名")
                    || section.contains("_test.go"))
                && (section.contains("Wasm") || section.contains("wasm")
                    || section.contains("_test.go"))
                && (section.contains("regression") || section.contains("回归")
                    || section.contains("证据"))
                && (section.contains("planned") || section.contains("计划")
                    || section.contains("rather than") || section.contains("而非")
                    || section.contains("不是生产") || section.contains("production branching")
                    || section.contains("生产分支")),
            "README must say hero _test.go planned as regression evidence only");
        assertTrue(
            Pattern.compile("(?i)不自动 publish|不会\\*\\*自动 publish|不负责 publish|no.*publish")
                .matcher(section)
                .find(),
            "README entry must not imply live execution or publication");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|direction|range|return|homing|projectile|"
                        + "spellshield|reveal|movement")
                .matcher(section)
                .find(),
            "README entry must state exclusions");
        assertTrue(
            section.contains("base0/resolved0") || section.contains("final117.5")
                || section.contains("HP765") || section.contains("mana240")
                || section.contains("both raw/final235") || section.contains("final235"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            section.contains("LolGenericAkshanDirtyFightingSeedSqlTest")
                || section.contains("LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest")
                || section.contains("LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest"),
            "README static validation must cite Dirty Fighting / Graves Q / Quinn Q precedents");
        assertFalse(
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_akshan`|"
                    + "ensure `hero_akshan` 最低必要实体|"
                    + "ensure `hero_akshan`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
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
     * Damage formula must use binary add(const, mul(const, sub(resolved, base))).
     */
    private static void assertBinaryBonusAdDamageFormula(String damageJson) throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        assertEquals(
            165,
            root.path("args").get(0).path("value").asDouble(),
            0.0001,
            "add left must be const 165");
        JsonNode mulBonus = root.path("args").get(1);
        assertEquals("mul", mulBonus.path("op").asText(), "add right must be mul");
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
        assertBinaryArithmeticComparisonArity(
            root, "avengerang_first_outbound_hit_damage");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ad.resolved")
                && nodeContainsReadPath(root, "source.attr.ad.base"),
            "bonus AD must be sub(resolved, base) under binary AST");
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
