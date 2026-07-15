package xyz.game.datamanage.db;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Static contract for {@code lol_generic_jaksho_voidborn_resilience_seed.sql}.
 * Does not connect to a live database.
 */
class LolGenericJakshoVoidbornResilienceSeedSqlTest {

    private static final String SEED_RELATIVE =
        "db/game_manage/seeds/lol_generic_jaksho_voidborn_resilience_seed.sql";

    private static final List<String> STABLE_IDS = List.of(
        "item_6665",
        "provider_item_6665_jaksho_voidborn_resilience",
        "sequence_item_6665_jaksho_voidborn_resilience_tick",
        "step_item_6665_jaksho_voidborn_resilience_full_stack_set",
        "modifier_item_6665_jaksho_voidborn_resilience_armor",
        "modifier_item_6665_jaksho_voidborn_resilience_magic_resist",
        "full_stack",
        "full_stack_set",
        "voidborn_bonus_armor",
        "voidborn_bonus_magic_resist",
        "bonus_armor",
        "bonus_magic_resist");

    private static final List<Integer> REQUIRED_RESERVED = List.of(
        20100, 20110, 20120, 20160, 20170, 20172, 20250);

    private static final String ARMOR_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.30},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.bonus_armor.resolved\"}]}]},"
            + "{\"op\":\"read\",\"path\":\"provider.state.full_stack\"}]}";

    private static final String MAGIC_RESIST_FORMULA =
        "{\"op\":\"mul\",\"args\":[{\"op\":\"mul\",\"args\":[{\"op\":\"const\",\"value\":0.30},"
            + "{\"op\":\"max\",\"args\":[{\"op\":\"const\",\"value\":0},"
            + "{\"op\":\"read\",\"path\":\"$owner.attr.bonus_magic_resist.resolved\"}]}]},"
            + "{\"op\":\"read\",\"path\":\"provider.state.full_stack\"}]}";

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
            "tick/mount idempotent guards must use change_revision > v_locked_current");
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
            "jaksho seed must not DELETE");
        assertFalse(
            Pattern.compile("(?is)\\bDROP\\b").matcher(sqlNoLineComments).find(),
            "jaksho seed must not DROP");
        assertFalse(
            Pattern.compile("(?is)\\bCASCADE\\b").matcher(sqlNoLineComments).find(),
            "jaksho seed must not CASCADE");
        assertFalse(
            Pattern.compile("(?is)\\bALTER\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "jaksho seed must not ALTER TABLE");
        assertFalse(
            Pattern.compile("(?is)\\bCREATE\\s+TABLE\\b").matcher(sqlNoLineComments).find(),
            "jaksho seed must not CREATE TABLE");
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
    void validatesPrerequisitesAndEnsuresBonusAttributeDefinitions() {
        assertContains("RAISE EXCEPTION");
        assertContains("missing reserved_type");
        assertTrue(
            Pattern.compile("(?is)ARRAY\\s*\\[\\s*'hp'\\s*,\\s*'armor'\\s*,\\s*'magic_resist'\\s*\\]")
                .matcher(sqlNoLineComments)
                .find(),
            "must preflight attribute_definitions hp/armor/magic_resist");
        assertContains("missing attribute_definitions");
        assertTrue(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.attribute_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must ensure bonus_armor / bonus_magic_resist attribute_definitions");
        assertContains("'bonus_armor'");
        assertContains("'bonus_magic_resist'");
        for (int typeId : REQUIRED_RESERVED) {
            assertContains(Integer.toString(typeId));
        }
    }

    @Test
    void assertsStableIdsAndStaticItemValues() {
        for (String id : STABLE_IDS) {
            assertContains(id);
        }
        assertTrue(
            Pattern.compile("(?s)'item_6665'[\\s\\S]{0,80}'hp'\\s*,\\s*350")
                .matcher(sql)
                .find()
                || Pattern.compile("(?s)'item_6665'\\s*,\\s*'hp'\\s*,\\s*350")
                    .matcher(sql)
                    .find(),
            "item_6665 must have static hp=350");
        assertTrue(
            Pattern.compile("(?s)'item_6665'\\s*,\\s*'armor'\\s*,\\s*45")
                .matcher(sql)
                .find(),
            "item_6665 must have static armor=45");
        assertTrue(
            Pattern.compile("(?s)'item_6665'\\s*,\\s*'magic_resist'\\s*,\\s*45")
                .matcher(sql)
                .find(),
            "item_6665 must have static magic_resist=45");
        assertContains("source item id 6665");
    }

    @Test
    void mountsOnlyVoidbornProviderOnItem6665() {
        assertTrue(
            Pattern.compile(
                    "(?s)'item_6665'\\s*,\\s*'provider_item_6665_jaksho_voidborn_resilience'")
                .matcher(sql)
                .find(),
            "must mount voidborn provider to item_6665");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_6665_jaksho_voidborn_resilience'[\\s\\S]{0,80}20120")
                .matcher(sql)
                .find(),
            "provider kind must be passive 20120");
        assertFalse(
            Pattern.compile("(?s)'item_(?!6665')\\w+'\\s*,\\s*'provider_item_6665")
                .matcher(sql)
                .find(),
            "must not mount this provider to entities other than item_6665");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.entity_provider_mounts"),
            "must mount exactly once via entity_provider_mounts");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_definitions"),
            "must define exactly one provider");
    }

    @Test
    void lifecycleTickAndSingleFullStackOverrideStateChange() {
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_6665_jaksho_voidborn_resilience'[\\s\\S]{0,120}"
                        + "NULL\\s*,\\s*1\\s*,\\s*NULL\\s*,\\s*5000\\s*,\\s*5000")
                .matcher(sql)
                .find(),
            "lifecycle must be tick_interval_ms=5000 and start_delay_ms=5000");
        assertTrue(
            Pattern.compile(
                    "(?s)'provider_item_6665_jaksho_voidborn_resilience'\\s*,\\s*"
                        + "'sequence_item_6665_jaksho_voidborn_resilience_tick'")
                .matcher(sql)
                .find(),
            "provider_tick_sequences must link provider to tick sequence");
        assertTrue(
            Pattern.compile(
                    "(?s)'full_stack'[\\s\\S]{0,120}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}NULL[\\s\\S]{0,40}NULL")
                .matcher(sql)
                .find(),
            "exactly one full_stack state field: number / max 1 / untimed");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6665_jaksho_voidborn_resilience_full_stack_set'\\s*,\\s*"
                        + "'sequence_item_6665_jaksho_voidborn_resilience_tick'\\s*,\\s*0\\s*,\\s*"
                        + "20160\\s*,\\s*20110\\s*,\\s*NULL")
                .matcher(sql)
                .find(),
            "tick step must be order 0 state_change targeting self");
        assertTrue(
            Pattern.compile(
                    "(?s)'step_item_6665_jaksho_voidborn_resilience_full_stack_set'\\s*,\\s*"
                        + "20250\\s*,\\s*'full_stack'\\s*,\\s*'full_stack_set'\\s*,\\s*20172")
                .matcher(sql)
                .find(),
            "state detail must override/set full_stack via const 1 formula");
        assertContains("{\"op\":\"const\",\"value\":1}");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_state_fields"),
            "must define exactly one provider_state_fields insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_lifecycles"),
            "must define exactly one provider_lifecycles insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_tick_sequences"),
            "must define exactly one provider_tick_sequences insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.effect_steps"),
            "must define exactly one effect_steps insert");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.state_effect_details"),
            "must define exactly one state_effect_details insert");
    }

    @Test
    void ownerSelfAddModifiersUseBonusClampAndFullStackGate() {
        assertContains(ARMOR_FORMULA);
        assertContains(MAGIC_RESIST_FORMULA);
        assertContains("0.30");
        assertContains("$owner.attr.bonus_armor.resolved");
        assertContains("$owner.attr.bonus_magic_resist.resolved");
        assertContains("provider.state.full_stack");
        assertContains("\"op\":\"max\"");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_6665_jaksho_voidborn_resilience_armor'\\s*,\\s*"
                        + "'provider_item_6665_jaksho_voidborn_resilience'\\s*,\\s*"
                        + "'voidborn_bonus_armor'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'armor'[\\s\\S]*?"
                        + "20170\\s*,\\s*"
                        + "'voidborn_bonus_armor'")
                .matcher(sql)
                .find(),
            "armor modifier must be owner-self add");
        assertTrue(
            Pattern.compile(
                    "(?s)'modifier_item_6665_jaksho_voidborn_resilience_magic_resist'\\s*,\\s*"
                        + "'provider_item_6665_jaksho_voidborn_resilience'\\s*,\\s*"
                        + "'voidborn_bonus_magic_resist'\\s*,\\s*"
                        + "NULL\\s*,\\s*"
                        + "20110\\s*,\\s*"
                        + "'magic_resist'[\\s\\S]*?"
                        + "20170\\s*,\\s*"
                        + "'voidborn_bonus_magic_resist'")
                .matcher(sql)
                .find(),
            "magic_resist modifier must be owner-self add");
        assertFalse(
            Pattern.compile("(?i)1\\.3\\b|\\*\\s*1\\.3|mul.*1\\.3")
                .matcher(sqlNoLineComments)
                .find(),
            "must not multiply total armor/MR by 1.3");
        assertFalse(
            Pattern.compile(
                    "(?s)voidborn_bonus_(?:armor|magic_resist)[\\s\\S]{0,400}"
                        + "\\$owner\\.attr\\.(?:armor|magic_resist)(?:\\.resolved)?")
                .matcher(sqlNoLineComments)
                .find(),
            "bonus formulas must not read total armor/magic_resist");
        assertEquals(
            1,
            countOccurrences(sqlNoLineComments, "INSERT INTO public.provider_modifiers"),
            "must define exactly one provider_modifiers insert block");
    }

    @Test
    void excludesDamageListenerAbilityEquipmentLoadoutAndLiveMigration() {
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.damage_effect_details\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write damage_effect_details for this provider");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.provider_listeners\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write provider_listeners for this provider");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.ability_definitions\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write ability_definitions for this provider");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_match_types\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write listener_match_types");
        assertFalse(
            Pattern.compile("(?is)INSERT\\s+INTO\\s+public\\.listener_effect_sequences\\b")
                .matcher(sqlNoLineComments)
                .find(),
            "must not write listener_effect_sequences");
        assertFalse(
            Pattern.compile("(?i)equipment|loadout|装备栏|出装")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode target equipment/loadout projection");
        assertFalse(
            Pattern.compile("(?i)live\\s*migration|migration\\.sql|compatibility_migration")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode live migration behavior");
        assertFalse(
            Pattern.compile(
                    "(?s)'full_stack'[\\s\\S]{0,160}20100[\\s\\S]{0,40}1"
                        + "[\\s\\S]{0,40}(?!NULL)\\d+")
                .matcher(sql)
                .find(),
            "full_stack must not use a numeric duration_ms (untimed for the run)");
        assertFalse(
            Pattern.compile("(?i)stat_modifier_always_on|batch_v_a|item_6665_jaksho_voidborn_resilience_batch")
                .matcher(sqlNoLineComments)
                .find(),
            "must not encode legacy DPS lane always-on full-stack policy");
        assertTrue(
            Pattern.compile("(?i)start_delay_ms\\s*=\\s*5000|start_delay_ms=5000")
                .matcher(sql)
                .find()
                || sql.contains("5000,\n        5000")
                || Pattern.compile("5000\\s*,\\s*5000").matcher(sqlNoLineComments).find(),
            "activation must be delayed 5000ms (not full-stack-at-time-zero)");
    }

    private static void assertEquals(int expected, int actual, String message) {
        org.junit.jupiter.api.Assertions.assertEquals(expected, actual, message);
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
