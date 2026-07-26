package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for
 * {@code lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql";

    private static final String README_RELATIVE = "server/data_manage/README.md";

    private static final List<String> STABLE_IDS = List.of(
        "hero_tristana",
        "provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed",
        "ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed",
        "rapid_fire_timed_bonus_attack_speed",
        "cost_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_mana",
        "cooldown_hero_tristana_q_rapid_fire_timed_bonus_attack_speed",
        "listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_ability_started",
        "sequence_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_arm",
        "step_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_active_arm",
        "modifier_hero_tristana_q_rapid_fire_timed_bonus_attack_speed",
        "rapid_fire_active",
        "rapid_fire_active_arm",
        "rapid_fire_attack_speed",
        "q_mana_cost",
        "q_cooldown_ms",
        "hero_tristana_q_rapid_fire_timed_bonus_attack_speed");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20130, 20160, 20172, 20173, 20181, 20190, 20205,
        20212, 20250);

    private static final List<String> FORBIDDEN_WRITE_TABLES = List.of(
        "attribute_definitions",
        "resource_definitions",
        "game_entities",
        "entity_attribute_values",
        "entity_resource_values");

    private static final List<String> ORDERED_TAGS = List.of(
        "ability_cost_cooldown",
        "active_attack_speed_modifier",
        "timed_state",
        "ability_type_listener_isolation");

    private static final String AS_BONUS =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1.20},"
            + "{\"op\":\"read\",\"path\":\"provider.state.rapid_fire_active\"}]}";

    private static final String FROZEN_BOUNDARY =
        "rank5_self_timed_bonus_attack_speed; duration_7000ms; "
            + "bonus_attack_speed_120_percent; "
            + "cooldown_16000ms_prevents_recast_before_expiry; "
            + "ability_type_listener_isolation_from_buster_shot; "
            + "no_rank_up_update_attack_animation_windup_basic_attack_count_"
            + "rotation_cooldown_bypass_other_ranks_or_full_fidelity";

    private static final String CANONICAL_SHA =
        "f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da";

    private static final String LOCAL_RAW_SHA =
        "db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170";

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
    void documentsSourceIdentityLocalCaveatBoundaryTagsAndWiki() {
        assertContains("hero_skill|hero_tristana|Q|急速射击");
        assertContains("wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed");
        assertContains("tristana-q-rapid-fire-timed-bonus-attack-speed-phase-a-v1");
        assertContains("Template:Data Tristana/Q");
        assertContains("Template:Data Tristana/Rapid Fire");
        assertContains("1308522");
        assertContains("4026462");
        assertContains("2026-06-09T21:59:03Z");
        assertContains("872");
        assertContains("866");
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
        assertContains("normalized/generic/tristana-q.json");
        assertContains(FROZEN_BOUNDARY);
        assertOrderedTagsInDeclarationBlock(sql, "seed");
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
    void documentsDeterministicFixturesNonRefreshTruthAndExclusions() {
        assertTrue(
            sql.contains("AS0.60") && sql.contains("1.32")
                && (sql.contains("t6999") || sql.contains("through6999")
                    || sql.contains("through t6999") || sql.contains("t0 through")),
            "seed comments must document baseline AS0.60 → active 1.32 through t6999");
        assertTrue(
            sql.contains("t7000") && (sql.contains("0.60") || sql.contains("baseline")),
            "seed comments must document return to baseline AS0.60 at t7000");
        assertTrue(
            sql.contains("mana105") && sql.contains("t0") && sql.contains("t15999")
                && sql.contains("t16000"),
            "seed comments must document mana105 timeline t0/t15999/t16000");
        assertTrue(
            (sql.contains("readyAt16000") || sql.contains("readyAt 16000"))
                && (sql.contains("final mana35") || sql.contains("mana35"))
                && sql.contains("two") && sql.contains("ability_started"),
            "seed comments must document two starts / readyAt16000 / final mana35");
        assertTrue(
            sql.contains("mana34") && (sql.contains("resource skip") || sql.contains("unchanged")),
            "seed comments must document mana34 resource skip");
        assertTrue(
            (sql.contains("R cast") || sql.contains("Buster Shot"))
                && (sql.contains("must not arm") || sql.contains("不得") || sql.contains("误武装")
                    || sql.contains("not arm Q")),
            "seed comments must document R cast must not arm Q");
        assertTrue(
            sql.contains("no R damage") || sql.contains("Q causes no R")
                || (sql.contains("无 R") && sql.contains("damage")),
            "seed comments must document Q causes no R damage");
        assertTrue(
            (sql.contains("16000") && sql.contains("7000"))
                && (sql.contains("non-refreshing") || sql.contains("无法 refresh")
                    || sql.contains("无法refresh") || sql.contains("不能 refresh")
                    || sql.contains("正常路径无法")),
            "seed must document normal non-refreshing truth CD16000 > duration7000");
        assertTrue(
            sql.contains("不 claim") || sql.contains("不得把 runtime")
                || sql.contains("不 claim runtime") || sql.contains("non-refresh"),
            "seed must not claim runtime refresh_policy itself is non-refresh");
        assertTrue(
            sql.contains("cooldown bypass") || sql.contains("CD bypass")
                || sql.contains("bypass"),
            "seed must explicitly exclude cooldown bypass/reset");
        assertTrue(
            sql.contains("direct state admin") || sql.contains("state admin"),
            "seed must explicitly exclude direct state admin");
        assertTrue(
            sql.contains("rank-up") || sql.contains("rank_up"),
            "seed must explicitly exclude rank-up update");
        assertTrue(
            sql.contains("不执行 runtime") || sql.contains("本 SQL 测试亦不")
                || sql.contains("不连 live / 不执行"),
            "seed must clarify fixtures are comments-only; SQL test does not execute runtime");
        assertTrue(
            sql.contains("full fidelity") || sql.contains("全保真") || sql.contains("不 claim"),
            "seed must not claim full fidelity");
        assertTrue(
            sql.contains("coexist") || sql.contains("并存"),
            "seed must document coexistence with R without dependency/synthesis");
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
            "rapid-fire seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoComments).find(),
            "rapid-fire seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoComments).find(),
            "rapid-fire seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "rapid-fire seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoComments).find(),
            "rapid-fire seed must not CREATE TABLE");
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
    void validatesCheckOnlyExternalHeroTristanaAttackSpeedManaAndNoMaterializer() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing game_entities hero_tristana");
        assertContains("missing attribute_definitions");
        assertContains("attack_speed");
        assertContains("missing entity_attribute_values hero_tristana/attack_speed");
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
                    "(?is)FROM\\s+public\\.attribute_definitions\\b[\\s\\S]{0,200}"
                        + "attr_key\\s*=\\s*'attack_speed'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check attribute_definitions attack_speed");
        assertTrue(
            Pattern.compile(
                    "(?is)FROM\\s+public\\.entity_attribute_values\\b[\\s\\S]{0,240}"
                        + "attr_key\\s*=\\s*'attack_speed'")
                .matcher(sqlNoComments)
                .find(),
            "must SELECT/EXISTS-check entity_attribute_values hero_tristana/attack_speed");
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
    void ensuresGameLocalAbilityType62013WithBidirectionalCollisionGuards() {
        assertContains("62013");
        assertContains("ability/tristana_rapid_fire");
        assertTrue(
            Pattern.compile("(?i)type_id=62013 already bound").matcher(sql).find(),
            "must dual-unique fail-closed guard ability/tristana_rapid_fire 62013");
        assertTrue(
            Pattern.compile("(?i)type_key=ability/tristana_rapid_fire already bound")
                .matcher(sql)
                .find(),
            "must dual-unique fail-closed guard ability/tristana_rapid_fire type_key");
        assertTrue(
            Pattern.compile(
                    "(?is)type_id\\s*=\\s*62013[\\s\\S]{0,400}"
                        + "reserved_type_id\\s+IS\\s+NOT\\s+NULL")
                .matcher(sqlNoComments)
                .find(),
            "62013 type-id fail-closed guard must treat non-null reserved_type_id as conflict");
        assertTrue(
            Pattern.compile(
                    "(?s)62013\\s*,\\s*'ability/tristana_rapid_fire'[\\s\\S]{0,400}NULL")
                .matcher(sql)
                .find(),
            "62013 must bind with reserved_type_id=NULL");
        assertTrue(
            Pattern.compile(
                    "(?s)62013\\s*,\\s*'ability'\\s*,\\s*"
                        + "'ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'")
                .matcher(sql)
                .find(),
            "must type_relations 62013 → Q ability");
        assertFalse(
            Pattern.compile("(?is)ability_kind_type_id\\s*=\\s*62013")
                .matcher(sqlNoComments)
                .find(),
            "must not write 62013 into ability_kind_type_id");
    }

    @Test
    void mountsIsolatedProviderAbilityCostCooldownStateModifierListenerAndMount() {
        assertContains("provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed");
        assertContains("hero_tristana_q_rapid_fire_timed_bonus_attack_speed");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'"
                        + "[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Rapid Fire provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_tristana'\\s*,\\s*"
                        + "'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'")
                .matcher(sql)
                .find(),
            "must mount Rapid Fire provider to hero_tristana");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly one dedicated Rapid Fire provider");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider (Q Rapid Fire only)");
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
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_state_fields"),
            "must define exactly one timed state field");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_modifiers"),
            "must define exactly one AS modifier");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.provider_listeners"),
            "must define exactly one listener");
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
            countOccurrences(sqlNoComments, "INSERT INTO public.state_effect_details"),
            "must define exactly one state_effect_details");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.type_relations"),
            "must define exactly one type_relations row");
        assertEquals(
            1,
            countOccurrences(sqlNoComments, "INSERT INTO public.listener_effect_sequences"),
            "must define exactly one listener_effect_sequences link");
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertTrue(
            Pattern.compile(
                    "(?s)'ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'\\s*,\\s*"
                        + "'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'\\s*,\\s*"
                        + "'rapid_fire_timed_bonus_attack_speed'\\s*,\\s*20130")
                .matcher(sql)
                .find(),
            "Q must be active ability with stable key rapid_fire_timed_bonus_attack_speed");
        assertContains("{\"op\":\"const\",\"value\":35}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cost_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_mana'\\s*,\\s*"
                        + "'ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'\\s*,\\s*"
                        + "NULL\\s*,\\s*'mana'\\s*,\\s*'q_mana_cost'\\s*,\\s*false")
                .matcher(sql)
                .find(),
            "Q mana cost must be ability-level 35 via ability_costs");
        assertContains("{\"op\":\"const\",\"value\":16000}");
        assertTrue(
            Pattern.compile(
                    "(?s)'cooldown_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'\\s*,\\s*"
                        + "'ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'\\s*,\\s*"
                        + "'q_cooldown_ms'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "Q cooldown must be 16000ms via ability_cooldowns");
        assertFalse(
            Pattern.compile(
                    "(?is)'provider_hero_tristana_[pwer]_|'ability_hero_tristana_[pwer]_|"
                        + "'provider_hero_tristana_basic_|'ability_hero_tristana_basic_|"
                        + "explosive_charge|buster_shot")
                .matcher(sqlNoComments)
                .find(),
            "executable SQL must not create/mutate P/W/E/R/basic/Explosive Charge/Buster Shot rows");
    }

    @Test
    void definesTimedRapidFireActiveAndStateDrivenAttackSpeedPercentAdd() {
        assertTrue(
            Pattern.compile(
                    "(?s)'rapid_fire_active'[\\s\\S]{0,40}20100[\\s\\S]{0,20}1"
                        + "[\\s\\S]{0,20}7000[\\s\\S]{0,20}20190")
                .matcher(sql)
                .find(),
            "rapid_fire_active max1 / 7000ms / refresh_duration 20190");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoComments).find(),
            "seed must not write default_value");
        assertContains(AS_BONUS);
        assertContains("\"value\":1.20");
        assertContains("20173");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'"
                        + "[\\s\\S]{0,300}'attack_speed'[\\s\\S]{0,120}20173\\s*,\\s*"
                        + "'rapid_fire_attack_speed'\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "AS modifier must be percent_add with NULL condition_formula_key");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_active_arm'"
                        + "\\s*,\\s*20250\\s*,\\s*'rapid_fire_active'\\s*,\\s*"
                        + "'rapid_fire_active_arm'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "listener sequence must override/set rapid_fire_active=1");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            countOccurrences(
                    sql,
                    "'step_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_active_arm'")
                >= 2,
            "arm step must appear in effect_steps and state_effect_details");
    }

    @Test
    void abilityStartedListenerArmsViaAbilityTypeMatcherNotAbilityRef() {
        assertContains(
            "listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_ability_started");
        assertContains("sequence_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_arm");
        assertContains("step_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_active_arm");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed"
                        + "_ability_started'\\s*,\\s*"
                        + "'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'\\s*,\\s*"
                        + "'rapid_fire_on_ability_started'\\s*,\\s*20205\\s*,\\s*"
                        + "NULL")
                .matcher(sql)
                .find(),
            "listener ability_id must be NULL (AbilityRef is not an event filter)");
        assertFalse(
            Pattern.compile(
                    "(?s)'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed"
                        + "_ability_started'[\\s\\S]{0,220}"
                        + "'ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'")
                .matcher(sqlNoComments)
                .find(),
            "executable listener row must not bind ability_id to Q ability");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed"
                        + "_ability_started'\\s*,\\s*20181\\s*,\\s*20205")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20205");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed"
                        + "_ability_started'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 20212 source_owner");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed"
                        + "_ability_started'\\s*,\\s*20181\\s*,\\s*62013")
                .matcher(sql)
                .find(),
            "ability_started listener must ALL-match 62013 ability/tristana_rapid_fire");
        assertEquals(
            3,
            countOccurrences(
                sqlNoComments,
                "'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed"
                    + "_ability_started', 20181,"),
            "Q listener must declare exactly three ALL match types {20205,20212,62013}");
        assertTrue(
            sql.contains("AbilityRef") || sql.contains("castAbilityAt")
                || sql.contains("不是事件过滤"),
            "seed must document why listener.ability_id must stay NULL");
        assertTrue(
            sql.contains("Buster Shot") || sql.contains("误武装") || sql.contains("isolation"),
            "seed must document isolation from Buster Shot / R ability_started");
    }

    @Test
    void rejectsDamageHealShieldControlRepeatPhasesAndExplicitEvents() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_phases\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write ability_phases");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write damage_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.heal_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write heal_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.shield_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write shield_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.control_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write control_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.repeat_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write repeat_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.event_effect_details\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write event_effect_details");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_phase_effect_sequences\\b")
                .matcher(sqlNoComments)
                .find(),
            "must not write ability_phase_effect_sequences");
        assertFalse(
            Pattern.compile(
                    "(?i)rank.?up|attack.?animation|windup|basic.?attack.?count|"
                        + "rotation|cooldown.?bypass|cooldown.?reset|"
                        + "direct.?state.?admin")
                .matcher(sqlNoComments)
                .find(),
            "must not model excluded rank-up/windup/rotation/CD-bypass surfaces in executable SQL");
        assertTrue(
            Pattern.compile(
                    "(?i)rank-up|attack animation|windup|basic attack count|"
                        + "rotation|cooldown bypass|full fidelity")
                .matcher(sql)
                .find(),
            "seed comments must document out-of-scope exclusions");
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
    }

    @Test
    void readmeEntryDocumentsPrerequisitesIsolationFixturesExclusionsAndNoMaterializer() {
        assertTrue(
            readme.contains(
                "lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql"),
            "README must list the Tristana Q Rapid Fire seed");
        assertTrue(
            readme.contains("LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest"),
            "README must list the focused JUnit class");
        assertTrue(
            Pattern.compile("(?is)tristana.*rapid|急速射击|Rapid Fire")
                .matcher(readme)
                .find(),
            "README must name Tristana Rapid Fire");
        int seedIdx = readme.indexOf(
            "lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql");
        assertTrue(seedIdx >= 0, "seed path must appear in README");
        int sectionStart = readme.lastIndexOf("### ", seedIdx);
        int sectionEnd = readme.indexOf("\n### ", seedIdx);
        if (sectionEnd < 0) {
            sectionEnd = readme.length();
        }
        String section = readme.substring(sectionStart, sectionEnd);
        assertTrue(
            section.contains("wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed"),
            "README entry must name the task key");
        assertTrue(
            section.contains("tristana-q-rapid-fire-timed-bonus-attack-speed-phase-a-v1"),
            "README entry must name the frozen plan rev");
        assertTrue(
            section.contains(FROZEN_BOUNDARY)
                || section.contains("bonus_attack_speed_120_percent"),
            "README must include frozen boundary");
        assertOrderedTagsInDeclarationBlock(section, "README");
        assertTrue(
            section.contains("1308522") && section.contains("4026462")
                && section.contains(CANONICAL_SHA),
            "README must document Wiki page/rev/canonical SHA");
        assertTrue(
            section.contains(LOCAL_RAW_SHA)
                && (section.contains("local raw") || section.contains("materialization caveat")
                    || section.contains("不断言") || section.contains("不等于等价")),
            "README must document local raw caveat");
        assertTrue(
            section.contains("872") && section.contains("866"),
            "README must document canonical 872 and local raw 866 byte sizes");
        assertTrue(
            Pattern.compile("(?i)35.*mana|mana.?35|35 mana").matcher(section).find()
                && section.contains("16000") && section.contains("7000"),
            "README must document mana35 / CD16000 / duration7000");
        assertTrue(
            section.contains("1.20") && section.contains("percent_add")
                && section.contains("62013")
                && section.contains("ability/tristana_rapid_fire"),
            "README must document AS formula and 62013 isolation type");
        assertTrue(
            section.contains("ability_id") && (section.contains("NULL") || section.contains("null")),
            "README must document listener ability_id NULL isolation");
        assertTrue(
            Pattern.compile("(?i)check-only|check only|外部既有|external existing")
                .matcher(section)
                .find(),
            "README entry must say external existing-data / check-only");
        assertTrue(
            section.contains("无 seed") || section.contains("无 materializer")
                || section.contains("没有任何 seed") || section.contains("不负责物化")
                || section.contains("亦无 seed"),
            "README must warn that no repository materializer exists for Tristana");
        assertTrue(
            (section.contains("Buster Shot") || section.contains("并存")
                    || section.contains("coexist"))
                && (section.contains("不依赖") || section.contains("不合成")
                    || section.contains("no dependency")),
            "README must document coexist with R without dependency/synthesis");
        assertTrue(
            section.contains("AS0.60") || section.contains("1.32")
                || section.contains("mana105") || section.contains("mana34"),
            "README must document deterministic runtime fixtures");
        assertTrue(
            Pattern.compile(
                    "(?i)排除|exclusion|rank-up|windup|cooldown bypass|full fidelity|"
                        + "attack animation")
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
            section.contains("LolGenericXayahDeadlyPlumageSeedSqlTest")
                || section.contains("LolGenericKaisaSuperchargeSeedSqlTest")
                || section.contains("LolGenericVayneFinalHourTimedBonusAdSeedSqlTest")
                || section.contains("LolGenericTristanaBusterShotPrimaryHitSeedSqlTest"),
            "README static validation must cite adjacent Xayah W / Kai'Sa E / Vayne R / Tristana R precedents");
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
