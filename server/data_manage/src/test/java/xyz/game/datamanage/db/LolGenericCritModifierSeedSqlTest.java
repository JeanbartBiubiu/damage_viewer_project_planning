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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_crit_modifier_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericCritModifierSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_crit_modifier_seed.sql";

    private static final List<String> CRIT_ALLOWLIST = List.of(
        "step_hero_vayne_basic_attack_damage",
        "step_hero_teemo_basic_attack_damage",
        "step_hero_varus_basic_attack_damage",
        "step_hero_kaisa_basic_attack_damage",
        "step_hero_twitch_basic_attack_damage",
        "step_hero_kogmaw_basic_attack_damage");

    private static final List<String> FORBIDDEN_CRIT_STEPS = List.of(
        "step_item_3124_guinsoos_damage",
        "step_item_3153_ruined_king_damage",
        "step_hero_vayne_silver_bolts_proc_damage",
        "step_item_6672_kraken_proc_damage",
        "step_item_3078_spellblade_damage",
        "step_item_3094_energized_damage",
        "step_item_3124_guinsoos_phantom_hit");

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
        assertTrue(
            Pattern.compile("crit_eligible\\s+IS\\s+DISTINCT\\s+FROM\\s+true")
                .matcher(sqlNoLineComments)
                .find(),
            "UPDATE must be idempotent via IS DISTINCT FROM true");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
        assertFalse(
            Pattern.compile("(?i)\\bpublish\\s*\\(").matcher(sqlNoLineComments).find(),
            "seed must not call publish API markers");
        assertFalse(
            Pattern.compile("(?is)\\bcurrent_revision\\s*=\\s*1[78]\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not hardcode revision numbers");
    }

    @Test
    void rejectsDestructiveSqlAndProviderSurfaces() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sqlNoLineComments).find(),
            "crit seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "crit seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "crit seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_")
                .matcher(sqlNoLineComments)
                .find(),
            "seed must not insert provider rows for Infinity Edge");
        assertFalse(
            Pattern.compile("(?is)provider_modifiers").matcher(sqlNoLineComments).find(),
            "seed must not touch provider_modifiers");
        assertFalse(
            Pattern.compile("(?is)provider_item_3031").matcher(sqlNoLineComments).find(),
            "seed must not create Infinity Edge provider");
    }

    @Test
    void requiresItem3031StaticAttributesAndSixDamageSteps() {
        assertTrue(
            Pattern.compile("(?is)game_entities[\\s\\S]*item_3031")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight game_entities item_3031");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'ad'[\\s\\S]*base_value\\s*=\\s*75")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight item_3031 ad=75");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'crit_chance'[\\s\\S]*base_value\\s*=\\s*0\\.25")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight item_3031 crit_chance=0.25");
        assertTrue(
            Pattern.compile("(?is)attr_key\\s*=\\s*'crit_damage'[\\s\\S]*base_value\\s*=\\s*0\\.3")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight item_3031 crit_damage=0.3");
        assertTrue(
            Pattern.compile("(?is)RAISE\\s+EXCEPTION").matcher(sqlNoLineComments).find(),
            "missing preconditions must RAISE EXCEPTION");
        for (String stepId : CRIT_ALLOWLIST) {
            assertTrue(
                sqlNoLineComments.contains("'" + stepId + "'"),
                "seed must reference required step " + stepId);
        }
    }

    @Test
    void critEligibleAllowlistIsExactAndExcludesOnHitListenerLinkedRepeat() {
        String critUpdate = extractDamageCritUpdateBlock();
        assertFalse(critUpdate.isBlank(), "must contain damage_effect_details crit update");

        Set<String> authored = extractQuotedStepIdsInInClause(critUpdate);
        assertEquals(
            new LinkedHashSet<>(CRIT_ALLOWLIST),
            authored,
            "crit UPDATE allowlist must be exactly the six ADC base basic-attack damage steps");

        for (String forbidden : FORBIDDEN_CRIT_STEPS) {
            assertFalse(
                critUpdate.contains("'" + forbidden + "'"),
                "crit update scope must not mention " + forbidden);
            assertFalse(
                Pattern.compile(
                        "(?is)'" + Pattern.quote(forbidden) + "'[\\s\\S]{0,200}"
                            + "crit_eligible\\s*=\\s*true")
                    .matcher(sqlNoLineComments)
                    .find(),
                "must not set crit_eligible true for " + forbidden);
        }

        assertFalse(
            Pattern.compile(
                    "(?is)UPDATE\\s+public\\.damage_effect_details\\b(?![\\s\\S]*?\\bstep_id\\s+IN\\s*\\()")
                .matcher(sqlNoLineComments)
                .find(),
            "crit UPDATE must constrain step_id IN (...); no broad damage update");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "UPDATE public.damage_effect_details"),
            "seed may contain only one damage_effect_details UPDATE");
        assertTrue(
            Pattern.compile("crit_eligible\\s*=\\s*true").matcher(critUpdate).find(),
            "crit UPDATE must set crit_eligible=true");
        assertFalse(
            Pattern.compile("(?is)copyable_on_hit\\s*=").matcher(critUpdate).find(),
            "crit UPDATE must preserve copyable_on_hit (not rewrite it)");
    }

    private static String extractDamageCritUpdateBlock() {
        Matcher m =
            Pattern.compile(
                    "(?is)UPDATE\\s+public\\.damage_effect_details\\b[\\s\\S]*?;")
                .matcher(sqlNoLineComments);
        if (!m.find()) {
            return "";
        }
        return m.group();
    }

    private static Set<String> extractQuotedStepIdsInInClause(String updateBlock) {
        Matcher inClause =
            Pattern.compile("(?is)\\bstep_id\\s+IN\\s*\\(([^)]*)\\)").matcher(updateBlock);
        assertTrue(inClause.find(), "crit UPDATE must use step_id IN (...)");
        Matcher quoted = Pattern.compile("'([^']+)'").matcher(inClause.group(1));
        Set<String> ids = new LinkedHashSet<>();
        while (quoted.find()) {
            ids.add(quoted.group(1));
        }
        return ids;
    }

    private static String stripLineComments(String raw) {
        return Pattern.compile("(?m)--[^\\n]*").matcher(raw).replaceAll("");
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
