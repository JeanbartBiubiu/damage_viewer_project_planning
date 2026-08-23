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
 * Static contract for {@code lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_jhin",
        "provider_hero_jhin_q_dancing_grenade_primary_first_hit",
        "ability_hero_jhin_q_dancing_grenade_primary_first_hit",
        "dancing_grenade_primary_first_hit",
        "phase_hero_jhin_q_dancing_grenade_primary_first_hit_impact",
        "sequence_hero_jhin_q_dancing_grenade_primary_first_hit_impact",
        "step_hero_jhin_q_dancing_grenade_primary_first_hit_damage",
        "cooldown_hero_jhin_q_dancing_grenade_primary_first_hit",
        "dancing_grenade_primary_first_hit_damage",
        "q_mana_cost",
        "q_cooldown_ms");

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
        "ap_ratio",
        "immediate_impact_scaffold");

    private static final String DANCING_GRENADE_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":144},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.74},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ad.resolved\"}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.60},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_selected_primary_champion_first_grenade_single_physical_hit; "
            + "immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; "
            + "no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_"
            + "target_acquisition_bounce_to_up_to_three_additional_targets_nearest_"
            + "unhit_priority_target_death_35_percent_damage_increase_later_bounce_"
            + "scaling_maximum_final_bounce_spellshield_bounce_persistence_other_"
            + "ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1";

    private static final String NORMALIZED_SHA =
        "6f5c6dcc9771140136705f8e6554cb999f7ec5a1272515d5cbd03b910bdd20b1";

    private static final String PAGES_SHA =
        "642d7c88a064cd3107a4cf9f51a75be2ca91bb2e904afd6cfa8cf3ead92b7897";

    private static final String LOCAL_RAW_SHA =
        "17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb";

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
        assertContains("hero_skill|hero_jhin|Q|曼舞手雷");
        assertContains("wasm-generic-jhin-dancing-grenade-primary-first-hit");
        assertContains("jhin-q-dancing-grenade-primary-first-hit-phase-a-v1");
        assertContains("Template:Data Jhin/Q");
        assertContains("Template:Data Jhin/Dancing Grenade");
        assertContains("1307579");
        assertContains("4007611");
        assertContains("2026-04-12T07:23:12Z");
        assertContains("1913");
        assertContains(CANONICAL_SHA);
        assertContains("2388");
        assertContains(NORMALIZED_SHA);
        assertContains("682");
        assertContains(PAGES_SHA);
        assertContains("1911");
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
        assertContains("normalized/generic/jhin-q.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertDocumentsExplicitAbsenceOfTotalAdRatio(sql, "seed");
        assertTrue(
            Pattern.compile("(?i)physical|物理").matcher(sql).find()
                && (sql.contains("144 + 74% total AD + 60% AP")
                    || sql.contains("144 + 0.74")
                    || sql.contains("physical 144")),
            "seed comments must document rank5 physical 144 +74% total AD +60% AP");
        assertTrue(
            (sql.contains("total AD") || sql.contains("totalAD"))
                && sql.contains("source.attr.ad.resolved"),
            "seed must document total-AD direct resolved read");
        assertTrue(
            sql.contains("source.attr.ap.resolved"),
            "seed must document AP resolved read");
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
    }

    @Test
    void documentsDeterministicFixturesWithoutClaimingFullFidelity() {
        assertTrue(
            (sql.contains("AD0/AP0/armor0") || sql.contains("AD0/AP0"))
                && (sql.contains("raw/final144") || sql.contains("final144")),
            "seed comments must document AD0/AP0/armor0 raw/final144");
        assertTrue(
            sql.contains("AD100/AP0") && sql.contains("218"),
            "seed comments must document AD100/AP0 => 218");
        assertTrue(
            sql.contains("AD0/AP100") && sql.contains("204"),
            "seed comments must document AD0/AP100 => 204");
        assertTrue(
            sql.contains("AD100/AP100") && sql.contains("278"),
            "seed comments must document AD100/AP100 => 278");
        assertTrue(
            (sql.contains("armor100 raw278/final139")
                    || (sql.contains("raw278") && sql.contains("final139"))),
            "seed comments must document armor100 raw278/final139");
        assertTrue(
            sql.contains("AD200/AP100/armor100")
                && (sql.contains("raw352/final176") || (sql.contains("raw352") && sql.contains("final176"))),
            "seed comments must document AD200/AP100/armor100 raw352/final176");
        assertTrue(
            (sql.contains("totalAD counterproof") || sql.contains("counterproof"))
                && sql.contains("base0/resolved100")
                && sql.contains("base60/resolved100")
                && (sql.contains("both218") || sql.contains("both 218")),
            "seed must document totalAD counterproof both218");
        assertTrue(
            sql.contains("never source.attr.ad.base")
                || (sql.contains("从不读") && sql.contains("source.attr.ad.base"))
                || (sql.contains("不得") && sql.contains("ad.base"))
                || (sql.contains("不减") && sql.contains("ad.base")),
            "seed must document formula never reads source.attr.ad.base");
        assertTrue(
            sql.contains("t0") && sql.contains("t4999") && sql.contains("t5000"),
            "seed comments must document cooldown timeline t0/t4999/t5000");
        assertTrue(
            (sql.contains("Mana180") || sql.contains("mana180"))
                && (sql.contains("mana60") || sql.contains("final mana60"))
                && (sql.contains("HP722") || sql.contains("HP1000")),
            "seed comments must document Mana180→60 / HP1000→722 fixture");
        assertTrue(
            sql.contains("readyAt5000") || sql.contains("readyAt 5000"),
            "seed comments must document readyAt5000");
        assertTrue(
            sql.contains("two Q hits") || (sql.contains("two Q") && sql.contains("hits")),
            "seed comments must document two Q hits");
        assertTrue(
            sql.contains("automatic starts") || (sql.contains("automatic") && sql.contains("starts"))
                || (sql.contains("two") && sql.contains("ability_started")),
            "seed comments must document automatic starts / ability_started");
        assertTrue(
            (sql.contains("Mana59") || sql.contains("mana59"))
                && (sql.contains("skips") || sql.contains("unchanged") || sql.contains("resource skip")),
            "seed comments must document Mana59 skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("Q/W isolation") || sql.contains("Q/W")
                || sql.contains("test-only composition"),
            "seed comments must document Q/W isolation");
        assertTrue(
            sql.contains("Q seed contains no W rows")
                || sql.contains("不含任何 W rows")
                || sql.contains("不含 W rows")
                || sql.contains("no W rows"),
            "seed comments must document that Q seed contains no W rows");
        assertTrue(
            sql.contains("preserve existing W")
                || sql.contains("保留既有 W")
                || (sql.contains("preserve") && sql.contains("W")),
            "seed comments must document preserve existing W");
        assertTrue(
            sql.contains("standalone")
                || sql.contains("no P/W/E/R/basic")
                || sql.contains("不 require")
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
            "seed must state one selected-primary first-grenade physical hit, not full Q");
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
            "dancing grenade primary-first-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "dancing grenade primary-first-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "dancing grenade primary-first-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "dancing grenade primary-first-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "dancing grenade primary-first-hit seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroJhinAdApManaAndNoRepositoryMaterializer() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_jhin");
        assertContains("missing entity_attribute_values hero_jhin/ad");
        assertContains("missing entity_attribute_values hero_jhin/ap");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed")
                || sql.contains("当前仓库无 materializer"),
            "seed must state that no current repository seed/materializer provides Jhin rows");
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
                        + "entity_id\\s*=\\s*'hero_jhin'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_jhin before graph writes");
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
            "must SELECT/EXISTS-check entity_attribute_values hero_jhin/ad");
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
            "must SELECT/EXISTS-check entity_attribute_values hero_jhin/ap");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_jhin with the Batch-B prerequisite phrase");
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
        assertContains("provider_hero_jhin_q_dancing_grenade_primary_first_hit");
        assertContains("hero_jhin_q_dancing_grenade_primary_first_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_jhin_q_dancing_grenade_primary_first_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Dancing Grenade primary-first-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_jhin'\\s*,\\s*"
                        + "'provider_hero_jhin_q_dancing_grenade_primary_first_hit'")
                .matcher(sql)
                .find(),
            "must mount Dancing Grenade primary-first-hit provider to hero_jhin");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Dancing Grenade primary-first-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Dancing Grenade primary-first-hit only)");
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
                    "(?s)'ability_hero_jhin_q_dancing_grenade_primary_first_hit'\\s*,\\s*"
                        + "'provider_hero_jhin_q_dancing_grenade_primary_first_hit'\\s*,\\s*"
                        + "'dancing_grenade_primary_first_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key dancing_grenade_primary_first_hit");
        assertContains("{\"op\":\"const\",\"value\":60}");
        assertContains("{\"op\":\"const\",\"value\":5000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_jhin_q_dancing_grenade_primary_first_hit'\\s*,\\s*"
                        + "'ability_hero_jhin_q_dancing_grenade_primary_first_hit'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 5000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_jhin_q_dancing_grenade_primary_first_hit_impact'\\s*,\\s*"
                        + "'ability_hero_jhin_q_dancing_grenade_primary_first_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_jhin_q_dancing_grenade_primary_first_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_jhin_q_dancing_grenade_primary_first_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_jhin_q_dancing_grenade_primary_first_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_jhin_q_dancing_grenade_primary_first_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Dancing Grenade damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(sql, "'step_hero_jhin_q_dancing_grenade_primary_first_hit_damage'"),
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
                    "(?is)deadly_flourish|"
                        + "provider_hero_jhin_w_|ability_hero_jhin_w_")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate Jhin W Deadly Flourish rows");
    }

    @Test
    void parsesNestedBinaryTotalAdPlusApPhysicalDamageFormula() throws IOException {
        assertContains(DANCING_GRENADE_DAMAGE);
        assertBinaryNestedTotalAdPlusApDamageFormula(DANCING_GRENADE_DAMAGE);
        assertContains("source.attr.ad.resolved");
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":144");
        assertContains("\"value\":0.74");
        assertContains("\"value\":0.60");
        assertFalse(
            Pattern.compile("source\\.attr\\.ad\\.base")
                .matcher(sqlNoComments)
                .find(),
            "must not interpret total AD as bonus AD via ad.base subtraction");
        assertEquals(
            2,
            JSON.readTree(DANCING_GRENADE_DAMAGE).path("args").size(),
            "outer add must remain binary (never three-arg add)");
        assertEquals(
            "add",
            JSON.readTree(DANCING_GRENADE_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be nested add, not flattened const");
        assertEquals(
            "mul",
            JSON.readTree(DANCING_GRENADE_DAMAGE).path("args").get(1).path("op").asText(),
            "outer right child must be mul(0.60, AP)");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "source.attr.ad.resolved"),
            "executable formula must read source.attr.ad.resolved exactly once");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "source.attr.ap.resolved"),
            "executable formula must read source.attr.ap.resolved exactly once");
    }

    @Test
    void seedsPhysicalDamageAddPolicyCopyableFalseAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_jhin_q_dancing_grenade_primary_first_hit_damage'\\s*,\\s*"
                        + "'dancing_grenade_primary_first_hit_damage'\\s*,\\s*20220\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Dancing Grenade damage must be physical 20220 add policy copyable_on_hit=false");
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
            Pattern.compile("(?i)crit_eligible\\s*=\\s*true").matcher(sqlNoComments).find(),
            "Dancing Grenade primary-first-hit must not enable crit eligibility");
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
                    "(?i)cast.?time|unit.?targeted|cancel.?condition|"
                        + "projectile|missile|bounce|nearest.?unhit|"
                        + "target.?death|35.?percent|final.?bounce|"
                        + "spell.?shield|spellshield|bounce.?persistence|"
                        + "basic_attack_hit|emit_event|equipment|loadout|runes|"
                        + "aoe|area.?of.?effect|\\brepeat\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded cast/projectile/bounce/death-amp/spellshield surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_jhin_[pwer]_|'ability_hero_jhin_[pwer]_|"
                        + "'provider_hero_jhin_basic_|'ability_hero_jhin_basic_")
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
            sql.contains("cast time") || sql.contains("unit-targeted")
                || sql.contains("cancel"),
            "seed comments must document exclusion of cast time / unit-targeted cancel");
        assertTrue(
            sql.contains("projectile") || sql.contains("first-target")
                || sql.contains("acquisition"),
            "seed comments must document exclusion of projectile/first-target acquisition");
        assertTrue(
            sql.contains("bounce") || sql.contains("nearest-unhit")
                || sql.contains("three additional"),
            "seed comments must document exclusion of bounce / nearest-unhit");
        assertTrue(
            sql.contains("35%") || sql.contains("35 percent") || sql.contains("target-death")
                || sql.contains("death"),
            "seed comments must document exclusion of target-death +35% amplification");
        assertTrue(
            sql.contains("spellshield") || sql.contains("spell shield")
                || sql.contains("bounce-persistence") || sql.contains("bounce persistence"),
            "seed comments must document exclusion of spellshield bounce-persistence");
        assertTrue(
            sql.contains("maximum final bounce") || sql.contains("final bounce"),
            "seed comments must document exclusion of maximum final bounce");
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
                    || sql.contains("no ability-specific") || sql.contains("不得新增 Q")
                    || sql.contains("无 Q-specific"))
                && (sql.contains("62xxx") || sql.contains("game-local type")
                    || sql.contains("Q-specific") || sql.contains("game-local")),
            "seed comments must document that Q has no ability-specific game-local type");
        assertTrue(
            sql.contains("type_relations")
                && (sql.contains("不写") || sql.contains("不新增") || sql.contains("no Q type")),
            "seed comments must document no Q type / no type_relations");
    }

    @Test
    void preservesExistingWWithoutRequiringOrCopyingIt() {
        assertTrue(
            sql.contains("Deadly Flourish") || sql.contains("致命华彩")
                || sql.contains("deadly_flourish") || sql.contains("既有 W"),
            "seed comments must name existing W Deadly Flourish for preservation");
        assertTrue(
            (sql.contains("不要求") || sql.contains("without requiring") || sql.contains("保留既有 W")
                    || sql.contains("preserve existing W"))
                && (sql.contains("不") && (sql.contains("突变") || sql.contains("mutating")
                    || sql.contains("mutate")))
                && (sql.contains("不合成") || sql.contains("synthesizing") || sql.contains("synthesize")
                    || sql.contains("copying") || sql.contains("不 copy") || sql.contains("复制")),
            "seed must preserve W without requiring/mutating/synthesizing/copying it");
        assertTrue(
            sql.contains("Q/W isolation") || sql.contains("test-only composition")
                || sql.contains("Q seed contains no W rows"),
            "seed must document Q/W isolation");
        assertFalse(
            Pattern.compile(
                    "(?is)missing provider_hero_jhin_w_deadly_flourish|"
                        + "missing ability_hero_jhin_w_")
                .matcher(sqlNoComments)
                .find(),
            "must not hard-require sibling W provider presence in executable SQL");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_jhin_w_|'ability_hero_jhin_w_|"
                        + "'deadly_flourish_primary_hit'")
                .matcher(sqlNoComments)
                .find(),
            "Q seed executable SQL must contain no W rows");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesTotalAdExclusionsQwPreservationAndNoMaterializer() {
        assertTrue(
            readme.contains("lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql"),
            "README must list the Jhin Q Dancing Grenade primary-first-hit seed");
        assertTrue(
            readme.contains("LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)jhin.*dancing|曼舞手雷|Dancing Grenade")
                .matcher(readme)
                .find(),
            "README must name Jhin Dancing Grenade");
        int seedIdx = readme.indexOf("lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-jhin-dancing-grenade-primary-first-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("jhin-q-dancing-grenade-primary-first-hit-phase-a-v1"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("physical_144_plus_0_74_total_ad_plus_0_60_ap"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertDocumentsExplicitAbsenceOfTotalAdRatio(section, "README");
        assertTrue(
            section.contains("1307579") && section.contains("4007611")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(NORMALIZED_SHA) && section.contains("2388"),
            "README must document authoritative normalized SHA/bytes");
        assertTrue(
            section.contains(PAGES_SHA) && section.contains("682"),
            "README must document pages SHA/bytes");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("1913") && section.contains("1911"),
            "README must document canonical 1913 and local raw 1911 byte sizes");
        assertTrue(section.contains("5000"), "README must document cooldown 5000ms");
        assertTrue(
            section.contains("144") && section.contains("0.74") && section.contains("0.60")
                && (section.contains("total AD") || section.contains("ad.resolved"))
                && (section.contains("AP") || section.contains("ap.resolved")),
            "README must document damage formula with total-AD + AP wording");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("无 seed") || section.contains("无 materializer")
                || section.contains("没有任何 seed") || section.contains("不负责物化")
                || section.contains("亦无 seed 负责物化") || section.contains("不物化"),
            "README must warn that no repository materializer exists for Jhin identity/panel/resource");
        assertTrue(
            (section.contains("Q/W") || section.contains("Deadly Flourish") || section.contains("致命华彩"))
                && (section.contains("isolation") || section.contains("隔离")
                    || section.contains("preserve") || section.contains("保留")
                    || section.contains("no W rows") || section.contains("不含 W")),
            "README must document Q/W isolation / preserve existing W");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|cast|projectile|bounce|spellshield|"
                        + "target.?death|35|cancel")
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
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_jhin`|"
                    + "ensure `hero_jhin` 最低必要实体|"
                    + "ensure `hero_jhin`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
        assertTrue(
            section.contains("raw/final144") || section.contains("AD0/AP0")
                || section.contains("HP722") || section.contains("Mana180")
                || section.contains("both218"),
            "README must document deterministic runtime fixtures");
        // Jhin W documentation must remain intact and not be overwritten by this Q section.
        assertTrue(
            readme.contains("lol_generic_jhin_deadly_flourish_primary_hit_seed.sql")
                && readme.contains("LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest")
                && readme.contains("hero_skill|hero_jhin|W|致命华彩"),
            "README must preserve existing Jhin W documentation");
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

    /**
     * compileGenericNode only wires args[0]/args[1] for binary arithmetic/comparison ops.
     * Damage formula must use nested binary add(total AD + AP), never a three-argument add.
     */
    private static void assertBinaryNestedTotalAdPlusApDamageFormula(String damageJson)
            throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be nested add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        JsonNode inner = root.path("args").get(0);
        assertEquals("add", inner.path("op").asText(), "inner damage must be nested add");
        assertEquals(2, inner.path("args").size(), "inner add must be binary");
        assertEquals(
            144,
            inner.path("args").get(0).path("value").asDouble(),
            0.0001,
            "inner add left must be const 144");
        JsonNode totalAdMul = inner.path("args").get(1);
        assertEquals("mul", totalAdMul.path("op").asText(), "inner right must be mul");
        assertEquals(2, totalAdMul.path("args").size(), "total-AD mul must be binary");
        assertEquals(
            0.74,
            totalAdMul.path("args").get(0).path("value").asDouble(),
            0.0001,
            "total-AD mul left must be const 0.74");
        assertEquals(
            "source.attr.ad.resolved",
            totalAdMul.path("args").get(1).path("path").asText(),
            "total-AD mul right must read AD resolved");
        JsonNode apMul = root.path("args").get(1);
        assertEquals("mul", apMul.path("op").asText(), "outer right must be mul");
        assertEquals(2, apMul.path("args").size(), "AP mul must be binary");
        assertEquals(
            0.60,
            apMul.path("args").get(0).path("value").asDouble(),
            0.0001,
            "AP mul left must be const 0.60");
        assertEquals(
            "source.attr.ap.resolved",
            apMul.path("args").get(1).path("path").asText(),
            "AP mul right must read AP resolved");
        assertBinaryArithmeticComparisonArity(root, "dancing_grenade_primary_first_hit_damage");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ap.resolved"),
            "AP read must be present in nested binary damage AST");
        assertTrue(
            nodeContainsReadPath(root, "source.attr.ad.resolved"),
            "total AD read must be present in nested binary damage AST");
        assertFalse(
            nodeContainsReadPath(root, "source.attr.ad.base"),
            "must not read source.attr.ad.base");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ad.resolved"),
            "AST must read source.attr.ad.resolved exactly once");
        assertEquals(
            1,
            countReadPathOccurrences(root, "source.attr.ap.resolved"),
            "AST must read source.attr.ap.resolved exactly once");
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
