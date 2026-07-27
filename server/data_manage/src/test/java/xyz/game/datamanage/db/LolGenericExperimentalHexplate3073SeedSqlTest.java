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
 * Static contract for {@code lol_generic_experimental_hexplate_3073_seed.sql}.
 * Does not connect to a live database.
 *
 * <p>Stable IDs (Overdrive / item_3073):
 * <ul>
 *   <li>{@code provider_item_3073_overdrive}</li>
 *   <li>{@code ability_item_3073_overdrive_ultimate}</li>
 *   <li>{@code listener_item_3073_overdrive_arm}</li>
 *   <li>{@code modifier_item_3073_overdrive_as}</li>
 *   <li>{@code sequence_item_3073_overdrive_arm}</li>
 *   <li>{@code step_item_3073_overdrive_arm_active/cooldown}</li>
 * </ul>
 */
class LolGenericExperimentalHexplate3073SeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_experimental_hexplate_3073_seed.sql";

    private static final String COOLDOWN_ZERO =
        "{\"op\":\"eq\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.overdrive_cooldown\"},"
            + "{\"op\":\"const\",\"value\":0}]}";
    private static final String OVERDRIVE_ARM_ACTIVE =
        "{\"op\":\"const\",\"value\":1}";
    private static final String OVERDRIVE_ARM_COOLDOWN =
        "{\"op\":\"const\",\"value\":1}";
    private static final String OVERDRIVE_ATTACK_SPEED =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.50},"
            + "{\"op\":\"read\",\"path\":\"provider.state.overdrive_active\"}]}";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3073_overdrive",
        "ability_item_3073_overdrive_ultimate",
        "listener_item_3073_overdrive_arm",
        "sequence_item_3073_overdrive_arm",
        "step_item_3073_overdrive_arm_active",
        "step_item_3073_overdrive_arm_cooldown",
        "modifier_item_3073_overdrive_as",
        "overdrive_active",
        "overdrive_cooldown",
        "overdrive_ultimate",
        "overdrive_arm_active",
        "overdrive_arm_cooldown",
        "overdrive_attack_speed",
        "cooldown_zero",
        "item_3073");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20130, 20160, 20172, 20173, 20181, 20190,
        20205, 20212, 20250);

    private static String sql;
    private static String sqlNoLineComments;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        sqlNoLineComments = stripLineComments(sql);
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
    void documentsWikiManifestRawLuaHashAndClassicStats() {
        assertContains("4030984");
        assertContains("e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d");
        assertTrue(
            Pattern.compile("(?i)current-items\\.raw\\.lua|raw\\s+Lua|manifest\\.json")
                .matcher(sql)
                .find(),
            "comments must name League Wiki manifest/raw Lua");
        assertTrue(
            Pattern.compile("(?i)Overdrive|过载").matcher(sql).find(),
            "must name Overdrive");
        assertTrue(
            Pattern.compile("(?i)Experimental\\s+Hexplate|海克斯注力刚壁|Hexplate").matcher(sql).find(),
            "must name Experimental Hexplate");
        assertTrue(
            sqlNoLineComments.contains("'ad', 40")
                || sqlNoLineComments.contains("'ad',40"),
            "must upsert Wiki ad=40");
        assertTrue(
            sqlNoLineComments.contains("'attack_speed', 0.20")
                || sqlNoLineComments.contains("'attack_speed',0.20"),
            "must upsert Wiki attack_speed=0.20");
        assertTrue(
            sqlNoLineComments.contains("'hp', 450")
                || sqlNoLineComments.contains("'hp',450"),
            "must upsert Wiki hp=450");
        assertTrue(
            Pattern.compile("(?i)default0").matcher(sql).find(),
            "must document runtime default0 for state fields");
        assertTrue(
            Pattern.compile("(?i)no\\s+DDragon|不使用\\s*DDragon|不.*DDragon").matcher(sql).find()
                || sql.contains("不使用 DDragon"),
            "comments must forbid DDragon");
        assertTrue(
            Pattern.compile("(?i)Hexcharged|ultimate\\s+haste|melee|Arena|movement\\s+speed")
                .matcher(sql)
                .find(),
            "must explicitly exclude Hexcharged / ultimate haste / melee / Arena / movement speed");
    }

    @Test
    void ensuresGameLocalUltimateTypeAndHarnessAbility() {
        assertTrue(
            Pattern.compile("(?is)type_id\\s*=\\s*62010[\\s\\S]*?ability/ultimate")
                .matcher(sqlNoLineComments)
                .find(),
            "must ensure 62010 ability/ultimate");
        assertTrue(
            sqlNoLineComments.contains("62010")
                && sqlNoLineComments.contains("'ability/ultimate'")
                && Pattern.compile("(?is)62010[\\s\\S]{0,200}NULL").matcher(sqlNoLineComments).find(),
            "62010 reserved_type_id must be NULL");
        assertTrue(
            Pattern.compile("(?i)already bound to type_key").matcher(sql).find(),
            "must raise on type_id collision");
        assertTrue(
            Pattern.compile("(?i)already bound to type_id").matcher(sql).find(),
            "must raise on type_key collision");
        assertFalse(
            Pattern.compile("(?is)ability_kind_type_id\\s*,?[\\s\\S]{0,40}62010")
                .matcher(sqlNoLineComments)
                .find(),
            "must not put 62010 in ability_kind_type_id");
        assertTrue(
            sqlNoLineComments.contains("'ability_item_3073_overdrive_ultimate'")
                && sqlNoLineComments.contains("20130")
                && sqlNoLineComments.contains("'champion'"),
            "ultimate ability must be kind 20130 with cast_origin champion");
        assertTrue(
            Pattern.compile(
                    "(?is)62010\\s*,\\s*'ability'\\s*,\\s*"
                        + "'ability_item_3073_overdrive_ultimate'")
                .matcher(sqlNoLineComments)
                .find(),
            "must type_relations 62010 → ultimate ability");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.ability_definitions"),
            "must define exactly one ability_definitions insert block");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.effect_steps\\b[\\s\\S]*?"
                    + "ability_item_3073_overdrive_ultimate")
                .matcher(sqlNoLineComments)
                .find(),
            "harness ultimate must have no operation steps");
    }

    @Test
    void assertsProviderStatesFormulasModifierAndMount() {
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
                    "(?s)'overdrive_active'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}8000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "overdrive_active must be number/max1/8000ms/refresh_duration");
        assertTrue(
            Pattern.compile(
                    "(?s)'overdrive_cooldown'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}30000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "overdrive_cooldown must be number/max1/30000ms/refresh_duration");

        assertTrue(
            sqlNoLineComments.contains(COOLDOWN_ZERO)
                || sqlNoLineComments.replace(" ", "").contains(COOLDOWN_ZERO.replace(" ", "")),
            "cooldown_zero formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(OVERDRIVE_ARM_ACTIVE)
                || sqlNoLineComments.replace(" ", "")
                    .contains(OVERDRIVE_ARM_ACTIVE.replace(" ", "")),
            "overdrive_arm_active formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(OVERDRIVE_ARM_COOLDOWN)
                || sqlNoLineComments.replace(" ", "")
                    .contains(OVERDRIVE_ARM_COOLDOWN.replace(" ", "")),
            "overdrive_arm_cooldown formula must match contract");
        assertTrue(
            sqlNoLineComments.contains(OVERDRIVE_ATTACK_SPEED)
                || sqlNoLineComments.replace(" ", "")
                    .contains(OVERDRIVE_ATTACK_SPEED.replace(" ", "")),
            "overdrive_attack_speed formula must match contract");
        assertTrue(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_formulas\\b[\\s\\S]*?"
                        + "'cooldown_zero'[\\s\\S]*?'overdrive_arm_active'[\\s\\S]*?"
                        + "'overdrive_arm_cooldown'[\\s\\S]*?'overdrive_attack_speed'")
                .matcher(sqlNoLineComments)
                .find(),
            "must insert exactly the four structured formulas");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_formulas"),
            "must define exactly one provider_formulas insert block");
        assertTrue(
            Pattern.compile(
                    "(?is)modifier_item_3073_overdrive_as[\\s\\S]*?20110[\\s\\S]*?"
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
                    "(?s)'item_3073'\\s*,\\s*'provider_item_3073_overdrive'")
                .matcher(sql)
                .find(),
            "must mount Overdrive provider to item_3073");
        assertTrue(
            Pattern.compile("(?is)ON CONFLICT\\s*\\(game_id,\\s*entity_id\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "entity ensure must not overwrite existing item_3073 rows");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider_definitions insert block");
    }

    @Test
    void assertsArmListenerAndOrderedOverrideSteps() {
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3073_overdrive_arm'[\\s\\S]{0,200}20205")
                .matcher(sql)
                .find(),
            "arm listener event_type_id must be 20205");
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3073_overdrive_arm', 20181, 20205"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3073_overdrive_arm', 20181, 62010"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_3073_overdrive_arm', 20181, 20212"));
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_listeners"),
            "must define exactly one provider_listeners insert block");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3073_overdrive_arm_active'\\s*,\\s*"
                        + "'sequence_item_3073_overdrive_arm'\\s*,\\s*0\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "arm step 0 must override active");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3073_overdrive_arm_cooldown'\\s*,\\s*"
                        + "'sequence_item_3073_overdrive_arm'\\s*,\\s*1\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "arm step 1 must override cooldown");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3073_overdrive_arm_active'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,80}overdrive_active[\\s\\S]{0,80}"
                        + "overdrive_arm_active[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find()
                || (sqlNoLineComments.contains("'step_item_3073_overdrive_arm_active'")
                    && sqlNoLineComments.contains("'overdrive_arm_active'")
                    && sqlNoLineComments.contains("20172")
                    && sqlNoLineComments.contains("20250")),
            "arm active step must be provider-scope override");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3073_overdrive_arm_cooldown'[\\s\\S]{0,200}"
                        + "20250[\\s\\S]{0,80}overdrive_cooldown[\\s\\S]{0,80}"
                        + "overdrive_arm_cooldown[\\s\\S]{0,40}20172")
                .matcher(sql)
                .find()
                || (sqlNoLineComments.contains("'step_item_3073_overdrive_arm_cooldown'")
                    && sqlNoLineComments.contains("'overdrive_arm_cooldown'")
                    && sqlNoLineComments.contains("20172")),
            "arm cooldown step must be provider-scope override");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_3073_overdrive_arm'\\s*,\\s*"
                        + "'sequence_item_3073_overdrive_arm'")
                .matcher(sql)
                .find(),
            "arm listener must attach arm sequence");
    }

    @Test
    void stableIdsAreUniqueAndExcludedBranchesNotExecutable() {
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "duplicate stable id in test list: " + id);
            assertTrue(sql.contains(id), "missing stable id: " + id);
        }
        // Exclusion comments may mention Hexcharged/melee/Arena; executable contracts must not.
        assertFalse(
            sqlNoLineComments.contains("'ability_haste'")
                || sqlNoLineComments.contains("'ultimate_haste'")
                || sqlNoLineComments.contains("'cdr'")
                || sqlNoLineComments.contains("provider_item_3073_hexcharged")
                || sqlNoLineComments.contains("hexcharged_"),
            "Hexcharged / ultimate haste must not be executable contracts");
        assertFalse(
            sqlNoLineComments.contains("'ms_pct'")
                || sqlNoLineComments.contains("'movement_speed'")
                || sqlNoLineComments.contains("'move_speed'")
                || sqlNoLineComments.contains("modifier_item_3073_overdrive_ms"),
            "movement speed branch must not be executable contracts");
        assertFalse(
            sqlNoLineComments.contains("0.35")
                || sqlNoLineComments.contains("0.14")
                || sqlNoLineComments.contains("provider_item_3073_overdrive_melee"),
            "melee 35%/14% branch must not be executable contracts");
        assertFalse(
            Pattern.compile("(?i)item_223073|2223073|arena_3073|provider_item_3073_arena")
                .matcher(sqlNoLineComments)
                .find(),
            "Arena branch must not be executable contracts");
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
