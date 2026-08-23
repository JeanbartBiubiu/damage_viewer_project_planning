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
 * Static contract for {@code lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_caitlyn",
        "provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum",
        "ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum",
        "ace_in_the_hole_single_bullet_quantum",
        "phase_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact",
        "sequence_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact",
        "step_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_damage",
        "cooldown_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum",
        "ace_in_the_hole_single_bullet_quantum_damage",
        "r_mana_cost",
        "r_cooldown_ms");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "game_entities",
        "entity_attribute_values"
    );

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_physical_damage",
        "bonus_ad_ratio",
        "immediate_impact_scaffold");

    private static final String ACE_IN_THE_HOLE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":650},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.00},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank3_selected_primary_champion_single_physical_bullet_quantum; "
            + "immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; "
            + "no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_"
            + "homing_projectile_travel_interception_first_enemy_geometry_crit_"
            + "scaling_untargetable_resurrection_target_death_corpse_hit_sight_"
            + "radius_unit_target_cancel_conditions_ability_lockout_other_ranks_"
            + "or_full_fidelity";

    private static final String CANONICAL_SHA =
        "08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8";

    private static final String LOCAL_RAW_SHA =
        "015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003";

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
        assertContains("hero_skill|hero_caitlyn|R|让子弹飞");
        assertContains("wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum");
        assertContains("caitlyn-r-ace-in-the-hole-single-bullet-quantum-phase-a-v1");
        assertContains("Template:Data Caitlyn/R");
        assertContains("Template:Data Caitlyn/Ace in the Hole");
        assertContains("1306918");
        assertContains("3982561");
        assertContains("2026-01-09T09:02:59Z");
        assertContains("3119");
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
        assertContains("normalized/generic/caitlyn-r.json");
        assertContains(FROZEN_BOUNDARY);
        for (String tag : ORDERED_TAGS) {
            assertContains(tag);
        }
        int orderedTagsIdx = sql.indexOf("Ordered tags");
        assertTrue(orderedTagsIdx >= 0, "seed must declare Ordered tags");
        String orderedBlock = sql.substring(orderedTagsIdx, Math.min(sql.length(), orderedTagsIdx + 400));
        assertTrue(
            orderedBlock.indexOf("ability_cost_cooldown") >= 0
                && orderedBlock.indexOf("ability_cost_cooldown")
                    < orderedBlock.indexOf("active_physical_damage")
                && orderedBlock.indexOf("active_physical_damage")
                    < orderedBlock.indexOf("bonus_ad_ratio")
                && orderedBlock.indexOf("bonus_ad_ratio")
                    < orderedBlock.indexOf("immediate_impact_scaffold"),
            "ordered tags must appear in declared order within Ordered tags block");
        assertFalse(
            Pattern.compile("(?im)^\\s*[-*]?\\s*\\d+\\.\\s*crit\\b|"
                    + "(?i)ordered tags[\\s\\S]{0,500}\\bcrit[_\\s-]?")
                .matcher(sql)
                .find(),
            "must not add a crit ordered tag");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("650 + 100% bonus AD")
                    || sql.contains("650 + 1.00")
                    || sql.contains("physical 650")),
            "seed comments must document rank3 physical 650 +100% bonus AD");
        assertTrue(
            (sql.contains("bonus AD") || sql.contains("bonus_ad"))
                && sql.contains("source.attr.ad.resolved")
                && sql.contains("source.attr.ad.base"),
            "seed must document bonus-AD sub(resolved, base)");
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
            sql.contains("base0/resolved0/A0=650")
                || (sql.contains("base0/resolved0") && sql.contains("650")),
            "seed comments must document base0/resolved0/A0=650");
        assertTrue(
            sql.contains("base60/resolved60/A0=650")
                || (sql.contains("base60/resolved60") && sql.contains("650")),
            "seed comments must document base60/resolved60/A0=650");
        assertTrue(
            sql.contains("base60/resolved160/A0=750")
                || (sql.contains("base60/resolved160") && sql.contains("750")),
            "seed comments must document base60/resolved160/A0=750");
        assertTrue(
            sql.contains("base60/resolved160/A100")
                && (sql.contains("raw750/final375") || (sql.contains("raw750") && sql.contains("final375"))),
            "seed comments must document base60/resolved160/A100 raw750/final375");
        assertTrue(
            sql.contains("base60/resolved260/A100")
                && (sql.contains("raw850/final425") || (sql.contains("raw850") && sql.contains("final425"))),
            "seed comments must document base60/resolved260/A100 raw850/final425");
        assertTrue(
            sql.contains("base0/resolved100")
                && sql.contains("base60/resolved160")
                && (sql.contains("both750") || sql.contains("both 750")),
            "seed must document base0/resolved100 vs base60/resolved160/A0 both750 bonus-AD proof");
        assertTrue(
            sql.contains("t0") && sql.contains("t89999") && sql.contains("t90000"),
            "seed comments must document cooldown timeline t0/t89999/t90000");
        assertTrue(
            (sql.contains("mana300") || sql.contains("mana300/"))
                && (sql.contains("mana100") || sql.contains("final mana100"))
                && (sql.contains("HP250") || sql.contains("HP1000")),
            "seed comments must document mana300→100 / HP1000→250 fixture");
        assertTrue(
            sql.contains("two R damage") || sql.contains("two R damage items")
                || (sql.contains("two") && sql.contains("R") && sql.contains("damage")),
            "seed comments must document two R damage items");
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
                || sql.contains("no P/Q/W/E"),
            "seed comments must document standalone provider / no sibling synthesis");
        assertTrue(
            (sql.contains("不要求 Caitlyn Q") || (sql.contains("不要求") && sql.contains("Q")))
                && (sql.contains("E publication") || sql.contains("Caitlyn Q 或 E")
                    || sql.contains("Q 或 E")),
            "seed comments must document that R does not require Caitlyn Q or E publication");
        assertTrue(
            (sql.contains("与既有") && (sql.contains("P/Q/W/E") || sql.contains("Piltover Peacemaker")
                || sql.contains("90 Caliber Net")))
                || sql.contains("coexist") || sql.contains("并存"),
            "seed comments must document coexistence / isolation from Caitlyn P/Q/W/E/basic");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim"),
            "seed must not claim full fidelity");
        assertTrue(
            sql.contains("Phase-A") && (sql.contains("quantum scaffold") || sql.contains("scaffold"))
                && (sql.contains("不是实际") || sql.contains("not actual")
                    || sql.contains("channel") || sql.contains("homing")
                    || sql.contains("One quantum")),
            "seed must clarify immediate one-bullet is Phase-A quantum scaffold not full R");
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
            "ace-in-the-hole single-bullet-quantum seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "ace-in-the-hole single-bullet-quantum seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "ace-in-the-hole single-bullet-quantum seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "ace-in-the-hole single-bullet-quantum seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "ace-in-the-hole single-bullet-quantum seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroCaitlynAdManaAndNoRepositoryMaterializer() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_caitlyn");
        assertContains("missing entity_attribute_values hero_caitlyn/ad");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed")
                || sql.contains("当前仓库无 materializer"),
            "seed must state that no current repository seed/materializer provides Caitlyn rows");
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
                        + "entity_id\\s*=\\s*'hero_caitlyn'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_caitlyn before graph writes");
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
            "must SELECT/EXISTS-check entity_attribute_values hero_caitlyn/ad");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_caitlyn with the Batch-B prerequisite phrase");
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
        assertContains("provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum");
        assertContains("hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Ace in the Hole single-bullet-quantum provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_caitlyn'\\s*,\\s*"
                        + "'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum'")
                .matcher(sql)
                .find(),
            "must mount Ace in the Hole single-bullet-quantum provider to hero_caitlyn");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Ace in the Hole single-bullet-quantum provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (R Ace in the Hole single-bullet-quantum only)");
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
                    "(?s)'ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum'\\s*,\\s*"
                        + "'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum'\\s*,\\s*"
                        + "'ace_in_the_hole_single_bullet_quantum'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "R must be active ability with stable key ace_in_the_hole_single_bullet_quantum");
        assertContains("{\"op\":\"const\",\"value\":100}");
        assertContains("{\"op\":\"const\",\"value\":90000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum'\\s*,\\s*"
                        + "'ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum'\\s*,\\s*"
                        + "'r_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "R cooldown must be 90000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact'\\s*,\\s*"
                        + "'ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_damage'\\s*,\\s*"
                        + "'sequence_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Ace in the Hole damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_damage'"),
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
                    "(?is)piltover_peacemaker|caliber_net|"
                        + "provider_hero_caitlyn_q_|ability_hero_caitlyn_q_|"
                        + "provider_hero_caitlyn_e_|ability_hero_caitlyn_e_")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate Caitlyn Q Piltover Peacemaker or E 90 Caliber Net rows");
    }

    @Test
    void parsesBinaryBonusAdPhysicalDamageFormula() throws IOException {
        assertContains(ACE_IN_THE_HOLE_DAMAGE);
        assertBinaryBonusAdDamageFormula(ACE_IN_THE_HOLE_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":650");
        assertContains("\"value\":1.00");
        assertContains("\"op\":\"sub\"");
        assertEquals(
            2,
            JSON.readTree(ACE_IN_THE_HOLE_DAMAGE).path("args").size(),
            "outer add must remain binary");
        assertEquals(
            "const",
            JSON.readTree(ACE_IN_THE_HOLE_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be const 650");
        assertEquals(
            "mul",
            JSON.readTree(ACE_IN_THE_HOLE_DAMAGE).path("args").get(1).path("op").asText(),
            "outer right child must be mul(1.00, bonus AD)");
        assertFalse(
            Pattern.compile("(?is)source\\.attr\\.ap\\.resolved")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not include AP scaling for Ace in the Hole Phase-A");
        assertFalse(
            Pattern.compile(
                    "(?is)\"op\"\\s*:\\s*\"read\"\\s*,\\s*\"path\"\\s*:\\s*"
                        + "\"source\\.attr\\.ad\\.resolved\"\\s*\\}")
                .matcher(sqlNoComments)
                .find()
                && !sqlNoComments.contains("\"op\":\"sub\""),
            "must not use a total-AD direct formula without bonus-AD sub");
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
                    "(?s)'step_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_damage'\\s*,\\s*"
                        + "'ace_in_the_hole_single_bullet_quantum_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Ace in the Hole damage must be physical 20220 add policy copyable_on_hit=false");
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
            "Ace in the Hole single-bullet-quantum must not enable crit eligibility");
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
                    "(?i)1s.?channel|channel.?lock|true.?sight|4s.?buff|"
                        + "mana.?refund|5s.?canceled|homing|interception|"
                        + "corpse|sight.?1500|untargetable|resurrection|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "\\brepeat\\b|projectile|missile")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded channel/reveal/cancel/refund/homing/"
                + "interception/corpse/sight/untargetable surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_caitlyn_[pqwe]_|'ability_hero_caitlyn_[pqwe]_|"
                        + "'provider_hero_caitlyn_basic_|'ability_hero_caitlyn_basic_")
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
            sql.contains("channel") || sql.contains("1s channel") || sql.contains("channel lock"),
            "seed comments must document exclusion of channel/locks");
        assertTrue(
            sql.contains("reveal") || sql.contains("true sight") || sql.contains("4s buff"),
            "seed comments must document exclusion of reveal/true sight/4s buff");
        assertTrue(
            sql.contains("cancel") || sql.contains("refund") || sql.contains("resurrection")
                || sql.contains("untargetable"),
            "seed comments must document exclusion of cancel/refund/resurrection/untargetable");
        assertTrue(
            sql.contains("homing") || sql.contains("travel") || sql.contains("interception")
                || sql.contains("geometry"),
            "seed comments must document exclusion of homing/travel/interception/geometry");
        assertTrue(
            sql.contains("crit") || sql.contains("0–30%") || sql.contains("0-30%"),
            "seed comments must document exclusion of crit chance scaling");
        assertTrue(
            sql.contains("corpse") || sql.contains("target death") || sql.contains("sight"),
            "seed comments must document exclusion of corpse/death/sight");
        assertTrue(
            sql.contains("lockout") || sql.contains("unit-target") || sql.contains("cancel conditions"),
            "seed comments must document exclusion of unit-target cancel / ability lockout");
        assertTrue(
            sql.contains("One quantum") || sql.contains("one quantum")
                || sql.contains("not full R") || sql.contains("不是 full R"),
            "seed must state one quantum, not full R");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesBonusAdExclusionsQeCoexistenceAndNoMaterializer() {
        assertTrue(
            readme.contains("lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql"),
            "README must list the Caitlyn R Ace in the Hole single-bullet-quantum seed");
        assertTrue(
            readme.contains("LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)caitlyn.*ace|让子弹飞|Ace in the Hole")
                .matcher(readme)
                .find(),
            "README must name Caitlyn Ace in the Hole");
        int seedIdx = readme.indexOf(
            "lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum"),
            "README entry must name the task key");
        assertTrue(
            section.contains("caitlyn-r-ace-in-the-hole-single-bullet-quantum-phase-a-v1"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("physical_650_plus_1_00_bonus_ad"),
            "README must include frozen boundary");
        for (String tag : ORDERED_TAGS) {
            String expectedTag = "ability_cost_cooldown".equals(tag)
                ? "ability_cooldown"
                : tag;
            assertTrue(section.contains(expectedTag), "README ordered tags must include " + expectedTag);
        }
        assertFalse(
            Pattern.compile("(?i)ordered tags[\\s\\S]{0,300}\\bcrit\\b").matcher(section).find(),
            "README ordered tags must not include crit");
        assertTrue(
            section.contains("1306918") && section.contains("3982561")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(section.contains("90000"), "README must document cooldown 90000ms");
        assertTrue(
            section.contains("650") && section.contains("1.00")
                && (section.contains("bonus AD") || section.contains("ad.resolved-ad.base")
                    || (section.contains("ad.resolved") && section.contains("ad.base"))),
            "README must document damage formula with bonus AD wording");
        assertTrue(
            section.contains("single-bullet") || section.contains("bullet quantum")
                || section.contains("single_bullet_quantum") || section.contains("单发"),
            "README must make the single-quantum claim");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("无 seed") || section.contains("无 materializer")
                || section.contains("没有任何 seed") || section.contains("不负责物化")
                || section.contains("亦无 seed 负责物化"),
            "README must warn that no repository materializer exists for Caitlyn identity/panel/resource");
        assertTrue(
            (section.contains("不要求") && section.contains("Q"))
                && (section.contains("E") || section.contains("不要求 Caitlyn Q 或 E")),
            "README must state R does not require Caitlyn Q or E publication");
        assertTrue(
            section.contains("Piltover Peacemaker") || section.contains("caitlyn_piltover")
                || section.contains("90 Caliber Net") || section.contains("caitlyn_90")
                || ((section.contains("并存") || section.contains("隔离"))
                    && (section.contains("Q") || section.contains("E"))),
            "README must document coexistence/isolation with Caitlyn Q/E");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|channel|reveal|homing|interception|crit|"
                        + "corpse|lockout|refund")
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
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_caitlyn`|"
                    + "ensure `hero_caitlyn` 最低必要实体|"
                    + "ensure `hero_caitlyn`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
        assertTrue(
            section.contains("base0/resolved0") || section.contains("final375")
                || section.contains("HP250") || section.contains("mana300")
                || section.contains("both750"),
            "README must document deterministic runtime fixtures");
        // Caitlyn Q/E documentation must remain intact and not be overwritten by this R section.
        assertTrue(
            readme.contains("lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql")
                && readme.contains("LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest")
                && readme.contains("hero_skill|hero_caitlyn|Q|和平使者"),
            "README must preserve existing Caitlyn Q documentation");
        assertTrue(
            readme.contains("lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql")
                && readme.contains("LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest")
                && readme.contains("hero_skill|hero_caitlyn|E|90口径绳网"),
            "README must preserve existing Caitlyn E documentation");
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

    private static void assertBinaryBonusAdDamageFormula(String damageJson) throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        assertEquals(
            650,
            root.path("args").get(0).path("value").asDouble(),
            0.0001,
            "left must be const 650");
        JsonNode mul = root.path("args").get(1);
        assertEquals("mul", mul.path("op").asText(), "right must be mul");
        assertEquals(2, mul.path("args").size(), "mul must be binary");
        assertEquals(
            1.00,
            mul.path("args").get(0).path("value").asDouble(),
            0.0001,
            "mul left must be const 1.00");
        JsonNode sub = mul.path("args").get(1);
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
        assertBinaryArithmeticComparisonArity(root, "ace_in_the_hole_single_bullet_quantum_damage");
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
