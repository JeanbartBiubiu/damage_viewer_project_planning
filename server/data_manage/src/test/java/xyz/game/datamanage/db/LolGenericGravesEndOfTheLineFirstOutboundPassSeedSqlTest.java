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
 * Static contract for {@code lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_graves",
        "provider_hero_graves_q_end_of_the_line_first_outbound_pass",
        "ability_hero_graves_q_end_of_the_line_first_outbound_pass",
        "end_of_the_line_first_outbound_pass",
        "phase_hero_graves_q_end_of_the_line_first_outbound_pass_impact",
        "sequence_hero_graves_q_end_of_the_line_first_outbound_pass_impact",
        "step_hero_graves_q_end_of_the_line_first_outbound_pass_damage",
        "cooldown_hero_graves_q_end_of_the_line_first_outbound_pass",
        "end_of_the_line_first_outbound_pass_damage",
        "q_mana_cost",
        "q_cooldown_ms",
        "hero_graves_q_end_of_the_line_first_outbound_pass");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20220, 20260);

    private static final List<String> REQUIRED_ATTRS = List.of("ad");

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

    private static final String FIRST_OUTBOUND_PASS_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":150},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.65},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.base\"}]}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; "
            + "immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; "
            + "no_cast_time_direction_range_width_line_geometry_projectile_travel_"
            + "pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_"
            + "detonation_perpendicular_area_reverse_wave_second_pass_total_damage_"
            + "once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_"
            + "or_full_fidelity";

    private static final String CANONICAL_SHA =
        "c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5";

    private static final String LOCAL_RAW_SHA =
        "cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377";

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
        assertContains("hero_skill|hero_graves|Q|穷途末路");
        assertContains("wasm-generic-graves-end-of-the-line-first-outbound-pass");
        assertContains("graves-q-end-of-the-line-first-outbound-pass-phase-a-v2");
        assertContains("Template:Data Graves/Q");
        assertContains("Template:Data Graves/End of the Line");
        assertContains("1307367");
        assertContains("4007501");
        assertContains("2026-04-11T22:23:57Z");
        assertContains("2266");
        assertContains("2265");
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
        assertContains("normalized/generic/graves-q.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("150 + 65% bonus AD")
                    || sql.contains("150 + 0.65")
                    || sql.contains("physical 150")),
            "seed comments must document rank5 physical 150 +65% bonus AD");
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
    void documentsDeterministicFixturesWithoutClaimingFullFidelity() {
        assertTrue(
            sql.contains("base0/resolved0/armor0")
                && (sql.contains("raw/final150") || sql.contains("final150")),
            "seed comments must document base0/resolved0/armor0 raw/final150");
        assertTrue(
            sql.contains("base60/resolved60/armor0")
                && (sql.contains("raw/final150") || sql.contains("final150")),
            "seed comments must document base60/resolved60/armor0 raw/final150");
        assertTrue(
            sql.contains("base60/resolved160/armor0")
                && (sql.contains("raw/final215") || sql.contains("final215")),
            "seed comments must document base60/resolved160/armor0 raw/final215");
        assertTrue(
            (sql.contains("same armor100") || sql.contains("armor100 raw215"))
                && (sql.contains("raw215/final107.5")
                    || (sql.contains("raw215") && sql.contains("final107.5"))),
            "seed comments must document armor100 raw215/final107.5");
        assertTrue(
            sql.contains("base60/resolved260/armor100")
                && (sql.contains("raw280/final140")
                    || (sql.contains("raw280") && sql.contains("final140"))),
            "seed comments must document base60/resolved260/armor100 raw280/final140");
        assertTrue(
            sql.contains("base0/resolved100")
                && sql.contains("base60/resolved160")
                && (sql.contains("both raw/final215") || sql.contains("both215")
                    || sql.contains("both raw/final215")),
            "seed must document bonusAD counterproof base0/resolved100 vs "
                + "base60/resolved160 both 215");
        assertTrue(
            sql.contains("t0") && sql.contains("t5999") && sql.contains("t6000"),
            "seed comments must document cooldown timeline t0/t5999/t6000");
        assertTrue(
            (sql.contains("mana240") || sql.contains("mana240/"))
                && (sql.contains("mana80") || sql.contains("final mana80"))
                && (sql.contains("HP785") || sql.contains("HP1000")),
            "seed comments must document mana240→80 / HP1000→785 fixture");
        assertTrue(
            sql.contains("exactly two Q hits") || sql.contains("two Q hits")
                || (sql.contains("exactly two Q") && sql.contains("hit")),
            "seed comments must document exactly two Q hits");
        assertTrue(
            sql.contains("automatic starts") || sql.contains("automatic Q")
                || (sql.contains("automatic") && sql.contains("ability_started")),
            "seed comments must document automatic Q ability_started");
        assertTrue(
            sql.contains("readyAt6000"),
            "seed comments must document readyAt6000");
        assertTrue(
            sql.contains("mana79") && (sql.contains("resource skip") || sql.contains("unchanged")),
            "seed comments must document mana79 resource skip");
        assertTrue(
            (sql.contains("Q/E isolation") || sql.contains("Q/E"))
                && (sql.contains("does not alter True Grit") || sql.contains("不 alter True Grit")
                    || sql.contains("不得改变 True Grit") || sql.contains("does not alter True Grit"))
                && (sql.contains("produces no Q damage") || sql.contains("no Q damage")
                    || sql.contains("不得造成 Q")),
            "seed comments must document Q/E isolation");
        assertTrue(
            sql.contains("Do not copy E") || sql.contains("不 copy E")
                || sql.contains("不得复制 E") || sql.contains("不复制 E into this seed")
                || sql.contains("Do not copy E into this seed"),
            "seed must forbid copying E into this seed");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("standalone")
                || sql.contains("preserve existing P/E/W/R")
                || sql.contains("不要求"),
            "seed comments must document standalone provider / sibling preservation");
        assertTrue(
            sql.contains("True Grit")
                && (sql.contains("不含") || sql.contains("不得") || sql.contains("no E True Grit")
                    || sql.contains("true_grit")),
            "seed comments must document no E True Grit rows/modifiers");
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
                    || sql.contains("not full Q") || sql.contains("One selected-target")),
            "seed must clarify first-outbound-pass hit is Phase-A scaffold not full Q");
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
            "first-outbound-pass seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "first-outbound-pass seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "first-outbound-pass seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "first-outbound-pass seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "first-outbound-pass seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroGravesAdManaAndNoIdentityMaterialization() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_graves");
        assertContains("missing entity_attribute_values hero_graves/ad");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized by this seed")
                || sql.contains("本脚本不物化"),
            "seed must state that this seed does not materialize Graves identity/panel/resource");
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
            sql.contains("ambient") || sql.contains("非硬前置") || sql.contains("不是硬前置")
                || sql.contains("不要求"),
            "seed must clarify sibling Graves seeds are ambient, not hard prerequisites");
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
                        + "entity_id\\s*=\\s*'hero_graves'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_graves before graph writes");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'ad'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_graves/ad");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_graves with the Batch-B prerequisite phrase");
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
        assertContains("provider_hero_graves_q_end_of_the_line_first_outbound_pass");
        assertContains("hero_graves_q_end_of_the_line_first_outbound_pass");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_graves_q_end_of_the_line_first_outbound_pass'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "End of the Line first outbound-pass provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_graves'\\s*,\\s*"
                        + "'provider_hero_graves_q_end_of_the_line_first_outbound_pass'")
                .matcher(sql)
                .find(),
            "must mount first outbound-pass provider to hero_graves");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated first outbound-pass provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q first outbound-pass only)");
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
                    "(?s)'ability_hero_graves_q_end_of_the_line_first_outbound_pass'\\s*,\\s*"
                        + "'provider_hero_graves_q_end_of_the_line_first_outbound_pass'\\s*,\\s*"
                        + "'end_of_the_line_first_outbound_pass'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key end_of_the_line_first_outbound_pass");
        assertContains("{\"op\":\"const\",\"value\":80}");
        assertContains("{\"op\":\"const\",\"value\":6000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_graves_q_end_of_the_line_first_outbound_pass'\\s*,\\s*"
                        + "'ability_hero_graves_q_end_of_the_line_first_outbound_pass'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 6000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_graves_q_end_of_the_line_first_outbound_pass_impact'\\s*,\\s*"
                        + "'ability_hero_graves_q_end_of_the_line_first_outbound_pass'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_graves_q_end_of_the_line_first_outbound_pass_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_graves_q_end_of_the_line_first_outbound_pass_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_graves_q_end_of_the_line_first_outbound_pass_damage'\\s*,\\s*"
                        + "'sequence_hero_graves_q_end_of_the_line_first_outbound_pass_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "first outbound-pass damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_graves_q_end_of_the_line_first_outbound_pass_damage'"),
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
                    "(?is)'provider_hero_graves_new_destiny'|"
                        + "'provider_hero_graves_quickdraw_max_stack'|"
                        + "'provider_hero_graves_w_smoke_screen_primary_hit'|"
                        + "'provider_hero_graves_r_collateral_damage_primary_hit'|"
                        + "'ability_hero_graves_basic_attack'|"
                        + "'ability_hero_graves_quickdraw'")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate P/E/W/R/basic graph rows");
    }

    @Test
    void parsesBinaryBonusAdPhysicalDamageFormulaWithExactReadPaths() throws IOException {
        assertContains(FIRST_OUTBOUND_PASS_DAMAGE);
        assertBinaryBonusAdDamageFormula(FIRST_OUTBOUND_PASS_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ad.base");
        assertContains("\"value\":150");
        assertContains("\"value\":0.65");
        assertContains("\"op\":\"sub\"");
        assertEquals(
            2,
            JSON.readTree(FIRST_OUTBOUND_PASS_DAMAGE).path("args").size(),
            "outer add must remain binary");
        assertEquals(
            1,
            countReadPathOccurrences(
                JSON.readTree(FIRST_OUTBOUND_PASS_DAMAGE), "source.attr.ad.resolved"),
            "ad.resolved must appear exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(
                JSON.readTree(FIRST_OUTBOUND_PASS_DAMAGE), "source.attr.ad.base"),
            "ad.base must appear exactly once");
        assertEquals(
            0,
            countReadPathOccurrences(
                JSON.readTree(FIRST_OUTBOUND_PASS_DAMAGE), "source.attr.ap.resolved"),
            "AP must not appear in first-outbound-pass damage formula");
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
                    "(?s)'step_hero_graves_q_end_of_the_line_first_outbound_pass_damage'\\s*,\\s*"
                        + "'end_of_the_line_first_outbound_pass_damage'\\s*,\\s*"
                        + "20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "first outbound-pass damage must be physical 20220 add policy copyable_on_hit=false");
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
            "first outbound-pass must not enable crit eligibility");
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
            Pattern.compile("(?is)'true_grit_stacks'|true_grit_stacks")
                .matcher(sqlNoComments)
                .find(),
            "must not read/write Quickdraw true_grit_stacks in executable SQL");
        assertFalse(
            Pattern.compile("(?is)'bonus_armor'|'bonus_magic_resist'")
                .matcher(sqlNoComments)
                .find(),
            "must not read/write bonus_armor / bonus_magic_resist in executable SQL");
        assertFalse(
            Pattern.compile(
                    "(?i)\\bcast.?time\\b|direction|range|width|line.?geometry|"
                        + "projectile|travel|pass.?through|multitarget|powder.?trail|"
                        + "detonation|perpendicular|reverse.?wave|second.?pass|"
                        + "once.?per.?pass|spellshield|wind.?wall|basic_attack_hit|"
                        + "emit_event|equipment|loadout|runes|\\brepeat\\b|missile|channel")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded cast-time/geometry/projectile/trail/detonation surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_graves_new_destiny'|"
                        + "'provider_hero_graves_quickdraw|"
                        + "'provider_hero_graves_w_smoke|"
                        + "'provider_hero_graves_r_collateral|"
                        + "'ability_hero_graves_basic_")
                .matcher(sqlNoComments)
                .find(),
            "must not create P/E/W/R/basic graph rows");
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
            sql.contains("cast time") || sql.contains("direction") || sql.contains("range"),
            "seed comments must document exclusion of cast time/direction/range");
        assertTrue(
            sql.contains("powder trail") || sql.contains("detonation")
                || sql.contains("reverse wave") || sql.contains("second-pass")
                || sql.contains("second pass"),
            "seed comments must document exclusion of trail/detonation/second-pass");
        assertTrue(
            sql.contains("once-per-pass") || sql.contains("once per pass")
                || sql.contains("spellshield") || sql.contains("Wind Wall"),
            "seed comments must document exclusion of once-per-pass/spellshield/Wind Wall");
        assertTrue(
            sql.contains("One selected-target") || sql.contains("one selected-target")
                || sql.contains("not full Q") || sql.contains("不是 full Q"),
            "seed must state one selected-target first-outbound-pass physical hit, not full Q");
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
        assertTrue(
            sql.contains("Q/E isolation") || sql.contains("sibling independence")
                || sql.contains("test-only composition"),
            "seed must document Q/E isolation / sibling independence");
    }

    @Test
    void preservesSiblingPewRBasicWithoutRequiringOrCopyingThem() {
        assertTrue(
            sql.contains("provider_hero_graves_new_destiny")
                || sql.contains("New Destiny")
                || sql.contains("P New Destiny"),
            "seed comments must name P New Destiny sibling for preservation");
        assertTrue(
            sql.contains("Quickdraw") || sql.contains("true_grit") || sql.contains("True Grit"),
            "seed comments must name E Quickdraw / True Grit for isolation");
        assertTrue(
            sql.contains("Smoke Screen") || sql.contains("smoke_screen")
                || sql.contains("provider_hero_graves_w"),
            "seed comments must name W Smoke Screen sibling for preservation");
        assertTrue(
            sql.contains("Collateral Damage") || sql.contains("collateral_damage")
                || sql.contains("provider_hero_graves_r"),
            "seed comments must name R Collateral Damage sibling for preservation");
        assertTrue(
            (sql.contains("不要求") || sql.contains("without requiring") || sql.contains("非硬前置")
                    || sql.contains("不是硬前置"))
                && (sql.contains("不") && (sql.contains("突变") || sql.contains("mutating")
                    || sql.contains("mutate")))
                && (sql.contains("不合成") || sql.contains("synthesizing") || sql.contains("synthesize")
                    || sql.contains("copying") || sql.contains("不 copy") || sql.contains("复制")),
            "seed must preserve siblings without requiring/mutating/synthesizing/copying them");
        assertFalse(
            Pattern.compile("(?is)'true_grit_stacks'")
                .matcher(sqlNoComments)
                .find(),
            "must not read/write Quickdraw true_grit_stacks in executable SQL");
        assertFalse(
            Pattern.compile(
                    "(?is)missing provider_hero_graves_new_destiny|"
                        + "missing provider_hero_graves_quickdraw|"
                        + "missing provider_hero_graves_w_smoke_screen|"
                        + "missing provider_hero_graves_r_collateral")
                .matcher(sqlNoComments)
                .find(),
            "must not hard-require sibling provider presence in executable SQL");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesBonusAdExclusionsStandaloneAndSiblingPreservation() {
        assertTrue(
            readme.contains("lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql"),
            "README must list the Graves Q End of the Line first outbound-pass seed");
        assertTrue(
            readme.contains("LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)graves.*end of the line|穷途末路|End of the Line")
                .matcher(readme)
                .find(),
            "README must name Graves End of the Line");
        int seedIdx = readme.indexOf(
            "lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-graves-end-of-the-line-first-outbound-pass"),
            "README entry must name the task key");
        assertTrue(
            section.contains("graves-q-end-of-the-line-first-outbound-pass-phase-a-v2"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("physical_150_plus_0_65_bonus_ad"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertTrue(
            section.contains("1307367") && section.contains("4007501")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("2266") && section.contains("2265"),
            "README must document canonical 2266 and local raw 2265 byte sizes");
        assertTrue(section.contains("6000"), "README must document cooldown 6000ms");
        assertTrue(
            section.contains("150") && section.contains("0.65")
                && (section.contains("bonus AD") || section.contains("ad.resolved-ad.base")
                    || (section.contains("ad.resolved") && section.contains("ad.base"))),
            "README must document damage formula with bonus AD wording");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("不物化") || section.contains("本 seed 不物化")
                || section.contains("不做") && section.contains("自包含"),
            "README must warn that this seed does not materialize identity/panel/resource");
        assertTrue(
            (section.contains("Q/E") || section.contains("True Grit"))
                && (section.contains("isolation") || section.contains("隔离")
                    || section.contains("does not alter") || section.contains("no Q damage")),
            "README must document Q/E isolation");
        assertTrue(
            (section.contains("P") || section.contains("New Destiny"))
                && (section.contains("E") || section.contains("Quickdraw"))
                && (section.contains("W") || section.contains("Smoke"))
                && (section.contains("R") || section.contains("Collateral"))
                && (section.contains("不要求") || section.contains("standalone")
                    || section.contains("并存") || section.contains("preserve")),
            "README must document sibling P/E/W/R preservation without requiring them");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|cast.?time|powder.?trail|detonation|second.?pass|"
                        + "once.?per.?pass|spellshield|Wind Wall|geometry|projectile")
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
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_graves`|"
                    + "ensure `hero_graves` 最低必要实体|"
                    + "ensure `hero_graves`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
        assertTrue(
            section.contains("base0/resolved0") || section.contains("final107.5")
                || section.contains("HP785") || section.contains("mana240")
                || section.contains("both raw/final215") || section.contains("final215"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            section.contains("LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest")
                || section.contains("LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest")
                || section.contains("LolGenericGravesQuickdrawMaxStackSeedSqlTest")
                || section.contains("LolGenericGravesNewDestinySeedSqlTest")
                || section.contains("LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest"),
            "README static validation must cite adjacent Graves P/E/W/R and Tristana W precedents");
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
            150,
            root.path("args").get(0).path("value").asDouble(),
            0.0001,
            "add left must be const 150");
        JsonNode mulBonus = root.path("args").get(1);
        assertEquals("mul", mulBonus.path("op").asText(), "add right must be mul");
        assertEquals(2, mulBonus.path("args").size(), "mul must be binary");
        assertEquals(
            0.65,
            mulBonus.path("args").get(0).path("value").asDouble(),
            0.0001,
            "bonus AD mul left must be const 0.65");
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
            root, "end_of_the_line_first_outbound_pass_damage");
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
