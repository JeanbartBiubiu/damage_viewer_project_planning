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
 * Static contract for {@code lol_generic_twisted_fate_stacked_deck_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericTwistedFateStackedDeckSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_twisted_fate_stacked_deck_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "hero_twistedfate",
        "provider_hero_twistedfate_basic_attack",
        "ability_hero_twistedfate_basic_attack",
        "phase_hero_twistedfate_basic_attack_impact",
        "sequence_hero_twistedfate_basic_attack_damage",
        "step_hero_twistedfate_basic_attack_damage",
        "step_hero_twistedfate_basic_attack_emit_hit",
        "event_ref_hero_twistedfate_basic_attack_hit",
        "provider_hero_twistedfate_stacked_deck",
        "listener_hero_twistedfate_stacked_deck",
        "sequence_hero_twistedfate_stacked_deck",
        "step_hero_twistedfate_stacked_deck_hit_add",
        "step_hero_twistedfate_stacked_deck_proc_damage",
        "step_hero_twistedfate_stacked_deck_hit_reset",
        "modifier_hero_twistedfate_stacked_deck_attack_speed",
        "stacked_deck_hits",
        "stacked_deck_hit_add",
        "stacked_deck_proc_condition",
        "stacked_deck_proc_damage",
        "stacked_deck_hit_reset",
        "stacked_deck_attack_speed");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20111, 20120, 20130, 20142, 20150, 20158, 20160, 20170,
        20172, 20173, 20181, 20211, 20212, 20220, 20221, 20250, 20260);

    private static final String PROC_CONDITION =
        "{\"op\":\"gte\",\"args\":[{\"op\":\"read\",\"path\":\"provider.state.stacked_deck_hits\"},"
            + "{\"op\":\"const\",\"value\":4}]}";

    private static final String PROC_DAMAGE =
        "{\"op\":\"add\",\"args\":[{\"op\":\"const\",\"value\":165},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.20},"
            + "{\"op\":\"sub\",\"args\":["
            + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.resolved\"},"
            + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ad.base\"}]}]},"
            + "{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.40},"
            + "{\"op\":\"read\",\"path\":\"event.entry_source.attr.ap.resolved\"}]}]}";

    private static final String ATTACK_SPEED_FORMULA =
        "{\"op\":\"const\",\"value\":0.50}";

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
            "stacked deck seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "stacked deck seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "stacked deck seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "stacked deck seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "stacked deck seed must not CREATE TABLE");
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
    }

    @Test
    void validatesPrerequisitesAndProjectsRequiredReservedTypes() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertContains("missing attribute_definitions");
        assertContains("INSERT INTO public.types");
        for (String attr : List.of("hp", "ad", "ap", "attack_speed", "armor", "magic_resist")) {
            assertTrue(
                Pattern.compile("(?is)attr_key\\s*=\\s*'" + attr + "'")
                    .matcher(sqlNoLineComments)
                    .find()
                    || sql.contains("'" + attr + "'"),
                "must preflight or write attr_key=" + attr);
        }
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void seedsSelfContainedHeroAndBasicAttackGraphWithEmit() {
        assertContains("hero_twistedfate");
        assertContains("provider_hero_twistedfate_basic_attack");
        assertContains("ability_hero_twistedfate_basic_attack");
        assertContains("phase_hero_twistedfate_basic_attack_impact");
        assertContains("sequence_hero_twistedfate_basic_attack_damage");
        assertContains("step_hero_twistedfate_basic_attack_damage");
        assertContains("step_hero_twistedfate_basic_attack_emit_hit");
        assertContains("event_ref_hero_twistedfate_basic_attack_hit");
        assertContains("INSERT INTO public.game_entities");
        assertContains("INSERT INTO public.entity_attribute_values");
        assertContains("INSERT INTO public.ability_definitions");
        assertContains("INSERT INTO public.ability_phases");
        assertContains("INSERT INTO public.ability_phase_effect_sequences");
        assertContains("event_effect_details");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_basic_attack_damage'\\s*,\\s*"
                        + "'sequence_hero_twistedfate_basic_attack_damage'\\s*,\\s*0\\s*,\\s*20150")
                .matcher(sql)
                .find(),
            "BA damage step must be order 0");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_basic_attack_emit_hit'\\s*,\\s*"
                        + "'sequence_hero_twistedfate_basic_attack_damage'\\s*,\\s*1\\s*,\\s*20158")
                .matcher(sql)
                .find(),
            "emit_event step must be order 1 after damage");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_basic_attack_emit_hit'\\s*,\\s*20211\\s*,\\s*"
                        + "'event_ref_hero_twistedfate_basic_attack_hit'")
                .matcher(sql)
                .find(),
            "emit detail must use event/basic_attack_hit and stable event_ref");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_twistedfate'\\s*,\\s*'provider_hero_twistedfate_basic_attack'")
                .matcher(sql)
                .find(),
            "must mount BA provider to hero_twistedfate");
    }

    @Test
    void seedsStackedDeckPassiveProviderListenerMatchersAndMount() {
        assertContains("provider_hero_twistedfate_stacked_deck");
        assertContains("provider_state_fields");
        assertContains("stacked_deck_hits");
        assertContains("listener_hero_twistedfate_stacked_deck");
        assertContains("listener_match_types");
        assertContains("listener_effect_sequences");
        assertContains("entity_provider_mounts");
        assertTrue(
            Pattern.compile(
                    "(?s)'hero_twistedfate'\\s*,\\s*'provider_hero_twistedfate_stacked_deck'")
                .matcher(sql)
                .find(),
            "must mount Stacked Deck provider to hero_twistedfate");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_hero_twistedfate_stacked_deck'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "Stacked Deck provider kind must be passive 20120");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_twistedfate_stacked_deck'\\s*,\\s*20181\\s*,\\s*20211")
                .matcher(sql)
                .find(),
            "must ALL-match event/basic_attack_hit");
        assertTrue(
            Pattern.compile(
                    "(?s)'listener_hero_twistedfate_stacked_deck'\\s*,\\s*20181\\s*,\\s*20212")
                .matcher(sql)
                .find(),
            "must ALL-match event/source_owner");
        assertTrue(
            Pattern.compile("max_triggers_per_event[\\s\\S]{0,40}1").matcher(sql).find()
                || Pattern.compile(
                        "(?s)'listener_hero_twistedfate_stacked_deck'[\\s\\S]{0,200},\\s*1\\s*,")
                    .matcher(sql)
                    .find(),
            "listener max_triggers_per_event must be 1");
    }

    @Test
    void seedsThreeStackedDeckStepsWithProviderScopeMagicDamageAndDetails() {
        assertContains("step_hero_twistedfate_stacked_deck_hit_add");
        assertContains("step_hero_twistedfate_stacked_deck_proc_damage");
        assertContains("step_hero_twistedfate_stacked_deck_hit_reset");
        assertContains("state_effect_details");
        assertContains("damage_effect_details");
        assertContains("20250");
        assertContains("20221");
        assertContains("20170");
        assertContains("20172");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_stacked_deck_hit_add'\\s*,\\s*"
                        + "'sequence_hero_twistedfate_stacked_deck'\\s*,\\s*0\\s*,\\s*20160\\s*,\\s*20110")
                .matcher(sql)
                .find(),
            "hit_add must be order 0 state_change targeting self");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_stacked_deck_proc_damage'\\s*,\\s*"
                        + "'sequence_hero_twistedfate_stacked_deck'\\s*,\\s*1\\s*,\\s*20150\\s*,\\s*20111\\s*,\\s*"
                        + "'stacked_deck_proc_condition'")
                .matcher(sql)
                .find(),
            "proc damage must be order 1 damage to opponent with condition");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_stacked_deck_hit_reset'\\s*,\\s*"
                        + "'sequence_hero_twistedfate_stacked_deck'\\s*,\\s*2\\s*,\\s*20160\\s*,\\s*20110\\s*,\\s*"
                        + "'stacked_deck_proc_condition'")
                .matcher(sql)
                .find(),
            "hit_reset must be order 2 state_change with same condition");

        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_stacked_deck_hit_add'\\s*,\\s*20250\\s*,\\s*"
                        + "'stacked_deck_hits'\\s*,\\s*'stacked_deck_hit_add'\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "hit_add detail must use provider scope, add policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_stacked_deck_hit_reset'\\s*,\\s*20250\\s*,\\s*"
                        + "'stacked_deck_hits'\\s*,\\s*'stacked_deck_hit_reset'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "hit_reset detail must use provider scope, override policy");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_stacked_deck_proc_damage'\\s*,\\s*"
                        + "'stacked_deck_proc_damage'\\s*,\\s*20221\\s*,\\s*20170")
                .matcher(sql)
                .find(),
            "proc damage detail must be magic damage with add policy (MR pipeline)");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_hero_twistedfate_stacked_deck_proc_damage'[\\s\\S]{0,200}"
                        + "copyable_on_hit[\\s\\S]{0,80}false")
                .matcher(sql)
                .find()
                || Pattern.compile(
                        "(?s)'step_hero_twistedfate_stacked_deck_proc_damage'\\s*,\\s*"
                            + "'stacked_deck_proc_damage'\\s*,\\s*20221\\s*,\\s*20170\\s*,\\s*false")
                    .matcher(sql)
                    .find(),
            "proc damage must set copyable_on_hit=false");
    }

    @Test
    void formulasMatchRank5ContractNumbersAndBonusAdApAst() {
        assertContains(PROC_CONDITION);
        assertContains(PROC_DAMAGE);
        assertContains(ATTACK_SPEED_FORMULA);
        assertContains("provider.state.stacked_deck_hits");
        assertContains("event.entry_source.attr.ad.resolved");
        assertContains("event.entry_source.attr.ad.base");
        assertContains("event.entry_source.attr.ap.resolved");
        assertContains("\"value\":165");
        assertContains("\"value\":0.20");
        assertContains("\"value\":0.40");
        assertContains("\"value\":0.50");
        assertContains("\"value\":4");
        assertContains("\"op\":\"gte\"");
        assertContains("\"op\":\"sub\"");
        assertContains("\"op\":\"add\"");
        assertContains("\"op\":\"mul\"");
        assertFalse(
            Pattern.compile(
                    "(?s)'stacked_deck_proc_condition'\\s*,\\s*'\\{[^']*\"(left|right)\"")
                .matcher(sql)
                .find(),
            "stacked_deck_proc_condition must not use left/right keys");
        assertTrue(
            Pattern.compile(
                    "(?s)'stacked_deck_proc_condition'\\s*,\\s*'\\{[^']*\"args\"\\s*:\\s*\\[")
                .matcher(sql)
                .find(),
            "stacked_deck_proc_condition must use args for the comparison");
    }

    @Test
    void seedsPermanentAttackSpeedPercentAddModifier() {
        assertContains("modifier_hero_twistedfate_stacked_deck_attack_speed");
        assertContains("20173");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_hero_twistedfate_stacked_deck_attack_speed'\\s*,\\s*"
                        + "'provider_hero_twistedfate_stacked_deck'\\s*,\\s*"
                        + "'stacked_deck_attack_speed'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'attack_speed'[\\s\\S]*?"
                        + "20173\\s*,\\s*"
                        + "'stacked_deck_attack_speed'")
                .matcher(sql)
                .find(),
            "AS modifier must target attack_speed with selector/self and percent_add 20173");
    }

    @Test
    void preservesExactlyOneDetailLayoutByConstruction() {
        assertTrue(
            sql.contains("exactly-one-detail") || sql.contains("exactly one detail")
                || sql.contains("deferred exactly-one-detail"),
            "seed must document deferred exactly-one-detail pairing");
        assertTrue(
            countOccurrences(sql, "'step_hero_twistedfate_stacked_deck_hit_add'") >= 2,
            "hit_add must appear in effect_steps and state_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_twistedfate_stacked_deck_proc_damage'") >= 2,
            "proc_damage must appear in effect_steps and damage_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_twistedfate_stacked_deck_hit_reset'") >= 2,
            "hit_reset must appear in effect_steps and state_effect_details");
        assertTrue(
            countOccurrences(sql, "'step_hero_twistedfate_basic_attack_emit_hit'") >= 2,
            "emit_hit must appear in effect_steps and event_effect_details");
        assertFalse(sql.contains("heal_effect_details"), "must not mix unrelated detail families");
    }

    @Test
    void excludesBuildingReductionOtherRanksActivesAndMigration() {
        assertFalse(
            Pattern.compile("(?i)building|建筑物|0\\.5\\s*\\*.*building|structure")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement building 50% damage reduction");
        assertFalse(
            Pattern.compile("(?i)rank\\s*[1-4]\\b|ranks?\\s*=\\s*\\[|maxrank")
                .matcher(sqlNoLineComments)
                .find(),
            "must not model other ranks / rank tables");
        assertFalse(
            Pattern.compile("(?i)ability_hero_twistedfate_[qwr]|stacked_deck_active|选牌|万能牌|命运")
                .matcher(sqlNoLineComments)
                .find(),
            "must not implement Q/W/R or other actives");
        assertFalse(
            Pattern.compile("(?i)migration|ALTER\\s+TABLE|live\\s+migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not include live migration");
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
