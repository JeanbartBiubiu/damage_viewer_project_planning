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
 * Static contract for {@code lol_generic_yun_tal_flurry_3032_seed.sql}.
 * Does not connect to a live database.
 *
 * <p>Stable IDs (Flurry / 疾风骤雨 / item_3032):
 * <ul>
 *   <li>{@code provider_item_3032_yun_tal_flurry}</li>
 *   <li>{@code listener_item_3032_yun_tal_flurry}</li>
 *   <li>{@code sequence_item_3032_yun_tal_flurry}</li>
 *   <li>{@code step_item_3032_yun_tal_flurry_arm_active/cooldown/cd_reduce}</li>
 *   <li>{@code modifier_item_3032_yun_tal_flurry_as}</li>
 * </ul>
 */
class LolGenericYunTalFlurry3032SeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_yun_tal_flurry_3032_seed.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final String COOLDOWN_ZERO =
        "{\"op\":\"eq\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.flurry_cooldown\"},"
            + "{\"op\":\"const\",\"value\":0}]}";
    private static final String FLURRY_ARM_ACTIVE =
        "{\"op\":\"const\",\"value\":1}";
    private static final String FLURRY_ARM_COOLDOWN =
        "{\"op\":\"const\",\"value\":1}";
    private static final String FLURRY_ATTACK_SPEED =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.30},"
            + "{\"op\":\"read\",\"path\":\"provider.state.flurry_active\"}]}";
    private static final String FLURRY_COOLDOWN_REDUCE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":1000},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":1000},"
            + "{\"op\":\"clamp\",\"expr\":{\"op\":\"read\","
            + "\"path\":\"event.damage.effectiveCritChance\"},"
            + "\"min\":{\"op\":\"const\",\"value\":0},"
            + "\"max\":{\"op\":\"const\",\"value\":1}}]}]}";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3032_yun_tal_flurry",
        "listener_item_3032_yun_tal_flurry",
        "sequence_item_3032_yun_tal_flurry",
        "step_item_3032_yun_tal_flurry_arm_active",
        "step_item_3032_yun_tal_flurry_arm_cooldown",
        "step_item_3032_yun_tal_flurry_cd_reduce",
        "modifier_item_3032_yun_tal_flurry_as",
        "flurry_active",
        "flurry_cooldown",
        "cooldown_zero",
        "flurry_arm_active",
        "flurry_arm_cooldown",
        "flurry_attack_speed",
        "flurry_cooldown_reduce",
        "item_3032");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20160, 20172, 20173, 20176, 20181, 20190,
        20212, 20217, 20250, 20281);

    private static String sql;
    private static String sqlNoLineComments;
    private static String reservedSql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
        reservedSql = Files.readString(resolveRelative(RESERVED_RELATIVE), StandardCharsets.UTF_8);
    }

    @Test
    void usesTransactionLockCandidateAndIdempotentRevisionGuard() {
        assertTrue(sql.trim().startsWith("BEGIN;") || sql.contains("\nBEGIN;\n"), "must BEGIN");
        assertTrue(
            sql.trim().endsWith("COMMIT;")
                || sql.contains("\nCOMMIT;\n")
                || sql.endsWith("COMMIT;\n"),
            "must COMMIT");
        assertContains("DO $$");
        assertContains("ensure_game_partitions");
        assertContains("FOR UPDATE");
        assertContains("game_data_state");
        assertTrue(
            Pattern.compile("v_candidate\\s*:=\\s*v_locked_current\\s*\\+\\s*1")
                .matcher(sqlNoLineComments)
                .find(),
            "candidate must be locked current_revision + 1");
        assertTrue(
            Pattern.compile("(?is)IF\\s+v_changed\\s+THEN").matcher(sqlNoLineComments).find(),
            "must guard current_revision bump with v_changed");
        assertTrue(
            Pattern.compile("current_revision\\s*=\\s*v_candidate")
                .matcher(sqlNoLineComments)
                .find(),
            "must advance current_revision to candidate when changed");
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
        assertTrue(
            Pattern.compile("change_revision\\s*>\\s*v_locked_current")
                .matcher(sqlNoLineComments)
                .find(),
            "match/link/mount idempotent guards must use change_revision > v_locked_current");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoLineComments).find(),
            "seed must not call publish API markers");
        assertFalse(
            Pattern.compile("(?is)\\bcurrent_revision\\s*=\\s*\\d+")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not hardcode revision numbers");
    }

    @Test
    void rejectsDestructivePublishAndLegacySurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "seed must not CREATE TABLE");
        assertFalse(
            Pattern.compile("(?i)\\bbundle\\b").matcher(sqlNoLineComments).find(),
            "must not write Bundle surfaces");
        assertFalse(
            Pattern.compile("(?i)\\bcatalog\\b").matcher(sqlNoLineComments).find(),
            "must not write Catalog surfaces");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.(heroes|items|skills)\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write legacy heroes/items/skills tables");
        assertFalse(
            Pattern.compile("(?i)live\\s*migration").matcher(sqlNoLineComments).find(),
            "must not perform live migration");
        assertFalse(
            Pattern.compile("(?i)migrations/").matcher(sqlNoLineComments).find(),
            "must not reference migration paths in executable SQL");
        assertFalse(
            Pattern.compile("(?i)ddragon").matcher(sqlNoLineComments).find(),
            "must not reference DDragon in executable SQL");
    }

    @Test
    void documentsWikiManifestHashAndFlurryNumbers() {
        assertContains("4030984");
        assertContains("e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d");
        assertTrue(
            Pattern.compile("(?i)current-items\\.raw\\.lua|raw\\s+Lua|manifest\\.json")
                .matcher(sql)
                .find(),
            "comments must name League Wiki manifest/raw Lua");
        assertTrue(
            Pattern.compile("(?i)Flurry|疾风骤雨").matcher(sql).find(),
            "must name Flurry / 疾风骤雨");
        assertTrue(
            Pattern.compile("(?i)Yun\\s+Tal|育恩塔尔").matcher(sql).find(),
            "must name Yun Tal");
        assertTrue(
            Pattern.compile("(?i)default0").matcher(sql).find(),
            "must document runtime default0 for state fields");
        assertTrue(
            Pattern.compile("(?i)refresh_on_write").matcher(sql).find(),
            "must document refresh_on_write");
        assertTrue(
            Pattern.compile("(?i)no\\s+DDragon|不使用\\s*DDragon|不.*DDragon").matcher(sql).find()
                || sql.contains("不使用 DDragon"),
            "comments must forbid DDragon");
        assertTrue(
            Pattern.compile("(?i)RNG|projectile|Arena|Practice Makes Lethal")
                .matcher(sql)
                .find(),
            "must explicitly exclude RNG / projectile / Arena / Practice Makes Lethal");
        assertTrue(
            sql.contains("0.30") && sql.contains("6000") && sql.contains("30000"),
            "must document Wiki AS 0.30 / active 6000ms / cooldown 30000ms");
        assertTrue(
            sql.contains("1000") && sql.contains("effectiveCritChance"),
            "must document CD reduce 1000 + 1000*effectiveCritChance");
    }

    @Test
    void reservedSeedDefinesStateDurationChange20281() {
        assertTrue(
            reservedSql.contains("'operation/state_duration_change'"),
            "reserved vocabulary must define operation/state_duration_change");
        assertTrue(
            reservedSql.contains("(20281,"),
            "reserved vocabulary must allocate type_id 20281");
        assertTrue(
            reservedSql.contains("(20281, 10015)"),
            "20281 must relate to operation parent 10015");
        assertFalse(
            Pattern.compile("(?s)\\(20281,[^)]*operation/(?!state_duration_change)")
                .matcher(reservedSql)
                .find(),
            "20281 must not be occupied by a different operation key");
        assertTrue(
            reservedSql.contains("'value_policy/subtract'")
                && reservedSql.contains("(20176,"),
            "must keep prerequisite 20176 value_policy/subtract");
        assertTrue(
            reservedSql.contains("'event/damage_instance'")
                && reservedSql.contains("(20217,"),
            "must keep prerequisite 20217 event/damage_instance");
    }

    @Test
    void doesNotWriteBatchCStaticEntityOrAttributeRows() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entities\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write game_entities (Batch-C static rows stay untouched)");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write entity_attribute_values (Batch-C static attrs stay untouched)");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.game_entity_attributes\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write game_entity_attributes");
        assertFalse(
            Pattern.compile("(?is)UPDATE\\s+public\\.entity_attribute_values\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not UPDATE entity_attribute_values");
    }

    @Test
    void doesNotTouchPracticeMakesLethalContracts() {
        assertFalse(
            sqlNoLineComments.contains("provider_item_3032_yun_tal_practice_makes_lethal"),
            "must not reference Practice Makes Lethal provider id in executable SQL");
        assertFalse(
            sqlNoLineComments.contains("practice_crit_stacks"),
            "must not write Practice Makes Lethal state keys");
        assertFalse(
            sqlNoLineComments.contains("practice_crit_chance"),
            "must not write Practice Makes Lethal formulas/modifiers");
        assertFalse(
            sqlNoLineComments.contains("listener_item_3032_yun_tal_practice_makes_lethal"),
            "must not touch Practice Makes Lethal listener");
    }

    @Test
    void validatesPrerequisitesWithoutRecreatingBatchC() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("item_3032");
        assertTrue(
            Pattern.compile("(?is)entity_id\\s*=\\s*'item_3032'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight game_entities item_3032");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'attack_speed'")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight attribute_definitions attack_speed");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void ensuresGameLocalBasicAttackType() {
        assertTrue(
            Pattern.compile("(?is)type_id\\s*=\\s*62003[\\s\\S]*?ability/basic_attack")
                .matcher(sqlNoLineComments)
                .find(),
            "must ensure 62003 ability/basic_attack");
        assertTrue(
            sqlNoLineComments.contains("62003")
                && sqlNoLineComments.contains("'ability/basic_attack'")
                && Pattern.compile("(?is)62003[\\s\\S]{0,200}NULL").matcher(sqlNoLineComments).find(),
            "62003 reserved_type_id must be NULL");
        assertTrue(
            Pattern.compile("(?i)already bound to type_key").matcher(sql).find(),
            "must raise on type_id collision");
        assertTrue(
            Pattern.compile("(?i)already bound to type_id").matcher(sql).find(),
            "must raise on type_key collision");
    }

    @Test
    void assertsProviderStatesFormulasModifierAndSingleMount() {
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
        for (Integer reservedId : REQUIRED_RESERVED) {
            assertTrue(
                sqlNoLineComments.contains(String.valueOf(reservedId)),
                "must reference reserved id " + reservedId);
        }

        assertTrue(
            Pattern.compile(
                    "(?s)'flurry_active'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}6000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "flurry_active must be number/max1/6000ms/refresh_duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'flurry_cooldown'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}30000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "flurry_cooldown must be number/max1/30000ms/refresh_duration");
        assertFalse(
            Pattern.compile("(?i)default_value").matcher(sqlNoLineComments).find(),
            "seed must not write default_value");

        assertTrue(
            sqlNoLineComments.contains(COOLDOWN_ZERO)
                || sqlNoLineComments.replace(" ", "").contains(COOLDOWN_ZERO.replace(" ", "")),
            "cooldown_zero formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(FLURRY_ARM_ACTIVE)
                || sqlNoLineComments.replace(" ", "")
                    .contains(FLURRY_ARM_ACTIVE.replace(" ", "")),
            "flurry_arm_active formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(FLURRY_ARM_COOLDOWN)
                || sqlNoLineComments.replace(" ", "")
                    .contains(FLURRY_ARM_COOLDOWN.replace(" ", "")),
            "flurry_arm_cooldown formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(FLURRY_ATTACK_SPEED)
                || sqlNoLineComments.replace(" ", "")
                    .contains(FLURRY_ATTACK_SPEED.replace(" ", "")),
            "flurry_attack_speed formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(FLURRY_COOLDOWN_REDUCE)
                || sqlNoLineComments.replace(" ", "")
                    .contains(FLURRY_COOLDOWN_REDUCE.replace(" ", "")),
            "flurry_cooldown_reduce formula must match Wiki effectiveCritChance contract");

        assertTrue(
            Pattern.compile(
                    "(?is)modifier_item_3032_yun_tal_flurry_as[\\s\\S]*?20110[\\s\\S]*?"
                        + "'attack_speed'[\\s\\S]*?20173")
                .matcher(sqlNoLineComments)
                .find(),
            "AS modifier must be self/attack_speed/percent_add 20173");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define exactly one provider_modifiers insert block");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_3032'\\s*,\\s*'provider_item_3032_yun_tal_flurry'")
                .matcher(sql)
                .find(),
            "must mount Flurry provider to item_3032");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once via entity_provider_mounts (second mount on item_3032)");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider_definitions insert block");
        assertFalse(
            Pattern.compile("(?s)'item_(?!3032')\\w+'\\s*,\\s*'provider_item_3032_yun_tal_flurry'")
                .matcher(sql)
                .find(),
            "must not mount this provider to entities other than item_3032");
    }

    @Test
    void assertsDamageInstanceListenerThrottleAndOrderedSteps() {
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3032_yun_tal_flurry'[\\s\\S]{0,240}20217"
                        + "[\\s\\S]{0,80}1[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "listener must be damage_instance 20217 with max_triggers_per_event=1"
                + " and per_cast_throttle_ms=1");
        assertTrue(
            sqlNoLineComments.contains("per_cast_throttle_ms"),
            "listener insert must project per_cast_throttle_ms");
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3032_yun_tal_flurry', 20181, 20217"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3032_yun_tal_flurry', 20181, 62003"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3032_yun_tal_flurry', 20181, 20212"));
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_listeners"),
            "must define exactly one provider_listeners insert block");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3032_yun_tal_flurry_arm_active'\\s*,\\s*"
                        + "'sequence_item_3032_yun_tal_flurry'\\s*,\\s*0\\s*,\\s*20160"
                        + "[\\s\\S]{0,40}20110[\\s\\S]{0,40}'cooldown_zero'")
                .matcher(sql)
                .find(),
            "step 0 must conditional override active when cooldown_zero");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3032_yun_tal_flurry_arm_cooldown'\\s*,\\s*"
                        + "'sequence_item_3032_yun_tal_flurry'\\s*,\\s*1\\s*,\\s*20160"
                        + "[\\s\\S]{0,40}20110[\\s\\S]{0,40}'cooldown_zero'")
                .matcher(sql)
                .find(),
            "step 1 must conditional override cooldown when cooldown_zero");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3032_yun_tal_flurry_cd_reduce'\\s*,\\s*"
                        + "'sequence_item_3032_yun_tal_flurry'\\s*,\\s*2\\s*,\\s*20281"
                        + "[\\s\\S]{0,40}20110[\\s\\S]{0,40}NULL")
                .matcher(sql)
                .find(),
            "step 2 must be unconditional state_duration_change 20281");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3032_yun_tal_flurry_arm_active'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,80}flurry_active[\\s\\S]{0,80}"
                        + "flurry_arm_active[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "arm active detail must be provider-scope override");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3032_yun_tal_flurry_arm_cooldown'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,80}flurry_cooldown[\\s\\S]{0,80}"
                        + "flurry_arm_cooldown[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find(),
            "arm cooldown detail must be provider-scope override");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3032_yun_tal_flurry_cd_reduce'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,80}flurry_cooldown[\\s\\S]{0,80}"
                        + "flurry_cooldown_reduce[\\s\\S]{0,40}20176")
                .matcher(sql)
                .find(),
            "cd reduce detail must subtract remaining duration via 20176");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3032_yun_tal_flurry'\\s*,\\s*"
                        + "'sequence_item_3032_yun_tal_flurry'")
                .matcher(sql)
                .find(),
            "listener must attach flurry sequence");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_steps"),
            "must define exactly one effect_steps insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.state_effect_details"),
            "must define exactly one state_effect_details insert block");
    }

    @Test
    void stableIdsAreUniqueAndExcludedBranchesNotExecutable() {
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "duplicate stable id in test list: " + id);
            assertTrue(sql.contains(id), "missing stable id: " + id);
        }
        assertFalse(
            Pattern.compile("(?i)seeded_random|crit_roll|random\\s*crit|暴击事件")
                .matcher(sqlNoLineComments)
                .find(),
            "RNG / random crit must not be executable contracts");
        assertFalse(
            Pattern.compile("(?i)projectile|missile|多段投射")
                .matcher(sqlNoLineComments)
                .find(),
            "projectile branch must not be executable contracts");
        assertFalse(
            Pattern.compile("(?i)item_223032|2223032|arena_3032|provider_item_3032_arena")
                .matcher(sqlNoLineComments)
                .find(),
            "Arena branch must not be executable contracts");
        assertFalse(
            Pattern.compile("(?i)basic_attack_started")
                .matcher(sqlNoLineComments)
                .find(),
            "must not introduce event/basic_attack_started");
        assertFalse(
            Pattern.compile("(?i)ddragon")
                .matcher(sqlNoLineComments)
                .find(),
            "DDragon must not appear in executable SQL");
    }

    private static void assertContains(String needle) {
        assertTrue(sql.contains(needle), "missing: " + needle);
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int from = 0;
        while (true) {
            int at = haystack.indexOf(needle, from);
            if (at < 0) {
                return count;
            }
            count++;
            from = at + needle.length();
        }
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
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
