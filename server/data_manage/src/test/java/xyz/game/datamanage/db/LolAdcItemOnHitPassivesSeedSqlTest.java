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
 * Static contract for {@code lol_adc_item_on_hit_passives_seed.sql}.
 * Does not connect to a live database.
 */
class LolAdcItemOnHitPassivesSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql";

    private static final List<String> HEROES = List.of(
        "vayne", "teemo", "varus", "kaisa", "twitch", "kogmaw");

    private static final List<String> STABLE_IDS = List.of(
        "provider_item_3153_ruined_king",
        "listener_item_3153_ruined_king",
        "sequence_item_3153_ruined_king",
        "step_item_3153_ruined_king_damage",
        "ruined_king_on_hit_damage",
        "provider_item_6672_kraken",
        "listener_item_6672_kraken",
        "sequence_item_6672_kraken",
        "step_item_6672_kraken_hit_add",
        "step_item_6672_kraken_proc_damage",
        "step_item_6672_kraken_hit_reset",
        "kraken_hits",
        "kraken_hit_add",
        "kraken_proc_condition",
        "kraken_proc_damage",
        "kraken_hit_reset",
        "provider_item_3124_guinsoos",
        "listener_item_3124_guinsoos",
        "sequence_item_3124_guinsoos",
        "step_item_3124_guinsoos_damage",
        "guinsoos_on_hit_damage",
        "step_hero_vayne_basic_attack_emit_hit",
        "step_hero_teemo_basic_attack_emit_hit",
        "step_hero_varus_basic_attack_emit_hit",
        "step_hero_kaisa_basic_attack_emit_hit",
        "step_hero_twitch_basic_attack_emit_hit",
        "step_hero_kogmaw_basic_attack_emit_hit",
        "event_ref_hero_vayne_basic_attack_hit",
        "event_ref_hero_teemo_basic_attack_hit",
        "event_ref_hero_varus_basic_attack_hit",
        "event_ref_hero_kaisa_basic_attack_hit",
        "event_ref_hero_twitch_basic_attack_hit",
        "event_ref_hero_kogmaw_basic_attack_hit");

    private static String sql;

    @BeforeAll
    static void loadSeedSql() throws IOException {
        Path seedPath = resolveRelative(SEED_RELATIVE);
        assertTrue(Files.isRegularFile(seedPath), "seed sql missing: " + seedPath);
        sql = Files.readString(seedPath, StandardCharsets.UTF_8);
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
            "on-hit passives seed must not DELETE");
    }

    @Test
    void validatesItemAndBasicAttackPrerequisites() {
        assertContains("missing reserved_type");
        assertContains("item_3153");
        assertContains("item_6672");
        assertContains("item_3124");
        assertContains("attr_key=hp");
        assertContains("RAISE EXCEPTION");
        assertContains("INSERT INTO public.types");
        for (String hero : HEROES) {
            assertContains("provider_hero_" + hero + "_basic_attack");
            assertContains("ability_hero_" + hero + "_basic_attack");
            assertContains("phase_hero_" + hero + "_basic_attack_impact");
            assertContains("sequence_hero_" + hero + "_basic_attack_damage");
            assertContains("step_hero_" + hero + "_basic_attack_damage");
        }
        for (int typeId : List.of(
            20100, 20110, 20111, 20120, 20150, 20158, 20160, 20170, 20172, 20181,
            20211, 20212, 20220, 20221, 20252)) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void mountsThreeItemProvidersWithListenersAndSequences() {
        assertTrue(
            Pattern.compile("(?s)'item_3153'\\s*,\\s*'provider_item_3153_ruined_king'")
                .matcher(sql)
                .find(),
            "must mount ruined king provider to item_3153");
        assertTrue(
            Pattern.compile("(?s)'item_6672'\\s*,\\s*'provider_item_6672_kraken'")
                .matcher(sql)
                .find(),
            "must mount kraken provider to item_6672");
        assertTrue(
            Pattern.compile("(?s)'item_3124'\\s*,\\s*'provider_item_3124_guinsoos'")
                .matcher(sql)
                .find(),
            "must mount guinsoos provider to item_3124");

        assertContains("provider_item_3153_ruined_king");
        assertContains("provider_item_6672_kraken");
        assertContains("provider_item_3124_guinsoos");
        assertContains("listener_item_3153_ruined_king");
        assertContains("listener_item_6672_kraken");
        assertContains("listener_item_3124_guinsoos");
        assertContains("sequence_item_3153_ruined_king");
        assertContains("sequence_item_6672_kraken");
        assertContains("sequence_item_3124_guinsoos");
        assertContains("listener_match_types");
        assertContains("listener_effect_sequences");
        assertContains("entity_provider_mounts");
    }

    @Test
    void threeListenersAllMatchBasicAttackHitAndSourceOwner() {
        for (String listener : List.of(
            "listener_item_3153_ruined_king",
            "listener_item_6672_kraken",
            "listener_item_3124_guinsoos")) {
            assertTrue(
                Pattern.compile("(?s)'" + listener + "'\\s*,\\s*20181\\s*,\\s*20211")
                    .matcher(sql)
                    .find(),
                listener + " must ALL-match event/basic_attack_hit (20211)");
            assertTrue(
                Pattern.compile("(?s)'" + listener + "'\\s*,\\s*20181\\s*,\\s*20212")
                    .matcher(sql)
                    .find(),
                listener + " must ALL-match event/source_owner (20212)");
        }
    }

    @Test
    void ruinedKingUsesCurrentHpRatioPhysicalDamage() {
        assertContains("\"$opponent.attr.hp.current\"");
        assertContains("0.06");
        assertContains("ruined_king_on_hit_damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3153_ruined_king_damage'\\s*,\\s*"
                        + "'sequence_item_3153_ruined_king'\\s*,\\s*0\\s*,\\s*20150\\s*,\\s*20111")
                .matcher(sql)
                .find(),
            "ruined king damage step must be order 0 damage to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3153_ruined_king_damage'\\s*,\\s*"
                        + "'ruined_king_on_hit_damage'\\s*,\\s*20220\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "ruined king detail must be physical damage with add policy");
        String formula =
            "{\"op\":\"mul\",\"args\":[{\"op\":\"read\",\"path\":\"$opponent.attr.hp.current\"},{\"op\":\"const\",\"value\":0.06}]}";
        assertContains(formula);
    }

    @Test
    void guinsoosUsesFixedThirtyMagicDamageOnly() {
        assertContains("guinsoos_on_hit_damage");
        assertContains("\"value\":30");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3124_guinsoos_damage'\\s*,\\s*"
                        + "'sequence_item_3124_guinsoos'\\s*,\\s*0\\s*,\\s*20150\\s*,\\s*20111")
                .matcher(sql)
                .find(),
            "guinsoos damage step must be order 0 damage to opponent");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_3124_guinsoos_damage'\\s*,\\s*"
                        + "'guinsoos_on_hit_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "guinsoos detail must be magic damage with add policy");
        assertFalse(sql.contains("phantom_hit"), "must not include phantom hit mechanism");
        assertFalse(sql.contains("attack_speed_stack"), "must not include attack-speed stacking");
        assertFalse(sql.contains("boiling_strike"), "must not include boiling strike stacking");
        assertFalse(
            Pattern.compile("(?i)\\bslow\\b").matcher(sql).find(),
            "must not mix slow passives");
        assertFalse(
            sql.contains("guinsoos_hits") || sql.contains("guinsoos_stacks"),
            "guinsoos first batch must not declare hit/stack state keys");
        String formula = "{\"op\":\"const\",\"value\":30}";
        assertContains(formula);
    }

    @Test
    void krakenCountsEveryThirdHitWithMissingHpPhysicalFormula() {
        assertContains("provider_state_fields");
        assertContains("kraken_hits");
        assertContains("provider.target_state.kraken_hits");
        assertContains("\"value\":3");
        assertContains("\"value\":120");
        assertContains("0.75");
        assertContains("\"op\":\"clamp\"");
        assertContains("\"op\":\"div\"");
        assertContains("\"op\":\"max\"");
        assertContains("\"$opponent.attr.hp.max\"");
        assertContains("\"$opponent.attr.hp.current\"");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6672_kraken_hit_add'\\s*,\\s*"
                        + "'sequence_item_6672_kraken'\\s*,\\s*0\\s*,\\s*20160\\s*,\\s*20110")
                .matcher(sql)
                .find(),
            "kraken hit_add must be order 0 state_change targeting self");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6672_kraken_proc_damage'\\s*,\\s*"
                        + "'sequence_item_6672_kraken'\\s*,\\s*1\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*"
                        + "'kraken_proc_condition'")
                .matcher(sql)
                .find(),
            "kraken proc damage must be order 1 damage with condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6672_kraken_hit_reset'\\s*,\\s*"
                        + "'sequence_item_6672_kraken'\\s*,\\s*2\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'kraken_proc_condition'")
                .matcher(sql)
                .find(),
            "kraken hit_reset must be order 2 state_change with same condition");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6672_kraken_hit_add'\\s*,\\s*20252\\s*,\\s*"
                        + "'kraken_hits'\\s*,\\s*'kraken_hit_add'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "kraken hit_add detail must use provider_target scope, add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6672_kraken_hit_reset'\\s*,\\s*20252\\s*,\\s*"
                        + "'kraken_hits'\\s*,\\s*'kraken_hit_reset'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "kraken hit_reset detail must use provider_target scope, override policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6672_kraken_proc_damage'\\s*,\\s*"
                        + "'kraken_proc_damage'\\s*,\\s*20220\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "kraken proc damage detail must be physical with add policy");

        String procCondition =
            "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.target_state.kraken_hits\"},{\"op\":\"const\",\"value\":3}]}";
        assertContains(procCondition);
        assertContains("{\"op\":\"const\",\"value\":0}");
        assertTrue(
            sql.contains("\"max\":{\"op\":\"const\",\"value\":1}")
                || sql.contains("\"max\": {\"op\":\"const\",\"value\":1}"),
            "kraken missingHpRatio must clamp max to 1");
        assertTrue(
            sql.contains("\"min\":{\"op\":\"const\",\"value\":0}")
                || sql.contains("\"min\": {\"op\":\"const\",\"value\":0}"),
            "kraken missingHpRatio must clamp min to 0");
        assertTrue(
            sql.contains("{\"op\":\"max\",\"args\":[{\"op\":\"read\",\"path\":\"$opponent.attr.hp.max\"},{\"op\":\"const\",\"value\":1}]}"),
            "kraken denominator must use max(maxHP, 1)");
    }

    @Test
    void appendsUniqueEmitEventStepsForSixBasicAttackSequences() {
        assertContains("event_effect_details");
        assertContains("20158");
        for (String hero : HEROES) {
            String stepId = "step_hero_" + hero + "_basic_attack_emit_hit";
            String sequenceId = "sequence_hero_" + hero + "_basic_attack_damage";
            String eventRef = "event_ref_hero_" + hero + "_basic_attack_hit";
            assertTrue(
                Pattern.compile(
                        "(?s)'" + stepId + "'\\s*,\\s*'" + sequenceId + "'\\s*,\\s*1\\s*,\\s*20158")
                    .matcher(sql)
                    .find(),
                hero + " emit_event step must be order 1");
            assertTrue(
                Pattern.compile(
                        "(?s)'" + stepId + "'\\s*,\\s*20211\\s*,\\s*'" + eventRef + "'")
                    .matcher(sql)
                    .find(),
                hero + " emit detail must use event/basic_attack_hit and stable event_ref");
            assertTrue(
                countOccurrences(sql, "'" + stepId + "'") >= 2,
                stepId + " must appear in effect_steps and event_effect_details");
        }
    }

    @Test
    void preservesExactlyOneDetailLayoutByConstruction() {
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");

        assertTrue(
            countOccurrences(sql, "'step_item_3153_ruined_king_damage'") >= 2,
            "ruined king damage must pair step + damage detail");
        assertTrue(
            countOccurrences(sql, "'step_item_3124_guinsoos_damage'") >= 2,
            "guinsoos damage must pair step + damage detail");
        assertTrue(
            countOccurrences(sql, "'step_item_6672_kraken_hit_add'") >= 2,
            "kraken hit_add must pair step + state detail");
        assertTrue(
            countOccurrences(sql, "'step_item_6672_kraken_proc_damage'") >= 2,
            "kraken proc_damage must pair step + damage detail");
        assertTrue(
            countOccurrences(sql, "'step_item_6672_kraken_hit_reset'") >= 2,
            "kraken hit_reset must pair step + state detail");

        assertTrue(sql.contains("state_effect_details"));
        assertTrue(sql.contains("damage_effect_details"));
        assertTrue(sql.contains("event_effect_details"));
        assertFalse(sql.contains("heal_effect_details"), "must not mix unrelated detail families");
    }

    @Test
    void relationRowsDoNotBumpRevisionOnContentlessConflict() {
        assertTrue(
            Pattern.compile(
                    "(?s)listener_match_types.*?WHERE public\\.listener_match_types\\.change_revision > v_locked_current")
                .matcher(sql)
                .find(),
            "listener_match_types must guard contentless conflict updates");
        assertTrue(
            Pattern.compile(
                    "(?s)listener_effect_sequences.*?WHERE public\\.listener_effect_sequences\\.change_revision > v_locked_current")
                .matcher(sql)
                .find(),
            "listener_effect_sequences must guard contentless conflict updates");
        assertTrue(
            Pattern.compile(
                    "(?s)entity_provider_mounts.*?WHERE public\\.entity_provider_mounts\\.change_revision > v_locked_current")
                .matcher(sql)
                .find(),
            "entity_provider_mounts must guard contentless conflict updates");
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
