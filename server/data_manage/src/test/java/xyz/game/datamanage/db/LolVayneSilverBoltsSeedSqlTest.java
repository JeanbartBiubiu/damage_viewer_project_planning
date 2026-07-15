package xyz.game.datamanage.db;

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
 * Static contract for {@code lol_vayne_silver_bolts_seed.sql} and the related
 * reserved-type vocabulary rows. Does not connect to a live database.
 */
class LolVayneSilverBoltsSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_vayne_silver_bolts_seed.sql";
    private static final String RESERVED_RELATIVE =
        "db/game_manage/seeds/reserved_types_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "provider_hero_vayne_silver_bolts",
        "listener_hero_vayne_silver_bolts",
        "sequence_hero_vayne_silver_bolts",
        "step_hero_vayne_silver_bolts_hit_add",
        "step_hero_vayne_silver_bolts_proc_damage",
        "step_hero_vayne_silver_bolts_hit_reset",
        "step_hero_vayne_basic_attack_emit_hit",
        "silver_bolts_hit_add",
        "silver_bolts_proc_condition",
        "silver_bolts_proc_damage",
        "silver_bolts_hit_reset",
        "event_ref_hero_vayne_basic_attack_hit",
        "silver_bolts_hits");

    private static String sql;
    private static String reservedSql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        Path reservedPath = resolveRelative(RESERVED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        assertTrue(Files.isRegularFile(reservedPath), "reserved seed missing: " + reservedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
        reservedSql = Files.readString(reservedPath, StandardCharsets.UTF_8);
    }

    @Test
    void usesTransactionLockCandidateAndIdempotentRevisionGuard() {
        assertTrue(sql.trim().startsWith("BEGIN;") || sql.contains("\nBEGIN;\n"), "must BEGIN");
        assertTrue(
            sql.trim().endsWith("COMMIT;")
                || sql.contains("\nCOMMIT;\n")
                || sql.endsWith("COMMIT;\n"),
            "must COMMIT");
        assertContains("ensure_game_partitions");
        assertContains("FOR UPDATE");
        assertContains("v_candidate := v_locked_current + 1");
        assertContains("IF v_changed THEN");
        assertContains("current_revision = v_candidate");
        assertContains("IS DISTINCT FROM");
        assertContains("ON CONFLICT");
        assertFalse(sql.contains("versions:publish"), "seed must not auto-publish");
        assertFalse(
            Pattern.compile("(?i)\\bpublish_version\\b").matcher(sql).find(),
            "seed must not call publish helpers");
    }

    @Test
    void doesNotDeleteRows() {
        assertFalse(
            Pattern.compile("(?is)\\bDELETE\\s+FROM\\b").matcher(sql).find(),
            "silver bolts seed must not DELETE");
    }

    @Test
    void reservedSeedDefinesFourNewVocabularyIds() {
        assertTrue(
            reservedSql.contains("(20211, '普攻命中', 'event/basic_attack_hit')")
                || reservedSql.contains("(20211,"),
            "reserved seed must define 20211");
        assertContainsIn(reservedSql, "event/basic_attack_hit");
        assertContainsIn(reservedSql, "event/source_owner");
        assertContainsIn(reservedSql, "event/source_opponent");
        assertContainsIn(reservedSql, "state_scope/provider_target");
        assertContainsIn(reservedSql, "20211");
        assertContainsIn(reservedSql, "20212");
        assertContainsIn(reservedSql, "20213");
        assertContainsIn(reservedSql, "20252");
        assertTrue(
            Pattern.compile("\\(20211,\\s*10019\\)").matcher(reservedSql).find(),
            "20211 must relate to event group 10019");
        assertTrue(
            Pattern.compile("\\(20212,\\s*10019\\)").matcher(reservedSql).find(),
            "20212 must relate to event group 10019");
        assertTrue(
            Pattern.compile("\\(20213,\\s*10019\\)").matcher(reservedSql).find(),
            "20213 must relate to event group 10019");
        assertTrue(
            Pattern.compile("\\(20252,\\s*10023\\)").matcher(reservedSql).find(),
            "20252 must relate to state_scope group 10023");
    }

    @Test
    void validatesPrerequisitesAndProjectsRequiredReservedTypes() {
        assertContains("missing reserved_type");
        assertContains("hero_vayne");
        assertContains("provider_hero_vayne_basic_attack");
        assertContains("ability_hero_vayne_basic_attack");
        assertContains("phase_hero_vayne_basic_attack_impact");
        assertContains("sequence_hero_vayne_basic_attack_damage");
        assertContains("step_hero_vayne_basic_attack_damage");
        assertContains("attr_key=hp");
        assertContains("RAISE EXCEPTION");
        assertContains("INSERT INTO public.types");
        for (int typeId : List.of(
            20100, 20110, 20111, 20120, 20150, 20158, 20160, 20170, 20172, 20181,
            20211, 20212, 20213, 20222, 20252)) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void appendsBasicAttackEmitEventAfterDamageStep() {
        assertContains("step_hero_vayne_basic_attack_emit_hit");
        assertContains("sequence_hero_vayne_basic_attack_damage");
        assertContains("event_effect_details");
        assertContains("event_ref_hero_vayne_basic_attack_hit");
        assertContains("20158");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_basic_attack_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_vayne_basic_attack_damage'\\s*,\\s*1\\s*,\\s*20158")
                .matcher(sql)
                .find(),
            "emit_event step must be order 1 after damage order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_basic_attack_emit_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "'event_ref_hero_vayne_basic_attack_hit'")
                .matcher(sql)
                .find(),
            "emit detail must use event/basic_attack_hit and stable event_ref");
    }

    @Test
    void seedsPassiveProviderMountStateListenerAndAllMatchers() {
        assertContains("provider_hero_vayne_silver_bolts");
        assertContains("provider_state_fields");
        assertContains("silver_bolts_hits");
        assertContains("20100");
        assertContains("listener_hero_vayne_silver_bolts");
        assertContains("listener_match_types");
        assertContains("listener_effect_sequences");
        assertContains("entity_provider_mounts");
        assertContains("provider_hero_vayne_basic_attack");

        assertTrue(
            Pattern.compile(
                    "(?s)'hero_vayne'\\s*,\\s*'provider_hero_vayne_silver_bolts'")
                .matcher(sql)
                .find(),
            "must mount Silver Bolts provider to hero_vayne");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_vayne_silver_bolts'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "must ALL-match event/basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_vayne_silver_bolts'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "must ALL-match event/source_owner");
    }

    @Test
    void seedsThreeSilverBoltsStepsWithOperationsSelectorsConditionsAndDetails() {
        assertContains("step_hero_vayne_silver_bolts_hit_add");
        assertContains("step_hero_vayne_silver_bolts_proc_damage");
        assertContains("step_hero_vayne_silver_bolts_hit_reset");
        assertContains("state_effect_details");
        assertContains("damage_effect_details");
        assertContains("20252");
        assertContains("20222");
        assertContains("20170");
        assertContains("20172");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_silver_bolts_hit_add'\\s*,\\s*"
                        + "'sequence_hero_vayne_silver_bolts'\\s*,\\s*0\\s*,\\s*20160\\s*,\\s*20110")
                .matcher(sql)
                .find(),
            "hit_add must be order 0 state_change targeting self");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_silver_bolts_proc_damage'\\s*,\\s*"
                        + "'sequence_hero_vayne_silver_bolts'\\s*,\\s*1\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*"
                        + "'silver_bolts_proc_condition'")
                .matcher(sql)
                .find(),
            "proc damage must be order 1 damage to opponent with condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_silver_bolts_hit_reset'\\s*,\\s*"
                        + "'sequence_hero_vayne_silver_bolts'\\s*,\\s*2\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'silver_bolts_proc_condition'")
                .matcher(sql)
                .find(),
            "hit_reset must be order 2 state_change with same condition");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_silver_bolts_hit_add'\\s*,\\s*20252\\s*,\\s*"
                        + "'silver_bolts_hits'\\s*,\\s*'silver_bolts_hit_add'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "hit_add detail must use provider_target scope, add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_silver_bolts_hit_reset'\\s*,\\s*20252\\s*,\\s*"
                        + "'silver_bolts_hits'\\s*,\\s*'silver_bolts_hit_reset'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "hit_reset detail must use provider_target scope, override policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_vayne_silver_bolts_proc_damage'\\s*,\\s*"
                        + "'silver_bolts_proc_damage'\\s*,\\s*20222\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "proc damage detail must be true damage with add policy");
    }

    @Test
    void formulasIncludeThresholdRatioMinAndProviderTargetStatePath() {
        assertContains("provider.target_state.silver_bolts_hits");
        assertContains("\"$opponent.attr.hp.max\"");
        assertContains("0.06");
        assertContains("\"value\":3");
        assertContains("\"value\":50");
        assertContains("\"op\":\"gte\"");
        assertContains("\"op\":\"max\"");
        assertContains("\"op\":\"mul\"");
        assertContains("silver_bolts_hit_add");
        assertContains("silver_bolts_proc_condition");
        assertContains("silver_bolts_proc_damage");
        assertContains("silver_bolts_hit_reset");

        // GenericFormulaExpr comparisons require exactly two entries in args — not left/right.
        String procCondition =
            "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.target_state.silver_bolts_hits\"},{\"op\":\"const\",\"value\":3}]}";
        assertContains(procCondition);
        assertFalse(
            Pattern.compile(
                    "(?s)'silver_bolts_proc_condition'\\s*,\\s*'\\{[^']*\"(left|right)\"")
                .matcher(sql)
                .find(),
            "silver_bolts_proc_condition must not use left/right keys");
        assertTrue(
            Pattern.compile(
                    "(?s)'silver_bolts_proc_condition'\\s*,\\s*'\\{[^']*\"args\"\\s*:\\s*\\[")
                .matcher(sql)
                .find(),
            "silver_bolts_proc_condition must use args for the comparison");
    }

    @Test
    void preservesExactlyOneDetailLayoutByConstruction() {
        assertTrue(
            sql.indexOf("INSERT INTO public.effect_steps")
                < sql.indexOf("INSERT INTO public.state_effect_details"),
            "state details must follow Silver Bolts effect_steps insert");
        assertTrue(
            sql.indexOf("INSERT INTO public.effect_steps")
                < sql.indexOf("INSERT INTO public.damage_effect_details"),
            "damage details must follow effect_steps insert");
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");

        // Each authored step pairs with exactly one detail family by construction.
        assertTrue(
            countOccurrences(sql, "'step_hero_vayne_silver_bolts_hit_add'") >= 2,
            "hit_add must appear in effect_steps and state_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_vayne_silver_bolts_proc_damage'") >= 2,
            "proc_damage must appear in effect_steps and damage_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_vayne_silver_bolts_hit_reset'") >= 2,
            "hit_reset must appear in effect_steps and state_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_vayne_basic_attack_emit_hit'") >= 2,
            "emit_hit must appear in effect_steps and event_effect_details");
        assertTrue(sql.contains("state_effect_details"));
        assertTrue(sql.contains("damage_effect_details"));
        assertTrue(sql.contains("event_effect_details"));
        assertFalse(sql.contains("heal_effect_details"), "must not mix unrelated detail families");
    }

    @Test
    void stableIdsAreUniqueEnoughToRerunSafely() {
        Set<String> seen = new HashSet<>();
        for (String id : STABLE_IDS) {
            assertTrue(seen.add(id), "stable id list itself must be unique: " + id);
            assertContains(id);
        }
        assertContains("ON CONFLICT");
        assertContains("IS DISTINCT FROM");
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

    private static void assertContainsIn(String haystack, String needle) {
        assertTrue(haystack.contains(needle), "sql must contain: " + needle);
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
