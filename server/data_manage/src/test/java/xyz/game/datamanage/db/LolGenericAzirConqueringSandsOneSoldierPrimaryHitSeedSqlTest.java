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
 * Static contract for {@code lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed.sql}.
 * Does not connect to a live database. Deterministic runtime fixtures are comment-only;
 * a disposable PostgreSQL fixture may create external prerequisite rows, but the production
 * seed must not.
 */
class LolGenericAzirConqueringSandsOneSoldierPrimaryHitSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_azir",
        "provider_hero_azir_q_conquering_sands_one_soldier_primary_hit",
        "ability_hero_azir_q_conquering_sands_one_soldier_primary_hit",
        "conquering_sands_one_soldier_primary_hit",
        "phase_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact",
        "sequence_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact",
        "step_hero_azir_q_conquering_sands_one_soldier_primary_hit_damage",
        "cooldown_hero_azir_q_conquering_sands_one_soldier_primary_hit",
        "conquering_sands_one_soldier_primary_hit_damage",
        "q_mana_cost",
        "q_cooldown_ms",
        "hero_azir_q_conquering_sands_one_soldier_primary_hit");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20111, 20120, 20130, 20142, 20150, 20170, 20221, 20260);

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "game_entities",
        "entity_attribute_values"
    );

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_magic_damage",
        "ap_ratio",
        "one_existing_soldier_selected_primary_hit_scaffold");

    private static final String CONQUERING_SANDS_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":140},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.55},"
            + "{\"op\":\"read\",\"path\":\"source.attr.ap.resolved\"}]}]}";

    private static final Set<String> BINARY_ARITHMETIC_COMPARISON_OPS = Set.of(
        "add", "sub", "mul", "div", "lt", "lte", "gt", "gte");

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String FROZEN_BOUNDARY =
        "rank5_assume_one_existing_sand_soldier_selected_primary_single_magic_hit; "
            + "immediate_impact_scaffold; magic_140_plus_0_55_ap; "
            + "mana110_listed_cooldown6000ms_scaffold; "
            + "no_soldier_entity_spawn_count_formation_command_path_target_location_"
            + "dash_collision_geometry_multitarget_slow_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "168e2568c6795859e68831eb23b59b62d249aceb07cf3740403b1616516b51f2";

    private static final String NORMALIZED_SHA =
        "9e2cfc28ced422699bbb40722ba46d82167c79f34bbd696f2fc4080e52120fb7";

    private static final String PAGES_SHA =
        "a15a3c54079cd8a75584c9725bb792441103ff27cafa31fa136d076791fa71f4";

    private static final String LOCAL_RAW_SHA =
        "6885ead987cae40fa37992d170337007629e3f12ebfc494eb3a1f54b5fb110e4";

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
    void documentsSourceIdentityLocalCaveatBoundaryTagsAndApWording() {
        assertContains("hero_skill|hero_azir|Q|狂沙猛攻");
        assertContains("wasm-generic-azir-conquering-sands-one-soldier-selected-primary-hit");
        assertContains("azir-q-conquering-sands-one-soldier-selected-primary-hit-phase-a-v1");
        assertContains("Template:Data Azir/Q");
        assertContains("Template:Data Azir/Conquering Sands");
        assertContains("1306850");
        assertContains("4024967");
        assertContains("2026-06-04T07:26:59Z");
        assertContains("2512");
        assertContains(CANONICAL_SHA);
        assertContains("3119");
        assertContains(NORMALIZED_SHA);
        assertContains("684");
        assertContains(PAGES_SHA);
        assertContains("2510");
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
        assertContains("normalized/generic/azir-q.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
        assertTrue(
            sql.contains("meta_or_non_target_dps")
                && (sql.contains("legacy provenance") || sql.contains("永非 governed")
                    || sql.contains("never a governed") || sql.contains("非 governed tag")),
            "seed must state meta_or_non_target_dps is legacy provenance, not a governed tag");
        assertTrue(
            Pattern.compile("(?i)magic|魔法").matcher(sql).find()
                && (sql.contains("140 + 55% AP")
                    || sql.contains("140 + 0.55")
                    || sql.contains("magic 140")),
            "seed comments must document rank5 magic 140 +55% AP");
        assertTrue(
            sql.contains("source.attr.ap.resolved")
                && (sql.contains("直接读取") || sql.contains("直接读") || sql.contains("AP is")),
            "seed must document direct AP resolved read");
        assertTrue(
            sql.contains("嵌套二元") || sql.contains("nested binary")
                || sql.contains("每个算术节点恰好二元"),
            "seed must document nested-binary arithmetic");
        assertTrue(
            sql.contains("AP path 恰好一次") || sql.contains("path 恰好一次")
                || sql.contains("path once") || sql.contains("exactly once"),
            "seed must document AP path-once");
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
        assertContains("20260727");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "seed must not use the Batch-B prerequisite phrase");
        assertTrue(
            sql.contains("scenario assumption") || sql.contains("caller/scenario")
                || sql.contains("假定一枚既有沙兵"),
            "seed must frame one-existing-soldier as scenario assumption");
        assertTrue(
            sql.contains("不建模") && (sql.contains("gate") || sql.contains("precondition")
                || sql.contains("沙兵状态"))
                || sql.contains("without modeling the gate")
                || sql.contains("not modeled") || sql.contains("non modeled"),
            "seed must clarify soldier gate is not modeled/enforced");
        assertFalse(
            Pattern.compile(
                    "(?is)cast_condition|soldier.?state.?precondition|"
                        + "enforced.?soldier|require.?soldier.?state|"
                        + "provider\\.state\\.[a-z_]*soldier")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not encode soldier-state precondition / cast condition");
        assertTrue(
            sql.contains("requires a summoned soldier")
                || sql.contains("需要已召唤沙兵")
                || sql.contains("summoned soldier"),
            "seed comments must record Wiki soldier requirement as evidence only");
        assertTrue(
            sql.contains("subsequent soldiers add no damage")
                || sql.contains("subsequent soldiers")
                || sql.contains("add no damage/slow"),
            "seed comments must record Wiki subsequent-soldiers add no damage/slow");
        assertTrue(
            sql.contains("crit_eligible=false") || sql.contains("crit_eligible = false")
                || sql.contains("noncritical") || sql.contains("非 crit"),
            "seed must document crit_eligible=false / noncrit");
        assertTrue(
            sql.contains("copyable_on_hit=false") || sql.contains("noncopyable"),
            "seed must document copyable_on_hit=false");
    }

    @Test
    void documentsDeterministicFixturesWithoutClaimingFullFidelity() {
        assertTrue(
            sql.contains("AP0/MR0") && (sql.contains("raw/final140") || sql.contains("final140")),
            "seed comments must document AP0/MR0 raw/final140");
        assertTrue(
            sql.contains("AP100/MR100")
                && (sql.contains("raw195/final97.5") || sql.contains("final97.5")),
            "seed comments must document AP100/MR100 raw195/final97.5");
        assertTrue(
            (sql.contains("AD") || sql.contains("crit"))
                && (sql.contains("unchanged") || sql.contains("不得改变") || sql.contains("leaves output")),
            "seed comments must document unrelated AD/crit/crit_damage leaves output unchanged");
        assertTrue(
            sql.contains("t0") && sql.contains("t5999") && sql.contains("t6000"),
            "seed comments must document cooldown timeline t0/t5999/t6000");
        assertTrue(
            (sql.contains("mana330") || sql.contains("mana330,"))
                && (sql.contains("mana110") || sql.contains("final mana110"))
                && (sql.contains("HP805") || sql.contains("HP1000")),
            "seed comments must document mana330→110 / HP1000→805 fixture");
        assertTrue(
            sql.contains("readyAt6000") || sql.contains("ready-at6000") || sql.contains("readyAt 6000"),
            "seed comments must document readyAt6000");
        assertTrue(
            sql.contains("two Q damage") || sql.contains("two Q damage items")
                || (sql.contains("exactly two Q") && sql.contains("damage")),
            "seed comments must document two Q damage items");
        assertTrue(
            sql.contains("two automatic") || (sql.contains("two") && sql.contains("ability_started")),
            "seed comments must document two automatic ability_started");
        assertTrue(
            sql.contains("mana109") && (sql.contains("resource skip") || sql.contains("unchanged")),
            "seed comments must document mana109 resource skip");
        assertTrue(
            sql.contains("ability_started")
                && (sql.contains("自动") || sql.contains("automatic") || sql.contains("runtime")),
            "seed must document automatic ability_started (not an explicit seed event step)");
        assertTrue(
            sql.contains("idempotence") || sql.contains("no-op") || sql.contains("幂等"),
            "seed comments must document idempotence / no-op rerun");
        assertTrue(
            sql.contains("standalone")
                || sql.contains("no P/W/E/R/basic")
                || sql.contains("no sibling"),
            "seed comments must document standalone provider / no sibling synthesis");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
        assertTrue(
            sql.contains("测试夹具可") || sql.contains("test fixture may")
                || sql.contains("fixture may create"),
            "seed must note fixture may create external prerequisites; production seed must not");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim")
                || sql.contains("full-Q"),
            "seed must not claim full fidelity");
        assertTrue(
            sql.contains("Phase-A scaffold")
                && (sql.contains("不是实际") || sql.contains("not actual")
                    || sql.contains("soldier") || sql.contains("沙兵")),
            "seed must clarify immediate primary damage is Phase-A scaffold not soldier path");
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
            "conquering sands primary-hit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "conquering sands primary-hit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "conquering sands primary-hit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "conquering sands primary-hit seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "conquering sands primary-hit seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroAzirApManaBeforeGraphWritesAndNoMaterializer() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("missing game_entities hero_azir");
        assertContains("missing entity_attribute_values hero_azir/ap");
        assertTrue(
            sql.contains("check-only") || sql.contains("Check-only")
                || sql.contains("external existing-data"),
            "seed must document check-only / external existing-data prerequisites");
        assertTrue(
            sql.contains("非自包含") || sql.contains("non-self-contained")
                || sql.contains("not self-contained"),
            "seed must state it is non-self-contained");
        assertTrue(
            sql.contains("不物化") || sql.contains("not materialized")
                || sql.contains("当前仓库没有任何 seed")
                || sql.contains("当前仓库无") && sql.contains("materializer")
                || sql.contains("无 Azir materializer"),
            "seed must state that no current repository seed/materializer provides Azir rows");
        assertTrue(
            sql.contains("external existing-data dependency")
                || sql.contains("外部既有")
                || sql.contains("external existing-data"),
            "seed must use external existing-data identity wording");
        assertTrue(
            sql.contains("publication/live prerequisite")
                || sql.contains("未来执行/发布前")
                || sql.contains("live prerequisite limitation"),
            "seed must frame Azir+AP+mana as publication/live prerequisite limitation");
        assertContains("INSERT INTO public.types");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.game_entities\\b[\\s\\S]{0,200}"
                        + "entity_id\\s*=\\s*'hero_azir'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check game_entities hero_azir before graph writes");
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
            "must SELECT/EXISTS-check entity_attribute_values hero_azir/ap");
        int heroCheck = sqlNoComments.indexOf("missing game_entities hero_azir");
        int apCheck = sqlNoComments.indexOf("hero_azir/ap");
        int graphWrite = sqlNoComments.indexOf("INSERT INTO public.provider_definitions");
        assertTrue(heroCheck >= 0 && graphWrite > heroCheck,
            "fail-closed hero_azir check must precede provider graph writes");
        assertTrue(apCheck >= 0 && graphWrite > apCheck,
            "fail-closed ap checks must precede provider graph writes");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(sql).find(),
            "must not label hero_azir with the Batch-B prerequisite phrase");
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
        assertContains("provider_hero_azir_q_conquering_sands_one_soldier_primary_hit");
        assertContains("hero_azir_q_conquering_sands_one_soldier_primary_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Conquering Sands primary-hit provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_azir'\\s*,\\s*"
                        + "'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit'")
                .matcher(sql)
                .find(),
            "must mount Conquering Sands primary-hit provider to hero_azir");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Conquering Sands primary-hit provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Conquering Sands primary-hit only)");
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
                    "(?s)'ability_hero_azir_q_conquering_sands_one_soldier_primary_hit'\\s*,\\s*"
                        + "'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit'\\s*,\\s*"
                        + "'conquering_sands_one_soldier_primary_hit'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key conquering_sands_one_soldier_primary_hit");
        assertContains("{\"op\":\"const\",\"value\":110}");
        assertContains("{\"op\":\"const\",\"value\":6000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_azir_q_conquering_sands_one_soldier_primary_hit'\\s*,\\s*"
                        + "'ability_hero_azir_q_conquering_sands_one_soldier_primary_hit'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 6000ms via ability_cooldowns");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact'\\s*,\\s*"
                        + "'ability_hero_azir_q_conquering_sands_one_soldier_primary_hit'\\s*,\\s*"
                        + "0\\s*,\\s*20142\\s*,\\s*NULL\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "impact phase must be order 0 / type 20142 / null duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'phase_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact'\\s*,\\s*"
                        + "20260\\s*,\\s*"
                        + "'sequence_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact'")
                .matcher(sql)
                .find(),
            "impact phase must bind on_enter 20260 sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_azir_q_conquering_sands_one_soldier_primary_hit_damage'\\s*,\\s*"
                        + "'sequence_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact'\\s*,\\s*"
                        + "0\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Conquering Sands damage must be sole step order 0 to opponent");
        assertEquals(
            2,
            countOccurrences(
                sql, "'step_hero_azir_q_conquering_sands_one_soldier_primary_hit_damage'"),
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
                    "(?is)'provider_hero_azir_[pwer]_|'ability_hero_azir_[pwer]_|"
                        + "'provider_hero_azir_basic_|'ability_hero_azir_basic_|"
                        + "soldier_provider|sand_soldier")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate P/W/E/R/basic/soldier rows");
    }

    @Test
    void parsesNestedBinaryApMagicDamageFormulaPathOnce() throws IOException {
        assertContains(CONQUERING_SANDS_DAMAGE);
        assertBinaryApDamageFormula(CONQUERING_SANDS_DAMAGE);
        assertContains("source.attr.ap.resolved");
        assertContains("\"value\":140");
        assertContains("\"value\":0.55");
        assertEquals(
            2,
            JSON.readTree(CONQUERING_SANDS_DAMAGE).path("args").size(),
            "outer add must remain binary");
        assertEquals(
            "const",
            JSON.readTree(CONQUERING_SANDS_DAMAGE).path("args").get(0).path("op").asText(),
            "outer left child must be const 140");
        assertEquals(
            "mul",
            JSON.readTree(CONQUERING_SANDS_DAMAGE).path("args").get(1).path("op").asText(),
            "outer right child must be mul(0.55, AP)");
        assertEquals(
            1,
            countOccurrences(CONQUERING_SANDS_DAMAGE, "source.attr.ap.resolved"),
            "AP read path must appear exactly once in damage formula");
        assertFalse(
            Pattern.compile("(?is)source\\.attr\\.ad\\.(resolved|base)")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not include AD scaling for Conquering Sands Phase-A");
        assertFalse(
            Pattern.compile("(?is)source\\.attr\\.crit(_chance|_damage)?")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not read crit / crit_damage");
    }

    @Test
    void seedsMagicDamageAddPolicyCopyableFalseAndZeroForbiddenSurfaces() {
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_azir_q_conquering_sands_one_soldier_primary_hit_damage'\\s*,\\s*"
                        + "'conquering_sands_one_soldier_primary_hit_damage'\\s*,\\s*"
                        + "20221\\s*,\\s*20170\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Conquering Sands damage must be magic 20221 add policy copyable_on_hit=false");
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
            "Conquering Sands primary-hit must not enable crit eligibility");
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
                    "(?i)soldier.?entity|sand.?soldier.?spawn|formation|"
                        + "cast.?precondition|command.?path|\\bdash\\b|collision|"
                        + "wind.?wall|rebuttal|target.?location|multitarget|"
                        + "\\bslow\\b|scheduler|basic_attack_hit|emit_event|"
                        + "equipment|loadout|runes|\\brepeat\\b|projectile")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded soldier/command/path/dash/collision/slow surfaces");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_azir_[pwer]_|'ability_hero_azir_[pwer]_|"
                        + "'provider_hero_azir_basic_|'ability_hero_azir_basic_")
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
            sql.contains("soldier entity") || sql.contains("spawn") || sql.contains("formation"),
            "seed comments must document exclusion of soldier entity/spawn/formation");
        assertTrue(
            sql.contains("command") || sql.contains("path") || sql.contains("dash")
                || sql.contains("collision"),
            "seed comments must document exclusion of command/path/dash/collision");
        assertTrue(
            sql.contains("slow") || sql.contains("multitarget") || sql.contains("geometry"),
            "seed comments must document exclusion of slow/geometry/multitarget");
        assertTrue(
            sql.contains("Wind Wall") || sql.contains("Rebuttal") || sql.contains("target location"),
            "seed comments must document exclusion of Wind Wall/Rebuttal/target location");
    }

    @Test
    void readmeEntryDocumentsPrerequisitesApExclusionsIsolationAndNoMaterializer() {
        assertTrue(
            readme.contains("lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed.sql"),
            "README must list the Azir Q Conquering Sands one-soldier primary-hit seed");
        assertTrue(
            readme.contains("LolGenericAzirConqueringSandsOneSoldierPrimaryHitSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)azir.*conquering|狂沙猛攻|Conquering Sands")
                .matcher(readme)
                .find(),
            "README must name Azir Conquering Sands");
        int seedIdx = readme.indexOf(
            "lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-azir-conquering-sands-one-soldier-selected-primary-hit"),
            "README entry must name the task key");
        assertTrue(
            section.contains("azir-q-conquering-sands-one-soldier-selected-primary-hit-phase-a-v1"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("magic_140_plus_0_55_ap"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertTrue(
            section.contains("1306850") && section.contains("4024967")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(NORMALIZED_SHA) && section.contains(PAGES_SHA),
            "README must document normalized/pages authoritative hashes");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(section.contains("6000"), "README must document cooldown 6000ms");
        assertTrue(
            section.contains("140") && section.contains("0.55")
                && (section.contains("AP") || section.contains("ap.resolved")),
            "README must document damage formula with AP wording");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("非自包含") || section.contains("non-self-contained")
                || section.contains("本 seed 非自包含"),
            "README must state seed is non-self-contained");
        assertTrue(
            section.contains("无 seed") || section.contains("无 materializer")
                || section.contains("没有任何 seed") || section.contains("不负责物化")
                || section.contains("亦无") && section.contains("materializer")
                || section.contains("无 Azir materializer"),
            "README must warn that no repository materializer exists for Azir identity/panel/resource");
        assertTrue(
            section.contains("scenario assumption") || section.contains("假定一枚既有")
                || section.contains("caller/scenario")
                || (section.contains("假定") && section.contains("沙兵")),
            "README must frame one-existing-soldier as scenario assumption not modeled gate");
        assertTrue(
            section.contains("不建模") || section.contains("without modeling")
                || section.contains("not modeled") || section.contains("非 modeled"),
            "README must clarify soldier gate is not modeled");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|soldier|spawn|formation|command|path|dash|"
                        + "collision|slow|geometry")
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
            Pattern.compile("(?i)\\*\\*自包含\\*\\*|自包含 ensure `hero_azir`|"
                    + "ensure `hero_azir` 最低必要实体|"
                    + "ensure `hero_azir`（`ON CONFLICT|"
                    + "与 level-1 面板")
                .matcher(section)
                .find(),
            "README must not call the seed self-contained or imitate panel bootstrap wording");
        assertFalse(
            Pattern.compile("(?i)Batch-B\\s+prerequisite").matcher(section).find(),
            "README must not use the Batch-B prerequisite phrase");
        assertTrue(
            section.contains("AP0/MR0") || section.contains("final140")
                || section.contains("HP805") || section.contains("mana330"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            section.contains("reserved_types_seed.sql"),
            "README must state execution order starts with reserved_types_seed.sql");
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
            block.contains("meta_or_non_target_dps"),
            label + " Ordered tags must not include meta_or_non_target_dps");
    }

    private static void assertBinaryApDamageFormula(String damageJson) throws IOException {
        JsonNode root = JSON.readTree(damageJson);
        assertEquals("add", root.path("op").asText(), "outer damage must be add");
        assertEquals(2, root.path("args").size(), "outer add must be binary");
        assertEquals(
            140,
            root.path("args").get(0).path("value").asDouble(),
            0.0001,
            "left must be const 140");
        JsonNode mul = root.path("args").get(1);
        assertEquals("mul", mul.path("op").asText(), "right must be mul");
        assertEquals(2, mul.path("args").size(), "mul must be binary");
        assertEquals(
            0.55,
            mul.path("args").get(0).path("value").asDouble(),
            0.0001,
            "mul left must be const 0.55");
        assertEquals(
            "source.attr.ap.resolved",
            mul.path("args").get(1).path("path").asText(),
            "mul right must read AP resolved");
        assertBinaryArithmeticComparisonArity(root, "conquering_sands_one_soldier_primary_hit_damage");
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
