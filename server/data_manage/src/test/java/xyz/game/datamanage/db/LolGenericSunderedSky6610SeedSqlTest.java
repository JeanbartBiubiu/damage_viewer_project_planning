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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_sundered_sky_6610_seed.sql}.
 * Does not connect to a live database.
 *
 * <p>Stable IDs (Lightshield Strike / item_6610):
 * <ul>
 *   <li>{@code provider_item_6610_lightshield_strike}</li>
 *   <li>{@code listener_item_6610_lightshield_strike}</li>
 *   <li>{@code sequence_item_6610_lightshield_strike}</li>
 *   <li>{@code step_item_6610_lightshield_strike_arm_cooldown}</li>
 *   <li>{@code modifier_item_6610_lightshield_strike_crit_chance/natural/forced}</li>
 *   <li>state: {@code lightshield_strike_cooldown}</li>
 * </ul>
 */
class LolGenericSunderedSky6610SeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_sundered_sky_6610_seed.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final String COOLDOWN_ZERO =
        "{\"op\":\"eq\",\"args\":[{\"op\":\"read\","
            + "\"path\":\"provider.target_state.lightshield_strike_cooldown\"},"
            + "{\"op\":\"const\",\"value\":0}]}";

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_6610_lightshield_strike",
        "listener_item_6610_lightshield_strike",
        "sequence_item_6610_lightshield_strike",
        "step_item_6610_lightshield_strike_arm_cooldown",
        "modifier_item_6610_lightshield_strike_crit_chance",
        "modifier_item_6610_lightshield_strike_crit_natural",
        "modifier_item_6610_lightshield_strike_crit_forced",
        "lightshield_strike_cooldown",
        "lightshield_strike_crit_chance",
        "lightshield_strike_crit_natural",
        "lightshield_strike_crit_forced",
        "lightshield_strike_arm_cooldown",
        "cooldown_zero",
        "item_6610");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20160, 20172, 20181, 20190,
        20211, 20212, 20252, 20264, 20266, 20269,
        20277, 20278, 20279, 20280);

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
        assertFalse(
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.provider_state_fields\\b[\\s\\S]*?"
                        + "default_value")
                .matcher(sqlNoLineComments)
                .find(),
            "provider_state_fields has no default column; seed must not invent one");
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
            Pattern.compile("(?i)Lightshield\\s+Strike|破盾一击").matcher(sql).find(),
            "must name Lightshield Strike");
        assertTrue(
            Pattern.compile("(?i)Sundered\\s+Sky|焚天").matcher(sql).find(),
            "must name Sundered Sky");
        assertTrue(
            sqlNoLineComments.contains("'hp', 400")
                || sqlNoLineComments.contains("'hp',400"),
            "must upsert Wiki hp=400");
        assertTrue(
            sqlNoLineComments.contains("'ad', 45")
                || sqlNoLineComments.contains("'ad',45"),
            "must upsert Wiki ad=45");
        assertTrue(
            sqlNoLineComments.contains("'ability_haste', 10")
                || sqlNoLineComments.contains("'ability_haste',10"),
            "must upsert Wiki ability_haste=10");
        assertTrue(
            Pattern.compile("(?i)default0").matcher(sql).find(),
            "must document runtime default0 for state fields");
        assertTrue(
            Pattern.compile("(?i)no\\s+DDragon|不使用\\s*DDragon|不.*DDragon").matcher(sql).find()
                || sql.contains("不使用 DDragon"),
            "comments must forbid DDragon");
        assertTrue(
            Pattern.compile("(?i)160%|1\\.60|absolute").matcher(sql).find(),
            "must document absolute total critical damage 160%");
        assertTrue(
            Pattern.compile("(?i)10000|10\\s*second|每目标").matcher(sql).find(),
            "must document per-target cooldown 10000ms");
    }

    @Test
    void reservedSeedDefinesCritCommandStagesAndProviderTarget() {
        assertTrue(
            Pattern.compile("\\(20252,\\s*'[^']*',\\s*'state_scope/provider_target'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20252 state_scope/provider_target");
        assertTrue(
            Pattern.compile("\\(20190,\\s*'[^']*',\\s*'refresh_policy/refresh_duration'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20190 refresh_policy/refresh_duration");
        assertTrue(
            Pattern.compile("\\(20277,\\s*'[^']*',\\s*'command/crit'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20277 command/crit");
        assertTrue(
            Pattern.compile(
                    "\\(20278,\\s*'[^']*',\\s*'stage/crit_chance_pre_settlement'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20278 stage/crit_chance_pre_settlement");
        assertTrue(
            Pattern.compile(
                    "\\(20279,\\s*'[^']*',\\s*'stage/crit_multiplier_forced_branch'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20279 stage/crit_multiplier_forced_branch");
        assertTrue(
            Pattern.compile(
                    "\\(20280,\\s*'[^']*',\\s*'stage/crit_multiplier_natural_branch'\\)")
                .matcher(reservedSql)
                .find(),
            "reserved seed must define 20280 stage/crit_multiplier_natural_branch");
        assertTrue(reservedSql.contains("(20252, 10023)"), "20252 parent must be 10023");
        assertTrue(reservedSql.contains("(20190, 10018)"), "20190 parent must be 10018");
        assertTrue(reservedSql.contains("(20277, 10027)"), "20277 parent must be 10027");
        assertTrue(reservedSql.contains("(20278, 10029)"), "20278 parent must be 10029");
        assertTrue(reservedSql.contains("(20279, 10029)"), "20279 parent must be 10029");
        assertTrue(reservedSql.contains("(20280, 10029)"), "20280 parent must be 10029");
    }

    @Test
    void assertsProviderStateFormulasAndMount() {
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
                    "(?s)'lightshield_strike_cooldown'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}10000[\\s\\S]{0,40}20190")
                .matcher(sql)
                .find(),
            "cooldown must be number/max1/10000ms/refresh_duration");
        assertTrue(
            sqlNoLineComments.contains(COOLDOWN_ZERO)
                || sqlNoLineComments.replace(" ", "").contains(COOLDOWN_ZERO.replace(" ", "")),
            "cooldown_zero formula must read provider.target_state.lightshield_strike_cooldown");
        assertContains("{\"op\":\"const\",\"value\":1}");
        assertContains("{\"op\":\"const\",\"value\":1.60}");
        assertFalse(
            Pattern.compile("\"op\"\\s*:\\s*\"const\"\\s*,\\s*\"value\"\\s*:\\s*0\\.80")
                .matcher(sqlNoLineComments)
                .find(),
            "must not use forced multiply 0.80 (2512 Opening Barrage contract)");
        assertTrue(
            Pattern.compile(
                    "(?s)'item_6610'\\s*,\\s*'provider_item_6610_lightshield_strike'")
                .matcher(sql)
                .find(),
            "must mount Lightshield Strike provider to item_6610");
        assertTrue(
            Pattern.compile("(?is)ON CONFLICT\\s*\\(game_id,\\s*entity_id\\)\\s*DO\\s+NOTHING")
                .matcher(sqlNoLineComments)
                .find(),
            "entity ensure must not overwrite existing item_6610 rows");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider_definitions insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must define exactly one entity_provider_mounts insert block");
    }

    @Test
    void assertsThreeCritPipelineAbsoluteOverrideStages() {
        assertTrue(
            Pattern.compile(
                    "(?is)modifier_item_6610_lightshield_strike_crit_chance[\\s\\S]*?"
                        + "20264[\\s\\S]*?20110[\\s\\S]*?'hp'[\\s\\S]*?20277[\\s\\S]*?"
                        + "20266[\\s\\S]*?20269[\\s\\S]*?20278[\\s\\S]*?20172")
                .matcher(sqlNoLineComments)
                .find(),
            "crit chance pipeline must use hp placeholder + stage 20278 override");
        assertTrue(
            Pattern.compile(
                    "(?is)modifier_item_6610_lightshield_strike_crit_natural[\\s\\S]*?"
                        + "20264[\\s\\S]*?20110[\\s\\S]*?'hp'[\\s\\S]*?20277[\\s\\S]*?"
                        + "20266[\\s\\S]*?20269[\\s\\S]*?20280[\\s\\S]*?20172")
                .matcher(sqlNoLineComments)
                .find(),
            "natural branch pipeline must absolute-override at stage 20280");
        assertTrue(
            Pattern.compile(
                    "(?is)modifier_item_6610_lightshield_strike_crit_forced[\\s\\S]*?"
                        + "20264[\\s\\S]*?20110[\\s\\S]*?'hp'[\\s\\S]*?20277[\\s\\S]*?"
                        + "20266[\\s\\S]*?20269[\\s\\S]*?20279[\\s\\S]*?20172")
                .matcher(sqlNoLineComments)
                .find(),
            "forced branch pipeline must absolute-override at stage 20279");
        assertTrue(
            sqlNoLineComments.contains("'lightshield_strike_crit_chance'")
                && sqlNoLineComments.contains("'cooldown_zero'"),
            "crit modifiers must condition on cooldown_zero");
        assertEquals(
            2,
            countOccurrences(sqlNoLineComments, "{\"op\":\"const\",\"value\":1.60}"),
            "must write absolute override 1.60 for both natural and forced formulas");
        assertEquals(
            3,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define exactly three provider_modifiers insert blocks");
        assertFalse(
            Pattern.compile(
                    "(?is)modifier_item_6610_lightshield_strike_crit_forced[\\s\\S]*?20171")
                .matcher(sqlNoLineComments)
                .find(),
            "forced branch must not use multiply policy 20171");
    }

    @Test
    void assertsListenerEventSourceOwnerAndProviderTargetState() {
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6610_lightshield_strike'[\\s\\S]{0,200}20211"
                        + "[\\s\\S]{0,80}1")
                .matcher(sql)
                .find(),
            "listener must be basic_attack_hit 20211 with max_triggers_per_event=1");
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_6610_lightshield_strike', 20181, 20211"));
        assertTrue(
            sqlNoLineComments.contains(
                "'listener_item_6610_lightshield_strike', 20181, 20212"));
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_item_6610_lightshield_strike'\\s*,\\s*"
                        + "'sequence_item_6610_lightshield_strike'")
                .matcher(sql)
                .find(),
            "listener must bind Lightshield Strike sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6610_lightshield_strike_arm_cooldown'\\s*,\\s*"
                        + "'sequence_item_6610_lightshield_strike'\\s*,\\s*0\\s*,\\s*20160")
                .matcher(sql)
                .find(),
            "arm step must be state_change 20160");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6610_lightshield_strike_arm_cooldown'[\\s\\S]{0,200}"
                        + "20252[\\s\\S]{0,80}lightshield_strike_cooldown")
                .matcher(sql)
                .find()
                || (sqlNoLineComments.contains("'step_item_6610_lightshield_strike_arm_cooldown'")
                    && sqlNoLineComments.contains("20252")
                    && sqlNoLineComments.contains("'lightshield_strike_cooldown'")),
            "arm detail must write state_scope/provider_target lightshield_strike_cooldown");
        assertContains("provider.target_state.lightshield_strike_cooldown");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_listeners"),
            "must define exactly one provider_listeners insert block");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_sequences"),
            "must define exactly one effect_sequences insert block");
    }

    @Test
    void excludesOutOfScopeHealArenaAndInfinityEdgeSurfaces() {
        assertFalse(
            Pattern.compile("(?i)\\bheal(?:ing)?\\b|治疗|overheal|bonus\\s*health|额外生命")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model healing / overheal-to-bonus-health in executable SQL");
        assertFalse(
            Pattern.compile("(?i)\\barena\\b|222?6610").matcher(sqlNoLineComments).find(),
            "must not model Arena branch in executable SQL");
        assertFalse(
            Pattern.compile("(?i)infinity\\s*edge|无尽之刃|crit_damage")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model Infinity Edge / crit_damage combinations in executable SQL");
        assertFalse(
            Pattern.compile("(?i)non[-_]?champion|非英雄").matcher(sqlNoLineComments).find(),
            "must not model non-champion branch in executable SQL");
        assertFalse(
            sqlNoLineComments.contains("item_2512"),
            "must not alter Fiendhunter Bolts seed in executable SQL");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.reserved_type\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not modify reserved_types from this seed");
    }

    @Test
    void stableIdsAreUniqueInSeed() {
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "duplicate stable id in test list: " + id);
            assertTrue(sql.contains(id), "missing stable id: " + id);
        }
        Matcher mountMatcher =
            Pattern.compile(
                    "(?is)INSERT\\s+INTO\\s+public\\.entity_provider_mounts\\b[\\s\\S]*?"
                        + "VALUES[\\s\\S]*?'item_6610'\\s*,\\s*"
                        + "'provider_item_6610_lightshield_strike'")
                .matcher(sqlNoLineComments);
        assertTrue(mountMatcher.find(), "must INSERT entity_provider_mounts for item_6610");
        assertFalse(mountMatcher.find(), "must mount exactly one provider on item_6610");
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
